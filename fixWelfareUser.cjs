const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = require('./service-account-key.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function fixWelfareUser() {
  try {
    const aozoraId = '8578';
    const docRef = db.collection('clientEdits').doc(aozoraId);

    console.log(`Checking Firestore data for aozoraId: ${aozoraId}...`);

    const doc = await docRef.get();
    if (doc.exists) {
      const data = doc.data();
      console.log('Current Firestore data:', JSON.stringify(data, null, 2));

      // Option 1: Delete the field
      console.log('\nDeleting isWelfareEquipmentUser field from Firestore...');
      await docRef.update({
        isWelfareEquipmentUser: admin.firestore.FieldValue.delete()
      });
      console.log('✓ Field deleted. Client will now use base data (true).');

      // Option 2: Update to true (uncomment if you prefer this)
      // console.log('\nUpdating isWelfareEquipmentUser to true...');
      // await docRef.update({
      //   isWelfareEquipmentUser: true,
      //   updatedAt: admin.firestore.FieldValue.serverTimestamp()
      // });
      // console.log('✓ Updated to true.');
    } else {
      console.log('No Firestore data found for this client.');
    }

    console.log('\n✓ Fix complete. The app should now show 464 welfare users.');

  } catch (error) {
    console.error('Error:', error);
  }

  process.exit(0);
}

fixWelfareUser();
