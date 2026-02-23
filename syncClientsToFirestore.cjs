/**
 * syncClientsToFirestore.cjs
 *
 * clients.json の内容を Firestore の clientEdits コレクションへ毎日一括反映する。
 *
 * 更新内容:
 *   - clientName    : 利用者名（clients.json の name フィールド）
 *   - isWelfareEquipmentUser : 福祉用具利用フラグ（最新化）
 *   - changeRecords : kintone-* レコードは clients.json を優先、手動レコードは Firestore を保持
 *
 * 対象:
 *   - isWelfareEquipmentUser === true の利用者
 *   - または kintone changeRecord がある利用者
 *   - 既存の clientEdits ドキュメントがある利用者はすべて clientName を最新化
 *
 * 定時更新（GitHub Actions）から importFromKintone.cjs の直後に実行される。
 */

const admin = require('firebase-admin');
const fs = require('fs');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./service-account-key.json')),
    projectId: 'welfare-assist-pro'
  });
}

const db = admin.firestore();
const BATCH_SIZE = 400; // Firestore は 1 バッチ 500 件まで

async function syncClientsToFirestore() {
  console.log('\n=== clients.json → Firestore 同期開始 ===\n');

  // 1. clients.json を読み込む
  const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf-8'));
  console.log(`✓ clients.json: ${clients.length}件`);

  // 2. 既存の clientEdits を一括取得
  const snapshot = await db.collection('clientEdits').get();
  const existingEdits = new Map();
  snapshot.forEach(doc => {
    existingEdits.set(doc.id, doc.data());
  });
  console.log(`✓ Firestore clientEdits: ${existingEdits.size}件`);

  // 3. 処理対象を絞る
  //    - 福祉用具利用者
  //    - または kintone changeRecord がある
  //    - または既存の clientEdits ドキュメントがある（clientName だけでも最新化）
  const targetClients = clients.filter(c =>
    c.isWelfareEquipmentUser ||
    (c.changeRecords || []).some(r => r.id && r.id.startsWith('kintone-')) ||
    existingEdits.has(c.aozoraId)
  );
  console.log(`対象利用者: ${targetClients.length}件\n`);

  let updatedCount = 0;
  let createdCount = 0;
  let skippedCount = 0;

  // 4. バッチ処理
  for (let i = 0; i < targetClients.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = targetClients.slice(i, i + BATCH_SIZE);

    for (const client of chunk) {
      const aozoraId = client.aozoraId;
      if (!aozoraId) { skippedCount++; continue; }

      const docRef = db.collection('clientEdits').doc(aozoraId);

      // clients.json 側の kintone レコードを抽出
      const kintoneRecords = (client.changeRecords || []).filter(
        r => r.id && r.id.startsWith('kintone-')
      );

      const existing = existingEdits.get(aozoraId);

      if (existing) {
        // --- 既存ドキュメントを更新 ---
        // 手動追加レコード（kintone-* 以外）は Firestore から保持
        const manualRecords = (existing.changeRecords || []).filter(
          r => !r.id || !r.id.startsWith('kintone-')
        );
        const mergedChangeRecords = [...kintoneRecords, ...manualRecords];

        batch.update(docRef, {
          clientName: client.name,
          isWelfareEquipmentUser: client.isWelfareEquipmentUser || false,
          changeRecords: mergedChangeRecords,
        });
        updatedCount++;

      } else if (kintoneRecords.length > 0 || client.isWelfareEquipmentUser) {
        // --- 新規ドキュメントを作成（kintone レコードあり or 福祉用具利用者） ---
        batch.set(docRef, {
          aozoraId: aozoraId,
          clientName: client.name,
          isWelfareEquipmentUser: client.isWelfareEquipmentUser || false,
          changeRecords: kintoneRecords,
        });
        createdCount++;

      } else {
        skippedCount++;
      }
    }

    await batch.commit();
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const total = Math.ceil(targetClients.length / BATCH_SIZE);
    console.log(`  バッチ ${batchNum}/${total}: ${chunk.length}件処理`);
  }

  console.log(`\n=== 完了 ===`);
  console.log(`  更新:    ${updatedCount}件`);
  console.log(`  新規作成: ${createdCount}件`);
  console.log(`  スキップ: ${skippedCount}件`);
}

syncClientsToFirestore().catch(err => {
  console.error('\n[syncClientsToFirestore] エラー:', err);
  process.exit(1);
});
