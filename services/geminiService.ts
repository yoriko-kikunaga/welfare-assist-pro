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
export const parseWholesaleInvoice = async (
  file: File,
  wholesaleCompany: WholesaleCompany,
  billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string }> => {
  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  try {
    const base64Data = await fileToBase64(file);
    const companyName = WHOLESALE_COMPANY_NAMES[wholesaleCompany];

    const result = await parseWholesaleInvoiceFn({
      fileBase64: base64Data,
      mimeType: file.type,
      wholesaleCompany: companyName,
      billingMonth,
    });

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

    return { success: true, invoice };
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
