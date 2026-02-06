import {
  collection,
  doc,
  getDoc,
  setDoc,
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
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
  OcrNameMapping
} from '../../types';
import type { MeetingRecord as Meeting, ClientChangeRecord as ChangeRecord } from '../../types';

export interface ClientEdits {
  aozoraId: string;
  meetings?: Meeting[];
  changeRecords?: ChangeRecord[];
  plannedEquipment?: Equipment[];
  selectedEquipment?: Equipment[];
  keyPerson?: KeyPerson;
  address?: string;
  medicalHistory?: string;
  isWelfareEquipmentUser?: boolean;
  updatedAt?: Timestamp;
  updatedBy?: string;
}

const CLIENT_EDITS_COLLECTION = 'clientEdits';
const RECONCILIATIONS_COLLECTION = 'reconciliations';

/**
 * Check if running in E2E test mode
 */
function isE2ETestMode(): boolean {
  return typeof window !== 'undefined' && window.location.search.includes('e2e_test_mode=true');
}

/**
 * Save client edits to Firestore
 */
export async function saveClientEdits(
  client: Client,
  userEmail: string
): Promise<void> {
  // Skip Firestore operations in E2E test mode
  if (isE2ETestMode()) {
    console.log('[Firestore] E2E test mode - skipping saveClientEdits');
    return;
  }

  try {
    const edits: ClientEdits = {
      aozoraId: client.aozoraId,
      meetings: client.meetings || [],
      changeRecords: client.changeRecords || [],
      plannedEquipment: client.plannedEquipment || [],
      selectedEquipment: client.selectedEquipment || [],
      keyPerson: client.keyPerson,
      address: client.address || '',
      medicalHistory: client.medicalHistory || '',
      isWelfareEquipmentUser: client.isWelfareEquipmentUser || false,
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

    const docRef = doc(db, CLIENT_EDITS_COLLECTION, client.aozoraId);
    await setDoc(docRef, edits);

    console.log(`✓ [saveClientEdits] Successfully saved edits for client ${client.aozoraId} to Firestore`);
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
 */
export function mergeClientEdits(baseClient: Client, edits: ClientEdits | null): Client {
  if (!edits) {
    return baseClient;
  }

  // Merge selectedEquipment from both sources, avoiding duplicates
  const mergedSelectedEquipment = mergeEquipmentArrays(
    baseClient.selectedEquipment || [],
    edits.selectedEquipment || []
  );

  // Merge plannedEquipment from both sources
  const mergedPlannedEquipment = mergeEquipmentArrays(
    baseClient.plannedEquipment || [],
    edits.plannedEquipment || []
  );

  // Merge changeRecords: Kintone records from base, manual records from Firestore
  const mergedChangeRecords = mergeChangeRecords(
    baseClient.changeRecords || [],
    edits.changeRecords || []
  );

  return {
    ...baseClient,
    meetings: (edits.meetings?.length ? edits.meetings : baseClient.meetings) || [],
    changeRecords: mergedChangeRecords,
    plannedEquipment: mergedPlannedEquipment,
    selectedEquipment: mergedSelectedEquipment,
    keyPerson: edits.keyPerson || baseClient.keyPerson,
    address: edits.address || baseClient.address || '',
    medicalHistory: edits.medicalHistory || baseClient.medicalHistory || '',
    isWelfareEquipmentUser: edits.isWelfareEquipmentUser !== undefined ? edits.isWelfareEquipmentUser : baseClient.isWelfareEquipmentUser
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
 */
function mergeEquipmentArrays(baseEquipment: Equipment[], firestoreEquipment: Equipment[]): Equipment[] {
  // Create a map of Firestore equipment by key for quick lookup
  const firestoreMap = new Map<string, Equipment>();
  firestoreEquipment.forEach(eq => {
    const key = eq.id || `${eq.name}|${eq.status}`;
    firestoreMap.set(key, eq);
  });

  // Merge base equipment with Firestore overrides
  const merged: Equipment[] = baseEquipment.map(baseEq => {
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
 */
export function mergeAllClientEdits(
  baseClients: Client[],
  editsMap: Map<string, ClientEdits>
): Client[] {
  return baseClients.map(client => {
    const edits = editsMap.get(client.aozoraId);
    return mergeClientEdits(client, edits);
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
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
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
              confirmedAt: (value as { confirmedAt?: { toDate?: () => Date } }).confirmedAt?.toDate?.()
            }
          ])
        )
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
    const docSnap = await getDoc(docRef);

    let reconciliationDoc: ReconciliationDocument;
    if (docSnap.exists()) {
      reconciliationDoc = docSnap.data() as ReconciliationDocument;
    } else {
      reconciliationDoc = createDefaultReconciliationDoc(month, office, userEmail);
    }

    // Update invoice confirmation data for the company
    reconciliationDoc.invoiceConfirmation[company] = data;
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
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

    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    delete reconciliationDoc.invoiceConfirmation[company];
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
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

    reconciliationDoc.invoiceConfirmation[company] = {
      ...invoiceData,
      status: 'draft',
      confirmedAt: undefined,
      confirmedBy: undefined
    };
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

    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    reconciliationDoc.monthlyStatus = 'confirmed';
    reconciliationDoc.monthlyConfirmedAt = new Date();
    reconciliationDoc.monthlyConfirmedBy = userEmail;
    reconciliationDoc.summary = summary;
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
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

    const reconciliationDoc = docSnap.data() as ReconciliationDocument;
    reconciliationDoc.monthlyStatus = 'draft';
    reconciliationDoc.monthlyConfirmedAt = undefined;
    reconciliationDoc.monthlyConfirmedBy = undefined;
    reconciliationDoc.summary = undefined;
    reconciliationDoc.updatedAt = new Date();
    reconciliationDoc.updatedBy = userEmail;

    await setDoc(docRef, reconciliationDoc);
    console.log(`✓ [unconfirmMonthly] Monthly reconciliation unconfirmed for ${month}/${office}`);
  } catch (error) {
    console.error(`Error unconfirming monthly reconciliation:`, error);
    throw error;
  }
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
 * 4. Batch write to Firestore
 */
export async function saveInsuranceRentalBatch(
  equipmentByClient: Map<string, Equipment[]>,
  selectedMonth: string,
  userEmail: string
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

      // Remove existing 介護保険レンタル equipment
      const nonInsuranceEquipment = (existingEdits.selectedEquipment || []).filter(
        eq => eq.status !== '介護保険レンタル'
      );

      // Merge with new equipment
      const mergedEquipment = [...nonInsuranceEquipment, ...newEquipment];

      // Update Firestore
      await setDoc(docRef, {
        ...existingEdits,
        selectedEquipment: mergedEquipment,
        updatedAt: serverTimestamp(),
        updatedBy: userEmail,
      });

      updatedCount++;
      totalEquipmentCount += newEquipment.length;
    }

    console.log(`✓ [saveInsuranceRentalBatch] Updated ${updatedCount} clients with ${totalEquipmentCount} equipment items`);
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
