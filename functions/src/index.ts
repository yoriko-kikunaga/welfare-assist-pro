import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { VertexAI } from '@google-cloud/vertexai';

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
