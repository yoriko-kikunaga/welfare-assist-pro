# GCPプロジェクトセットアップドキュメント

## プロジェクト概要

- **プロジェクト名**: WelfareAssist Pro
- **プロジェクトID**: `welfare-assist-pro`
- **プロジェクト番号**: `389880096786`
- **作成日**: 2025-12-12
- **アカウント**: yoriko.kikunaga@aozora-cg.com

---

## 1. 認証設定

### gcloud CLI認証

```bash
gcloud auth login
```

**認証済みアカウント**: yoriko.kikunaga@aozora-cg.com

**確認コマンド**:
```bash
gcloud auth list
```

---

## 2. プロジェクト作成

### プロジェクト作成コマンド

```bash
gcloud projects create welfare-assist-pro \
  --name="WelfareAssist Pro" \
  --set-as-default
```

**実行結果**:
- ✅ プロジェクトが正常に作成されました
- ✅ デフォルトプロジェクトとして設定されました

### プロジェクト情報確認

```bash
# 現在のプロジェクトIDを確認
gcloud config get-value project

# プロジェクト詳細を確認
gcloud projects describe welfare-assist-pro
```

---

## 3. 課金アカウント設定

### 課金アカウント確認

```bash
gcloud billing accounts list
```

**課金アカウント情報**:
- **ACCOUNT_ID**: `012FE1-C377F0-F8DE20`
- **ステータス**: Open（有効）

### 課金アカウントをプロジェクトにリンク

```bash
gcloud billing projects link welfare-assist-pro \
  --billing-account=012FE1-C377F0-F8DE20
```

**実行結果**:
```
billingAccountName: billingAccounts/012FE1-C377F0-F8DE20
billingEnabled: true
name: projects/welfare-assist-pro/billingInfo
projectId: welfare-assist-pro
```

✅ 課金が有効化されました

### 課金設定確認

```bash
gcloud billing projects describe welfare-assist-pro
```

---

## 4. API有効化

### 有効化したAPI一覧

以下のAPIを有効化しました：

1. **Generative Language API** (`generativelanguage.googleapis.com`)
   - Gemini AI統合用

2. **Cloud Run API** (`run.googleapis.com`)
   - コンテナベースのデプロイ用

3. **Cloud Build API** (`cloudbuild.googleapis.com`)
   - CI/CDパイプライン用

4. **Firebase API** (`firebase.googleapis.com`)
   - Firebase統合用

5. **Cloud Firestore API** (`firestore.googleapis.com`)
   - NoSQLデータベース用

6. **API Keys API** (`apikeys.googleapis.com`)
   - APIキー管理用

### API有効化コマンド

```bash
# Generative Language API
gcloud services enable generativelanguage.googleapis.com

# その他のAPI（一括）
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  firebase.googleapis.com \
  firestore.googleapis.com \
  apikeys.googleapis.com \
  --project=welfare-assist-pro
```

### 有効化されたAPIの確認

```bash
gcloud services list --enabled --project=welfare-assist-pro
```

---

## 5. APIキー設定

### Gemini APIキーの作成方法

#### オプション1: Google AI Studio（推奨）

1. **Google AI Studio**にアクセス
   ```
   https://aistudio.google.com/
   ```

2. yoriko.kikunaga@aozora-cg.comでログイン

3. 「**Get API key**」をクリック

4. 「**Create API key in existing project**」を選択

5. プロジェクト選択: **welfare-assist-pro**

6. APIキーをコピー

#### オプション2: gcloud CLI（要alphaコンポーネント）

```bash
# alphaコンポーネントのインストール
gcloud components install alpha

# APIキーの作成
gcloud alpha services api-keys create \
  --display-name="WelfareAssist Pro API Key" \
  --project=welfare-assist-pro

# APIキーの一覧表示
gcloud alpha services api-keys list --project=welfare-assist-pro
```

### APIキーの制限設定（推奨）

セキュリティのため、APIキーに以下の制限を設定することを推奨します：

1. **API制限**: Generative Language API のみに制限
2. **アプリケーション制限**: HTTP referrerまたはIPアドレス制限
3. **使用量の監視**: Cloud Consoleで定期的に確認

---

## 6. 環境変数設定

### .env.localファイルの作成

プロジェクトルートに `.env.local` ファイルを作成：

```bash
# プロジェクトルートディレクトリで実行
cd C:\Users\acgpa\welfare-assist-pro
```

`.env.local` の内容：
```env
GEMINI_API_KEY=your_api_key_here
```

**セキュリティ注意事項**:
- ✅ `.env.local` は `.gitignore` に含まれています
- ❌ APIキーをGitにコミットしないこと
- ❌ APIキーを公開リポジトリに含めないこと

### 環境変数の確認

```bash
# 開発サーバーで確認
npm run dev
```

---

## 7. プロジェクト設定の確認

### 現在の設定を確認するコマンド

```bash
# プロジェクト情報
gcloud config list

# 有効化されたAPI
gcloud services list --enabled

# 課金設定
gcloud billing projects describe welfare-assist-pro

# プロジェクト詳細
gcloud projects describe welfare-assist-pro
```

---

## 8. 追加設定（今後必要に応じて）

### Firebase初期化

```bash
# Firebase CLIのインストール
npm install -g firebase-tools

# Firebase認証
firebase login

# Firebaseプロジェクトの初期化
firebase init
```

### Cloud Runへのデプロイ

```bash
# Dockerfileを作成後
gcloud run deploy welfare-assist-pro \
  --source . \
  --platform managed \
  --region asia-northeast1 \
  --allow-unauthenticated
```

---

## 9. トラブルシューティング

### 課金が有効化されない場合

```bash
# 課金アカウントの再リンク
gcloud billing projects link welfare-assist-pro \
  --billing-account=012FE1-C377F0-F8DE20
```

### APIが有効化されない場合

```bash
# 個別にAPIを有効化
gcloud services enable [API_NAME] --project=welfare-assist-pro
```

### 認証エラーが発生する場合

```bash
# 認証トークンをクリア
gcloud auth revoke

# 再認証
gcloud auth login
```

---

## 10. セキュリティベストプラクティス

### APIキーの保護

1. **環境変数の使用**
   - ハードコードしない
   - `.env.local` ファイルを使用
   - `.gitignore` に必ず追加

2. **APIキーの制限**
   - 必要最小限のAPIのみに制限
   - IPアドレスまたはHTTP referrer制限
   - 定期的なキーのローテーション

3. **監視とアラート**
   - Cloud Consoleで使用量を監視
   - 異常な使用パターンを検知
   - 予算アラートの設定

### 課金の監視

```bash
# 課金情報の確認
gcloud billing accounts list

# プロジェクトの課金状態
gcloud billing projects describe welfare-assist-pro
```

**推奨**: Cloud Consoleで予算アラートを設定
- https://console.cloud.google.com/billing/

---

## 11. 参考リンク

- [Google Cloud Console](https://console.cloud.google.com/)
- [Google AI Studio](https://aistudio.google.com/)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Firebase Documentation](https://firebase.google.com/docs)

---

## 12. 設定完了チェックリスト

- [x] gcloud CLI認証完了
- [x] GCPプロジェクト作成（welfare-assist-pro）
- [x] 課金アカウントリンク完了
- [x] 必要なAPI有効化完了
  - [x] Generative Language API
  - [x] Cloud Run API
  - [x] Cloud Build API
  - [x] Firebase API
  - [x] Firestore API
  - [x] API Keys API
- [ ] Gemini APIキー作成（Google AI Studio）
- [ ] .env.local ファイル作成
- [ ] 環境変数設定
- [ ] 開発サーバーでの動作確認

---

## 変更履歴

| 日付 | 変更内容 | 担当者 |
|------|---------|--------|
| 2025-12-12 | 初版作成、GCPプロジェクトセットアップ完了 | yoriko.kikunaga@aozora-cg.com |

---

**最終更新**: 2025-12-12
**ドキュメント管理者**: yoriko.kikunaga@aozora-cg.com
