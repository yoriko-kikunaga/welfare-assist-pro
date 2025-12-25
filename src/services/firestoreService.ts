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
  updatedAt?: Timestamp;
  updatedBy?: string;
}

const CLIENT_EDITS_COLLECTION = 'clientEdits';

/**
 * Save client edits to Firestore
 */
export async function saveClientEdits(
  client: Client,
  userEmail: string
): Promise<void> {
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
 */
export function mergeClientEdits(baseClient: Client, edits: ClientEdits | null): Client {
  if (!edits) {
    return baseClient;
  }

  return {
    ...baseClient,
    meetings: edits.meetings || baseClient.meetings || [],
    changeRecords: edits.changeRecords || baseClient.changeRecords || [],
    plannedEquipment: edits.plannedEquipment || baseClient.plannedEquipment || [],
    selectedEquipment: edits.selectedEquipment || baseClient.selectedEquipment || [],
    keyPerson: edits.keyPerson || baseClient.keyPerson,
    address: edits.address || baseClient.address || '',
    medicalHistory: edits.medicalHistory || baseClient.medicalHistory || ''
  };
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
