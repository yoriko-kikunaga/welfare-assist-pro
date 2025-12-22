#!/bin/bash
# WelfareAssist Pro - スプレッドシート同期＆デプロイスクリプト
#
# このスクリプトは以下を実行します：
# 1. Googleスプレッドシートから最新データを取得
# 2. Reactアプリをビルド
# 3. Firebase Hostingにデプロイ

echo "=== WelfareAssist Pro - 自動同期開始 ==="
echo ""

# Step 1: スプレッドシートデータをインポート
echo "[1/3] スプレッドシートからデータを取得中..."
node importSpreadsheetData.cjs
if [ $? -ne 0 ]; then
  echo "エラー: データ取得に失敗しました"
  exit 1
fi
echo "✓ データ取得完了"
echo ""

# Step 2: アプリケーションをビルド
echo "[2/3] アプリケーションをビルド中..."
npm run build
if [ $? -ne 0 ]; then
  echo "エラー: ビルドに失敗しました"
  exit 1
fi
echo "✓ ビルド完了"
echo ""

# Step 3: Firebase Hostingにデプロイ
echo "[3/3] Firebase Hostingにデプロイ中..."
firebase deploy --only hosting --project=welfare-assist-pro --non-interactive
if [ $? -ne 0 ]; then
  echo "エラー: デプロイに失敗しました"
  exit 1
fi
echo "✓ デプロイ完了"
echo ""

echo "=== 自動同期完了 ==="
echo "アプリURL: https://welfare-assist-pro.web.app"
