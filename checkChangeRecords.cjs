const clients = require('./clients.json');

// 変更履歴があるクライアントを探す
const clientsWithRecords = clients.filter(c => c.changeRecords.length > 0).slice(0, 5);

console.log('利用初回日が登録されたサンプル:\n');
clientsWithRecords.forEach((client, i) => {
  console.log(`${i + 1}. ${client.name} (ID: ${client.aozoraId})`);
  console.log(`   福祉用具利用: ${client.isWelfareEquipmentUser ? 'はい' : 'いいえ'}`);
  console.log(`   変更履歴数: ${client.changeRecords.length}件`);

  client.changeRecords.forEach((record, j) => {
    console.log(`   [${j + 1}] 種類: ${record.infoType}`);
    console.log(`       請求開始日: ${record.billingStartDateNew}`);
    console.log(`       特記: ${record.note}`);
  });
  console.log('');
});
