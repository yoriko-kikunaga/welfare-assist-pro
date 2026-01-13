# データ自動同期システム

## 概要

WelfareAssist Proは、Google Sheets・Kintone・サービスチェックシートから自動的にデータを取得し、Firebase Hostingにデプロイします。

- **daily sync**: Google Sheets（8,469件）+ Kintone（変更レコード）+ サービスチェックシート（介護保険レンタル1,448件）を一括取得
- **実行時刻**: 毎日00:00 JST
- **実行環境**: GitHub Actions
- **デプロイ先**: Firebase Hosting

---

## 現在の運用状況

### 自動同期スケジュール

| 種類 | 実行時刻 | データソース | ワークフロー |
|------|---------|-------------|-------------|
| daily sync | 毎日00:00 JST | Google Sheets + Kintone | `.github/workflows/daily-sync.yml` |

### データフロー

```
Google Sheets (8,469 clients)        ──┐
                                       │
Kintone (change records)             ──┼──> clients.json
                                       │
Service Check Sheet (1,448 rentals)  ──┘
                                       ↓
                                Firestore edits merge
                                       ↓
                                  vite build
                                       ↓
                               Firebase Hosting
```

**実行タイミング:** 毎日00:00 JST

**重要な修正（2026-01-08）:**
- `importSpreadsheetData.cjs`は既存の`changeRecords`を保持するようになりました
- これにより、スプレッドシート同期実行時にKintoneデータが消失しないようになりました

---

## 手動実行

ローカル環境で同期を実行する場合：

```bash
# 1. Google Sheetsから同期（既存changeRecords, selectedEquipmentを保持）
node importSpreadsheetData.cjs

# 2. Kintoneから同期（changeRecordsを追加）
node importFromKintone.cjs

# 3. サービスチェックシートから同期（介護保険レンタル用具を追加）
node importServiceCheckSheet.cjs

# 4. publicフォルダにコピー
cp clients.json public/assets/clients.json

# 5. ビルド＆デプロイ
npm run build
firebase deploy --only hosting
```

**実行順序が重要:**
- `importSpreadsheetData.cjs` → `importFromKintone.cjs` → `importServiceCheckSheet.cjs`の順で実行
- この順序により、Google Sheets、Kintone、サービスチェックシートのデータが正しく統合されます

---

## トラブルシューティング

### 同期が失敗する

**確認項目:**
1. GitHub Actions実行ログを確認
   - リポジトリページ > Actions > 該当ワークフロー
2. Secret変数が正しく設定されているか
   - `GCP_SA_KEY`: サービスアカウントキー
   - `KINTONE_API_TOKEN_184`: Kintoneアプリ184のAPIトークン
   - `KINTONE_API_TOKEN_197`: Kintoneアプリ197のAPIトークン

### データが反映されない

**原因と対処:**

| 症状 | 原因 | 対処方法 |
|------|------|---------|
| 新しいデータが表示されない | `public/assets/clients.json`が古い | `cp clients.json public/assets/clients.json`を実行 |
| Kintoneデータが消える | スプレッドシート同期がchangeRecordsを上書き | 最新版では修正済み。コードを更新してください |
| Firestoreの編集が消える | マージ処理の不具合 | `firestoreService.ts`の`mergeAllClientEdits()`を確認 |
| 介護保険レンタルが消える | daily-sync.ymlにサービスチェックシート同期がない | 2026-01-13修正済み。ワークフローを更新 |

### changeRecordsが消失する問題（修正済み）

**以前の問題:**
- `importSpreadsheetData.cjs`が`changeRecords: []`で初期化していた
- Kintoneデータが次の同期で消失

**修正内容（commit 979e961）:**
```javascript
// 既存のclients.jsonからchangeRecordsを読み込む
const existingClient = existingClients.find(c => c.aozoraId === aozoraId);
const changeRecords = existingClient?.changeRecords || [];

// 新しいclientオブジェクトを作成時に既存changeRecordsを保持
return {
  // ...
  changeRecords: changeRecords, // 既存データを保持
  // ...
};
```

---

## 運用コスト

| 項目 | 使用量 | コスト |
|------|--------|--------|
| GitHub Actions | 毎日1回実行 | $0（無料枠内） |
| Firebase Hosting | ~10GB/月 | $0（無料枠内） |
| Firestore | 読み取り・書き込み | $0（無料枠内） |
| **合計** | - | **$0/月** |

---

## 詳細情報

- **GitHub Actions設定**: [GITHUB_ACTIONS_SETUP.md](./GITHUB_ACTIONS_SETUP.md)
- **データ構造**: [README.md](./README.md) - データモデルセクション
- **開発ガイド**: [CLAUDE.md](./CLAUDE.md)

---

## 関連リンク

- [GitHub Actions実行履歴](https://github.com/yoriko-kikunaga/welfare-assist-pro/actions)
- [Firebase Hosting](https://welfare-assist-pro.web.app)
- [Firebase Console](https://console.firebase.google.com/project/welfare-assist-pro/hosting)
- [Google Sheets: あおぞらIDマスタ](https://docs.google.com/spreadsheets/d/1DhwY6F1LaveixKXtie80fn7FWBYYqsGsY3ADU37CIAA)
