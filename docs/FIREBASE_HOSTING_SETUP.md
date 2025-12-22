# Firebase Hosting セットアップドキュメント

## 概要

WelfareAssist ProのFirebase Hosting設定ガイドです。本ドキュメントでは、GCPプロジェクト`welfare-assist-pro`でのFirebase Hosting構成について説明します。

---

## 1. 前提条件

- ✅ Google Cloud SDK（gcloud CLI）インストール済み
- ✅ GCPプロジェクト作成済み（`welfare-assist-pro`）
- ✅ 課金アカウントリンク済み
- ✅ Firebase CLI インストール済み

---

## 2. Firebase CLIのインストール

### インストールコマンド

```bash
npm install -g firebase-tools
```

### バージョン確認

```bash
firebase --version
```

**インストール済みバージョン**: 15.0.0

---

## 3. Firebase認証

### gcloud認証との統合

Firebase CLIはgcloud CLIの認証情報を自動的に使用します。

```bash
# gcloud認証の確認
gcloud auth list

# Application Default Credentialsの確認
gcloud auth application-default print-access-token
```

**認証済みアカウント**: yoriko.kikunaga@aozora-cg.com

---

## 4. Firebase Admin権限の付与

Firebase Hostingを使用するには、Firebase Admin権限が必要です。

### 権限付与コマンド

```bash
gcloud projects add-iam-policy-binding welfare-assist-pro \
  --member='user:yoriko.kikunaga@aozora-cg.com' \
  --role='roles/firebase.admin'
```

### 付与された権限

| ロール | 権限内容 |
|--------|---------|
| `roles/firebase.admin` | Firebase全機能の管理権限 |

---

## 5. Firebase API有効化

### 必要なAPIの有効化

```bash
gcloud services enable \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  --project=welfare-assist-pro
```

### 有効化されたAPI一覧

1. **Firebase API** (`firebase.googleapis.com`)
   - Firebaseコア機能

2. **Firebase Hosting API** (`firebasehosting.googleapis.com`)
   - 静的サイトホスティング

---

## 6. Firebase設定ファイル

### firebase.json

Firebase Hostingの基本設定ファイルです。

**ファイルパス**: `C:\Users\acgpa\welfare-assist-pro\firebase.json`

```json
{
  "hosting": {
    "public": "public",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

#### 設定項目の説明

| 項目 | 値 | 説明 |
|------|-----|------|
| `public` | `"public"` | 公開ディレクトリ |
| `ignore` | 配列 | デプロイから除外するファイル |
| `rewrites` | 配列 | URLリライトルール（SPAサポート） |

---

### .firebaserc

プロジェクトIDを設定するファイルです。

**ファイルパス**: `C:\Users\acgpa\welfare-assist-pro\.firebaserc`

```json
{
  "projects": {
    "default": "welfare-assist-pro"
  }
}
```

---

## 7. 公開ディレクトリ構成

### ディレクトリ構造

```
welfare-assist-pro/
├── public/
│   └── index.html          # デプロイ成功ページ
├── firebase.json           # Firebase設定
├── .firebaserc             # プロジェクト設定
└── .gitignore              # Git除外設定
```

### public/index.html

**デプロイ成功メッセージ**を含むサンプルページ：

```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>WelfareAssist Pro - Firebase Hosting</title>
    <!-- レスポンシブデザイン -->
    <!-- グラデーション背景 -->
    <!-- アニメーション効果 -->
</head>
<body>
    <h1>デプロイ成功！</h1>
    <p>Firebase Hostingが正常に動作しています</p>
    <!-- プロジェクト情報カード -->
</body>
</html>
```

**特徴**:
- ✅ レスポンシブデザイン
- ✅ グラデーション背景
- ✅ フェードインアニメーション
- ✅ プロジェクト情報表示
- ✅ タイムスタンプ表示

---

## 8. Firebase Hostingのデプロイ

### デプロイコマンド

```bash
# プロジェクトルートで実行
firebase deploy --only hosting
```

### デプロイの流れ

1. `public/`ディレクトリのファイルをアップロード
2. CDNへの配信設定
3. SSL証明書の自動プロビジョニング
4. グローバルエッジサーバーへの配信

### デプロイ完了後

デプロイが成功すると、以下のURLでアクセス可能になります：

```
https://welfare-assist-pro.web.app
https://welfare-assist-pro.firebaseapp.com
```

---

## 9. カスタムドメインの設定（オプション）

### カスタムドメイン追加

```bash
firebase hosting:channel:deploy <channel-name>
```

### 手順

1. **Firebase Consoleにアクセス**
   ```
   https://console.firebase.google.com/project/welfare-assist-pro/hosting
   ```

2. **カスタムドメインを追加**
   - 「カスタムドメインを追加」をクリック
   - ドメイン名を入力
   - DNS レコードを設定

3. **SSL証明書の自動発行**
   - Firebase Hostingが自動的にSSL証明書を発行

---

## 10. GitHub Actions連携（CI/CD）

### GitHub Actions ワークフロー

Firebase Hostingは自動デプロイをサポートしています。

#### .github/workflows/firebase-hosting-merge.yml

```yaml
name: Deploy to Firebase Hosting on merge
on:
  push:
    branches:
      - main

jobs:
  build_and_deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install Dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Deploy to Firebase Hosting
        uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          channelId: live
          projectId: welfare-assist-pro
```

### サービスアカウントキーの作成

```bash
gcloud iam service-accounts create github-actions \
  --display-name="GitHub Actions Service Account" \
  --project=welfare-assist-pro

gcloud projects add-iam-policy-binding welfare-assist-pro \
  --member="serviceAccount:github-actions@welfare-assist-pro.iam.gserviceaccount.com" \
  --role="roles/firebase.hostingAdmin"

gcloud iam service-accounts keys create firebase-sa-key.json \
  --iam-account=github-actions@welfare-assist-pro.iam.gserviceaccount.com
```

### GitHub Secretsに追加

1. GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」
2. 「New repository secret」をクリック
3. Name: `FIREBASE_SERVICE_ACCOUNT`
4. Value: `firebase-sa-key.json`の内容を貼り付け

---

## 11. デプロイプレビュー（Pull Request時）

### プレビューチャンネルの作成

```bash
firebase hosting:channel:deploy preview-<pr-number>
```

### GitHub Actionsでの自動プレビュー

#### .github/workflows/firebase-hosting-pull-request.yml

```yaml
name: Deploy to Firebase Hosting on PR
on: pull_request

jobs:
  build_and_preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci && npm run build

      - uses: FirebaseExtended/action-hosting-deploy@v0
        with:
          repoToken: '${{ secrets.GITHUB_TOKEN }}'
          firebaseServiceAccount: '${{ secrets.FIREBASE_SERVICE_ACCOUNT }}'
          projectId: welfare-assist-pro
```

---

## 12. Firebase Hosting設定の詳細

### リダイレクト設定

```json
{
  "hosting": {
    "redirects": [
      {
        "source": "/old-page",
        "destination": "/new-page",
        "type": 301
      }
    ]
  }
}
```

### ヘッダー設定

```json
{
  "hosting": {
    "headers": [
      {
        "source": "**/*.@(jpg|jpeg|gif|png|webp)",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "max-age=31536000"
          }
        ]
      }
    ]
  }
}
```

### カスタム404ページ

```json
{
  "hosting": {
    "public": "public",
    "cleanUrls": true,
    "trailingSlash": false,
    "appAssociation": "AUTO",
    "404": "404.html"
  }
}
```

---

## 13. パフォーマンス最適化

### Firebase Hostingの特徴

1. **グローバルCDN**
   - 世界中のエッジサーバーから配信
   - 低レイテンシー

2. **HTTP/2サポート**
   - 高速なコンテンツ配信

3. **自動圧縮**
   - gzip/Brotli圧縮を自動適用

4. **SSL証明書**
   - 無料のSSL証明書を自動プロビジョニング

### キャッシュ戦略

```json
{
  "hosting": {
    "headers": [
      {
        "source": "/static/**",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=31536000, immutable"
          }
        ]
      },
      {
        "source": "**/*.html",
        "headers": [
          {
            "key": "Cache-Control",
            "value": "public, max-age=0, must-revalidate"
          }
        ]
      }
    ]
  }
}
```

---

## 14. トラブルシューティング

### デプロイエラー

#### エラー: "Permission denied"

**原因**: Firebase Admin権限が不足

**解決方法**:
```bash
gcloud projects add-iam-policy-binding welfare-assist-pro \
  --member='user:yoriko.kikunaga@aozora-cg.com' \
  --role='roles/firebase.admin'
```

#### エラー: "Project not found"

**原因**: `.firebaserc`の設定が間違っている

**解決方法**:
```bash
# .firebasercを確認
cat .firebaserc

# プロジェクトを再設定
firebase use --add welfare-assist-pro
```

### デプロイ後にサイトが表示されない

1. **キャッシュをクリア**
   - ブラウザのキャッシュをクリア
   - Ctrl + Shift + R（強制リロード）

2. **デプロイ状態を確認**
   ```bash
   firebase hosting:channel:list
   ```

3. **Firebase Consoleで確認**
   ```
   https://console.firebase.google.com/project/welfare-assist-pro/hosting
   ```

---

## 15. セキュリティ設定

### Firebase Security Rules（Firestore/Storage用）

Hosting自体にはSecurity Rulesはありませんが、FirestoreやStorageを使用する場合は設定が必要です。

```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### CORS設定

```json
{
  "hosting": {
    "headers": [
      {
        "source": "**",
        "headers": [
          {
            "key": "Access-Control-Allow-Origin",
            "value": "*"
          }
        ]
      }
    ]
  }
}
```

---

## 16. コスト管理

### Firebase Hosting料金

| 項目 | 無料枠 | 超過料金 |
|------|--------|---------|
| **ストレージ** | 10 GB | $0.026/GB |
| **転送量** | 360 MB/日 | $0.15/GB |

### コスト最適化のヒント

1. **画像最適化**: WebP形式を使用
2. **コード分割**: 不要なJSを削除
3. **キャッシュ活用**: 適切なCache-Controlヘッダー
4. **CDN活用**: Firebase Hosting標準機能

---

## 17. モニタリング

### Firebase Consoleでの監視

```
https://console.firebase.google.com/project/welfare-assist-pro/hosting
```

**確認項目**:
- デプロイ履歴
- トラフィック統計
- エラーログ

### Cloud Loggingとの統合

```bash
gcloud logging read "resource.type=firebase_domain" \
  --project=welfare-assist-pro \
  --limit=50
```

---

## 18. バックアップとロールバック

### デプロイ履歴の確認

```bash
firebase hosting:channel:list
```

### 以前のバージョンへのロールバック

Firebase Consoleから手動でロールバック可能：

1. Firebase Console → Hosting
2. 「リリース履歴」タブ
3. 以前のバージョンを選択
4. 「ロールバック」をクリック

---

## 19. 設定完了チェックリスト

- [x] Firebase CLI インストール
- [x] Firebase認証（gcloud統合）
- [x] Firebase Admin権限付与
- [x] Firebase API有効化
- [x] `firebase.json` 作成
- [x] `.firebaserc` 作成
- [x] `public/` ディレクトリ作成
- [x] `public/index.html` サンプルページ作成
- [x] Firebase Hostingへのデプロイ（完了: 2025-12-13）
- [ ] カスタムドメイン設定（オプション）
- [ ] GitHub Actions CI/CD設定（オプション）

---

## 20. 次のステップ

1. **デプロイ実行**
   ```bash
   firebase deploy --only hosting
   ```

2. **本番アプリケーションのビルド**
   ```bash
   npm run build
   # distフォルダをpublicにコピー
   ```

3. **CI/CDパイプライン構築**
   - GitHub Actionsワークフロー設定
   - 自動デプロイ有効化

4. **パフォーマンス測定**
   - Lighthouse監査
   - Core Web Vitals最適化

---

## 21. 参考リンク

- [Firebase Hosting Documentation](https://firebase.google.com/docs/hosting)
- [Firebase CLI Reference](https://firebase.google.com/docs/cli)
- [Firebase Hosting GitHub Action](https://github.com/FirebaseExtended/action-hosting-deploy)
- [Google Cloud Console - Firebase](https://console.firebase.google.com/)

---

## 変更履歴

| 日付 | 変更内容 | 担当者 |
|------|---------|--------|
| 2025-12-12 | Firebase Hosting初期設定完了 | yoriko.kikunaga@aozora-cg.com |
| 2025-12-13 | Firebase Hostingデプロイ完了 | yoriko.kikunaga@aozora-cg.com |

---

**最終更新**: 2025-12-13
**ドキュメント管理者**: yoriko.kikunaga@aozora-cg.com
