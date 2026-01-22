# 売上・仕入突合システム改修記録

**日付**: 2025-01-22

## 概要

「介保レンタル売上・請求突合」を「**売上・仕入突合**」に改名し、全売上タイプ（介護保険レンタル・自費レンタル・販売）と卸会社請求書の突合、粗利計算までできるシステムに改修。

## 変更点

### 1. 対象売上の拡大

| Before | After |
|--------|-------|
| 介護保険レンタルのみ | 介護保険レンタル + 自費レンタル + 販売 |

### 2. 粗利計算機能の追加

- 売上金額 - 仕入金額 = 粗利
- 粗利率の自動計算
- 卸会社別の粗利集計

### 3. UI改修

**3タブ構成**:
1. **売上一覧** - 月度の全売上を表示
2. **請求書アップロード** - 卸会社PDFをOCR処理
3. **突合結果** - 突合済み/売上のみ/仕入のみの3分類

**サマリー表示**:
- 売上合計、仕入合計、粗利、粗利率
- 卸会社別集計

### 4. 事業所フィルター

全事業所 / 鹿児島（ACG） / 福岡（Lichi）で絞り込み可能。

## 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `types.ts` | SalesItem, ReconciliationResultV2等の型定義追加 |
| `services/reconciliationService.ts` | aggregateAllSales(), reconcileSalesWithInvoicesV2()追加 |
| `components/ReconciliationPage.tsx` | UI全面改修 |

## バグ修正

### 日付計算のタイムゾーン問題

**問題**: `toISOString()`がUTC変換するため、日本時間で1日ズレが発生

**修正前**:
```typescript
const monthStart = new Date(year, month - 1, 1);
const monthStartStr = monthStart.toISOString().split('T')[0]; // UTC変換でズレる
```

**修正後**:
```typescript
const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`; // 文字列で直接生成
```

### レンタル用具のフィルター条件

**問題**: `startDate`が未設定の介護保険レンタルが表示されない

**修正**: `startDate`がない場合は「現在利用中」として扱う

---

# サービスチェックシートインポート改修

## 問題

スプレッドシートとclients.jsonで漢字の異体字が異なり、自動マッチングできない利用者が存在。

| スプレッドシート | clients.json | 差異 |
|---------------|-------------|------|
| 面高 ソヨ子 | 面髙 ソヨ子 | 高→髙 |
| 面高 正則 | 面髙 正則 | 高→髙 |
| 山澤 富士雄 | 山澤 冨士雄 | 富→冨 |

## 解決策

### 1. 手動マッチング設定ファイル

`manualMatchConfig.json`:
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

### 2. インポートスクリプト改修

`importServiceCheckSheet.cjs`:
- 手動マッチング設定を最初に読み込み
- クリーンインポート（既存の介護保険レンタルを全削除してから追加）
- 重複マッチ防止（Set で追跡）
- マッチしなかった利用者を警告表示

### 3. 処理順序

1. 手動マッチング（`manualMatchConfig.json`から）
2. 被保険者番号で自動マッチング
3. 名前・フリガナで自動マッチング
4. 未マッチ者を警告表示

## 結果

- マッチング成功: 360人（手動: 3, 自動: 357）
- 介護保険レンタル: 1,418件（スプレッドシートと完全一致）

## 定時更新との整合性

**日次同期 (`importSpreadsheetData.cjs`)**:
- 介護保険レンタルは**保持**（上書きしない）
- Line 431, 459: `existingInsuranceRentalEquipmentMap`から読み込んで結合

**月次同期 (`importServiceCheckSheet.cjs`)**:
- 介護保険レンタルを全削除→新規追加（クリーンインポート）
- 手動マッチング設定を使用

## 今後の運用

1. 毎月1日にサービスチェックシートをスプレッドシートにアップロード
2. GitHub Actionsが自動実行、またはローカルで手動実行
3. マッチしない利用者が出たら`manualMatchConfig.json`に追記
4. 再実行で全件マッチング
