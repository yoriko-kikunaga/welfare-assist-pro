import { Client } from '../../types';

/**
 * 指定月（'YYYY-MM'）に有効だった属性値を返す（月度ページで「その月の状態」を表示するため）。
 *
 * - 基準日 = 月末。その月内に起きた変更も反映する（例: 5/15に介護度変更 → 5月は新しい値）。
 * - attributeHistory に該当エントリがあれば、基準日以前で最新の effectiveFrom のエントリ値を返す。
 *   - effectiveFrom が空('')のエントリ＝「記録開始前のベースライン値」で、常に対象（最古扱い）。
 * - 履歴が無い／基準日より後の履歴しか無い場合は現在値（client[field]）にフォールバック。
 *
 * 注: 返り値は履歴に保存された表示用文字列（未設定は 'ー'、真偽は '該当'/'非該当' 等）。
 *     呼び出し側で必要に応じて 'ー'→'' 変換や `=== '生保'` 比較を行うこと。
 */
export function getClientAttributeAsOf(client: Client, field: string, month: string): string {
  const currentRaw = (client as any)[field];
  const current = currentRaw === undefined || currentRaw === null ? '' : String(currentRaw);

  const history = (client.attributeHistory || []).filter(e => e.field === field);
  if (history.length === 0) return current;

  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const ref = `${month}-${String(lastDay).padStart(2, '0')}`;

  const applicable = history
    .filter(e => !e.effectiveFrom || e.effectiveFrom <= ref)
    .sort((a, b) => {
      const av = a.effectiveFrom || '';
      const bv = b.effectiveFrom || '';
      return av < bv ? -1 : av > bv ? 1 : 0;
    });

  if (applicable.length === 0) return current; // 基準日より後の履歴のみ（ベースライン未記録の旧データ）
  return applicable[applicable.length - 1].value;
}
