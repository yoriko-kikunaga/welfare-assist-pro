const { getAllClientEdits, mergeAllClientEdits } = require('./firestoreAdmin.cjs');
const fs = require('fs');

async function checkWelfareUsers() {
  try {
    // Load base clients
    const baseClients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    console.log('Base clients loaded:', baseClients.length);

    const baseWelfareCount = baseClients.filter(c => c.isWelfareEquipmentUser).length;
    console.log('Base welfare users:', baseWelfareCount);

    // Load Firestore edits
    const editsMap = await getAllClientEdits();
    console.log('\nFirestore edits loaded:', editsMap.size);

    // Check for welfare flag changes in Firestore
    let welfareChangedToFalse = [];
    let welfareChangedToTrue = [];

    for (const [aozoraId, edit] of editsMap.entries()) {
      if (edit.hasOwnProperty('isWelfareEquipmentUser')) {
        const baseClient = baseClients.find(c => c.aozoraId === aozoraId);
        if (baseClient) {
          if (baseClient.isWelfareEquipmentUser && !edit.isWelfareEquipmentUser) {
            welfareChangedToFalse.push({
              aozoraId,
              name: baseClient.name,
              base: baseClient.isWelfareEquipmentUser,
              firestore: edit.isWelfareEquipmentUser
            });
          } else if (!baseClient.isWelfareEquipmentUser && edit.isWelfareEquipmentUser) {
            welfareChangedToTrue.push({
              aozoraId,
              name: baseClient.name,
              base: baseClient.isWelfareEquipmentUser,
              firestore: edit.isWelfareEquipmentUser
            });
          }
        }
      }
    }

    console.log('\n=== Welfare flag changes in Firestore ===');
    console.log('Changed to FALSE:', welfareChangedToFalse.length);
    if (welfareChangedToFalse.length > 0) {
      welfareChangedToFalse.forEach(item => {
        console.log(`  - ${item.name} (${item.aozoraId}): base=${item.base} -> firestore=${item.firestore}`);
      });
    }

    console.log('\nChanged to TRUE:', welfareChangedToTrue.length);
    if (welfareChangedToTrue.length > 0) {
      welfareChangedToTrue.forEach(item => {
        console.log(`  - ${item.name} (${item.aozoraId}): base=${item.base} -> firestore=${item.firestore}`);
      });
    }

    // Merge and count
    const mergedClients = mergeAllClientEdits(baseClients, editsMap);
    const mergedWelfareCount = mergedClients.filter(c => c.isWelfareEquipmentUser).length;

    console.log('\n=== Final counts ===');
    console.log('Base welfare users:', baseWelfareCount);
    console.log('Merged welfare users:', mergedWelfareCount);
    console.log('Difference:', mergedWelfareCount - baseWelfareCount);

  } catch (error) {
    console.error('Error:', error);
  }

  process.exit(0);
}

checkWelfareUsers();
