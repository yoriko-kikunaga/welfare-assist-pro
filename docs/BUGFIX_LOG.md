# バグ修正・障害対応ログ

運用中に発見・対応した不具合・障害の記録です。

---

## 2026-04-10

### 販売：金額内訳の表示・CSV出力を詳細化（小計・消費税・送料消費税・調整額）

**変更内容**

月次売上処理（販売タブ）および福祉用具選定タブ（販売入力モーダル）の金額列を以下のとおり変更。

| 変更前 | 変更後 |
|--------|--------|
| 単価・数量・税区分・税込金額・送料・総計 | 単価・数量・**小計**・税区分・**消費税**・税込金額・**送料（税抜）**・**送料消費税**・**調整額**・総計 |

- **小計** = 単価 × 数量
- **消費税** = 小計 × 税率（10%/軽8%/0）
- **税込金額** = 小計 + 消費税
- **送料（税抜）** = 入力値（税抜き扱い）
- **送料消費税** = 送料（税抜）× 10%（自動計算）
- **調整額** = 手動入力による端数調整（±）、`totalAdjustment` フィールドに保存
- **総計** = 税込金額 + 送料（税抜）+ 送料消費税 + 調整額

利用者負担額・申請額も総計ベースに変更（従来は税込金額のみ）。

対象ファイル: `components/MonthlySalesExport.tsx`、`components/ClientDetail.tsx`、`types.ts`

---

### 定時更新の取込漏れ回復（2026-03-24〜03-29 失敗分）

**事象**
3/24〜3/29 の定時更新失敗（ビルドエラー）により、この期間の Kintone・スプレッドシートデータが Firestore に反映されていなかった。4/10 に発覚。

**対処**
以下を手動実行して最新データに回復：
```bash
node importFromKintone.cjs       # Kintone変更レコード 1,111件 追加/更新
node importSpreadsheetData.cjs   # Googleスプレッドシートデータ同期
node syncClientsToFirestore.cjs  # Firestore clientEdits 975件更新・2件新規
```

---

### 変更情報スプレッドシートの未同期レコード追記（103件）

**事象**
`syncChangeRecordsToSheets` Cloud Function をアプリUIから実行しても「新規0件」となり、Kintone取込漏れ分のレコードがスプレッドシートに追記されなかった。

**原因**
Cloud Function は Firebase Auth が必要な Callable Function のため、コマンドラインから直接呼び出せなかった。また Firestore に取込漏れ分が反映されたのが Cloud Function 実行後だった。

**対処**
Cloud Function と同等のロジックをサービスアカウント認証で実行するスクリプトを一時作成し、103件を追記（実行後スクリプト削除）。

---

### 変更情報スプレッドシートの `9999-12-31` 行を実際の退院日に修正（31件）

**事象**
スプレッドシートに `9999-12-31`（仮退院日）のまま登録されたレコードが47件存在。退院日フィルター（`billingStartDateDischarge === '9999-12-31'` をスキップ）がCloud Functionに追加される前に同期されたレコード。

**原因**
追記型のため、一度スプレッドシートに書き込まれたレコードは ID が既存扱いとなり自動更新されない。

**対処**
Firestore の最新データと照合し、実際の退院日が確定している31件をバッチ更新。

| 区分 | 件数 |
|------|------|
| 修正済み（実退院日に更新） | 31件 |
| 未確定（Firestoreも9999-12-31） | 15件 |
| Firestoreにデータなし | 1件（kintone-184-discharge-613） |

未確定15件は Kintone に退院日が未入力のため保留。入力後の定時更新・再同期で反映される。

**N列（データ連携日）について**
情報種別に応じた実処理日（退院日・入院日・新規開始日・解約日）。卸会社への連絡トリガー日として使用。

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
