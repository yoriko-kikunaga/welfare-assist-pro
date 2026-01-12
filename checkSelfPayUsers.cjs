const fs = require('fs');

const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
const selfPayIds = ['8501', '8553', '8534', '5856', '8561', '7795', '8262', '8524', '8640', '8629', '7418'];

console.log('=== 自費レンタル利用者の確認 ===\n');

let foundCount = 0;
let welfareUserCount = 0;
let withEquipmentCount = 0;
let withSalesCount = 0;

selfPayIds.forEach(id => {
  const client = clients.find(c => c.aozoraId === id);
  if (client) {
    foundCount++;
    console.log(`✓ ${id}: ${client.name}`);
    console.log(`  - 福祉用具利用者: ${client.isWelfareEquipmentUser}`);

    const selfPayEquipment = client.selectedEquipment?.filter(e => e.status === '自費レンタル') || [];
    console.log(`  - 自費レンタル用具数: ${selfPayEquipment.length}件`);
    console.log(`  - 売上レコード数: ${client.salesRecords?.length || 0}件`);

    if (client.isWelfareEquipmentUser) welfareUserCount++;
    if (selfPayEquipment.length > 0) withEquipmentCount++;
    if (client.salesRecords?.length > 0) withSalesCount++;

    if (selfPayEquipment.length > 0) {
      selfPayEquipment.forEach(eq => {
        console.log(`    - [${eq.status}] ${eq.name || eq.selfPayProductName}: ¥${eq.taxIncludedAmount || 0}`);
      });
    }
    console.log('');
  } else {
    console.log(`✗ ${id}: 見つかりません`);
    console.log('');
  }
});

console.log('=== サマリー ===');
console.log(`検索対象: ${selfPayIds.length}件`);
console.log(`見つかった: ${foundCount}件`);
console.log(`福祉用具利用者フラグON: ${welfareUserCount}件`);
console.log(`自費レンタル用具あり: ${withEquipmentCount}件`);
console.log(`売上レコードあり: ${withSalesCount}件`);
