# スプレッドシート自動同期セットアップガイド

このドキュメントでは、Googleスプレッドシートのデータを1時間ごとに自動的に取り込み、WelfareAssist Proアプリケーションを更新する方法を説明します。

## 🎯 概要

**自動同期の仕組み:**
1. Googleスプレッドシート「あおぞらIDマスタ：自動反映」からデータを取得
2. 8,402件の利用者データをJSON形式に変換
3. Reactアプリケーションをビルド
4. Firebase Hostingに自動デプロイ

**実行環境:** Google Cloud Build

---

## ✅ 完了済みのセットアップ

以下のセットアップは既に完了しています：

### 1. Google Cloud Platformの設定

- ✅ Cloud Build API有効化
- ✅ Cloud Scheduler API有効化
- ✅ Secret Manager API有効化
- ✅ Google Sheets API有効化

### 2. 認証情報の設定

- ✅ サービスアカウント `welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com` 作成
- ✅ スプレッドシートへの閲覧権限付与
- ✅ Service Account Keyを Secret Managerに保存（`service-account-key`）

### 3. ビルド設定

- ✅ `cloudbuild.yaml` 作成（5ステップのビルドプロセス）
- ✅ `importSpreadsheetData.cjs` 作成（スプレッドシート→JSON変換スクリプト）
- ✅ GCSバケット `welfare-assist-pro-source` 作成

### 4. 権限設定

- ✅ Cloud BuildにSecret Manager アクセス権限付与
- ✅ Cloud BuildにFirebase Hosting デプロイ権限付与

---

## 🚀 手動実行方法

### ローカル環境で実行

```bash
# 1. スプレッドシートデータを取得
node importSpreadsheetData.cjs

# 2. アプリケーションをビルド
npm run build

# 3. Firebase Hostingにデプロイ
firebase deploy --only hosting

# または、全てを一括実行
bash sync-and-deploy.sh
```

### Cloud Buildで実行

```bash
gcloud builds submit \
  --config=cloudbuild.yaml \
  --gcs-source-staging-dir=gs://welfare-assist-pro-source/staging \
  --project=welfare-assist-pro \
  --timeout=30m
```

**実行時間:** 約3分

**コスト:** 約0.01ドル/回（Cloud Build無料枠内）

---

## ⏰ 1時間ごとの自動実行設定（オプション）

Cloud Schedulerを使って1時間ごとに自動実行するには、以下の手順を実行します。

### 方法1: シンプルなスケジューラー設定

GCPコンソールから手動で設定：

1. **Cloud Schedulerジョブを作成:**
   - URL: `https://cloudbuild.googleapis.com/v1/projects/389880096786/builds`
   - メソッド: POST
   - スケジュール: `0 * * * *`（毎時0分）
   - 認証: OAuth トークン
   - サービスアカウント: `389880096786@cloudbuild.gserviceaccount.com`

2. **リクエストボディ:**
   ```json
   {
     "source": {
       "storageSource": {
         "bucket": "welfare-assist-pro-source",
         "object": "staging/[最新のtar.gzファイル名]"
       }
     }
   }
   ```

### 方法2: GitHub Actionsを使用（推奨）

GitHubリポジトリに以下のワークフローファイルを追加：

`.github/workflows/hourly-sync.yml`:
```yaml
name: Hourly Spreadsheet Sync

on:
  schedule:
    - cron: '0 * * * *'  # 毎時0分に実行
  workflow_dispatch:  # 手動実行も可能

jobs:
  sync-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Setup GCP credentials
        uses: google-github-actions/auth@v1
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Import spreadsheet data
        run: node importSpreadsheetData.cjs

      - name: Build application
        run: npm run build

      - name: Deploy to Firebase
        run: |
          npm install -g firebase-tools
          firebase deploy --only hosting --project=welfare-assist-pro --non-interactive
        env:
          GOOGLE_APPLICATION_CREDENTIALS: ${{ steps.auth.outputs.credentials_file_path }}
```

**GitHub Secretsに追加:**
- `GCP_SA_KEY`: サービスアカウントキーのJSON（`service-account-key.json`の内容）
- `MAIL_USERNAME`: 送信用Gmailアドレス
- `MAIL_PASSWORD`: Gmailアプリパスワード
- `KINTONE_API_TOKEN_184`: KintoneアプリID 184のAPIトークン
- `KINTONE_API_TOKEN_197`: KintoneアプリID 197のAPIトークン

---

## 📧 メール通知の設定

自動同期が完了すると、指定したメールアドレスに通知が送信されます。

### 通知先
- **メールアドレス:** yoriko.kikunaga@aozora-cg.com
- **通知タイミング:**
  - 毎時0分（スプレッドシート同期）
  - 毎日00:00 JST（Kintone同期）
  - 成功時・失敗時の両方

### メール通知の設定手順

#### 1. Gmailでアプリパスワードを生成

1. Google アカウントにログイン
2. [セキュリティ設定](https://myaccount.google.com/security) にアクセス
3. 「2段階認証プロセス」を有効化（必須）
4. 「アプリパスワード」を選択
5. アプリを選択: 「メール」
6. デバイスを選択: 「その他（カスタム名）」→ 「GitHub Actions」と入力
7. 生成された16文字のパスワードをコピー

#### 2. GitHub Secretsに追加

1. GitHubリポジトリ: https://github.com/yoriko-kikunaga/welfare-assist-pro
2. Settings → Secrets and variables → Actions
3. 「New repository secret」をクリック
4. 以下の2つのSecretを追加:

**MAIL_USERNAME:**
```
送信用のGmailアドレス（例: your-email@gmail.com）
```

**MAIL_PASSWORD:**
```
ステップ1で生成した16文字のアプリパスワード
```

#### 3. メール通知の内容

**件名:**
- `[WelfareAssist] 1時間ごとのデータ同期 - 成功` （hourly sync）
- `[WelfareAssist] 毎日のKintone同期 - 成功` （daily sync）

**本文:**
- 実行タイプ（スプレッドシート同期 or Kintone同期）
- 実行日時
- ステータス（success / failure）
- アプリURL
- 実行ログへのリンク

### トラブルシューティング

**メールが届かない場合:**

1. **GitHub Secretsの確認**
   - `MAIL_USERNAME` と `MAIL_PASSWORD` が正しく設定されているか確認

2. **Gmailの設定確認**
   - 2段階認証が有効になっているか確認
   - アプリパスワードが正しく生成されているか確認

3. **スパムフォルダを確認**
   - 初回送信時はスパムに分類される可能性があります

4. **GitHub Actionsのログを確認**
   - リポジトリの「Actions」タブでワークフローの実行ログを確認
   - メール送信ステップでエラーが発生していないか確認

---

## 📊 現在のデータ状況

- **スプレッドシート名:** あおぞらIDマスタ：自動反映
- **総利用者数:** 8,402件
  - 施設入居者: 622件
  - 在宅: 7,780件

**データマッピング:**
- 「利用者」シート → 基本情報（氏名、生年月日、性別など）
- 「施設利用者」シート → 施設情報（施設名、居室番号）

---

## 🔧 トラブルシューティング

### エラー: "Permission denied"

**原因:** サービスアカウントの権限不足

**解決策:**
```bash
# Secret Managerアクセス権限を確認
gcloud projects get-iam-policy welfare-assist-pro \
  --flatten="bindings[].members" \
  --filter="bindings.members:389880096786@cloudbuild.gserviceaccount.com"

# 権限を追加
gcloud projects add-iam-policy-binding welfare-assist-pro \
  --member="serviceAccount:389880096786@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### エラー: "Spreadsheet not found"

**原因:** サービスアカウントがスプレッドシートにアクセスできない

**解決策:**
スプレッドシートを以下のアカウントと共有：
```
welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com
```
権限: 閲覧者

### ビルドが遅い

**原因:** 8,402件の大量データをビルドに含めている

**改善策:**
- データをバックエンドAPIから取得する構成に変更
- ページネーション機能を追加
- 初回読み込み時のみ最新データを取得

---

## 💰 コスト見積もり

**1時間ごとの実行（月間720回）:**
- Cloud Build: 720回 × 3分 = 2,160分/月
  - 無料枠: 120分/日 = 3,600分/月
  - **コスト: $0（無料枠内）**
- Cloud Scheduler: 720回/月
  - 無料枠: 3回/月
  - **コスト: $0.10/月**
- GCS（ストレージ）: 1MB未満
  - **コスト: $0**

**合計: 約$0.10/月**

---

## 📝 メンテナンス

### ソースコードを更新する場合

1. ローカルで変更を加える
2. 新しいアーカイブを作成してGCSにアップロード：
   ```bash
   tar -czf source.tar.gz --exclude=node_modules --exclude=dist --exclude=.git \
     App.tsx components/ types.ts index.tsx index.html package.json \
     tsconfig.json vite.config.ts cloudbuild.yaml importSpreadsheetData.cjs \
     .firebaserc firebase.json

   gsutil cp source.tar.gz gs://welfare-assist-pro-source/
   ```

3. Cloud Buildを実行して動作確認

---

## 🔗 関連リンク

- [Cloud Build ダッシュボード](https://console.cloud.google.com/cloud-build/builds?project=welfare-assist-pro)
- [Firebase Hosting コンソール](https://console.firebase.google.com/project/welfare-assist-pro/hosting)
- [Secret Manager](https://console.cloud.google.com/security/secret-manager?project=welfare-assist-pro)
- [公開URL](https://welfare-assist-pro.web.app)

---

## ✅ 次のステップ（推奨）

1. **GitHub Actions設定** - より信頼性の高い自動化
2. **監視・アラート設定** - ビルド失敗時の通知
3. **バックアップ戦略** - データ損失対策
4. **パフォーマンス最適化** - 読み込み速度改善
