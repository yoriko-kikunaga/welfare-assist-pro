# データ同期・運用ガイド

## 概要

WelfareAssist Proのデータ同期システム。

| 種類 | 実行 | データソース | 頻度 |
|------|------|-------------|------|
| **Daily Sync** | 自動 | Google Sheets（自費レンタル、販売） + Kintone | 毎日00:00 JST |
| **Monthly Sync** | 自動 | サービスチェックシート（介護保険レンタル） | 毎月1日09:00 JST |

**デプロイ先**: https://welfare-assist-pro.web.app

---

## Daily Sync（自動）

GitHub Actionsで毎日00:00 JSTに自動実行。

```
Google Sheets (8,492件) ──┐
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

## Monthly Sync（自動）

サービスチェックシートから介護保険レンタル用具をインポート。

**ワークフロー**: `.github/workflows/monthly-service-check.yml`
**スケジュール**: 毎月1日09:00 JST（手動実行も可能）

### 手動実行（ローカル）

```bash
node importServiceCheckSheet.cjs
cp clients.json public/assets/clients.json
npm run build && firebase deploy --only hosting
git add clients.json && git commit -m "chore: Monthly service check update" && git push
```

**注意**: 介護保険レンタルはこのスクリプトでのみ管理。日次同期では介護保険レンタルを保持しない（重複防止）。

---

## データ整合性メンテナンス

### Firestoreクリーンアップ

介護保険レンタルはclients.jsonからのみ取得される設計。Firestoreに介護保険レンタルが存在すると重複表示される。

```bash
# Firestoreから介護保険レンタルを削除（重複解消）
node -e "
const admin = require('firebase-admin');
const sa = require('./service-account-key.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

db.collection('clientEdits').get().then(snap => {
  snap.forEach(async doc => {
    const data = doc.data();
    const eq = data.selectedEquipment || [];
    const filtered = eq.filter(e => e.status !== '介護保険レンタル');
    if (eq.length !== filtered.length) {
      await doc.ref.update({ selectedEquipment: filtered });
      console.log('Updated:', doc.id);
    }
  });
});
"
```

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
| 介護保険レンタル重複 | Firestoreクリーンアップを実行（上記参照） |
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
