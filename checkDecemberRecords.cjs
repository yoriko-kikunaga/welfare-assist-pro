const fs = require('fs');

// clients.jsonを読み込む
const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf-8'));

console.log('=== 12月の請求開始日（新規）レコード確認 ===\n');

// 福祉用具利用者のみをフィルター
const welfareClients = clients.filter(c => c.isWelfareEquipmentUser);
console.log(`福祉用具利用者数: ${welfareClients.length}件\n`);

// 月ごとの集計
const monthCounts = {};
const decemberRecords = [];

welfareClients.forEach(client => {
  if (client.changeRecords && Array.isArray(client.changeRecords)) {
    client.changeRecords.forEach(record => {
      // 請求開始日（新規）がある場合
      if (record.billingStartDateNew) {
        const date = record.billingStartDateNew;
        const month = date.substring(0, 7); // YYYY-MM

        monthCounts[month] = (monthCounts[month] || 0) + 1;

        // 2025-12のレコードを収集
        if (month === '2025-12') {
          decemberRecords.push({
            date: date,
            aozoraId: client.aozoraId,
            name: client.name,
            infoType: record.infoType,
            recorder: record.recorder,
            recordDate: record.recordDate
          });
        }
      }
    });
  }
});

// 月ごとの集計を表示（ソート済み）
console.log('=== 月ごとの請求開始日（新規）件数 ===');
Object.keys(monthCounts).sort().forEach(month => {
  console.log(`${month}: ${monthCounts[month]}件`);
});

console.log(`\n=== 2025年12月の詳細（${decemberRecords.length}件）===`);
if (decemberRecords.length > 0) {
  // 日付でソート
  decemberRecords.sort((a, b) => a.date.localeCompare(b.date));

  console.log('\n最初の10件:');
  decemberRecords.slice(0, 10).forEach((rec, idx) => {
    console.log(`${idx + 1}. ${rec.date} - ${rec.name} (${rec.aozoraId}) - ${rec.recorder}`);
  });

  if (decemberRecords.length > 10) {
    console.log(`\n... 他 ${decemberRecords.length - 10}件`);
  }
} else {
  console.log('2025年12月のレコードが見つかりませんでした');
}

// 2025-11と2025-12の比較
const nov2025 = monthCounts['2025-11'] || 0;
const dec2025 = monthCounts['2025-12'] || 0;
console.log(`\n=== 2025年11月と12月の比較 ===`);
console.log(`2025-11: ${nov2025}件`);
console.log(`2025-12: ${dec2025}件`);

// kintone自動連携のレコードを確認
const kintoneRecords = decemberRecords.filter(r => r.recorder === 'kintone自動連携');
console.log(`\nkintone自動連携: ${kintoneRecords.length}件`);
console.log(`手動入力: ${decemberRecords.length - kintoneRecords.length}件`);
