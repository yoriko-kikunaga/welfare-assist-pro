import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteField,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { reconcileForSave, confKey, ConfirmedSet, LockViolation } from './salesLock';
import { db } from '../firebaseConfig';
import {
  Client,
  Equipment,
  KeyPerson,
  ReconciliationDocument,
  SalesType,
  WholesaleCompany,
  InvoiceConfirmationData,
  ReconciliationSummaryV2,
  SalesConfirmationStatus,
  OcrNameMapping,
  InvoiceItem
} from '../../types';
import type { MeetingRecord as Meeting, ClientChangeRecord as ChangeRecord } from '../../types';

export interface ClientEdits {
  aozoraId: string;
  clientName?: string;
  office?: string;
  facilityName?: string;
  roomNumber?: string;
  careSupportOffice?: string;
  careManager?: string;
  careLevel?: string;
  copayRate?: string;
  insuranceCardStatus?: string;
  burdenProportionCertificateStatus?: string;
  paymentType?: string;
  billingCategory?: string;
  kaipokeRegistrationStatus?: string;
  meetings?: Meeting[];
  changeRecords?: ChangeRecord[];
  plannedEquipment?: Equipment[];
  selectedEquipment?: Equipment[];
  keyPerson?: KeyPerson;
  location?: string;
  medicalHistory?: string;
  isWelfareEquipmentUser?: boolean;
  receiptCheckTarget?: boolean;         // レセプトチェック対象フラグ
  insuranceRentalBillingTotal?: number; // 給付対象金額（利用者請求CSVから）
  documents?: import('../../types').ClientDocument[]; // 書類管理
  attributeHistory?: import('../../types').AttributeHistoryEntry[]; // 基本情報の変更履歴
  updatedAt?: Timestamp;
  updatedBy?: string;
}

const CLIENT_EDITS_COLLECTION = 'clientEdits';
const RECONCILIATIONS_COLLECTION = 'reconciliations';
const SYSTEM_SETTINGS_COLLECTION = 'systemSettings';
const INSURANCE_RENTAL_OVERRIDE_DOC = 'insuranceRentalOverride';
// Firestore 1MB 制限対策: 大容量フィールドは別ドキュメントへ分離
const ITEMS_SUFFIX = '_items';    // invoiceConfirmation[company].items[]
const RESULTS_SUFFIX = '_results'; // summary.results[]

/**
 * Interface for insurance rental override settings
 */
interface InsuranceRentalOverride {
  isOverridden: boolean;
  clearedAt?: Timestamp;
  clearedBy?: string;
}

/**
 * Check if running in E2E test mode
 */
function isE2ETestMode(): boolean {
  return typeof window !== 'undefined' && window.location.search.includes('e2e_test_mode=true');
}

/**
 * Check if insurance rental has been overridden (cleared or imported via CSV)
 */
export async function isInsuranceRentalOverridden(): Promise<boolean> {
  if (isE2ETestMode()) {
    return false;
  }

  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, INSURANCE_RENTAL_OVERRIDE_DOC);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data() as InsuranceRentalOverride;
      return data.isOverridden === true;
    }
    return false;
  } catch (error) {
    console.error('Error checking insurance rental override:', error);
    return false;
  }
}

/**
 * Set insurance rental override flag
 */
export async function setInsuranceRentalOverride(
  isOverridden: boolean,
  userEmail: string
): Promise<void> {
  if (isE2ETestMode()) {
    return;
  }

  try {
    const docRef = doc(db, SYSTEM_SETTINGS_COLLECTION, INSURANCE_RENTAL_OVERRIDE_DOC);
    await setDoc(docRef, {
      isOverridden,
      clearedAt: serverTimestamp(),
      clearedBy: userEmail,
    });
    console.log(`✓ [setInsuranceRentalOverride] Set override to ${isOverridden}`);
  } catch (error) {
    console.error('Error setting insurance rental override:', error);
    throw error;
  }
}

// 確定済み売上(自費レンタル/販売)の月集合キャッシュ（事業所別・短期TTL）
const _confirmedCache = new Map<string, { at: number; set: ConfirmedSet }>();
const CONFIRMED_TTL_MS = 60_000;

/**
 * 指定事業所（＋全事業所）で確定済みの (salesType, YYYY-MM) 集合を取得。
 * reconciliations の office フィールドでクエリし、売上確定 or 月次確定済みを確定とみなす。
 */
async function loadConfirmedSet(office?: string): Promise<ConfirmedSet> {
  const offices = Array.from(new Set([office, '全事業所'].filter(Boolean))) as string[];
  const merged: ConfirmedSet = new Set();
  for (const o of offices) {
    const cached = _confirmedCache.get(o);
    if (cached && Date.now() - cached.at < CONFIRMED_TTL_MS) {
      cached.set.forEach(k => merged.add(k));
      continue;
    }
    const set: ConfirmedSet = new Set();
    try {
      const q = query(collection(db, RECONCILIATIONS_COLLECTION), where('office', '==', o));
      const snap = await getDocs(q);
      snap.forEach(d => {
        const data = d.data() as ReconciliationDocument;
        const m = data.billingMonth;
        if (!m) return;
        (['自費レンタル', '販売'] as SalesType[]).forEach(t => {
          const confirmed = data.salesConfirmation?.[t]?.status === 'confirmed' || data.monthlyStatus === 'confirmed';
          if (confirmed) set.add(confKey(t, m));
        });
      });
    } catch (e) {
      console.error('[loadConfirmedSet] error for office', o, e);
    }
    _confirmedCache.set(o, { at: Date.now(), set });
    set.forEach(k => merged.add(k));
  }
  return merged;
}

/**
 * 確定済み売上(自費レンタル/販売)の月集合を取得（UIのロック表示用に公開）。
 * 内部の loadConfirmedSet（60秒キャッシュ）を利用する。
 */
export async function getConfirmedSalesSet(office?: string): Promise<ConfirmedSet> {
  if (isE2ETestMode()) return new Set();
  return loadConfirmedSet(office);
}

/**
 * Save client edits to Firestore
 */
export interface SaveClientEditsResult {
  violations: LockViolation[];
  selectedEquipment: Equipment[];
}

export async function saveClientEdits(
  client: Client,
  userEmail: string
): Promise<SaveClientEditsResult> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping saveClientEdits');
    return { violations: [], selectedEquipment: client.selectedEquipment || [] };
  }

  let violations: LockViolation[] = [];
  try {
    const docRef = doc(db, CLIENT_EDITS_COLLECTION, client.aozoraId);

    // --- 確定済み売上の保護＋クロバー防止 ---
    // 確定済み月の自費/販売レコードが、保存配列から消える/金額改変されるのを差し戻す。
    // （setDoc 完全上書きで黙って消える根本バグ対策。エラー時は fail-open で通常保存。）
    let safeSelected = client.selectedEquipment || [];
    try {
      const confirmed = await loadConfirmedSet(client.office);
      if (confirmed.size > 0) {
        const currentSnap = await getDoc(docRef);
        const currentSelected = (currentSnap.exists() ? (currentSnap.data() as ClientEdits).selectedEquipment : undefined) || [];
        if (currentSelected.length > 0) {
          const result = reconcileForSave(currentSelected, safeSelected, confirmed);
          violations = result.violations;
          if (violations.length > 0) {
            console.warn(`[saveClientEdits] 確定済み保護を適用 (${client.aozoraId}):`, violations);
            safeSelected = result.merged;
          }
        }
      }
    } catch (guardErr) {
      console.error('[saveClientEdits] 確定済み保護ガードでエラー（通常保存を継続）:', guardErr);
    }

    const edits: ClientEdits = {
      aozoraId: client.aozoraId,
      clientName: client.name,
      office: client.office,
      facilityName: client.facilityName || '',
      roomNumber: client.roomNumber || '',
      careSupportOffice: client.careSupportOffice || '',
      careManager: client.careManager || '',
      careLevel: client.careLevel,
      copayRate: client.copayRate,
      insuranceCardStatus: client.insuranceCardStatus,
      burdenProportionCertificateStatus: client.burdenProportionCertificateStatus,
      paymentType: client.paymentType,
      billingCategory: client.billingCategory,
      kaipokeRegistrationStatus: client.kaipokeRegistrationStatus,
      meetings: client.meetings || [],
      changeRecords: client.changeRecords || [],
      plannedEquipment: client.plannedEquipment || [],
      selectedEquipment: safeSelected,
      keyPerson: client.keyPerson,
      location: client.location || '',
      medicalHistory: client.medicalHistory || '',
      isWelfareEquipmentUser: client.isWelfareEquipmentUser || false,
      ...(client.receiptCheckTarget !== undefined ? { receiptCheckTarget: client.receiptCheckTarget } : {}),
      ...(client.insuranceRentalBillingTotal !== undefined ? { insuranceRentalBillingTotal: client.insuranceRentalBillingTotal } : {}),
      documents: client.documents || [],
      attributeHistory: client.attributeHistory || [],
      updatedAt: serverTimestamp() as Timestamp,
      updatedBy: userEmail
    };

    console.log(`[saveClientEdits] Preparing to save client ${client.aozoraId}:`, {
      meetings: edits.meetings.length,
      changeRecords: edits.changeRecords.length,
      plannedEquipment: edits.plannedEquipment.length,
      selectedEquipment: edits.selectedEquipment.length,
      userEmail
    });

    await setDoc(docRef, stripUndefined(edits));

    console.log(`✓ [saveClientEdits] Successfully saved edits for client ${client.aozoraId} to Firestore`);
    return { violations, selectedEquipment: safeSelected };
  } catch (error) {
    console.error(`❌ [saveClientEdits] Error saving client ${client.aozoraId} to Firestore:`, error);
    throw error;
  }
}

/**
 * Get client edits from Firestore
 */
export async function getClientEdits(aozoraId: string): Promise<ClientEdits | null> {
  try {
    const docRef = doc(db, CLIENT_EDITS_COLLECTION, aozoraId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docSnap.data() as ClientEdits;
    }
    return null;
  } catch (error) {
    console.error(`Error getting client edits for ${aozoraId}:`, error);
    return null;
  }
}

/**
 * Get all client edits from Firestore
 */
export async function getAllClientEdits(): Promise<Map<string, ClientEdits>> {
  // Return empty map in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - returning empty edits map');
    return new Map();
  }

  try {
    const editsMap = new Map<string, ClientEdits>();
    const querySnapshot = await getDocs(collection(db, CLIENT_EDITS_COLLECTION));

    querySnapshot.forEach((doc) => {
      const data = doc.data() as ClientEdits;
      editsMap.set(doc.id, data);
    });

    console.log(`✓ Loaded ${editsMap.size} client edits from Firestore`);
    return editsMap;
  } catch (error) {
    console.error('Error getting all client edits:', error);
    return new Map();
  }
}

/**
 * Merge client edits from Firestore into base client data
 *
 * Important: Equipment arrays are MERGED (not replaced) to combine:
 * - Base data: 介護保険レンタル from service check sheet import
 * - Firestore edits: User-added items (販売, 自費レンタル, etc.)
 *
 * When insuranceRentalOverridden is true, base insurance rental data is ignored
 */
export function mergeClientEdits(
  baseClient: Client,
  edits: ClientEdits | null,
  insuranceRentalOverridden: boolean = false
): Client {
  if (!edits) {
    // Even without edits, if override is set, filter out base insurance rental
    if (insuranceRentalOverridden) {
      return {
        ...baseClient,
        selectedEquipment: (baseClient.selectedEquipment || []).filter(
          eq => eq.status !== '介護保険レンタル'
        ),
      };
    }
    return baseClient;
  }

  // Merge selectedEquipment from both sources, avoiding duplicates
  const mergedSelectedEquipment = mergeEquipmentArrays(
    baseClient.selectedEquipment || [],
    edits.selectedEquipment || [],
    insuranceRentalOverridden
  );

  // Merge plannedEquipment from both sources
  const mergedPlannedEquipment = mergeEquipmentArrays(
    baseClient.plannedEquipment || [],
    edits.plannedEquipment || [],
    false // plannedEquipment doesn't need insurance rental override
  );

  // Merge changeRecords: Kintone records from base, manual records from Firestore
  const mergedChangeRecords = mergeChangeRecords(
    baseClient.changeRecords || [],
    edits.changeRecords || []
  );

  return {
    ...baseClient,
    office: edits.office || baseClient.office,
    facilityName: edits.facilityName !== undefined ? edits.facilityName : baseClient.facilityName,
    roomNumber: edits.roomNumber !== undefined ? edits.roomNumber : baseClient.roomNumber,
    careSupportOffice: edits.careSupportOffice !== undefined ? edits.careSupportOffice : baseClient.careSupportOffice,
    careManager: edits.careManager !== undefined ? edits.careManager : baseClient.careManager,
    careLevel: edits.careLevel !== undefined ? edits.careLevel : baseClient.careLevel,
    copayRate: edits.copayRate !== undefined ? edits.copayRate : baseClient.copayRate,
    insuranceCardStatus: edits.insuranceCardStatus !== undefined ? edits.insuranceCardStatus : baseClient.insuranceCardStatus,
    burdenProportionCertificateStatus: edits.burdenProportionCertificateStatus !== undefined ? edits.burdenProportionCertificateStatus : baseClient.burdenProportionCertificateStatus,
    paymentType: edits.paymentType !== undefined ? edits.paymentType : baseClient.paymentType,
    billingCategory: edits.billingCategory !== undefined ? edits.billingCategory : baseClient.billingCategory,
    kaipokeRegistrationStatus: edits.kaipokeRegistrationStatus || baseClient.kaipokeRegistrationStatus,
    meetings: (edits.meetings?.length ? edits.meetings : baseClient.meetings) || [],
    changeRecords: mergedChangeRecords,
    plannedEquipment: mergedPlannedEquipment,
    selectedEquipment: mergedSelectedEquipment,
    keyPerson: edits.keyPerson || baseClient.keyPerson,
    location: edits.location !== undefined ? edits.location : (baseClient.location || ''),
    medicalHistory: edits.medicalHistory || baseClient.medicalHistory || '',
    isWelfareEquipmentUser: edits.isWelfareEquipmentUser !== undefined ? edits.isWelfareEquipmentUser : baseClient.isWelfareEquipmentUser,
    receiptCheckTarget: edits.receiptCheckTarget,  // undefined=自動判定, true=強制追加, false=強制除外
    insuranceRentalBillingTotal: edits.insuranceRentalBillingTotal,  // 給付対象金額
    documents: edits.documents || baseClient.documents || [],
    attributeHistory: edits.attributeHistory || baseClient.attributeHistory || [],
  };
}

/**
 * Merge changeRecords from base (clients.json) and Firestore
 * - Kintone records (id starts with "kintone-"): Always use base data (latest from Kintone sync)
 * - Manual records: Keep from Firestore if not in base
 */
function mergeChangeRecords(baseRecords: ChangeRecord[], firestoreRecords: ChangeRecord[]): ChangeRecord[] {
  // Start with all base records (includes latest Kintone data)
  const merged: ChangeRecord[] = [...baseRecords];
  const baseIds = new Set(baseRecords.map(r => r.id));

  // Add manual records from Firestore that are not in base
  firestoreRecords.forEach(firestoreRecord => {
    // Skip if already in base (by ID)
    if (baseIds.has(firestoreRecord.id)) return;

    // Skip Kintone records from Firestore (base has latest)
    if (firestoreRecord.id.startsWith('kintone-')) return;

    // Add manual record from Firestore
    merged.push(firestoreRecord);
  });

  return merged;
}

/**
 * Merge two equipment arrays, avoiding duplicates based on id or name+status
 * When duplicates exist, Firestore fields (user edits) take precedence
 *
 * IMPORTANT: 介護保険レンタルの洗い替え処理
 * - FirestoreにANYの介護保険レンタルがある場合、ベースデータの介護保険レンタルは全て無視
 * - insuranceRentalOverriddenフラグがtrueの場合も、ベースデータの介護保険レンタルは全て無視
 * - これにより、CSVインポートやクリア後に完全に置き換えられる
 */
function mergeEquipmentArrays(
  baseEquipment: Equipment[],
  firestoreEquipment: Equipment[],
  insuranceRentalOverridden: boolean = false
): Equipment[] {
  // Check if Firestore has any insurance rental OR if override flag is set
  const firestoreHasInsuranceRental = firestoreEquipment.some(eq => eq.status === '介護保険レンタル');
  const skipBaseInsuranceRental = firestoreHasInsuranceRental || insuranceRentalOverridden;

  // Create a map of Firestore equipment by key for quick lookup
  const firestoreMap = new Map<string, Equipment>();
  firestoreEquipment.forEach(eq => {
    const key = eq.id || `${eq.name}|${eq.status}`;
    firestoreMap.set(key, eq);
  });

  // baseEquipment 側で id 重複（Google Sheets取込ミス等で同じidが複数ある場合）を除去
  //   → 同じidが複数あると merge.map の繰り返しで重複が画面に出てしまう
  //   → 先勝ち（最初の1件）を採用
  const seenBaseIds = new Set<string>();
  const dedupedBase: Equipment[] = [];
  for (const baseEq of baseEquipment) {
    const dedupKey = baseEq.id || `${baseEq.name}|${baseEq.status}|${baseEq.startDate || ''}`;
    if (seenBaseIds.has(dedupKey)) continue;
    seenBaseIds.add(dedupKey);
    dedupedBase.push(baseEq);
  }

  // Merge base equipment with Firestore overrides
  // If Firestore has insurance rental or override is set, skip all base insurance rental (洗い替え)
  const merged: Equipment[] = dedupedBase
    .filter(baseEq => {
      // Skip base insurance rental if override is active
      if (skipBaseInsuranceRental && baseEq.status === '介護保険レンタル') {
        return false;
      }
      return true;
    })
    .map(baseEq => {
      const key = baseEq.id || `${baseEq.name}|${baseEq.status}`;
      const firestoreEq = firestoreMap.get(key);

      if (firestoreEq) {
        // Merge: base fields + Firestore user-edited fields override
        firestoreMap.delete(key); // Mark as processed
        return {
          ...baseEq,
          ...firestoreEq,
          // Preserve base fields that shouldn't be overwritten by empty Firestore values
          name: firestoreEq.name || baseEq.name,
          category: firestoreEq.category || baseEq.category,
          status: firestoreEq.status || baseEq.status,
          startDate: firestoreEq.startDate || baseEq.startDate,
          endDate: firestoreEq.endDate || baseEq.endDate,
        };
      }
      return baseEq;
    });

  // Add remaining Firestore-only equipment (not in base)
  firestoreMap.forEach(eq => {
    merged.push(eq);
  });

  return merged;
}

/**
 * Merge all client edits into base clients array
 *
 * @param insuranceRentalOverridden - If true, base insurance rental data is ignored
 */
export function mergeAllClientEdits(
  baseClients: Client[],
  editsMap: Map<string, ClientEdits>,
  insuranceRentalOverridden: boolean = false
): Client[] {
  return baseClients.map(client => {
    const edits = editsMap.get(client.aozoraId);
    return mergeClientEdits(client, edits, insuranceRentalOverridden);
  });
}

// ===== Reconciliation (売上・仕入突合) Functions =====

/**
 * Generate document ID for reconciliation
 */
function getReconciliationDocId(month: string, office: string): string {
  return `${month}_${office}`;
}

/**
 * Get reconciliation document from Firestore
 */
export async function getReconciliation(
  month: string,
  office: string
): Promise<ReconciliationDocument | null> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping getReconciliation');
    return null;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const itemsRef = doc(db, RECONCILIATIONS_COLLECTION, docId + ITEMS_SUFFIX);
    const resultsRef = doc(db, RECONCILIATIONS_COLLECTION, docId + RESULTS_SUFFIX);
    const [docSnap, itemsSnap, resultsSnap] = await Promise.all([
      getDoc(docRef),
      getDoc(itemsRef),
      getDoc(resultsRef),
    ]);

    if (docSnap.exists()) {
      const data = docSnap.data();
      // 別ドキュメントに分離した items を復元
      const itemsData: Record<string, InvoiceItem[]> = itemsSnap.exists()
        ? (itemsSnap.data() as Record<string, InvoiceItem[]>)
        : {};
      // 別ドキュメントに分離した results を復元
      const savedResults: ReconciliationSummaryV2['results'] | undefined =
        resultsSnap.exists() ? (resultsSnap.data() as { results: ReconciliationSummaryV2['results'] }).results : undefined;

      // Convert Firestore Timestamps to Dates
      return {
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || new Date(),
        monthlyConfirmedAt: data.monthlyConfirmedAt?.toDate?.(),
        salesConfirmation: {
          '介護保険レンタル': {
            ...data.salesConfirmation?.['介護保険レンタル'],
            confirmedAt: data.salesConfirmation?.['介護保険レンタル']?.confirmedAt?.toDate?.()
          },
          '自費レンタル': {
            ...data.salesConfirmation?.['自費レンタル'],
            confirmedAt: data.salesConfirmation?.['自費レンタル']?.confirmedAt?.toDate?.()
          },
          '販売': {
            ...data.salesConfirmation?.['販売'],
            confirmedAt: data.salesConfirmation?.['販売']?.confirmedAt?.toDate?.()
          }
        },
        invoiceConfirmation: Object.fromEntries(
          Object.entries(data.invoiceConfirmation || {}).map(([key, value]) => [
            key,
            {
              ...(value as InvoiceConfirmationData),
              items: itemsData[key] || (value as InvoiceConfirmationData).items || [],
              confirmedAt: (value as { confirmedAt?: { toDate?: () => Date } }).confirmedAt?.toDate?.()
            }
          ])
        ),
        ...(data.summary && savedResults ? { summary: { ...data.summary, results: savedResults } } : {}),
      } as ReconciliationDocument;
    }
    return null;
  } catch (error) {
    console.error(`Error getting reconciliation for ${month}/${office}:`, error);
    return null;
  }
}

/**
 * Create or get default reconciliation document
 */
function createDefaultReconciliationDoc(month: string, office: string, userEmail: string): ReconciliationDocument {
  const defaultConfirmation: SalesConfirmationStatus = { status: 'draft' as const, count: 0, amount: 0 };
  return {
    billingMonth: month,
    office,
    salesConfirmation: {
      '介護保険レンタル': { ...defaultConfirmation },
      '自費レンタル': { ...defaultConfirmation },
      '販売': { ...defaultConfirmation }
    },
    invoiceConfirmation: {},
    monthlyStatus: 'draft' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: userEmail
  };
}

/**
 * Save invoice data to Firestore (on upload)
 */
export async function saveInvoiceData(
  month: string,
  office: string,
  company: WholesaleCompany,
  data: InvoiceConfirmationData,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping saveInvoiceData');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const itemsRef = doc(db, RECONCILIATIONS_COLLECTION, docId + ITEMS_SUFFIX);
    const docSnap = await getDoc(docRef);

    let reconciliationDoc: ReconciliationDocument;
    if (docSnap.exists()) {
      reconciliationDoc = docSnap.data() as ReconciliationDocument;
    } else {
      reconciliationDoc = createDefaultReconciliationDoc(month, office, userEmail);
    }

    // items[] は別ドキュメントへ（1MB 制限対策）
    const { items, ...dataWithoutItems } = data;
    reconciliationDoc.invoiceConfirmation[company] = { ...dataWithoutItems, items: [] };
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    // items を _items ドキュメントに保存（会社ごとにマージ）
    const itemsSnap = await getDoc(itemsRef);
    const existingItems = itemsSnap.exists() ? (itemsSnap.data() as Record<string, InvoiceItem[]>) : {};
    await Promise.all([
      setDoc(docRef, reconciliationDoc),
      setDoc(itemsRef, { ...existingItems, [company]: items }),
    ]);
    console.log(`✓ [saveInvoiceData] Saved invoice data for ${company} in ${month}/${office}`);
  } catch (error) {
    console.error(`Error saving invoice data for ${company}:`, error);
    throw error;
  }
}

/**
 * Clear invoice data for a specific company
 */
export async function clearInvoiceData(
  month: string,
  office: string,
  company: WholesaleCompany,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping clearInvoiceData');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return; // Nothing to clear
    }

    const itemsRef = doc(db, RECONCILIATIONS_COLLECTION, docId + ITEMS_SUFFIX);
    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    delete reconciliationDoc.invoiceConfirmation[company];
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    // _items ドキュメントからも該当会社を削除
    const itemsSnap = await getDoc(itemsRef);
    const saves: Promise<void>[] = [setDoc(docRef, reconciliationDoc)];
    if (itemsSnap.exists()) {
      const existingItems = itemsSnap.data() as Record<string, InvoiceItem[]>;
      delete existingItems[company];
      saves.push(setDoc(itemsRef, existingItems));
    }
    await Promise.all(saves);
    console.log(`✓ [clearInvoiceData] Cleared invoice data for ${company} in ${month}/${office}`);
  } catch (error) {
    console.error(`Error clearing invoice data for ${company}:`, error);
    throw error;
  }
}

/**
 * Confirm sales for a specific type
 */
export async function confirmSales(
  month: string,
  office: string,
  salesType: SalesType,
  count: number,
  amount: number,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping confirmSales');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    let reconciliationDoc: ReconciliationDocument;
    if (docSnap.exists()) {
      reconciliationDoc = docSnap.data() as ReconciliationDocument;
    } else {
      reconciliationDoc = createDefaultReconciliationDoc(month, office, userEmail);
    }

    reconciliationDoc.salesConfirmation[salesType] = {
      status: 'confirmed' as const,
      confirmedAt: new Date(),
      confirmedBy: userEmail,
      count,
      amount
    };
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
    console.log(`✓ [confirmSales] Confirmed ${salesType} sales in ${month}/${office}`);
  } catch (error) {
    console.error(`Error confirming sales for ${salesType}:`, error);
    throw error;
  }
}

/**
 * Unconfirm sales for a specific type
 */
export async function unconfirmSales(
  month: string,
  office: string,
  salesType: SalesType,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping unconfirmSales');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return;
    }

    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    reconciliationDoc.salesConfirmation[salesType] = {
      status: 'draft' as const,
      count: 0,
      amount: 0
    };
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
    console.log(`✓ [unconfirmSales] Unconfirmed ${salesType} sales in ${month}/${office}`);
  } catch (error) {
    console.error(`Error unconfirming sales for ${salesType}:`, error);
    throw error;
  }
}

/**
 * Confirm invoice for a specific company
 */
export async function confirmInvoice(
  month: string,
  office: string,
  company: WholesaleCompany,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping confirmInvoice');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error(`No reconciliation document found for ${month}/${office}`);
    }

    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    const invoiceData = reconciliationDoc.invoiceConfirmation[company];

    if (!invoiceData) {
      throw new Error(`No invoice data found for ${company}`);
    }

    reconciliationDoc.invoiceConfirmation[company] = {
      ...invoiceData,
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedBy: userEmail
    };
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
    console.log(`✓ [confirmInvoice] Confirmed ${company} invoice in ${month}/${office}`);
  } catch (error) {
    console.error(`Error confirming invoice for ${company}:`, error);
    throw error;
  }
}

/**
 * Unconfirm invoice for a specific company
 */
export async function unconfirmInvoice(
  month: string,
  office: string,
  company: WholesaleCompany,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping unconfirmInvoice');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return;
    }

    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    const invoiceData = reconciliationDoc.invoiceConfirmation[company];

    if (!invoiceData) {
      return;
    }

    const updatedInvoiceData = { ...invoiceData, status: 'draft' as const };
    delete (updatedInvoiceData as Record<string, unknown>).confirmedAt;
    delete (updatedInvoiceData as Record<string, unknown>).confirmedBy;
    reconciliationDoc.invoiceConfirmation[company] = updatedInvoiceData;
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
    console.log(`✓ [unconfirmInvoice] Unconfirmed ${company} invoice in ${month}/${office}`);
  } catch (error) {
    console.error(`Error unconfirming invoice for ${company}:`, error);
    throw error;
  }
}

/**
 * Remove undefined values recursively from an object for Firestore compatibility
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripUndefined(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = stripUndefined(value);
      }
    }
    return cleaned;
  }
  return obj;
}

/**
 * Confirm monthly reconciliation
 */
export async function confirmMonthly(
  month: string,
  office: string,
  summary: ReconciliationSummaryV2,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping confirmMonthly');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error(`No reconciliation document found for ${month}/${office}`);
    }

    // summary.results は別ドキュメントへ（1MB 制限対策）
    const { results, ...summaryWithoutResults } = summary;
    const resultsRef = doc(db, RECONCILIATIONS_COLLECTION, docId + RESULTS_SUFFIX);
    await Promise.all([
      updateDoc(docRef, {
        monthlyStatus: 'confirmed',
        monthlyConfirmedAt: new Date(),
        monthlyConfirmedBy: userEmail,
        summary: stripUndefined(summaryWithoutResults),
        updatedAt: new Date(),
        updatedBy: userEmail,
      }),
      setDoc(resultsRef, { results: stripUndefined(results) }),
    ]);
    console.log(`✓ [confirmMonthly] Monthly reconciliation confirmed for ${month}/${office}`);
  } catch (error) {
    console.error(`Error confirming monthly reconciliation:`, error);
    throw error;
  }
}

/**
 * Unconfirm monthly reconciliation
 */
export async function unconfirmMonthly(
  month: string,
  office: string,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping unconfirmMonthly');
    return;
  }

  try {
    const docId = getReconciliationDocId(month, office);
    const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return;
    }

    const resultsRef = doc(db, RECONCILIATIONS_COLLECTION, docId + RESULTS_SUFFIX);
    const resultsSnap = await getDoc(resultsRef);
    const unconfirmOps: Promise<void>[] = [
      updateDoc(docRef, {
        monthlyStatus: 'draft',
        monthlyConfirmedAt: deleteField(),
        monthlyConfirmedBy: deleteField(),
        summary: deleteField(),
        updatedAt: new Date(),
        updatedBy: userEmail,
      }),
    ];
    if (resultsSnap.exists()) {
      // deleteDoc は未 import のため空オブジェクトで上書き
      unconfirmOps.push(setDoc(resultsRef, {}));
    }
    await Promise.all(unconfirmOps);
    console.log(`✓ [unconfirmMonthly] Monthly reconciliation unconfirmed for ${month}/${office}`);
  } catch (error) {
    console.error(`Error unconfirming monthly reconciliation:`, error);
    throw error;
  }
}

// ===== 介護保険レンタル利用者別突合 確定機能 =====

/**
 * 介護保険レンタル利用者別突合を会社単位で確定
 */
export async function confirmInsuranceRentalCompany(
  month: string,
  office: string,
  company: string,
  userEmail: string
): Promise<void> {
  const docId = getReconciliationDocId(month, office);
  const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
  await updateDoc(docRef, {
    [`insuranceRentalConfirmation.${company}`]: {
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      confirmedBy: userEmail,
    },
    updatedAt: new Date(),
    updatedBy: userEmail,
  });
}

/**
 * 介護保険レンタル利用者別突合の確定を会社単位で解除
 */
export async function unconfirmInsuranceRentalCompany(
  month: string,
  office: string,
  company: string,
  userEmail: string
): Promise<void> {
  const docId = getReconciliationDocId(month, office);
  const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
  await updateDoc(docRef, {
    [`insuranceRentalConfirmation.${company}`]: {
      status: 'draft',
    },
    updatedAt: new Date(),
    updatedBy: userEmail,
  });
}

// ===== 販売利用者別突合 確定機能 =====

/**
 * 販売利用者別突合を会社単位で確定
 */
export async function confirmSalesCompany(
  month: string,
  office: string,
  company: string,
  userEmail: string
): Promise<void> {
  const docId = getReconciliationDocId(month, office);
  const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
  await updateDoc(docRef, {
    [`salesConfirmation.${company}`]: {
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      confirmedBy: userEmail,
    },
    updatedAt: new Date(),
    updatedBy: userEmail,
  });
}

/**
 * 販売利用者別突合の確定を会社単位で解除
 */
export async function unconfirmSalesCompany(
  month: string,
  office: string,
  company: string,
  userEmail: string
): Promise<void> {
  const docId = getReconciliationDocId(month, office);
  const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
  await updateDoc(docRef, {
    [`salesConfirmation.${company}`]: {
      status: 'draft',
    },
    updatedAt: new Date(),
    updatedBy: userEmail,
  });
}

// ===== 自費レンタル利用者別突合 確定機能 =====

export async function confirmSelfPayRentalCompany(
  month: string,
  office: string,
  company: string,
  userEmail: string
): Promise<void> {
  const docId = getReconciliationDocId(month, office);
  const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
  await updateDoc(docRef, {
    [`selfPayRentalConfirmation.${company}`]: {
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      confirmedBy: userEmail,
    },
    updatedAt: new Date(),
    updatedBy: userEmail,
  });
}

export async function unconfirmSelfPayRentalCompany(
  month: string,
  office: string,
  company: string,
  userEmail: string
): Promise<void> {
  const docId = getReconciliationDocId(month, office);
  const docRef = doc(db, RECONCILIATIONS_COLLECTION, docId);
  await updateDoc(docRef, {
    [`selfPayRentalConfirmation.${company}`]: {
      status: 'draft',
    },
    updatedAt: new Date(),
    updatedBy: userEmail,
  });
}

// ===== OCR Name Mapping (学習データ) Functions =====

const OCR_NAME_MAPPINGS_COLLECTION = 'ocrNameMappings';

/**
 * Get all OCR name mappings from Firestore
 */
export async function getAllOcrNameMappings(): Promise<OcrNameMapping[]> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - returning empty OCR mappings');
    return [];
  }

  try {
    const querySnapshot = await getDocs(collection(db, OCR_NAME_MAPPINGS_COLLECTION));
    const mappings: OcrNameMapping[] = [];

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      mappings.push({
        id: docSnap.id,
        ocrName: data.ocrName,
        ocrNameOriginal: data.ocrNameOriginal,
        aozoraId: data.aozoraId,
        masterName: data.masterName,
        wholesaleCompany: data.wholesaleCompany,
        confidence: data.confidence,
        usageCount: data.usageCount || 1,
        createdAt: data.createdAt?.toDate?.() || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || new Date(),
      });
    });

    console.log(`✓ [getAllOcrNameMappings] Loaded ${mappings.length} OCR name mappings`);
    return mappings;
  } catch (error) {
    console.error('Error getting OCR name mappings:', error);
    return [];
  }
}

/**
 * Get OCR name mappings for a specific wholesale company
 */
export async function getOcrNameMappingsByCompany(
  wholesaleCompany: string
): Promise<OcrNameMapping[]> {
  const allMappings = await getAllOcrNameMappings();
  return allMappings.filter(m => m.wholesaleCompany === wholesaleCompany);
}

/**
 * Save a new OCR name mapping (learning)
 */
export async function saveOcrNameMapping(
  mapping: Omit<OcrNameMapping, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping saveOcrNameMapping');
    return 'test-id';
  }

  try {
    // Generate document ID from ocrName + wholesaleCompany
    const docId = `${mapping.ocrName}_${mapping.wholesaleCompany}`.replace(/[\/\s]/g, '_');
    const docRef = doc(db, OCR_NAME_MAPPINGS_COLLECTION, docId);

    // Check if exists (to update usageCount)
    const existingDoc = await getDoc(docRef);
    const now = new Date();

    if (existingDoc.exists()) {
      // Update existing mapping
      const existingData = existingDoc.data();
      await setDoc(docRef, {
        ...mapping,
        usageCount: (existingData.usageCount || 1) + 1,
        createdAt: existingData.createdAt,
        updatedAt: serverTimestamp(),
      });
      console.log(`✓ [saveOcrNameMapping] Updated mapping: ${mapping.ocrName} → ${mapping.masterName}`);
    } else {
      // Create new mapping
      await setDoc(docRef, {
        ...mapping,
        usageCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log(`✓ [saveOcrNameMapping] Created new mapping: ${mapping.ocrName} → ${mapping.masterName}`);
    }

    return docId;
  } catch (error) {
    console.error('Error saving OCR name mapping:', error);
    throw error;
  }
}

/**
 * Save multiple OCR name mappings at once
 */
export async function saveOcrNameMappings(
  mappings: Omit<OcrNameMapping, 'id' | 'createdAt' | 'updatedAt'>[]
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping saveOcrNameMappings');
    return;
  }

  try {
    for (const mapping of mappings) {
      await saveOcrNameMapping(mapping);
    }
    console.log(`✓ [saveOcrNameMappings] Saved ${mappings.length} OCR name mappings`);
  } catch (error) {
    console.error('Error saving OCR name mappings:', error);
    throw error;
  }
}

/**
 * Delete an OCR name mapping
 */
export async function deleteOcrNameMapping(
  ocrName: string,
  wholesaleCompany: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping deleteOcrNameMapping');
    return;
  }

  try {
    const docId = `${ocrName}_${wholesaleCompany}`.replace(/[\/\s]/g, '_');
    const docRef = doc(db, OCR_NAME_MAPPINGS_COLLECTION, docId);

    // Firestore doesn't have a direct delete, use setDoc with empty or deleteDoc
    // For simplicity, we'll just mark it as deleted by removing the document
    const { deleteDoc } = await import('firebase/firestore');
    await deleteDoc(docRef);

    console.log(`✓ [deleteOcrNameMapping] Deleted mapping: ${ocrName}`);
  } catch (error) {
    console.error('Error deleting OCR name mapping:', error);
    throw error;
  }
}

/**
 * Increment usage count for a mapping (when auto-matched)
 */
export async function incrementMappingUsage(
  ocrName: string,
  wholesaleCompany: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    return;
  }

  try {
    const docId = `${ocrName}_${wholesaleCompany}`.replace(/[\/\s]/g, '_');
    const docRef = doc(db, OCR_NAME_MAPPINGS_COLLECTION, docId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      await setDoc(docRef, {
        ...data,
        usageCount: (data.usageCount || 1) + 1,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    console.error('Error incrementing mapping usage:', error);
    // Don't throw - this is a non-critical operation
  }
}

// ===== Insurance Rental Batch Import Functions =====

/**
 * Save insurance rental equipment batch (洗い替え)
 *
 * 1. Get existing clientEdits for each client
 * 2. Remove all 介護保険レンタル equipment
 * 3. Add new equipment from import
 * 4. Save billing total per client
 * 5. Batch write to Firestore
 */
export async function saveInsuranceRentalBatch(
  equipmentByClient: Map<string, Equipment[]>,
  selectedMonth: string,
  userEmail: string,
  billingByClient?: Map<string, number>,  // Optional: あおぞらID → 給付対象金額
  officeByClient?: Map<string, string>    // Optional: あおぞらID → 事業所（CSVから）
): Promise<{ updatedCount: number; totalEquipmentCount: number }> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping saveInsuranceRentalBatch');
    return { updatedCount: 0, totalEquipmentCount: 0 };
  }

  try {
    let updatedCount = 0;
    let totalEquipmentCount = 0;

    // Process each client
    for (const [aozoraId, newEquipment] of equipmentByClient.entries()) {
      // Get existing clientEdits
      const docRef = doc(db, CLIENT_EDITS_COLLECTION, aozoraId);
      const docSnap = await getDoc(docRef);

      let existingEdits: ClientEdits;
      if (docSnap.exists()) {
        existingEdits = docSnap.data() as ClientEdits;
      } else {
        existingEdits = {
          aozoraId,
          selectedEquipment: [],
        };
      }

      // Remove existing 介護保険レンタル equipment (save propertyAttribute/companyBedItemId by taisCode for carry-over)
      const oldInsuranceEquipment = (existingEdits.selectedEquipment || []).filter(
        eq => eq.status === '介護保険レンタル'
      );
      const oldAttrByCode = new Map<string, { propertyAttribute?: string; companyBedItemId?: string }>();
      oldInsuranceEquipment.forEach(eq => {
        if (eq.taisCode) oldAttrByCode.set(eq.taisCode, { propertyAttribute: eq.propertyAttribute, companyBedItemId: eq.companyBedItemId });
      });

      const nonInsuranceEquipment = (existingEdits.selectedEquipment || []).filter(
        eq => eq.status !== '介護保険レンタル'
      );

      // Carry over propertyAttribute and companyBedItemId from old equipment by taisCode
      const carryOverEquipment = newEquipment.map(eq => {
        const old = eq.taisCode ? oldAttrByCode.get(eq.taisCode) : undefined;
        if (!old) return eq;
        const carried: Equipment = { ...eq };
        if (old.propertyAttribute) carried.propertyAttribute = old.propertyAttribute as Equipment['propertyAttribute'];
        if (old.companyBedItemId) carried.companyBedItemId = old.companyBedItemId;
        return carried;
      });

      // Merge with new equipment
      const mergedEquipment = [...nonInsuranceEquipment, ...carryOverEquipment];

      // Get billing total for this client (if available)
      const billingTotal = billingByClient?.get(aozoraId);

      // Build update object (only include billingTotal if it exists)
      const updateData: Record<string, unknown> = {
        ...existingEdits,
        selectedEquipment: mergedEquipment,
        updatedAt: serverTimestamp(),
        updatedBy: userEmail,
      };

      // Only add billingTotal if it has a value (Firestore doesn't accept undefined)
      if (billingTotal !== undefined) {
        updateData.insuranceRentalBillingTotal = billingTotal;
      }

      // Update client office from CSV data
      const clientOffice = officeByClient?.get(aozoraId);
      if (clientOffice) {
        updateData.office = clientOffice;
      }

      // Update Firestore
      await setDoc(docRef, updateData);

      updatedCount++;
      totalEquipmentCount += newEquipment.length;
    }

    // 当月インポート対象外の利用者に対する後処理
    // (1) endDate なしの介保 eq に前月末を設定（過去インポートの未設定データ救済）
    // (2) `insuranceRentalBillingTotal` が前月の値のまま残存しているのをクリア
    //     → 利用者請求 CSV に当月含まれていないので売上集計対象外。残すと
    //       突合CSVに stale な金額が混入し、行=サマリー整合が崩れる
    //     → ただしインポート対象 office のみに限定（他事業所のデータを誤クリアしない）
    const [year, month] = selectedMonth.split('-').map(Number);
    const prevMonthEnd = new Date(year, month - 1, 0); // last day of previous month
    const prevEndDateStr = `${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, '0')}-${String(prevMonthEnd.getDate()).padStart(2, '0')}`;
    const importedOffices = officeByClient
      ? new Set(Array.from(officeByClient.values()).filter(Boolean) as string[])
      : new Set<string>();

    const allEditsSnap = await getDocs(collection(db, CLIENT_EDITS_COLLECTION));
    let fixedCount = 0;
    let clearedBillingCount = 0;
    for (const docSnap of allEditsSnap.docs) {
      const aozoraId = docSnap.id;
      if (equipmentByClient.has(aozoraId)) continue; // already processed above

      const edits = docSnap.data() as ClientEdits;
      const equipment = edits.selectedEquipment || [];
      const needsEndDateFix = equipment.some(eq => eq.status === '介護保険レンタル' && !eq.endDate);
      // billingTotal クリア対象判定: 値あり、かつ office がインポート対象 office に一致
      // (office 不明な利用者は安全側で対象外とする)
      const needsBillingClear =
        edits.insuranceRentalBillingTotal !== undefined &&
        edits.office !== undefined &&
        importedOffices.has(edits.office);
      if (!needsEndDateFix && !needsBillingClear) continue;

      const updateFields: Record<string, unknown> = {
        updatedAt: serverTimestamp(),
        updatedBy: userEmail,
      };
      if (needsEndDateFix) {
        const fixedEquipment = equipment.map(eq => {
          if (eq.status === '介護保険レンタル' && !eq.endDate) {
            return { ...eq, endDate: prevEndDateStr };
          }
          return eq;
        });
        updateFields.selectedEquipment = fixedEquipment;
        fixedCount++;
      }
      if (needsBillingClear) {
        updateFields.insuranceRentalBillingTotal = deleteField();
        clearedBillingCount++;
      }
      await updateDoc(docSnap.ref, updateFields);
    }
    if (fixedCount > 0) {
      console.log(`✓ [saveInsuranceRentalBatch] Fixed endDate for ${fixedCount} clients with old insurance rental data`);
    }
    if (clearedBillingCount > 0) {
      console.log(`✓ [saveInsuranceRentalBatch] Cleared stale insuranceRentalBillingTotal for ${clearedBillingCount} clients (offices: ${Array.from(importedOffices).join(', ')})`);
    }

    // Set override flag to indicate insurance rental has been imported
    await setInsuranceRentalOverride(true, userEmail);

    console.log(`✓ [saveInsuranceRentalBatch] Updated ${updatedCount} clients with ${totalEquipmentCount} equipment items and set override flag`);
    return { updatedCount, totalEquipmentCount };
  } catch (error) {
    console.error('Error saving insurance rental batch:', error);
    throw error;
  }
}

/**
 * Clear all insurance rental equipment for a specific month
 *
 * Used when re-importing or clearing a month's data
 */
export async function clearInsuranceRentalForMonth(
  affectedAozoraIds: string[],
  userEmail: string
): Promise<number> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping clearInsuranceRentalForMonth');
    return 0;
  }

  try {
    let clearedCount = 0;

    for (const aozoraId of affectedAozoraIds) {
      const docRef = doc(db, CLIENT_EDITS_COLLECTION, aozoraId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) continue;

      const existingEdits = docSnap.data() as ClientEdits;
      const nonInsuranceEquipment = (existingEdits.selectedEquipment || []).filter(
        eq => eq.status !== '介護保険レンタル'
      );

      // Only update if there were insurance rental items to remove
      if (nonInsuranceEquipment.length !== (existingEdits.selectedEquipment || []).length) {
        await setDoc(docRef, {
          ...existingEdits,
          selectedEquipment: nonInsuranceEquipment,
          updatedAt: serverTimestamp(),
          updatedBy: userEmail,
        });
        clearedCount++;
      }
    }

    console.log(`✓ [clearInsuranceRentalForMonth] Cleared insurance rental from ${clearedCount} clients`);
    return clearedCount;
  } catch (error) {
    console.error('Error clearing insurance rental:', error);
    throw error;
  }
}

/**
 * Clear ALL insurance rental equipment from ALL clients in Firestore
 *
 * Used to reset all insurance rental data before a fresh import
 * Also sets the override flag to hide base data insurance rental
 */
export async function clearAllInsuranceRental(
  userEmail: string
): Promise<number> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping clearAllInsuranceRental');
    return 0;
  }

  try {
    let clearedCount = 0;
    const querySnapshot = await getDocs(collection(db, CLIENT_EDITS_COLLECTION));

    for (const docSnap of querySnapshot.docs) {
      const existingEdits = docSnap.data() as ClientEdits;
      const currentEquipment = existingEdits.selectedEquipment || [];
      const nonInsuranceEquipment = currentEquipment.filter(
        eq => eq.status !== '介護保険レンタル'
      );

      // Only update if there were insurance rental items to remove
      if (nonInsuranceEquipment.length !== currentEquipment.length) {
        const docRef = doc(db, CLIENT_EDITS_COLLECTION, docSnap.id);
        await setDoc(docRef, {
          ...existingEdits,
          selectedEquipment: nonInsuranceEquipment,
          updatedAt: serverTimestamp(),
          updatedBy: userEmail,
        });
        clearedCount++;
      }
    }

    // Set override flag to hide base data insurance rental
    await setInsuranceRentalOverride(true, userEmail);

    console.log(`✓ [clearAllInsuranceRental] Cleared insurance rental from ${clearedCount} clients and set override flag`);
    return clearedCount;
  } catch (error) {
    console.error('Error clearing all insurance rental:', error);
    throw error;
  }
}
