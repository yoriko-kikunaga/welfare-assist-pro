import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
import { PDFDocument } from 'pdf-lib';
import { google, sheets_v4 } from 'googleapis';
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
      console.log(`Attempt ${attempt}/${MAX_RETRIES}, company: ${wholesaleCompany}`);

      // Use company-specific prompt
      const prompt = getCompanySpecificPrompt(wholesaleCompany || '');

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
        maxOutputTokens: 16384,
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
          // Skip header rows but allow longer names (some names include honorifics, spaces, or extra text)
      if (!name || name === '利用者名' || name === '名前' || name.length > 50) continue;

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

// Helper: Split PDF into page chunks and return as base64 arrays
async function splitPdfIntoChunks(pdfBuffer: Buffer, pagesPerChunk: number = 5): Promise<string[]> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const chunks: string[] = [];

  for (let startPage = 0; startPage < totalPages; startPage += pagesPerChunk) {
    const endPage = Math.min(startPage + pagesPerChunk, totalPages);
    const newPdf = await PDFDocument.create();
    const pagesToCopy = await newPdf.copyPages(pdfDoc, Array.from({ length: endPage - startPage }, (_, i) => startPage + i));
    pagesToCopy.forEach(page => newPdf.addPage(page));
    const pdfBytes = await newPdf.save();
    chunks.push(Buffer.from(pdfBytes).toString('base64'));
  }

  console.log(`[splitPdf] Split ${totalPages} pages into ${chunks.length} chunks of ${pagesPerChunk} pages each`);
  return chunks;
}

// Helper: Process a single PDF chunk with multimodal
async function processPdfChunkMultimodal(pdfBase64: string, chunkIndex: number, totalChunks: number, wholesaleCompany: string): Promise<{ items: InvoiceItem[]; hasResponse: boolean }> {
  const prompt = getCompanySpecificPrompt(wholesaleCompany);

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: `${prompt}\n\n【PDFチャンク ${chunkIndex + 1}/${totalChunks}】` },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pdfBase64,
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
    const finishReason = response.candidates?.[0]?.finishReason;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`[V2] PDF Chunk ${chunkIndex + 1}/${totalChunks}: ${text.length} chars, finishReason: ${finishReason}`);

    if (text) {
      const preview = text.split('\n').slice(0, 3).join(' | ');
      console.log(`[V2] PDF Chunk ${chunkIndex + 1} preview: ${preview}`);
    }

    const items = parseCSVResponse(text, chunkIndex === 0);
    console.log(`[V2] PDF Chunk ${chunkIndex + 1} parsed: ${items.length} items`);

    return { items, hasResponse: text.length > 0 };
  } catch (error) {
    console.error(`[V2] PDF Chunk ${chunkIndex + 1} processing failed:`, error);
    return { items: [], hasResponse: false };
  }
}

// Helper: Parse CSV response
function parseCSVResponse(csvText: string, debug: boolean = false): InvoiceItem[] {
  const items: InvoiceItem[] = [];

  // Strip markdown code blocks first
  let cleanedText = csvText;
  // Remove ```csv, ```text, ``` blocks
  cleanedText = cleanedText.replace(/```(?:csv|text|plain)?\s*\n?/gi, '');
  // Remove any remaining backticks at start/end of lines
  cleanedText = cleanedText.replace(/^`+|`+$/gm, '');

  const lines = cleanedText.split('\n');
  let skippedCount = 0;

  if (debug) {
    console.log(`[parseCSV] Original text (first 300 chars): ${csvText.substring(0, 300)}`);
    console.log(`[parseCSV] Cleaned text (first 300 chars): ${cleanedText.substring(0, 300)}`);
    console.log(`[parseCSV] Total lines: ${lines.length}`);
  }

  // Header patterns to skip
  const headerPatterns = [
    '利用者名', '名前', '商品名', '金額', 'customerName', 'itemName', 'amount',
    '出力', '形式', 'CSV', '例:', '---', '===', '以下', '抽出', '結果',
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip comments and obvious non-data lines
    if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*')) {
      if (debug) console.log(`[parseCSV] Skipped comment: ${trimmed.substring(0, 50)}`);
      continue;
    }

    // Skip lines containing header patterns
    const isHeader = headerPatterns.some(pattern => trimmed.includes(pattern));
    if (isHeader) {
      if (debug) console.log(`[parseCSV] Skipped header: ${trimmed.substring(0, 50)}`);
      continue;
    }

    const parts = trimmed.split(',');
    if (parts.length >= 3) {
      const name = parts[0].trim();
      const itemName = parts[1].trim();
      const amountStr = parts[parts.length - 1].trim().replace(/[^0-9-]/g, '');
      const amount = parseInt(amountStr, 10) || 0;

      // Skip invalid entries
      if (!name || name.length > 50) {
        if (debug) console.log(`[parseCSV] Skipped invalid name: "${name}" (length: ${name?.length || 0})`);
        skippedCount++;
        continue;
      }

      // Skip zero or negative amounts (but log them)
      if (amount <= 0) {
        if (debug) console.log(`[parseCSV] Skipped zero/negative amount: "${name}", ${amount}`);
        skippedCount++;
        continue;
      }

      items.push({
        customerName: name,
        itemName: itemName,
        quantity: 1,
        unitPrice: amount,
        amount: amount,
      });

      if (debug && items.length <= 5) {
        console.log(`[parseCSV] Added item: ${name}, ${itemName}, ${amount}`);
      }
    } else {
      if (debug) console.log(`[parseCSV] Skipped line (not enough parts): ${trimmed.substring(0, 50)}`);
      skippedCount++;
    }
  }

  if (debug) {
    console.log(`[parseCSV] Result: ${items.length} items parsed, ${skippedCount} lines skipped`);
  }

  return items;
}

// Helper: Get company-specific prompt for invoice parsing
function getCompanySpecificPrompt(wholesaleCompany: string): string {
  // Very strong instruction for CSV-only output
  const csvInstruction = `【重要】CSV形式のみで出力してください。説明文・前置き・コードブロックは禁止です。

出力ルール:
1. 各行は「利用者名,商品名,金額」の形式
2. ヘッダー行は不要
3. 説明文は書かない
4. コードブロック(\`\`\`)は使わない

正しい出力例:
山田太郎,車いす,3800
佐藤花子,ベッド,2800

間違った出力例（禁止）:
以下が抽出結果です：
\`\`\`csv
山田太郎,車いす,3800
\`\`\`

抽出ルール:
- 利用者名: 個人名のみ（「様」「殿」は除去、スペースは除去）
- 商品名: 簡潔に（型番不要）
- 金額: 数字のみ（カンマや円記号は除去、0以下はスキップ）
- 合計行・小計行はスキップ`;

  if (wholesaleCompany.includes('野口')) {
    return `${csvInstruction}

野口株式会社の請求書フォーマット:
- 利用者名は【】括弧内にあります（例:【池田救仁敬】）
- 会社名のみの【株式会社ＡＣＧ】はスキップ
- 商品名は「継続」「新規」の後にあります
- 金額は各行の右端の数値です`;
  }

  if (wholesaleCompany.includes('ニシケン')) {
    return `${csvInstruction}

ニシケンの請求書フォーマット:
- 利用者名は「摘要」列にあります（例: 鹿島竹子、髙田広志）
- 商品名は「商品名」列にあります
- 金額は「金額」列の数値です
- 「保留」「合計」などの集計行はスキップ`;
  }

  if (wholesaleCompany.includes('日本ケアサプライ')) {
    return `${csvInstruction}

日本ケアサプライの請求書フォーマット:
- 利用者名は「利用者名」列にあります（「様」を除去: 赤崎和子様 → 赤崎和子）
- 商品名は「商」列にあります
- 金額は「本体価格」列の数値です
- 施設名（ACG内覧会など）はスキップ`;
  }

  if (wholesaleCompany.includes('パラマウント')) {
    return `${csvInstruction}

パラマウントの請求書フォーマット:
- 利用者名は「御利用者」列にあります（例: 赤崎廣良、浅井雄二）
- 空欄の場合は直前の利用者名を使用
- 商品名は「商品名」列にあります
- 金額は「金額」列の数値です（小計列ではない）`;
  }

  if (wholesaleCompany.includes('キシヤ')) {
    return `${csvInstruction}

キシヤの請求書から利用者名、商品名、金額を抽出してください。`;
  }

  return `${csvInstruction}

請求書から利用者名、商品名、金額を抽出してください。`;
}

// Helper: Process a single text chunk with Gemini
// Returns items and a flag indicating if the chunk had a valid response
async function processTextChunk(chunkText: string, chunkIndex: number, totalChunks: number, wholesaleCompany: string): Promise<{ items: InvoiceItem[]; hasResponse: boolean }> {
  const basePrompt = getCompanySpecificPrompt(wholesaleCompany);
  const prompt = `${basePrompt}

【請求書テキスト ${chunkIndex + 1}/${totalChunks}】
${chunkText}

【出力開始】`;

  // Log first chunk's input for debugging
  if (chunkIndex === 0) {
    console.log(`[V2] First chunk input (first 500 chars): ${chunkText.substring(0, 500)}`);
  }

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16384,
      },
    });

    const response = result.response;
    const finishReason = response.candidates?.[0]?.finishReason;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`[V2] Chunk ${chunkIndex + 1}/${totalChunks}: ${text.length} chars, finishReason: ${finishReason}`);

    if (finishReason === 'MAX_TOKENS') {
      console.warn(`[V2] Chunk ${chunkIndex + 1} hit MAX_TOKENS, partial response`);
    }

    // Debug: show first few lines of response
    if (text) {
      const preview = text.split('\n').slice(0, 3).join(' | ');
      console.log(`[V2] Chunk ${chunkIndex + 1} preview: ${preview}`);
    }

    const items = parseCSVResponse(text, true);
    console.log(`[V2] Chunk ${chunkIndex + 1} parsed: ${items.length} items`);

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
        processTextChunk(chunk, i + idx, chunks.length, wholesaleCompany || '')
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
      console.log(`[V2] Attempt ${attempt}/${MAX_RETRIES}, useMultimodal: ${useMultimodal}, company: ${wholesaleCompany}`);

      // Use company-specific prompt
      const prompt = getCompanySpecificPrompt(wholesaleCompany || '');

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
            maxOutputTokens: 16384,
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
            maxOutputTokens: 16384,
          },
        });
      }

      const response = result.response;
      const finishReason = response.candidates?.[0]?.finishReason;
      console.log('[V2] Response finishReason:', finishReason);

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('[V2] Response text length:', text.length);
      console.log('[V2] Response text preview:', text.substring(0, 500));

      // Handle MAX_TOKENS - fall back to chunk processing
      if (finishReason === 'MAX_TOKENS' || (!text && extractedText.length > 0)) {
        console.log('[V2] MAX_TOKENS or empty response, trying chunk processing...');

        // Force chunk processing with smaller chunks
        const smallChunks = splitTextIntoChunks(extractedText, 5000);
        console.log(`[V2] Split into ${smallChunks.length} smaller chunks`);

        const chunkItems: InvoiceItem[] = [];
        for (let i = 0; i < smallChunks.length; i++) {
          const chunkResult = await processTextChunk(smallChunks[i], i, smallChunks.length, wholesaleCompany || '');
          chunkItems.push(...chunkResult.items);
          console.log(`[V2] Chunk ${i + 1}/${smallChunks.length}: ${chunkResult.items.length} items`);
        }

        // Deduplicate
        const seen = new Set<string>();
        const uniqueItems = chunkItems.filter(item => {
          const key = `${item.customerName}-${item.itemName}-${item.amount}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const totalAmount = uniqueItems.reduce((sum, item) => sum + (item.amount || 0), 0);
        console.log(`[V2] Chunk fallback complete: ${uniqueItems.length} items, total: ${totalAmount}`);

        if (uniqueItems.length > 0) {
          return {
            success: true,
            items: uniqueItems,
            totalAmount,
            rawText: `Processed via chunk fallback (${smallChunks.length} chunks)`,
            processedWith: 'text-chunked-fallback',
          };
        }

        // If still no items, try multimodal as last resort
        if (!useMultimodal) {
          console.log('[V2] Chunk processing failed, trying multimodal...');
          useMultimodal = true;
          continue;
        }

        // If multimodal also failed with MAX_TOKENS, try splitting PDF into pages
        if (useMultimodal && mimeType === 'application/pdf') {
          console.log('[V2] Multimodal MAX_TOKENS, trying PDF page splitting...');
          try {
            const pdfChunks = await splitPdfIntoChunks(pdfBuffer, 5); // 5 pages per chunk
            const pdfChunkItems: InvoiceItem[] = [];

            for (let i = 0; i < pdfChunks.length; i++) {
              const chunkResult = await processPdfChunkMultimodal(pdfChunks[i], i, pdfChunks.length, wholesaleCompany || '');
              pdfChunkItems.push(...chunkResult.items);
              console.log(`[V2] PDF Chunk ${i + 1}/${pdfChunks.length}: ${chunkResult.items.length} items`);
            }

            // Deduplicate
            const seen = new Set<string>();
            const uniqueItems = pdfChunkItems.filter(item => {
              const key = `${item.customerName}-${item.itemName}-${item.amount}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });

            const totalAmount = uniqueItems.reduce((sum, item) => sum + (item.amount || 0), 0);
            console.log(`[V2] PDF page split complete: ${uniqueItems.length} items, total: ${totalAmount}`);

            if (uniqueItems.length > 0) {
              return {
                success: true,
                items: uniqueItems,
                totalAmount,
                rawText: `Processed via PDF page splitting (${pdfChunks.length} chunks)`,
                processedWith: 'multimodal-chunked',
              };
            }
          } catch (pdfSplitError) {
            console.error('[V2] PDF page splitting failed:', pdfSplitError);
          }
        }

        return {
          success: true,
          items: [],
          totalAmount: 0,
          rawText: '',
          processedWith: 'failed-max-tokens',
        };
      }

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

      // Enable debug logging to diagnose parsing issues
      const items = parseCSVResponse(text, true);
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

// ===== 6. Sync Change Records to Google Sheets =====
// スプレッドシートID（環境変数から取得、デフォルト値あり）
const CHANGE_RECORDS_SPREADSHEET_ID = process.env.CHANGE_RECORDS_SPREADSHEET_ID || '1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU';
const CHANGE_RECORDS_SHEET_NAME = 'シート1';

// 利用者変更情報の型定義
interface ChangeRecordForExport {
  recordDate: string;
  aozoraId: string;
  clientName: string;
  facilityName: string;
  infoType: string;
  usageCategory: string;
  billingStartDateNew: string;
  billingStopDateHospital: string;
  billingStartDateDischarge: string;
  billingStopDateCancel: string;
  dataLinkDate: string;
  wholesalerStopContactStatus: string;
  wholesalerResumeContactStatus: string;
  recorder: string;
  office: string;
  note: string;
}

// データ連携日を情報種別に応じて取得
function getDataLinkageDate(record: {
  infoType?: string;
  billingStartDateNew?: string;
  billingStopDateHospital?: string;
  billingStartDateDischarge?: string;
  billingStopDateCancel?: string;
  recordDate?: string;
}): string {
  switch (record.infoType) {
    case '新規':
      return record.billingStartDateNew || '';
    case '入院（サービス停止）':
      return record.billingStopDateHospital || '';
    case '退院（サービス開始）':
      return record.billingStartDateDischarge || '';
    case '解約':
      return record.billingStopDateCancel || '';
    default:
      return record.recordDate || '';
  }
}

export const syncChangeRecordsToSheets = onCall(functionOptions, async (request) => {
  console.log('[syncChangeRecordsToSheets] Starting sync...');

  try {
    // Firestoreからデータを取得
    const db = admin.firestore();

    // 1. clients.jsonのベースデータをFirestoreから取得
    // Note: 本番ではclients.jsonはCloud Storageまたは別の場所から取得する可能性あり
    // ここではFirestoreのclientEditsコレクションのみを使用

    // 2. clientEditsコレクションから全データを取得
    const editsSnapshot = await db.collection('clientEdits').get();
    console.log(`[syncChangeRecordsToSheets] Found ${editsSnapshot.size} client edits in Firestore`);

    // 変更情報を抽出
    const allChangeRecords: ChangeRecordForExport[] = [];

    editsSnapshot.forEach((docSnap) => {
      const data = docSnap.data();

      // 福祉用具利用者でない場合はスキップ
      if (!data.isWelfareEquipmentUser) {
        return;
      }

      const aozoraId = data.aozoraId || docSnap.id;
      const changeRecords = data.changeRecords || [];

      changeRecords.forEach((record: {
        infoType?: string;
        recordDate?: string;
        usageCategory?: string;
        billingStartDateNew?: string;
        billingStopDateHospital?: string;
        billingStartDateDischarge?: string;
        billingStopDateCancel?: string;
        wholesalerStopContactStatus?: string;
        wholesalerResumeContactStatus?: string;
        recorder?: string;
        office?: string;
        note?: string;
      }) => {
        const dataLinkDate = getDataLinkageDate(record);

        allChangeRecords.push({
          recordDate: record.recordDate || '',
          aozoraId: aozoraId,
          clientName: '', // clients.jsonから取得する必要あり（後で対応）
          facilityName: '',
          infoType: record.infoType || '',
          usageCategory: record.usageCategory || '',
          billingStartDateNew: record.billingStartDateNew || '',
          billingStopDateHospital: record.billingStopDateHospital || '',
          billingStartDateDischarge: record.billingStartDateDischarge || '',
          billingStopDateCancel: record.billingStopDateCancel || '',
          dataLinkDate: dataLinkDate,
          wholesalerStopContactStatus: record.wholesalerStopContactStatus || '',
          wholesalerResumeContactStatus: record.wholesalerResumeContactStatus || '',
          recorder: record.recorder || '',
          office: record.office || '',
          note: record.note || '',
        });
      });
    });

    console.log(`[syncChangeRecordsToSheets] Extracted ${allChangeRecords.length} change records`);

    if (allChangeRecords.length === 0) {
      return {
        success: true,
        count: 0,
        message: 'エクスポートする変更情報がありません'
      };
    }

    // データ連携日の昇順でソート（古い順）
    allChangeRecords.sort((a, b) => {
      if (!a.dataLinkDate) return 1;
      if (!b.dataLinkDate) return -1;
      return a.dataLinkDate.localeCompare(b.dataLinkDate);
    });

    // Google Sheets APIの認証（Application Default Credentials使用）
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth: auth as unknown as sheets_v4.Options['auth'] });

    // ヘッダー行
    const headers = [
      '入力日',
      'あおぞらID',
      '利用者名',
      '施設名',
      '情報種別',
      '利用区分',
      '請求開始日（新規）',
      '請求停止日（入院）',
      '請求開始日（退院）',
      '請求停止日（解約）',
      'データ連携日',
      '卸会社停止連絡',
      '卸会社再開連絡',
      '記録者',
      '事業所',
      '特記'
    ];

    // データ行を準備
    const rows = allChangeRecords.map(record => [
      record.recordDate,
      record.aozoraId,
      record.clientName,
      record.facilityName,
      record.infoType,
      record.usageCategory,
      record.billingStartDateNew,
      record.billingStopDateHospital,
      record.billingStartDateDischarge,
      record.billingStopDateCancel,
      record.dataLinkDate,
      record.wholesalerStopContactStatus,
      record.wholesalerResumeContactStatus,
      record.recorder,
      record.office,
      record.note
    ]);

    // ヘッダーとデータを結合
    const values = [headers, ...rows];

    // スプレッドシートの既存データをクリア
    await sheets.spreadsheets.values.clear({
      spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
      range: `${CHANGE_RECORDS_SHEET_NAME}!A1:Z`,
    });

    console.log('[syncChangeRecordsToSheets] Cleared existing data');

    // 新しいデータを書き込む
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
      range: `${CHANGE_RECORDS_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: values
      }
    });

    console.log(`[syncChangeRecordsToSheets] Wrote ${response.data.updatedRows} rows`);

    // ヘッダー行のフォーマット設定
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.2,
                    green: 0.5,
                    blue: 0.8
                  },
                  textFormat: {
                    foregroundColor: {
                      red: 1.0,
                      green: 1.0,
                      blue: 1.0
                    },
                    fontSize: 11,
                    bold: true
                  },
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: headers.length
              }
            }
          }
        ]
      }
    });

    console.log('[syncChangeRecordsToSheets] Formatted header row');

    return {
      success: true,
      count: allChangeRecords.length,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${CHANGE_RECORDS_SPREADSHEET_ID}/edit`,
      message: `${allChangeRecords.length}件の変更情報をスプレッドシートに同期しました`
    };

  } catch (error) {
    console.error('[syncChangeRecordsToSheets] Error:', error);
    throw new HttpsError('internal', `スプレッドシート同期に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
});
