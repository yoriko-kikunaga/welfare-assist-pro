# 初期セットアップ履歴

このファイルは初期セットアップ時の記録をアーカイブしたものです。通常の運用では参照不要です。

---

## セットアップ完了日

- **GCPプロジェクト作成**: 2025-12-12
- **Firebase Hosting設定**: 2025-12-13
- **GitHub Actions設定**: 2025-12-22
- **Firestore設定**: 2025-12-25

---

## GCPプロジェクト

- **プロジェクトID**: `welfare-assist-pro`
- **リージョン**: `asia-northeast1`（東京）
- **サービスアカウント**: `welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com`

### 有効化済みAPI

- Firebase API
- Firebase Hosting API
- Firestore API
- Sheets API

---

## Firebase設定

- **Hosting URL**: https://welfare-assist-pro.web.app
- **デプロイディレクトリ**: `dist/`（Viteビルド出力）
- **Firestore**: clientEditsコレクションでユーザー編集を永続化

---

## GitHub Actions

- **ワークフロー**: `.github/workflows/daily-sync.yml`
- **実行時刻**: 毎日00:00 JST（15:00 UTC）
- **必要なSecrets**: `GCP_SA_KEY`, `KINTONE_API_TOKEN_184`, `KINTONE_API_TOKEN_197`

---

## 認証情報の場所

| 項目 | 保存場所 |
|------|---------|
| GCPサービスアカウントキー | GitHub Secrets (`GCP_SA_KEY`) |
| Kintone APIトークン | GitHub Secrets |
| Gemini API Key | 環境変数 (`GEMINI_API_KEY`) |
| Firebase設定 | `src/firebaseConfig.ts` |

---

*最終更新: 2026-01-14*
