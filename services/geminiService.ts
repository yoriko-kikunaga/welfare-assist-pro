import { VertexAI } from "@google-cloud/vertexai";
import { Client, MeetingRecord, MeetingType } from "../types";

// Vertex AI初期化（東京リージョン）
const getAiClient = () => {
  try {
    const vertexAI = new VertexAI({
      project: process.env.GCP_PROJECT_ID || 'welfare-assist-pro',
      location: 'asia-northeast1' // 東京リージョン
    });
    return vertexAI;
  } catch (error) {
    console.warn("Vertex AI initialization failed. AI features will not work.", error);
    return null;
  }
};

// 1. Generate Formal Minutes from Rough Notes
export const generateMeetingSummary = async (
  notes: string,
  type: MeetingType,
  clientName: string
): Promise<string> => {
  const vertexAI = getAiClient();
  if (!vertexAI) return "Vertex AI初期化エラー。認証設定を確認してください。";

  try {
    const model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
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
    const response = await result.response;
    return response.candidates?.[0]?.content?.parts?.[0]?.text || "生成に失敗しました。";
  } catch (error) {
    console.error("Vertex AI Error:", error);
    return "エラーが発生しました。もう一度お試しください。";
  }
};

// 2. Suggest Equipment based on Medical History
export const suggestEquipment = async (client: Client): Promise<string> => {
  const vertexAI = getAiClient();
  if (!vertexAI) return "Vertex AI初期化エラー。認証設定を確認してください。";

  try {
    const model = vertexAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
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
    const response = await result.response;
    return response.candidates?.[0]?.content?.parts?.[0]?.text || "提案の生成に失敗しました。";
  } catch (error) {
    console.error("Vertex AI Suggestion Error:", error);
    return "エラーが発生しました。";
  }
};
