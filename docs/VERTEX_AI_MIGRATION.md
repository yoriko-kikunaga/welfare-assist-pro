# Vertex AI 移行計画

## 概要

Gemini API（ブラウザ直接呼び出し）からVertex AI（Cloud Functions経由）への移行。

## 現状

```
ブラウザ → Gemini API (@google/generative-ai)
           APIキー認証
```

**問題点**:
- APIキーがフロントエンドに露出
- 支払い情報設定が必要
- クォータ制限

## 移行後の構成

```
ブラウザ → Cloud Functions → Vertex AI
           (Firebase Hosting)   (Workload Identity認証)
                                (asia-northeast1)
```

**メリット**:
- APIキー不要（Workload Identity）
- セキュア（認証情報がフロントエンドに露出しない）
- 日本リージョン（低レイテンシ）

## 実装計画

### Phase 1: Cloud Functions セットアップ

1. **Firebase Functions初期化**
   ```bash
   cd functions
   npm init
   npm install @google-cloud/vertexai firebase-functions firebase-admin
   ```

2. **ディレクトリ構成**
   ```
   functions/
   ├── package.json
   ├── tsconfig.json
   ├── src/
   │   ├── index.ts          # エントリーポイント
   │   └── vertexAiService.ts # Vertex AI呼び出し
   ```

### Phase 2: Vertex AI サービス実装

**対象機能**（4つ）:
| 関数名 | 用途 |
|--------|------|
| `generateMeetingSummary` | 議事録生成 |
| `suggestEquipment` | 福祉用具提案 |
| `extractMedicalInfo` | 医療文書OCR |
| `parseWholesaleInvoice` | 請求書OCR |

**Vertex AI設定**:
```typescript
const vertexAI = new VertexAI({
  project: 'welfare-assist-pro',
  location: 'asia-northeast1',  // 東京リージョン
});

const model = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash',
});
```

### Phase 3: フロントエンド修正

1. **geminiService.ts を修正**
   - 直接API呼び出し → Cloud Functions呼び出しに変更
   - `httpsCallable` を使用

2. **変更例**:
   ```typescript
   // Before (直接呼び出し)
   const genAI = new GoogleGenerativeAI(apiKey);
   const model = genAI.getGenerativeModel({ model: 'gemini-pro-vision' });

   // After (Cloud Functions経由)
   import { getFunctions, httpsCallable } from 'firebase/functions';
   const functions = getFunctions(app, 'asia-northeast1');
   const parseInvoice = httpsCallable(functions, 'parseWholesaleInvoice');
   ```

### Phase 4: IAM設定（Workload Identity）

1. **必要な権限**:
   - Cloud Functions サービスアカウントに `Vertex AI User` ロールを付与

2. **設定コマンド**:
   ```bash
   gcloud projects add-iam-policy-binding welfare-assist-pro \
     --member="serviceAccount:welfare-assist-pro@appspot.gserviceaccount.com" \
     --role="roles/aiplatform.user"
   ```

### Phase 5: デプロイ

```bash
# Cloud Functions デプロイ
firebase deploy --only functions

# Hosting デプロイ
npm run build
firebase deploy --only hosting
```

## ファイル変更一覧

| ファイル | 変更内容 |
|----------|----------|
| `functions/src/index.ts` | 新規作成 - Cloud Functions エントリーポイント |
| `functions/src/vertexAiService.ts` | 新規作成 - Vertex AI呼び出しロジック |
| `functions/package.json` | 新規作成 - 依存関係 |
| `services/geminiService.ts` | 修正 - Cloud Functions呼び出しに変更 |
| `firebase.json` | 修正 - functions設定追加 |
| `.env` | 修正 - GEMINI_API_KEY削除 |
| `CLAUDE.md` | 修正 - アーキテクチャ更新 |

## テスト計画

1. Cloud Functions単体テスト（ローカルエミュレータ）
2. 請求書OCR機能テスト
3. 議事録生成機能テスト
4. 医療文書OCR機能テスト

## ロールバック計画

問題発生時は `services/geminiService.ts` を旧バージョンに戻し、再デプロイ。

## スケジュール

| Phase | 作業内容 | 状態 |
|-------|----------|------|
| 1 | Cloud Functions セットアップ | 完了 |
| 2 | Vertex AI サービス実装 | 完了 |
| 3 | フロントエンド修正 | 完了 |
| 4 | IAM設定 | 完了 |
| 5 | デプロイ・テスト | 完了 |

## 完了日

2026-01-21

## 参考リンク

- [Vertex AI Gemini API](https://cloud.google.com/vertex-ai/docs/generative-ai/model-reference/gemini)
- [Firebase Functions](https://firebase.google.com/docs/functions)
- [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation)
