# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** - 福祉用具専門相談員向け業務管理アプリ。

- **本番**: https://welfare-assist-pro.web.app
- **データ**: 8,501件の利用者（Google Sheets + Kintone連携）
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
node importServiceCheckSheet.cjs  # サービスチェックシート（介護保険レンタル、月次）
cp clients.json public/assets/clients.json  # 開発用コピー

# E2Eテスト
npm run test:e2e         # 全テスト実行
npm run test:e2e:ui      # UIモード
```

## Architecture

### Hybrid Data Model（重要）

```
┌─────────────────────────────────────────────────────┐
│ Base Data (read-only)                               │
│ /assets/clients.json ← Google Sheets + Kintone     │
│ Updated daily via GitHub Actions                    │
└─────────────────────────────────────────────────────┘
                    ↓ merge at runtime
┌─────────────────────────────────────────────────────┐
│ User Edits (read-write)                             │
│ Firestore: clientEdits/{aozoraId}                   │
│ Fields: meetings, changeRecords, selectedEquipment, │
│         medicalHistory, isWelfareEquipmentUser      │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ Reconciliation Data (read-write)                    │
│ Firestore: reconciliations/{year-month}_{office}    │
│ Fields: salesConfirmation, invoiceConfirmation,     │
│         monthlyStatus, summary                      │
│ ※定時更新の影響を受けない独立コレクション            │
└─────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────┐
│ OCR Name Mappings (read-write)                      │
│ Firestore: ocrNameMappings/{docId}                  │
│ Fields: ocrName, ocrNameOriginal, aozoraId,         │
│         masterName, wholesaleCompany, confidence,   │
│         usageCount                                  │
│ ※請求書OCRの利用者名マッチング学習データ             │
└─────────────────────────────────────────────────────┘
```

**マージ処理**:
- ブラウザ: `src/services/firestoreService.ts` の `mergeAllClientEdits()`
- 定時更新: `firestoreAdmin.cjs` の `mergeEquipmentArrays()`

**重要**: selectedEquipmentは**結合**（置換ではない）
```typescript
// ベースデータ（介護保険レンタル）とFirestore（販売等）を結合
const mergedSelectedEquipment = mergeEquipmentArrays(
  baseClient.selectedEquipment || [],  // clients.json
  edits.selectedEquipment || []        // Firestore
);
```
これにより、サービスチェックシートからインポートした介護保険レンタルと、アプリで手動追加した販売・自費レンタルの両方が保持される。

**重要**: changeRecordsは**Kintone優先マージ**
```typescript
// Kintoneレコード（kintone-*）: clients.json優先（最新）
// 手動追加レコード: Firestoreから保持
const mergedChangeRecords = mergeChangeRecords(
  baseClient.changeRecords || [],   // clients.json（Kintone最新）
  edits.changeRecords || []         // Firestore（手動追加のみ使用）
);
```
これにより、Kintone連携で更新された入院・退院日等が常に最新の状態で表示される。

**定時更新後に保持されるEquipmentフィールド**:
| カテゴリ | フィールド |
|---------|-----------|
| 日付 | endDate, orderReceivedDate |
| 金額 | quantity, taxType, taxIncludedAmount, shippingCost, burdenLimitAmount, userBurdenAmount, applicationAmount |
| 取引 | paymentMethod, transactionType |
| 申請 | userBurdenType, applicationStatus, applicationProgress, applicationMunicipality |
| その他 | salesPerson, note, propertyAttribute |

**定時更新後に保持されるClientフィールド**:
- `isWelfareEquipmentUser`: Firestoreで手動設定された`true`は定時更新後も保持される

### Component Structure

```
App.tsx
├── ClientList (左サイドバー: 検索/フィルター)
├── ReconciliationPage (介保レンタル売上・請求突合)
├── WelfareUsersSummary (福祉用具集計)
├── MonthlySalesExport (月次売上処理)
├── ChangeRecordsExport (変更情報一覧・CSV/スプレッドシート出力)
└── ClientDetail (メインコンテンツ: 6タブ)
    ├── Tab 1: 基本情報 - office設定（他タブから参照）
    ├── Tab 2: 病歴・状態 - AI提案 + 医療文書OCR
    ├── Tab 3: 議事録一覧 - AI議事録生成
    ├── Tab 4: 変更情報 - 入院/退院/新規/解約のペアリング表示
    ├── Tab 5: 福祉用具選定 - カスケードフィルタリング
    └── Tab 6: 売上管理
```

### Key Files

| ファイル | 役割 |
|---------|------|
| `types.ts` | 全TypeScript型定義（Client, Equipment等） |
| `components/MonthlySalesExport.tsx` | 月次売上処理（自費レンタル・販売のCSVエクスポート） |
| `components/ChangeRecordsExport.tsx` | 変更情報一覧（CSV/スプレッドシート出力） |
| `services/geminiService.ts` | AI機能（議事録生成、用具提案、OCR、スプレッドシート同期） |
| `services/reconciliationService.ts` | 売上・請求突合ロジック |
| `src/services/firestoreService.ts` | ユーザー編集・突合確定・OCRマッピングの永続化 |
| `src/services/nameMatchingService.ts` | OCR利用者名マッチング（あいまい検索、学習機能） |
| `components/UnmatchedNamesList.tsx` | OCR照合UI（候補選択、全利用者検索、一括操作） |
| `importSpreadsheetData.cjs` | Google Sheets同期（自費レンタル、販売）- 日次自動 |
| `importFromKintone.cjs` | Kintone同期（変更レコード）- 日次自動 |
| `importServiceCheckSheet.cjs` | サービスチェックシート（介護保険レンタル）- 月次 |

## AI Integration

**アーキテクチャ**: Cloud Functions + Vertex AI（Workload Identity認証）
**リージョン**: asia-northeast1（東京）
**モデル**: gemini-2.5-flash

```
ブラウザ → Cloud Functions → Vertex AI
           (asia-northeast1)   (Workload Identity)
```

**Cloud Functions**:
```typescript
// functions/src/index.ts (Node.js)
generateMeetingSummary        // 粗いメモ → 正式議事録
suggestEquipment              // 病歴から用具提案
extractMedicalInfo            // PDF/画像 → 医療情報抽出
parseWholesaleInvoice         // 卸会社請求書PDF → JSON抽出（V1）
parseWholesaleInvoiceV2       // 改良版OCR（会社別プロンプト対応）
syncChangeRecordsToSheets     // 変更情報 → Googleスプレッドシート同期

// functions-python/main.py (Python)
parse_invoice_v3              // 日建リース専用（pdfplumber）
```

**請求書OCR 会社別対応** (`functions/src/index.ts`):
| 卸会社 | 処理方式 | 利用者名の抽出方法 |
|--------|---------|------------------|
| 日建リース工業 | V3 (pdfplumber) | 21列テーブルから抽出 |
| 野口株式会社 | V2 (Gemini) | 【】括弧内から抽出 |
| 株式会社ニシケン | V2 (Gemini) | 摘要欄から抽出 |
| 日本ケアサプライ | V2 (Gemini) | 「〇〇 様」形式から抽出 |
| パラマウント | V2 (Gemini) | 「御利用者」列から抽出 |
| 株式会社キシヤ | V2 (Gemini) | 汎用プロンプト（要調整） |

**フロントエンド呼び出し**:
```typescript
// services/geminiService.ts
import { httpsCallable } from 'firebase/functions';
const parseInvoice = httpsCallable(functions, 'parseWholesaleInvoice');
```

**デプロイ**:
```bash
cd functions && npm run build    # TypeScriptビルド
firebase deploy --only functions # Cloud Functionsデプロイ
firebase deploy --only hosting   # フロントエンドデプロイ
```

**IAM設定**: Compute Service Accountに`roles/aiplatform.user`を付与済み

## Data Sync Architecture

### データソース分離（重要）

| データ種別 | インポートスクリプト | 頻度 |
|-----------|-------------------|------|
| 自費レンタル、販売 | `importSpreadsheetData.cjs` | 日次自動 |
| 変更レコード | `importFromKintone.cjs` | 日次自動 |
| 介護保険レンタル | `importServiceCheckSheet.cjs` | 月次 |

**注意**: 介護保険レンタルは`importServiceCheckSheet.cjs`でのみ管理。`importSpreadsheetData.cjs`では介護保険レンタルを保持しない（重複防止）。

**手動マッチング設定** (`manualMatchConfig.json`):
異体字や文字化けで自動マッチングできない利用者を手動で紐付ける設定ファイル。
```json
{
  "mappings": [
    {
      "spreadsheetInsuranceNumber": "1101948",
      "clientsJsonAozoraId": "918",
      "comment": "高→髙 の異体字"
    }
  ]
}
```
インポート時にマッチしない利用者がいた場合、このファイルに追加する。

### GitHub Actions Workflows

| ワークフロー | スケジュール | 内容 |
|------------|------------|------|
| `daily-sync.yml` | 毎日00:00 JST | スプレッドシート + Kintone同期 |
| `monthly-service-check.yml` | 毎月1日09:00 JST | サービスチェックシート同期 |

詳細: [SYNC_SETUP.md](./SYNC_SETUP.md)

## Key Implementation Patterns

### Equipment Add Modal (Tab 5)

「機器を追加」ボタンで2ステップモーダルを表示:
1. **種類選択**: 介護保険レンタル / 自費レンタル / 販売
2. **属性選択**: 自社物件 / リース物件

```typescript
// Step 1: 種類を選択してpendingEquipmentTypeに保持
setPendingEquipmentType('自費レンタル');

// Step 2: 属性を選択して機器を追加
handleAddEquipment('selected', pendingEquipmentType, '自社物件');
```

### Equipment Cascade Filtering (Tab 5)

```typescript
// 種類選択 → メーカー絞り込み → 商品名絞り込み → コード自動入力
if (field === 'category') {
  // 下流フィールドをリセット
  setEditedClient(prev => ({
    ...prev,
    selectedEquipment: equipment.map(e =>
      e.id === id ? { ...e, category: value, manufacturer: '', name: '' } : e
    )
  }));
}
```

### Change Records Pairing (Tab 4)

入院→退院、新規→解約を日付ベースでペアリング表示。
Kintone IDは文字列形式: `kintone-184-hospitalization-564`

### Office Field Reference

`office`フィールドはTab1で設定し、Tab3-6で読み取り専用参照。

### Change Records Export (ChangeRecordsExport)

利用者の変更情報（新規・入院・退院・解約・変更あり・その他）を一覧表示し、CSVダウンロードおよびGoogleスプレッドシートへの同期機能を提供。

**フィルター条件**:
- 期間: 開始日〜終了日（データ連携日で判定）
- 事業所: 全事業所 / 鹿児島（ACG） / 福岡（Lichi）
- 情報種別: 全種別 / 新規 / 入院 / 退院 / 解約 / 変更あり / その他

**データ連携日の決定ロジック**:
| 情報種別 | データ連携日 |
|---------|------------|
| 新規 | 請求開始日（新規） |
| 入院（サービス停止） | 請求停止日（入院） |
| 退院（サービス開始） | 請求開始日（退院） |
| 解約 | 請求停止日（解約） |
| 変更あり / その他 | 入力日 |

**CSV出力項目**:
- 入力日、あおぞらID、利用者名、施設名、情報種別、利用区分
- 請求開始日（新規）、請求停止日（入院）、請求開始日（退院）、請求停止日（解約）
- データ連携日、卸会社停止連絡、卸会社再開連絡、記録者、事業所、特記

**スプレッドシート同期**:
- Cloud Function `syncChangeRecordsToSheets` でFirestoreから直接同期
- スプレッドシートID: `1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU`
- 同期ボタン押下時に全変更情報を書き込み（既存データは上書き）

**定時更新後の保持**:
- 手動追加した変更情報（IDが "kintone-" で始まらないもの）はFirestoreに保持
- Kintone連携のレコード（IDが "kintone-" で始まるもの）はclients.json優先

### Monthly Sales Export (MonthlySalesExport)

月次の自費レンタル・販売データをCSVエクスポートする機能。

**自費レンタル出力項目**:
- あおぞらID、氏名、施設名、商品名
- 単価、個数、金額（税抜）、税区分、金額（税込）
- 利用開始日、利用終了日

**販売出力項目**:
- あおぞらID、氏名、施設名、商品名
- 単価、数量、税区分、税込金額、送料、総計
- 受注日、納品日、支払い方法、取引方法
- 利用者自己負担割合、負担上限額、利用者負担額、申請額
- 申請あり、申請進捗、申請市町村、営業担当

**フィルター条件**:
- 事業所: 全事業所 / 鹿児島（ACG） / 福岡（Lichi）
- 自費レンタル: 利用終了日が選択月より前の場合は除外
- 販売: 納品日が選択月内のもののみ表示

**販売CSV自動計算**（利用者自己負担割合が設定されている場合）:
| 利用者自己負担割合 | 利用者負担額 | 申請額 |
|------------------|-------------|--------|
| 自己負担０（日常生活給付） | 0 | 総計 |
| 一部負担（日常生活給付） | 上限額 | 総計 - 上限額 |
| １〜３割負担（受領委任払い） | 総計×割合（上限額で制限） | 総計 - 利用者負担額 |
| 全額負担（償還払い） | 総計 | 総計 |

**CSVファイル名**: `{種類}_{年月}_{事業所}.csv`（例: `自費レンタル_2025-12_鹿児島（ACG）.csv`）

### Service Check Sheet Import（介護保険レンタル）

```bash
node importServiceCheckSheet.cjs  # 月次実行（GitHub Actions: monthly-service-check.yml）
```

**動作**: サービスチェックシートから介護保険レンタルデータをインポート
- 被保険者番号または利用者名でマッチング
- 既存の介護保険レンタル用具を**置換**（重複防止）
- 自費レンタル・販売は保持

**注意**:
- 新規登録利用者がclients.jsonに追加された後に実行すること
- 介護保険レンタルはこのスクリプトでのみ管理（日次同期では介護保険レンタルを保持しない）

### Insurance Rental Reconciliation (ReconciliationPage)

月次の売上（介護保険レンタル・自費レンタル・販売）と卸会社請求書（仕入）を突合する機能。

```typescript
// services/reconciliationService.ts
aggregateAllSales()                // clients → 全売上集計（3種類）
reconcileSalesWithInvoicesV2()     // 売上と請求書のマッチング
generateReconciliationCSVV2()      // CSV出力
```

**突合フロー**:
1. 月度選択 → 対象期間の売上を抽出（介護保険レンタル・自費レンタル・販売）
2. PDF請求書アップロード → Gemini OCRでCSV形式抽出
3. 利用者名 + 商品名でマッチング（あいまい検索対応）
4. 粗利計算（売上 - 仕入）
5. 結果をCSVエクスポート

**請求書OCR（複数ファイル対応）**:
- 大量データのPDF（日建リース等）は分割してアップロード可能
- 複数ファイルの結果を自動マージ（同一卸会社内でデータ蓄積）
- アップロード済みファイル一覧を表示、件数・金額を集計
- 「クリア」ボタンで卸会社単位でデータをリセット可能
- 出力形式: CSV形式（トークン効率のため）
```
山田太郎,車いす,1000
田中花子,ベッド,2000
```

**卸会社設定**: `types.ts` の `WHOLESALE_COMPANY_NAMES` で定義（7社）
- 日建リース工業株式会社、株式会社ニシケン、株式会社日本ケアサプライ
- パラマウントケアサービス株式会社、野口株式会社、株式会社キシヤ、その他

### OCR Name Matching（請求書OCR利用者名照合）

請求書OCRで抽出した利用者名を、マスターデータ（clients.json）と照合する機能。

**照合フロー**:
1. OCR抽出名を正規化（スペース除去、全角→半角、「様」除去等）
2. 学習済みマッピング（Firestore `ocrNameMappings`）から完全一致を検索
3. マスターデータから類似度ベースのあいまい検索
4. 自動照合できない場合はUIで手動選択

**手動選択UI** (`UnmatchedNamesList.tsx`):
- 候補あり: 類似度スコア付きの候補リスト + 「全てから選択」検索機能
- 候補なし: 名前・カナ・あおぞらIDで全利用者検索
- 一括操作: 「推奨をすべて選択」「すべて該当なしにする」ボタン
- 選択結果はFirestore `ocrNameMappings`に学習データとして保存

**Firestoreコレクション**: `ocrNameMappings/{docId}`
```typescript
interface OcrNameMapping {
  ocrName: string;           // 正規化されたOCR名
  ocrNameOriginal: string;   // 元のOCR名
  aozoraId: string;          // 対応するあおぞらID
  masterName: string;        // マスター利用者名
  wholesaleCompany: string;  // 卸会社
  confidence: number;        // 確信度（手動選択は1.0）
  usageCount: number;        // 使用回数
}
```

### Invoice Amount Verification（請求書金額差分検証）

請求書OCR処理時に、請求書記載の合計金額とOCR抽出明細の合計を比較・検証する機能。

**検証結果** (`VerificationResult`):
| フィールド | 説明 |
|-----------|------|
| `invoiceTotal` | 請求書記載の合計金額 |
| `calculatedTotal` | OCR抽出明細から計算した合計 |
| `difference` | 差額 |
| `isMatched` | 一致判定（差額1000円以内） |
| `pageStats` | ページごとの抽出件数・金額 |
| `suspiciousItems` | 疑わしい明細（差額に近い金額、重複等） |
| `analysisDetails` | 詳細分析メッセージ |

**UI表示**: 一致時は緑色、不一致時は赤色で差額・分析結果・疑わしい明細を表示

### Reconciliation Confirmation（売上・仕入確定機能）

月次の売上・仕入データを確定し、Firestoreに永続化する機能。

**Firestoreコレクション**: `reconciliations/{year-month}_{office}`

```typescript
// src/services/firestoreService.ts
getReconciliation()       // 確定データ取得
saveInvoiceData()         // 請求書データ保存（アップロード時）
clearInvoiceData()        // 請求書データ削除
confirmSales()            // 売上確定
unconfirmSales()          // 売上確定解除
confirmInvoice()          // 仕入確定
unconfirmInvoice()        // 仕入確定解除
confirmMonthly()          // 月次確定
unconfirmMonthly()        // 月次確定解除
```

**売上確定（3種類）**:
- 介護保険レンタル / 自費レンタル / 販売
- 確定時に件数・金額をスナップショット保存（元データが変わっても確定値は維持）

**仕入確定（7社）**:
- 日建リース工業、ニシケン、日本ケアサプライ、パラマウント、野口、キシヤ、その他
- アップロード時に自動でFirestoreに保存
- 確定後は追加アップロード・クリア不可

**月次確定**:
- すべての売上（3種類）とすべての仕入（アップロード済み卸会社）が確定済みの場合のみ可能
- 確定時に突合サマリーを保存

**確定解除**:
- 月次確定済みの場合は先に月次確定を解除する必要あり
- 解除後は再編集可能

**定時更新との関係**:
- `reconciliations`コレクションは定時更新（`clientEdits`操作）の影響を受けない
- 確定済みデータはリロード後も維持される

## Japanese Business Terms

| 用語 | 説明 |
|-----|------|
| あおぞらID | 利用者識別子（例: AZ-0001） |
| 要介護度 | 申請中, 要支援1-2, 要介護1-5 |
| 福祉用具専門相談員 | アプリのユーザーペルソナ |
| カイポケ | 介護事業者向け業務ソフト |

## Documentation Guidelines

### ドキュメント構成（4ファイル体制）

| ファイル | 目的 | 目安行数 |
|---------|------|---------|
| `CLAUDE.md` | AI開発ガイド（アーキテクチャ、パターン） | ~150行 |
| `README.md` | プロジェクト概要（人間向け） | ~150行 |
| `SYNC_SETUP.md` | 運用ガイド（同期、トラブルシュート） | ~100行 |
| `docs/SETUP_HISTORY.md` | 初期設定アーカイブ | ~60行 |

### 新機能追加時のドキュメント更新

1. **実装と同時に更新** - コードとドキュメントを同じコミットで
2. **CLAUDE.mdに追加する内容**:
   - 新しいAI機能 → AI Integrationセクション
   - 新しい実装パターン → Key Implementation Patternsセクション
   - 新しいデータフィールド → Architectureセクション
3. **README.mdは概要のみ** - 詳細はCLAUDE.mdへ

### ドキュメント肥大化を防ぐルール

- **重複禁止**: 同じ情報を複数ファイルに書かない（リンクで参照）
- **履歴は最小限**: 日付・コミットIDの羅列は避ける
- **完了したセットアップ**: `docs/SETUP_HISTORY.md`にアーカイブ
- **削除したファイル**: 参照も即座に削除
- **数値の一貫性**: 利用者数等は全ドキュメントで統一

### 定期メンテナンス

- 不要になったドキュメント/セクションは積極的に削除
- 古いSDK/API参照がないか確認（例: Vertex AI → generative-ai）
- ファイルパス変更時は全ドキュメントをgrep検索
