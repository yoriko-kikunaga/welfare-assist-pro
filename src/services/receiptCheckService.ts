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
import { getClientAttributeAsOf, AsOfBasis } from '../utils/attributeHistory';

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

// ===== 福祉用具利用者でない利用者を除外フィルター =====

export function filterOutNonWelfareUsers(
  items: ReceiptCheckItem[],
  clients: Client[]
): ReceiptCheckItem[] {
  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));
  return items.filter(item => {
    const c = clientMap.get(item.aozoraId);
    if (!c) return true; // clientデータがない場合は除外しない
    return c.isWelfareEquipmentUser === true;
  });
}

// ===== 該当月より前に解約済みの利用者 → 自動除外候補フラグ付け（削除しない） =====
// 2026-08: 以前はここで一覧から即削除していたが、施設退去後も在宅で利用継続する
// ケースを解約と誤判定してサイレントに消してしまう事故につながっていた。
// 削除する代わりに autoExcludeCandidate フラグを立てて一覧に残し、
// スタッフが「対象に残す」「除外する」（receiptCheckTarget）で確定するまで表示し続ける。

export function markCancelledBeforeCandidates(
  items: ReceiptCheckItem[],
  monthStart: string
): ReceiptCheckItem[] {
  return items.map(item => {
    let isCandidate = false;
    if (item.cancellationDate) {
      const dates = item.cancellationDate.split(',').map(d => d.trim()).filter(Boolean);
      // 最も早い解約日が月初より前なら除外候補
      const minDate = dates.reduce((min, d) => (d < min ? d : min), dates[0]);
      isCandidate = minDate < monthStart;
    }
    if (!!item.autoExcludeCandidate === isCandidate) return item;
    return { ...item, autoExcludeCandidate: isCandidate };
  });
}

// ===== 自費レンタルのみ除外フィルター =====

export function filterOutJihiOnly(
  items: ReceiptCheckItem[],
  clients: Client[],
  _month: string,
  baseClients?: Client[]
): ReceiptCheckItem[] {
  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));
  const baseClientMap = baseClients ? new Map(baseClients.map(c => [c.aozoraId, c])) : null;

  return items.filter(item => {
    const c = clientMap.get(item.aozoraId);
    const baseC = baseClientMap?.get(item.aozoraId);
    // clientデータがない・用具データがない場合は除外しない
    const allEquipment = [...(c?.selectedEquipment || []), ...(baseC?.selectedEquipment || [])];
    if (!allEquipment.length) return true;
    // 介護保険レンタルが1件でもあれば除外しない（期間・endDate問わず、マージ前後両方を確認）
    // ※insuranceRentalOverride=trueの場合、マージ後データから介護保険レンタルが消えるため
    //   ベースデータも必ず確認する
    const hasAnyInsurance = allEquipment.some(eq => eq.status === '介護保険レンタル');
    const hasJihi = allEquipment.some(eq => eq.status === '自費レンタル' && !eq.deletedAt);
    return !(hasJihi && !hasAnyInsurance);
  });
}

// ===== 利用者データから自動生成 =====

// 施設入居新規/施設入居解約（Kintoneアプリ197「入居・退去」連携）の判定。
// 歴史的経緯: 旧197データは infoType が '新規'/'解約' のまま id が
// kintone-197-movein/moveout-* で入っているため id でも判定する。
function isFacilityNewRecord(r: import('../../types').ClientChangeRecord): boolean {
  return r.infoType === '施設入居新規'
    || (typeof r.id === 'string' && r.id.startsWith('kintone-197-movein-'));
}
function isFacilityCancelRecord(r: import('../../types').ClientChangeRecord): boolean {
  return r.infoType === '施設入居解約'
    || (typeof r.id === 'string' && r.id.startsWith('kintone-197-moveout-'));
}
// Tab4で手動入力される、施設入居に紐づかない純粋な「新規」「解約」（レンタルの新規・解約）
function isPureNewRecord(r: import('../../types').ClientChangeRecord): boolean {
  return r.infoType === '新規';
}
function isPureCancelRecord(r: import('../../types').ClientChangeRecord): boolean {
  return r.infoType === '解約';
}

// レセプトチェック用「新規」「解約」レコードの抽出（ハイブリッド方式）。
// 施設入居新規/施設入居解約とTab4の「新規」/「解約」は意味合いが異なる
// （施設入居と福祉用具の利用開始/終了は必ずしも同時ではない）ため、
// 施設入居記録が1件でもある利用者は施設入居新規/施設入居解約のみを正とし、
// Tab4の純粋な新規/解約は使わない。施設入居記録が一件もない利用者
// （在宅のみで施設に入居したことがない方）に限り、例外的にTab4の新規/解約を使う。
function getEffectiveNewRecords(
  changeRecords: import('../../types').ClientChangeRecord[]
): import('../../types').ClientChangeRecord[] {
  const hasFacilityHistory = changeRecords.some(r => isFacilityNewRecord(r) || isFacilityCancelRecord(r));
  return hasFacilityHistory
    ? changeRecords.filter(isFacilityNewRecord)
    : changeRecords.filter(isPureNewRecord);
}
function getEffectiveCancelRecords(
  changeRecords: import('../../types').ClientChangeRecord[]
): import('../../types').ClientChangeRecord[] {
  const hasFacilityHistory = changeRecords.some(r => isFacilityNewRecord(r) || isFacilityCancelRecord(r));
  return hasFacilityHistory
    ? changeRecords.filter(isFacilityCancelRecord)
    : changeRecords.filter(isPureCancelRecord);
}

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

  // 解約日（ハイブリッド方式・getEffectiveCancelRecords参照）
  const cancelRecs = getEffectiveCancelRecords(changeRecords)
    .filter(r => r.billingStopDateCancel);
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
  month: string,
  asOfBasis: AsOfBasis = 'end'
): ReceiptCheckItem[] {
  const clientMap = new Map(clients.map(c => [c.aozoraId, c]));

  const monthStart = `${month}-01`;

  return savedItems.map(item => {
    const c = clientMap.get(item.aozoraId);
    if (!c) return item;

    const rawDates = extractDatesFromChangeRecords(c.changeRecords || [], month);

    // 退院日が該当月より前の場合の処理
    // ・現在退院済み（退院日 >= 入院日）→ 入院日・退院日ともクリア
    // ・退院後に再入院（退院日 < 入院日）→ 再入院日のみ表示、退院日はクリア
    const maxDischarge = rawDates.dischargeDate
      ? rawDates.dischargeDate.split(',').map(d => d.trim()).filter(Boolean)
          .reduce((max, d) => (d > max ? d : max))
      : '';
    const maxHospitalization = rawDates.hospitalizationDate
      ? rawDates.hospitalizationDate.split(',').map(d => d.trim()).filter(Boolean)
          .reduce((max, d) => (d > max ? d : max))
      : '';
    const dates = (maxDischarge && maxDischarge < monthStart)
      ? maxDischarge >= maxHospitalization
        ? { ...rawDates, hospitalizationDate: '', dischargeDate: '' }
        : { ...rawDates, hospitalizationDate: maxHospitalization, dischargeDate: '' }
      : rawDates;

    // 解約日がロックされている場合は自動上書きをスキップ
    const mergedDates = item.cancellationDateLocked
      ? { ...dates, cancellationDate: item.cancellationDate }
      : dates;

    // 事業所・在宅区分・居宅事業所・生保判定は「選択月の状態」を履歴から引く（無ければ現在値）
    const asOfOffice = getClientAttributeAsOf(c, 'office', month, asOfBasis);
    const asOfLocation = getClientAttributeAsOf(c, 'location', month, asOfBasis);
    const asOfFacility = getClientAttributeAsOf(c, 'facilityName', month, asOfBasis);
    const asOfCareOffice = getClientAttributeAsOf(c, 'careSupportOffice', month, asOfBasis);
    const asOfPayment = getClientAttributeAsOf(c, 'paymentType', month, asOfBasis);

    // 拠点＝入居施設名があれば施設名、無ければ在宅区分（在宅）
    const facilityName = (asOfFacility === 'ー' ? '' : asOfFacility) || '';
    const locationVal = (asOfLocation === 'ー' ? '' : asOfLocation) || '';
    const kyoten = facilityName || locationVal;

    return {
      ...item,
      nameKana: c.nameKana || item.nameKana,
      office: (asOfOffice === 'ー' ? '' : asOfOffice) || item.office,
      location: kyoten || item.location,
      careOffice: (asOfCareOffice === 'ー' ? '' : asOfCareOffice) || item.careOffice,
      welfareRecipient: asOfPayment === '生保',
      ...mergedDates,
    };
  });
}

// 変更情報の参照開始日（これ以降の「新規」レコードのみを追加トリガーとする）
const RECEIPT_CHECK_START_DATE = '2026-02-01';

export function generateReceiptCheckFromClients(
  clients: Client[],
  month: string,
  office: string,
  baseClients?: Client[],
  asOfBasis: AsOfBasis = 'end'
): ReceiptCheckItem[] {
  const [year, mon] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;

  // ベースデータMap（insuranceRentalOverride=trueの場合でもベースの介護保険レンタルを確認するため）
  const baseClientMap = baseClients ? new Map(baseClients.map(c => [c.aozoraId, c])) : null;

  return clients
    .filter(c => {
      // 強制除外（receiptCheckTarget === false）
      if (c.receiptCheckTarget === false) return false;

      // 強制追加（receiptCheckTarget === true）: A~D条件・その他フィルタを全スキップ
      if (c.receiptCheckTarget === true) return true;

      // ===== 以下は receiptCheckTarget === undefined（自動判定）の場合のみ =====

      // 福祉用具利用者でない場合は除外
      if (!c.isWelfareEquipmentUser) return false;

      // 事業所フィルタ（「全事業所」の場合は全員対象）
      if (office !== '全事業所' && c.office !== office) return false;

      // ベースデータの用具リスト（insuranceRentalOverride=trueで消えた介護保険レンタルを復元）
      const baseC = baseClientMap?.get(c.aozoraId);
      const allEquipment = [...(c.selectedEquipment || []), ...(baseC?.selectedEquipment || [])];

      // 「新規」判定はハイブリッド方式（getEffectiveNewRecords参照）:
      // 施設入居記録がある利用者は施設入居新規のみ、無い利用者はTab4「新規」のみを見る
      const effectiveNewRecords = getEffectiveNewRecords(c.changeRecords || []);

      // 追加条件A: 2026-02以降に請求開始日がある「新規」変更情報（新規利用者の自動追加）
      const hasNewAfterStart = effectiveNewRecords.some(r =>
        r.billingStartDateNew &&
        r.billingStartDateNew >= RECEIPT_CHECK_START_DATE &&
        r.billingStartDateNew <= monthEnd
      );

      // 追加条件B: 介護保険レンタルあり（期間問わず、ベースデータも含む）＋新規変更情報あり
      // ※insuranceRentalOverride=trueの場合もベースデータから判定する
      const hasAnyInsuranceRental = allEquipment.some(eq => eq.status === '介護保険レンタル');
      const hasAnyNewRecord = effectiveNewRecords.some(r => r.billingStartDateNew);
      const hasExistingInsuranceUser = hasAnyInsuranceRental && hasAnyNewRecord;

      // 追加条件C: selectedEquipmentなし（カイポケ未インポート）＋2025年以降の新規レコードあり
      // ※カイポケインポート前の新規利用者（大渕勝子さん等）を救済
      const hasPendingNew2025 = !c.selectedEquipment?.length && !baseC?.selectedEquipment?.length &&
        effectiveNewRecords.some(r =>
          r.billingStartDateNew &&
          r.billingStartDateNew >= '2025-01-01'
        );

      // 追加条件D: isWelfareEquipmentUser=true ＋ 前月以降に有効な介護保険レンタルあり（ベースデータも含む）
      // ※Kintone連携以前からの旧来利用者（changeRecords=0）を救済
      // ※カイポケは月次インポートで前月末endDateを設定する（2月インポート前は全entry=1月末）ため、
      //   endDate >= 前月初 で判定し、カイポケ未インポート月の利用者を取りこぼさない
      const prevYear = mon === 1 ? year - 1 : year;
      const prevMonth = mon === 1 ? 12 : mon - 1;
      const prevMonthStart = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      const hasActiveInsuranceRental = allEquipment.some(eq =>
        eq.status === '介護保険レンタル' &&
        (!eq.endDate || eq.endDate >= prevMonthStart)
      );
      const hasPendingNewD = c.isWelfareEquipmentUser === true && !!hasActiveInsuranceRental;

      if (!hasNewAfterStart && !hasExistingInsuranceUser && !hasPendingNew2025 && !hasPendingNewD) return false;

      // 当月開始前に解約済みの利用者は除外（ハイブリッド方式・getEffectiveCancelRecords参照）
      const isCancelled = getEffectiveCancelRecords(c.changeRecords || []).some(r =>
        r.billingStopDateCancel &&
        r.billingStopDateCancel < monthStart
      );
      if (isCancelled) return false;

      // 自費レンタルのみの利用者を除外（ベースデータ含めて介護保険レンタルが1件もない場合）
      const hasJihiOnly = !hasAnyInsuranceRental &&
        allEquipment.some(eq => eq.status === '自費レンタル' && !eq.deletedAt);
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

      // 新規利用初回日（ハイブリッド方式・getEffectiveNewRecords参照）
      const firstUseDate = getEffectiveNewRecords(c.changeRecords || [])
        .filter(r => r.billingStartDateNew)
        .sort((a, b) => a.billingStartDateNew.localeCompare(b.billingStartDateNew))[0]
        ?.billingStartDateNew || '';

      // 変更情報から入院日・退院日・解約日を抽出（当月複数件はカンマ区切り）
      const rawDates = extractDatesFromChangeRecords(c.changeRecords || [], month);

      // 退院日が該当月より前の場合の処理
      // ・現在退院済み（退院日 >= 入院日）→ 入院日・退院日ともクリア
      // ・退院後に再入院（退院日 < 入院日）→ 再入院日のみ表示、退院日はクリア
      const maxDischarge2 = rawDates.dischargeDate
        ? rawDates.dischargeDate.split(',').map(d => d.trim()).filter(Boolean)
            .reduce((max, d) => (d > max ? d : max))
        : '';
      const maxHospitalization2 = rawDates.hospitalizationDate
        ? rawDates.hospitalizationDate.split(',').map(d => d.trim()).filter(Boolean)
            .reduce((max, d) => (d > max ? d : max))
        : '';
      const { hospitalizationDate, dischargeDate, cancellationDate } =
        (maxDischarge2 && maxDischarge2 < monthStart)
          ? maxDischarge2 >= maxHospitalization2
            ? { ...rawDates, hospitalizationDate: '', dischargeDate: '' }
            : { ...rawDates, hospitalizationDate: maxHospitalization2, dischargeDate: '' }
          : rawDates;

      // 事業所・在宅区分・居宅事業所・生保判定は「選択月の状態」を履歴から引く（無ければ現在値）
      const asOfOffice = getClientAttributeAsOf(c, 'office', month, asOfBasis);
      const asOfLocation = getClientAttributeAsOf(c, 'location', month, asOfBasis);
      const asOfFacility = getClientAttributeAsOf(c, 'facilityName', month, asOfBasis);
      const asOfCareOffice = getClientAttributeAsOf(c, 'careSupportOffice', month, asOfBasis);
      const asOfPayment = getClientAttributeAsOf(c, 'paymentType', month, asOfBasis);

      // 拠点＝入居施設名があれば施設名、無ければ在宅区分（在宅）
      const kyoten = ((asOfFacility === 'ー' ? '' : asOfFacility) || '')
        || (asOfLocation === 'ー' ? '' : asOfLocation);

      return {
        aozoraId: c.aozoraId,
        clientName: c.name,
        nameKana: c.nameKana,
        office: (asOfOffice === 'ー' ? '' : asOfOffice) || c.office,
        units,
        provisionTicketReceived: false,
        unitsDifference: false,
        changedFromLastMonth: false,
        kaipokePlanCreated: false,
        welfareRecipient: asOfPayment === '生保',
        welfareCareTicket: false,
        firstUseDate,
        hospitalizationDate,
        dischargeDate,
        cancellationDate,
        reflectedFromManagement: false,
        performanceReport: false,
        delayed: false,
        location: kyoten,
        careOffice: (asOfCareOffice === 'ー' ? '' : asOfCareOffice)
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
