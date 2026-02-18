/**
 * 初回レセプトチェックデータ投入スクリプト
 * CSVファイルをパースしてFirestoreのreceiptChecksコレクションに保存し、
 * 各利用者のlocation（拠点）をclientEditsに保存する
 *
 * Usage: node importReceiptCheck.cjs <csvファイルパス> <月度(YYYY-MM)>
 * Example: node importReceiptCheck.cjs "レセプトサンプルデータ - シート2.csv" 2026-02
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./service-account-key.json')),
    projectId: 'welfare-assist-pro'
  });
}

const db = admin.firestore();

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseBool(val) {
  return val === '〇' || val === '○';
}

function getCol(row, idx) {
  return idx >= 0 && idx < row.length ? row[idx] : '';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node importReceiptCheck.cjs <csvファイルパス> <月度(YYYY-MM)>');
    console.error('Example: node importReceiptCheck.cjs "レセプトサンプルデータ.csv" 2026-02');
    process.exit(1);
  }

  const csvPath = args[0];
  const billingMonth = args[1];
  const office = '全事業所';

  // CSVファイル読み込み（UTF-8 BOM対応）
  let csvText = fs.readFileSync(csvPath, 'utf-8');
  csvText = csvText.replace(/^\uFEFF/, '');

  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) {
    console.error('CSVにデータがありません');
    process.exit(1);
  }

  const headers = parseCSVLine(lines[0]);
  console.log(`ヘッダー: ${headers.join(' | ')}`);

  // ヘッダーからインデックスを取得
  const colIdx = (name) => headers.findIndex(h => h.includes(name));
  const iAozoraId = colIdx('あおぞらID') !== -1 ? colIdx('あおぞらID') : colIdx('利用者名（あおぞらID）');
  const iClientName = headers.findIndex((h, i) => h === '利用者名' && i !== iAozoraId);
  const iOfficeName = colIdx('事業所名');
  const iUnits = colIdx('単位数');
  const iProvisionTicket = colIdx('提供票受領');
  const iUnitsDiff = colIdx('単位数の差異') !== -1 ? colIdx('単位数の差異') : colIdx('単位数差異');
  const iChanged = colIdx('先月からの変更');
  const iKaipokePlan = colIdx('カイポケ計画書');
  const iWelfareRecipient = colIdx('生保受給');
  const iWelfareCareTicket = colIdx('生保介護券');
  const iFirstUse = colIdx('利用初回日');
  const iHospital = colIdx('入院日');
  const iDischarge = colIdx('退院日');
  const iCancel = colIdx('解約日');
  const iReflected = colIdx('管理表から反映');
  const iPerformance = colIdx('実績報告書');
  const iDelayed = colIdx('月遅れ');
  const iLocation = colIdx('拠点');
  const iCareOffice = colIdx('介護事業所');

  // パース
  const items = [];
  const locationByAozoraId = new Map(); // aozoraId → location

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const aozoraId = getCol(cols, iAozoraId);
    if (!aozoraId) continue;

    const location = getCol(cols, iLocation);

    items.push({
      aozoraId,
      clientName: getCol(cols, iClientName),
      office: getCol(cols, iOfficeName),
      units: parseInt(getCol(cols, iUnits), 10) || 0,
      provisionTicketReceived: parseBool(getCol(cols, iProvisionTicket)),
      unitsDifference: parseBool(getCol(cols, iUnitsDiff)),
      changedFromLastMonth: parseBool(getCol(cols, iChanged)),
      kaipokePlanCreated: parseBool(getCol(cols, iKaipokePlan)),
      welfareRecipient: parseBool(getCol(cols, iWelfareRecipient)),
      welfareCareTicket: parseBool(getCol(cols, iWelfareCareTicket)),
      firstUseDate: getCol(cols, iFirstUse),
      hospitalizationDate: getCol(cols, iHospital),
      dischargeDate: getCol(cols, iDischarge),
      cancellationDate: getCol(cols, iCancel),
      reflectedFromManagement: parseBool(getCol(cols, iReflected)),
      performanceReport: parseBool(getCol(cols, iPerformance)),
      delayed: parseBool(getCol(cols, iDelayed)),
      location,
      careOffice: getCol(cols, iCareOffice)
    });

    if (location) {
      locationByAozoraId.set(aozoraId, location);
    }
  }

  console.log(`\n✓ ${items.length}件のレセプトチェックデータをパース`);
  console.log(`✓ ${locationByAozoraId.size}件の拠点データあり`);

  // 1. receiptChecksコレクションに保存
  const docId = `${billingMonth}_${office}`;
  const receiptCheckDoc = {
    billingMonth,
    office,
    items,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'importReceiptCheck.cjs'
  };

  await db.collection('receiptChecks').doc(docId).set(receiptCheckDoc);
  console.log(`✓ receiptChecks/${docId} に保存完了`);

  // 2. 各利用者のlocationをclientEditsに保存
  let locationUpdated = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const [aozoraId, location] of locationByAozoraId) {
    const docRef = db.collection('clientEdits').doc(aozoraId);
    batch.set(docRef, {
      location,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'importReceiptCheck.cjs'
    }, { merge: true });

    locationUpdated++;
    batchCount++;

    // Firestoreバッチは500件制限
    if (batchCount >= 400) {
      await batch.commit();
      console.log(`  → ${locationUpdated}件のlocationを保存中...`);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }
  console.log(`✓ ${locationUpdated}件の利用者にlocationを保存完了`);

  console.log('\n=== インポート完了 ===');
  console.log(`  レセプトチェック: ${items.length}件 → receiptChecks/${docId}`);
  console.log(`  拠点データ: ${locationUpdated}件 → clientEdits/{aozoraId}.location`);
}

main().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
