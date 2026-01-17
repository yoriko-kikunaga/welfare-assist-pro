const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./service-account-key.json')),
    projectId: 'welfare-assist-pro'
  });
}

const db = admin.firestore();

/**
 * Get all client edits from Firestore
 */
async function getAllClientEdits() {
  try {
    const editsMap = new Map();
    const snapshot = await db.collection('clientEdits').get();

    snapshot.forEach(doc => {
      const data = doc.data();
      editsMap.set(doc.id, data);
    });

    console.log(`✓ Loaded ${editsMap.size} client edits from Firestore`);
    return editsMap;
  } catch (error) {
    console.error('Error getting client edits from Firestore:', error);
    return new Map();
  }
}

/**
 * Merge equipment arrays from base and Firestore
 * - Base: 介護保険レンタル, 自費レンタル, 販売 (from spreadsheet)
 * - Firestore: 自費レンタル (with user edits), 販売 (user-added)
 *
 * Firestore fields preserved:
 * - endDate, quantity, taxType, taxIncludedAmount
 * - shippingCost, paymentMethod, transactionType
 * - userBurdenType, applicationStatus, applicationMunicipality
 * - salesPerson, note
 */
function mergeEquipmentArrays(baseEquipment, firestoreEquipment) {
  if (!firestoreEquipment || firestoreEquipment.length === 0) {
    return baseEquipment || [];
  }
  if (!baseEquipment || baseEquipment.length === 0) {
    return firestoreEquipment;
  }

  // Create a map of Firestore items by name|status for quick lookup
  const firestoreMap = new Map();
  firestoreEquipment.forEach(eq => {
    const key = `${eq.name}|${eq.status}`;
    firestoreMap.set(key, eq);
  });

  // Fields to preserve from Firestore (user edits)
  const fieldsToMerge = [
    'endDate', 'quantity', 'taxType', 'taxIncludedAmount',
    'shippingCost', 'paymentMethod', 'transactionType',
    'userBurdenType', 'applicationStatus', 'applicationMunicipality',
    'salesPerson', 'orderReceivedDate', 'note'
  ];

  // Start with base equipment, merge Firestore fields if exists
  const merged = baseEquipment.map(baseEq => {
    const key = `${baseEq.name}|${baseEq.status}`;
    const firestoreEq = firestoreMap.get(key);
    if (firestoreEq) {
      // Merge all user-edited fields from Firestore
      const mergedEq = { ...baseEq };
      fieldsToMerge.forEach(field => {
        if (firestoreEq[field] !== undefined && firestoreEq[field] !== null && firestoreEq[field] !== '') {
          mergedEq[field] = firestoreEq[field];
        }
      });
      return mergedEq;
    }
    return baseEq;
  });

  // Add Firestore items that don't exist in base (e.g., user-added 販売)
  const baseKeys = new Set(baseEquipment.map(eq => `${eq.name}|${eq.status}`));
  firestoreEquipment.forEach(eq => {
    const key = `${eq.name}|${eq.status}`;
    if (!baseKeys.has(key)) {
      merged.push(eq);
    }
  });

  return merged;
}

/**
 * Merge client edits from Firestore into base client data
 */
function mergeClientEdits(baseClient, edits) {
  if (!edits) {
    return baseClient;
  }

  return {
    ...baseClient,
    meetings: edits.meetings || baseClient.meetings || [],
    changeRecords: edits.changeRecords || baseClient.changeRecords || [],
    plannedEquipment: edits.plannedEquipment || baseClient.plannedEquipment || [],
    selectedEquipment: mergeEquipmentArrays(baseClient.selectedEquipment, edits.selectedEquipment),
    keyPerson: edits.keyPerson || baseClient.keyPerson,
    address: edits.address || baseClient.address || '',
    medicalHistory: edits.medicalHistory || baseClient.medicalHistory || ''
  };
}

/**
 * Merge all client edits into base clients array
 */
function mergeAllClientEdits(baseClients, editsMap) {
  return baseClients.map(client => {
    const edits = editsMap.get(client.aozoraId);
    return mergeClientEdits(client, edits);
  });
}

module.exports = {
  getAllClientEdits,
  mergeClientEdits,
  mergeAllClientEdits
};
