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
    selectedEquipment: edits.selectedEquipment || baseClient.selectedEquipment || [],
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
