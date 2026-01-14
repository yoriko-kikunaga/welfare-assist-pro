# データ同期・運用ガイド

## 概要

WelfareAssist Proのデータ同期システム。

| 種類 | 実行 | データソース | 頻度 |
|------|------|-------------|------|
| **Daily Sync** | 自動 | Google Sheets + Kintone | 毎日00:00 JST |
| **Weekly Sync** | 手動 | サービスチェックシート | 週1回程度 |

**デプロイ先**: https://welfare-assist-pro.web.app

---

## Daily Sync（自動）

GitHub Actionsで毎日00:00 JSTに自動実行。

```
Google Sheets (8,469件) ──┐
                          ├──> clients.json ──> Firebase Hosting
Kintone (変更レコード)   ──┘
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

## Weekly Sync（手動）

サービスチェックシートから介護保険レンタル用具をインポート。

```bash
node importServiceCheckSheet.cjs
cp clients.json public/assets/clients.json
npm run build && firebase deploy --only hosting
git add clients.json && git commit -m "chore: Weekly update" && git push
```

---

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| データが反映されない | `cp clients.json public/assets/clients.json` 実行後に再デプロイ |
| 同期が失敗する | GitHub Actions > 該当ワークフローのログを確認 |
| Secretsエラー | リポジトリ Settings > Secrets でキーを再設定 |

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
