# GitHub Actions 自動同期セットアップガイド

このガイドでは、GitHub Actionsを使って1時間ごとにスプレッドシートのデータを自動的に取り込み、WelfareAssist Proアプリケーションを更新する方法を説明します。

---

## 📋 前提条件

- ✅ GitHubアカウント
- ✅ GitHubリポジトリ: `yoriko-kikunaga/welfare-assist-pro`
- ✅ GCPサービスアカウントキー（既に作成済み: `service-account-key.json`）

---

## 🚀 セットアップ手順

### ステップ1: GitHubリポジトリにアクセス

1. ブラウザで以下のURLを開く:
   ```
   https://github.com/yoriko-kikunaga/welfare-assist-pro
   ```

2. GitHubにログインする

---

### ステップ2: GitHub Secretsを設定

GitHub Secretsに、GCPサービスアカウントキーを安全に保存します。

1. **リポジトリの設定ページを開く:**
   - リポジトリページの上部タブから「**Settings**」をクリック

2. **Secretsページに移動:**
   - 左サイドバーから「**Secrets and variables**」→「**Actions**」をクリック

3. **新しいSecretを作成:**
   - 「**New repository secret**」ボタンをクリック

4. **Secretを入力:**
   - **Name（名前）:**
     ```
     GCP_SA_KEY
     ```

   - **Secret（値）:**

     以下のコマンドをローカルPCで実行し、出力される内容をコピー:
     ```bash
     cat C:\Users\acgpa\welfare-assist-pro\service-account-key.json
     ```

     または、エディタで `service-account-key.json` を開き、全内容をコピー

     **重要:** JSON全体（`{` から `}` まで）をコピーしてください

5. **保存:**
   - 「**Add secret**」ボタンをクリック

---

### ステップ3: ワークフローファイルをGitHubにプッシュ

#### 3-1: GitHubで個人アクセストークンを作成

1. **GitHub設定ページを開く:**
   - 右上のプロフィールアイコン → 「**Settings**」

2. **Developer settingsに移動:**
   - 左サイドバーの一番下「**Developer settings**」

3. **Personal access tokensページ:**
   - 「**Personal access tokens**」→「**Tokens (classic)**」

4. **新しいトークンを生成:**
   - 「**Generate new token**」→「**Generate new token (classic)**」
   - Note: `WelfareAssist Pro Deploy`
   - Expiration: `No expiration`（または適切な期限）
   - Scopes: ✅ `repo`（すべてのチェックボックス）
   - 「**Generate token**」をクリック

5. **トークンをコピー:**
   - 表示されたトークンをコピーして安全な場所に保存

#### 3-2: ローカルでGitの設定

Windowsのコマンドプロンプトまたはターミナルで実行:

```cmd
cd C:\Users\acgpa\welfare-assist-pro

# Gitユーザー設定（既に設定済みの場合はスキップ）
git config user.email "yoriko.kikunaga@aozora-cg.com"
git config user.name "Yoriko Kikunaga"

# 変更をステージング
git add .github/workflows/hourly-sync.yml
git add GITHUB_ACTIONS_SETUP.md
git add sync-and-deploy.sh
git add SYNC_SETUP.md
git add cloudbuild.yaml
git add importSpreadsheetData.cjs
git add .gcloudignore

# コミット
git commit -m "feat: Add GitHub Actions hourly sync workflow

- Add hourly-sync.yml workflow for automated spreadsheet sync
- Add setup guides for GitHub Actions
- Configure automatic deployment every hour

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# プッシュ（パスワード入力時に先ほど作成したトークンを使用）
git push origin main
```

**認証プロンプトが表示されたら:**
- Username: `yoriko-kikunaga`
- Password: [先ほどコピーしたPersonal Access Token]

---

### ステップ4: ワークフローの動作確認

#### 4-1: 手動実行でテスト

1. **GitHubリポジトリのActionsタブを開く:**
   ```
   https://github.com/yoriko-kikunaga/welfare-assist-pro/actions
   ```

2. **ワークフローを選択:**
   - 左サイドバーから「**Hourly Spreadsheet Sync**」をクリック

3. **手動実行:**
   - 「**Run workflow**」ボタンをクリック
   - ブランチ: `main`
   - Reason: `初回テスト実行`（オプション）
   - 「**Run workflow**」をクリック

4. **実行状況を確認:**
   - ワークフロー実行がリストに表示される
   - クリックして詳細ログを確認
   - 緑色のチェックマーク（✓）が表示されれば成功

#### 4-2: デプロイ結果を確認

ワークフローが成功したら、以下のURLにアクセス:
```
https://welfare-assist-pro.web.app
```

左側の利用者一覧に8,402件のデータが表示されることを確認

---

## ⏰ 自動実行スケジュール

**実行タイミング:** 毎時0分（UTC）

| 日本時間（JST） | UTC時間 | 実行 |
|----------------|---------|------|
| 09:00 | 00:00 | ✓ |
| 10:00 | 01:00 | ✓ |
| 11:00 | 02:00 | ✓ |
| ... | ... | ... |
| 23:00 | 14:00 | ✓ |
| 00:00 | 15:00 | ✓ |

**実行頻度:** 24回/日、720回/月

---

## 📊 実行ログの確認

### 成功時のログ

```
✅ デプロイ成功
🌐 URL: https://welfare-assist-pro.web.app
📊 データ件数: 8,402件
```

### 失敗時の対応

1. **GitHub Actionsページでログを確認:**
   ```
   https://github.com/yoriko-kikunaga/welfare-assist-pro/actions
   ```

2. **失敗したステップを特定:**
   - 赤い×マークがついているステップをクリック
   - エラーメッセージを確認

3. **よくあるエラーと対処法:**

   **エラー: "Permission denied"**
   - 原因: GCP_SA_KEYが正しく設定されていない
   - 対処: ステップ2を再度実行し、Secretを再設定

   **エラー: "Spreadsheet not found"**
   - 原因: サービスアカウントがスプレッドシートにアクセスできない
   - 対処: スプレッドシートの共有設定を確認
     ```
     welfare-assist-sa@welfare-assist-pro.iam.gserviceaccount.com
     ```

   **エラー: "Firebase deploy failed"**
   - 原因: ビルド失敗または権限不足
   - 対処: ビルドログを確認し、構文エラーがないか確認

---

## 🔧 ワークフローのカスタマイズ

### 実行頻度を変更する場合

`.github/workflows/hourly-sync.yml` の `cron` を編集:

```yaml
schedule:
  # 例: 2時間ごと
  - cron: '0 */2 * * *'

  # 例: 6時間ごと（0時、6時、12時、18時）
  - cron: '0 0,6,12,18 * * *'

  # 例: 毎日午前9時（日本時間18時UTC）
  - cron: '0 9 * * *'
```

変更後、GitHubにプッシュ:
```bash
git add .github/workflows/hourly-sync.yml
git commit -m "chore: Update sync schedule"
git push origin main
```

### 通知を追加する場合

Slackやメールでの通知も設定可能です。詳細は[GitHub Actions Marketplace](https://github.com/marketplace?type=actions)を参照。

---

## 💰 GitHub Actions 無料枠

**無料プラン:**
- パブリックリポジトリ: 無制限
- プライベートリポジトリ: 2,000分/月

**このワークフローの使用量:**
- 実行時間: 約3分/回
- 月間実行回数: 720回
- 月間使用時間: 2,160分

**注意:** プライベートリポジトリの場合、無料枠を超過します。

**対策:**
1. リポジトリをパブリックにする（推奨）
2. 実行頻度を減らす（例: 6時間ごと → 360分/月）
3. GitHub Pro（$4/月、3,000分/月）にアップグレード

---

## 🔒 セキュリティのベストプラクティス

### ✅ 実施済み

- ✓ サービスアカウントキーをGitHub Secretsに保存
- ✓ キーファイルをリポジトリにコミットしない（.gitignore設定済み）
- ✓ 最小権限の原則（サービスアカウントは必要な権限のみ）

### 📝 推奨事項

1. **定期的なキーローテーション:**
   - 3〜6ヶ月ごとにサービスアカウントキーを再生成

2. **Workload Identity使用（上級者向け）:**
   - キーファイル不要で、より安全な認証が可能

3. **監査ログの確認:**
   - GCPコンソールでサービスアカウントの使用状況を定期確認

---

## 📈 次のステップ（オプション）

1. **✅ Slack通知の追加**
   - デプロイ成功/失敗時にSlackに通知

2. **✅ データ差分検出**
   - 変更があった場合のみデプロイ

3. **✅ ロールバック機能**
   - デプロイ失敗時に前のバージョンに自動復元

4. **✅ パフォーマンスモニタリング**
   - Lighthouseスコアの自動計測

---

## 🆘 サポート

### 問題が発生した場合

1. **GitHub Actions ログを確認**
2. **GCP Cloud Build ログを確認**
3. **Firebase Hosting ログを確認**

### 連絡先

- GitHubリポジトリのIssues: [新しいIssueを作成](https://github.com/yoriko-kikunaga/welfare-assist-pro/issues/new)
- メール: yoriko.kikunaga@aozora-cg.com

---

## ✅ チェックリスト

セットアップ完了前に以下を確認してください:

- [ ] GitHub Secretに `GCP_SA_KEY` を追加済み
- [ ] ワークフローファイルをGitHubにプッシュ済み
- [ ] 手動実行でテスト成功
- [ ] 公開URLでデータ表示を確認
- [ ] 1時間後に自動実行されることを確認

---

**すべてのチェックが完了したら、自動同期が稼働しています！** 🎉
