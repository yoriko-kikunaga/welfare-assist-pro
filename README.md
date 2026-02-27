<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# WelfareAssist Pro / 福祉用具マネージャー

福祉用具専門相談員向けの業務管理アプリケーション。Google Gemini AIを活用して、利用者情報の一元管理、議事録の自動生成、病歴に基づいた福祉用具選定、売上・仕入突合、自社ベッド在庫管理をサポートします。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2.1-61dafb.svg)](https://reactjs.org/)
[![Firebase](https://img.shields.io/badge/Firebase-Hosting-orange.svg)](https://firebase.google.com/)

**本番環境**: https://welfare-assist-pro.web.app

---

## 主な機能

### 利用者管理
- 8635件の利用者データ（Google Sheets + Kintone連携）
- 460件の福祉用具利用者を自動識別・フィルタリング
- 毎日00:00 JSTに自動同期

### AI統合（Gemini 2.5 Flash）
- **議事録自動生成**: 粗いメモ → フォーマット済み議事録
- **福祉用具提案**: 病歴・要介護度から最適な用具を提案
- **医療文書OCR**: PDF/画像から病歴情報を抽出
- **請求書OCR**: 卸会社請求書PDF → 明細抽出（会社別対応、金額差分検証）
- **OCR名前マッチング**: 請求書利用者名の自動照合・学習機能

### 利用者詳細（6タブ）
1. **基本情報** - 個人情報・介護保険情報（Firestore永続化）
2. **病歴・状態** - 医療履歴 + AI提案
3. **議事録一覧** - 会議記録 + AI生成
4. **変更情報** - 入院/退院/新規/解約の管理（日付ペアリング）
5. **福祉用具選定** - 介護保険レンタル・自費・販売（カスケードフィルタ）
6. **売上管理** - 自費レンタル・販売の売上記録

### 売上・仕入突合
- 月度別・卸会社別の売上と仕入（請求書）を自動突合
- 請求書OCR（PDF）/ CSVインポート対応（6社）
- 1:N附属品マッチング（ベッド本体+サイドレール等）
- インライン紐づけ編集（画面上で直接修正）
- 突合結果CSV出力・再インポートによる一括更新
- 売上確定・仕入確定・月次確定の3段階管理

### 月次売上処理
- 介護保険レンタル・自費レンタル・販売の3タブ
- カイポケCSVインポート（介護保険レンタル月次取込）
- 事業所別フィルタ・CSV出力・売上確定

### 変更情報一覧
- 全利用者の変更レコード一覧表示・CSV出力
- スプレッドシート同期（Cloud Functions）
- 事業所別フィルタ

### 自社ベッド管理
- ベッド本体・サイドレール・マットレスの在庫管理
- ライフサイクル追跡（在庫 → 貸出中 → 返却 → 消毒中 → 完了）
- セット管理・一括貸出
- 償却計算・消毒履歴・CSV出力

---

## クイックスタート

### 開発環境

```bash
# 依存関係インストール
npm install

# 開発サーバー起動
npm run dev

# 本番ビルド
npm run build

# Firebase デプロイ
firebase deploy --only hosting
```

### 必要な環境変数

```env
GEMINI_API_KEY=your_gemini_api_key
```

---

## 技術スタック

| カテゴリ | 技術 |
|---------|------|
| フロントエンド | React 19, TypeScript, TailwindCSS |
| ビルド | Vite 6 |
| 認証 | Firebase Authentication (Google Sign-In) |
| データ永続化 | Firestore |
| ホスティング | Firebase Hosting |
| AI | Gemini 2.5 Flash (Cloud Functions + Vertex AI) |
| CI/CD | GitHub Actions |

---

## プロジェクト構造

```
welfare-assist-pro/
├── App.tsx                          # メインアプリ
├── types.ts                         # 全型定義
├── components/
│   ├── ClientList.tsx               # 利用者一覧（検索・フィルター）
│   ├── ClientDetail.tsx             # 利用者詳細（6タブ）
│   ├── ReconciliationPage.tsx       # 売上・仕入突合
│   ├── MonthlySalesExport.tsx       # 月次売上処理（3タブ）
│   ├── ChangeRecordsExport.tsx      # 変更情報一覧・CSV出力
│   ├── BedInventoryPage.tsx         # 自社ベッド管理（3タブ）
│   ├── WelfareUsersSummary.tsx      # 福祉用具集計
│   ├── ClientSearchModal.tsx        # 利用者検索モーダル
│   ├── InvoiceItemPickerModal.tsx   # 仕入データ選択モーダル
│   └── UnmatchedNamesList.tsx       # 未マッチ利用者選択UI
├── services/
│   ├── geminiService.ts             # AI統合（議事録・OCR・CSVパース）
│   └── reconciliationService.ts     # 突合ロジック
├── src/
│   ├── services/
│   │   ├── firestoreService.ts      # Firestore永続化
│   │   ├── nameMatchingService.ts   # OCR名前マッチング
│   │   ├── kaipokeImportService.ts  # カイポケCSVインポート
│   │   └── bedInventoryService.ts   # ベッド在庫管理
│   ├── utils/
│   │   └── gaiji.ts                 # 外字（異体字）変換
│   ├── contexts/                    # 認証コンテキスト
│   └── firebaseConfig.ts           # Firebase設定
├── functions/src/index.ts           # Cloud Functions（TypeScript）
├── functions-python/main.py         # Cloud Functions（Python・日建リースOCR）
├── importSpreadsheetData.cjs        # Google Sheets日次同期
├── importFromKintone.cjs            # Kintone日次同期
└── copy-clients.cjs                 # ビルド時clients.jsonコピー
```

---

## データモデル

### Client（利用者）

```typescript
interface Client {
  aozoraId: string;           // 識別子（例: AZ-0001）
  name: string;               // 氏名
  careLevel: CareLevel;       // 要介護度
  isWelfareEquipmentUser: boolean;  // 福祉用具利用フラグ
  meetings: MeetingRecord[];  // 議事録
  changeRecords: ClientChangeRecord[];  // 変更情報
  selectedEquipment: Equipment[];  // 福祉用具
  salesRecords: SalesRecord[];  // 売上
}
```

### 主要な型

| 型 | 値 |
|---|---|
| CareLevel | 申請中, 要支援1-2, 要介護1-5 |
| EquipmentType | 車いす, 特殊寝台, 手すり, 歩行器 等13種類 |
| EquipmentStatus | 介護保険レンタル, 自費レンタル, 販売 |
| WholesaleCompany | 日建リース工業, 野口株式会社, 株式会社ニシケン, パラマウントケアサービス, 日本ケアサプライ, 株式会社キシヤ |

---

## データ同期

詳細は [SYNC_SETUP.md](./SYNC_SETUP.md) を参照。

| 同期タイプ | 頻度 | 内容 |
|-----------|------|------|
| Daily Sync | 自動（毎日00:00 JST） | Google Sheets（自費レンタル、販売） + Kintone（変更レコード） |
| 介護保険レンタル | 手動（月次） | カイポケCSVをブラウザからインポート |

---

## ドキュメント

| ファイル | 内容 |
|---------|------|
| [CLAUDE.md](./CLAUDE.md) | AI開発ガイド・アーキテクチャ詳細 |
| [SYNC_SETUP.md](./SYNC_SETUP.md) | データ同期・運用ガイド |
| [docs/SETUP_HISTORY.md](./docs/SETUP_HISTORY.md) | 初期セットアップ履歴 |

---

## 開発者

- **yoriko-kikunaga** - [yoriko.kikunaga@aozora-cg.com](mailto:yoriko.kikunaga@aozora-cg.com)

---

<div align="center">
Made with React + TypeScript + Gemini AI
</div>
