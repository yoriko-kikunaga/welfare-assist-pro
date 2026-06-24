# バグ修正・障害対応ログ

運用中に発見・対応した不具合・障害の記録です。

---

## 2026-06-24

本日の対応サマリー（コミット／デプロイ対応表は末尾）。

### 1. 5月ACG自費レンタル売上の差異 ¥18,000（9名のベッド消失）→ 復元

**事象**
6/10時点の自費レンタルCSV（税抜合計 ¥308,697）に対し、アプリのサマリーが ¥290,697 と **▲¥18,000** の差異。

**調査**
6/10版CSVと現行アプリの再エクスポートを突合 → **介護用ベッド（各¥2,000）9名分が丸ごと消失**（2,000×9＝18,000で一致）。本番Firestoreを直接読み取り、9名の `clientEdits` ドキュメントは存在するが `selectedEquipment` から自費レンタルが削除されていることを確認（7名は配列空、2名は他機器のみ残存）。

**根本原因**
`firestoreService.saveClientEdits` が `setDoc`（完全上書き）のため、利用者編集の保存時に既存の自費レンタルを配列に含めず保存すると、レコードが配列ごと消える。

**対応**
6/10版CSVを元に、9名の `selectedEquipment` へ自費レンタルを**配列追記で復元**（既存機器は保持）。書込み前に現状をバックアップ（`_backup_selfpay9_*.json`）。物件属性はユーザー指定により空のまま。データ操作のため再デプロイ不要。
→ 恒久対策は本ログ「3.」を参照。

### 2. Kintone自動連携（入退院・入退去）の凍結 → 修正・バックフィル・失敗検知

**事象**
新規・解約・入退院がアプリに反映されない利用者が散見。

**根本原因（2つ）**
1. **アプリ197（入居=新規／退去=解約）のAPIトークン不正**（`[400] GAIA_IA02`）。少なくとも4月以前から失敗継続。アプリ184（入退院）のトークンは正常。
2. **失敗の握りつぶし＋保存順序のバグ**: 旧 `importFromKintone.cjs` は197のエラーを try/catch で握りつぶし `exit 0`。さらに `clients.json` への書き込みが197処理の後にあったため、**197が落ちると同じ実行の184更新も丸ごと破棄**。結果、入退院も含めKintone連携全体が凍結。ワークフローは毎日「成功」表示で気づけなかった。

**対応**
- `importFromKintone.cjs`: 184/197を独立 try/catch 化し、**成功分は必ず保存**。取得件数・NotFound件数をログ。いずれか失敗時は `exit 1`。
- `daily-sync.yml`: Step8に `continue-on-error: true` を付与しパイプラインは止めず（良いデータはデプロイ）、デプロイ・コミット後に**「Kintone同期の失敗を検知」ゲート**でジョブを失敗扱いにし、GitHubの失敗メール＋失敗通知を発火。
- **197トークン更新**: 新トークンをローカル `.env` と GitHub Secret `KINTONE_API_TOKEN_197` に反映。
- **バックフィル**: 入退院（184）＝期待624/一致624、入退去（197）＝期待1146/一致1146（いずれも欠落0）を本番反映。

### 3. 確定済み売上（自費レンタル・販売）の保護＋ソフトデリート（恒久対策）

「1.」の再発防止。売上確定後のアプリ入力データ（自費レンタル・販売）を編集・削除から保護。介護保険レンタルはCSV取込のため対象外。

- **ロック基準＝確定ベース**: `reconciliations/{月}_{事業所}` の売上確定 or 月次確定済みの月に計上されたレコードをロック。
- **保存ガード**（`firestoreService.saveClientEdits` ＋ 新規 `src/services/salesLock.ts`）: 確定済みレコードの消失・金額系改変・遡及endDate・論理削除を、保存前に現行値へ差し戻し（`setDoc`全上書きで消える根本バグを封殺）。endDateを確定月より後に設定する解約は許可。
- **UI**（`ClientDetail.tsx`）: 確定済みの自費/販売に🔒表示・削除ボタン無効化。削除はソフトデリート化（`deletedAt`／確定済みはブロック）。
- **集計除外**: 集計・突合・レセプトチェック・CSVから `deletedAt` を除外（MonthlySalesExport・各Reconciliationセクション・receiptCheckService）。
- salesLockロジックは9ケースのユニットテストで検証。

### 4. 入退去（Kintone197）をレセプトチェックの新規/解約に反映

**事象**
入退去がレセプトチェックタブに反映されない。

**原因**
レセプトチェックは `changeRecords` の `infoType` が `新規`/`解約` のものを参照するが、197取込は `施設入居新規`/`施設入居解約` で書くため拾われなかった（入退院184は `入院（サービス停止）`/`退院（サービス開始）` が一致しており元から反映）。

**対応**
ユーザー決定「退去→解約・入居→新規」に基づき、`receiptCheckService.ts` に `isNewInfoRecord`/`isCancelInfoRecord` ヘルパーを追加（`施設入居新規/解約` と旧形式 `id=kintone-197-*` の両対応）し、6箇所の判定を置換。入居→利用初回日・新規自動追加、退去→解約日・期間前解約の除外。6ケースのユニットテストで検証。

### 5. 属性履歴の🕐件数バッジから初期値ベースラインを除外

**事象**
基本情報タブの属性履歴で、登録時初期値「ー」が①にカウントされる。

**対応**
`ClientDetail.tsx` の件数バッジを `effectiveFrom !== ''`（実変更のみ）でカウントするよう変更し、初期値からの変更後を①とした。ベースライン（記録開始前の値）はデータとしては保持し、過去月のas-of表示・🕐タイムライン表示は従来どおり。

### コミット／デプロイ対応表

| コミット | 内容 | デプロイ（workflow_dispatch run） |
|---|---|---|
| `3036131` | Kintone失敗検知＋184保存継続 | `28081876930`（184バックフィル・**failure＝意図した失敗ゲート**／デプロイ自体は成功） |
| （トークンのみ・コミットなし） | 197トークン更新（.env＋GH Secret） | `28082246116`（197バックフィル・success） |
| `fe4ad6b` | 確定済み売上保護＋ソフトデリート | `28084829361`（success） |
| `aad091f` | 入退去→レセプトチェック反映 | `28085701099`（success） |
| `e1a7cbb` | 属性履歴件数バッジ修正 | `28095838716`（success） |

**デプロイ状態**: 最新コミット `e1a7cbb` までの全コード変更がデプロイ済み（最後の成功デプロイ `28095838716` が main HEAD からビルド）。`28081876930` の failure はKintoneゲートによるものでデプロイはOK（その後197修正・再実行で解消）。**デプロイ漏れなし**。

---

## 2026-06-11

### 自費レンタルが本番アプリで消失 → Firestore一本化＋安全ガードで恒久対策

**事象**

複数の利用者（例: 松山英明様 / あおぞらID 956）で、登録済みの自費レンタル売上が本番アプリから消えていた。本番の自費レンタル利用者は **85名分が欠落**（196名 → 136名）。

**調査で判明した3層のデータ状態**

| 場所 | 956の自費レンタル | 自費レンタル利用者数 |
|---|---|---|
| マスタースプレッドシート（シート1） | 2件あり | 107名 |
| `clients.json`（リポジトリ） | 2件あり | 190名 |
| **本番 `/assets/clients.json`** | **0件（消失）** | **136名** |

→ ソース（スプレッドシート・リポジトリ・Firestore）にデータは健在で、**本番に配信されている `clients.json` だけが壊れていた**。

**根本原因**

1. **2026-06-01の同期障害**: スプレッドシート読み込みが失敗し、`importSpreadsheetData.cjs` が **利用者0件**の `clients.json` を生成。これがそのままコミット＆自動デプロイされた（`daily-sync.yml` は元々ビルド・デプロイまで自動実行している）。
2. **自費レンタル保持チェーンの崩壊**: 日次インポートは「自費レンタルを前回の `clients.json` から保持」する設計のため、翌6/02は0件のファイルを参照 → ベースの自費レンタルが全消失。Firestore登録済み分（約133名）のみ残り、**スプレッドシート専属だった約57名が消えた**状態が毎日デプロイされ続けた。
3. （遠因）**月次インポート（`--monthly-sheet`）の破壊的上書き**: 自費レンタルをシート内容で完全置換する実装で、シートに無い利用者を消す危険があった。

**対応**

1. **本番復元**: `node importSpreadsheetData.cjs` → build → `firebase deploy --only hosting` で85名分を即時復旧。
2. **自費レンタルをアプリ（Firestore `clientEdits`）管理に一本化**（`importSpreadsheetData.cjs`）:
   - スプレッドシート（シート1/月次実績）からの自費レンタル取り込み・月次置換を**撤廃**（`selfPayRentalsToUse = []`）。
   - 自費レンタルは下部の `mergeAllClientEdits(Firestore)` で全件付与。ベースに置かないため、月次の破壊的上書きが根絶され、アプリ上の削除も正しく反映される。
3. **既存データのFirestore移行**: `migrateSelfPayToFirestore.cjs` でスプレッドシート専属だった **59名66品目**を `clientEdits` へ一括移行（`selfpay_migration_targets.csv` に記録）。既存docは `update` で部分更新し他フィールドを保護。
   - 副次効果: 同一IDの重複自費レンタルエントリ（短縮名＋正式名）が解消（243→215品目・**実データ損失ゼロ**を検証）。
4. **インポート安全ガード追加**（`importSpreadsheetData.cjs`）:
   - 書き込み前に利用者数を検査し、**絶対下限8,000件未満**または**前回比90%未満**なら `clients.json` を書き換えず `exit(1)` で中断（ワークフロー失敗 → コミット/デプロイを阻止）。
   - 正当な大量削減用に `--force` バイパスを用意。
   - 実地テスト済み（発火時 exit 1・上書きなし、`--force` で正常書き込み、通常時は誤検知なし）。

**教訓**

- 自費レンタルの「消えた」報告時は、まず**本番 `/assets/clients.json` を `curl` で取得**し、Firestore `clientEdits`・マスタースプレッドシートと突き合わせる。
- `daily-sync.yml` の自動デプロイは正常稼働中。本番が古い場合はワークフロー実行状況と直近の同期障害を疑う。
- 異常なインポート結果を本番に流さないガードが最重要の再発防止策。

**関連コミット**: `84f036e`（自費レンタルFirestore一本化・移行）, `69b911f`（安全ガード）

---

## 2026-04-28（夜・続き）

### 売上・仕入突合CSV 整合の最終調整

午前の「行 ≒ サマリー」整合確立後、ユーザー検証で残った微差を順次解消した。

**残課題と対応**

1. **ACGに +150,020円のドリフト**: ReconciliationPage の `salesSummary` が `baseClients` フォールバックを含む一方、MonthlySalesExport の確定計算は含まないため。
   - 対処: ReconciliationPage の `salesSummary` および `handleExportCSV` の Pass 2 から `baseClients` フォールバックを廃止（両ページの集計範囲を統一）
   - 残ったケースは kaipoke 再インポートで解消（ステップ4）

2. **ACGに +27,440円のドリフト**: 月次売上処理で再確定した直後の値が ReconciliationPage の state（`acgDoc`）に反映されず古いまま。
   - 対処: `handleExportCSV` 内で確定スナップショットを毎回 fresh fetch（`getReconciliation` 再実行）

3. **ACGに +4,000円のドリフト**: ACG 自費レンタルで重複データ（同じ aozoraId・同じ id）が `clients.json` に存在し、ReconciliationPage の per-client 按分では削除可能だが MonthlySalesExport の確定計算では加算されていた。
   - 対処1: `office` 判定を**厳密マッチ**に統一。office 未設定の利用者を ACG にデフォルト振り分けしないよう変更（`officeMatches` および `resolveRowOffice`）
   - 対処2: `removeEquipment`（`ClientDetail.tsx`）が `id` 一致で全削除する不具合を修正。最初の1件のみ削除に変更
   - 対処3: `mergeEquipmentArrays` で base equipment 側の id 重複を先勝ち排除。`clients.json` の重複データが画面表示と集計の両方に二重カウントされる問題を解消

4. **`billingTotal` が前月から残存（stale）する問題**: kaipoke 再インポートで「対象外の利用者」の billingTotal がクリアされず、月遅れ請求/申請中の利用者が翌月の介保売上に含まれてしまう。
   - 対処: `saveInsuranceRentalBatch` で当月インポート対象外の利用者かつ **インポート対象 office に該当**する利用者の `insuranceRentalBillingTotal` を `deleteField()` で自動クリア

**確立した最終的な整合ルール**

CLAUDE.md `売上・請求突合（ReconciliationPage）` → `CSV整合性ルール（2026-04-28 確立・最終版）` を参照。要点：

- 売上行は per-client で `insuranceRentalBillingTotal` に按分（クリーン値、各client内で完全一致）
- 売上サマリーは月次売上処理確定値が source of truth、CSV出力時に fresh fetch
- office 判定は厳密マッチ（未設定者は売上集計から除外）
- 仕入サマリーは行合計を採用（自社物件ゼロ化は廃止・請求書PDF実額が真実）
- `billingTotal <= 0` の利用者は両ページで除外
- カイポケ再インポート時に stale billingTotal を自動クリア

---

## 2026-04-28

### 売上・仕入突合CSV：行合計 = サマリー の数学的整合を確立

**事象**
2026-03 の突合CSV（全事業所/ACG/Lichi）で以下の不一致が発生：
- 各CSV内で **行合計（F列売上・G列仕入） ≠ サマリー値**
- クロスチェックで **ACG行 + Lichi行 ≠ 全事業所行**
- 仕入請求書PDF合計（3,336,316円）と CSVサマリー仕入合計が一致しない

**原因（複数）**

1. **介保売上の行ズレ**: `aggregateAllSales` が `insuranceRentalBillingTotal` の有無を見ていなかったため、月遅れ請求/申請中（利用者請求CSV未連携）の利用者の `monthlyCost` が行に混入
2. **販売売上の行ズレ**: `aggregateAllSales` が **税抜計算**（`unitPrice × quantity + 送料税抜`）を使用し、`MonthlySalesExport.tsx`（**税込+送料+送料消費税+調整額**）と乖離
3. **自費売上の office 誤帰属**: `salesItem.office = eq.office || client.office` で `eq.office` を優先していたため、利用者の事業所変更が反映されず一部利用者の自費が誤った office に計上
4. **office不明な仕入のみ行が両 office から欠落**: あおぞらID無しの施設使用品・デモ品（17行・26,275円）が ACG/Lichi のフィルタで弾かれていた
5. **自社物件ゼロ化による仕入総計と請求書PDF実額の乖離**: `propertyAttribute === '自社物件'` の行を `purchaseAmount = 0` に強制していたため、請求書実額（3,336,316円）と CSVサマリー（3,306,876円）に 29,440円の差
6. **介保 monthlyCost と insuranceRentalBillingTotal のドリフト**: 確定スナップショット時点と現時点で利用者集合が異なるケース（Pass 2 base-fallbackで救済された利用者など）

**修正**

`services/reconciliationService.ts` および `components/ReconciliationPage.tsx` の `handleExportCSV` を全面的に整理：

- 介保: `client.insuranceRentalBillingTotal === undefined` の利用者を除外
- 販売: 計算式を `税込金額 + 送料(税抜) + 送料消費税 + 調整額` に統一
- office: `client.office` のみ使用（`eq.office` を廃止）
- 売上サマリー: 全事業所モードは `ACG確定 + Lichi確定` 合算（office × 売上タイプ単位）
- 売上行: office × type 別に target サマリーへスケーリング（端数は最終行集約・粗利再計算）
- 仕入: 自社物件ゼロ化を廃止（請求書PDF実額が真実）
- 仕入サマリー: `finalResults.reduce(purchase)` で行合計に統一
- office不明 invoice_only 行: ACG にデフォルト振り分け（あおぞらID無しの施設使用品など）
- `clientOfficeMap` を `clients` + `baseClients` で構築（office解決の網羅性向上）
- 状態管理: `acgDoc` / `lichiDoc` を常時保持して全事業所モードで両officeの確定スナップショットを参照可能に

**確立した整合ルール（必守）**

CLAUDE.md の `売上・請求突合（ReconciliationPage）` → `CSV整合性ルール（2026-04-28 確立）` に詳細記載。

1. 各CSV内で 行合計 = サマリー（売上・仕入とも）
2. ACG行 + Lichi行 = 全事業所行（売上・仕入とも）
3. 売上サマリー = 月次売上処理確定値が source of truth／仕入サマリー = 請求書PDF実額が source of truth

**検証結果（2026-03）**

| | 行売上 | サマリー売上 | 行仕入 | サマリー仕入 |
|---|---|---|---|---|
| 全事業所 | 7,623,087 | 7,623,087 | 3,336,316 | 3,336,316 |
| ACG | 5,934,247 | 5,934,247 | 約 2.88M | 約 2.88M |
| Lichi | 1,688,840 | 1,688,840 | 約 0.46M | 約 0.46M |

すべての CSV で 行 = サマリー、ACG + Lichi = 全事業所 が完全一致。

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
