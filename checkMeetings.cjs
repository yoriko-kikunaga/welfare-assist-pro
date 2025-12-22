const clients = require('./clients.json');

// 議事録があるクライアントを探す
const clientsWithMeetings = clients.filter(c => c.meetings.length > 0).slice(0, 5);

console.log('居宅介護支援事業所が登録されたサンプル:\n');
clientsWithMeetings.forEach((client, i) => {
  console.log(`${i + 1}. ${client.name} (ID: ${client.aozoraId})`);
  console.log(`   福祉用具利用: ${client.isWelfareEquipmentUser ? 'はい' : 'いいえ'}`);
  console.log(`   議事録数: ${client.meetings.length}件`);

  client.meetings.forEach((meeting, j) => {
    console.log(`   [${j + 1}] 種類: ${meeting.type}`);
    console.log(`       居宅介護支援事業所: ${meeting.careSupportOffice}`);
    console.log(`       事業所: ${meeting.office}`);
  });
  console.log('');
});
