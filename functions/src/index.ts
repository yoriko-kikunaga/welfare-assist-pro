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

  try {
    const prompt = `
この請求書（${billingMonth || ''}月分、${wholesaleCompany || '卸会社'}）から以下の情報を抽出して、**JSON形式のみ**で出力してください。
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

    if (!text) {
      throw new HttpsError('internal', 'No response from Vertex AI');
    }

    // Parse JSON from response - try to find valid JSON structure
    let parsedData: { items: InvoiceItem[]; totalAmount: number };

    try {
      // First, try to extract JSON between first { and last }
      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');

      if (startIdx === -1 || endIdx === -1 || startIdx >= endIdx) {
        console.error('No JSON structure found in response:', text.substring(0, 500));
        throw new HttpsError('internal', 'Failed to parse invoice - no JSON found');
      }

      let jsonStr = text.substring(startIdx, endIdx + 1);

      // Try to parse as-is first
      try {
        parsedData = JSON.parse(jsonStr);
      } catch {
        // If parsing fails, try to fix common JSON issues from AI responses

        // 1. Remove trailing commas before ] or }
        jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

        // 2. Fix unescaped newlines in string values (replace with space)
        jsonStr = jsonStr.replace(/:\s*"([^"]*)\n([^"]*)"/g, ': "$1 $2"');

        // 3. Remove control characters except \n, \r, \t
        jsonStr = jsonStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

        // 4. Try parsing again
        try {
          parsedData = JSON.parse(jsonStr);
        } catch {
          // 5. Last resort: extract just the items array using regex
          console.log('Attempting regex extraction for items array...');
          const itemsMatch = jsonStr.match(/"items"\s*:\s*\[([\s\S]*?)\](?=\s*,?\s*"totalAmount"|\s*})/);
          const totalMatch = jsonStr.match(/"totalAmount"\s*:\s*(\d+)/);

          if (itemsMatch) {
            // Parse items one by one
            const itemsStr = itemsMatch[1];
            const items: InvoiceItem[] = [];

            // Match individual item objects
            const itemRegex = /\{[^{}]*"customerName"[^{}]*\}/g;
            let match;
            while ((match = itemRegex.exec(itemsStr)) !== null) {
              try {
                const item = JSON.parse(match[0]);
                items.push(item);
              } catch {
                // Skip malformed items
                console.log('Skipping malformed item:', match[0].substring(0, 100));
              }
            }

            parsedData = {
              items,
              totalAmount: totalMatch ? parseInt(totalMatch[1], 10) : 0,
            };
          } else {
            throw new Error('Could not extract items array from response');
          }
        }
      }
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Response text (first 1000 chars):', text.substring(0, 1000));
      throw new HttpsError('internal', `Failed to parse invoice JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }

    return {
      success: true,
      items: parsedData.items || [],
      totalAmount: parsedData.totalAmount || 0,
      rawText: text,
    };
  } catch (error) {
    console.error('parseWholesaleInvoice error:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new HttpsError('internal', `Failed to parse invoice: ${errorMessage}`);
  }
});
