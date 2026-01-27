# TODO - 次やることリスト

## 請求書OCR関連

### 動作確認（優先）
- [ ] 野口株式会社のPDFでOCR精度を確認
- [ ] 株式会社ニシケンのPDFでOCR精度を確認
- [ ] 日本ケアサプライのPDFでOCR精度を確認
- [ ] パラマウントケアサービスのPDFでOCR精度を確認

### 未対応・調整が必要
- [ ] 株式会社キシヤ - 請求書入手後にフォーマット確認・プロンプト調整

### 精度改善（必要に応じて）
- [ ] OCR結果が不正確な場合、`functions/src/index.ts`の`getCompanySpecificPrompt()`を調整
- [ ] 新しい卸会社追加時は同関数にプロンプトを追加

## その他

### 定時更新への影響
- Cloud Functions（`functions/src/index.ts`）はGitHubで管理
- 定時更新（daily-sync.yml）は`clients.json`のみ更新するため、OCRプロンプトへの影響なし
- デプロイ済みのCloud Functionsは手動で再デプロイしない限り変更されない

---
最終更新: 2026-01-27
