import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  EquipmentItem,
  EquipmentItemStatus,
  EquipmentItemType,
  EquipmentLog,
  EquipmentSet,
  EquipmentUsageHistory,
  CleaningRecord,
  UsageType,
  MigrationOptions,
  BedInventoryItem,
  OfficeLocation,
} from '../../types';

const EQUIPMENT_COLLECTION = 'equipments';
const EQUIPMENT_LOGS_COLLECTION = 'equipmentLogs';
const EQUIPMENT_SETS_COLLECTION = 'equipmentSets';

// ===== 状態遷移ロジック =====

const ALLOWED_BY_USAGE: Record<UsageType, EquipmentItemStatus[]> = {
  '介護保険': ['介護保険貸与にて使用', 'クリーニング前', 'クリーニング中', '倉庫保管', '事務所保管', '施設物品', '破棄済み'],
  '自費':     ['自費にて使用', 'クリーニング前', 'クリーニング中', '倉庫保管', '事務所保管', '施設物品', '破棄済み'],
  '販売':     ['倉庫保管', '事務所保管', '破棄済み', '販売済み'],
  '施設物品': ['施設物品', '倉庫保管', '事務所保管', '破棄済み'],
  '使用不可': ['倉庫保管', '事務所保管', '破棄済み'],
};

const ALLOWED_BY_STATUS: Record<string, EquipmentItemStatus[]> = {
  '__initial__':          ['倉庫保管', '事務所保管'],
  '倉庫保管':             ['介護保険貸与にて使用', '販売済み', '自費にて使用', '施設物品', '破棄済み'],
  '事務所保管':           ['介護保険貸与にて使用', '販売済み', '自費にて使用', '施設物品', '破棄済み'],
  '介護保険貸与にて使用': ['倉庫保管', '事務所保管', 'クリーニング前'],
  '自費にて使用':         ['倉庫保管', '事務所保管', 'クリーニング前'],
  '販売済み':             ['倉庫保管', '事務所保管', 'クリーニング前'],
  '施設物品':             ['倉庫保管', '事務所保管', 'クリーニング前'],
  'クリーニング前':       ['クリーニング中'],
  'クリーニング中':       ['倉庫保管', '事務所保管', '破棄済み'],
  '破棄済み':             [],
};

export function getAllowedNextStatuses(
  currentStatus: EquipmentItemStatus | null,
  usageType: UsageType
): EquipmentItemStatus[] {
  const key = currentStatus ?? '__initial__';
  const fromCurrent = ALLOWED_BY_STATUS[key] ?? [];
  const fromUsage = ALLOWED_BY_USAGE[usageType] ?? [];
  return fromCurrent.filter(s => fromUsage.includes(s));
}

// ===== ヘルパー =====

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      !(value instanceof Timestamp)
    ) {
      result[key] = stripUndefined(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserializeEquipmentItem(id: string, data: Record<string, any>): EquipmentItem {
  return {
    ...data,
    id,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
    cleaningHistory: data.cleaningHistory || [],
    usageHistory: data.usageHistory || [],
    depreciationMonths: data.depreciationMonths ?? 12,
  } as EquipmentItem;
}

// ===== CRUD: EquipmentItem =====

export async function getAllEquipmentItems(): Promise<EquipmentItem[]> {
  const snapshot = await getDocs(collection(db, EQUIPMENT_COLLECTION));
  return snapshot.docs.map(d => deserializeEquipmentItem(d.id, d.data() as Record<string, unknown>));
}

export async function getEquipmentItemById(id: string): Promise<EquipmentItem | null> {
  const docRef = doc(db, EQUIPMENT_COLLECTION, id);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return deserializeEquipmentItem(snap.id, snap.data() as Record<string, unknown>);
}

export async function saveEquipmentItem(item: EquipmentItem, userEmail: string): Promise<void> {
  const docRef = doc(db, EQUIPMENT_COLLECTION, item.id);
  const saveData = stripUndefined({
    ...item,
    updatedBy: userEmail,
    createdAt: item.createdAt instanceof Date ? Timestamp.fromDate(item.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(docRef, saveData);
}

export async function deleteEquipmentItem(id: string): Promise<void> {
  await deleteDoc(doc(db, EQUIPMENT_COLLECTION, id));
}

// ===== 採番 =====

const CODE_PREFIXES: Record<EquipmentItemType, string> = {
  'ベッド': 'BED',
  'サイドレール': 'SR',
  'マットレス': 'MT',
};

export function getNextEquipmentCode(items: EquipmentItem[], itemType: EquipmentItemType): string {
  const prefix = CODE_PREFIXES[itemType];
  const existing = items
    .filter(i => i.code.startsWith(prefix + '-'))
    .map(i => {
      const n = parseInt(i.code.replace(prefix + '-', ''), 10);
      return isNaN(n) ? 0 : n;
    });
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}

// ===== 状態遷移（アトミックトランザクション） =====

export async function changeEquipmentStatus(params: {
  itemId: string;
  toStatus: EquipmentItemStatus;
  usageType?: UsageType;
  clientAozoraId?: string;
  clientName?: string;
  startDate?: string;
  note?: string;
  userEmail: string;
}): Promise<void> {
  const { itemId, toStatus, usageType, clientAozoraId, clientName, startDate, note, userEmail } = params;
  const itemRef = doc(db, EQUIPMENT_COLLECTION, itemId);
  const snap = await getDoc(itemRef);
  if (!snap.exists()) throw new Error(`Equipment item ${itemId} not found`);

  const item = snap.data() as EquipmentItem;
  const fromStatus = item.status ?? null;
  const newUsageType = usageType ?? item.usageType;

  const allowed = getAllowedNextStatuses(fromStatus, newUsageType);
  if (!allowed.includes(toStatus)) {
    throw new Error(`遷移不可: ${fromStatus} → ${toStatus} (用途: ${newUsageType})`);
  }

  const now = new Date().toISOString();
  const dateStr = startDate || now.split('T')[0];

  const historyEntry: EquipmentUsageHistory = {
    id: `hist-${Date.now()}`,
    fromStatus,
    toStatus,
    usageType: newUsageType,
    clientAozoraId,
    clientName,
    startDate: dateStr,
    office: item.office,
    note,
    changedBy: userEmail,
    changedAt: now,
  };

  const updatedHistory = [...(item.usageHistory || []), historyEntry];

  // Close previous open history entry when returning
  const isReturning = ['倉庫保管', '事務所保管'].includes(toStatus);
  if (isReturning && updatedHistory.length >= 2) {
    const prev = updatedHistory[updatedHistory.length - 2];
    if (prev && !prev.endDate) {
      updatedHistory[updatedHistory.length - 2] = { ...prev, endDate: dateStr };
    }
  }

  const updatedItem: Record<string, unknown> = {
    ...item,
    status: toStatus,
    usageType: newUsageType,
    usageHistory: updatedHistory,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  };

  if (clientAozoraId) {
    updatedItem.currentClientAozoraId = clientAozoraId;
    updatedItem.currentClientName = clientName;
  } else if (isReturning) {
    delete updatedItem.currentClientAozoraId;
    delete updatedItem.currentClientName;
  }

  const logData: Record<string, unknown> = {
    equipmentId: itemId,
    equipmentCode: item.code,
    action: 'status_changed',
    fromStatus,
    toStatus,
    usageType: newUsageType,
    performedBy: userEmail,
    performedAt: serverTimestamp(),
  };
  if (clientAozoraId) {
    logData.clientAozoraId = clientAozoraId;
    logData.clientName = clientName;
  }
  if (note) logData.note = note;

  const batch = writeBatch(db);
  batch.set(itemRef, stripUndefined(updatedItem));
  const logRef = doc(collection(db, EQUIPMENT_LOGS_COLLECTION));
  batch.set(logRef, stripUndefined(logData));
  await batch.commit();
}

// ===== クリーニングライフサイクル =====

export async function startCleaning(
  itemId: string,
  record: CleaningRecord,
  userEmail: string
): Promise<void> {
  const itemRef = doc(db, EQUIPMENT_COLLECTION, itemId);
  const snap = await getDoc(itemRef);
  if (!snap.exists()) throw new Error(`Item ${itemId} not found`);
  const item = snap.data() as EquipmentItem;

  const batch = writeBatch(db);
  batch.set(itemRef, stripUndefined({
    ...item,
    status: 'クリーニング前' as EquipmentItemStatus,
    currentCleaning: record,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  }));
  const logRef = doc(collection(db, EQUIPMENT_LOGS_COLLECTION));
  batch.set(logRef, {
    equipmentId: itemId,
    equipmentCode: item.code,
    action: 'status_changed',
    fromStatus: item.status,
    toStatus: 'クリーニング前',
    performedBy: userEmail,
    performedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function completeCleaning(
  itemId: string,
  endDate: string,
  targetStatus: EquipmentItemStatus,
  userEmail: string
): Promise<void> {
  const itemRef = doc(db, EQUIPMENT_COLLECTION, itemId);
  const snap = await getDoc(itemRef);
  if (!snap.exists()) throw new Error(`Item ${itemId} not found`);
  const item = snap.data() as EquipmentItem;

  const completedRecord: CleaningRecord = {
    ...(item.currentCleaning as CleaningRecord),
    endDate,
  };
  const history = [...(item.cleaningHistory || []), completedRecord];

  const saveData: Record<string, unknown> = {
    ...item,
    status: targetStatus,
    cleaningHistory: history,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  };
  delete saveData.currentCleaning;

  const batch = writeBatch(db);
  batch.set(itemRef, stripUndefined(saveData));
  const logRef = doc(collection(db, EQUIPMENT_LOGS_COLLECTION));
  batch.set(logRef, {
    equipmentId: itemId,
    equipmentCode: item.code,
    action: 'status_changed',
    fromStatus: 'クリーニング中',
    toStatus: targetStatus,
    performedBy: userEmail,
    performedAt: serverTimestamp(),
  });
  await batch.commit();
}

// ===== 監査ログ =====

export async function getEquipmentLogs(): Promise<EquipmentLog[]> {
  const q = query(
    collection(db, EQUIPMENT_LOGS_COLLECTION),
    orderBy('performedAt', 'desc'),
    limit(100)
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      performedAt: data.performedAt?.toDate?.() || new Date(),
    } as EquipmentLog;
  });
}

// ===== セット管理 =====

export async function getAllEquipmentSets(): Promise<EquipmentSet[]> {
  const snapshot = await getDocs(collection(db, EQUIPMENT_SETS_COLLECTION));
  return snapshot.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      itemIds: data.itemIds || [],
      createdAt: data.createdAt?.toDate?.() || new Date(),
      updatedAt: data.updatedAt?.toDate?.() || new Date(),
    } as EquipmentSet;
  });
}

export async function saveEquipmentSet(set: EquipmentSet): Promise<void> {
  const docRef = doc(db, EQUIPMENT_SETS_COLLECTION, set.id);
  const saveData = stripUndefined({
    ...set,
    createdAt: set.createdAt instanceof Date ? Timestamp.fromDate(set.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(docRef, saveData);
}

export async function deleteEquipmentSet(id: string): Promise<void> {
  await deleteDoc(doc(db, EQUIPMENT_SETS_COLLECTION, id));
}

// ===== 償却計算 =====

export interface DepreciationInfo {
  purchaseDate: string;
  purchasePrice: number;
  depreciationMonths: number;
  elapsedMonths: number;
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  bookValue: number;
  progressRate: number;
}

export function getDepreciationInfo(item: EquipmentItem): DepreciationInfo | null {
  if (!item.purchaseDate || !item.purchasePrice) return null;

  const purchaseDate = new Date(item.purchaseDate);
  const now = new Date();
  const elapsedMonths = Math.max(
    0,
    (now.getFullYear() - purchaseDate.getFullYear()) * 12 + (now.getMonth() - purchaseDate.getMonth())
  );
  const depMonths = item.depreciationMonths || 12;
  const monthlyDep = item.purchasePrice / depMonths;
  const effectiveElapsed = Math.min(elapsedMonths, depMonths);
  const accumulated = monthlyDep * effectiveElapsed;
  const bookValue = Math.max(0, item.purchasePrice - accumulated);

  return {
    purchaseDate: item.purchaseDate,
    purchasePrice: item.purchasePrice,
    depreciationMonths: depMonths,
    elapsedMonths,
    monthlyDepreciation: Math.round(monthlyDep),
    accumulatedDepreciation: Math.round(accumulated),
    bookValue: Math.round(bookValue),
    progressRate: Math.min(1, elapsedMonths / depMonths),
  };
}

// ===== 旧 bedInventory データ読み取り（移行用） =====

export async function getAllBedItems(): Promise<BedInventoryItem[]> {
  const snapshot = await getDocs(collection(db, 'bedInventory'));
  return snapshot.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      createdAt: data.createdAt?.toDate?.() || new Date(),
      updatedAt: data.updatedAt?.toDate?.() || new Date(),
      disinfectionHistory: data.disinfectionHistory || [],
      rentalHistory: data.rentalHistory || [],
      depreciationMonths: data.depreciationMonths ?? 12,
    } as BedInventoryItem;
  });
}

// ===== 移行（bedInventory → equipments） =====

export async function migrateBedInventoryToEquipments(
  oldItems: BedInventoryItem[],
  options: MigrationOptions,
  userEmail: string
): Promise<{ migrated: number; failed: string[] }> {
  let migrated = 0;
  const failed: string[] = [];

  for (const old of oldItems) {
    try {
      const statusMap: Record<string, EquipmentItemStatus> = {
        '在庫': options.statusMapping['在庫'],
        '貸出中': options.statusMapping['貸出中'],
        '消毒中': options.statusMapping['消毒中'],
      };
      const newStatus = statusMap[old.lifecycleStatus] || options.statusMapping['在庫'];

      const newItem: EquipmentItem = {
        id: old.id,
        code: old.code,
        name: old.name,
        itemType: old.itemType,
        manufacturer: old.manufacturer,
        office: old.office,
        usageType: options.defaultUsageType,
        status: newStatus,
        currentClientAozoraId: old.currentClientAozoraId,
        currentClientName: old.currentClientName,
        setId: old.setId,
        setName: old.setName,
        purchaseDate: old.purchaseDate,
        purchasePrice: old.purchasePrice,
        depreciationMonths: old.depreciationMonths,
        cleaningHistory: (old.disinfectionHistory || []).map(d => ({
          id: d.id,
          vendor: d.vendor,
          cost: d.cost,
          startDate: d.startDate,
          endDate: d.endDate || '',
          note: d.note,
        })),
        currentCleaning: old.currentDisinfection ? {
          id: old.currentDisinfection.id,
          vendor: old.currentDisinfection.vendor,
          cost: old.currentDisinfection.cost,
          startDate: old.currentDisinfection.startDate,
          endDate: old.currentDisinfection.endDate || '',
          note: old.currentDisinfection.note,
        } : undefined,
        usageHistory: (old.rentalHistory || []).map(r => ({
          id: r.id,
          fromStatus: null,
          toStatus: options.statusMapping['貸出中'],
          usageType: options.defaultUsageType,
          clientAozoraId: r.clientAozoraId,
          clientName: r.clientName,
          startDate: r.startDate,
          endDate: r.endDate,
          office: r.office as OfficeLocation,
          changedBy: userEmail,
          changedAt: new Date().toISOString(),
        })),
        note: old.note,
        createdAt: old.createdAt,
        updatedAt: new Date(),
        updatedBy: userEmail,
      };

      const docRef = doc(db, EQUIPMENT_COLLECTION, newItem.id);
      await setDoc(docRef, stripUndefined({
        ...newItem,
        createdAt: newItem.createdAt instanceof Date ? Timestamp.fromDate(newItem.createdAt) : serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));

      const logRef = doc(collection(db, EQUIPMENT_LOGS_COLLECTION));
      await setDoc(logRef, {
        equipmentId: newItem.id,
        equipmentCode: newItem.code,
        action: 'migrated',
        toStatus: newStatus,
        performedBy: userEmail,
        performedAt: serverTimestamp(),
        note: 'bedInventoryから移行',
      });

      migrated++;
    } catch (err) {
      console.error(`Failed to migrate ${old.code}:`, err);
      failed.push(old.code);
    }
  }

  return { migrated, failed };
}

// ===== CSV出力 =====

export function exportEquipmentToCSV(items: EquipmentItem[]): string {
  const BOM = '\uFEFF';
  const headers = ['管理コード', '商品名', '種別', 'メーカー', '事業所', '用途区分', 'ステータス', '利用者名', '購入日', '購入金額', '償却月数', '備考'];
  const rows = items.map(item => [
    item.code,
    item.name,
    item.itemType,
    item.manufacturer || '',
    item.office,
    item.usageType,
    item.status,
    item.currentClientName || '',
    item.purchaseDate || '',
    item.purchasePrice?.toString() || '',
    item.depreciationMonths.toString(),
    item.note || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  return BOM + csv;
}

export function exportDepreciationToCSV(items: EquipmentItem[]): string {
  const BOM = '\uFEFF';
  const headers = ['管理コード', '商品名', '種別', '事業所', '購入日', '購入金額', '償却月数', '経過月数', '月額償却', '累計償却', '残存簿価', '進捗率'];
  const rows = items
    .map(item => {
      const dep = getDepreciationInfo(item);
      if (!dep) return null;
      return [
        item.code,
        item.name,
        item.itemType,
        item.office,
        dep.purchaseDate,
        dep.purchasePrice.toString(),
        dep.depreciationMonths.toString(),
        dep.elapsedMonths.toString(),
        dep.monthlyDepreciation.toString(),
        dep.accumulatedDepreciation.toString(),
        dep.bookValue.toString(),
        `${Math.round(dep.progressRate * 100)}%`,
      ];
    })
    .filter((r): r is string[] => r !== null);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  return BOM + csv;
}

export function exportCleaningHistoryToCSV(items: EquipmentItem[]): string {
  const BOM = '\uFEFF';
  const headers = ['管理コード', '商品名', '種別', '事業所', '業者名', '費用', '開始日', '終了日', '備考'];
  const rows: string[][] = [];
  for (const item of items) {
    for (const c of item.cleaningHistory || []) {
      rows.push([
        item.code,
        item.name,
        item.itemType,
        item.office,
        c.vendor,
        c.cost.toString(),
        c.startDate,
        c.endDate,
        c.note || '',
      ]);
    }
    if (item.currentCleaning) {
      rows.push([
        item.code,
        item.name,
        item.itemType,
        item.office,
        item.currentCleaning.vendor,
        item.currentCleaning.cost.toString(),
        item.currentCleaning.startDate,
        '(進行中)',
        item.currentCleaning.note || '',
      ]);
    }
  }
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  return BOM + csv;
}
