/**
 * salesLock.ts
 *
 * 確定済み月に計上された「自費レンタル」「販売」レコードを保護するための純粋ロジック。
 * - 確定（売上確定 or 月次確定）された月に属するレコードは、削除・金額系編集を禁止する。
 * - ただし利用終了日(endDate)を確定済み月より後に設定する操作（＝解約・延長）は許可する。
 *
 * Firestore アクセスは含まない（呼び出し側が確定集合 ConfirmedSet を渡す）。
 */
import { Equipment, SalesType } from '../../types';

// 保護対象のステータス（アプリ入力＝確定後に触られると困るもの）。介護保険レンタルはCSV取込なので対象外。
export const LOCKABLE_STATUSES: SalesType[] = ['自費レンタル', '販売'];

// 確定後に変更を禁止する金額・期間系フィールド（差し戻し対象）
export const PROTECTED_FIELDS: (keyof Equipment)[] = [
  'name', 'selfPayProductName', 'status', 'office',
  'unitPrice', 'quantity', 'taxType', 'taxIncludedAmount',
  'subtotalAmount', 'monthlyCost', 'startDate', 'deliveryDate',
];

// 確定集合: `${salesType}|${YYYY-MM}` の集合
export type ConfirmedSet = Set<string>;
export const confKey = (salesType: string, month: string) => `${salesType}|${month}`;

const norm = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** "YYYY-MM-DD" → "YYYY-MM" */
export function ym(date?: string | null): string | null {
  if (!date || date.length < 7) return null;
  return date.slice(0, 7);
}

/** レコードが当該月(YYYY-MM)に計上されるか（MonthlySalesExport と同じ判定） */
export function isActiveInMonth(eq: Equipment, month: string): boolean {
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`; // 文字列比較の上限としては31で十分
  if (eq.status === '販売') {
    const d = eq.deliveryDate || '';
    return d >= monthStart && d <= monthEnd;
  }
  if (eq.status === '自費レンタル') {
    const start = eq.startDate || '';
    const end = eq.endDate || '';
    return (!start || start <= monthEnd) && (!end || end >= monthStart);
  }
  return false;
}

/** レコードがロックされている（確定済み）月の一覧（昇順） */
export function lockedMonthsFor(eq: Equipment, confirmed: ConfirmedSet): string[] {
  if (!eq.status || !LOCKABLE_STATUSES.includes(eq.status as SalesType)) return [];
  const out: string[] = [];
  confirmed.forEach(key => {
    const sep = key.indexOf('|');
    const t = key.slice(0, sep);
    const m = key.slice(sep + 1);
    if (t === eq.status && isActiveInMonth(eq, m)) out.push(m);
  });
  return out.sort();
}

export function isLocked(eq: Equipment, confirmed: ConfirmedSet): boolean {
  return lockedMonthsFor(eq, confirmed).length > 0;
}

export function protectedFieldsChanged(cur: Equipment, next: Equipment): boolean {
  return PROTECTED_FIELDS.some(f => norm(cur[f]) !== norm(next[f]));
}

/**
 * endDate 変更の可否。
 * - 終了日クリア（空）＝課金延長（将来方向）→ 確定済み月に影響しないので許可。
 * - 確定済みの最終月より「後の月」に設定する場合のみ許可（解約を将来方向で止める）。
 * - 確定済み月内・それ以前に設定する場合は不可（確定済み月の課金を遡及的に削るため）。
 */
export function endDateChangeAllowed(cur: Equipment, nextEndDate: string | undefined, confirmed: ConfirmedSet): boolean {
  const months = lockedMonthsFor(cur, confirmed);
  if (months.length === 0) return true;
  if (!nextEndDate) return true;
  const m = ym(nextEndDate);
  const maxConfirmed = months[months.length - 1];
  return !!m && m > maxConfirmed;
}

export interface LockViolation {
  id: string;
  name: string;
  kind: string;
  months: string[];
}

/**
 * 保存前の調整。current(Firestore現行) と incoming(保存しようとしている配列) を比較し、
 * 確定済みの自費/販売レコードの「削除（消失・論理削除）」「金額系改変」「endDateの遡及変更」を
 * 現行値へ差し戻したマージ配列と、違反内容を返す。未確定レコードは incoming をそのまま採用。
 */
export function reconcileForSave(
  current: Equipment[],
  incoming: Equipment[],
  confirmed: ConfirmedSet
): { merged: Equipment[]; violations: LockViolation[] } {
  const violations: LockViolation[] = [];
  const incomingById = new Map(incoming.map(e => [e.id, e]));
  const result: Equipment[] = incoming.map(e => ({ ...e }));
  const resultById = new Map(result.map(e => [e.id, e]));

  for (const cur of current) {
    if (!cur.status || !LOCKABLE_STATUSES.includes(cur.status as SalesType)) continue;
    const months = lockedMonthsFor(cur, confirmed);
    if (months.length === 0) continue; // 未確定月のレコードは保護対象外
    const name = cur.selfPayProductName || cur.name || cur.id;
    const inc = incomingById.get(cur.id);

    if (!inc) {
      // 確定済みレコードが配列から消えた（クロバー or 物理削除）→ 復元
      result.push({ ...cur });
      violations.push({ id: cur.id, name, kind: '確定済みレコードの削除を復元', months });
      continue;
    }

    const target = resultById.get(cur.id)!;
    let reverted = false;

    // 論理削除（deletedAt 付与）も確定済みでは禁止（確定解除が必要）
    if (!cur.deletedAt && inc.deletedAt) {
      target.deletedAt = cur.deletedAt;
      target.deletedBy = cur.deletedBy;
      reverted = true;
    }
    // 金額系フィールドの変更を差し戻し（note/recorder/propertyAttribute 等の編集は許可）
    if (protectedFieldsChanged(cur, inc)) {
      const t = target as unknown as Record<string, unknown>;
      const c = cur as unknown as Record<string, unknown>;
      for (const f of PROTECTED_FIELDS) t[f as string] = c[f as string];
      reverted = true;
    }
    // endDate は将来方向のみ許可、遡及は差し戻し
    if (norm(inc.endDate) !== norm(cur.endDate) && !endDateChangeAllowed(cur, inc.endDate, confirmed)) {
      target.endDate = cur.endDate;
      reverted = true;
    }

    if (reverted) violations.push({ id: cur.id, name, kind: '確定済みレコードの改変を差し戻し', months });
  }

  return { merged: result, violations };
}
