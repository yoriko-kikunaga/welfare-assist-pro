const clients = require('./clients.json');

// 更新されたデータの統計を取得
const stats = {
  total: clients.length,
  withCareLevel: clients.filter(c => c.careLevel && c.careLevel !== '申請中').length,
  withCopayRate: clients.filter(c => c.copayRate).length,
  withCareManager: clients.filter(c => c.careManager).length,
  careLevel1: clients.filter(c => c.careLevel === '要介護1').length,
  careLevel2: clients.filter(c => c.careLevel === '要介護2').length,
  careLevel3: clients.filter(c => c.careLevel === '要介護3').length,
  careLevel4: clients.filter(c => c.careLevel === '要介護4').length,
  careLevel5: clients.filter(c => c.careLevel === '要介護5').length,
  support1: clients.filter(c => c.careLevel === '要支援1').length,
  support2: clients.filter(c => c.careLevel === '要支援2').length,
  copay1: clients.filter(c => c.copayRate === '1割').length,
  copay2: clients.filter(c => c.copayRate === '2割').length,
  copay3: clients.filter(c => c.copayRate === '3割').length,
};

console.log('【データ更新統計】\n');
console.log(`総クライアント数: ${stats.total}件`);
console.log(`\n要介護度が設定されているクライアント: ${stats.withCareLevel}件`);
console.log(`  要支援1: ${stats.support1}件`);
console.log(`  要支援2: ${stats.support2}件`);
console.log(`  要介護1: ${stats.careLevel1}件`);
console.log(`  要介護2: ${stats.careLevel2}件`);
console.log(`  要介護3: ${stats.careLevel3}件`);
console.log(`  要介護4: ${stats.careLevel4}件`);
console.log(`  要介護5: ${stats.careLevel5}件`);

console.log(`\n負担割合が設定されているクライアント: ${stats.withCopayRate}件`);
console.log(`  1割: ${stats.copay1}件`);
console.log(`  2割: ${stats.copay2}件`);
console.log(`  3割: ${stats.copay3}件`);

console.log(`\n担当CMが設定されているクライアント: ${stats.withCareManager}件`);

// サンプルデータ表示
console.log('\n【サンプルクライアント】');
const samples = clients.filter(c => c.careLevel && c.careLevel !== '申請中' && c.careManager).slice(0, 5);

samples.forEach((client, i) => {
  console.log(`\n${i + 1}. ${client.name} (${client.nameKana})`);
  console.log(`   あおぞらID: ${client.aozoraId}`);
  console.log(`   要介護度: ${client.careLevel}`);
  console.log(`   負担割合: ${client.copayRate}`);
  console.log(`   居宅介護支援事業所: ${client.careSupportOffice}`);
  console.log(`   担当CM: ${client.careManager}`);
});
