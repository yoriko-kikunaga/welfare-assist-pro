import { httpsCallable } from 'firebase/functions';
import { functions } from '../src/firebaseConfig';
import { Client, WholesaleCompany, ParsedInvoice, InvoiceItem, WHOLESALE_COMPANY_NAMES, MeetingType } from "../types";


// ===== Cloud Functions References =====
// Extended timeout for AI operations (5 minutes)
const extendedTimeout = { timeout: 300000 };


const generateMeetingSummaryFn = httpsCallable(functions, 'generateMeetingSummary', extendedTimeout);
const suggestEquipmentFn = httpsCallable(functions, 'suggestEquipment', extendedTimeout);
const extractMedicalInfoFn = httpsCallable(functions, 'extractMedicalInfo', extendedTimeout);
const parseWholesaleInvoiceFn = httpsCallable(functions, 'parseWholesaleInvoice', extendedTimeout);
// V2: Improved version with PDF text extraction for better efficiency
const parseWholesaleInvoiceV2Fn = httpsCallable(functions, 'parseWholesaleInvoiceV2', extendedTimeout);
// V3: Python pdfplumber for accurate table extraction (machine-generated PDFs)
const parseInvoiceV3Fn = httpsCallable(functions, 'parse_invoice_v3', extendedTimeout);
// Sync change records to Google Sheets
const syncChangeRecordsToSheetsFn = httpsCallable(functions, 'syncChangeRecordsToSheets', extendedTimeout);
// Sync meetings to Google Sheets
const syncMeetingsToSheetsFn = httpsCallable(functions, 'syncMeetingsToSheets', extendedTimeout);
// Google Docs content fetcher
const fetchGoogleDocContentFn = httpsCallable(functions, 'fetchGoogleDocContent', extendedTimeout);
// Meeting notes extractor from file (PDF)
const extractMeetingNotesFn = httpsCallable(functions, 'extractMeetingNotes', extendedTimeout);


// ===== Helper: Convert File to Base64 =====
const fileToBase64 = (file: File): Promise<string> => {
 return new Promise((resolve, reject) => {
   const reader = new FileReader();
   reader.onload = () => {
     const result = reader.result as string;
     // Remove data URL prefix (e.g., "data:application/pdf;base64,")
     const base64 = result.split(',')[1];
     resolve(base64);
   };
   reader.onerror = reject;
   reader.readAsDataURL(file);
 });
};


// ===== Helper: Validate File =====
const validateFile = (file: File): { valid: boolean; error?: string } => {
 const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
 if (!validTypes.includes(file.type)) {
   return { valid: false, error: "対応していないファイル形式です。PDF、PNG、JPG、WEBP形式でアップロードしてください。" };
 }


 const maxSize = 20 * 1024 * 1024; // 20MB
 if (file.size > maxSize) {
   return { valid: false, error: "ファイルサイズが大きすぎます。20MB以下のファイルを選択してください。" };
 }


 return { valid: true };
};


// ===== 1. Generate Formal Minutes from Rough Notes =====
export const generateMeetingSummary = async (
 notes: string,
 type: MeetingType,
 clientName: string
): Promise<string> => {
 try {
   const result = await generateMeetingSummaryFn({
     roughNotes: notes,
     clientName,
     clientCondition: type,
   });


   const data = result.data as { success: boolean; summary?: string };
   if (data.success && data.summary) {
     return data.summary;
   }
   return "生成に失敗しました。";
 } catch (error) {
   console.error("generateMeetingSummary error:", error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return `エラーが発生しました: ${errorMessage}`;
 }
};


// ===== 2. Extract Medical Information from Document (OCR) =====
export const extractMedicalInfoFromDocument = async (
 file: File
): Promise<{ success: boolean; text: string }> => {
 // Validate file
 const validation = validateFile(file);
 if (!validation.valid) {
   return { success: false, text: validation.error! };
 }


 try {
   const base64Data = await fileToBase64(file);


   const result = await extractMedicalInfoFn({
     fileBase64: base64Data,
     mimeType: file.type,
   });


   const data = result.data as { success: boolean; text?: string };
   if (data.success && data.text) {
     return { success: true, text: data.text };
   }
   return { success: false, text: "文書の読み取りに失敗しました。" };
 } catch (error) {
   console.error("extractMedicalInfo error:", error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return { success: false, text: `エラーが発生しました: ${errorMessage}` };
 }
};


// ===== 3. Suggest Equipment based on Medical History =====
export const suggestEquipment = async (client: Client): Promise<string> => {
 try {
   const result = await suggestEquipmentFn({
     medicalHistory: client.medicalHistory,
     currentCondition: client.facilityName,
     careLevel: client.careLevel,
   });


   const data = result.data as { success: boolean; suggestion?: string };
   if (data.success && data.suggestion) {
     return data.suggestion;
   }
   return "提案の生成に失敗しました。";
 } catch (error) {
   console.error("suggestEquipment error:", error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return `エラーが発生しました: ${errorMessage}`;
 }
};


// ===== 4. Parse Wholesale Invoice from PDF (OCR for Reconciliation) =====
// Nikken → V3 (pdfplumber), Others → V2/V1 (Gemini AI OCR)
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
  reason: string;
}

// Verification result from OCR processing
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

export const parseWholesaleInvoice = async (
 file: File,
 wholesaleCompany: WholesaleCompany,
 billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string; processedWith?: string; verification?: VerificationResult }> => {
 // Validate file
 const validation = validateFile(file);
 if (!validation.valid) {
   return { success: false, error: validation.error };
 }


 try {
   const base64Data = await fileToBase64(file);
   const companyName = WHOLESALE_COMPANY_NAMES[wholesaleCompany];


   let result;
   let processedWith = '';


   // Branch based on wholesale company
   // Nikken: Use V3 (pdfplumber) - optimized for their 21-column format
   // Others: Use V2/V1 (Gemini AI OCR) - flexible for various formats
   const useV3Pdfplumber = wholesaleCompany === 'Nikken';


   if (useV3Pdfplumber) {
     // ===== Nikken: V3 pdfplumber only =====
     try {
       console.log('[geminiService] Nikken detected: Using V3 (pdfplumber)...');
       result = await parseInvoiceV3Fn({
         fileBase64: base64Data,
         mimeType: file.type,
         wholesaleCompany: companyName,
         billingMonth,
       });


       const v3Data = result.data as {
         success: boolean;
         items?: Array<unknown>;
         processedWith?: string;
       };


       if (v3Data.success && v3Data.processedWith === 'pdfplumber' && v3Data.items && v3Data.items.length > 0) {
         console.log('[geminiService] V3 (pdfplumber) succeeded for Nikken');
         processedWith = 'v3-pdfplumber';
       } else if (v3Data.processedWith === 'needs-ocr-fallback') {
         // Scanned PDF - fallback to Gemini
         console.log('[geminiService] Nikken scanned PDF detected, falling back to Gemini OCR...');
         result = null;
       } else {
         console.log('[geminiService] V3 returned no items for Nikken, falling back to Gemini OCR...');
         result = null;
       }
     } catch (v3Error) {
       console.warn('[geminiService] V3 failed for Nikken:', v3Error);
       result = null;
     }


     // Fallback to Gemini OCR if V3 failed (e.g., scanned PDF)
     if (!result) {
       try {
         console.log('[geminiService] Nikken fallback: Trying V2 (Gemini OCR)...');
         result = await parseWholesaleInvoiceV2Fn({
           fileBase64: base64Data,
           mimeType: file.type,
           wholesaleCompany: companyName,
           billingMonth,
         });
         processedWith = 'v2-gemini-text';
         console.log('[geminiService] V2 succeeded for Nikken (scanned PDF)');
       } catch (v2Error) {
         console.error('[geminiService] V2 also failed for Nikken:', v2Error);
         throw v2Error;
       }
     }
   } else {
     // ===== Other companies: V2/V1 Gemini AI OCR only =====
     try {
       console.log(`[geminiService] ${companyName}: Using V2 (Gemini OCR)...`);
       result = await parseWholesaleInvoiceV2Fn({
         fileBase64: base64Data,
         mimeType: file.type,
         wholesaleCompany: companyName,
         billingMonth,
       });
       processedWith = 'v2-gemini-text';
       console.log('[geminiService] V2 succeeded');
     } catch (v2Error) {
       console.warn('[geminiService] V2 failed:', v2Error);
       result = null;
     }


     // Fallback to V1 if V2 failed
     if (!result) {
       try {
         console.log('[geminiService] Falling back to V1 (original multimodal OCR)...');
         result = await parseWholesaleInvoiceFn({
           fileBase64: base64Data,
           mimeType: file.type,
           wholesaleCompany: companyName,
           billingMonth,
         });
         processedWith = 'v1-fallback';
         console.log('[geminiService] V1 succeeded');
       } catch (v1Error) {
         console.error('[geminiService] V1 also failed:', v1Error);
         throw v1Error;
       }
     }
   }


   const data = result.data as {
     success: boolean;
     items?: Array<{
       customerName: string;
       itemName: string;
       quantity: number;
       unitPrice: number;
       amount: number;
     }>;
     totalAmount?: number;
     rawText?: string;
     processedWith?: string;
     verification?: VerificationResult;
   };


   if (!data.success || !data.items) {
     return { success: false, error: "請求書の読み取りに失敗しました。" };
   }


   // Convert to InvoiceItem array
   const items: InvoiceItem[] = data.items.map((item, index) => ({
     id: `${wholesaleCompany}-${Date.now()}-${index}`,
     wholesaleCompany,
     customerName: item.customerName || '',
     customerNameNormalized: normalizeJapaneseName(item.customerName || ''),
     itemName: item.itemName || '',
     itemNameNormalized: normalizeJapaneseName(item.itemName || ''),
     quantity: typeof item.quantity === 'number' ? item.quantity : 1,
     unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : 0,
     amount: typeof item.amount === 'number' ? item.amount : 0,
   }));


   const invoice: ParsedInvoice = {
     id: `invoice-${wholesaleCompany}-${Date.now()}`,
     wholesaleCompany,
     fileName: file.name,
     uploadedAt: new Date().toISOString(),
     billingMonth,
     items,
     totalAmount: data.totalAmount || items.reduce((sum, item) => sum + item.amount, 0),
     rawOcrText: data.rawText || '',
   };


   // Use V3's processedWith if available, otherwise use our tracking
   const finalProcessedWith = data.processedWith || processedWith;
   console.log(`[geminiService] Final processedWith: ${finalProcessedWith}`);

   // Log verification result if present
   if (data.verification) {
     console.log(`[geminiService] Verification: invoiceTotal=${data.verification.invoiceTotal}, calculated=${data.verification.calculatedTotal}, matched=${data.verification.isMatched}`);
     if (!data.verification.isMatched && data.verification.discrepancyReason) {
       console.warn(`[geminiService] Verification FAILED: ${data.verification.discrepancyReason}`);
     }
   }

   return { success: true, invoice, processedWith: finalProcessedWith, verification: data.verification };
 } catch (error) {
   console.error("parseWholesaleInvoice error:", error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return { success: false, error: `請求書の読み取り中にエラーが発生しました: ${errorMessage}` };
 }
};


// ===== 4b. Parse Nishiken CSV for Reconciliation =====
// ニシケンCSV: カンマ区切り、cp932/UTF-8、金額はクォート付きカンマ入り
// 主要列: 摘要[28]=利用者名, 商品名[25], 金額[38], 数量[35], 単価[37], 御請求額[50], 使用者かな[60], 合計表示[34]

// CSVパーサー（クォート内カンマ対応）
function parseCSVRow(line: string): string[] {
  const cols: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cols.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current);
  return cols;
}

export const parseNishikenCSV = async (
 file: File,
 billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string; processedWith?: string; verification?: VerificationResult }> => {
 try {
   const buffer = await file.arrayBuffer();

   // エンコーディング自動判定（UTF-8 / Shift-JIS(cp932)）
   let text: string;
   const utf8Decoder = new TextDecoder('utf-8');
   const utf8Text = utf8Decoder.decode(buffer);
   if (utf8Text.includes('摘要') || utf8Text.includes('商品名') || utf8Text.includes('金額')) {
     text = utf8Text;
     console.log('[parseNishikenCSV] UTF-8エンコーディングで読み込み');
   } else {
     const sjisDecoder = new TextDecoder('shift-jis');
     text = sjisDecoder.decode(buffer);
     console.log('[parseNishikenCSV] Shift-JIS(cp932)エンコーディングで読み込み');
   }

   const lines = text.split(/\r?\n/);
   if (lines.length < 2) {
     return { success: false, error: 'CSVファイルが空です。' };
   }

   // ヘッダー行から列インデックスを動的取得（カンマ区切り）
   const headerCols = parseCSVRow(lines[0]);
   const colIndex = {
     tekiyou: headerCols.indexOf('摘要'),
     shouhinmei: headerCols.indexOf('商品名'),
     kingaku: headerCols.indexOf('金額'),
     suuryou: headerCols.indexOf('数量'),
     tanka: headerCols.indexOf('単価'),
     kana: headerCols.indexOf('使用者かな'),
     seikyuugaku: headerCols.indexOf('御請求額'),
     goukeiHyouji: headerCols.indexOf('合計表示'),
     haisouTatekae: headerCols.indexOf('配送立替'),
     hoshouryo: headerCols.indexOf('補償料'),
     horyuuHyouji: headerCols.indexOf('保留表示'),
   };

   if (colIndex.tekiyou === -1 || colIndex.kingaku === -1) {
     return { success: false, error: 'CSVヘッダーに必要な列（摘要、金額）が見つかりません。' };
   }

   const items: InvoiceItem[] = [];
   let invoiceTotal: number | null = null;
   let rentalTotal: number | null = null;
   let salesTotal: number | null = null;

   for (let i = 1; i < lines.length; i++) {
     const line = lines[i].trim();
     if (!line) continue;

     const cols = parseCSVRow(lines[i]);

     // 集計行をスキップ（合計表示列に「合計」を含む行）
     const goukeiHyouji = colIndex.goukeiHyouji !== -1 ? (cols[colIndex.goukeiHyouji] || '').trim() : '';
     if (goukeiHyouji.includes('合計')) {
       const totalStr = (cols[colIndex.kingaku] || '').replace(/[,，\s]/g, '').trim();
       const total = parseInt(totalStr, 10) || 0;
       const haisouTotalStr = colIndex.haisouTatekae !== -1 ? (cols[colIndex.haisouTatekae] || '').replace(/[,，\s]/g, '').trim() : '0';
       const haisouTotal = parseInt(haisouTotalStr, 10) || 0;
       const hoshouryoTotalStr = colIndex.hoshouryo !== -1 ? (cols[colIndex.hoshouryo] || '').replace(/[,，\s]/g, '').trim() : '0';
       const hoshouryoTotal = parseInt(hoshouryoTotalStr, 10) || 0;
       const combinedTotal = total + haisouTotal + hoshouryoTotal;
       if (goukeiHyouji.includes('レンタル合計')) {
         rentalTotal = combinedTotal;
       } else if (goukeiHyouji.includes('販売合計')) {
         salesTotal = combinedTotal;
       }
       continue;
     }

     const customerName = (cols[colIndex.tekiyou] || '').trim();
     const itemName = colIndex.shouhinmei !== -1 ? (cols[colIndex.shouhinmei] || '').trim() : '';
     const amountStr = (cols[colIndex.kingaku] || '').replace(/[,，\s]/g, '').trim();
     const amount = parseInt(amountStr, 10);
     const haisouStr = colIndex.haisouTatekae !== -1 ? (cols[colIndex.haisouTatekae] || '').replace(/[,，\s]/g, '').trim() : '0';
     const haisou = parseInt(haisouStr, 10) || 0;
     const hoshouryoStr = colIndex.hoshouryo !== -1 ? (cols[colIndex.hoshouryo] || '').replace(/[,，\s]/g, '').trim() : '0';
     const hoshouryo = parseInt(hoshouryoStr, 10) || 0;
     const horyuu = colIndex.horyuuHyouji !== -1 ? (cols[colIndex.horyuuHyouji] || '').trim() : '';

     // 御請求額を取得（検証用）
     if (colIndex.seikyuugaku !== -1) {
       const seikyuuStr = (cols[colIndex.seikyuugaku] || '').replace(/[,，\s]/g, '').trim();
       const seikyuu = parseInt(seikyuuStr, 10);
       if (!isNaN(seikyuu) && seikyuu > 0) {
         invoiceTotal = seikyuu;
       }
     }

     // 金額と配送立替・補償料の合算
     const totalAmount = (isNaN(amount) ? 0 : amount) + haisou + hoshouryo;

     // 保留行: 直前の対応する明細と相殺して両方除外
     if (horyuu.includes('保留') && totalAmount < 0) {
       const absAmount = Math.abs(totalAmount);
       const matchIdx = items.findLastIndex(item => item.amount === absAmount);
       if (matchIdx !== -1) {
         console.log(`[parseNishikenCSV] 保留相殺: ${items[matchIdx].customerName} ${items[matchIdx].itemName} (${absAmount.toLocaleString()}円)`);
         items.splice(matchIdx, 1);
       }
       continue;
     }

     // 金額も配送立替も補償料も0の行をスキップ（ヘッダー的な行や空行）
     if (totalAmount === 0) continue;
     // 摘要も商品名も空の行はスキップ
     if (!customerName && !itemName) continue;

     const quantity = colIndex.suuryou !== -1 ? parseInt((cols[colIndex.suuryou] || '1').replace(/[,，\s]/g, ''), 10) || 1 : 1;
     const unitPrice = colIndex.tanka !== -1 ? parseInt((cols[colIndex.tanka] || '0').replace(/[,，\s]/g, ''), 10) || 0 : 0;

     items.push({
       id: `Nishiken-${Date.now()}-${i}`,
       wholesaleCompany: 'Nishiken',
       customerName: customerName || itemName,
       customerNameNormalized: normalizeJapaneseName(customerName || itemName),
       itemName,
       itemNameNormalized: normalizeJapaneseName(itemName),
       quantity,
       unitPrice,
       amount: totalAmount,
     });
   }

   if (items.length === 0) {
     return { success: false, error: 'CSVから有効な明細行が見つかりませんでした。' };
   }

   const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);
   // 検証用合計: 御請求額 > (レンタル合計+販売合計) の優先度で使用
   const subTotals = (rentalTotal ?? 0) + (salesTotal ?? 0);
   const verifyTotal = invoiceTotal ?? (subTotals > 0 ? subTotals : null);

   const invoice: ParsedInvoice = {
     id: `invoice-Nishiken-${Date.now()}`,
     wholesaleCompany: 'Nishiken',
     fileName: file.name,
     uploadedAt: new Date().toISOString(),
     billingMonth,
     items,
     totalAmount: calculatedTotal,
     rawOcrText: '',
   };

   // VerificationResult生成
   const verification: VerificationResult = {
     invoiceTotal: verifyTotal,
     calculatedTotal,
     difference: verifyTotal !== null ? Math.abs(verifyTotal - calculatedTotal) : 0,
     isMatched: verifyTotal === null || Math.abs(verifyTotal - calculatedTotal) <= 1000,
     discrepancyReason: verifyTotal !== null && Math.abs(verifyTotal - calculatedTotal) > 1000
       ? `請求書合計(${verifyTotal.toLocaleString()}円)と明細合計(${calculatedTotal.toLocaleString()}円)に${Math.abs(verifyTotal - calculatedTotal).toLocaleString()}円の差額があります`
       : null,
   };

   console.log(`[parseNishikenCSV] ${items.length}件の明細を読み込み, 合計: ${calculatedTotal.toLocaleString()}円`);
   if (rentalTotal !== null) console.log(`[parseNishikenCSV] レンタル合計: ${rentalTotal.toLocaleString()}円`);
   if (salesTotal !== null) console.log(`[parseNishikenCSV] 販売合計: ${salesTotal.toLocaleString()}円`);
   if (verifyTotal !== null) {
     console.log(`[parseNishikenCSV] 検証用合計: ${verifyTotal.toLocaleString()}円, 差額: ${verification.difference.toLocaleString()}円`);
   }

   return { success: true, invoice, processedWith: 'csv-import', verification };
 } catch (error) {
   console.error('[parseNishikenCSV] error:', error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return { success: false, error: `CSVの読み込み中にエラーが発生しました: ${errorMessage}` };
 }
};


// ===== 4c. Parse Paramount Care CSV for Reconciliation =====
// パラマウントCSV: カンマ区切り、cp932（外字含む）/UTF-8、全フィールドクォート付き
// ヘッダー: 請求先名,得意先名,利用者コード,利用者名,利用者カナ,マーク,区分,伝票No,拠点,商品コード,商品名,型式,開始日,終了日,中断日,再開日,数量,単位,金額,税

export const parseParamountCSV = async (
 file: File,
 billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string; processedWith?: string; verification?: VerificationResult }> => {
 try {
   const buffer = await file.arrayBuffer();

   // エンコーディング自動判定（UTF-8 / Shift-JIS(cp932)）
   let text: string;
   const utf8Decoder = new TextDecoder('utf-8');
   const utf8Text = utf8Decoder.decode(buffer);
   if (utf8Text.includes('利用者名') || utf8Text.includes('商品名') || utf8Text.includes('金額')) {
     text = utf8Text;
     console.log('[parseParamountCSV] UTF-8エンコーディングで読み込み');
   } else {
     const sjisDecoder = new TextDecoder('shift-jis');
     text = sjisDecoder.decode(buffer);
     console.log('[parseParamountCSV] Shift-JIS(cp932)エンコーディングで読み込み');
   }

   const lines = text.split(/\r?\n/);
   if (lines.length < 2) {
     return { success: false, error: 'CSVファイルが空です。' };
   }

   // ヘッダー行から列インデックスを動的取得
   const headerCols = parseCSVRow(lines[0]);
   const colIndex = {
     customerName: headerCols.indexOf('利用者名'),
     customerKana: headerCols.indexOf('利用者カナ'),
     itemName: headerCols.indexOf('商品名'),
     amount: headerCols.indexOf('金額'),
     quantity: headerCols.indexOf('数量'),
   };

   if (colIndex.customerName === -1 || colIndex.amount === -1) {
     return { success: false, error: 'CSVヘッダーに必要な列（利用者名、金額）が見つかりません。パラマウントケアサービスのCSVか確認してください。' };
   }

   const items: InvoiceItem[] = [];

   for (let i = 1; i < lines.length; i++) {
     const line = lines[i].trim();
     if (!line) continue;

     const cols = parseCSVRow(lines[i]);

     const customerName = (cols[colIndex.customerName] || '').trim();
     const itemName = colIndex.itemName !== -1 ? (cols[colIndex.itemName] || '').trim() : '';
     const amountStr = (cols[colIndex.amount] || '').replace(/[,，\s]/g, '').trim();
     const amount = parseInt(amountStr, 10);

     // 金額が0またはNaN、かつ利用者名も空の行はスキップ
     if ((isNaN(amount) || amount === 0) && !customerName) continue;
     // 金額が有効でない行はスキップ
     if (isNaN(amount) || amount === 0) continue;

     const quantity = colIndex.quantity !== -1 ? parseInt((cols[colIndex.quantity] || '1').replace(/[,，\s]/g, ''), 10) || 1 : 1;
     const unitPrice = quantity > 0 ? Math.round(amount / quantity) : amount;

     items.push({
       id: `ParamountCare-${Date.now()}-${i}`,
       wholesaleCompany: 'ParamountCare',
       customerName: customerName || itemName,
       customerNameNormalized: normalizeJapaneseName(customerName || itemName),
       itemName,
       itemNameNormalized: normalizeJapaneseName(itemName),
       quantity,
       unitPrice,
       amount,
     });
   }

   if (items.length === 0) {
     return { success: false, error: 'CSVから有効な明細行が見つかりませんでした。' };
   }

   const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);

   const invoice: ParsedInvoice = {
     id: `invoice-ParamountCare-${Date.now()}`,
     wholesaleCompany: 'ParamountCare',
     fileName: file.name,
     uploadedAt: new Date().toISOString(),
     billingMonth,
     items,
     totalAmount: calculatedTotal,
     rawOcrText: '',
   };

   // VerificationResult（CSVには請求書合計がないため、明細合計のみ）
   const verification: VerificationResult = {
     invoiceTotal: null,
     calculatedTotal,
     difference: 0,
     isMatched: true,
     discrepancyReason: null,
   };

   console.log(`[parseParamountCSV] ${items.length}件の明細を読み込み, 合計: ${calculatedTotal.toLocaleString()}円`);

   return { success: true, invoice, processedWith: 'csv-import', verification };
 } catch (error) {
   console.error('[parseParamountCSV] error:', error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return { success: false, error: `CSVの読み込み中にエラーが発生しました: ${errorMessage}` };
 }
};


// ===== 4d. Parse NihonCareSupply CSV for Reconciliation =====
// 日本ケアサプライCSV: カンマ区切り、cp932、全フィールドクォート付き
// REN(レンタル)ヘッダー: 契約番号,枝番,明細行番号,商品番号,商品名,明細月額レンタル料,明細月額レンタル料(消費税),往路配送費,往路配送費(消費税),復路配送費,復路配送費(消費税),利用者名(漢字),...
// SAL(販売)ヘッダー: 対象月,出荷番号,明細,商品コード,商品名,単価,課税数量,非課税数量,請求金額_課税,消費税,請求金額_非課税,売上合計,...

export const parseNihonCareSupplyCSV = async (
 file: File,
 billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string; processedWith?: string; verification?: VerificationResult }> => {
 try {
   const buffer = await file.arrayBuffer();

   // エンコーディング自動判定（UTF-8 / Shift-JIS(cp932)）
   let text: string;
   const utf8Decoder = new TextDecoder('utf-8');
   const utf8Text = utf8Decoder.decode(buffer);
   if (utf8Text.includes('利用者名') || utf8Text.includes('商品名') || utf8Text.includes('明細月額')) {
     text = utf8Text;
     console.log('[parseNihonCareSupplyCSV] UTF-8エンコーディングで読み込み');
   } else {
     const sjisDecoder = new TextDecoder('shift-jis');
     text = sjisDecoder.decode(buffer);
     console.log('[parseNihonCareSupplyCSV] Shift-JIS(cp932)エンコーディングで読み込み');
   }

   const lines = text.split(/\r?\n/);
   if (lines.length < 2) {
     return { success: false, error: 'CSVファイルが空です。' };
   }

   const headerCols = parseCSVRow(lines[0]);

   // REN(レンタル) or SAL(販売) を判定
   const isRental = headerCols.includes('明細月額レンタル料');
   const isSales = headerCols.includes('請求金額_課税');

   if (!isRental && !isSales) {
     return { success: false, error: 'CSVヘッダーに必要な列が見つかりません。日本ケアサプライのレンタルCSVまたは販売CSVか確認してください。' };
   }

   const items: InvoiceItem[] = [];

   if (isRental) {
     // === REN CSV ===
     const colIndex = {
       customerName: headerCols.indexOf('利用者名(漢字)'),
       itemName: headerCols.indexOf('商品名'),
       rentalAmount: headerCols.indexOf('明細月額レンタル料'),
       rentalTax: headerCols.indexOf('明細月額レンタル料(消費税)'),
       deliveryOut: headerCols.indexOf('往路配送費'),
       deliveryReturn: headerCols.indexOf('復路配送費'),
     };

     if (colIndex.customerName === -1 || colIndex.rentalAmount === -1) {
       return { success: false, error: 'CSVヘッダーに必要な列（利用者名(漢字)、明細月額レンタル料）が見つかりません。' };
     }

     for (let i = 1; i < lines.length; i++) {
       const line = lines[i].trim();
       if (!line) continue;

       const cols = parseCSVRow(lines[i]);

       const customerName = (cols[colIndex.customerName] || '').trim();
       const itemName = colIndex.itemName !== -1 ? (cols[colIndex.itemName] || '').trim() : '';
       const rentalAmount = parseInt((cols[colIndex.rentalAmount] || '0').replace(/[,，\s]/g, ''), 10) || 0;
       const deliveryOut = colIndex.deliveryOut !== -1 ? parseInt((cols[colIndex.deliveryOut] || '0').replace(/[,，\s]/g, ''), 10) || 0 : 0;
       const deliveryReturn = colIndex.deliveryReturn !== -1 ? parseInt((cols[colIndex.deliveryReturn] || '0').replace(/[,，\s]/g, ''), 10) || 0 : 0;

       // 税抜き合計（レンタル料 + 配送費）
       const amount = rentalAmount + deliveryOut + deliveryReturn;

       // 金額0の行はスキップ
       if (amount === 0) continue;
       // 利用者名も商品名も空の行はスキップ
       if (!customerName && !itemName) continue;

       items.push({
         id: `NihonCaresupply-${Date.now()}-${i}`,
         wholesaleCompany: 'NihonCaresupply',
         customerName: customerName || itemName,
         customerNameNormalized: normalizeJapaneseName(customerName || itemName),
         itemName,
         itemNameNormalized: normalizeJapaneseName(itemName),
         quantity: 1,
         unitPrice: amount,
         amount,
       });
     }
   } else {
     // === SAL CSV ===
     // 出荷番号でグループ化し、送料を商品に合算。商品名をcustomerNameとして個別マッチング可能にする
     const colIndex = {
       shipmentNo: headerCols.indexOf('出荷番号'),
       itemName: headerCols.indexOf('商品名'),
       amountTaxable: headerCols.indexOf('請求金額_課税'),
       amountNonTaxable: headerCols.indexOf('請求金額_非課税'),
       deliveryDest: headerCols.indexOf('納品先'),
     };

     // 出荷番号ごとにグループ化
     const shipmentMap = new Map<string, { productName: string; totalAmount: number; deliveryDest: string; lineNo: number }>();

     for (let i = 1; i < lines.length; i++) {
       const line = lines[i].trim();
       if (!line) continue;

       const cols = parseCSVRow(lines[i]);

       const shipmentNo = colIndex.shipmentNo !== -1 ? (cols[colIndex.shipmentNo] || '').trim() : String(i);
       const itemName = colIndex.itemName !== -1 ? (cols[colIndex.itemName] || '').trim() : '';
       const amountTaxable = parseInt((cols[colIndex.amountTaxable] || '0').replace(/[,，\s]/g, ''), 10) || 0;
       const amountNonTaxable = colIndex.amountNonTaxable !== -1 ? parseInt((cols[colIndex.amountNonTaxable] || '0').replace(/[,，\s]/g, ''), 10) || 0 : 0;
       const deliveryDest = colIndex.deliveryDest !== -1 ? (cols[colIndex.deliveryDest] || '').trim() : '';
       const amount = amountTaxable + amountNonTaxable;

       if (amount === 0) continue;

       const existing = shipmentMap.get(shipmentNo);
       const isShipping = itemName.includes('送料');

       if (existing) {
         // 同一出荷番号: 送料を合算
         existing.totalAmount += amount;
         if (!isShipping && itemName) {
           existing.productName = itemName;
         }
       } else {
         shipmentMap.set(shipmentNo, {
           productName: isShipping ? deliveryDest : itemName,
           totalAmount: amount,
           deliveryDest,
           lineNo: i,
         });
       }
     }

     // グループ化した結果をitemsに変換
     for (const [shipmentNo, group] of shipmentMap) {
       const customerName = group.productName || group.deliveryDest;
       if (!customerName) continue;

       items.push({
         id: `NihonCaresupply-${Date.now()}-${group.lineNo}`,
         wholesaleCompany: 'NihonCaresupply',
         customerName,
         customerNameNormalized: normalizeJapaneseName(customerName),
         itemName: group.productName,
         itemNameNormalized: normalizeJapaneseName(group.productName),
         quantity: 1,
         unitPrice: group.totalAmount,
         amount: group.totalAmount,
       });
     }
   }

   if (items.length === 0) {
     return { success: false, error: 'CSVから有効な明細行が見つかりませんでした。' };
   }

   const calculatedTotal = items.reduce((sum, item) => sum + item.amount, 0);

   const invoice: ParsedInvoice = {
     id: `invoice-NihonCaresupply-${Date.now()}`,
     wholesaleCompany: 'NihonCaresupply',
     fileName: file.name,
     uploadedAt: new Date().toISOString(),
     billingMonth,
     items,
     totalAmount: calculatedTotal,
     rawOcrText: '',
   };

   // VerificationResult（CSVには請求書合計がないため、明細合計のみ）
   const verification: VerificationResult = {
     invoiceTotal: null,
     calculatedTotal,
     difference: 0,
     isMatched: true,
     discrepancyReason: null,
   };

   const csvType = isRental ? 'レンタル' : '販売';
   console.log(`[parseNihonCareSupplyCSV] ${csvType} ${items.length}件の明細を読み込み, 合計: ${calculatedTotal.toLocaleString()}円`);

   return { success: true, invoice, processedWith: 'csv-import', verification };
 } catch (error) {
   console.error('[parseNihonCareSupplyCSV] error:', error);
   const errorMessage = error instanceof Error ? error.message : String(error);
   return { success: false, error: `CSVの読み込み中にエラーが発生しました: ${errorMessage}` };
 }
};


// ===== Helper: Normalize Japanese name for matching =====
function normalizeJapaneseName(name: string): string {
 return name
   .replace(/\s+/g, '')      // Remove ASCII spaces
   .replace(/　/g, '')        // Remove full-width spaces
   .replace(/[ー−―‐]/g, '')  // Remove various dashes
   .normalize('NFKC')         // Normalize Unicode (半角→全角 etc)
   .toLowerCase();
}


// ===== 5. Fetch Google Docs content via Cloud Function =====
export const fetchGoogleDocContent = async (docId: string): Promise<string> => {
  try {
    const result = await fetchGoogleDocContentFn({ docId });
    const data = result.data as { success: boolean; text?: string };
    if (data.success && data.text) return data.text;
    throw new Error('ドキュメントの取得に失敗しました');
  } catch (error) {
    console.error('fetchGoogleDocContent error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`ドキュメントの取得に失敗しました: ${errorMessage}`);
  }
};


// ===== 5b. Extract meeting notes from uploaded file (PDF) =====
export const extractMeetingNotes = async (file: File): Promise<string> => {
  try {
    const base64Data = await fileToBase64(file);
    const result = await extractMeetingNotesFn({ fileBase64: base64Data, mimeType: file.type });
    const data = result.data as { success: boolean; text?: string };
    if (data.success && data.text) return data.text;
    throw new Error('ファイルの読み取りに失敗しました');
  } catch (error) {
    console.error('extractMeetingNotes error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`ファイルの読み取りに失敗しました: ${errorMessage}`);
  }
};


// ===== 6. Sync Change Records to Google Sheets =====
export const syncChangeRecordsToSheets = async (): Promise<{
  success: boolean;
  count?: number;
  spreadsheetUrl?: string;
  message?: string;
  error?: string;
}> => {
  try {
    console.log('[geminiService] Starting syncChangeRecordsToSheets...');

    const result = await syncChangeRecordsToSheetsFn({});

    const data = result.data as {
      success: boolean;
      count?: number;
      spreadsheetUrl?: string;
      message?: string;
    };

    if (data.success) {
      console.log(`[geminiService] Sync completed: ${data.count} records`);
      return {
        success: true,
        count: data.count,
        spreadsheetUrl: data.spreadsheetUrl,
        message: data.message,
      };
    }

    return {
      success: false,
      error: 'スプレッドシート同期に失敗しました',
    };
  } catch (error) {
    console.error('[geminiService] syncChangeRecordsToSheets error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `同期中にエラーが発生しました: ${errorMessage}`,
    };
  }
};

export const syncMeetingsToSheets = async (): Promise<{
  success: boolean;
  count?: number;
  spreadsheetUrl?: string;
  message?: string;
  error?: string;
}> => {
  try {
    console.log('[geminiService] Starting syncMeetingsToSheets...');
    const result = await syncMeetingsToSheetsFn({});
    const data = result.data as {
      success: boolean;
      count?: number;
      spreadsheetUrl?: string;
      message?: string;
    };
    if (data.success) {
      console.log(`[geminiService] Meetings sync completed: ${data.count} records`);
      return { success: true, count: data.count, spreadsheetUrl: data.spreadsheetUrl, message: data.message };
    }
    return { success: false, error: '議事録同期に失敗しました' };
  } catch (error) {
    console.error('[geminiService] syncMeetingsToSheets error:', error);
    return { success: false, error: `同期中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}` };
  }
};

