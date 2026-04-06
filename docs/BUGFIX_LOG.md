# バグ修正・障害対応ログ

運用中に発見・対応した不具合・障害の記録です。

---

## 2026-04-06

### isWelfareEquipmentUser の手動設定が定時更新で復元される

**事象**
アプリ上で「福祉用具利用者」チェックを外しても、翌朝の定時更新後に `true` に戻ってしまう。

**原因**
2か所のバグが重複していた。

1. `syncClientsToFirestore.cjs`（定時更新 Step9）が毎日 Kintone の値（clients.json）で Firestore の `isWelfareEquipmentUser` を強制上書きしていた。
2. `firestoreAdmin.cjs` のマージ処理が `isWelfareEquipmentUser === true` の場合のみ保持し、`false` の場合は保持しない設計になっていた（`_firestoreWelfareUserFlag` 変数に格納するだけで実際には使われていないデッドコード）。

**修正**
- `syncClientsToFirestore.cjs`: 既存 Firestore ドキュメントに `isWelfareEquipmentUser` が設定済みの場合は Kintone 値で上書きしない。
- `firestoreAdmin.cjs`: `true`/`false` どちらの場合でも Firestore の値を優先するよう変更。デッドコード削除。

**注意事項**
この修正により `isWelfareEquipmentUser` は Kintone 側が変わっても自動反映されなくなる。変更が必要な場合はアプリ上で手動設定する。

---

### スプレッドシート出力：退院日 9999-12-31 のレコードを除外

**事象**
「スプレッドシートに書き出し」実行時、退院日に仮の日付（`9999-12-31`）が入ったレコードも出力されてしまう。

**修正**
`functions/src/index.ts`（`syncChangeRecordsToSheets`）に除外フィルターを追加。`billingStartDateDischarge === '9999-12-31'` のレコードはスキップする。

---

## 2026-04-02

### レセプトチェック：退院後再入院時に入院日が表示されない

**事象**
入院→退院→再入院のように複数回入退院した利用者について、レセプトチェックに最新の入院日が表示されない。

**発見ケース**
五十嵐 マユミ様（ID: 7374）
- 2/14 入院 → 2/21 退院 → 2/27 再入院
- 3月のレセプトチェックに 2/27 入院日が表示されていなかった。

**原因**
`receiptCheckService.ts` の退院日クリア処理が「退院日（最小値）が月初より前」という条件だけでクリアしていた。2/21 退院が月初（3/1）より前であるため、後続の 2/27 再入院があるにもかかわらず入院日・退院日が両方消えていた。

**修正**
クリア条件を「最新退院日 ≥ 最新入院日（＝現在退院済み）かつ月初より前」に変更。再入院中（最新入院日 > 最新退院日）の場合はクリアしない。
対象箇所: `src/services/receiptCheckService.ts`（`refreshItemsFromClients` / `generateReceiptCheckFromClients` の2か所）。

---

## 2026-03-30

### 定時更新 6日間連続失敗（2026-03-24〜03-29）

**事象**
GitHub Actions の定時更新（Daily Data Sync）が 3/24〜3/29 の6日間連続で失敗。この期間の Kintone・スプレッドシートのデータが本番サイトに反映されなかった。

**原因**
3/24 のコミット（`d8f3965`）で `ReconciliationPage.tsx` と `ClientDetail.tsx` に以下のコンポーネント import が追加されたが、ファイル本体がコミットされておらずビルドエラーになっていた。

```
Could not resolve "./UnmatchedWholesalerItemsSection"
from "components/ReconciliationPage.tsx"
```

未コミットのままだったファイル：
- `components/UnmatchedWholesalerItemsSection.tsx`（卸品目未紐づけ一覧）
- `components/DocumentsTab.tsx`（書類管理タブ）
- `src/services/documentService.ts`（書類管理サービス）

**対処**
1. 上記3ファイルと `docs/manual/09_welfare-summary.md` をコミット・プッシュ。
2. GitHub Actions の手動実行（`workflow_dispatch`）で 3/24〜3/29 分のデータを即時反映。

**再発防止**
新しいコンポーネントを既存ファイルから import する際は、ファイル本体も必ず同じコミットに含める。

---

## 調査済み・対応保留

### スプレッドシート出力：isWelfareEquipmentUser: false の利用者がスキップされる

**事象**
「スプレッドシートに書き出し」実行時、一部の利用者の変更情報が出力されない。

**調査結果**
`syncChangeRecordsToSheets` Cloud Function が `isWelfareEquipmentUser: false` の利用者をスキップするため、新規手続き中・デモ中の利用者の変更情報が出力されない。

2026-02-01 以降で対象となる6名：

| 利用者名 | 種別 | 日付 |
|--------|------|------|
| 濵田 やす子（8044） | 新規 | 2026-03-28 |
| 前田 英子（8808） | 新規 | 2026-03-19 |
| 亀本 敏枝（8869） | 新規 | 2026-03-13 |
| 八波 正興（8873） | 新規 | 2026-03-28 |
| 中牟田 喨子（8882） | 新規 | 2026-03-31 |
| 小畑 美佐子（8370） | デモ | 2026-02-06 |

**状況**
方針整理後に対応予定。修正案：`isWelfareEquipmentUser` に関わらず変更情報がある利用者を全員出力対象にする。
