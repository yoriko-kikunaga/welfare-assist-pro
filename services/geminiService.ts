import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client, MeetingRecord, MeetingType, WholesaleCompany, ParsedInvoice, InvoiceItem, WHOLESALE_COMPANY_NAMES } from "../types";

// Gemini AI初期化（ブラウザ互換）
const getAiClient = () => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not set. AI features will not work.");
      return null;
    }
    return new GoogleGenerativeAI(apiKey);
  } catch (error) {
    console.warn("Gemini AI initialization failed. AI features will not work.", error);
    return null;
  }
};

// 1. Generate Formal Minutes from Rough Notes
export const generateMeetingSummary = async (
  notes: string,
  type: MeetingType,
  clientName: string
): Promise<string> => {
  const genAI = getAiClient();
  if (!genAI) return "Gemini AI初期化エラー。API KEYを確認してください。";

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: "専門用語を適切に補完し、簡潔かつ丁寧なビジネス文書のトーンで出力してください。"
    });

    const prompt = `
      あなたは福祉用具専門相談員の事務アシスタントです。
      以下の「粗いメモ」を元に、${clientName}様の「${type}」の正式な議事録サマリーを作成してください。

      フォーマット:
      【日時・場所】(メモに含まれていれば)
      【出席者】(メモに含まれていれば)
      【検討内容】
      【決定事項】
      【次回アクション】

      粗いメモ:
      ${notes}
    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text() || "生成に失敗しました。";
  } catch (error) {
    console.error("Gemini AI Error:", error);
    return "エラーが発生しました。もう一度お試しください。";
  }
};

// 2. Extract Medical Information from Document (OCR + Summarization)
export const extractMedicalInfoFromDocument = async (
  file: File
): Promise<{ success: boolean; text: string }> => {
  const genAI = getAiClient();
  if (!genAI) {
    return { success: false, text: "Gemini AI初期化エラー。API KEYを確認してください。" };
  }

  // Validate file type
  const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    return { success: false, text: "対応していないファイル形式です。PDF、PNG、JPG、WEBP形式でアップロードしてください。" };
  }

  // Validate file size (20MB limit for Gemini)
  const maxSize = 20 * 1024 * 1024; // 20MB
  if (file.size > maxSize) {
    return { success: false, text: "ファイルサイズが大きすぎます。20MB以下のファイルを選択してください。" };
  }

  try {
    // Convert file to base64
    const base64Data = await new Promise<string>((resolve, reject) => {
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

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: `あなたは医療文書の分析を行う専門家です。
文書から医療情報を正確に抽出し、福祉用具専門相談員が利用できる形式で要約してください。
専門用語は可能な限り維持しつつ、理解しやすい形で整理してください。`
    });

    const prompt = `
以下の医療文書（診療情報提供書、サマリー、退院時要約等）を読み取り、福祉用具選定に必要な情報を抽出・要約してください。

出力フォーマット:
【主病名・診断名】
【既往歴】
【現病歴・経過】
【身体状況・ADL】
- 移動能力:
- 認知機能:
- その他特記事項:
【留意点・注意事項】

※文書に記載がない項目は「記載なし」と表示してください。
※個人を特定できる情報（氏名、生年月日、住所等）は出力しないでください。
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: file.type,
          data: base64Data
        }
      }
    ]);

    const response = result.response;
    const text = response.text();

    if (!text) {
      return { success: false, text: "文書の読み取りに失敗しました。別のファイルをお試しください。" };
    }

    return { success: true, text };
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    return { success: false, text: "エラーが発生しました。ファイルを確認して再度お試しください。" };
  }
};

// 3. Suggest Equipment based on Medical History
export const suggestEquipment = async (client: Client): Promise<string> => {
  const genAI = getAiClient();
  if (!genAI) return "Gemini AI初期化エラー。API KEYを確認してください。";

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: "あなたはベテランの福祉用具専門相談員です。安全性と自立支援の観点からアドバイスしてください。"
    });

    const prompt = `
      以下の利用者の基本情報と病歴に基づき、生活の質(QOL)を向上させ、自立支援に役立つと思われる「福祉用具」を3つ提案してください。
      なぜその用具が必要なのかの理由も添えてください。

      利用者名: ${client.name}
      要介護度: ${client.careLevel}
      病歴・状態: ${client.medicalHistory}
      現在の入居施設: ${client.facilityName}
    `;

    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text() || "提案の生成に失敗しました。";
  } catch (error) {
    console.error("Gemini AI Suggestion Error:", error);
    return "エラーが発生しました。";
  }
};

// 4. Parse Wholesale Invoice from PDF (OCR for Reconciliation)
export const parseWholesaleInvoice = async (
  file: File,
  wholesaleCompany: WholesaleCompany,
  billingMonth: string
): Promise<{ success: boolean; invoice?: ParsedInvoice; error?: string }> => {
  const genAI = getAiClient();
  if (!genAI) {
    return { success: false, error: "Gemini AI初期化エラー。API KEYを確認してください。" };
  }

  // Validate file type
  const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    return { success: false, error: "対応していないファイル形式です。PDF、PNG、JPG、WEBP形式でアップロードしてください。" };
  }

  // Validate file size (20MB limit)
  const maxSize = 20 * 1024 * 1024;
  if (file.size > maxSize) {
    return { success: false, error: "ファイルサイズが大きすぎます。20MB以下のファイルを選択してください。" };
  }

  try {
    // Convert file to base64
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const companyName = WHOLESALE_COMPANY_NAMES[wholesaleCompany];

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      systemInstruction: `あなたは福祉用具卸会社の請求書を読み取る専門家です。
請求書から情報を正確に抽出し、JSON形式で出力してください。
会社名: ${companyName}`
    });

    const prompt = `
この請求書（${billingMonth}月分、${companyName}）から以下の情報を抽出して、**JSON形式のみ**で出力してください。
説明文は不要です。JSONのみを出力してください。

出力フォーマット:
{
  "items": [
    {
      "customerName": "利用者名",
      "itemName": "商品名（レンタル品目）",
      "quantity": 数量（数値）,
      "unitPrice": 単価（数値）,
      "amount": 金額（数値）
    }
  ],
  "totalAmount": 合計金額（数値）
}

注意:
- customerName: 施設名ではなく利用者個人名を抽出
- itemName: 福祉用具の商品名（車いす、特殊寝台、歩行器など）
- 金額は数値のみ（カンマや円記号なし）
- 抽出できない項目は null で出力
- 複数の利用者がいる場合は items 配列に全て含める
`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: file.type,
          data: base64Data
        }
      }
    ]);

    const response = result.response;
    const text = response.text();

    if (!text) {
      return { success: false, error: "請求書の読み取りに失敗しました。" };
    }

    // Parse JSON from response
    let parsedData: { items: any[]; totalAmount: number };
    try {
      // Extract JSON from response (handle potential markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("No JSON found in OCR response:", text);
        return { success: false, error: "請求書の解析に失敗しました。形式を確認してください。" };
      }
      parsedData = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error("JSON parse error:", parseError, "Response:", text);
      return { success: false, error: "請求書データの解析に失敗しました。" };
    }

    // Convert to InvoiceItem array
    const items: InvoiceItem[] = (parsedData.items || []).map((item, index) => ({
      id: `${wholesaleCompany}-${Date.now()}-${index}`,
      wholesaleCompany,
      customerName: item.customerName || '',
      customerNameNormalized: normalizeJapaneseName(item.customerName || ''),
      itemName: item.itemName || '',
      itemNameNormalized: normalizeJapaneseName(item.itemName || ''),
      quantity: typeof item.quantity === 'number' ? item.quantity : 1,
      unitPrice: typeof item.unitPrice === 'number' ? item.unitPrice : 0,
      amount: typeof item.amount === 'number' ? item.amount : 0
    }));

    const invoice: ParsedInvoice = {
      id: `invoice-${wholesaleCompany}-${Date.now()}`,
      wholesaleCompany,
      fileName: file.name,
      uploadedAt: new Date().toISOString(),
      billingMonth,
      items,
      totalAmount: parsedData.totalAmount || items.reduce((sum, item) => sum + item.amount, 0),
      rawOcrText: text
    };

    return { success: true, invoice };
  } catch (error) {
    console.error("Invoice OCR Error:", error);
    return { success: false, error: "請求書の読み取り中にエラーが発生しました。" };
  }
};

// Helper: Normalize Japanese name for matching
function normalizeJapaneseName(name: string): string {
  return name
    .replace(/\s+/g, '')      // Remove ASCII spaces
    .replace(/　/g, '')        // Remove full-width spaces
    .replace(/[ー−―‐]/g, '')  // Remove various dashes
    .normalize('NFKC')         // Normalize Unicode (半角→全角 etc)
    .toLowerCase();
}
