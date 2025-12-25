<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# WelfareAssist Pro / 福祉用具マネージャー

福祉用具専門相談員向けの業務管理アプリケーション。Google Gemini AIを活用して、利用者情報の一元管理、議事録の自動生成、病歴に基づいた福祉用具選定をサポートします。

[![Version](https://img.shields.io/badge/version-0.0.0-blue.svg)](https://github.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.2-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.2.1-61dafb.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2.0-646cff.svg)](https://vitejs.dev/)

---

## 📋 目次

- [概要](#概要)
- [主な機能](#主な機能)
- [画面構成と詳細項目](#画面構成と詳細項目)
- [技術スタック](#技術スタック)
- [プロジェクト構造](#プロジェクト構造)
- [セットアップ手順](#セットアップ手順)
- [開発ガイド](#開発ガイド)
- [データモデル](#データモデル)
- [AI統合機能](#ai統合機能)
- [UI/UX設計](#uiux設計)
- [今後の拡張計画](#今後の拡張計画)

---

## 🎯 概要

**WelfareAssist Pro**は、福祉用具専門相談員の日常業務を効率化するために開発されたウェブアプリケーションです。

### 主な対象業務

- 利用者情報・議事録の一元管理
- 担当者会議・カンファレンスの記録作成
- 福祉用具の選定・納期管理
- 売上管理（自費・販売）
- 利用者の新規登録・変更情報（入院・退院・解約）の管理

### 開発ステータス

- **バージョン**: 0.0.0（開発初期段階）
- **対応地域**: 鹿児島、福岡
- **AI統合**: Vertex AI（Gemini 2.5 Flash）+ Workload Identity認証
- **デプロイ**: Firebase Hosting（https://welfare-assist-pro.web.app）
- **自動同期**: GitHub Actions（1時間ごと）
- **データソース**: Google スプレッドシート（あおぞらIDマスタ、福祉用具利用者）

---

## ✨ 主な機能

### 0. 認証・ログイン

- **Google Workspaceログイン**: Google Workspaceアカウントでのシングルサインオン（SSO）
- **Firebase Authentication**: セキュアな認証基盤
- **アクセス制御**: 認証済みユーザーのみがアプリケーションにアクセス可能
- **自動セッション管理**: ログイン状態の永続化
- **ログアウト機能**: 安全なセッション終了

**認証フロー:**
1. 未認証ユーザーはログイン画面が表示される
2. 「Googleでログイン」ボタンをクリック
3. Google Workspaceアカウントで認証
4. 認証成功後、アプリケーションのメイン画面へリダイレクト
5. ログアウト時は自動的にログイン画面へ戻る

**セキュリティ機能:**
- Firebase Authentication SDKによる安全な認証
- HTTPSによる通信の暗号化
- トークンベースの認証（自動更新）
- ログイン状態の自動検証

### 1. 利用者管理

- **基本情報管理**: 氏名、生年月日、性別、要介護度、負担割合
- **住所・施設情報**: 入居施設、部屋番号、住所
- **緊急連絡先**: キーパーソンの情報管理
- **病歴・身体状況**: 詳細な医療履歴の記録
- **データ自動同期**: Google スプレッドシートから1時間ごとに自動更新
  - 総利用者数: 8,406件
  - 福祉用具利用者: 457件（2025年12月時点）
  - 自動識別・フラグ付け
- **検索機能**: 氏名、氏名カナ、あおぞらIDで即座に絞り込み
- **フィルター機能**: 福祉用具利用者のみを表示可能
- **福祉用具集計ビュー**: 福祉用具利用者（457件）を施設別・Status別でグループ化して表示
  - 施設別: 施設ごとにまとめて表示（施設利用者以外は「在宅」でまとめる）
  - Status別: 介護保険レンタル・自費利用・併用で分類
- **スプレッドシート連携**:
  - 生保受給者の自動判定（184件）
  - 利用初回日の自動登録（358件）
  - 変更履歴への自動反映
  - 居宅介護支援事業所の自動登録（358件）
  - 基本情報に自動反映、議事録から参照可能
- **データ品質向上**（自動インポート統合済み）:
  - 被保険者証情報から要介護度を更新（497件）✅ 復元完了
  - 給付率から負担割合を自動変換（26件）✅ 復元完了
  - 担当ケアマネージャー情報を追加（496件）✅ 復元完了
  - 居宅介護支援事業所を自動登録（358件）✅ 復元完了
  - 女性名パターンマッチングによる性別補正（2,202件）✅ 復元完了
  - 自費レンタル福祉用具データを自動取得（119件）✅ 復元完了
  - 売上レコードを自動作成（119件）✅ 復元完了
  - **重要**: importSpreadsheetData.cjsに完全統合され、1時間ごとの自動同期で継続的に更新
  - **修正履歴**（2025-12-24）:
    - importAdditionalData.cjsのロジックを統合（要介護度、負担割合、担当CM）
    - importWelfareData.cjsのロジックを統合（居宅介護支援事業所、生保受給）
    - importSelfPayRental.cjsのロジックを統合（自費レンタル福祉用具データ）
    - createSalesFromEquipment.cjsのロジックを統合（売上レコード自動作成）
    - これにより、importSpreadsheetData.cjsの実行だけで全データが正しく復元されるようになりました
    - 利用者新規・変更情報入力の初期データ構造を修正:
      - importFromKintone.cjs: recordDateフィールドを追加、フィールド名を型定義に統一
      - ClientDetail.tsx: 事業所を「鹿児島（ACG）」で固定設定
      - 全ての変更レコードの事業所を「鹿児島（ACG）」で統一
      - 修正により、kintone連携データと手動入力データの構造が完全に一致
    - **重要**: importSpreadsheetData.cjsを既存データ保持に対応:
      - 既存のclients.jsonを読み込み、changeRecords、meetings、plannedEquipmentを保持
      - これにより、スプレッドシート更新時にKintoneから取得した変更レコードが失われなくなりました
      - 実行順序: importSpreadsheetData.cjs → importFromKintone.cjs（両方実行で完全なデータ）
    - **重要**: データ読み込み方法の改善（2025-12-24）:
      - clients.json（7.7MB）をpublicフォルダに配置し、動的読み込みに変更
      - バンドルサイズを6.2MBから483KBに大幅削減（92%削減）
      - データ更新後は`cp clients.json public/clients.json`でpublicフォルダにコピーが必要
      - App.tsxでuseEffectとfetchを使用してデータを動的に取得

### 2. 議事録管理（AI統合）

- **会議種別対応**:
  - カンファレンス時
  - 担当者会議（新規・更新・退院時）
  - その他
- **AI自動生成**: 粗いメモからフォーマット済み議事録を生成
  - 【日時・場所】
  - 【出席者】
  - 【検討内容】
  - 【決定事項】
  - 【次回アクション】
- **リマインダー機能**: フォローアップ管理
- **基本情報連携**:
  - 居宅介護支援事業所と担当CMを基本情報タブから自動参照
  - 議事録フォームで読み取り専用表示
  - 一元管理により情報の整合性を保証

### 3. 福祉用具選定（AI提案）

- **13種類の用具カテゴリ対応**:
  - 車いす / 車いす付属品
  - 特殊寝台 / 特殊寝台付属品
  - 床ずれ防止用具
  - 体位変換器
  - 手すり
  - スロープ
  - 歩行器 / 歩行補助杖
  - 認知症老人徘徊感知機器
  - 移動用リフト
  - 自動排泄処理装置
  - その他

- **AI用具提案**: 利用者の病歴・要介護度に基づいた推奨用具の提示
- **詳細管理項目**:
  - タイスコード、メーカー名、卸会社
  - 発注・納品・開始・終了日の管理
  - リース/自社の区分管理
  - 月額費用・単位数の記録

### 4. 利用者変更情報管理

- **情報区分**:
  - 新規
  - 入院
  - 退院
  - 新規（自費レンタル・購入）
  - 解約（保険レンタル・自費レンタル・購入）

- **複雑な日付管理**:
  - 新規時の請求開始日
  - 入院時の請求停止日
  - 退院時の請求開始日
  - 解約時の請求停止日
  - 卸会社への連絡状況管理

- **スプレッドシート連携**:
  - Google スプレッドシートへの自動エクスポート
  - エクスポート先: [利用者変更情報](https://docs.google.com/spreadsheets/d/1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU/edit)
  - 対象: 福祉用具利用者のみ（isWelfareEquipmentUser = true）
  - エクスポート項目:
    - 入力日（recordDate）
    - あおぞらID
    - 利用者名
    - 施設名
    - 情報種別（新規/入院/退院/解約）
    - 請求開始日（新規）
    - 請求停止日（入院）
    - 請求開始日（退院）
    - 請求停止日（解約）
    - データ連携日（情報種別に応じた日付）
    - 記録者
    - 事業所
  - ソート順: データ連携日の昇順（古い順）

### 5. 売上管理

- **ステータス管理**: 自費レンタル / 販売
- **税計算機能**:
  - 非課税
  - 10%（標準税率）
  - 軽8%（軽減税率）
  - 税込価格
- **自動計算**: 数量 × 単価 × 税率
- **合計売上集計**: リアルタイム計算

---

## 📺 画面構成と詳細項目

このセクションでは、アプリケーションの実際の画面構成と、各タブで入力・管理できるすべての項目を詳細に説明します。

### 画面全体の構成

```
┌─────────────────────────────────────────────────────┐
│  WelfareAssist Pro                                  │
├──────────┬──────────────────────────────────────────┤
│          │  ヘッダー（利用者名・編集ボタン）       │
│          ├──────────────────────────────────────────┤
│ 利用者   │  タブナビゲーション                      │
│ 一覧     │  ├─ 基本情報・住所                      │
│          │  ├─ 病歴・状態                          │
│ (Client  │  ├─ 議事録一覧                          │
│  List)   │  ├─ 利用者新規・変更情報入力            │
│          │  ├─ 福祉用具選定                        │
│          │  └─ 売上管理（自費・販売）              │
│          ├──────────────────────────────────────────┤
│          │  コンテンツエリア                        │
│          │  (選択されたタブの内容)                  │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

### ClientList（利用者一覧）

左側のサイドバーに表示される利用者一覧画面です。

**表示項目:**
- **福祉用具チェックボックス**: 利用者が福祉用具利用者かどうかを示すチェックボックス
  - チェックON: 福祉用具利用者として登録される
  - チェックOFF: 福祉用具利用者から除外される
  - リアルタイムで「福祉用具 (XXX)」のカウントが更新される
- 利用者名（大きい文字）
- フリガナ（小さい文字）
- 要介護度（バッジ表示）
- 入居施設名（小さい文字）

**操作:**
- **新規追加ボタン**: 新しい利用者を登録
- **フィルターボタン**: 「全員」と「福祉用具」で絞り込み
- **検索ボックス**: 氏名・カナ・IDで検索
- **福祉用具集計ボタン**: 福祉用具利用者の集計ビューを表示
- **利用者クリック**: ClientDetail画面へ遷移
- **福祉用具チェックボックスクリック**: 福祉用具利用者フラグをON/OFF切り替え（イベント伝播を停止してDetailへの遷移は発生しない）

**実装詳細:**

チェックボックスの配置と動作:
```tsx
// 各利用者アイテムの左側にチェックボックスを配置
<li key={client.id}>
  <button className="w-full ...">
    <div className="flex items-center gap-3">
      {/* 福祉用具チェックボックス */}
      <input
        type="checkbox"
        checked={client.isWelfareEquipmentUser}
        onChange={(e) => {
          e.stopPropagation(); // 親要素（利用者詳細への遷移）へのイベント伝播を停止
          onToggleWelfareUser(client.id, e.target.checked);
        }}
        className="w-5 h-5 text-primary-600 rounded cursor-pointer"
      />

      {/* 利用者情報 */}
      <div className="flex-1">
        <span>{client.name}</span>
        ...
      </div>
    </div>
  </button>
</li>
```

データフロー:
```
1. ClientList: チェックボックスクリック
   ↓
2. App.tsx: onToggleWelfareUser(clientId, checked)
   ↓
3. setClients: client.isWelfareEquipmentUser を更新
   ↓
4. welfareUserCount: 自動再計算（435件 → XXX件）
   ↓
5. ClientList: 「福祉用具 (XXX)」表示更新
```

Props追加:
- `ClientListProps`に`onToggleWelfareUser: (clientId: string, checked: boolean) => void`を追加
- `App.tsx`で実装:
  ```tsx
  const handleToggleWelfareUser = (clientId: string, checked: boolean) => {
    setClients(prev => prev.map(c =>
      c.id === clientId ? { ...c, isWelfareEquipmentUser: checked } : c
    ));
  };
  ```

### WelfareUsersSummary（福祉用具集計）

福祉用具利用者（435件）を施設別・Status別でグループ化して表示する集計画面です。

**画面へのアクセス方法:**
1. 左サイドバーの「福祉用具集計」ボタン（オレンジ色のボタン）をクリック
2. 福祉用具利用者集計画面が表示されます

**2段階タブ構造:**

画面上部のヘッダー部分に2つのタブレベルが表示されます：

```
┌─────────────────────────────────────────────────────┐
│ 福祉用具利用者集計                                        │
│ 総利用者数: 435件                                        │
│                                                       │
│ [施設別] [Status別]  ← 1段目: 主タブ（グループ化方法選択）  │
│                                                       │
│ [在宅 (150)] [さくら (25)] [ひまわり (30)] ...          │
│              ↑ 2段目: サブタブ（個別グループ選択）          │
└─────────────────────────────────────────────────────┘
```

- **1段目: 主タブ（グループ化方法選択）**:
  - **施設別タブ**: 施設ごとにグループ化（施設利用者以外は「在宅」でまとめる）
    - 青色（primary-600）で選択状態を表示
  - **Status別タブ**: 介護保険レンタル・自費利用・併用で分類
    - 青色（primary-600）で選択状態を表示

- **2段目: サブタブ（個別グループ選択）**:
  - 各グループをタブとして表示（例: 「在宅 (150)」「特別養護老人ホーム さくら (25)」）
  - オレンジ色（accent-600）で選択状態を表示
  - 選択したグループの利用者のみを下部に詳細表示
  - タブには件数も表示

**各グループの詳細表示項目:**
- グループ名と件数（ヘッダー）
- 利用者名・カナ
- あおぞらID
- 要介護度
- 施設情報（Status別の場合）または居室番号（施設別の場合）
- 福祉用具件数

### ClientDetail（利用者詳細）- 6つのタブ

利用者を選択すると表示される詳細管理画面です。

---

#### タブ1: 基本情報・住所

利用者の基本的な個人情報と介護保険情報を管理します。

**基本情報セクション:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| あおぞらID | テキスト | 利用者の一意識別子（例: AZ-0001） |
| 氏名 | テキスト | 利用者の姓名 |
| フリガナ | テキスト | カタカナ表記 |
| 生年月日 | 日付選択 | YYYY-MM-DD形式 |
| 性別 | ドロップダウン | 男性 / 女性（福祉用具利用者77件を女性名パターンで補正済み） |
| 入居施設名 | テキスト | 施設入居中の場合に入力 |
| 居室番号 | テキスト | 施設の部屋番号（例: 101, 205） |
| 現在の状況 | ドロップダウン | 在宅 / 入院中 / 施設入居中 |
| 住所 | テキスト | 自宅住所 |

**ケアマネージャー情報セクション:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 居宅介護支援事業所 | テキスト | ケアマネジャーが属する事業所（福祉用具スプレッドシートから自動登録） |
| 担当CM | テキスト | 担当ケアマネジャー名（被保険者証情報スプレッドシートからインポート済み） |

**介護保険情報セクション（水色背景）:**

| 項目名 | 入力形式 | 選択肢 | 備考 |
|--------|----------|--------|------|
| 要介護度 | ドロップダウン | 申請中 / 要支援1 / 要支援2 / 要介護1〜5 | 被保険者証情報から497件インポート済み |
| 負担割合 | ドロップダウン | 1割 / 2割 / 3割 | 給付率から自動変換（26件更新） |
| 介護保険被保険者証 | ドロップダウン | 確認済 / 未確認 | |
| 介護保険負担割合証 | ドロップダウン | 確認済 / 未確認 | |

**支払い区分:**

| 項目名 | 入力形式 | 選択肢 | 備考 |
|--------|----------|--------|------|
| 支払い区分 | ドロップダウン | 非生保 / 生保 | 福祉用具スプレッドシートの生保受給データから自動設定 |

**キーパーソン情報セクション:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 氏名 | テキスト | 緊急連絡先の名前 |
| 続柄 | テキスト | 利用者との関係（例: 長男、夫、娘） |
| 連絡先 | テキスト | 電話番号 |

**カイポケ連携:**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| カイポケ登録（基本情報） | ドロップダウン | 未登録 / 登録済（登録済の場合は緑色背景） |

---

#### タブ2: 病歴・状態

利用者の医療情報と、AI提案による福祉用具の選定予定を管理します。

**病歴・身体状況セクション:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 病歴・身体状況 | 複数行テキスト（8行） | 病名、麻痺の有無、ADL状態などを詳細に記載 |

**AI統合機能:**

| ボタン名 | 機能 | 出力 |
|----------|------|------|
| 病歴から用具を提案 | Google Gemini AIによる分析 | 利用者の病歴・要介護度に基づいた3つの福祉用具提案 + 理由説明（紫色背景で表示） |

**選定予定の福祉用具セクション:**

このセクションでは、検討中の福祉用具をリスト化できます。

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 品名 | テキスト | 福祉用具の名称 |
| 種目/カテゴリー | テキスト | 用具の分類 |

- **追加ボタン**: 新しい予定用具を追加
- **削除ボタン**: 個別の用具を削除（編集モード時）

---

#### タブ3: 議事録一覧

担当者会議やカンファレンスの記録を管理し、AIによる議事録自動生成が可能です。

**レコード追加:** 「＋ 記録を追加」ボタン

**各議事録レコードの入力項目:**

**ヘッダーセクション（水色背景）:**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| 事業所 | ドロップダウン | 鹿児島 / 福岡 |
| 会議タイプ | ドロップダウン | カンファレンス時 / 担当者会議（新規）/ 担当者会議（更新）/ 担当者会議（退院時）/ その他 |
| 日付 | 日付選択 | 会議実施日 |

**基本情報（2列×2行グリッド）:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 記録者 | テキスト | 記録を作成した担当者名 |
| 施設名 | テキスト | 会議実施場所 |
| 居宅介護支援事業所 | テキスト（読み取り専用） | 基本情報タブから自動参照（福祉用具スプレッドシートから自動登録） |
| 担当CM | テキスト（読み取り専用） | 基本情報タブから自動参照 |

**医療機関情報（グレー背景）:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 病院名 | テキスト | 退院カンファレンスの場合に記載 |
| 担当SW | テキスト | ソーシャルワーカー名 |

**参加者情報:**

| 項目名 | 入力形式 |
|--------|----------|
| 出席者 | テキスト |

**利用区分（ラジオボタン）:**

- 介護保険レンタル
- 自費レンタル
- 購入

**ステータス確認（2列グリッド）:**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| ケアプラン | ドロップダウン | 確認済 / 未確認 |
| 提供票 | ドロップダウン | 確認済 / 未確認 |

**議事録コンテンツ（2列構成）:**

**左側: 議事録内容**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 議事録内容 | 複数行テキスト | 粗いメモや箇条書き |
| リマインダー | ラジオボタン | あり / なし（黄色背景で強調） |

**右側: AI生成サマリー**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| AI作成/更新ボタン | ボタン | Google Gemini AIによる正式議事録生成 |
| AI生成サマリー | 読み取り専用テキスト | フォーマット済み議事録（【日時・場所】【出席者】【検討内容】【決定事項】【次回アクション】） |

---

#### タブ4: 利用者新規・変更情報入力

利用者の状態変化（新規登録、入院、退院、解約）を記録し、請求管理を追跡します。

**レコード追加:** 「＋ 情報を追加」ボタン

**新しいフォーマット（2025-12-24更新）:**

シンプルで使いやすい統一フォーマットに変更されました。

**各変更情報レコードの入力項目:**

**1. 情報種別セクション:**

| 項目名 | 入力形式 | 選択肢 | 説明 |
|--------|----------|--------|------|
| 情報種別 | ドロップダウン | 新規 / 入院 / 退院 / 解約 | 変更の種類を選択 |
| 入力日 | 日付選択 | - | 情報を記録した日付 |

**2. 利用者情報（読み取り専用）:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| あおぞらID | テキスト（読み取り専用） | 利用者の一意識別子 |
| 利用者名 | テキスト（読み取り専用） | 利用者の氏名 |
| 施設名 | テキスト（読み取り専用） | 入居施設名（在宅の場合は「在宅」） |

**3. 記録者・事業所:**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| 記録者 | テキスト | 記録を作成した担当者名 |
| 事業所 | ドロップダウン | 鹿児島（ACG） / 福岡（Lichi） |

**4. 情報種別に応じた項目:**

情報種別によって、表示される項目が動的に変わります。

| 情報種別 | 表示される項目 | 説明 |
|---------|--------------|------|
| **新規** | 請求開始日（新規） | 新規契約時の請求開始日 |
| **入院** | 請求停止日（入院） | 入院によるサービス停止日 |
| **退院** | 請求開始日（退院） | 退院によるサービス再開日 |
| **解約** | 請求停止日（解約） | 解約時の請求停止日 |

**5. 特記事項:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 特記 | 複数行テキスト | 補足情報・備考 |

**表示順序と表示形式:**

レコードは優先順位別に整理されて表示されます：

1. **最新追加レコード（最上部）**: 「＋ 情報を追加」ボタンで作成した最新のレコード
   - ID（タイムスタンプ）が最大のレコードを自動判定
   - `border-2 border-accent-500`（オレンジ色のボーダー）で強調表示
   - 情報種別に応じた背景色で表示（新規: 青、入院: 赤、退院: 緑、解約: グレー）
   - 統一フォーマットで全項目を表示

2. **入院・退院ペア（上部）**: 入院（左側）と退院（右側）を1つのカードで横並び表示
   - 入院記録の日付に基づいてペアリング
   - 退院情報がない場合は「退院情報なし」と表示
   - 入院日の新しい順に表示

3. **新規グループ（中部）**: 新規契約の記録を表示
   - 最新追加レコードを除く新規レコード
   - 開始日の新しい順に表示

4. **解約グループ（下部）**: 解約の記録を表示
   - 最新追加レコードを除く解約レコード
   - 解約日の新しい順に表示

**主な機能:**
- **最新レコードの自動優先表示**: 追加した情報が常に最上部に表示され、見つけやすい
- **視覚的な強調**: 最新レコードはオレンジ色のボーダーで他のレコードと明確に区別
- 情報種別をプルダウンで選択可能
- あおぞらID、利用者名、施設名を読み取り専用で表示
- 情報種別に応じて必要な項目のみを表示
- グループ別の整理された表示で入退院の状況を把握しやすく
- 編集モード時に削除ボタンを表示

**連携機能:**
- Kintoneから自動連携（施設利用者の入院・退院・入居・退去）
- スタッフによる手動入力（在宅の方など）
- Google スプレッドシートへのエクスポート機能あり

---

#### タブ5: 福祉用具選定

実際に選定・納品された福祉用具の詳細情報を管理します。

**レコード追加:** 「＋ 機器を追加」ボタン

**各福祉用具レコードの入力項目:**

**グループ1: 基本管理情報（3列グリッド）**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| 事業所選択 | ドロップダウン | 鹿児島 / 福岡 |
| 記録者 | テキスト | 担当者名 |
| 属性 | ドロップダウン | リース物件 / 自社物件 |

**グループ2: 内部管理・請求額（3列グリッド）**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 自社：商品区分 | テキスト | 自社物件の場合の分類 |
| 自社：商品ID | テキスト | 自社物件の場合のID |
| 請求金額 | 数値 | 月額レンタル料金または販売価格 |

**グループ3: 商品スペック（3列グリッド）**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| 商品コード（タイスコード） | テキスト | TAIS（福祉用具情報システム）コード |
| 福祉用具の種類 | ドロップダウン | 車いす / 車いす付属品 / 特殊寝台 / 特殊寝台付属品 / 床ずれ防止用具 / 体位変換器 / 歩行器 / 徘徊感知器 / 手すり / 歩行補助つえ / 移動用リフト / スロープ / その他（計13種類） |
| メーカー | ドロップダウン | パラマウントベッド / パナソニック / シーホネンス / モルテン / その他 |
| 卸会社 | ドロップダウン | 卸会社A / 卸会社B / その他 |
| 商品名 | テキスト | 具体的な製品名 |
| 単位数 | 数値 | 介護保険の単位数 |

**グループ4: ステータス・日付管理（グレー背景）**

**ステータス情報（2列）:**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| Status | ドロップダウン | 介護保険レンタル / 自費レンタル / 販売 |
| カイポケ登録 | ドロップダウン | 未登録 / 登録済 |

**日付情報（6列の日付ピッカー）:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 受注日 | 日付選択 | 注文を受けた日 |
| 発注日 | 日付選択 | 卸会社へ発注した日 |
| 購入日 | 日付選択 | 購入した日（自社物件の場合） |
| 納品日 | 日付選択 | 利用者へ納品した日 |
| 利用開始日 | 日付選択 | レンタル・使用開始日 |
| 利用終了日 | 日付選択 | レンタル・使用終了日 |

---

#### タブ6: 売上管理（自費・販売）

介護保険適用外の自費レンタルや販売商品の売上を記録します。

**レコード追加:** 「＋ 売上を追加」ボタン

**各売上レコードの入力項目:**

**基本情報セクション（3列グリッド）:**

| 項目名 | 入力形式 | 選択肢 |
|--------|----------|--------|
| Status | ドロップダウン | 介護保険レンタル / 自費レンタル / 販売 |
| あおぞらID | テキスト | 利用者ID（自動入力） |
| 氏名 | テキスト | 利用者名（自動入力） |
| 入居施設名 | テキスト | 施設名（自動入力） |

**商品情報:**

| 項目名 | 入力形式 | 説明 |
|--------|----------|------|
| 商品名（請求費目） | テキスト | 請求書に記載する商品名 |

**計算セクション（紫色背景、5列グリッド）:**

| 項目名 | 入力形式 | 選択肢 | 説明 |
|--------|----------|--------|------|
| 数量 | 数値 | - | 販売またはレンタル個数 |
| 単価 | 数値 | - | 1個あたりの価格（円） |
| 請求額（小計） | 表示のみ | - | 自動計算: 数量 × 単価 |
| 税区分 | ドロップダウン | 非課税 / 10％ / 軽8％ / 税込 | 適用する税率 |
| 税込み請求額 | 表示のみ（太字） | - | 自動計算: 小計 × 税率 |

**税計算ロジック:**
```
非課税:   小計 × 1.0
10％:     小計 × 1.1
軽8％:    小計 × 1.08
税込:     小計（税込み価格として扱う）
```

**表示形式:**
- 金額は3桁カンマ区切りで表示（例: 12,000円）
- 小数点以下は切り捨て（Math.floor）

**実装詳細:**

Statusの文言統一:
- **福祉用具選定タブ（タブ5）**: 介護保険レンタル / 自費レンタル / 販売
- **売上管理タブ（タブ6）**: 介護保険レンタル / 自費レンタル / 販売

types.tsの型定義:
```typescript
export type EquipmentStatus = '介護保険レンタル' | '自費レンタル' | '販売';
```

変更内容:
- `介護保険貸与` → `介護保険レンタル`
- `自費利用` → `自費レンタル`
- `販売` はそのまま

影響範囲:
1. types.ts: EquipmentStatus型の定義
2. ClientDetail.tsx: 福祉用具選定タブ（タブ5）のドロップダウン
3. ClientDetail.tsx: 売上管理タブ（タブ6）のドロップダウン
4. 既存データ: clients.json内の全てのequipmentとsalesRecordsのstatusフィールド

データ移行:
- 既存の`介護保険貸与` → `介護保険レンタル`に変換
- 既存の`自費利用` → `自費レンタル`に変換

---

### ユーザー操作フロー

```
1. アプリケーション起動
   ↓
2. ClientList（利用者一覧）表示
   ├─ 新規追加ボタン → 新しい利用者を作成
   └─ 利用者クリック → ClientDetail表示
   ↓
3. ClientDetail表示
   ├─ ヘッダー: 利用者名、ID、現在の状況
   ├─ 編集モードボタン → 編集状態ON/OFF
   └─ 6つのタブで情報管理
      ├─ タブ1: 基本情報・住所
      ├─ タブ2: 病歴・状態（AI提案機能）
      ├─ タブ3: 議事録一覧（AI生成機能）
      ├─ タブ4: 利用者新規・変更情報入力
      ├─ タブ5: 福祉用具選定
      └─ タブ6: 売上管理（自費・販売）
   ↓
4. 保存またはキャンセル
   ├─ 保存 → 変更を反映
   └─ キャンセル → 変更を破棄
```

---

## 🛠️ 技術スタック

### フロントエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **React** | 19.2.1 | UIフレームワーク |
| **React DOM** | 19.2.1 | DOM操作 |
| **TypeScript** | 5.8.2 | 型安全な開発 |
| **TailwindCSS** | Latest (CDN) | UIスタイリング |
| **Vite** | 6.2.0 | ビルドツール |

### 認証・セキュリティ

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Firebase Authentication** | Latest | ユーザー認証基盤 |
| **Google Sign-In** | Latest | Google Workspaceログイン |
| **Firebase SDK** | Latest | Firebase JavaScript SDK |

### AI統合

| 技術 | バージョン | 用途 |
|------|-----------|------|
| **Vertex AI** | Latest | Google Cloud Vertex AI |
| **@google-cloud/vertexai** | Latest | Vertex AI SDK for Node.js |
| **Gemini Model** | 2.5 Flash | 議事録生成・用具提案 |
| **認証方式** | Workload Identity | Application Default Credentials |

### 開発ツール

- **@vitejs/plugin-react**: React用Viteプラグイン
- **@types/node**: Node.js型定義

---

## 📁 プロジェクト構造

```
welfare-assist-pro/
├── components/
│   ├── ClientList.tsx           # 利用者一覧コンポーネント
│   └── ClientDetail.tsx         # 利用者詳細コンポーネント（1479行）
│       ├── 6つのタブ管理
│       ├── 基本情報・住所
│       ├── 病歴・AI提案
│       ├── 議事録一覧・AI生成
│       ├── 利用者変更情報
│       ├── 福祉用具選定
│       └── 売上管理
├── services/
│   └── geminiService.ts         # Gemini AI統合サービス
│       ├── generateMeetingSummary()
│       └── suggestEquipment()
├── App.tsx                      # メインアプリケーション
├── index.tsx                    # エントリーポイント
├── index.html                   # HTMLテンプレート
├── types.ts                     # TypeScript型定義（70種類以上）
├── vite.config.ts               # Viteビルド設定
├── tsconfig.json                # TypeScript設定
├── package.json                 # npm依存関係
├── metadata.json                # プロジェクトメタデータ
└── README.md                    # このファイル
```

### ファイル統計

- **プロジェクト総サイズ**: 248KB
- **主要コンポーネント数**: 3個
- **TypeScript型定義**: 70種類以上
- **総コード行数**: 約3,500行

---

## 🚀 セットアップ手順

### 前提条件

- **Node.js**: 最新のLTS版を推奨
- **npm**: Node.jsに同梱
- **Google Cloud SDK**: [インストールガイド](https://cloud.google.com/sdk/docs/install)
- **GCPプロジェクト**: `welfare-assist-pro`（作成済み）

### インストール

1. **リポジトリのクローン**

```bash
git clone <repository-url>
cd welfare-assist-pro
```

2. **依存関係のインストール**

```bash
npm install
```

3. **GCP認証設定**

Application Default Credentialsを設定：

```bash
gcloud auth application-default login
```

ブラウザが開くので、アカウントで認証してください。

4. **環境変数の設定**

プロジェクトルートに `.env.local` ファイルが作成済みです：

```env
# Google Cloud Platform設定
GCP_PROJECT_ID=welfare-assist-pro
GCP_LOCATION=asia-northeast1
```

5. **開発サーバーの起動**

```bash
npm run dev
```

ブラウザで `http://localhost:3000` にアクセスしてください。

### Firebase Authenticationのセットアップ

**1. Firebase Consoleで認証を有効化**

1. Firebase Consoleにアクセス: https://console.firebase.google.com/project/welfare-assist-pro
2. 左メニューから「Authentication」を選択
3. 「始める」をクリック
4. 「Sign-in method」タブを開く
5. 「Google」プロバイダーを選択
6. 「有効にする」をONにする
7. プロジェクトのサポートメール: `yoriko.kikunaga@aozora-cg.com`
8. 「保存」をクリック

**2. Firebase設定ファイルの作成**

Firebase Consoleからプロジェクト設定を取得し、`src/firebaseConfig.ts`を作成します。

```typescript
// src/firebaseConfig.ts
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "welfare-assist-pro.firebaseapp.com",
  projectId: "welfare-assist-pro",
  storageBucket: "welfare-assist-pro.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

**3. 認証されたドメインの設定**

Firebase Console > Authentication > Settings > 承認済みドメインに以下を追加:
- `localhost`（開発環境）
- `welfare-assist-pro.web.app`（本番環境）

### 詳細なセットアップ手順

Vertex AI + Workload Identityの詳細設定については、以下のドキュメントを参照してください：

- **[GCPセットアップガイド](./docs/GCP_SETUP.md)**: GCPプロジェクト作成、課金設定、API有効化
- **[Vertex AIセットアップガイド](./docs/VERTEX_AI_SETUP.md)**: Vertex AI設定、Workload Identity認証

### データ自動同期のセットアップ

スプレッドシートからの自動データ同期については、以下のドキュメントを参照してください：

- **[GitHub Actions自動同期セットアップ](./GITHUB_ACTIONS_SETUP.md)**: GitHub Actionsによる1時間ごとの自動同期設定
- **[スプレッドシート同期セットアップ](./SYNC_SETUP.md)**: Cloud Buildによる手動同期実行方法

**自動同期の機能:**

**スプレッドシート自動同期（1時間ごと）:**
- スプレッドシートから利用者データを取得（8,402件）
- 福祉用具利用者の自動識別（435件）
- 生保受給者の支払い区分自動設定（184件）
- 利用初回日の変更履歴への自動登録（358件）
- 1時間ごとに自動実行（GitHub Actions）

**kintone自動同期（毎日24時）:**
- kintoneアプリ184から入院・退院情報を取得
- kintoneアプリ197から入居・退去情報を取得
- 対象期間: 2025年11月以降のデータのみ
- 変更レコード（changeRecords）を自動更新
- 毎日24:00（JST）に自動実行（GitHub Actions）

**利用者変更情報エクスポート（手動実行）:**
- 福祉用具利用者の変更情報（changeRecords）をスプレッドシートにエクスポート
- 対象: 福祉用具利用者のみ（isWelfareEquipmentUser = true）
- エクスポート件数: 1,289件（福祉用具利用者 457件、2025年12月時点）
- エクスポート列（12列）:
  - 入力日、あおぞらID、利用者名、施設名、情報種別
  - 請求開始日（新規）、請求停止日（入院）、請求開始日（退院）、請求停止日（解約）
  - データ連携日、記録者、事業所
- データ連携日の昇順でソート（古い順）
- 実行コマンド: `node exportChangeRecordsToSheets.cjs`
- エクスポート先: [利用者変更情報スプレッドシート](https://docs.google.com/spreadsheets/d/1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU/edit)

**重要な修正内容:**
- Kintone importスクリプトに `.trim()` を追加し、あおぞらIDの先頭スペースを除去
- 2025年12月入居者22名を福祉用具利用者として登録（福祉用具利用者総数: 435件 → 457件）
- これにより2025年12月の変更レコードが2件 → 24件に増加

---

## 📝 開発ガイド

### 利用可能なコマンド

```bash
# 開発サーバー起動（ポート3000）
npm run dev

# 本番ビルド
npm run build

# ビルド結果のプレビュー
npm run preview

# データインポート（Googleスプレッドシートから）
node importSpreadsheetData.cjs
```

### データインポートと復元

**重要**: clients.jsonは.gitignoreされているため、Gitにコミットされません。以下の手順でデータをインポートします。

**1. 自動インポート（1時間ごと）**

Cloud Schedulerにより自動実行される統合データインポート:

```bash
node importSpreadsheetData.cjs
```

**自動同期されるデータ（完全統合版）:**
- 利用者基本情報（氏名、カナ、生年月日、性別、利用者区分）
- 施設情報（施設名、部屋番号、グループホーム判定）
- **要介護度**（497件）- 被保険者証情報スプレッドシートから自動取得
- **負担割合**（26件）- 給付率から自動変換
- **担当ケアマネージャー**（496件）- 被保険者証情報スプレッドシートから自動取得
- **居宅介護支援事業所**（358件）- 福祉用具利用者スプレッドシートから自動取得
- **生保受給**（184件）- 福祉用具利用者スプレッドシートから自動取得
- **福祉用具利用者フラグ**（435件）- 福祉用具利用者スプレッドシートから自動識別
- **性別補正**（2,202件）- 女性名パターンマッチングによる自動補正
- **自費レンタル福祉用具データ**（119件）- 福祉用具利用者スプレッドシートから自動取得
- **売上レコード**（119件）- 自費レンタル福祉用具から自動作成

**データソース:**
- **メインスプレッドシート** (ID: 1DhwY6F1LaveixKXtie80fn7FWBYYqsGsY3ADU37CIAA)
  - 「利用者」シート (A:H) - 基本情報
  - 「施設利用者」シート (A:H) - 施設情報
- **被保険者証情報スプレッドシート** (ID: 11WYWyOy5FK2LSCPvK9iFQEh2rQ0501Fn6krD__3ZndU)
  - 要介護度、負担割合、担当ケアマネージャー
- **福祉用具利用者スプレッドシート** (ID: 1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs)
  - 「シート1」(B:V) - 福祉用具利用者の詳細情報

**取得される利用者データの総件数:** 約8,400件

**重要**: 以前は`importAdditionalData.cjs`、`importWelfareData.cjs`、`importSelfPayRental.cjs`、`createSalesFromEquipment.cjs`を別途実行する必要がありましたが、これらのロジックは全て`importSpreadsheetData.cjs`に完全統合されました。そのため、`importSpreadsheetData.cjs`を実行するだけで全てのデータが正しく取得されます。

**2. その他のデータ変換・エクスポート**

**インポート機能の詳細:**

importSpreadsheetData.cjs（統合版 + 既存データ保持）:
- **既存データ保持機能**（2025-12-24追加）:
  - 既存のclients.jsonを読み込み、changeRecords、meetings、plannedEquipmentを保持
  - スプレッドシート更新時にKintoneから取得した変更レコードが失われなくなりました
- 被保険者証情報スプレッドシートとの自動マッチング（名前+カナ）
- 給付率→負担割合の自動変換（90%→1割、80%→2割、70%→3割）
- 要介護度の全角→半角正規化
- 女性名パターンマッチングによる性別自動補正
- 福祉用具利用者スプレッドシートからの居宅介護支援事業所取得
- 生保受給者の自動判定
- 自費レンタル福祉用具データの自動取得（selectedEquipmentに追加）
  - A列が「自費レンタル」のデータを抽出
  - 商品名、単価、数量、税区分、税込金額を取得
  - Equipment型に変換してselectedEquipmentに設定
- 売上レコードの自動作成（salesRecordsに追加）
  - selectedEquipmentに追加された自費レンタル福祉用具から自動作成
  - SalesRecord型に変換してsalesRecordsに設定
  - 利用者情報（あおぞらID、利用者名、施設名）を自動設定

**推奨実行順序:**
```bash
# 1. スプレッドシートからデータをインポート（既存のchangeRecordsを保持）
node importSpreadsheetData.cjs

# 2. Kintoneから変更レコードをインポート（施設利用者のみ）
node importFromKintone.cjs

# 3. clients.jsonをpublicフォルダにコピー（本番デプロイ用）
cp clients.json public/clients.json

# 4. アプリケーションをビルド・デプロイ
npm run build
firebase deploy --only hosting
```

**重要**: データ更新後は必ずステップ3を実行してください。publicフォルダのclients.jsonが古いままだと、デプロイ後のアプリに新しいデータが反映されません。

**3. 売上レコードをCSVファイルにエクスポート**

売上管理タブのデータをCSVファイルに出力します。

```bash
node exportSalesToCSV.cjs
```

**出力ファイル:**
- ファイル名: `自費レンタル売上_YYYY-MM-DD.csv`
- エンコーディング: UTF-8 with BOM（Excelで正しく開ける）

**出力される列:**
- A列: 事業所
- B列: Status
- C列: あおぞらID
- D列: 利用者名
- E列: 施設名
- F列: 商品名（請求費目）
- G列: 数量
- H列: 単価
- I列: 税区分
- J列: 税込み請求額

**Google Spreadsheetsにインポート:**
1. Google Spreadsheetsを開く
2. ファイル > インポート > アップロード を選択
3. CSVファイルをアップロード
4. インポート場所: 新しいスプレッドシートを作成
5. 区切り文字の種類: カンマ を選択
6. データをインポート

**売上サマリー（自費レンタル119件の例）:**
- 総売上額（税抜）: 272,947円
- 事業所別集計、税区分別集計が表示されます

### kintone連携

**5. kintoneから日付情報を取得してアプリに連携**

kintoneアプリから入院・退院・入居・退去の日付情報を取得し、利用者新規・変更情報入力タブ（タブ4）の変更レコードに自動入力します。

```bash
node importFromKintone.cjs
```

**前提条件:**
- kintoneの契約があること
- APIトークンが発行されていること
- @kintone/rest-api-client がインストールされていること（`npm install`で自動インストール）

**連携するkintoneアプリ:**

**アプリID 184（入院・退院情報）:**
- フィールド「開始日」→ changeRecords の「入院（請求停止日）」(`billingStopDateHospital`)
- フィールド「終了日」→ changeRecords の「退院（請求開始日）」(`billingStartDateDischarge`)

**アプリID 197（入居・退去情報）:**
- フィールド「入居日」→ changeRecords の「新規（請求開始日）」(`billingStartDateNew`)
- フィールド「退去日」→ changeRecords の「解約（請求停止日）」(`billingStopDateCancel`)

**マッチングキー:**
- kintoneのレコードとclients.jsonの利用者は「あおぞらID」でマッチング

**必要な環境変数:**

`.env` ファイルを作成して以下の情報を設定：

```
KINTONE_SUBDOMAIN=acgaozora
KINTONE_API_TOKEN_184=your_api_token_for_app_184
KINTONE_API_TOKEN_197=your_api_token_for_app_197
```

**APIトークンの取得方法:**
1. kintoneアプリを開く
2. 設定 > アプリの設定 > API トークン
3. 「生成する」をクリック
4. 「レコード閲覧」権限を付与
5. トークンをコピーして`.env`に貼り付け
6. 「保存」→「アプリを更新」

**実行結果例:**
```
✓ アプリID 184から入院・退院情報を取得: 515件
✓ アプリID 197から入居・退去情報を取得: 859件
✓ 変更レコードを更新: 1,362件
```

**定時自動更新:**

kintoneからのデータ取得は、GitHub Actionsにより毎日24時（日本時間）に自動実行されます。

- **実行スケジュール**: 毎日24:00（JST）
- **処理内容**:
  1. kintoneアプリ184から入院・退院情報を取得
  2. kintoneアプリ197から入居・退去情報を取得
  3. clients.jsonの変更レコードを更新
  4. アプリケーションをビルド
  5. Firebase Hostingに自動デプロイ

- **手動実行**: GitHub Actionsの画面から手動で実行することも可能

**GitHub Secretsの設定:**

定時自動更新を有効にするには、GitHubリポジトリにkintone APIトークンを登録する必要があります。

1. **GitHubリポジトリの設定ページを開く**
   - リポジトリページの上部タブから「**Settings**」をクリック

2. **Secretsページに移動**
   - 左サイドバーから「**Secrets and variables**」→「**Actions**」をクリック

3. **1つ目のSecretを作成（アプリID 184）**
   - 「**New repository secret**」ボタンをクリック
   - Name: `KINTONE_API_TOKEN_184`
   - Secret: アプリID 184のAPIトークンを貼り付け
   - 「**Add secret**」をクリック

4. **2つ目のSecretを作成（アプリID 197）**
   - 「**New repository secret**」ボタンをクリック
   - Name: `KINTONE_API_TOKEN_197`
   - Secret: アプリID 197のAPIトークンを貼り付け
   - 「**Add secret**」をクリック

5. **workflowファイルをGitHubにプッシュ**
   ```bash
   git add .github/workflows/daily-kintone-sync.yml
   git add README.md
   git commit -m "feat: Add daily kintone sync workflow"
   git push origin main
   ```

6. **手動実行でテスト**
   - リポジトリページ > Actions > Daily Kintone Sync
   - 「Run workflow」ボタンをクリック
   - 実行が成功することを確認

**実行履歴の確認:**

GitHub Actionsの実行履歴は以下で確認できます：
- リポジトリページ > Actions > Daily Kintone Sync

**トラブルシューティング:**

定時更新が失敗する場合、以下を確認してください：
1. GitHubのSecretsに`KINTONE_API_TOKEN_184`と`KINTONE_API_TOKEN_197`が設定されているか
2. APIトークンが有効期限内か
3. kintoneアプリの「レコード閲覧」権限が付与されているか

### 開発環境

- **推奨IDE**: Visual Studio Code
- **推奨拡張機能**:
  - ESLint
  - Prettier
  - TypeScript Vue Plugin (Volar)

### コードスタイル

- **言語**: TypeScript（strict mode）
- **スタイリング**: TailwindCSS
- **フォント**: Noto Sans JP（ウェイト: 300, 400, 500, 700）
- **モジュール形式**: ESNext
- **ターゲット**: ES2022

---

## 🗂️ データモデル

### 主要インターフェース

#### Client（利用者）

```typescript
interface Client {
  id: string
  aozoraId: string              // あおぞら管理ID
  name: string                  // 氏名
  nameKana: string              // フリガナ
  birthDate: string             // 生年月日
  gender: Gender                // '男性' | '女性'
  facilityName: string          // 入居施設
  roomNumber: string            // 部屋番号
  careLevel: CareLevel          // 要支援1～要介護5
  copayRate: CopayRate          // 1割～3割
  currentStatus: CurrentStatus  // '在宅' | '入院中' | '施設入居中'
  paymentType: PaymentType      // '非生保' | '生保'
  address: string               // 住所
  medicalHistory: string        // 病歴・身体状況（AI分析対象）
  keyPerson: KeyPerson          // 緊急連絡先
  meetings: MeetingRecord[]     // 議事録
  changeRecords: ClientChangeRecord[]  // 変更情報
  plannedEquipment: Equipment[] // 選定予定用具
  selectedEquipment: Equipment[] // 選定済み用具
  salesRecords: SalesRecord[]   // 売上記録
}
```

#### MeetingRecord（議事録）

```typescript
interface MeetingRecord {
  id: string
  date: string                  // 会議日
  type: MeetingType             // 会議種別（5種類）
  office: OfficeLocation        // '鹿児島' | '福岡'
  recorder: string              // 記録者
  place: string                 // 実施場所
  attendees: string             // 参加者
  careSupportOffice: string     // 居宅支援事業所
  careManager: string           // ケアマネージャー名
  hospital: string              // 病院名
  socialWorker: string          // ソーシャルワーカー名
  usageCategory: UsageCategory  // 介護保険 or 自費
  carePlanStatus: ConfirmationStatus      // ケアプラン確認状態
  serviceTicketStatus: ConfirmationStatus // サービス票確認状態
  content: string               // メモ（AI生成の入力）
  reminder: ReminderStatus      // リマインダー
  summary?: string              // AI生成サマリー
}
```

#### Equipment（福祉用具）

```typescript
interface Equipment {
  id: string
  name: string                  // 用具名
  category: EquipmentType       // 13種類のカテゴリ
  office: OfficeLocation        // 担当営業所
  recorder: string              // 記録者
  propertyAttribute: PropertyAttribute  // リース or 自社
  ownProductCategory: string    // 自社商品カテゴリ
  ownProductId: string          // 自社商品ID
  taisCode: string              // タイスコード
  manufacturer: string          // メーカー名
  wholesaler: string            // 卸会社名
  units: string                 // 単位数
  kaipokeStatus: RegistrationState  // 介舟帆登録状態
  status: EquipmentStatus       // 介護保険 or 自費 or 販売

  // 日付管理
  orderReceivedDate: string     // 受注日
  orderPlacedDate: string       // 発注日
  purchaseDate: string          // 購入日
  deliveryDate: string          // 納品日
  startDate: string             // 開始日
  endDate: string               // 終了日

  monthlyCost?: number          // 月額費用
}
```

#### SalesRecord（売上記録）

```typescript
interface SalesRecord {
  id: string
  status: SalesStatus           // '自費レンタル' | '販売'
  aozoraId: string              // あおぞらID
  clientName: string            // 利用者名
  facilityName: string          // 施設名
  productName: string           // 商品名
  quantity: number              // 数量
  unitPrice: number             // 単価
  taxType: TaxType              // 税種別（非課税、10%、軽8%、税込）
}
```

### 主要な列挙型

```typescript
// 要介護度
CareLevel = '申請中' | '要支援1' | '要支援2' | '要介護1' | '要介護2'
          | '要介護3' | '要介護4' | '要介護5'

// 会議タイプ
MeetingType = 'カンファレンス時' | '担当者会議（新規）' | '担当者会議（更新）'
            | '担当者会議（退院時）' | 'その他'

// 福祉用具タイプ（13種類）
EquipmentType = '車いす' | '車いす付属品' | '特殊寝台' | '特殊寝台付属品'
              | '床ずれ防止用具' | '体位変換器' | '手すり' | 'スロープ'
              | '歩行器' | '歩行補助杖' | '認知症老人徘徊感知機器'
              | '移動用リフト' | '自動排泄処理装置' | 'その他'

// 税種別
TaxType = '非課税' | '10％' | '軽8％' | '税込'
```

---

## 🤖 AI統合機能

### Vertex AI統合

このアプリは **Vertex AI（Google Gemini 2.5 Flash）** を使用しています。

**認証方式**: Workload Identity（Application Default Credentials）

#### 1. 議事録自動生成

**関数**: `generateMeetingSummary()`

**入力**:
- `notes`: 粗いメモ
- `type`: 会議タイプ
- `clientName`: 利用者名

**出力**: フォーマット済み議事録

```
【日時・場所】
【出席者】
【検討内容】
【決定事項】
【次回アクション】
```

**使用例**:
```typescript
import { VertexAI } from '@google-cloud/vertexai';

// Vertex AI初期化
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID,
  location: process.env.GCP_LOCATION
});

const model = vertexAI.getGenerativeModel({
  model: 'gemini-2.5-flash'
});

// 議事録生成
const result = await model.generateContent(prompt);
const summary = result.response.text();
```

#### 2. 福祉用具AI提案

**関数**: `suggestEquipment()`

**入力**: 利用者情報（Client型）
- 名前
- 要介護度
- 病歴・身体状況
- 入居施設

**出力**: 3つの福祉用具提案 + 理由説明

**使用例**:
```typescript
// 同じVertexAI インスタンスを使用
const result = await model.generateContent(equipmentPrompt);
const suggestions = result.response.text();
// 出力: 「要介護3で歩行困難な利用者には...」
```

### 認証とセキュリティ

- **ローカル開発**: Application Default Credentials（ADC）を使用
- **本番環境**: Workload Identity（サービスアカウント自動認証）
- **セキュリティ**: APIキー不要、IAM権限で細かく制御
- **監査**: すべてのAPI呼び出しがCloud Auditログに記録

### エラーハンドリング

- ADC未設定時: 認証エラーを返す
- API呼び出しエラー時: "エラーが発生しました。もう一度お試しください。"
- 権限不足時: IAMポリシーを確認

---

## 🎨 UI/UX設計

### デザインシステム

#### カラーパレット

```css
/* Primary（青系） */
--blue-50: #f0f9ff
--blue-500: #0ea5e9
--blue-600: #0284c7
--blue-700: #0369a1

/* Accent（ティール） */
--teal-500: #14b8a6

/* ステータス色 */
--success: #10b981    /* 緑 */
--warning: #eab308    /* 黄 */
--error: #ef4444      /* 赤 */
--ai-result: #a855f7  /* 紫（AI分析結果） */
```

#### アニメーション

```css
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in-up {
  animation: fadeInUp 0.3s ease-out forwards;
}
```

### レスポンシブデザイン

#### モバイル（< 768px）
- サイドバー非表示
- フルスクリーンコンテンツ
- 戻るボタン表示
- 単一カラムレイアウト

#### タブレット/デスクトップ（≥ 768px）
- 2カラムレイアウト
- サイドバー固定（幅80rem）
- メインコンテンツ側スクロール
- グリッドレイアウト活用

#### Tailwind Breakpoints

```css
/* モバイル優先 */
width: 100%

/* タブレット以上 */
md:w-80          /* 768px以上 */
md:col-span-2    /* 768px以上で2列 */
lg:grid-cols-3   /* 1024px以上で3列 */
```

### UI要素

- **スクロールバー**: カスタマイズ（幅8px、角丸、グレー）
- **ボタン**: 影付き、ホバーエフェクト、アクティブ状態
- **フォーム**: ボーダー、フォーカスリング、無効状態の灰色化
- **カード**: 角丸（rounded-xl）、影（shadow-sm）、ボーダー
- **タブ**: 下線インジケータ、スムーズ遷移
- **バッジ**: 要介護度、ステータス表示用

---

## 🔧 アーキテクチャ

### アプリケーション構造

```
App.tsx (State管理)
  ↓
ClientList.tsx (一覧)
  ↓ 選択
ClientDetail.tsx (詳細)
  ├─ 6つのタブ
  ├─ 編集モード切替
  └─ AI統合機能
```

### データフロー

```
ユーザー操作
  ↓
React State更新 (useState)
  ↓
コンポーネント再レンダリング
  ↓
UI更新
```

### 外部API統合

```
ClientDetail
  ↓
geminiService.ts
  ↓
Google Gemini API
  ↓
AI生成結果
  ↓
UIに表示
```

### ビルド設定

**Vite設定** (`vite.config.ts`):
```typescript
{
  server: {
    port: 3000,
    host: '0.0.0.0'  // すべてのインターフェースにバインド
  },
  plugins: [react()],
  define: {
    'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
}
```

**TypeScript設定** (`tsconfig.json`):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

---

## 🚧 現在の制限事項

### データ永続化

- **状態管理**: クライアント側のみ（React State）
- **永続化**: なし（ブラウザリロード時に初期データに戻る）
- **データベース**: 未実装

### 認証

- ユーザー認証機能なし
- ログイン機能なし
- 権限管理なし

### スケーラビリティ

- 単一ブラウザセッションのみ
- 複数ユーザー同時利用不可
- データ共有機能なし

---

## 🛣️ 今後の拡張計画

### フェーズ0: データ統合（実装済み）

- [x] Google スプレッドシート連携
- [x] 自動データ同期（1時間ごと）
- [x] 福祉用具利用者の自動識別
- [x] 生保受給者の自動判定
- [x] 利用初回日の自動登録
- [x] 居宅介護支援事業所の自動登録
- [x] 議事録への自動反映
- [x] GitHub Actions CI/CD
- [x] Firebase Hosting デプロイ
- [x] **Firestoreデータ永続化システム（2025-12-25実装）**
  - ユーザー編集データ（meetings, changeRecords, equipment等）をFirestoreに自動保存
  - スプレッドシート/KintoneデータとFirestoreデータの自動マージ
  - データリセット問題の完全解決
  - セキュリティルール設定（認証済みユーザーのみアクセス可能）
- [x] **福祉用具マスターデータ連携（2025-12-25実装）**
  - Google スプレッドシートから928件の福祉用具マスターデータを取得
  - 商品コード、福祉用具の種類、メーカー、商品名、単位数のプルダウンリスト
  - 商品名選択時の自動入力機能（他のフィールドを自動補完）
  - 卸会社プルダウンリスト（ニッケン、日本ケアサプライ、ニシケン、パラケア、野口、キシヤ）
  - **カスケードフィルタリング機能**
    - 福祉用具の種類選択 → その品目に準じたメーカーのみを表示
    - メーカー選択 → 選択した品目とメーカーの組み合わせの商品名のみを表示
    - 商品名選択 → 商品コード、単位数を自動入力
  - **検索機能**: 全てのドロップダウンに検索ウィンドウ（datalist）を実装

### フェーズ1: データ永続化

- [ ] バックエンドAPI開発（Node.js + Express）
- [ ] データベース統合（PostgreSQL推奨）
- [ ] REST APIエンドポイント設計
- [ ] データマイグレーション機能

### フェーズ2: ユーザー管理

- [ ] 認証機能（ログイン/ログアウト）
- [ ] ユーザー登録機能
- [ ] 権限管理（管理者/一般ユーザー）
- [ ] セッション管理

### フェーズ3: 機能拡張

- [x] 検索機能（氏名・カナ・ID）
- [x] フィルタリング機能（福祉用具利用者）
- [ ] レポート生成機能（PDF/Excelエクスポート）
- [ ] 複数ユーザー同時編集対応
- [ ] リアルタイム通知機能（WebSocket）

### フェーズ4: モバイル対応

- [ ] オフライン対応（IndexedDB + Service Worker）
- [ ] PWA化（Progressive Web App）
- [ ] React Nativeアプリ開発

### フェーズ5: 分析・最適化

- [ ] 利用統計ダッシュボード
- [ ] AI提案精度の向上
- [ ] パフォーマンス最適化
- [ ] アクセシビリティ改善（WCAG準拠）

---

## 📊 パフォーマンス

### 現状

- **初回ロード時間**: < 2秒（CDN利用）
- **バンドルサイズ**: 未測定（開発初期段階）
- **Lighthouse スコア**: 未測定

### 最適化済み

- ✅ 画像なし（SVGアイコンのみ）
- ✅ CDN経由ライブラリロード
- ✅ TailwindCSS JIT（必要なクラスのみ生成）
- ✅ React 19（最新最適化）

---

## 🤝 コントリビューション

現在、このプロジェクトは開発初期段階のため、コントリビューションガイドラインは未整備です。

---

## 📄 ライセンス

TBD（未定）

---

## 👥 開発者

- **yoriko-kikunaga** - [yoriko.kikunaga@aozora-cg.com](mailto:yoriko.kikunaga@aozora-cg.com)

---

## 📞 サポート

質問や問題がある場合は、GitHubのIssuesセクションでお知らせください。

---

## 🔗 関連リンク

### プロジェクトドキュメント

- **[GCPセットアップガイド](./docs/GCP_SETUP.md)**: GCPプロジェクト作成、課金設定、API有効化
- **[Vertex AIセットアップガイド](./docs/VERTEX_AI_SETUP.md)**: Vertex AI設定、Workload Identity認証

### 外部リンク

- [Google Cloud Console](https://console.cloud.google.com/)
- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs)
- [Workload Identity](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity)
- [React Documentation](https://react.dev/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Vite Documentation](https://vitejs.dev/)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)

---

<div align="center">
Made with ❤️ by the WelfareAssist Pro Team
</div>
