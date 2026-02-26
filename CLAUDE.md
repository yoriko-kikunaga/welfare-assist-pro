# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** - 福祉用具専門相談員向け業務管理アプリ。

- **本番**: https://welfare-assist-pro.web.app
- **データ**: 8634件の利用者（Google Sheets + Kintone連携）
- **AI**: Gemini 2.5 Flash（議事録生成、用具提案、医療文書OCR、請求書OCR）
- **同期**: 毎日00:00 JST自動同期（GitHub Actions）

## Essential Commands

```bash
# 開発
npm run dev              # 開発サーバー起動
npm run build            # 本番ビルド
firebase deploy --only hosting  # デプロイ

# データ同期（通常は自動実行）
node importSpreadsheetData.cjs  # Google Sheets同期（自費レンタル、販売）
node importFromKintone.cjs      # Kintone同期（変更レコード）
node syncClientsToFirestore.cjs # Firestore clientEdits へ clientName・kintoneレコード一括反映
# ビルド時にルートのclients.jsonが自動的にdist/assetsにコピーされる（copy-clients.cjs）

# Cloud Functionsデプロイ
cd functions && npm run build && firebase deploy --only functions

# E2Eテスト
npm run test:e2e         # 全テスト実行
npm run test:e2e:ui      # UIモード
```

**注意**: 介護保険レンタルは月次売上処理ページのCSVインポート機能でブラウザから取り込み

## Architecture

### Hybrid Data Model（重要）

```
Base Data (read-only)           → /assets/clients.json ← Google Sheets + Kintone（日次自動）
User Edits (read-write)         → Firestore: clientEdits/{aozoraId}
Reconciliation Data (read-write)→ Firestore: reconciliations/{year-month}_{office}（定時更新の影響なし）
OCR Name Mappings (read-write)  → Firestore: ocrNameMappings/{docId}（請求書OCR学習データ）
Bed Inventory (read-write)      → Firestore: bedInventory/{itemId}（定時更新の影響なし）
Bed Sets (read-write)           → Firestore: bedSets/{setId}（定時更新の影響なし）
Receipt Checks (read-write)     → Firestore: receiptChecks/{month}_{office}（定時更新の影響なし）
System Settings                 → Firestore: systemSettings/insuranceRentalOverride
```

### マージ処理（重要: バグの原因になりやすい）

- ブラウザ: `src/services/firestoreService.ts` の `mergeAllClientEdits()`
- 定時更新: `firestoreAdmin.cjs` の `mergeEquipmentArrays()`

**selectedEquipmentは結合**（置換ではない）:
- ベースデータ（介護保険レンタル）+ Firestore（販売・自費レンタル）を結合
- `mergeEquipmentArrays()`で両方のソースを保持

**changeRecordsはKintone優先マージ**:
- Kintoneレコード（`kintone-*`）: clients.json優先
- 手動追加レコード: Firestoreから保持

**定時更新後に保持されるフィールド**:
| 対象 | 保持フィールド |
|------|-------------|
| Equipment | endDate, orderReceivedDate, quantity, taxType, taxIncludedAmount, shippingCost, burdenLimitAmount, userBurdenAmount, applicationAmount, paymentMethod, transactionType, userBurdenType, applicationStatus, applicationProgress, applicationMunicipality, salesPerson, note, propertyAttribute |
| Client | `clientName`, `office`, `facilityName`, `roomNumber`, `currentStatus`, `careSupportOffice`, `careManager`, `careLevel`, `copayRate`, `insuranceCardStatus`, `burdenProportionCertificateStatus`, `paymentType`, `kaipokeRegistrationStatus`, `address`, `location`, `keyPerson`, `medicalHistory`, `isWelfareEquipmentUser`, `insuranceRentalBillingTotal` |

**insuranceRentalOverride**: CSVインポートまたはデータクリア時に`true`設定 → ベースデータの介護保険レンタルをスキップ

### Component Structure

```
App.tsx
├── ClientList (左サイドバー: 検索/フィルター)
├── ReconciliationPage (売上・請求突合)
├── WelfareUsersSummary (福祉用具集計: 施設別/Status別/事業所別の3タブ)
├── MonthlySalesExport (月次売上処理: 介保レンタル/自費/販売の3タブ)
├── ChangeRecordsExport (変更情報一覧・CSV/スプレッドシート出力)
├── EquipmentTrackingPage (ベッド管理: 在庫一覧/セット管理/償却・クリーニング/監査ログ)
├── ReceiptCheckPage (レセプトチェック: 介護保険レンタル請求前確認チェックリスト)
├── HelpPage (アプリ内ヘルプ: 9セクションの操作マニュアル)
└── ClientDetail (6タブ: 基本情報/病歴/議事録/変更情報/福祉用具選定/売上管理)
```

### Key Files

| ファイル | 役割 |
|---------|------|
| `types.ts` | 全型定義（Client, Equipment, `WHOLESALE_COMPANY_NAMES`等） |
| `components/MonthlySalesExport.tsx` | 月次売上処理（3種類の売上一覧・CSV出力・確定） |
| `components/ReconciliationPage.tsx` | 売上・請求突合（OCRアップロード・CSVインポート・インライン紐づけ編集） |
| `components/ClientSearchModal.tsx` | 利用者検索モーダル（インライン紐づけ編集用） |
| `components/InvoiceItemPickerModal.tsx` | 仕入データ選択モーダル（売上のみタブ用） |
| `services/geminiService.ts` | AI機能（議事録、用具提案、OCR、CSVパース） |
| `services/reconciliationService.ts` | 突合ロジック |
| `src/services/firestoreService.ts` | Firestore永続化（編集・確定・マッピング） |
| `src/services/nameMatchingService.ts` | OCR利用者名マッチング（あいまい検索・学習） |
| `src/services/kaipokeImportService.ts` | カイポケCSVインポート（介護保険レンタル） |
| `src/services/equipmentTrackingService.ts` | 個体管理（CRUD・状態遷移・償却・移行・CSV出力） |
| `components/EquipmentTrackingPage.tsx` | 個体管理UI（4タブ・7モーダル・QR・CSV出力） |
| `components/QRScannerModal.tsx` | QRスキャナ（html5-qrcode） |
| `components/ReceiptCheckPage.tsx` | レセプトチェックUI（チェックリストテーブル・自動取込・CSV出力） |
| `src/services/receiptCheckService.ts` | レセプトチェックFirestore CRUD・利用者データ自動生成・CSV出力 |
| `components/WelfareUsersSummary.tsx` | 福祉用具集計（3タブ・事業所フィルター・フラット一覧） |
| `components/HelpPage.tsx` | アプリ内ヘルプページ（9セクション・左ナビ+コンテンツ2ペイン） |
| `src/utils/gaiji.ts` | 外字（異体字: 高→髙, 富→冨, 崎→﨑等）変換 |

## AI Integration

**構成**: ブラウザ → Cloud Functions (asia-northeast1) → Vertex AI (Workload Identity)

**Cloud Functions** (`functions/src/index.ts`):
- `generateMeetingSummary` / `suggestEquipment` / `extractMedicalInfo`
- `parseWholesaleInvoice` (V1) / `parseWholesaleInvoiceV2` (会社別プロンプト)
- `syncChangeRecordsToSheets`
- `fetchGoogleDocContent` (Google Docs API経由でドキュメントテキスト取得)
- `extractMeetingNotes` (PDF/txtからGeminiでテキスト抽出)
- Python: `functions-python/main.py` → `parse_invoice_v3`（日建リース専用, pdfplumber）

**請求書OCR 会社別対応**:
| 卸会社 | 処理 | 利用者名抽出 |
|--------|-----|-------------|
| 日建リース工業 | V3 (pdfplumber) | 21列テーブル |
| 野口株式会社 | V2 (Gemini) | 【】括弧内 |
| 株式会社ニシケン | V2 + CSVインポート | 摘要欄 |
| パラマウントケアサービス | V2 + CSVインポート | 御利用者/利用者名 |
| 日本ケアサプライ | V2 (Gemini) | 〇〇 様 |
| 株式会社キシヤ | V2 (Gemini) | 汎用（要調整） |

## Data Sync

| データ種別 | 方法 | 頻度 |
|-----------|------|------|
| 自費レンタル・販売 | `importSpreadsheetData.cjs`（GitHub Actions） | 日次自動 |
| 変更レコード | `importFromKintone.cjs`（GitHub Actions） | 日次自動 |
| Firestore clientName・kintoneレコード | `syncClientsToFirestore.cjs`（GitHub Actions Step9） | 日次自動 |
| 介護保険レンタル | ブラウザCSVインポート（カイポケ） | 月次手動 |

詳細: [SYNC_SETUP.md](./SYNC_SETUP.md)

## Key Implementation Patterns

### カイポケCSVインポート（介護保険レンタル）

- 2ファイル必須: サービスチェックシート.csv + 利用者請求.csv
- マッチング: 被保険者番号 → 利用者名（外字考慮） → カナ
- **洗い替え動作**: 既存の介護保険レンタルを削除→置換（自費・販売は保持）
- **月度限定表示**: `startDate`=月初、`endDate`=月末を設定 → 該当月のみ表示
- **前月データ自動修正**: インポート時、対象外利用者の`endDate`なし介護保険レンタルに前月末を自動設定
- **請求データ未紐づけの利用者はインポート除外**（金額整合性のため）
- 給付対象金額: 利用者請求CSVから紐づけ保存、売上サマリーで使用（フォールバック計算なし）
- **事業所自動設定**: CSVの事業所情報から`client.office`を自動更新（手動設定不要）
- 自動紐づけ失敗時は手動紐づけUI（プレビュー画面内）で対応

### 卸会社CSVインポート（ReconciliationPage）

- ファイル拡張子`.csv`の場合、卸会社に応じてCSVパーサーを呼び出し
- **ニシケン対応済**: `geminiService.ts: parseNishikenCSV()` - ヘッダー名ベース列取得、保留行相殺、配送立替合算
- **パラマウント対応済**: `geminiService.ts: parseParamountCSV()` - 利用者名・商品名・金額・数量を抽出
- 他社CSV追加時: 同パターンで`parse○○CSV()`を追加し、`handleFileUpload()`の分岐を増やす
- accept属性: `.pdf,.png,.jpg,.jpeg,.csv`（全社共通）

### 突合CSVインポート（ReconciliationPage）

- 突合結果CSV（`generateReconciliationCSVV2`出力）を手動修正後に再インポートして請求明細を更新
- **統一ヘッダー**: `あおぞらID, 利用者名, 商品名, 種別, 売上金額, 仕入金額, 粗利, 粗利率, 卸会社`（全3セクション共通）
- `reconciliationService.ts: parseReconciliationCSV()` — セクション分割（`=== 突合済み ===`/`=== 仕入のみ ===`）→ `Map<WholesaleCompany, InvoiceItem[]>`
- **あおぞらIDマッチング**: CSVにあおぞらIDがある行は名前マッチングをスキップし直接紐づけ
  - 仕入のみ行にあおぞらIDを入力 → マッチング追加
  - 突合済み行のあおぞらIDを変更 → マッチング修正
  - 突合済み行のあおぞらIDを削除 → マッチング解除
- あおぞらIDなしの行は従来の名前マッチングで処理
- 各社ごとにFirestore保存（確定済み会社はスキップ）
- UTF-8 BOM / Shift-JIS 両対応
- 定時更新の影響なし（`reconciliations`コレクションは定時更新対象外）

### 売上・請求突合（ReconciliationPage）

- 突合フロー: 月度選択 → 売上抽出 → 請求書アップロード（OCR/CSV） → 名前マッチング → 粗利計算 → CSV出力
- 複数PDF分割アップロード対応（同一卸会社内でマージ）
- OCR名前マッチング: 正規化 → 学習済みマッピング → あいまい検索 → 手動選択UI（`UnmatchedNamesList.tsx`）
- 金額差分検証: 請求書合計 vs OCR抽出合計（差額1000円以内で一致判定）
- CSV取込時は請求書合計がないため「CSV取込（請求書合計なし）」をグレー表示
- **合計金額は全社統一で税抜き表示**（日建リースV3: `grand_total_excl_tax`=非課税+課税10%税抜）
- 未マッチ利用者は同一ocrNameで重複排除して表示（件数・合計金額をまとめて表示）
- **1:Nマッチング（附属品対応）**: 1つの売上に対して複数の仕入（ベッド本体+サイドレール等）をマッチング
  - `reconcileSalesWithInvoicesV2()`のPost-matchingフェーズで処理
  - 1:1マッチング後、残りの仕入アイテムに`matchedAozoraId`があり同一利用者が突合済み → 附属品として突合済みに移動
  - 附属品行: `salesAmount: 0`（二重計上防止）、`purchaseAmount`はそのまま、IDは`matched-acc-`プレフィックス
  - 突合済みタブで青背景 + `┗` マークで附属品を視覚的に区別

### インライン紐づけ編集（ReconciliationPage）

- **目的**: 突合結果の紐づけをCSVエクスポート→再インポートなしで画面上で直接修正
- **コンポーネント**: `ClientSearchModal.tsx`（利用者検索）、`InvoiceItemPickerModal.tsx`（仕入選択）
- **共通ロジック**: `updateInvoiceItemMatch()` — 同一`customerName`（正規化後）の全アイテムに`matchedAozoraId`を一括反映
- **操作フロー**:
  - 仕入のみタブ: 「紐づけ」ボタン → ClientSearchModal → 利用者選択 → Firestore保存+学習データ保存+再突合
  - 突合済みタブ: 鉛筆アイコン → ClientSearchModal（解除あり） → 変更/解除
  - 売上のみタブ: 「仕入紐づけ」ボタン → InvoiceItemPickerModal → 仕入アイテム選択
- **確定済みガード**: 仕入確定済み or 月次確定済み → ボタンdisabled（`isInvoiceConfirmedForCompany()`）
- **紐づけ済み表示**: 仕入のみタブで紐づけ済みアイテムは青背景+「→ 利用者名 (ID)」表示、ボタンは「変更」（緑）
- 定時更新の影響なし（`reconciliations`/`ocrNameMappings`コレクションのみ使用）

### 売上・仕入確定

- 売上確定（3種類）・仕入確定（7社）・月次確定の3段階
- 確定時にスナップショット保存（元データ変更の影響を受けない）
- 月次確定/解除は`updateDoc`+`deleteField`を使用（`setDoc`でのundefinedエラー回避）
- `summary`保存時は`stripUndefined()`でネストされたundefined値を除去
- 月次確定 → 全売上・全仕入が確定済みの場合のみ可能
- 解除は月次→個別の順（`reconciliations`コレクションは定時更新の影響なし）

### 販売CSV自動計算（利用者自己負担割合）

| 利用者自己負担割合 | 利用者負担額 | 申請額 |
|------------------|-------------|--------|
| 自己負担０（日常生活給付） | 0 | 総計 |
| 一部負担（日常生活給付） | 上限額 | 総計 - 上限額 |
| １〜３割負担（受領委任払い） | 総計×割合（上限額で制限） | 総計 - 利用者負担額 |
| 全額負担（償還払い） | 総計 | 総計 |

### 個体管理（EquipmentTrackingPage）

- **対象**: ベッド本体・サイドレール・マットレスの個体トラッキング（QRコード対応）
- **Firestoreコレクション**: `equipments/{itemId}`, `equipmentLogs/{logId}`, `equipmentSets/{setId}`（定時更新の影響なし）
- **型名**: `EquipmentItem`（既存`Equipment`と区別）、`EquipmentItemStatus`（既存`EquipmentStatus`と区別）
- **9ステータス**: 倉庫保管/事務所保管/クリーニング前/クリーニング中/介護保険貸与にて使用/自費にて使用/施設物品/販売済み/破棄済み
- **5用途区分**: 介護保険/自費/販売/施設物品/使用不可
- **状態遷移**: `getAllowedNextStatuses(currentStatus, usageType)` — UsageType × CurrentStatus の積集合
- **QRコード**: `qrcode.react`でクライアント表示、`generateEquipmentQR` Cloud FunctionでStorage保存（`equipment-qr/{code}.png`）
- **QRスキャン**: `html5-qrcode`（`QRScannerModal.tsx`）でカメラスキャン → UUID照合
- **管理コード自動採番**: BED-001, SR-001, MT-001形式
- **監査ログ**: `equipmentLogs`コレクション（追記専用）に全状態変更を記録
- **移行**: 旧`bedInventory` → `equipments`への一括移行（`MigrationModal`、旧データは削除しない）
- **タブ構成**: 在庫一覧（indigo）/ セット管理（purple）/ 償却・クリーニング（amber）/ 監査ログ（gray）
- **サービス**: `src/services/equipmentTrackingService.ts`
- **サイドバー**: `bg-indigo-100 hover:bg-indigo-200 text-indigo-700`（淡色パステル系）、ボタン表記「ベッド管理」
- **Storage**: `storage.rules` 新規作成、`firebase.json` に `storage` セクション追加
- **レスポンシブ対応（2026-02-22）**:
  - ヘッダー: `px-4 md:px-6`、タイトル `text-lg md:text-xl`、ボタンテキストは `sm:` 以上のみ表示（アイコンは常時表示）
  - タブ: `overflow-x-auto` + `min-w-max`、短縮ラベル（在庫/セット/償却/ログ）を `sm:hidden` で切替
  - 在庫一覧: モバイルはカードビュー（`md:hidden`）、デスクトップはテーブル（`hidden md:block`）
- **12ヶ月償却 レンタル先一覧（2026-02-22）**:
  - 償却・クリーニングタブ最上部に専用セクション追加
  - `getRentalDepreciationInfo(item)` — `usageHistory` の貸出履歴から累計レンタル月数を集計
  - 残存簿価 = `月額償却 × 残レンタル月数`（カレンダー経過月数ではなく実レンタル月数ベース）
  - 複数レンタル先を行ごとに表示、貸出中は緑背景・返却済はグレー
  - `RentalRecord`, `RentalDepreciationInfo` インターフェースを `equipmentTrackingService.ts` に追加
- **QRスキャナー説明文（2026-02-22）**: カメラ許可→照準→自動読取の4ステップ手順を日本語で詳述（`QRScannerModal.tsx`）

### レセプトチェック（ReceiptCheckPage）

- **目的**: 介護保険レンタルの請求前確認チェックリスト（従来スプレッドシート管理を置換）
- **Firestoreコレクション**: `receiptChecks/{month}_{office}`（定時更新の影響なし）
- **自動取込**: 介護保険レンタルがある利用者を自動抽出、単位数合計・変更情報から日付を自動設定
- **チェックボックス**: クリック即反映、デバウンス500msで自動保存
- **既存データマージ**: 再取込時、既存のチェック状態を保持したまま利用者データを最新化
- **CSV出力**: UTF-8 BOM付き、○/空白でチェック状態を出力
- **ソート**: 全ヘッダーをクリックで昇順→降順→解除の3段階ソート
- **拠点フィールド**: `Client.location`として永続化、基本情報タブで編集可能、初回データは`importReceiptCheck.cjs`で投入
- **サイドバー**: rose-600（ピンク系）ボタン
- **サービス**: `src/services/receiptCheckService.ts`（CRUD・自動生成・CSV出力）

### Meetメモ取込 → AI議事録生成（ClientDetail Tab3）

- **ボタン**: 「Meetメモから作成」（緑）→ `MeetImportModal`表示
- **取込方式3種**: URL（Google Docs API）/ テキスト貼り付け / ファイルアップロード（.txt/.pdf）
- **URL取込**: docIdを正規表現で抽出 → `fetchGoogleDocContent` Cloud Function → Docs API
  - **必要な共有設定**: リンク共有（閲覧可）、またはサービスアカウントに閲覧権限付与
- **PDF取込**: `extractMeetingNotes` Cloud Function → Geminiでテキスト抽出
- **AI生成フォーマット分岐**: `generateMeetingSummary`のプロンプトが会議種別で切り替わる
  - 担当者会議・カンファレンス → 8項目（会議目的/出席者・所属/利用者の現状/協議内容/決定事項/今後の対応・役割分担/次回予定/特記事項）
  - その他（訪問等） → 7項目（訪問日時/訪問目的/利用者の状態/確認事項/対応内容/今後の予定/特記事項）
- `handleMeetImport()`: 取込テキストをcontentに設定した新規MeetingRecordを作成 → AI生成自動実行
- **コンポーネント**: `components/MeetImportModal.tsx`（新規）

### 変更情報入力 Tab4 UI（ClientDetail）

- **セクション表示順**: 入力中（amber）→ 入院・退院情報 → その他（変更あり/その他） → 契約情報（新規/解約）
- **入力中カード（pendingRecordIds）**: 「情報を追加」押下後の新規レコードを `Set<string>` で管理。保存ボタン押下またはキャンセルで解除
  - 新規レコードは type 変更に関わらず amber「入力中」カードに固定表示（最上部に留まる）
  - `handleAddChangeRecord` → `setPendingRecordIds(prev => new Set([...prev, newRecord.id]))`
  - `handleSave` → `setPendingRecordIds(new Set())`
- **変更あり/その他/デモ**: `changeAndOtherRecords` フィルタ（`infoType === '変更あり' || 'その他' || 'デモ'`）で独自セクションに分離
- **デモ種別（2026-02-23追加）**: `ChangeInfoType`に`'デモ'`を追加。`ClientChangeRecord`に`demoStartDate: string`, `demoEndDate: string`フィールド追加。cyan色カード
- **カード名称**: 「新規・解約情報」→「契約情報」に変更
- **定時更新との関係**: `changeRecords` は clientEdits 経由で Firestore 保存 → 定時更新でも保持（Kintoneレコード以外）

### サイドバーボタン共通スタイル（ClientList.tsx）

全ボタンを淡色パステル系に統一（2026-02-23）:
- 変更前: `bg-*-400/500 hover:bg-*-500/600 text-white`（ソリッド）
- 変更後: `bg-*-100 hover:bg-*-200 text-*-700`（パステル）
- 各ボタンの色: sky/teal/violet/blue/indigo/rose/gray

### 福祉用具集計（WelfareUsersSummary）

- **対象**: `isWelfareEquipmentUser === true` の利用者のみ
- **3タブ構成**:
  | タブ | サブタブ | 説明 |
  |------|---------|------|
  | 施設別 | 在宅・各施設名 | `facilityName`でグループ化（在宅を先頭） |
  | Status別 | 介護保険レンタル・自費・併用・未設定 | `selectedEquipment.status`でグループ化 |
  | 事業所別 | 鹿児島（ACG）・福岡（Lichi） | `office`でグループ化・フラット一覧 |
- **事業所フィルター**: 施設別・Status別タブでは上部に全事業所/ACG/Lichi の絞り込みボタンを表示。事業所別タブでは非表示（サブタブ自体がフィルター）
- **表示フィールド**: あおぞらID・要介護度・施設名（在宅/施設）・居室（施設別のみ）・福祉用具件数・居宅介護支援事業所・担当CM・生活保護バッジ（paymentType='生保'時）
- **定時更新の影響なし**: 読み取り専用コンポーネント（Firestore書き込みなし）。表示フィールドはすべて clientEdits の保持対象（`office`, `careSupportOffice`, `careManager`, `paymentType` 等）

### その他のパターン

- **Equipment追加**: 2ステップモーダル（種類選択→属性選択）
- **Cascade Filtering** (Tab 5): 種類→メーカー→商品名→コード自動入力（下流リセット）
- **Change Records Pairing** (Tab 4): 入院→退院、新規→解約を日付ベースでペアリング
- **Office Field**: Tab1で設定、Tab3-6で読み取り専用参照。Firestoreに永続化（定時更新の影響なし）
- **月次売上の事業所フィルタ**: `client.office`（利用者の事業所）で判定（`eq.office`ではない）。利用者の事業所変更で全売上データが連動
- **変更情報一覧の事業所フィルタ**: `client.office`で判定（`record.office`ではない）。テーブル表示・CSV出力も同様
- **自費レンタル取引方法**: 販売と同じ`transactionType`フィールド（社内間取引/ー）をTab5フォーム＋CSV出力に対応
- **変更情報スプレッドシート同期**: `syncChangeRecordsToSheets` Cloud Function（スプレッドシートID: `1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU`）
  - **追記モード**: 1列目`レコードID`をキーに既存行をスキップし、新規レコードのみ末尾に追記（上書き不可）
  - **初回同期**: ヘッダー行 + 全レコードを書き込み後、ヘッダー行を太字・グレー背景にフォーマット
  - **日付フィルタ**: `CHANGE_RECORDS_START_DATE = '2025-11-01'`以降のレコードのみ出力（過去の履歴データを除外）
  - **列構成**: レコードID / 利用者名 / あおぞらID / 情報種別 / 記録日 / 請求停止日 / 請求開始日 / デモ開始日 / デモ終了日 / データ連携日 / 卸会社連絡状況 / 備考 / 施設名
  - **要権限**: Cloud Functionのサービスアカウント（`389880096786-compute@developer.gserviceaccount.com`）にスプレッドシートのEditor権限が必要

## Japanese Business Terms

| 用語 | 説明 |
|-----|------|
| あおぞらID | 利用者識別子（例: AZ-0001） |
| 要介護度 | 申請中, 要支援1-2, 要介護1-5 |
| 福祉用具専門相談員 | アプリのユーザーペルソナ |
| カイポケ | 介護事業者向け業務ソフト |

## Documentation Guidelines

**ファイル体制**:
- `CLAUDE.md` — 開発ガイド（このファイル）
- `README.md` — プロジェクト概要
- `SYNC_SETUP.md` — 定時更新・同期の運用手順
- `docs/SETUP_HISTORY.md` — 過去の設定履歴（アーカイブ）
- `docs/manual/` — ユーザー向け操作マニュアル（Markdown、全9章）
- `docs/create_slides.py` — 新人向けスライド生成スクリプト（python-pptx）

**マニュアル章構成** (`docs/manual/`):
| ファイル | 内容 |
|---------|------|
| `00_overview.md` | アプリ概要・ログイン・画面構成・データ更新サイクル |
| `01_client.md` | 利用者管理（6タブ詳細・Meetメモ取込） |
| `02_kaipoke.md` | カイポケCSVインポート手順 |
| `03_monthly-sales.md` | 月次売上処理（3タブ・確定フロー） |
| `04_reconciliation.md` | 売上・仕入突合（6社・OCR・インライン紐づけ） |
| `05_receipt-check.md` | レセプトチェック |
| `06_ai-features.md` | AI機能（議事録・OCR・用具提案） |
| `07_bed-inventory.md` | 自社ベッド管理 |
| `08_change-records.md` | 変更情報一覧 |

**スライド生成**:
- `docs/create_slides.py` を実行すると `docs/WelfareAssist_Pro_新人向けガイド.pptx` が生成される
- 実行コマンド: `python docs/create_slides.py`（python-pptx 必須）
- GoogleドライブにアップロードするとGoogleスライドに自動変換される

**ルール**:
- 実装と同時にドキュメント更新（同じコミットで）
- 重複禁止（リンクで参照）、履歴は最小限
- 新AI機能→AI Integration、新パターン→Key Implementation Patterns、新フィールド→Architecture
- README.mdは概要のみ、詳細はCLAUDE.mdへ
