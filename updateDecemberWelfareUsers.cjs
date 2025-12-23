require('dotenv').config();
const { KintoneRestAPIClient } = require('@kintone/rest-api-client');
const fs = require('fs');

async function updateDecemberWelfareUsers() {
  try {
    const subdomain = process.env.KINTONE_SUBDOMAIN;
    const apiToken197 = process.env.KINTONE_API_TOKEN_197;

    const client197 = new KintoneRestAPIClient({
      baseUrl: `https://${subdomain}.cybozu.com`,
      auth: { apiToken: apiToken197 }
    });

    // clients.jsonを読み込む
    const clientsPath = './clients.json';
    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf-8'));
    const clientsByAozoraId = new Map();
    clients.forEach(client => {
      clientsByAozoraId.set(client.aozoraId, client);
    });

    console.log('=== 2025年12月入居者を福祉用具利用者として登録 ===\n');

    // 2025年12月のKintoneデータを取得
    const dec2025Records = await client197.record.getAllRecords({
      app: 197,
      condition: 'Move_In_Date >= "2025-12-01" and Move_In_Date <= "2025-12-31"'
    });

    console.log(`Kintoneの2025-12入居データ: ${dec2025Records.length}件\n`);

    let updatedCount = 0;
    let alreadyWelfareCount = 0;
    let notFoundCount = 0;

    const updatedList = [];

    dec2025Records.forEach(record => {
      const aozoraId = record.Aozora_Id?.value?.trim();
      const moveInDate = record.Move_In_Date?.value;

      if (!aozoraId) return;

      const client = clientsByAozoraId.get(aozoraId);

      if (!client) {
        notFoundCount++;
        console.log(`⚠ あおぞらID ${aozoraId} が見つかりません`);
        return;
      }

      if (client.isWelfareEquipmentUser) {
        alreadyWelfareCount++;
      } else {
        // 福祉用具利用者フラグを立てる
        client.isWelfareEquipmentUser = true;
        updatedCount++;
        updatedList.push({
          aozoraId: client.aozoraId,
          name: client.name,
          facilityName: client.facilityName,
          moveInDate: moveInDate
        });
      }
    });

    console.log('=== 更新結果 ===');
    console.log(`✓ 福祉用具利用者に設定: ${updatedCount}件`);
    console.log(`- すでに福祉用具利用者: ${alreadyWelfareCount}件`);
    if (notFoundCount > 0) {
      console.log(`✗ 見つからない: ${notFoundCount}件`);
    }
    console.log('');

    if (updatedList.length > 0) {
      console.log('=== 福祉用具利用者に設定した利用者 ===');
      updatedList.forEach((item, idx) => {
        console.log(`${idx + 1}. ${item.aozoraId} ${item.name} (${item.facilityName}) - 入居日: ${item.moveInDate}`);
      });
      console.log('');

      // clients.jsonを保存
      fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf-8');
      console.log('✓ clients.jsonを更新しました\n');

      // 福祉用具利用者の総数を表示
      const totalWelfareUsers = clients.filter(c => c.isWelfareEquipmentUser).length;
      console.log(`福祉用具利用者の総数: ${totalWelfareUsers}件（更新前: ${totalWelfareUsers - updatedCount}件）`);
    } else {
      console.log('更新するレコードはありませんでした');
    }

  } catch (error) {
    console.error('エラー:', error.message);
    if (error.response) {
      console.error('APIレスポンス:', error.response.data);
    }
  }
}

updateDecemberWelfareUsers();
