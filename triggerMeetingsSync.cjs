/**
 * 夜間パイプライン用: デプロイ済み Cloud Function `syncMeetingsToSheets`（callable）を
 * HTTPS で呼び出し、議事録一覧をスプレッドシートへ同期する。
 *
 * - アプリの自動同期と完全に同じ処理（追記専用・meeting.id重複スキップ・19列・ヘッダー復元）を
 *   再利用するため、ロジックを二重実装しない。
 * - Firestore の clientEdits を読むので、夜間の syncClientsToFirestore（Step 9）
 *   の後に実行すること（最新の議事録が clientEdits に入った状態で同期される）。
 * - 同期に失敗してもデプロイ等は止めないよう、常に exit(0)（警告ログのみ）。
 */
const REGION = 'asia-northeast1';
const PROJECT = 'welfare-assist-pro';
const URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/syncMeetingsToSheets`;

(async () => {
  console.log(`[meetings sync] calling ${URL} ...`);
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // callable プロトコル: ボディは {"data": ...}、戻りは {"result": ...}
      body: JSON.stringify({ data: {} }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn(`[meetings sync] ⚠ HTTP ${res.status}: ${text.slice(0, 500)}`);
      console.warn('[meetings sync] 同期に失敗しましたが、パイプラインは継続します。');
      process.exit(0);
    }
    console.log('[meetings sync] ✓ 同期成功:', text.slice(0, 500));
  } catch (e) {
    console.warn('[meetings sync] ⚠ 呼び出し失敗（パイプラインは継続）:', e && e.message ? e.message : e);
    process.exit(0);
  }
})();
