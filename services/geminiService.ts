import { GoogleGenAI, Type } from "@google/genai";
import { Client, MeetingRecord, MeetingType } from "../types";

// Helper to check for API key
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is not set. AI features will not work.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

// 1. Generate Formal Minutes from Rough Notes
export const generateMeetingSummary = async (
  notes: string,
  type: MeetingType,
  clientName: string
): Promise<string> => {
  const ai = getAiClient();
  if (!ai) return "API Key未設定のため生成できません。";

  try {
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        systemInstruction: "専門用語を適切に補完し、簡潔かつ丁寧なビジネス文書のトーンで出力してください。",
      }
    });

    return response.text || "生成に失敗しました。";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "エラーが発生しました。もう一度お試しください。";
  }
};

// 2. Suggest Equipment based on Medical History
export const suggestEquipment = async (client: Client): Promise<string> => {
  const ai = getAiClient();
  if (!ai) return "API Key未設定のため生成できません。";

  try {
    const prompt = `
      以下の利用者の基本情報と病歴に基づき、生活の質(QOL)を向上させ、自立支援に役立つと思われる「福祉用具」を3つ提案してください。
      なぜその用具が必要なのかの理由も添えてください。
      
      利用者名: ${client.name}
      要介護度: ${client.careLevel}
      病歴・状態: ${client.medicalHistory}
      現在の入居施設: ${client.facilityName}
    `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            systemInstruction: "あなたはベテランの福祉用具専門相談員です。安全性と自立支援の観点からアドバイスしてください。",
        }
    });

    return response.text || "提案の生成に失敗しました。";
  } catch (error) {
    console.error("Gemini Suggestion Error:", error);
    return "エラーが発生しました。";
  }
};
