# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WelfareAssist Pro (福祉用具マネージャー)** - 福祉用具専門相談員向け業務管理アプリ。

- **本番**: https://welfare-assist-pro.web.app
- **データ**: 8,469件の利用者（Google Sheets + Kintone連携）
- **AI**: Gemini 2.0 Flash（議事録生成、用具提案、医療文書OCR）
- **同期**: 毎日00:00 JST自動同期（GitHub Actions）

## Essential Commands

```bash
# 開発
npm run dev              # 開発サーバー起動
npm run build            # 本番ビルド
firebase deploy --only hosting  # デプロイ

# データ同期（通常は自動実行）
node importSpreadsheetData.cjs  # Google Sheets同期
node importFromKintone.cjs      # Kintone同期
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

**注意**: 空配列のマージ時は長さをチェック（空配列でベースデータを上書きしない）
```typescript
selectedEquipment: (edits.selectedEquipment?.length
  ? edits.selectedEquipment
  : baseClient.selectedEquipment) || []
```

### Component Structure

```
App.tsx
├── ClientList (左サイドバー: 検索/フィルター)
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
| `src/services/firestoreService.ts` | ユーザー編集の永続化 |
| `importSpreadsheetData.cjs` | Google Sheets同期スクリプト |
| `importFromKintone.cjs` | Kintone同期スクリプト |

## AI Integration

**SDK**: `@google/generative-ai`（ブラウザ互換）
**Model**: `gemini-2.0-flash-exp`

```typescript
// services/geminiService.ts
generateMeetingSummary()           // 粗いメモ → 正式議事録
suggestEquipment()                 // 病歴から用具提案
extractMedicalInfoFromDocument()   // PDF/画像 → 医療情報抽出
```

**重要**: `@google-cloud/vertexai`はNode.js専用のため使用不可

## Data Sync Architecture

Daily Syncで以下を保持（上書きしない）:
- `changeRecords`: Kintoneからの変更レコード
- `selectedEquipment`: サービスチェックシートからの介護保険レンタル
- `insuranceNumber`, `kaipokeRegistrationStatus`: 週次手動インポート

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

## Japanese Business Terms

| 用語 | 説明 |
|-----|------|
| あおぞらID | 利用者識別子（例: AZ-0001） |
| 要介護度 | 申請中, 要支援1-2, 要介護1-5 |
| 福祉用具専門相談員 | アプリのユーザーペルソナ |
| カイポケ | 介護事業者向け業務ソフト |
