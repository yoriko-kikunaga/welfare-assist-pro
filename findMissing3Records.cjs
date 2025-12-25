require('dotenv').config();
const { KintoneRestAPIClient } = require('@kintone/rest-api-client');
const fs = require('fs');

async function findMissing3Records() {
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

    console.log('=== 12月の3件の差分を調査 ===\n');

    // Kintoneから12月のデータを取得
    const dec2025Records = await client197.record.getAllRecords({
      app: 197,
      condition: 'Move_In_Date >= "2025-12-01" and Move_In_Date <= "2025-12-31"'
    });

    console.log(`Kintone 12月データ: ${dec2025Records.length}件\n`);

    const kintoneAozoraIds = new Set();
    dec2025Records.forEach(rec => {
      const aozoraId = rec.Aozora_Id?.value?.trim();
      if (aozoraId) {
        kintoneAozoraIds.add(aozoraId);
      }
    });

    console.log('Kintoneの12月入居者あおぞらID:', Array.from(kintoneAozoraIds).sort().join(', '));
    console.log('');

    // clients.jsonから12月のchangeRecordsを持つ利用者を抽出
    const clientsWithDec2025Records = new Set();
    clients.forEach(client => {
      if (client.isWelfareEquipmentUser && client.changeRecords) {
        client.changeRecords.forEach(rec => {
          if (rec.billingStartDateNew && rec.billingStartDateNew.startsWith('2025-12')) {
            clientsWithDec2025Records.add(client.aozoraId);
          }
        });
      }
    });

    console.log(`clients.jsonの12月changeRecords: ${clientsWithDec2025Records.size}件`);
    console.log('clients.jsonの12月レコードを持つあおぞらID:', Array.from(clientsWithDec2025Records).sort().join(', '));
    console.log('');

    // 差分を検出
    const missingInClients = Array.from(kintoneAozoraIds).filter(id => !clientsWithDec2025Records.has(id));

    console.log(`=== 差分: ${missingInClients.length}件 ===`);
    if (missingInClients.length > 0) {
      console.log('Kintoneにあるが、clients.jsonのchangeRecordsにない:');
      missingInClients.forEach(aozoraId => {
        const client = clientsByAozoraId.get(aozoraId);
        if (client) {
          console.log(`- ${aozoraId} ${client.name} (福祉用具: ${client.isWelfareEquipmentUser})`);

          // このクライアントのchangeRecordsを確認
          const kintoneRec = dec2025Records.find(r => r.Aozora_Id?.value?.trim() === aozoraId);
          if (kintoneRec) {
            console.log(`  Kintone: 入居日=${kintoneRec.Move_In_Date?.value}, 退去日=${kintoneRec.Moving_Out_Date?.value}, レコード番号=${kintoneRec.$id.value}`);
          }

          if (client.changeRecords) {
            const relatedRecords = client.changeRecords.filter(r =>
              r.id && r.id.includes('kintone-197')
            );
            console.log(`  changeRecords数: ${client.changeRecords.length}件, kintone-197関連: ${relatedRecords.length}件`);
            relatedRecords.forEach(r => {
              console.log(`    - ${r.id}: ${r.infoType}, 新規=${r.billingStartDateNew}, 解約=${r.billingStopDateCancel}`);
            });
          } else {
            console.log(`  changeRecords: なし`);
          }
        } else {
          console.log(`- ${aozoraId} (clients.jsonに存在しない)`);
        }
      });
    }

  } catch (error) {
    console.error('エラー:', error.message);
  }
}

findMissing3Records();
