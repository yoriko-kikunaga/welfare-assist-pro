// Updated: 2026-04-16 - Fix 野口 OCR prompt (remove hardcoded example values)
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';
import { PDFDocument } from 'pdf-lib';
import { google, sheets_v4 } from 'googleapis';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode');

// Initialize Firebase Admin
admin.initializeApp();

// Set global options - Tokyo region
setGlobalOptions({
  region: 'asia-northeast1',
  maxInstances: 10,
  timeoutSeconds: 540,  // 9 minutes timeout for large PDFs (100+ pages)
  memory: '2GiB',       // More memory for large PDF processing
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
  timeoutSeconds: 540,  // 9 minutes for large PDFs
  memory: '2GiB' as const,
};

// ===== 1. Generate Meeting Summary =====
export const generateMeetingSummary = onCall(functionOptions, async (request) => {
  const { roughNotes, clientName, clientCondition } = request.data;

  if (!roughNotes) {
    throw new HttpsError('invalid-argument', 'roughNotes is required');
  }

  try {
    // 担当者会議・カンファレンス系か訪問系かで出力フォーマットを切り替え
    const isMeetingType = ['カンファレンス時', '担当者会議（新規）', '担当者会議（更新）', '担当者会議（退院時）']
      .includes(clientCondition || '');

    const outputFormat = isMeetingType ? `
【会議目的】
【出席者・所属】
【利用者の現状】
【協議内容】
【決定事項】
【今後の対応・役割分担】
【次回予定】
【特記事項】
` : `
【訪問日時】
【訪問目的】
【利用者の状態】
【確認事項】
【対応内容】
【今後の予定】
【特記事項】
`;

    const prompt = `
あなたは福祉用具専門相談員です。以下のメモを元に、正式な${isMeetingType ? '担当者会議・カンファレンス' : '訪問'}議事録を生成してください。

## 利用者情報
- 氏名: ${clientName || '不明'}
- 会議種別: ${clientCondition || '不明'}

## メモ・粗書き
${roughNotes}

## 出力フォーマット（以下の形式で出力）
${outputFormat}
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
        maxOutputTokens: 32768,
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

// Helper: Split PDF into individual pages for strategic processing
async function splitPdfToPages(pdfBuffer: Buffer): Promise<{ pages: string[]; totalPages: number }> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = pdfDoc.getPageCount();
  const pages: string[] = [];

  for (let i = 0; i < totalPages; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
    newPdf.addPage(copiedPage);
    const pdfBytes = await newPdf.save();
    pages.push(Buffer.from(pdfBytes).toString('base64'));
  }

  console.log(`[splitPdfToPages] Split PDF into ${totalPages} individual pages`);
  return { pages, totalPages };
}

// Helper: Process a single PDF page with customer name carryover support
async function processSinglePage(
  pageBase64: string,
  pageIndex: number,
  totalPages: number,
  wholesaleCompany: string,
  lastCustomerName: string
): Promise<{ items: InvoiceItem[]; lastCustomerName: string; hasResponse: boolean; invoiceTotal: number | null }> {
  // Enhanced prompt for page-by-page processing with customer name carryover
  const basePrompt = getCompanySpecificPrompt(wholesaleCompany);
  const carryoverInstruction = lastCustomerName
    ? `\n\n【重要】前ページから継続: 利用者名が空欄の場合は「${lastCustomerName}」を使用してください。`
    : '';

  const prompt = `${basePrompt}${carryoverInstruction}\n\n【ページ ${pageIndex + 1}/${totalPages}】`;

  try {
    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: pageBase64,
            },
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32768,
      },
    });

    const response = result.response;
    const finishReason = response.candidates?.[0]?.finishReason;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

    console.log(`[processSinglePage] Page ${pageIndex + 1}/${totalPages}: ${text.length} chars, finishReason: ${finishReason}`);

    if (text) {
      const preview = text.split('\n').slice(0, 3).join(' | ');
      console.log(`[processSinglePage] Page ${pageIndex + 1} preview: ${preview}`);
    }

    const parseResult = parseCSVResponseWithTotal(text, pageIndex === 0);
    const items = parseResult.items;
    const invoiceTotal = parseResult.invoiceTotal;

    // Track last customer name for carryover
    let newLastCustomerName = lastCustomerName;
    if (items.length > 0) {
      const lastItem = items[items.length - 1];
      if (lastItem.customerName) {
        newLastCustomerName = lastItem.customerName;
      }
    }

    // Fill in empty customer names with carryover
    let currentCustomer = lastCustomerName;
    for (const item of items) {
      if (!item.customerName && currentCustomer) {
        item.customerName = currentCustomer;
      } else if (item.customerName) {
        currentCustomer = item.customerName;
      }
    }

    console.log(`[processSinglePage] Page ${pageIndex + 1} parsed: ${items.length} items, lastCustomer: ${newLastCustomerName}, invoiceTotal: ${invoiceTotal}`);

    return { items, lastCustomerName: newLastCustomerName, hasResponse: text.length > 0, invoiceTotal };
  } catch (error) {
    console.error(`[processSinglePage] Page ${pageIndex + 1} processing failed:`, error);
    return { items: [], lastCustomerName, hasResponse: false, invoiceTotal: null };
  }
}

// Page statistics for detailed analysis
interface PageStats {
  pageNumber: number;
  itemCount: number;
  pageTotal: number;
}

// Potential missing/duplicate item
interface SuspiciousItem {
  customerName: string;
  itemName: string;
  amount: number;
  reason: string;  // "差額に近い金額" | "重複の可能性" | "利用者名なし"
}

// Verification result interface with detailed analysis
interface VerificationResult {
  invoiceTotal: number | null;      // 請求書記載の合計金額
  calculatedTotal: number;          // 明細から計算した合計
  difference: number;               // 差額
  isMatched: boolean;               // 一致しているか
  discrepancyReason: string | null; // 不一致の理由
  pageStats?: PageStats[];          // ページごとの統計
  suspiciousItems?: SuspiciousItem[]; // 疑わしい明細
  analysisDetails?: string[];       // 詳細分析メッセージ
}

// Helper: Process PDF pages in parallel batches with customer name carryover
async function processPagesBatch(
  pages: string[],
  wholesaleCompany: string,
  batchSize: number = 5
): Promise<{ items: InvoiceItem[]; verification: VerificationResult }> {
  const allItems: InvoiceItem[] = [];
  const pageStats: PageStats[] = [];
  let lastCustomerName = '';
  let foundInvoiceTotal: number | null = null;
  const totalPages = pages.length;
  const totalBatches = Math.ceil(totalPages / batchSize);

  console.log(`[processPagesBatch] Processing ${totalPages} pages in ${totalBatches} batches of ${batchSize}`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const startIdx = batchIndex * batchSize;
    const endIdx = Math.min(startIdx + batchSize, totalPages);
    const batchPages = pages.slice(startIdx, endIdx);

    console.log(`[processPagesBatch] Batch ${batchIndex + 1}/${totalBatches}: pages ${startIdx + 1}-${endIdx}`);

    // Process pages in this batch in parallel
    const batchPromises = batchPages.map((pageBase64, idx) =>
      processSinglePage(
        pageBase64,
        startIdx + idx,
        totalPages,
        wholesaleCompany,
        // For first page in batch, use carryover from previous batch
        idx === 0 ? lastCustomerName : ''
      )
    );

    const batchResults = await Promise.all(batchPromises);

    // Collect items and update lastCustomerName sequentially within batch
    for (let i = 0; i < batchResults.length; i++) {
      const result = batchResults[i];
      const pageNumber = startIdx + i + 1;

      // Calculate page statistics before carryover
      const pageTotal = result.items.reduce((sum, item) => sum + (item.amount || 0), 0);
      pageStats.push({
        pageNumber,
        itemCount: result.items.length,
        pageTotal,
      });

      // Apply carryover within batch (pages processed in parallel but results processed sequentially)
      for (const item of result.items) {
        if (!item.customerName && lastCustomerName) {
          item.customerName = lastCustomerName;
        } else if (item.customerName) {
          lastCustomerName = item.customerName;
        }
      }

      allItems.push(...result.items);

      // Update lastCustomerName for next batch
      if (result.lastCustomerName) {
        lastCustomerName = result.lastCustomerName;
      }

      // Capture invoice total (usually on last page)
      if (result.invoiceTotal !== null) {
        foundInvoiceTotal = result.invoiceTotal;
        console.log(`[processPagesBatch] Found INVOICE_TOTAL on page ${pageNumber}: ${foundInvoiceTotal}`);
      }
    }

    console.log(`[processPagesBatch] Batch ${batchIndex + 1} complete: ${allItems.length} total items so far`);
  }

  // Calculate total from items
  const calculatedTotal = allItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  const difference = foundInvoiceTotal !== null ? foundInvoiceTotal - calculatedTotal : 0;
  const isMatched = foundInvoiceTotal === null || Math.abs(difference) < 10; // Allow small rounding differences

  // Detailed analysis
  const suspiciousItems: SuspiciousItem[] = [];
  const analysisDetails: string[] = [];
  let discrepancyReason: string | null = null;

  if (!isMatched && foundInvoiceTotal !== null) {
    const absDiff = Math.abs(difference);

    // 1. Look for items with amount close to the difference (within 10%)
    const tolerance = absDiff * 0.1;
    const closeAmountItems = allItems.filter(item =>
      Math.abs(item.amount - absDiff) <= tolerance
    );
    if (closeAmountItems.length > 0) {
      closeAmountItems.forEach(item => {
        suspiciousItems.push({
          customerName: item.customerName,
          itemName: item.itemName,
          amount: item.amount,
          reason: `差額(${absDiff.toLocaleString()}円)に近い金額`,
        });
      });
      analysisDetails.push(`差額に近い金額の明細が${closeAmountItems.length}件見つかりました`);
    }

    // 2. Look for duplicate items (same customer + item + amount)
    const itemCounts = new Map<string, { count: number; item: InvoiceItem }>();
    allItems.forEach(item => {
      const key = `${item.customerName}-${item.itemName}-${item.amount}`;
      const existing = itemCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        itemCounts.set(key, { count: 1, item });
      }
    });
    const duplicates = Array.from(itemCounts.values()).filter(v => v.count > 1);
    if (duplicates.length > 0) {
      duplicates.forEach(({ count, item }) => {
        suspiciousItems.push({
          customerName: item.customerName,
          itemName: item.itemName,
          amount: item.amount,
          reason: `${count}回重複（合計${(item.amount * count).toLocaleString()}円）`,
        });
      });
      const duplicateTotal = duplicates.reduce((sum, d) => sum + d.item.amount * (d.count - 1), 0);
      analysisDetails.push(`重複の可能性: ${duplicates.length}件（重複分合計: ${duplicateTotal.toLocaleString()}円）`);
    }

    // 3. Look for items without customer name
    const noNameItems = allItems.filter(item => !item.customerName || item.customerName.trim() === '');
    if (noNameItems.length > 0) {
      noNameItems.forEach(item => {
        suspiciousItems.push({
          customerName: '(空欄)',
          itemName: item.itemName,
          amount: item.amount,
          reason: '利用者名が空欄',
        });
      });
      analysisDetails.push(`利用者名が空欄の明細: ${noNameItems.length}件`);
    }

    // 4. Page analysis - find pages with 0 items or unusually low totals
    const avgItemsPerPage = allItems.length / totalPages;
    const lowItemPages = pageStats.filter(p => p.itemCount < avgItemsPerPage * 0.3 && p.itemCount > 0);
    const zeroItemPages = pageStats.filter(p => p.itemCount === 0);

    if (zeroItemPages.length > 0) {
      analysisDetails.push(`抽出0件のページ: ${zeroItemPages.map(p => `p.${p.pageNumber}`).join(', ')}`);
    }
    if (lowItemPages.length > 0) {
      analysisDetails.push(`抽出件数が少ないページ: ${lowItemPages.map(p => `p.${p.pageNumber}(${p.itemCount}件)`).join(', ')}`);
    }

    // 5. Check if difference could be combination of small amounts
    if (difference > 0) {
      const smallItems = allItems.filter(item => item.amount <= 5000).slice(0, 5);
      if (smallItems.length > 0) {
        analysisDetails.push(`5,000円以下の小額明細: ${smallItems.length}件（抜け漏れ確認推奨）`);
      }
    }

    // Build main reason message
    if (difference > 0) {
      discrepancyReason = `請求書合計が${difference.toLocaleString()}円多い → 抽出漏れの可能性`;
    } else {
      discrepancyReason = `OCR結果が${absDiff.toLocaleString()}円多い → 重複抽出の可能性`;
    }

    console.log(`[processPagesBatch] VERIFICATION FAILED: invoiceTotal=${foundInvoiceTotal}, calculated=${calculatedTotal}, diff=${difference}`);
    console.log(`[processPagesBatch] Analysis: ${analysisDetails.join(' | ')}`);
    console.log(`[processPagesBatch] Suspicious items: ${JSON.stringify(suspiciousItems.slice(0, 5))}`);
  } else if (foundInvoiceTotal !== null) {
    console.log(`[processPagesBatch] VERIFICATION PASSED: invoiceTotal=${foundInvoiceTotal}, calculated=${calculatedTotal}`);
  } else {
    analysisDetails.push('請求書の合計金額が検出できませんでした。最終ページに合計行があるか確認してください。');
  }

  // Log page statistics
  console.log(`[processPagesBatch] Page stats: ${pageStats.map(p => `p${p.pageNumber}:${p.itemCount}件/${p.pageTotal.toLocaleString()}円`).join(', ')}`);

  const verification: VerificationResult = {
    invoiceTotal: foundInvoiceTotal,
    calculatedTotal,
    difference,
    isMatched,
    discrepancyReason,
    pageStats,
    suspiciousItems: suspiciousItems.slice(0, 10), // Limit to 10 items
    analysisDetails,
  };

  return { items: allItems, verification };
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

// Helper: Parse CSV response with invoice total extraction
interface ParseResult {
  items: InvoiceItem[];
  invoiceTotal: number | null;  // 請求書記載の合計金額
}

function parseCSVResponse(csvText: string, debug: boolean = false): InvoiceItem[] {
  const result = parseCSVResponseWithTotal(csvText, debug);
  return result.items;
}

function parseCSVResponseWithTotal(csvText: string, debug: boolean = false): ParseResult {
  const items: InvoiceItem[] = [];
  let invoiceTotal: number | null = null;

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

    // Check for INVOICE_TOTAL line
    if (trimmed.startsWith('INVOICE_TOTAL:') || trimmed.startsWith('INVOICE_TOTAL：')) {
      const totalStr = trimmed.replace(/INVOICE_TOTAL[：:]/i, '').trim().replace(/[^0-9]/g, '');
      const total = parseInt(totalStr, 10);
      if (total > 0) {
        invoiceTotal = total;
        if (debug) console.log(`[parseCSV] Found INVOICE_TOTAL: ${invoiceTotal}`);
      }
      continue;
    }

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
    console.log(`[parseCSV] Result: ${items.length} items parsed, ${skippedCount} lines skipped, invoiceTotal: ${invoiceTotal}`);
  }

  return { items, invoiceTotal };
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
5. 【最後の行】請求書に記載の合計金額を「INVOICE_TOTAL:金額」形式で出力

正しい出力例:
山田太郎,車いす,3800
佐藤花子,ベッド,2800
INVOICE_TOTAL:6600

間違った出力例（禁止）:
以下が抽出結果です：
\`\`\`csv
山田太郎,車いす,3800
\`\`\`

抽出ルール:
- 利用者名: 個人名のみ（「様」「殿」は除去、スペースは除去）
- 商品名: 簡潔に（型番不要）
- 金額: 数字のみ（カンマや円記号は除去、0以下はスキップ）
- 合計行・小計行は明細としてはスキップ（ただしINVOICE_TOTALとして最後に出力）
- INVOICE_TOTAL: 請求書に記載されている「合計」「総計」「請求金額」などの最終合計金額`;

  if (wholesaleCompany.includes('野口')) {
    return `${csvInstruction}

野口株式会社の請求書フォーマット:
- 明細行は「継続」または「新規」で始まる行のみです。それ以外の行は全て無視してください
- 利用者名は【】括弧内の個人名です（例:【池田救仁敬】→ 池田救仁敬）
- 【株式会社ＡＣＧ】はスキップ（会社名であり利用者ではない）
- 同じ利用者の複数商品は、それぞれ別の行として出力してください
- 商品名は「継続」「新規」の直後のテキストです
- 金額は各明細行の「購入金額」列の値です
- 金額が0の明細行はスキップしてください
- 絶対にスキップすべき行: 「伝票計」「利用者様 計」「お客様 計」「購入金額 計」「初回契約日」「入金」
- INVOICE_TOTAL: 請求書ヘッダー部分の「今月売上額」の数値（税抜き金額）

【重要】以下の出力フォーマットに従い、必ず実際の請求書PDFから読み取った値を出力すること。数値は絶対にこの例をそのまま使用しないこと:
利用者名A,商品名X,金額1
利用者名A,商品名Y,金額2
利用者名B,商品名Z,金額3
INVOICE_TOTAL:実際の今月売上額`;
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
- 金額は必ず「本体価格」列の数値を使用してください（税抜き金額）
- 注意: 「ご請求額」列は税込金額なので使用しないでください。必ず「本体価格」列を使ってください
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
        maxOutputTokens: 32768,
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

      // STRATEGIC PAGE-BY-PAGE PROCESSING: For large PDFs (10+ pages), use page-by-page processing
      // This ensures reliable extraction for large documents like Paramount invoices
      const LARGE_PDF_THRESHOLD = 10;
      if (numPages >= LARGE_PDF_THRESHOLD) {
        console.log(`[V2] Large PDF detected (${numPages} pages >= ${LARGE_PDF_THRESHOLD}), using strategic page-by-page processing...`);

        try {
          const { pages, totalPages } = await splitPdfToPages(pdfBuffer);
          console.log(`[V2] Split into ${totalPages} individual pages for strategic processing`);

          // Process pages in batches with customer name carryover and verification
          const { items: allItems, verification } = await processPagesBatch(pages, wholesaleCompany || '', 5);

          // Deduplicate items
          const seen = new Set<string>();
          const uniqueItems = allItems.filter(item => {
            const key = `${item.customerName}-${item.itemName}-${item.amount}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          const totalAmount = uniqueItems.reduce((sum, item) => sum + (item.amount || 0), 0);

          // Update verification with deduplicated total
          const finalVerification = {
            ...verification,
            calculatedTotal: totalAmount,
            difference: verification.invoiceTotal !== null ? verification.invoiceTotal - totalAmount : 0,
            isMatched: verification.invoiceTotal === null || Math.abs((verification.invoiceTotal || 0) - totalAmount) < 10,
          };

          if (!finalVerification.isMatched && finalVerification.invoiceTotal !== null) {
            finalVerification.discrepancyReason = finalVerification.difference > 0
              ? `請求書合計が${finalVerification.difference.toLocaleString()}円多い（抽出漏れの可能性）。確認: 利用者名が空欄の行、ページ境界の明細、小さい金額の行`
              : `OCR結果が${Math.abs(finalVerification.difference).toLocaleString()}円多い（重複抽出の可能性）。確認: 同一明細の複数抽出、小計行の誤抽出`;
          }

          console.log(`[V2] Strategic page processing complete: ${uniqueItems.length} unique items (from ${allItems.length}), total: ${totalAmount}`);
          console.log(`[V2] Verification: invoiceTotal=${finalVerification.invoiceTotal}, calculated=${finalVerification.calculatedTotal}, matched=${finalVerification.isMatched}`);

          return {
            success: true,
            items: uniqueItems,
            totalAmount,
            rawText: `Strategic page-by-page processing: ${totalPages} pages`,
            processedWith: 'multimodal-page-by-page',
            verification: finalVerification,
          };
        } catch (pageSplitError) {
          console.error('[V2] Strategic page processing failed, falling back to standard processing:', pageSplitError);
          // Continue with standard processing below
        }
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
            maxOutputTokens: 32768,
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
            maxOutputTokens: 32768,
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
// 出力対象の開始日（この日付以降の recordDate のみ出力）
const CHANGE_RECORDS_START_DATE = '2026-02-01';

// 利用者変更情報の型定義
interface ChangeRecordForExport {
  recordId: string;
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
  demoStartDate: string;
  demoEndDate: string;
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
  demoStartDate?: string;
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
    case 'デモ':
      return record.demoStartDate || '';
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
        id?: string;
        infoType?: string;
        recordDate?: string;
        usageCategory?: string;
        billingStartDateNew?: string;
        billingStopDateHospital?: string;
        billingStartDateDischarge?: string;
        billingStopDateCancel?: string;
        demoStartDate?: string;
        demoEndDate?: string;
        wholesalerStopContactStatus?: string;
        wholesalerResumeContactStatus?: string;
        recorder?: string;
        office?: string;
        note?: string;
      }) => {
        // 開始日フィルター：recordDate が CHANGE_RECORDS_START_DATE 未満はスキップ
        if ((record.recordDate || '') < CHANGE_RECORDS_START_DATE) {
          return;
        }

        // 退院日が 9999-12-31（仮退院日）の場合はスキップ
        if (record.billingStartDateDischarge === '9999-12-31') {
          return;
        }

        const dataLinkDate = getDataLinkageDate(record);

        allChangeRecords.push({
          recordId: record.id || `${aozoraId}-${record.recordDate}-${record.infoType}`,
          recordDate: record.recordDate || '',
          aozoraId: aozoraId,
          clientName: data.clientName || '',
          facilityName: data.facilityName || '',
          infoType: record.infoType || '',
          usageCategory: record.usageCategory || '',
          billingStartDateNew: record.billingStartDateNew || '',
          billingStopDateHospital: record.billingStopDateHospital || '',
          billingStartDateDischarge: record.billingStartDateDischarge || '',
          billingStopDateCancel: record.billingStopDateCancel || '',
          demoStartDate: record.demoStartDate || '',
          demoEndDate: record.demoEndDate || '',
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

    // ヘッダー行（レコードIDを先頭に追加）
    const headers = [
      'レコードID',
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
      'デモ開始日',
      'デモ終了日',
      'データ連携日',
      '卸会社停止連絡',
      '卸会社再開連絡',
      '記録者',
      '事業所',
      '特記'
    ];

    // データ行を準備（recordId を先頭に）
    const toRow = (record: ChangeRecordForExport) => [
      record.recordId,
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
      record.demoStartDate,
      record.demoEndDate,
      record.dataLinkDate,
      record.wholesalerStopContactStatus,
      record.wholesalerResumeContactStatus,
      record.recorder,
      record.office,
      record.note
    ];

    // ---- 追記モード ----
    // 1. 既存シートの A 列（レコードID）を取得して書き込み済みIDのセットを作成
    const existingSheet = await sheets.spreadsheets.values.get({
      spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
      range: `${CHANGE_RECORDS_SHEET_NAME}!A:A`,
    });
    const existingValues = existingSheet.data.values || [];
    const isFirstSync = existingValues.length === 0;

    // 先頭行はヘッダーのためスキップ
    const existingIds = new Set(
      existingValues.slice(1).map((row: string[]) => row[0]).filter(Boolean)
    );
    console.log(`[syncChangeRecordsToSheets] Existing rows: ${existingIds.size}`);

    // 1b. 「除外リスト」シートのレコードIDを取得（シートがなければ自動作成）
    const EXCLUSION_SHEET_NAME = '除外リスト';
    let excludedIds = new Set<string>();
    try {
      const spreadsheetMeta = await sheets.spreadsheets.get({
        spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
      });
      const sheetNames = (spreadsheetMeta.data.sheets || []).map(
        (s: sheets_v4.Schema$Sheet) => s.properties?.title
      );
      if (!sheetNames.includes(EXCLUSION_SHEET_NAME)) {
        // シートが存在しない場合は作成してヘッダーを書き込む
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
          requestBody: {
            requests: [{ addSheet: { properties: { title: EXCLUSION_SHEET_NAME } } }]
          }
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
          range: `${EXCLUSION_SHEET_NAME}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [['レコードID（除外）']] }
        });
        console.log(`[syncChangeRecordsToSheets] Created exclusion sheet: ${EXCLUSION_SHEET_NAME}`);
      } else {
        // シートが存在する場合はA列を読み込んで除外IDセットを作成
        const exclusionSheet = await sheets.spreadsheets.values.get({
          spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
          range: `${EXCLUSION_SHEET_NAME}!A:A`,
        });
        const exclusionValues = exclusionSheet.data.values || [];
        excludedIds = new Set(
          exclusionValues.slice(1).map((row: string[]) => row[0]).filter(Boolean)
        );
        console.log(`[syncChangeRecordsToSheets] Excluded IDs: ${excludedIds.size}`);
      }
    } catch (exclusionError) {
      console.warn('[syncChangeRecordsToSheets] Could not process exclusion sheet:', exclusionError);
    }

    // 2. 未書き込み かつ 除外リストにないレコードのみ抽出
    const newRecords = allChangeRecords.filter(
      r => !existingIds.has(r.recordId) && !excludedIds.has(r.recordId)
    );
    console.log(`[syncChangeRecordsToSheets] New records to append: ${newRecords.length}`);

    if (isFirstSync) {
      // 初回: ヘッダー + 全レコードを書き込む
      await sheets.spreadsheets.values.update({
        spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
        range: `${CHANGE_RECORDS_SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers, ...newRecords.map(toRow)] }
      });
      console.log('[syncChangeRecordsToSheets] First sync: wrote header + all records');

      // ヘッダー行のフォーマット設定（初回のみ）
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.2, green: 0.5, blue: 0.8 },
                    textFormat: {
                      foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
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

    } else if (newRecords.length > 0) {
      // 2回目以降: 新規レコードのみ末尾に追記
      await sheets.spreadsheets.values.append({
        spreadsheetId: CHANGE_RECORDS_SPREADSHEET_ID,
        range: `${CHANGE_RECORDS_SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newRecords.map(toRow) }
      });
      console.log(`[syncChangeRecordsToSheets] Appended ${newRecords.length} new rows`);
    } else {
      console.log('[syncChangeRecordsToSheets] No new records to append');
    }

    const addedCount = newRecords.length;
    const excludedCount = allChangeRecords.filter(r => excludedIds.has(r.recordId)).length;
    const skippedCount = allChangeRecords.length - addedCount - excludedCount;

    return {
      success: true,
      count: addedCount,
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${CHANGE_RECORDS_SPREADSHEET_ID}/edit`,
      message: addedCount > 0
        ? `${addedCount}件を追記しました（既存スキップ: ${skippedCount}件、除外リスト: ${excludedCount}件）`
        : `新規レコードなし（既存: ${skippedCount}件、除外リスト: ${excludedCount}件）`
    };

  } catch (error) {
    console.error('[syncChangeRecordsToSheets] Error:', error);
    throw new HttpsError('internal', `スプレッドシート同期に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// ===== 7. Fetch Google Docs Content =====
export const fetchGoogleDocContent = onCall(functionOptions, async (request) => {
  const { docId } = request.data;

  if (!docId) {
    throw new HttpsError('invalid-argument', 'docId is required');
  }

  try {
    const auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/documents.readonly']
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docs = google.docs({ version: 'v1', auth: auth as any });
    const doc = await docs.documents.get({ documentId: docId });

    // ドキュメント本文をプレーンテキストに変換
    const content = doc.data.body?.content || [];
    const textParts: string[] = [];

    for (const element of content) {
      if (element.paragraph) {
        const paraText = (element.paragraph.elements || [])
          .map((el) => el.textRun?.content ?? '')
          .join('');
        if (paraText.trim()) {
          textParts.push(paraText);
        }
      }
    }

    const text = textParts.join('');
    console.log(`[fetchGoogleDocContent] Extracted ${text.length} chars from docId: ${docId}`);

    return { success: true, text };
  } catch (error) {
    console.error('[fetchGoogleDocContent] Error:', error);
    throw new HttpsError('internal', `ドキュメントの取得に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// ===== 8. Extract Meeting Notes from File (PDF/txt) =====
export const extractMeetingNotes = onCall(functionOptions, async (request) => {
  const { fileBase64, mimeType } = request.data;

  if (!fileBase64 || !mimeType) {
    throw new HttpsError('invalid-argument', 'fileBase64 and mimeType are required');
  }

  try {
    const prompt = `
このファイルはGoogle Meetや会議で行ったメモまたは議事録です。
テキストをそのまま抽出して返してください。
整形や要約は不要です。元のテキストをできるだけ忠実に再現してください。
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
    console.log(`[extractMeetingNotes] Extracted ${text.length} chars`);

    return { success: true, text };
  } catch (error) {
    console.error('[extractMeetingNotes] Error:', error);
    throw new HttpsError('internal', `ファイルの読み取りに失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
});

// ===== 11. Generate Equipment QR Code =====
export const generateEquipmentQR = onCall(functionOptions, async (request) => {
  const { equipmentId, equipmentCode } = request.data;

  if (!equipmentId || !equipmentCode) {
    throw new HttpsError('invalid-argument', 'equipmentId and equipmentCode are required');
  }

  try {
    // Generate QR code as PNG buffer (encodes the UUID)
    const qrBuffer: Buffer = await QRCode.toBuffer(equipmentId, {
      type: 'png',
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M',
    });

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const fileName = `equipment-qr/${equipmentCode}.png`;
    const file = bucket.file(fileName);

    await file.save(qrBuffer, {
      metadata: {
        contentType: 'image/png',
        cacheControl: 'public, max-age=31536000',
      },
    });

    // Make public
    await file.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log(`[generateEquipmentQR] Generated QR for ${equipmentCode}: ${publicUrl}`);

    return { success: true, qrCodeUrl: publicUrl };
  } catch (error) {
    console.error('[generateEquipmentQR] Error:', error);
    throw new HttpsError('internal', `QRコード生成に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
  }
});
