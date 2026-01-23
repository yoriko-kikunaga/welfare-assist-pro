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
// V3 (pdfplumber) → V2 (Gemini OCR) → V1 (fallback) chain
export const parseWholesaleInvoice = async (
  file: File,
  wholesaleCompany: WholesaleCompany,
  billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string; processedWith?: string }> => {
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

    // Step 1: Try V3 (Python pdfplumber) for machine-generated PDFs
    try {
      console.log('[geminiService] Trying V3 (pdfplumber)...');
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

      // Check if V3 succeeded with actual data
      if (v3Data.success && v3Data.processedWith === 'pdfplumber' && v3Data.items && v3Data.items.length > 0) {
        console.log('[geminiService] V3 (pdfplumber) succeeded');
        processedWith = 'v3-pdfplumber';
      } else if (v3Data.processedWith === 'needs-ocr-fallback') {
        console.log('[geminiService] V3 detected scanned PDF, falling back to OCR...');
        result = null; // Trigger fallback
      } else {
        console.log('[geminiService] V3 returned no items, falling back to OCR...');
        result = null; // Trigger fallback
      }
    } catch (v3Error) {
      console.warn('[geminiService] V3 failed:', v3Error);
      result = null;
    }

    // Step 2: Try V2 (Gemini OCR with text extraction) if V3 didn't work
    if (!result) {
      try {
        console.log('[geminiService] Trying V2 (Gemini OCR with text extraction)...');
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
    }

    // Step 3: Fallback to V1 (original Gemini multimodal OCR)
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

    return { success: true, invoice, processedWith: finalProcessedWith };
  } catch (error) {
    console.error("parseWholesaleInvoice error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: `請求書の読み取り中にエラーが発生しました: ${errorMessage}` };
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
