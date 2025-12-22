const clients = require('./clients.json');

// 居宅介護支援事業所がある基本情報のサンプル
const clientsWithCareOffice = clients.filter(c => c.careSupportOffice).slice(0, 5);

console.log('基本情報に居宅介護支援事業所が登録されたサンプル:\n');
clientsWithCareOffice.forEach((client, i) => {
  console.log(`${i + 1}. ${client.name} (ID: ${client.aozoraId})`);
  console.log(`   福祉用具利用: ${client.isWelfareEquipmentUser ? 'はい' : 'いいえ'}`);
  console.log(`   居宅介護支援事業所: ${client.careSupportOffice}`);
  console.log(`   担当CM: ${client.careManager}`);
  console.log(`   議事録数: ${client.meetings.length}件`);
  console.log('');
});
