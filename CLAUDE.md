# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** - 福祉用具専門相談員向け業務管理アプリ。

- **本番**: https://welfare-assist-pro.web.app
- **データ**: 8,477件の利用者（Google Sheets + Kintone連携）
- **AI**: Gemini 2.0 Flash（議事録生成、用具提案、医療文書OCR、請求書OCR）
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
```

**マージ処理**: `src/services/firestoreService.ts` の `mergeAllClientEdits()`

**重要**: selectedEquipmentは**結合**（置換ではない）
```typescript
// ベースデータ（介護保険レンタル）とFirestore（販売等）を結合
const mergedSelectedEquipment = mergeEquipmentArrays(
  baseClient.selectedEquipment || [],  // clients.json
  edits.selectedEquipment || []        // Firestore
);
```
これにより、サービスチェックシートからインポートした介護保険レンタルと、アプリで手動追加した販売・自費レンタルの両方が保持される。

### Component Structure

```
App.tsx
├── ClientList (左サイドバー: 検索/フィルター)
├── ReconciliationPage (介保レンタル売上・請求突合)
├── WelfareUsersSummary (福祉用具集計)
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
| `services/geminiService.ts` | AI機能（議事録生成、用具提案、OCR） |
| `services/reconciliationService.ts` | 介保レンタル売上・請求突合ロジック |
| `src/services/firestoreService.ts` | ユーザー編集の永続化・マージ処理 |
| `importSpreadsheetData.cjs` | Google Sheets同期（自費レンタル、販売）- 日次自動 |
| `importFromKintone.cjs` | Kintone同期（変更レコード）- 日次自動 |
| `importServiceCheckSheet.cjs` | サービスチェックシート（介護保険レンタル）- 月次 |

## AI Integration

**SDK**: `@google/generative-ai`（ブラウザ互換）
**Model**: `gemini-2.0-flash-exp`

```typescript
// services/geminiService.ts
generateMeetingSummary()           // 粗いメモ → 正式議事録
suggestEquipment()                 // 病歴から用具提案
extractMedicalInfoFromDocument()   // PDF/画像 → 医療情報抽出
parseWholesaleInvoice()            // 卸会社請求書PDF → JSON抽出
```

**重要**: `@google-cloud/vertexai`はNode.js専用のため使用不可

## Data Sync Architecture

### データソース分離（重要）

| データ種別 | インポートスクリプト | 頻度 |
|-----------|-------------------|------|
| 自費レンタル、販売 | `importSpreadsheetData.cjs` | 日次自動 |
| 変更レコード | `importFromKintone.cjs` | 日次自動 |
| 介護保険レンタル | `importServiceCheckSheet.cjs` | 月次 |

**注意**: 介護保険レンタルは`importServiceCheckSheet.cjs`でのみ管理。`importSpreadsheetData.cjs`では介護保険レンタルを保持しない（重複防止）。

### GitHub Actions Workflows

| ワークフロー | スケジュール | 内容 |
|------------|------------|------|
| `daily-sync.yml` | 毎日00:00 JST | スプレッドシート + Kintone同期 |
| `monthly-service-check.yml` | 毎月1日09:00 JST | サービスチェックシート同期 |

詳細: [SYNC_SETUP.md](./SYNC_SETUP.md)

## Key Implementation Patterns

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

月次の介護保険レンタル売上と卸会社請求書を突合する機能。

```typescript
// services/reconciliationService.ts
aggregateInsuranceRentalSales()    // clients → 介護保険レンタル集計
reconcileSalesWithInvoices()       // 売上と請求書のマッチング
generateReconciliationCSV()        // CSV出力
```

**突合フロー**:
1. 月度選択 → 対象期間の介護保険レンタルを抽出
2. PDF請求書アップロード → Gemini OCRでJSON化
3. 利用者名 + 商品名でマッチング（あいまい検索対応）
4. 結果をCSVエクスポート

**卸会社設定**: `types.ts` の `WHOLESALE_COMPANY_NAMES` で会社名を変更可能

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
