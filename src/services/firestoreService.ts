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
import { Client, Meeting, ChangeRecord, Equipment, KeyPerson } from '../../types';

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

  return {
    ...baseClient,
    meetings: (edits.meetings?.length ? edits.meetings : baseClient.meetings) || [],
    changeRecords: (edits.changeRecords?.length ? edits.changeRecords : baseClient.changeRecords) || [],
    plannedEquipment: mergedPlannedEquipment,
    selectedEquipment: mergedSelectedEquipment,
    keyPerson: edits.keyPerson || baseClient.keyPerson,
    address: edits.address || baseClient.address || '',
    medicalHistory: edits.medicalHistory || baseClient.medicalHistory || '',
    isWelfareEquipmentUser: edits.isWelfareEquipmentUser !== undefined ? edits.isWelfareEquipmentUser : baseClient.isWelfareEquipmentUser
  };
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
