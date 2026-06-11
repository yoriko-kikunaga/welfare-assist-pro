/**
 * 自費レンタル Firestore 移行スクリプト（1回限り）
 *
 * 目的: スプレッドシート由来（clients.json ベース）の自費レンタルのうち
 *       Firestore clientEdits.selectedEquipment に未登録のものを移行する。
 *       これにより importSpreadsheetData.cjs から自費レンタル読み込みを撤廃しても
 *       データが失われないようにする。
 *
 * 安全策:
 *   - 既存ドキュメントは update（部分更新）で selectedEquipment のみ書き換え、
 *     clientName / changeRecords 等の他フィールドは保持する。
 *   - 既存 selectedEquipment（介護保険・販売・既存自費）は保持し、
 *     未登録の自費レンタル品目のみ id / name|status キーで追加（重複防止）。
 *
 * 実行: node migrateSelfPayToFirestore.cjs           （リスト表示のみ・DRY RUN）
 *       node migrateSelfPayToFirestore.cjs --apply    （実際に書き込み）
 */
const admin = require('firebase-admin');
const fs = require('fs');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./service-account-key.json')),
    projectId: 'welfare-assist-pro',
  });
}
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

function eqKey(e) {
  return e.id || `${e.name}|${e.status}`;
}

(async () => {
  const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));

  // Firestore clientEdits を全取得
  const snap = await db.collection('clientEdits').get();
  const fsMap = new Map();
  snap.forEach(d => fsMap.set(d.id, d.data()));

  // 各利用者について、Firestore に未登録の自費レンタル品目を算出
  const targets = []; // { aozoraId, name, docExists, existingEq, toAdd[] }
  clients.forEach(c => {
    const baseSelfPay = (c.selectedEquipment || []).filter(e => e.status === '自費レンタル');
    if (baseSelfPay.length === 0) return;

    const edits = fsMap.get(c.aozoraId);
    const existingEq = (edits && edits.selectedEquipment) || [];
    const existingKeys = new Set(existingEq.map(eqKey));

    const toAdd = baseSelfPay.filter(e => !existingKeys.has(eqKey(e)));
    if (toAdd.length > 0) {
      targets.push({
        aozoraId: c.aozoraId,
        name: c.name,
        docExists: !!edits,
        existingEq,
        toAdd,
      });
    }
  });

  // ===== リスト出力 =====
  console.log('========================================');
  console.log(`移行対象（Firestoreに未登録の自費レンタルを持つ利用者）: ${targets.length} 名`);
  console.log('========================================\n');
  targets
    .sort((a, b) => Number(a.aozoraId) - Number(b.aozoraId))
    .forEach(t => {
      const docState = t.docExists ? '既存doc更新' : '新規doc作成';
      const prods = t.toAdd.map(e => `${e.selfPayProductName || e.name}(¥${e.taxIncludedAmount || e.unitPrice || 0})`).join(' / ');
      console.log(`  ${t.aozoraId}\t${t.name}\t[${docState}]\t${t.toAdd.length}件: ${prods}`);
    });
  console.log(`\n合計品目数: ${targets.reduce((s, t) => s + t.toAdd.length, 0)} 件`);

  // CSV にも保存
  const csvRows = ['あおぞらID,利用者名,doc状態,追加品目数,商品名'];
  targets.forEach(t => {
    const prods = t.toAdd.map(e => e.selfPayProductName || e.name).join(' / ');
    csvRows.push([t.aozoraId, `"${t.name}"`, t.docExists ? '既存doc更新' : '新規doc作成', t.toAdd.length, `"${prods}"`].join(','));
  });
  fs.writeFileSync('./selfpay_migration_targets.csv', '﻿' + csvRows.join('\r\n'), 'utf8');
  console.log('\n✓ リストを selfpay_migration_targets.csv に保存しました');

  if (!APPLY) {
    console.log('\n[DRY RUN] 書き込みは行っていません。実行するには --apply を付けてください。');
    process.exit(0);
  }

  // ===== Firestore 書き込み =====
  console.log('\n--- Firestore へ書き込み中 ---');
  let batch = db.batch();
  let opCount = 0;
  let committed = 0;
  for (const t of targets) {
    const ref = db.collection('clientEdits').doc(t.aozoraId);
    const newEq = [...t.existingEq, ...t.toAdd];
    if (t.docExists) {
      // 既存doc: selectedEquipment のみ部分更新（他フィールド保持）
      batch.update(ref, { selectedEquipment: newEq });
    } else {
      // 新規doc: merge で作成
      batch.set(ref, { aozoraId: t.aozoraId, selectedEquipment: newEq }, { merge: true });
    }
    opCount++;
    if (opCount >= 400) {
      await batch.commit();
      committed += opCount;
      console.log(`  ... ${committed} 件コミット`);
      batch = db.batch();
      opCount = 0;
    }
  }
  if (opCount > 0) {
    await batch.commit();
    committed += opCount;
  }
  console.log(`✓ 移行完了: ${committed} 名分を Firestore clientEdits に書き込みました`);
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); console.error(e.stack); process.exit(1); });
