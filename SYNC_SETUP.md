# データ自動同期システム

## 概要

WelfareAssist Proは、Google Sheets・Kintoneから自動的にデータを取得し、Firebase Hostingにデプロイします。

- **daily sync（自動）**: Google Sheets（8,469件）+ Kintone（変更レコード）を毎日取得
- **weekly sync（手動）**: サービスチェックシート（介護保険レンタル1,448件）を週次で手動実行
- **実行時刻**: 毎日00:00 JST（daily sync）
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
【Daily Sync（自動・毎日00:00 JST）】
Google Sheets (8,469 clients)  ──┐
                                 ├──> clients.json ──> Firebase Hosting
Kintone (change records)       ──┘

【Weekly Sync（手動・週次）】
Service Check Sheet (1,448 rentals) ──> clients.json ──> Firebase Hosting
```

**重要:** サービスチェックシートのデータは週次で手動更新。Daily Syncでは上書きされません（既存データを保持）。

**重要な修正（2026-01-08）:**
- `importSpreadsheetData.cjs`は既存の`changeRecords`を保持するようになりました
- これにより、スプレッドシート同期実行時にKintoneデータが消失しないようになりました

**重要な修正（2026-01-13）:**
`importSpreadsheetData.cjs`が以下のデータを既存clients.jsonから保持するよう修正:
| フィールド | 説明 | 保持件数 |
|-----------|------|---------|
| `insuranceNumber` | 被保険者番号 | 574件 |
| `kaipokeRegistrationStatus` | カイポケ登録ステータス（登録済のみ） | 435件 |
| `selectedEquipment`（介護保険レンタル） | サービスチェックシートからの用具 | 365件（1,437アイテム） |

**重要な修正（2026-01-14）:**
`importSpreadsheetData.cjs`が追加で以下のデータも保持するよう修正:
| フィールド | 説明 |
|-----------|------|
| `selectedEquipment`（自費レンタル） | 手動追加された自費レンタル用具 |
| `selectedEquipment`（販売） | 手動追加された販売用具 |

これにより、Tab5「福祉用具選定」で入力モーダルから追加した自費レンタル・販売データがDaily Sync後も保持されます。

---

## 手動実行

### Daily Sync（通常は自動実行）

ローカル環境でDaily Syncを実行する場合：

```bash
# 1. Google Sheetsから同期（既存changeRecords, selectedEquipmentを保持）
node importSpreadsheetData.cjs

# 2. Kintoneから同期（changeRecordsを追加）
node importFromKintone.cjs

# 3. publicフォルダにコピー
cp clients.json public/assets/clients.json

# 4. ビルド＆デプロイ
npm run build
firebase deploy --only hosting
```

### Weekly Sync（週次・手動）

サービスチェックシートの更新（週1回程度）：

```bash
# 1. サービスチェックシートから同期（介護保険レンタル用具を追加）
node importServiceCheckSheet.cjs

# 2. publicフォルダにコピー
cp clients.json public/assets/clients.json

# 3. ビルド＆デプロイ
npm run build
firebase deploy --only hosting

# 4. 変更をコミット＆プッシュ
git add clients.json
git commit -m "chore: Weekly update - Service Check Sheet data"
git push
```

**注意:**
- Daily Syncは既存の`selectedEquipment`（サービスチェックシートデータ）を保持します
- Weekly Syncは任意のタイミングで手動実行してください

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
| 介護保険レンタルが古い | 週次更新が未実施 | Weekly Syncを手動実行（`node importServiceCheckSheet.cjs`） |
| 被保険者番号が消える | 古いバージョンのスクリプト | `importSpreadsheetData.cjs`を最新版に更新（commit ec7bb95） |
| カイポケ登録ステータスがリセット | 古いバージョンのスクリプト | `importSpreadsheetData.cjs`を最新版に更新（commit ec7bb95） |

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
