/**
 * 変更情報スプレッドシート 手動同期ボタン（Google Apps Script）
 *
 * 目的:
 *   アプリ内の自動同期（保存後4秒デバウンス）や夜間バッチ（daily-sync.yml）を待たずに、
 *   スプレッドシート上のメニューからワンクリックで最新の変更情報を反映する。
 *
 * 呼び出し先:
 *   Cloud Function `syncChangeRecordsToSheets`（functions/src/index.ts）を直接HTTPS呼び出し。
 *   アプリの「スプレッドシートに同期」ボタン・triggerChangeRecordsSync.cjs（夜間バッチ）と
 *   完全に同じ処理を再利用するため、このスクリプト側に同期ロジックは一切持たない。
 *   （新規=追記／既存だが内容が違う=A:S列のみ上書き更新／内容同じ=スキップ、除外リスト対応）
 *
 * 導入方法:
 *   1. 対象スプレッドシートを開く → メニュー「拡張機能」→「Apps Script」
 *   2. エディタの Code.gs（または既存の空スクリプト）にこの内容を貼り付けて保存
 *      （Ctrl+S、プロジェクト名は任意でよい）
 *   3. スプレッドシートのタブに戻り、ページを再読み込み（リロード）
 *      → メニューバーに「変更情報同期」が追加される
 *   4. 「変更情報同期」→「🔄 今すぐ同期」をクリック
 *      → 初回のみ「承認が必要です」画面が出るので、自分のGoogleアカウントで許可する
 *        （外部URLへの通信＝script.external_request 権限の承認）
 *   5. 完了すると「◯件を追記、◯件を更新しました」等のダイアログが出る
 *
 * 補足（見た目上の「ボタン」にしたい場合）:
 *   挿入 → 図形描画 でボタン風の図形を作成 → 図形を選択 →
 *   右上の「⋮」→「スクリプトを割り当て」→ manualSyncChangeRecords と入力
 *   （メニュー方式と併用可。図形ボタンは見た目が分かりやすい半面、
 *   　シートをコピーすると図形への割り当てが引き継がれない点に注意）
 */

var SYNC_FUNCTION_URL = 'https://asia-northeast1-welfare-assist-pro.cloudfunctions.net/syncChangeRecordsToSheets';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('変更情報同期')
    .addItem('🔄 今すぐ同期', 'manualSyncChangeRecords')
    .addToUi();
}

function manualSyncChangeRecords() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  ss.toast('同期を実行中です。しばらくお待ちください…', '変更情報同期', -1);

  try {
    var response = UrlFetchApp.fetch(SYNC_FUNCTION_URL, {
      method: 'post',
      contentType: 'application/json',
      // callable プロトコル: リクエストは {"data": ...}、正常時のレスポンスは {"result": ...}
      payload: JSON.stringify({ data: {} }),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = JSON.parse(response.getContentText());

    if (code >= 200 && code < 300 && body.result) {
      ss.toast('同期が完了しました', '変更情報同期', 5);
      ui.alert(
        '同期完了',
        (body.result.message || '同期が完了しました。') +
          (body.result.spreadsheetUrl ? '' : ''),
        ui.ButtonSet.OK
      );
    } else {
      var errMsg = (body.error && body.error.message) || ('HTTP ' + code);
      ss.toast('同期に失敗しました', '変更情報同期', 5);
      ui.alert('同期エラー', '同期に失敗しました:\n' + errMsg, ui.ButtonSet.OK);
    }
  } catch (e) {
    ss.toast('同期に失敗しました', '変更情報同期', 5);
    ui.alert('同期エラー', '通信に失敗しました:\n' + e.message, ui.ButtonSet.OK);
  }
}
