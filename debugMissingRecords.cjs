require('dotenv').config();
const { KintoneRestAPIClient } = require('@kintone/rest-api-client');
const fs = require('fs');

async function debugMissingRecords() {
  try {
    const subdomain = process.env.KINTONE_SUBDOMAIN;
    const apiToken197 = process.env.KINTONE_API_TOKEN_197;

    const client197 = new KintoneRestAPIClient({
      baseUrl: `https://${subdomain}.cybozu.com`,
      auth: { apiToken: apiToken197 }
    });

    // clients.jsonを読み込む
    const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf-8'));

    console.log('=== 3件のレコードのKintoneデータ詳細 ===\n');

    // 問題の3件のレコードをKintoneから取得
    const recordIds = [999, 1003, 1020];

    for (const recordId of recordIds) {
      const response = await client197.record.getRecord({
        app: 197,
        id: recordId
      });

      const record = response.record;
      const kintoneAozoraId = record.Aozora_Id?.value;
      const moveInDate = record.Move_In_Date?.value;
      const movingOutDate = record.Moving_Out_Date?.value;

      console.log(`レコード番号: ${recordId}`);
      console.log(`  あおぞらID (raw): "${kintoneAozoraId}"`);
      console.log(`  あおぞらID (trimmed): "${kintoneAozoraId?.trim()}"`);
      console.log(`  入居日: ${moveInDate}`);
      console.log(`  退去日: ${movingOutDate}`);

      // clients.jsonで検索
      const matchedByRaw = clients.find(c => c.aozoraId === kintoneAozoraId);
      const matchedByTrim = clients.find(c => c.aozoraId === kintoneAozoraId?.trim());

      console.log(`  clients.json マッチ (raw): ${matchedByRaw ? 'あり' : 'なし'}`);
      console.log(`  clients.json マッチ (trim): ${matchedByTrim ? 'あり' : 'なし'}`);

      if (matchedByTrim) {
        console.log(`  名前: ${matchedByTrim.name}`);
        console.log(`  福祉用具: ${matchedByTrim.isWelfareEquipmentUser}`);
        console.log(`  changeRecords: ${matchedByTrim.changeRecords ? matchedByTrim.changeRecords.length : 0}件`);
      }

      // importFromKintone.cjsのロジックをシミュレート
      if (kintoneAozoraId && moveInDate) {
        const client = clients.find(c => c.aozoraId === kintoneAozoraId?.trim());
        if (client) {
          const recordIdStr = `kintone-197-movein-${recordId}`;
          const existingIndex = client.changeRecords ? client.changeRecords.findIndex(r => r.id === recordIdStr) : -1;
          console.log(`  レコードID: ${recordIdStr}`);
          console.log(`  既存のchangeRecord: ${existingIndex >= 0 ? 'あり (インデックス: ' + existingIndex + ')' : 'なし'}`);

          // changeRecordsが存在しない場合
          if (!client.changeRecords) {
            console.log(`  ⚠ changeRecordsが存在しないため、初期化が必要`);
          }
        }
      }

      console.log('');
    }

  } catch (error) {
    console.error('エラー:', error.message);
  }
}

debugMissingRecords();
