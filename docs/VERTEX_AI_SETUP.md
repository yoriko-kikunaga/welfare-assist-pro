# Vertex AI セットアップドキュメント

## 概要

WelfareAssist ProはVertex AI（Gemini API）を使用して、議事録の自動生成と福祉用具の推薦機能を提供します。

本ドキュメントでは、**Workload Identity**ベースの認証構成について説明します。APIキーは使用せず、より安全なサービスアカウント認証を採用しています。

---

## 認証方式

### Workload Identity認証の利点

✅ **セキュリティ**: APIキーを使用しないため、流出リスクがない
✅ **管理性**: IAMポリシーで細かい権限制御が可能
✅ **本番対応**: GKE、Cloud Run等での自動認証に対応
✅ **監査**: すべてのAPI呼び出しがCloud Auditログに記録される

---

## 1. 前提条件

- Google Cloud SDK（gcloud CLI）がインストール済み
- GCPプロジェクト作成済み（`welfare-assist-pro`）
- 課金アカウントがリンク済み

---

## 2. Vertex AI API有効化

### コマンド

```bash
gcloud services enable aiplatform.googleapis.com \
  --project=welfare-assist-pro
```

### 確認

```bash
gcloud services list --enabled --filter="name:aiplatform"
```

**期待される出力**:
```
NAME                     TITLE
aiplatform.googleapis.com  Vertex AI API
```

---

## 3. サービスアカウント作成

### サービスアカウント作成コマンド

```bash
gcloud iam service-accounts create welfare-assist-sa \
  --display-name="WelfareAssist Pro Service Account" \
  --project=welfare-assist-pro
```

### 作成されたサービスアカウント

- **名前**: `welfare-assist-sa`
- **メールアドレス**: `welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com`

### サービスアカウント一覧確認

```bash
gcloud iam service-accounts list --project=welfare-assist-pro
```

---

## 4. IAM権限付与

### Vertex AI User権限の付与

```bash
gcloud projects add-iam-policy-binding welfare-assist-pro \
  --member="serviceAccount:welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### 権限の確認

```bash
gcloud projects get-iam-policy welfare-assist-pro \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/aiplatform.user"
```

### 付与された権限

| ロール | 権限内容 |
|--------|---------|
| `roles/aiplatform.user` | Vertex AIモデルの実行権限 |

---

## 5. Application Default Credentials（ADC）設定

### ローカル開発環境での認証

```bash
gcloud auth application-default login
```

このコマンドにより、以下のファイルに認証情報が保存されます：

```
C:\Users\acgpa\AppData\Roaming\gcloud\application_default_credentials.json
```

### 認証の仕組み

1. **ローカル開発**: ADCファイルを使用（ユーザー認証）
2. **Cloud Run / GKE**: Workload Identityを自動使用（サービスアカウント認証）
3. **CI/CD**: サービスアカウントキーまたはWorkload Identity

### クォータプロジェクトの設定

ADC設定時に、`welfare-assist-pro`がクォータプロジェクトとして自動設定されます。

---

## 6. 環境変数設定

### .env.localファイル

プロジェクトルートに `.env.local` ファイルを作成：

```env
# Google Cloud Platform設定
GCP_PROJECT_ID=welfare-assist-pro
GCP_LOCATION=asia-northeast1

# Vertex AI設定
# Application Default Credentialsを使用するため、APIキーは不要
# 認証ファイルパス: C:\Users\acgpa\AppData\Roaming\gcloud\application_default_credentials.json
```

### 環境変数の説明

| 変数名 | 値 | 説明 |
|--------|-----|------|
| `GCP_PROJECT_ID` | `welfare-assist-pro` | GCPプロジェクトID |
| `GCP_LOCATION` | `asia-northeast1` | Vertex AIのリージョン（東京） |

---

## 7. コード実装（Vertex AI SDK使用例）

### 従来の @google/genai から Vertex AI SDKへの移行

#### 旧実装（Google AI Studio APIキー）

```typescript
// services/geminiService.ts（旧）
import { genAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
```

#### 新実装（Vertex AI + ADC）

```typescript
// services/vertexAiService.ts（新）
import { VertexAI } from '@google-cloud/vertexai';

const projectId = process.env.GCP_PROJECT_ID || 'welfare-assist-pro';
const location = process.env.GCP_LOCATION || 'asia-northeast1';

const vertexAI = new VertexAI({
  project: projectId,
  location: location
});

const model = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash'
});

export async function generateMeetingSummary(
  notes: string,
  type: string,
  clientName: string
): Promise<string> {
  const prompt = `以下の粗いメモから、${type}の議事録を作成してください...`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

### 依存関係のインストール

```bash
npm install @google-cloud/vertexai
```

---

## 8. Workload Identity（Cloud Run/GKE向け）

### Cloud Runでの自動認証

Cloud Runにデプロイする際、サービスアカウントを指定：

```bash
gcloud run deploy welfare-assist-pro \
  --source . \
  --platform managed \
  --region asia-northeast1 \
  --service-account=welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com \
  --allow-unauthenticated
```

### Workload Identityの動作

1. Cloud Runコンテナ起動時、サービスアカウントが自動的にアタッチされる
2. メタデータサーバーから認証トークンを自動取得
3. Vertex AI SDKがトークンを使用してAPI呼び出し
4. **APIキーは一切不要**

---

## 9. セキュリティベストプラクティス

### APIキーを使用しない利点

| 項目 | APIキー方式 | Workload Identity方式 |
|------|------------|---------------------|
| **鍵の管理** | ファイル/環境変数で管理が必要 | 自動管理 |
| **流出リスク** | Gitへのコミットリスクあり | リスクなし |
| **権限制御** | プロジェクト全体の権限 | サービスごとに細かく制御可能 |
| **ローテーション** | 手動ローテーション必要 | 自動ローテーション |
| **監査ログ** | APIキーでは追跡困難 | すべてCloud Auditログに記録 |

### 推奨設定

#### ローカル開発

- ✅ Application Default Credentials（ADC）を使用
- ✅ 開発者ごとに個別のGCPアカウントで認証
- ❌ サービスアカウントキーのダウンロードは避ける

#### 本番環境（Cloud Run/GKE）

- ✅ Workload Identityを使用
- ✅ 最小権限の原則に従う（`roles/aiplatform.user`のみ）
- ✅ サービスごとに専用サービスアカウントを作成

---

## 10. トラブルシューティング

### 認証エラーが発生する場合

#### エラーメッセージ例
```
Error: Could not load the default credentials
```

#### 解決方法

1. ADCが正しく設定されているか確認：
```bash
gcloud auth application-default print-access-token
```

2. ADCの再設定：
```bash
gcloud auth application-default revoke
gcloud auth application-default login
```

3. 環境変数の確認：
```bash
echo $GCP_PROJECT_ID
echo $GCP_LOCATION
```

### 権限不足エラー

#### エラーメッセージ例
```
Error: Permission denied on resource project welfare-assist-pro
```

#### 解決方法

IAM権限を再確認：
```bash
gcloud projects get-iam-policy welfare-assist-pro \
  --flatten="bindings[].members" \
  --filter="bindings.members:welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com"
```

必要に応じて権限を再付与：
```bash
gcloud projects add-iam-policy-binding welfare-assist-pro \
  --member="serviceAccount:welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

### Vertex AIリージョンエラー

#### エラーメッセージ例
```
Error: Location not found: us-central1
```

#### 解決方法

`.env.local` で正しいリージョンを指定：
```env
GCP_LOCATION=asia-northeast1  # 東京リージョン
```

---

## 11. 利用可能なVertex AIモデル

### Gemini 2.5 Flash

- **モデルID**: `gemini-2.5-flash`
- **用途**: テキスト生成、議事録作成、推薦システム
- **特徴**: 高速・低コスト
- **最大トークン数**: 出力 8,192トークン

### その他利用可能なモデル

| モデル | 用途 | 特徴 |
|--------|------|------|
| `gemini-2.5-pro` | 高度な推論 | 最高品質 |
| `gemini-2.0-flash` | 汎用タスク | バランス型 |

---

## 12. コスト管理

### Vertex AI料金

- **入力トークン**: $0.000025 / 1,000トークン
- **出力トークン**: $0.000075 / 1,000トークン

### コスト最適化のヒント

1. **プロンプトの最適化**: 不要な情報を削減
2. **キャッシュの活用**: 同じ入力を再利用
3. **予算アラートの設定**: Cloud Consoleで設定

### 予算アラートの設定

```bash
# Cloud Consoleで設定
# https://console.cloud.google.com/billing/budgets
```

---

## 13. Cloud Runへのデプロイ

### Dockerfile作成

```dockerfile
FROM node:19-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

ENV PORT=8080
CMD ["npm", "run", "preview"]
```

### デプロイコマンド

```bash
gcloud run deploy welfare-assist-pro \
  --source . \
  --platform managed \
  --region asia-northeast1 \
  --service-account=welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com \
  --set-env-vars="GCP_PROJECT_ID=welfare-assist-pro,GCP_LOCATION=asia-northeast1" \
  --allow-unauthenticated
```

---

## 14. 設定完了チェックリスト

- [x] Vertex AI API有効化
- [x] サービスアカウント作成（`welfare-assist-sa`）
- [x] IAM権限付与（`roles/aiplatform.user`）
- [x] Application Default Credentials設定
- [x] `.env.local` ファイル作成
- [ ] Vertex AI SDKへのコード移行
- [ ] ローカル環境での動作確認
- [ ] Cloud Runへのデプロイ（オプション）

---

## 15. 次のステップ

1. **コードの移行**: `@google/genai` → `@google-cloud/vertexai`
2. **ローカルテスト**: 議事録生成機能のテスト
3. **CI/CD構築**: GitHub ActionsでのWorkload Identity設定
4. **モニタリング**: Cloud Loggingでの監視設定

---

## 16. 参考リンク

- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)
- [Workload Identity Documentation](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [Application Default Credentials](https://cloud.google.com/docs/authentication/application-default-credentials)
- [Gemini API Pricing](https://cloud.google.com/vertex-ai/pricing)

---

## 変更履歴

| 日付 | 変更内容 | 担当者 |
|------|---------|--------|
| 2025-12-12 | Vertex AI + Workload Identity設定完了 | yoriko.kikunaga@aozora-cg.com |

---

**最終更新**: 2025-12-12
**認証方式**: Workload Identity（ADC）
**ドキュメント管理者**: yoriko.kikunaga@aozora-cg.com
