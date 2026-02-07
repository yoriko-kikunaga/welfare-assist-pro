# データ同期・運用ガイド

## 概要

WelfareAssist Proのデータ同期システム。

| 種類 | 実行 | データソース | 頻度 |
|------|------|-------------|------|
| **Daily Sync** | 自動 | Google Sheets（自費レンタル、販売） + Kintone | 毎日00:00 JST |
| **月次CSVインポート** | 手動 | カイポケCSV（介護保険レンタル） | 月次（ブラウザ） |

**デプロイ先**: https://welfare-assist-pro.web.app

---

## Daily Sync（自動）

GitHub Actionsで毎日00:00 JSTに自動実行。

```
Google Sheets ──────────┐
                        ├──> clients.json ──> Firebase Hosting
Kintone (変更レコード) ──┘
```

**ワークフロー**: `.github/workflows/daily-sync.yml`

### 必要なGitHub Secrets

| Secret名 | 内容 |
|----------|------|
| `GCP_SA_KEY` | GCPサービスアカウントキー（JSON） |
| `KINTONE_API_TOKEN_184` | Kintone App 184 APIトークン |
| `KINTONE_API_TOKEN_197` | Kintone App 197 APIトークン |

### 手動実行（ローカル）

```bash
node importSpreadsheetData.cjs
node importFromKintone.cjs
cp clients.json public/assets/clients.json
npm run build && firebase deploy --only hosting
```

---

## 月次CSVインポート（手動）

カイポケからエクスポートしたCSVをブラウザでインポート。

**操作場所**: 月次売上処理ページ → 介護保険レンタルタブ → CSVインポートセクション

### カイポケからのCSVエクスポート

1. カイポケにログイン
2. サービスチェックシートをCSVエクスポート → `サービスチェックシート.csv`
3. 利用者請求をCSVエクスポート → `利用者請求.csv`

### インポート手順

1. 「サービスチェックシート.csv」を選択（必須）
2. 「利用者請求.csv」を選択（必須、請求データ未紐づけの利用者はインポート除外）
3. 「プレビュー」ボタンで確認
   - マッチ成功数、未マッチ利用者、品目数、売上総額を確認
   - 未マッチ利用者がいる場合は詳細を確認
4. 「インポート実行」でFirestoreに保存

**動作フロー**:
1. CSVをShift-JISからUTF-8に変換
2. 外字（異体字）を自動正規化
3. 被保険者番号 → 名前 → カナの順でマッチング
4. 既存の介護保険レンタルを洗い替え（削除→新規追加）
5. 自費レンタル・販売は保持

**外字対応**: 異体字（高→髙、富→冨など）は自動で正規化されるため、手動マッチング設定は不要。

---

## データ整合性メンテナンス

### 福祉用具利用者フラグ修正

用具の有無と`isWelfareEquipmentUser`フラグの不整合を修正。

```bash
# フラグ整合性チェック
node -e "
const c = require('./clients.json');
const withEq = c.filter(x => (x.selectedEquipment||[]).length > 0);
const flagged = c.filter(x => x.isWelfareEquipmentUser === true);
console.log('用具あり:', withEq.length, 'フラグあり:', flagged.length);
"
```

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| データが反映されない | `cp clients.json public/assets/clients.json` 実行後に再デプロイ |
| 同期が失敗する | GitHub Actions > 該当ワークフローのログを確認 |
| Secretsエラー | リポジトリ Settings > Secrets でキーを再設定 |
| CSVインポートで未マッチ | 利用者マスターに登録後、再度インポート |
| 福祉用具利用者数が不正 | フラグ整合性チェック・修正を実行 |

---

## 運用コスト

すべて無料枠内で運用。

| サービス | コスト |
|----------|--------|
| GitHub Actions（1回/日） | $0 |
| Firebase Hosting | $0 |
| Firestore | $0 |

---

## 関連リンク

- [GitHub Actions実行履歴](https://github.com/yoriko-kikunaga/welfare-assist-pro/actions)
- [Firebase Console](https://console.firebase.google.com/project/welfare-assist-pro/hosting)
- [本番サイト](https://welfare-assist-pro.web.app)
