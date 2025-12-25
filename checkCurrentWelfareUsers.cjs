const fs = require('fs');

const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf-8'));
const welfareUsers = clients.filter(c => c.isWelfareEquipmentUser);

console.log('=== 現在の福祉用具利用者 ===\n');
console.log(`総利用者数: ${clients.length}件`);
console.log(`福祉用具利用者数: ${welfareUsers.length}件\n`);

console.log('最初の20名:');
welfareUsers.slice(0, 20).forEach((c, i) => {
  console.log(`${i+1}. ${c.aozoraId} ${c.name} (${c.facilityName || '施設なし'})`);
});

console.log('\n最後の20名:');
welfareUsers.slice(-20).forEach((c, i) => {
  console.log(`${welfareUsers.length - 20 + i + 1}. ${c.aozoraId} ${c.name} (${c.facilityName || '施設なし'})`);
});

// 12月に追加した22名を確認
console.log('\n=== 12月に追加した福祉用具利用者 ===');
const dec2025Ids = ['8505', '8501', '8547', '8553', '8539', '8533', '8521', '8527', '8531', '8579', '8502', '8561', '8555', '8566', '8568', '8511', '7795', '8560', '8473', '8565', '8578', '8599'];

let foundCount = 0;
dec2025Ids.forEach(id => {
  const client = clients.find(c => c.aozoraId === id);
  if (client) {
    console.log(`${id} ${client.name}: ${client.isWelfareEquipmentUser ? '✓ 福祉用具利用者' : '✗ 福祉用具利用者でない'}`);
    if (client.isWelfareEquipmentUser) foundCount++;
  } else {
    console.log(`${id}: 見つかりません`);
  }
});

console.log(`\n12月追加分: ${foundCount}/22件が福祉用具利用者`);
