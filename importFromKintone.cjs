require('dotenv').config();
const { KintoneRestAPIClient } = require('@kintone/rest-api-client');
const fs = require('fs');

async function importFromKintone() {
  try {
    console.log('kintoneからデータを取得中...\n');

    // 環境変数の確認
    const subdomain = process.env.KINTONE_SUBDOMAIN;
    const apiToken184 = process.env.KINTONE_API_TOKEN_184;
    const apiToken197 = process.env.KINTONE_API_TOKEN_197;

    if (!subdomain || !apiToken184 || !apiToken197) {
      console.error('エラー: 環境変数が設定されていません。');
      console.error('.envファイルに以下を設定してください:');
      console.error('  KINTONE_SUBDOMAIN=acgaozora');
      console.error('  KINTONE_API_TOKEN_184=your_api_token_for_app_184');
      console.error('  KINTONE_API_TOKEN_197=your_api_token_for_app_197');
      return;
    }

    // 既存のclients.jsonを読み込む
    const clientsPath = './clients.json';
    if (!fs.existsSync(clientsPath)) {
      console.error('エラー: clients.jsonが見つかりません。');
      return;
    }

    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    console.log(`既存の利用者データ: ${clients.length}件\n`);

    // あおぞらIDでクライアントを検索するMapを作成
    const clientsByAozoraId = new Map();
    clients.forEach(client => {
      clientsByAozoraId.set(client.aozoraId, client);
    });

    // アプリID 184（入院・退院情報）からデータを取得
    console.log('アプリID 184（入院・退院情報）からデータを取得中...');
    const client184 = new KintoneRestAPIClient({
      baseUrl: `https://${subdomain}.cybozu.com`,
      auth: { apiToken: apiToken184 }
    });

    const app184Records = await client184.record.getAllRecords({
      app: 184,
      condition: 'Start_Date >= "2025-11-01" or End_Date >= "2025-11-01"'
    });

    console.log(`✓ 取得件数: ${app184Records.length}件\n`);

    // アプリID 184のデータを処理（入院・退院情報）
    let app184Updated = 0;
    let app184NotFound = 0;

    app184Records.forEach(record => {
      const aozoraId = record.Aozora_Id?.value?.trim();
      const startDate = record.Start_Date?.value; // 入院日
      const endDate = record.End_Date?.value; // 退院日

      if (!aozoraId) return;

      const client = clientsByAozoraId.get(aozoraId);
      if (!client) {
        app184NotFound++;
        return;
      }

      // changeRecordsが存在しない場合は初期化
      if (!client.changeRecords) {
        client.changeRecords = [];
      }

      // 入院情報のchangeRecordを追加（開始日がある場合）
      if (startDate) {
        const recordId = `kintone-184-hospitalization-${record.$id.value}`;
        const existingIndex = client.changeRecords.findIndex(r => r.id === recordId);

        const changeRecord = {
          id: recordId,
          recordDate: startDate,
          office: '鹿児島（ACG）',
          infoType: '入院（サービス停止）',
          recorder: 'kintone自動連携',
          billingStartDateNew: '',
          billingStopDateCancel: '',
          billingStopDateHospital: startDate,
          wholesalerStopContactStatus: '未対応',
          billingStartDateDischarge: '',
          wholesalerResumeContactStatus: '未対応',
          usageCategory: '介護保険レンタル',
          note: `kintoneアプリID 184から自動連携（レコード番号: ${record.レコード番号?.value || record.$id.value}）`
        };

        if (existingIndex >= 0) {
          client.changeRecords[existingIndex] = changeRecord;
        } else {
          client.changeRecords.push(changeRecord);
        }
        app184Updated++;
      }

      // 退院情報のchangeRecordを追加（終了日がある場合）
      if (endDate) {
        const recordId = `kintone-184-discharge-${record.$id.value}`;
        const existingIndex = client.changeRecords.findIndex(r => r.id === recordId);

        const changeRecord = {
          id: recordId,
          recordDate: endDate,
          office: '鹿児島（ACG）',
          infoType: '退院（サービス開始）',
          recorder: 'kintone自動連携',
          billingStartDateNew: '',
          billingStopDateCancel: '',
          billingStopDateHospital: '',
          wholesalerStopContactStatus: '未対応',
          billingStartDateDischarge: endDate,
          wholesalerResumeContactStatus: '未対応',
          usageCategory: '介護保険レンタル',
          note: `kintoneアプリID 184から自動連携（レコード番号: ${record.レコード番号?.value || record.$id.value}）`
        };

        if (existingIndex >= 0) {
          client.changeRecords[existingIndex] = changeRecord;
        } else {
          client.changeRecords.push(changeRecord);
        }
      }
    });

    console.log(`✓ アプリID 184: ${app184Updated}件の変更レコードを追加/更新`);
    if (app184NotFound > 0) {
      console.log(`  ⚠ ${app184NotFound}件のレコードは利用者が見つかりませんでした\n`);
    } else {
      console.log('');
    }

    // アプリID 197（入居・退去情報）からデータを取得
    console.log('アプリID 197（入居・退去情報）からデータを取得中...');
    const client197 = new KintoneRestAPIClient({
      baseUrl: `https://${subdomain}.cybozu.com`,
      auth: { apiToken: apiToken197 }
    });

    const app197Records = await client197.record.getAllRecords({
      app: 197,
      condition: 'Move_In_Date >= "2025-11-01" or Moving_Out_Date >= "2025-11-01"'
    });

    console.log(`✓ 取得件数: ${app197Records.length}件\n`);

    // アプリID 197のデータを処理（入居・退去情報）
    let app197Updated = 0;
    let app197NotFound = 0;

    app197Records.forEach(record => {
      const aozoraId = record.Aozora_Id?.value?.trim();
      const moveInDate = record.Move_In_Date?.value; // 入居日
      const movingOutDate = record.Moving_Out_Date?.value; // 退去日

      if (!aozoraId) return;

      const client = clientsByAozoraId.get(aozoraId);
      if (!client) {
        app197NotFound++;
        return;
      }

      // changeRecordsが存在しない場合は初期化
      if (!client.changeRecords) {
        client.changeRecords = [];
      }

      // 入居情報のchangeRecordを追加（入居日がある場合）
      if (moveInDate) {
        const recordId = `kintone-197-movein-${record.$id.value}`;
        const existingIndex = client.changeRecords.findIndex(r => r.id === recordId);

        const changeRecord = {
          id: recordId,
          recordDate: moveInDate,
          office: '鹿児島（ACG）',
          infoType: '新規',
          recorder: 'kintone自動連携',
          billingStartDateNew: moveInDate,
          billingStopDateCancel: '',
          billingStopDateHospital: '',
          wholesalerStopContactStatus: '未対応',
          billingStartDateDischarge: '',
          wholesalerResumeContactStatus: '未対応',
          usageCategory: '介護保険レンタル',
          note: `kintoneアプリID 197から自動連携（レコード番号: ${record.レコード番号?.value || record.$id.value}）`
        };

        if (existingIndex >= 0) {
          client.changeRecords[existingIndex] = changeRecord;
        } else {
          client.changeRecords.push(changeRecord);
        }
        app197Updated++;
      }

      // 退去情報のchangeRecordを追加（退去日がある場合、かつ9999-12-31でない場合）
      if (movingOutDate && movingOutDate !== '9999-12-31') {
        const recordId = `kintone-197-moveout-${record.$id.value}`;
        const existingIndex = client.changeRecords.findIndex(r => r.id === recordId);

        const changeRecord = {
          id: recordId,
          recordDate: movingOutDate,
          office: '鹿児島（ACG）',
          infoType: '解約',
          recorder: 'kintone自動連携',
          billingStartDateNew: '',
          billingStopDateCancel: movingOutDate,
          billingStopDateHospital: '',
          wholesalerStopContactStatus: '未対応',
          billingStartDateDischarge: '',
          wholesalerResumeContactStatus: '未対応',
          usageCategory: '介護保険レンタル',
          note: `kintoneアプリID 197から自動連携（レコード番号: ${record.レコード番号?.value || record.$id.value}）`
        };

        if (existingIndex >= 0) {
          client.changeRecords[existingIndex] = changeRecord;
        } else {
          client.changeRecords.push(changeRecord);
        }
      }
    });

    console.log(`✓ アプリID 197: ${app197Updated}件の変更レコードを追加/更新`);
    if (app197NotFound > 0) {
      console.log(`  ⚠ ${app197NotFound}件のレコードは利用者が見つかりませんでした\n`);
    } else {
      console.log('');
    }

    // clients.jsonに保存
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf8');
    console.log('✓ clients.jsonを更新しました\n');

    // サマリー表示
    console.log('【完了】');
    console.log(`アプリID 184: ${app184Updated}件の変更レコードを処理`);
    console.log(`アプリID 197: ${app197Updated}件の変更レコードを処理`);
    console.log(`合計: ${app184Updated + app197Updated}件の変更レコードをclients.jsonに追加/更新しました`);

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    console.error(error.stack);
  }
}

importFromKintone();
