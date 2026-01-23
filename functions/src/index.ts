import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');

// Initialize Firebase Admin
admin.initializeApp();

// Set global options - Tokyo region
setGlobalOptions({
  region: 'asia-northeast1',
  maxInstances: 10,
  timeoutSeconds: 300,  // 5 minutes timeout
  memory: '1GiB',       // More memory for large files
});

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: 'welfare-assist-pro',
  location: 'asia-northeast1',
});

const model = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
});

// Function-level options for increased timeout and memory
const functionOptions = {
  region: 'asia-northeast1',
  maxInstances: 10,
  timeoutSeconds: 300,
  memory: '1GiB' as const,
};

// ===== 1. Generate Meeting Summary =====
export const generateMeetingSummary = onCall(functionOptions, async (request) => {
  const { roughNotes, clientName, clientCondition } = request.data;

  if (!roughNotes) {
    throw new HttpsError('invalid-argument', 'roughNotes is required');
  }

  try {
    const prompt = `
あなたは福祉用具専門相談員です。以下の粗いメモを元に、正式な議事録を生成してください。

## 利用者情報
- 氏名: ${clientName || '不明'}
- 状態: ${clientCondition || '不明'}

## 粗いメモ
${roughNotes}

## 出力フォーマット
以下の形式で議事録を生成してください：

【訪問日時】
【訪問目的】
【利用者の状態】
【確認事項】
【対応内容】
【今後の予定】
【特記事項】
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return { success: true, summary: text };
  } catch (error) {
    console.error('generateMeetingSummary error:', error);
    throw new HttpsError('internal', 'Failed to generate meeting summary');
  }
});

// ===== 2. Suggest Equipment =====
export const suggestEquipment = onCall(functionOptions, async (request) => {
  const { medicalHistory, currentCondition, careLevel } = request.data;

  if (!medicalHistory && !currentCondition) {
    throw new HttpsError('invalid-argument', 'medicalHistory or currentCondition is required');
  }

  try {
    const prompt = `
あなたは福祉用具専門相談員です。以下の情報を元に、適切な福祉用具を提案してください。

## 利用者情報
- 病歴: ${medicalHistory || '不明'}
- 現在の状態: ${currentCondition || '不明'}
- 要介護度: ${careLevel || '不明'}

## 出力フォーマット
以下の形式で提案してください：

【推奨福祉用具】
1. 用具名 - 理由
2. 用具名 - 理由
...

【注意事項】
- 注意点があれば記載

【その他の提案】
- 追加の提案があれば記載
`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return { success: true, suggestion: text };
  } catch (error) {
    console.error('suggestEquipment error:', error);
    throw new HttpsError('internal', 'Failed to suggest equipment');
  }
});

// ===== 3. Extract Medical Info from Document =====
export const extractMedicalInfo = onCall(functionOptions, async (request) => {
  const { fileBase64, mimeType } = request.data;

  if (!fileBase64 || !mimeType) {
    throw new HttpsError('invalid-argument', 'fileBase64 and mimeType are required');
  }

  try {
    const prompt = `
この医療文書から以下の情報を抽出してください：

1. 診断名・病名
2. 現在の症状
3. 治療内容
4. 服用中の薬
5. 注意事項
6. その他重要な情報

できるだけ正確に抽出し、読み取れない部分は「判読不可」と記載してください。
`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: fileBase64,
            },
          },
        ],
      }],
    });

    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    return { success: true, text };
  } catch (error) {
    console.error('extractMedicalInfo error:', error);
    throw new HttpsError('internal', 'Failed to extract medical info');
  }
});

// ===== 4. Parse Wholesale Invoice =====
interface InvoiceItem {
  customerName: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export const parseWholesaleInvoice = onCall(functionOptions, async (request) => {
  const { fileBase64, mimeType, wholesaleCompany, billingMonth } = request.data;

  if (!fileBase64 || !mimeType) {
    throw new HttpsError('invalid-argument', 'fileBase64 and mimeType are required');
  }

  console.log(`Processing invoice: ${wholesaleCompany || 'unknown'}, ${billingMonth || 'unknown'}月, mimeType: ${mimeType}`);

  // Retry configuration
  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt}/${MAX_RETRIES}`);

      // Simple CSV-like format for maximum compatibility
      const prompt = `この請求書から利用者名と金額を抽出してください。

出力形式（1行1件、カンマ区切り）:
山田太郎,車いす,1000
田中花子,ベッド,2000

ルール:
- 利用者の個人名のみ（施設名は除外）
- 商品名は短く
- 金額は数字のみ（カンマなし）
- 全利用者を出力`;

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: fileBase64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    });

    const response = result.response;

    // Debug: Log response info
    const finishReason = response.candidates?.[0]?.finishReason;
    console.log('Response finishReason:', finishReason);

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('Response text length:', text.length);
    if (text) {
      console.log('Response text preview:', text.substring(0, 500));
    }

    // Parse CSV-like format: name,item,amount (one per line)
    const parseCSVResponse = (csvText: string): InvoiceItem[] => {
      const items: InvoiceItem[] = [];
      const lines = csvText.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Skip header-like lines or explanatory text
        if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.includes('出力') || trimmed.includes('形式')) continue;

        // Parse CSV: name,item,amount
        const parts = trimmed.split(',');
        if (parts.length >= 3) {
          const name = parts[0].trim();
          const itemName = parts[1].trim();
          const amountStr = parts[parts.length - 1].trim().replace(/[^0-9]/g, '');
          const amount = parseInt(amountStr, 10) || 0;

          // Skip if name looks like a header or is empty
          if (!name || name === '利用者名' || name === '名前' || name.length > 20) continue;

          items.push({
            customerName: name,
            itemName: itemName,
            quantity: 1,
            unitPrice: amount,
            amount: amount,
          });
        }
      }

      return items;
    };

    // Empty response
    if (!text) {
      console.log('No response from Vertex AI. FinishReason:', finishReason);
      return {
        success: true,
        items: [],
        totalAmount: 0,
        rawText: '',
      };
    }

    // Parse CSV-like response
    const items = parseCSVResponse(text);
    const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);

      console.log(`Successfully parsed invoice: ${items.length} items, total: ${totalAmount}`);
      return {
        success: true,
        items,
        totalAmount,
        rawText: text,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${attempt} failed:`, lastError.message);

      if (attempt < MAX_RETRIES) {
        console.log(`Retrying in 1 second...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  // All retries failed
  console.error('All retry attempts failed:', lastError?.message);
  return {
    success: true,
    items: [],
    totalAmount: 0,
    rawText: '',
  };
});

// ===== 5. Parse Wholesale Invoice V2 (Improved with PDF text extraction) =====
// This version first attempts to extract text from PDF using pdf-parse,
// then sends text to Gemini for structured extraction (more efficient).
// For large documents, text is split into chunks and processed in parallel.
// Falls back to multimodal processing for scanned PDFs.

// Helper: Split text into chunks for processing
function splitTextIntoChunks(text: string, maxCharsPerChunk: number = 15000): string[] {
  const chunks: string[] = [];
  const lines = text.split('\n');
  let currentChunk = '';

  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > maxCharsPerChunk) {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// Helper: Parse CSV response
function parseCSVResponse(csvText: string): InvoiceItem[] {
  const items: InvoiceItem[] = [];
  const lines = csvText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.includes('出力') || trimmed.includes('形式')) continue;

    const parts = trimmed.split(',');
    if (parts.length >= 3) {
      const name = parts[0].trim();
      const itemName = parts[1].trim();
      const amountStr = parts[parts.length - 1].trim().replace(/[^0-9]/g, '');
      const amount = parseInt(amountStr, 10) || 0;

      if (!name || name === '利用者名' || name === '名前' || name.length > 20) continue;

      items.push({
        customerName: name,
        itemName: itemName,
        quantity: 1,
        unitPrice: amount,
        amount: amount,
      });
    }
  }
  return items;
}

// Helper: Process a single text chunk with Gemini
// Returns items and a flag indicating if the chunk had a valid response
async function processTextChunk(chunkText: string, chunkIndex: number, totalChunks: number): Promise<{ items: InvoiceItem[]; hasResponse: boolean }> {
  const prompt = `この請求書データから利用者名と金額を抽出してください。

出力形式（1行1件、カンマ区切り）:
山田太郎,車いす,1000
田中花子,ベッド,2000

ルール:
- 利用者の個人名のみ（施設名は除外）
- 商品名は短く
- 金額は数字のみ（カンマなし）
- 全利用者を出力

以下は請求書から抽出されたテキスト（パート${chunkIndex + 1}/${totalChunks}）です：

${chunkText}`;

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
      },
    });

    const response = result.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log(`[V2] Chunk ${chunkIndex + 1}/${totalChunks}: ${text.length} chars response`);

    const items = parseCSVResponse(text);
    return { items, hasResponse: text.length > 0 };
  } catch (error) {
    console.error(`[V2] Chunk ${chunkIndex + 1} processing failed:`, error);
    return { items: [], hasResponse: false };
  }
}

export const parseWholesaleInvoiceV2 = onCall(functionOptions, async (request) => {
  const { fileBase64, mimeType, wholesaleCompany, billingMonth } = request.data;

  if (!fileBase64 || !mimeType) {
    throw new HttpsError('invalid-argument', 'fileBase64 and mimeType are required');
  }

  console.log(`[V2] Processing invoice: ${wholesaleCompany || 'unknown'}, ${billingMonth || 'unknown'}月, mimeType: ${mimeType}`);

  // Convert base64 to Buffer
  const pdfBuffer = Buffer.from(fileBase64, 'base64');

  // Try to extract text from PDF first (only for PDF files)
  let extractedText = '';
  let useMultimodal = false;
  let numPages = 0;

  if (mimeType === 'application/pdf') {
    try {
      console.log('[V2] Attempting PDF text extraction with pdf-parse...');
      const pdfData = await pdfParse(pdfBuffer);
      extractedText = pdfData.text || '';
      numPages = pdfData.numpages || 0;

      // Check if meaningful text was extracted (not just whitespace/numbers)
      const meaningfulChars = extractedText.replace(/[\s\d.,\-\/\\]+/g, '').length;
      const totalChars = extractedText.length;

      console.log(`[V2] Extracted ${totalChars} chars, ${meaningfulChars} meaningful chars, ${numPages} pages`);

      // If less than 10% meaningful characters, likely a scanned PDF
      if (totalChars < 100 || meaningfulChars / totalChars < 0.1) {
        console.log('[V2] Low text quality detected, falling back to multimodal');
        useMultimodal = true;
        extractedText = '';
      }
    } catch (pdfError) {
      console.error('[V2] PDF text extraction failed:', pdfError);
      useMultimodal = true;
    }
  } else {
    // For images, always use multimodal
    console.log('[V2] Non-PDF file, using multimodal processing');
    useMultimodal = true;
  }

  // If using text-based processing and text is large, split into chunks
  if (!useMultimodal && extractedText.length > 15000) {
    console.log(`[V2] Large text detected (${extractedText.length} chars), splitting into chunks...`);

    const chunks = splitTextIntoChunks(extractedText, 15000);
    console.log(`[V2] Split into ${chunks.length} chunks`);

    // Process chunks in parallel (max 5 concurrent)
    const allItems: InvoiceItem[] = [];
    let emptyResponseCount = 0;
    const CONCURRENT_LIMIT = 5;

    for (let i = 0; i < chunks.length; i += CONCURRENT_LIMIT) {
      const batch = chunks.slice(i, i + CONCURRENT_LIMIT);
      const batchPromises = batch.map((chunk, idx) =>
        processTextChunk(chunk, i + idx, chunks.length)
      );

      const batchResults = await Promise.all(batchPromises);
      for (const result of batchResults) {
        allItems.push(...result.items);
        if (!result.hasResponse) {
          emptyResponseCount++;
        }
      }

      console.log(`[V2] Processed batch ${Math.floor(i / CONCURRENT_LIMIT) + 1}, total items so far: ${allItems.length}`);
    }

    // Check if too many chunks returned empty responses (>50%)
    const emptyRatio = emptyResponseCount / chunks.length;
    console.log(`[V2] Empty response ratio: ${emptyResponseCount}/${chunks.length} (${(emptyRatio * 100).toFixed(1)}%)`);

    if (emptyRatio > 0.4) {
      // Too many empty responses, fall back to multimodal processing
      console.log(`[V2] Too many empty responses (${(emptyRatio * 100).toFixed(1)}%), falling back to multimodal...`);
      useMultimodal = true;
      // Continue to multimodal processing below
    } else {
      // Deduplicate items by customerName + itemName
      const seen = new Set<string>();
      const uniqueItems = allItems.filter(item => {
        const key = `${item.customerName}-${item.itemName}-${item.amount}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const totalAmount = uniqueItems.reduce((sum, item) => sum + (item.amount || 0), 0);

      console.log(`[V2] Chunked processing complete: ${uniqueItems.length} unique items (from ${allItems.length}), total: ${totalAmount}`);
      return {
        success: true,
        items: uniqueItems,
        totalAmount,
        rawText: `Processed ${chunks.length} chunks from ${numPages} pages`,
        processedWith: 'text-chunked',
      };
    }
  }

  // Regular processing for smaller texts or multimodal
  const MAX_RETRIES = 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[V2] Attempt ${attempt}/${MAX_RETRIES}, useMultimodal: ${useMultimodal}`);

      const prompt = `この請求書から利用者名と金額を抽出してください。

出力形式（1行1件、カンマ区切り）:
山田太郎,車いす,1000
田中花子,ベッド,2000

ルール:
- 利用者の個人名のみ（施設名は除外）
- 商品名は短く
- 金額は数字のみ（カンマなし）
- 全利用者を出力`;

      let result;

      if (useMultimodal) {
        // Multimodal processing (for scanned PDFs and images)
        result = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: fileBase64,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        });
      } else {
        // Text-based processing (more efficient for text PDFs)
        const textPrompt = `${prompt}

以下は請求書から抽出されたテキストです：

${extractedText}`;

        result = await model.generateContent({
          contents: [{
            role: 'user',
            parts: [{ text: textPrompt }],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 8192,
          },
        });
      }

      const response = result.response;
      const finishReason = response.candidates?.[0]?.finishReason;
      console.log('[V2] Response finishReason:', finishReason);

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[V2] Response text length:', text.length);

      if (!text) {
        console.log('[V2] No response from Vertex AI');
        return {
          success: true,
          items: [],
          totalAmount: 0,
          rawText: '',
          processedWith: useMultimodal ? 'multimodal' : 'text',
        };
      }

      const items = parseCSVResponse(text);
      const totalAmount = items.reduce((sum, item) => sum + (item.amount || 0), 0);

      console.log(`[V2] Successfully parsed invoice: ${items.length} items, total: ${totalAmount}`);
      return {
        success: true,
        items,
        totalAmount,
        rawText: text,
        processedWith: useMultimodal ? 'multimodal' : 'text',
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[V2] Attempt ${attempt} failed:`, lastError.message);

      if (attempt < MAX_RETRIES) {
        console.log('[V2] Retrying in 1 second...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  console.error('[V2] All retry attempts failed:', lastError?.message);
  return {
    success: true,
    items: [],
    totalAmount: 0,
    rawText: '',
    processedWith: 'failed',
  };
});
