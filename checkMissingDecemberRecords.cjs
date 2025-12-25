require('dotenv').config();
const { KintoneRestAPIClient } = require('@kintone/rest-api-client');
const fs = require('fs');

async function checkMissingDecemberRecords() {
  try {
    const subdomain = process.env.KINTONE_SUBDOMAIN;
    const apiToken197 = process.env.KINTONE_API_TOKEN_197;

    const client197 = new KintoneRestAPIClient({
      baseUrl: `https://${subdomain}.cybozu.com`,
      auth: { apiToken: apiToken197 }
    });

    // clients.jsonを読み込む
    const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf-8'));
    const clientsByAozoraId = new Map();
    clients.forEach(client => {
      clientsByAozoraId.set(client.aozoraId, client);
    });

    console.log('=== 12月のレコードが反映されない原因調査 ===\n');
    console.log(`clients.json の総数: ${clients.length}件`);
    console.log(`福祉用具利用者: ${clients.filter(c => c.isWelfareEquipmentUser).length}件\n`);

    // 2025年12月のKintoneデータを取得
    const dec2025Records = await client197.record.getAllRecords({
      app: 197,
      condition: 'Move_In_Date >= "2025-12-01" and Move_In_Date <= "2025-12-31"'
    });

    console.log(`Kintoneの2025-12データ: ${dec2025Records.length}件\n`);

    let foundInClients = 0;
    let notFoundInClients = 0;
    let foundButNotWelfare = 0;
    let foundAndWelfare = 0;

    const notFoundList = [];
    const notWelfareList = [];

    dec2025Records.forEach(record => {
      const aozoraId = record.Aozora_Id?.value?.trim();
      const moveInDate = record.Move_In_Date?.value;

      if (!aozoraId) {
        console.log('⚠ あおぞらIDが空のレコード:', record.$id.value);
        return;
      }

      const client = clientsByAozoraId.get(aozoraId);

      if (!client) {
        notFoundInClients++;
        notFoundList.push({
          aozoraId,
          moveInDate,
          recordId: record.$id.value
        });
      } else {
        foundInClients++;
        if (client.isWelfareEquipmentUser) {
          foundAndWelfare++;
        } else {
          foundButNotWelfare++;
          notWelfareList.push({
            aozoraId,
            name: client.name,
            moveInDate,
            facilityName: client.facilityName
          });
        }
      }
    });

    console.log('=== 分析結果 ===');
    console.log(`✓ clients.jsonに存在: ${foundInClients}件`);
    console.log(`  - うち福祉用具利用者: ${foundAndWelfare}件`);
    console.log(`  - うち福祉用具利用者でない: ${foundButNotWelfare}件`);
    console.log(`✗ clients.jsonに存在しない: ${notFoundInClients}件\n`);

    if (notFoundList.length > 0) {
      console.log('=== clients.jsonに存在しないあおぞらID ===');
      notFoundList.forEach(item => {
        console.log(`- ${item.aozoraId} (入居日: ${item.moveInDate}, レコード番号: ${item.recordId})`);
      });
      console.log('');
    }

    if (notWelfareList.length > 0) {
      console.log('=== 福祉用具利用者フラグが立っていない利用者 ===');
      notWelfareList.forEach(item => {
        console.log(`- ${item.aozoraId} ${item.name} (${item.facilityName}) - 入居日: ${item.moveInDate}`);
      });
      console.log('');
    }

    console.log('=== 結論 ===');
    console.log(`スプレッドシートに表示されるべき件数: ${foundAndWelfare}件`);
    console.log(`実際に表示されている件数: 2件`);
    console.log(`差分: ${foundAndWelfare - 2}件`);

    if (foundAndWelfare > 2) {
      console.log('\n⚠ importFromKintone.cjs を再実行する必要があります。');
    }

  } catch (error) {
    console.error('エラー:', error.message);
  }
}

checkMissingDecemberRecords();
