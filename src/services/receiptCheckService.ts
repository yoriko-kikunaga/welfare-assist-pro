import {
  collection,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  Client,
  ReceiptCheckItem,
  ReceiptCheckDocument,
  OfficeLocation
} from '../../types';

const RECEIPT_CHECKS_COLLECTION = 'receiptChecks';

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Timestamp)) {
      result[key] = stripUndefined(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function makeDocId(month: string, office: string): string {
  return `${month}_${office}`;
}

// ===== CRUD =====

export async function getReceiptCheck(month: string, office: string): Promise<ReceiptCheckDocument | null> {
  const docId = makeDocId(month, office);
  const docRef = doc(db, RECEIPT_CHECKS_COLLECTION, docId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    billingMonth: data.billingMonth,
    office: data.office,
    items: data.items || [],
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
    updatedBy: data.updatedBy || ''
  };
}

export async function saveReceiptCheck(
  month: string,
  office: string,
  items: ReceiptCheckItem[],
  userEmail: string
): Promise<void> {
  const docId = makeDocId(month, office);
  const docRef = doc(db, RECEIPT_CHECKS_COLLECTION, docId);

  const data = stripUndefined({
    billingMonth: month,
    office,
    items: items.map(item => stripUndefined(item as unknown as Record<string, unknown>)),
    updatedAt: serverTimestamp(),
    updatedBy: userEmail
  });

  const existing = await getDoc(docRef);
  if (!existing.exists()) {
    (data as Record<string, unknown>).createdAt = serverTimestamp();
  }

  await setDoc(docRef, data, { merge: true });
}

// ===== 自費レンタルのみ除外フィルター =====

export function filterOutJihiOnly(
  items: ReceiptCheckItem[],
  clients: Client[],
  month: string
): ReceiptCheckItem[] {
  const [year, mon] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));

  return items.filter(item => {
    const c = clientMap.get(item.aozoraId);
    // clientデータがない・用具データがない場合は除外しない
    if (!c?.selectedEquipment?.length) return true;
    const hasInsurance = c.selectedEquipment.some(eq => {
      if (eq.status !== '介護保険レンタル') return false;
      if (eq.startDate && eq.startDate > monthEnd) return false;
      if (eq.endDate && eq.endDate < monthStart) return false;
      return true;
    });
    const hasJihi = c.selectedEquipment.some(eq => eq.status === '自費レンタル');
    return !(hasJihi && !hasInsurance);
  });
}

// ===== 利用者データから自動生成 =====

// 変更情報から入院日・退院日・解約日を抽出
// 当月内に複数件 → カンマ区切り全件（昇順）、当月になければ最新1件
function extractDatesFromChangeRecords(
  changeRecords: import('../../types').ClientChangeRecord[],
  month: string
): { hospitalizationDate: string; dischargeDate: string; cancellationDate: string } {
  // 入院日
  const hospitalRecs = changeRecords
    .filter(r => r.infoType === '入院（サービス停止）' && r.billingStopDateHospital);
  const hospitalInMonth = hospitalRecs
    .filter(r => r.billingStopDateHospital.startsWith(month))
    .sort((a, b) => a.billingStopDateHospital.localeCompare(b.billingStopDateHospital));
  const hospitalizationDate = hospitalInMonth.length > 0
    ? hospitalInMonth.map(r => r.billingStopDateHospital).join(', ')
    : hospitalRecs.sort((a, b) => b.billingStopDateHospital.localeCompare(a.billingStopDateHospital))[0]?.billingStopDateHospital || '';

  // 退院日
  const dischargeRecs = changeRecords
    .filter(r => r.infoType === '退院（サービス開始）' && r.billingStartDateDischarge);
  const dischargeInMonth = dischargeRecs
    .filter(r => r.billingStartDateDischarge.startsWith(month))
    .sort((a, b) => a.billingStartDateDischarge.localeCompare(b.billingStartDateDischarge));
  const dischargeDate = dischargeInMonth.length > 0
    ? dischargeInMonth.map(r => r.billingStartDateDischarge).join(', ')
    : dischargeRecs.sort((a, b) => b.billingStartDateDischarge.localeCompare(a.billingStartDateDischarge))[0]?.billingStartDateDischarge || '';

  // 解約日
  const cancelRecs = changeRecords
    .filter(r => r.infoType === '解約' && r.billingStopDateCancel);
  const cancelInMonth = cancelRecs
    .filter(r => r.billingStopDateCancel.startsWith(month))
    .sort((a, b) => a.billingStopDateCancel.localeCompare(b.billingStopDateCancel));
  const cancellationDate = cancelInMonth.length > 0
    ? cancelInMonth.map(r => r.billingStopDateCancel).join(', ')
    : cancelRecs.sort((a, b) => b.billingStopDateCancel.localeCompare(a.billingStopDateCancel))[0]?.billingStopDateCancel || '';

  return { hospitalizationDate, dischargeDate, cancellationDate };
}

// Firestoreから読み込んだ保存済みアイテムをclientデータで最新化
// （事業所・拠点・介護事業所・入院日・退院日・解約日はclientデータを正とする）
export function refreshItemsFromClients(
  savedItems: ReceiptCheckItem[],
  clients: Client[],
  month: string
): ReceiptCheckItem[] {
  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));

  return savedItems.map(item => {
    const c = clientMap.get(item.aozoraId);
    if (!c) return item;

    const dates = extractDatesFromChangeRecords(c.changeRecords || [], month);

    return {
      ...item,
      nameKana: c.nameKana || item.nameKana,
      office: c.office || item.office,
      location: c.location || item.location,
      careOffice: c.careSupportOffice || item.careOffice,
      welfareRecipient: c.paymentType === '生保',
      ...dates,
    };
  });
}

// 変更情報の参照開始日（これ以降の「新規」レコードのみを追加トリガーとする）
const RECEIPT_CHECK_START_DATE = '2026-02-01';

export function generateReceiptCheckFromClients(
  clients: Client[],
  month: string,
  office: string
): ReceiptCheckItem[] {
  const [year, mon] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  return clients
    .filter(c => {
      // 事業所フィルタ（「全事業所」の場合は全員対象）
      if (office !== '全事業所' && c.office !== office) return false;

      // 2026-02以降に請求開始日がある「新規」変更情報があり、かつ当月末以前に開始している
      const hasNew = (c.changeRecords || []).some(r =>
        r.infoType === '新規' &&
        r.billingStartDateNew &&
        r.billingStartDateNew >= RECEIPT_CHECK_START_DATE &&
        r.billingStartDateNew <= monthEnd
      );
      if (!hasNew) return false;

      // 当月開始前に解約済みの利用者は除外
      const isCancelled = (c.changeRecords || []).some(r =>
        r.infoType === '解約' &&
        r.billingStopDateCancel &&
        r.billingStopDateCancel < monthStart
      );
      if (isCancelled) return false;

      // 自費レンタルのみの利用者を除外（介護保険レンタルがなく自費レンタルがある場合）
      const hasInsuranceRental = c.selectedEquipment?.some(eq => {
        if (eq.status !== '介護保険レンタル') return false;
        if (eq.startDate && eq.startDate > monthEnd) return false;
        if (eq.endDate && eq.endDate < monthStart) return false;
        return true;
      });
      const hasJihiOnly = !hasInsuranceRental &&
        c.selectedEquipment?.some(eq => eq.status === '自費レンタル');
      return !hasJihiOnly;
    })
    .map(c => {
      // 介護保険レンタルの単位数合計
      const units = c.selectedEquipment
        ?.filter(eq => {
          if (eq.status !== '介護保険レンタル') return false;
          if (eq.startDate && eq.startDate > monthEnd) return false;
          if (eq.endDate && eq.endDate < monthStart) return false;
          return true;
        })
        .reduce((sum, eq) => sum + (parseInt(eq.units || '0', 10) || 0), 0) || 0;

      // 新規利用初回日
      const firstUseDate = [...(c.changeRecords || [])]
        .filter(r => r.infoType === '新規' && r.billingStartDateNew)
        .sort((a, b) => a.billingStartDateNew.localeCompare(b.billingStartDateNew))[0]
        ?.billingStartDateNew || '';

      // 変更情報から入院日・退院日・解約日を抽出（当月複数件はカンマ区切り）
      const { hospitalizationDate, dischargeDate, cancellationDate } =
        extractDatesFromChangeRecords(c.changeRecords || [], month);

      return {
        aozoraId: c.aozoraId,
        clientName: c.name,
        nameKana: c.nameKana,
        office: c.office,
        units,
        provisionTicketReceived: false,
        unitsDifference: false,
        changedFromLastMonth: false,
        kaipokePlanCreated: false,
        welfareRecipient: c.paymentType === '生保',
        welfareCareTicket: false,
        firstUseDate,
        hospitalizationDate,
        dischargeDate,
        cancellationDate,
        reflectedFromManagement: false,
        performanceReport: false,
        delayed: false,
        location: c.location || '',
        careOffice: c.careSupportOffice || ''
      } satisfies ReceiptCheckItem;
    })
    .sort((a, b) => {
      const kanaA = a.nameKana || a.clientName;
      const kanaB = b.nameKana || b.clientName;
      return kanaA.localeCompare(kanaB, 'ja');
    });
}

// ===== CSVインポート =====

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

export function parseReceiptCheckCSV(csvText: string): ReceiptCheckItem[] {
  // BOM除去
  const text = csvText.replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);

  // ヘッダーからインデックスを取得
  const colIdx = (name: string) => headers.findIndex(h => h.includes(name));
  const iOfficeName = colIdx('事業所名');
  const iAozoraId = colIdx('あおぞらID') !== -1 ? colIdx('あおぞらID') : colIdx('利用者名（あおぞらID）');
  const iClientName = headers.findIndex((h, i) => h === '利用者名' && i !== iAozoraId);
  const iUnits = colIdx('単位数');
  const iProvisionTicket = colIdx('提供票受領');
  const iUnitsDiff = colIdx('単位数の差異') !== -1 ? colIdx('単位数の差異') : colIdx('単位数差異');
  const iChanged = colIdx('先月からの変更');
  const iKaipokePlan = colIdx('カイポケ計画書');
  const iWelfareRecipient = colIdx('生保受給');
  const iWelfareCareTicket = colIdx('生保介護券');
  const iFirstUse = colIdx('利用初回日');
  const iHospital = colIdx('入院日');
  const iDischarge = colIdx('退院日');
  const iCancel = colIdx('解約日');
  const iReflected = colIdx('管理表から反映');
  const iPerformance = colIdx('実績報告書');
  const iDelayed = colIdx('月遅れ');
  const iLocation = colIdx('拠点');
  const iCareOffice = colIdx('介護事業所');

  const parseBool = (val: string): boolean => val === '〇' || val === '○';
  const getCol = (row: string[], idx: number): string => idx >= 0 && idx < row.length ? row[idx] : '';

  const items: ReceiptCheckItem[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const aozoraId = getCol(cols, iAozoraId);
    if (!aozoraId) continue;

    items.push({
      aozoraId,
      clientName: getCol(cols, iClientName),
      office: getCol(cols, iOfficeName),
      units: parseInt(getCol(cols, iUnits), 10) || 0,
      provisionTicketReceived: parseBool(getCol(cols, iProvisionTicket)),
      unitsDifference: parseBool(getCol(cols, iUnitsDiff)),
      changedFromLastMonth: parseBool(getCol(cols, iChanged)),
      kaipokePlanCreated: parseBool(getCol(cols, iKaipokePlan)),
      welfareRecipient: parseBool(getCol(cols, iWelfareRecipient)),
      welfareCareTicket: parseBool(getCol(cols, iWelfareCareTicket)),
      firstUseDate: getCol(cols, iFirstUse),
      hospitalizationDate: getCol(cols, iHospital),
      dischargeDate: getCol(cols, iDischarge),
      cancellationDate: getCol(cols, iCancel),
      reflectedFromManagement: parseBool(getCol(cols, iReflected)),
      performanceReport: parseBool(getCol(cols, iPerformance)),
      delayed: parseBool(getCol(cols, iDelayed)),
      location: getCol(cols, iLocation),
      careOffice: getCol(cols, iCareOffice)
    });
  }

  return items;
}

// ===== CSVエクスポート =====

export function exportReceiptCheckCSV(items: ReceiptCheckItem[]): void {
  const headers = [
    'あおぞらID', '利用者名', '事業所', '単位数',
    '提供票受領', '単位数差異', '先月からの変更', 'カイポケ計画書作成',
    '生保受給', '生保介護券',
    '利用初回日', '入院日', '退院日', '解約日',
    '管理表から反映', '実績報告書', '月遅れ',
    '拠点', '介護事業所'
  ];

  const boolToStr = (v: boolean) => v ? '○' : '';

  const rows = items.map(item => [
    item.aozoraId,
    item.clientName,
    item.office,
    String(item.units),
    boolToStr(item.provisionTicketReceived),
    boolToStr(item.unitsDifference),
    boolToStr(item.changedFromLastMonth),
    boolToStr(item.kaipokePlanCreated),
    boolToStr(item.welfareRecipient),
    boolToStr(item.welfareCareTicket),
    item.firstUseDate,
    item.hospitalizationDate,
    item.dischargeDate,
    item.cancellationDate,
    boolToStr(item.reflectedFromManagement),
    boolToStr(item.performanceReport),
    boolToStr(item.delayed),
    item.location,
    item.careOffice
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `レセプトチェック_${items[0]?.office || ''}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
