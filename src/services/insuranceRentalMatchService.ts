import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import {
  WholesaleCompany,
  InsuranceRentalItemMapping,
  InvoiceItem,
  InsuranceRentalItemPair,
} from '../../types';

export const INSURANCE_RENTAL_COLLECTION = 'insuranceRentalItemMatches';
export const SALES_COLLECTION = 'salesItemMatches';
export const SELF_PAY_RENTAL_COLLECTION = 'selfPayRentalItemMatches';

function docId(wholesaleCompany: WholesaleCompany, aozoraId: string): string {
  return `${wholesaleCompany}_${aozoraId}`;
}

/**
 * 保存済み品目マッピングを取得
 * 旧形式（wholesalerItemName: string）も自動マイグレーション
 */
export async function loadItemMappings(
  wholesaleCompany: WholesaleCompany,
  aozoraId: string,
  collectionName: string = INSURANCE_RENTAL_COLLECTION
): Promise<InsuranceRentalItemMapping[]> {
  const ref = doc(db, collectionName, docId(wholesaleCompany, aozoraId));
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];

  const raw = snap.data().mappings as (InsuranceRentalItemMapping | { ourItemName: string; wholesalerItemName: string })[];
  if (!Array.isArray(raw)) return [];

  // 旧形式（wholesalerItemName: string）を新形式（wholesalerItemNames: string[]）に変換
  return raw.map(m => {
    if ('wholesalerItemNames' in m) return m as InsuranceRentalItemMapping;
    return {
      ourItemName: m.ourItemName,
      wholesalerItemNames: [(m as { ourItemName: string; wholesalerItemName: string }).wholesalerItemName],
    };
  });
}

/**
 * 品目マッピングを保存
 */
export async function saveItemMappings(
  wholesaleCompany: WholesaleCompany,
  aozoraId: string,
  mappings: InsuranceRentalItemMapping[],
  collectionName: string = INSURANCE_RENTAL_COLLECTION
): Promise<void> {
  const ref = doc(db, collectionName, docId(wholesaleCompany, aozoraId));
  await setDoc(ref, {
    aozoraId,
    wholesaleCompany,
    mappings,
    updatedAt: serverTimestamp(),
  });
}

/**
 * 複数利用者の保存済みマッピングを一括取得
 */
export async function loadAllMappingsForCompany(
  wholesaleCompany: WholesaleCompany,
  aozoraIds: string[],
  collectionName: string = INSURANCE_RENTAL_COLLECTION
): Promise<Map<string, InsuranceRentalItemMapping[]>> {
  const result = new Map<string, InsuranceRentalItemMapping[]>();
  await Promise.all(
    aozoraIds.map(async (aozoraId) => {
      const mappings = await loadItemMappings(wholesaleCompany, aozoraId, collectionName);
      result.set(aozoraId, mappings);
    })
  );
  return result;
}

// ===== 品目マッチングロジック =====

/**
 * 品目名を正規化（括弧内除去・スペース除去）
 */
function normalizeItemName(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[【[〔][^】\]〕]*[】\]〕]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * 2つの品目名の類似度スコア（0〜1）
 */
function itemNameSimilarity(a: string, b: string): number {
  const na = normalizeItemName(a);
  const nb = normalizeItemName(b);
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const shorter = na.length < nb.length ? na : nb;
  const longer = na.length < nb.length ? nb : na;
  let matched = 0;
  for (const ch of shorter) {
    if (longer.includes(ch)) matched++;
  }
  return matched / longer.length;
}

/**
 * 保存済みマッピング + 名前類似度で品目ペアを自動生成（1:N対応）
 */
export function buildItemPairs(
  ourItems: { id: string; name: string }[],
  wholesalerItems: InvoiceItem[],
  savedMappings: InsuranceRentalItemMapping[]
): InsuranceRentalItemPair[] {
  const pairs: InsuranceRentalItemPair[] = [];
  const usedWholesalerIds = new Set<string>();

  // 保存済みマッピング: ourItemName → wholesalerItemNames[]
  const mappingMap = new Map(savedMappings.map(m => [m.ourItemName, m.wholesalerItemNames]));

  for (const ourItem of ourItems) {
    const savedNames = mappingMap.get(ourItem.name);

    if (savedNames && savedNames.length > 0) {
      // 保存済みマッピングを適用（1:N）
      const matchedWItems: { id: string; name: string; amount: number; targetMonth?: string }[] = [];
      for (const savedName of savedNames) {
        // 同名品目が複数ある場合（¥0と実金額が混在）は金額が大きい方を優先
        const candidates = wholesalerItems.filter(
          w => !usedWholesalerIds.has(w.id) && w.itemName === savedName
        );
        const wItem = candidates.find(w => w.amount > 0) ?? candidates[0];
        if (wItem) {
          matchedWItems.push({ id: wItem.id, name: wItem.itemName, amount: wItem.amount, targetMonth: wItem.targetMonth });
          usedWholesalerIds.add(wItem.id);
        }
      }
      pairs.push({ ourItem, wholesalerItems: matchedWItems });
    } else {
      // 名前類似度でマッチング（1:1のみ）
      let bestScore = 0;
      let bestWItem: InvoiceItem | null = null;
      for (const wItem of wholesalerItems) {
        if (usedWholesalerIds.has(wItem.id)) continue;
        const score = itemNameSimilarity(ourItem.name, wItem.itemName);
        if (score > bestScore) {
          bestScore = score;
          bestWItem = wItem;
        }
      }
      if (bestWItem && bestScore >= 0.5) {
        pairs.push({
          ourItem,
          wholesalerItems: [{ id: bestWItem.id, name: bestWItem.itemName, amount: bestWItem.amount, targetMonth: bestWItem.targetMonth }],
        });
        usedWholesalerIds.add(bestWItem.id);
      } else {
        pairs.push({ ourItem, wholesalerItems: [] });
      }
    }
  }

  // 未紐づけの卸品目を追加（ourItem: null）
  for (const wItem of wholesalerItems) {
    if (!usedWholesalerIds.has(wItem.id)) {
      pairs.push({
        ourItem: null,
        wholesalerItems: [{ id: wItem.id, name: wItem.itemName, amount: wItem.amount, targetMonth: wItem.targetMonth }],
      });
    }
  }

  return pairs;
}

/**
 * ペアからマッピングを抽出（保存用）
 */
export function extractMappingsFromPairs(
  pairs: InsuranceRentalItemPair[]
): InsuranceRentalItemMapping[] {
  return pairs
    .filter(p => p.ourItem && p.wholesalerItems.length > 0)
    .map(p => ({
      ourItemName: p.ourItem!.name,
      wholesalerItemNames: p.wholesalerItems.map(w => w.name),
    }));
}
