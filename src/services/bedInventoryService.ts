import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  getDocs,
  serverTimestamp,
  Timestamp,
  query,
  where
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  BedInventoryItem,
  BedSet,
  BedItemType,
  BedLifecycleStatus,
  BedRentalHistory,
  DisinfectionRecord,
  OfficeLocation
} from '../../types';

const BED_INVENTORY_COLLECTION = 'bedInventory';
const BED_SETS_COLLECTION = 'bedSets';

// ===== ヘルパー =====

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

// ===== CRUD: BedInventoryItem =====

export async function getAllBedItems(): Promise<BedInventoryItem[]> {
  const snapshot = await getDocs(collection(db, BED_INVENTORY_COLLECTION));
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

export async function saveBedItem(item: BedInventoryItem, userEmail: string): Promise<void> {
  const docRef = doc(db, BED_INVENTORY_COLLECTION, item.id);
  const saveData = stripUndefined({
    ...item,
    updatedBy: userEmail,
    createdAt: item.createdAt instanceof Date ? Timestamp.fromDate(item.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(docRef, saveData);
}

export async function deleteBedItem(id: string): Promise<void> {
  await deleteDoc(doc(db, BED_INVENTORY_COLLECTION, id));
}

// ===== CRUD: BedSet =====

export async function getAllBedSets(): Promise<BedSet[]> {
  const snapshot = await getDocs(collection(db, BED_SETS_COLLECTION));
  return snapshot.docs.map(d => {
    const data = d.data();
    return {
      ...data,
      id: d.id,
      itemIds: data.itemIds || [],
      createdAt: data.createdAt?.toDate?.() || new Date(),
      updatedAt: data.updatedAt?.toDate?.() || new Date(),
    } as BedSet;
  });
}

export async function saveBedSet(set: BedSet): Promise<void> {
  const docRef = doc(db, BED_SETS_COLLECTION, set.id);
  const saveData = stripUndefined({
    ...set,
    createdAt: set.createdAt instanceof Date ? Timestamp.fromDate(set.createdAt) : serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(docRef, saveData);
}

export async function deleteBedSet(id: string): Promise<void> {
  await deleteDoc(doc(db, BED_SETS_COLLECTION, id));
}

// ===== ライフサイクル操作 =====

export async function rentOutBed(
  itemId: string,
  clientAozoraId: string,
  clientName: string,
  startDate: string,
  office: OfficeLocation,
  userEmail: string
): Promise<void> {
  const docRef = doc(db, BED_INVENTORY_COLLECTION, itemId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error(`Item ${itemId} not found`);

  const item = snap.data() as BedInventoryItem;
  const rentalRecord: BedRentalHistory = {
    id: `rent-${Date.now()}`,
    clientAozoraId,
    clientName,
    startDate,
    office,
  };

  const updatedHistory = [...(item.rentalHistory || []), rentalRecord];

  await setDoc(docRef, stripUndefined({
    ...item,
    lifecycleStatus: '貸出中' as BedLifecycleStatus,
    currentClientAozoraId: clientAozoraId,
    currentClientName: clientName,
    rentalHistory: updatedHistory,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  }));
}

export async function returnBed(
  itemId: string,
  endDate: string,
  userEmail: string
): Promise<void> {
  const docRef = doc(db, BED_INVENTORY_COLLECTION, itemId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error(`Item ${itemId} not found`);

  const item = snap.data() as BedInventoryItem;
  const history = [...(item.rentalHistory || [])];
  // Close the latest open rental
  for (let i = history.length - 1; i >= 0; i--) {
    if (!history[i].endDate) {
      history[i] = { ...history[i], endDate };
      break;
    }
  }

  const saveData: Record<string, unknown> = {
    ...item,
    lifecycleStatus: '在庫' as BedLifecycleStatus,
    rentalHistory: history,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  };
  delete saveData.currentClientAozoraId;
  delete saveData.currentClientName;

  await setDoc(docRef, stripUndefined(saveData));
}

export async function startDisinfection(
  itemId: string,
  record: DisinfectionRecord,
  userEmail: string
): Promise<void> {
  const docRef = doc(db, BED_INVENTORY_COLLECTION, itemId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error(`Item ${itemId} not found`);

  const item = snap.data() as BedInventoryItem;

  await setDoc(docRef, stripUndefined({
    ...item,
    lifecycleStatus: '消毒中' as BedLifecycleStatus,
    currentDisinfection: record,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  }));
}

export async function completeDisinfection(
  itemId: string,
  endDate: string,
  userEmail: string
): Promise<void> {
  const docRef = doc(db, BED_INVENTORY_COLLECTION, itemId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error(`Item ${itemId} not found`);

  const item = snap.data() as BedInventoryItem;
  const completedRecord: DisinfectionRecord = {
    ...(item.currentDisinfection as DisinfectionRecord),
    endDate,
  };
  const history = [...(item.disinfectionHistory || []), completedRecord];

  const saveData: Record<string, unknown> = {
    ...item,
    lifecycleStatus: '在庫' as BedLifecycleStatus,
    disinfectionHistory: history,
    updatedBy: userEmail,
    updatedAt: serverTimestamp(),
  };
  delete saveData.currentDisinfection;

  await setDoc(docRef, stripUndefined(saveData));
}

// ===== 集計ヘルパー =====

const CODE_PREFIXES: Record<BedItemType, string> = {
  'ベッド': 'BED',
  'サイドレール': 'SR',
  'マットレス': 'MT',
};

export function getNextCode(items: BedInventoryItem[], itemType: BedItemType): string {
  const prefix = CODE_PREFIXES[itemType];
  const existingNumbers = items
    .filter(i => i.code.startsWith(prefix + '-'))
    .map(i => {
      const num = parseInt(i.code.replace(prefix + '-', ''), 10);
      return isNaN(num) ? 0 : num;
    });
  const nextNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}-${String(nextNum).padStart(3, '0')}`;
}

export interface DepreciationInfo {
  purchaseDate: string;
  purchasePrice: number;
  depreciationMonths: number;
  elapsedMonths: number;
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  bookValue: number;
  rentalMonths: number;
  progressRate: number; // 0-1
}

export function getDepreciationInfo(item: BedInventoryItem): DepreciationInfo | null {
  if (!item.purchaseDate || !item.purchasePrice) return null;

  const purchaseDate = new Date(item.purchaseDate);
  const now = new Date();
  const elapsedMonths = Math.max(0,
    (now.getFullYear() - purchaseDate.getFullYear()) * 12 +
    (now.getMonth() - purchaseDate.getMonth())
  );

  const depMonths = item.depreciationMonths || 12;
  const monthlyDep = item.purchasePrice / depMonths;
  const effectiveElapsed = Math.min(elapsedMonths, depMonths);
  const accumulated = monthlyDep * effectiveElapsed;
  const bookValue = Math.max(0, item.purchasePrice - accumulated);

  // 貸出月数計算（償却期間内の合計）
  let rentalMonths = 0;
  const purchaseEnd = new Date(purchaseDate);
  purchaseEnd.setMonth(purchaseEnd.getMonth() + depMonths);

  for (const rental of (item.rentalHistory || [])) {
    const start = new Date(rental.startDate);
    const end = rental.endDate ? new Date(rental.endDate) : now;
    const effectiveStart = start < purchaseDate ? purchaseDate : start;
    const effectiveEnd = end > purchaseEnd ? purchaseEnd : end;
    if (effectiveStart < effectiveEnd) {
      rentalMonths += (effectiveEnd.getFullYear() - effectiveStart.getFullYear()) * 12 +
        (effectiveEnd.getMonth() - effectiveStart.getMonth());
    }
  }

  return {
    purchaseDate: item.purchaseDate,
    purchasePrice: item.purchasePrice,
    depreciationMonths: depMonths,
    elapsedMonths,
    monthlyDepreciation: Math.round(monthlyDep),
    accumulatedDepreciation: Math.round(accumulated),
    bookValue: Math.round(bookValue),
    rentalMonths,
    progressRate: Math.min(1, elapsedMonths / depMonths),
  };
}
