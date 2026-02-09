# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** - 福祉用具専門相談員向け業務管理アプリ。

- **本番**: https://welfare-assist-pro.web.app
- **データ**: 8573件の利用者（Google Sheets + Kintone連携）
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
cp clients.json public/assets/clients.json  # 開発用コピー

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
| Client | `isWelfareEquipmentUser`（手動true）, `insuranceRentalBillingTotal`（CSVインポート時） |

**insuranceRentalOverride**: CSVインポートまたはデータクリア時に`true`設定 → ベースデータの介護保険レンタルをスキップ

### Component Structure

```
App.tsx
├── ClientList (左サイドバー: 検索/フィルター)
├── ReconciliationPage (売上・請求突合)
├── WelfareUsersSummary (福祉用具集計)
├── MonthlySalesExport (月次売上処理: 介保レンタル/自費/販売の3タブ)
├── ChangeRecordsExport (変更情報一覧・CSV/スプレッドシート出力)
└── ClientDetail (6タブ: 基本情報/病歴/議事録/変更情報/福祉用具選定/売上管理)
```

### Key Files

| ファイル | 役割 |
|---------|------|
| `types.ts` | 全型定義（Client, Equipment, `WHOLESALE_COMPANY_NAMES`等） |
| `components/MonthlySalesExport.tsx` | 月次売上処理（3種類の売上一覧・CSV出力・確定） |
| `components/ReconciliationPage.tsx` | 売上・請求突合（OCRアップロード・CSVインポート） |
| `services/geminiService.ts` | AI機能（議事録、用具提案、OCR、CSVパース） |
| `services/reconciliationService.ts` | 突合ロジック |
| `src/services/firestoreService.ts` | Firestore永続化（編集・確定・マッピング） |
| `src/services/nameMatchingService.ts` | OCR利用者名マッチング（あいまい検索・学習） |
| `src/services/kaipokeImportService.ts` | カイポケCSVインポート（介護保険レンタル） |
| `src/utils/gaiji.ts` | 外字（異体字: 高→髙, 富→冨, 崎→﨑等）変換 |

## AI Integration

**構成**: ブラウザ → Cloud Functions (asia-northeast1) → Vertex AI (Workload Identity)

**Cloud Functions** (`functions/src/index.ts`):
- `generateMeetingSummary` / `suggestEquipment` / `extractMedicalInfo`
- `parseWholesaleInvoice` (V1) / `parseWholesaleInvoiceV2` (会社別プロンプト)
- `syncChangeRecordsToSheets`
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
| 介護保険レンタル | ブラウザCSVインポート（カイポケ） | 月次手動 |

詳細: [SYNC_SETUP.md](./SYNC_SETUP.md)

## Key Implementation Patterns

### カイポケCSVインポート（介護保険レンタル）

- 2ファイル必須: サービスチェックシート.csv + 利用者請求.csv
- マッチング: 被保険者番号 → 利用者名（外字考慮） → カナ
- **洗い替え動作**: 既存の介護保険レンタルを削除→置換（自費・販売は保持）
- **請求データ未紐づけの利用者はインポート除外**（金額整合性のため）
- 給付対象金額: 利用者請求CSVから紐づけ保存、売上サマリーで使用（フォールバック計算なし）
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

### 売上・仕入確定

- 売上確定（3種類）・仕入確定（7社）・月次確定の3段階
- 確定時にスナップショット保存（元データ変更の影響を受けない）
- 月次確定 → 全売上・全仕入が確定済みの場合のみ可能
- 解除は月次→個別の順（`reconciliations`コレクションは定時更新の影響なし）

### 販売CSV自動計算（利用者自己負担割合）

| 利用者自己負担割合 | 利用者負担額 | 申請額 |
|------------------|-------------|--------|
| 自己負担０（日常生活給付） | 0 | 総計 |
| 一部負担（日常生活給付） | 上限額 | 総計 - 上限額 |
| １〜３割負担（受領委任払い） | 総計×割合（上限額で制限） | 総計 - 利用者負担額 |
| 全額負担（償還払い） | 総計 | 総計 |

### その他のパターン

- **Equipment追加**: 2ステップモーダル（種類選択→属性選択）
- **Cascade Filtering** (Tab 5): 種類→メーカー→商品名→コード自動入力（下流リセット）
- **Change Records Pairing** (Tab 4): 入院→退院、新規→解約を日付ベースでペアリング
- **Office Field**: Tab1で設定、Tab3-6で読み取り専用参照
- **変更情報スプレッドシート同期**: `syncChangeRecordsToSheets` Cloud Function（ID: `1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU`）

## Japanese Business Terms

| 用語 | 説明 |
|-----|------|
| あおぞらID | 利用者識別子（例: AZ-0001） |
| 要介護度 | 申請中, 要支援1-2, 要介護1-5 |
| 福祉用具専門相談員 | アプリのユーザーペルソナ |
| カイポケ | 介護事業者向け業務ソフト |

## Documentation Guidelines

**4ファイル体制**: CLAUDE.md（開発ガイド）/ README.md（概要）/ SYNC_SETUP.md（運用）/ docs/SETUP_HISTORY.md（アーカイブ）

**ルール**:
- 実装と同時にドキュメント更新（同じコミットで）
- 重複禁止（リンクで参照）、履歴は最小限
- 新AI機能→AI Integration、新パターン→Key Implementation Patterns、新フィールド→Architecture
- README.mdは概要のみ、詳細はCLAUDE.mdへ
