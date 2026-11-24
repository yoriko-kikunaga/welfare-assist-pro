/**
 * 予実管理スプレッドシート 転記ボタン（Google Apps Script）
 *
 * 目的:
 *   「ケアテク予実管理に基づく数字_リニューアル版」へ、アプリの数字をワンクリックで転記する。
 *   1回押すと次の2シートを書き直す（どちらもアプリ専用シート。無ければ自動で作られる）:
 *     ・入退去・入退院_自動 … レセプトチェックの 新規・解約・入退院（件数集計＋一覧）
 *     ・売上実績_自動       … 貸与・自費・販売（売上実績シートと同じ並びの集計＋利用者別明細）
 *   しばらくは手集計と並べて比較する運用（2026-11-24〜）。
 *
 * 呼び出し先:
 *   Cloud Function `syncReceiptCheckToYojitsuSheet` / `syncSalesToYojitsuSheet`（functions/src/index.ts）を
 *   直接HTTPS呼び出し。集計・転記のロジックはすべてCloud Function側にあり、このスクリプトは月を聞いて呼ぶだけ。
 *
 * 数え方（2026-11-24 確定）:
 *   ［入退去・入退院］新規 = 利用初回日が対象月 / 解約 = 解約日が対象月
 *     入院（当月請求なし）= 対象月に入院中で単位数0（退院日と同じ日に解約した人は解約のみに数える）
 *     在宅/施設 = 拠点に施設名があれば施設 / 自社居宅 = 居宅介護支援事業所名に「あおぞら」を含む
 *   ［売上実績］金額は月次売上処理と同じ計算（貸与=給付対象金額、自費=単価×数量、販売=税抜＋送料＋調整額）
 *     施設/外部 = その月に施設入居（施設入居新規〜施設入居解約）が1日でもあれば施設
 *     貸与の利用者別は、最新のカイポケ取込の月だけ出せる（それ以外の月は確定値のみ）
 *
 * 前提:
 *   このスプレッドシートに、Cloud Functionのサービスアカウント
 *   389880096786-compute@developer.gserviceaccount.com を「編集者」で共有しておくこと。
 *   入退去・入退院は、アプリのレセプトチェック画面で対象月を一度開いておくこと。
 *
 * 導入方法:
 *   1. 対象スプレッドシートを開く → メニュー「拡張機能」→「Apps Script」
 *   2. エディタの Code.gs にこの内容を貼り付けて保存
 *      （既に別のスクリプトがある場合は、onOpen が2つにならないよう既存の onOpen にメニュー行だけ足す）
 *   3. スプレッドシートのタブに戻り、ページを再読み込み → メニューバーに「アプリ連携」が追加される
 *   4. 「アプリ連携」→「📋 予実データを転記」→ 対象月（例: 2026-10）を入力
 *      → 初回のみ「承認が必要です」画面が出るので、自分のGoogleアカウントで許可する
 *
 * 補足（見た目上の「ボタン」にしたい場合）:
 *   挿入 → 図形描画 でボタン風の図形を作成 → 図形を選択 →
 *   右上の「⋮」→「スクリプトを割り当て」→ transferYojitsu と入力
 */

var FUNCTION_BASE_URL = 'https://asia-northeast1-welfare-assist-pro.cloudfunctions.net/';
var TRANSFERS = [
  { label: '入退去・入退院', fn: 'syncReceiptCheckToYojitsuSheet' },
  { label: '売上実績（貸与・自費・販売）', fn: 'syncSalesToYojitsuSheet' }
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('アプリ連携')
    .addItem('📋 予実データを転記', 'transferYojitsu')
    .addToUi();
}

function transferYojitsu() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 既定は前月（月が明けてから前月分をまとめる運用のため）
  var d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  var defaultMonth = Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM');

  var res = ui.prompt(
    '予実データを転記',
    '対象月を「2026-10」の形式で入力してください。\n空欄のままOKを押すと ' + defaultMonth + ' を転記します。',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var month = res.getResponseText().trim() || defaultMonth;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    ui.alert('入力エラー', '対象月は「2026-10」の形式で入力してください。', ui.ButtonSet.OK);
    return;
  }

  var results = [];
  for (var i = 0; i < TRANSFERS.length; i++) {
    var t = TRANSFERS[i];
    ss.toast(month + ' の' + t.label + 'を転記中です…（' + (i + 1) + '/' + TRANSFERS.length + '）', 'アプリ連携', -1);
    results.push('【' + t.label + '】\n' + callTransfer(t.fn, month));
  }

  ss.toast('転記が終わりました', 'アプリ連携', 5);
  ui.alert('転記結果（' + month + '）', results.join('\n\n'), ui.ButtonSet.OK);
}

// 1つのCloud Functionを呼び、結果メッセージを返す（失敗しても次の転記は続ける）
function callTransfer(fn, month) {
  try {
    var response = UrlFetchApp.fetch(FUNCTION_BASE_URL + fn, {
      method: 'post',
      contentType: 'application/json',
      // callable プロトコル: リクエストは {"data": ...}、正常時のレスポンスは {"result": ...}
      payload: JSON.stringify({ data: { month: month } }),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    var body = JSON.parse(response.getContentText());
    if (code >= 200 && code < 300 && body.result) {
      return body.result.message || '転記しました。';
    }
    return '❌ 失敗: ' + ((body.error && body.error.message) || ('HTTP ' + code));
  } catch (e) {
    return '❌ 通信に失敗しました: ' + e.message;
  }
}
