<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# WelfareAssist Pro / 福祉用具マネージャー

福祉用具専門相談員向けの業務管理アプリケーション。Google Gemini AIを活用して、利用者情報の一元管理、議事録の自動生成、病歴に基づいた福祉用具選定をサポートします。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2.1-61dafb.svg)](https://reactjs.org/)
[![Firebase](https://img.shields.io/badge/Firebase-Hosting-orange.svg)](https://firebase.google.com/)

**本番環境**: https://welfare-assist-pro.web.app

---

## 主な機能

### 利用者管理
- 8572件の利用者データ（Google Sheets + Kintone連携）
- 460件の福祉用具利用者を自動識別・フィルタリング
- 毎日00:00 JSTに自動同期

### AI統合（Gemini 2.5 Flash）
- **議事録自動生成**: 粗いメモ → フォーマット済み議事録
- **福祉用具提案**: 病歴・要介護度から最適な用具を提案
- **医療文書OCR**: PDF/画像から病歴情報を抽出
- **請求書OCR**: 卸会社請求書PDF → 明細抽出（会社別対応、金額差分検証）
- **OCR名前マッチング**: 請求書利用者名の自動照合・学習機能

### 6つの管理タブ
1. **基本情報** - 個人情報・介護保険情報
2. **病歴・状態** - 医療履歴 + AI提案
3. **議事録一覧** - 会議記録 + AI生成
4. **変更情報** - 入院/退院/新規/解約の管理
5. **福祉用具選定** - 介護保険レンタル・自費・販売
6. **売上管理** - 自費レンタル・販売の売上記録

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
├── components/
│   ├── ClientList.tsx      # 利用者一覧
│   └── ClientDetail.tsx    # 利用者詳細（6タブ）
├── services/
│   ├── geminiService.ts    # AI統合
│   └── firestoreService.ts # データ永続化
├── src/
│   ├── contexts/           # 認証コンテキスト
│   └── firebaseConfig.ts   # Firebase設定
├── types.ts                # TypeScript型定義
└── App.tsx                 # メインアプリ
```

---

## データモデル

### Client（利用者）

```typescript
interface Client {
  aozoraId: string;           // 識別子
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

---

## データ同期

詳細は [SYNC_SETUP.md](./SYNC_SETUP.md) を参照。

| 同期タイプ | 頻度 | 内容 |
|-----------|------|------|
| Daily Sync | 自動（毎日00:00 JST） | Google Sheets（自費レンタル、販売） + Kintone |
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
