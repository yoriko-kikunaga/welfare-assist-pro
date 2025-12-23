const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function importWelfareData() {
  try {
    console.log('福祉用具利用者情報をインポート中...\n');

    // 既存のclients.jsonを読み込む
    const clientsPath = './clients.json';
    if (!fs.existsSync(clientsPath)) {
      console.error('エラー: clients.jsonが見つかりません。先にimportSpreadsheetData.cjsを実行してください。');
      return;
    }

    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    console.log(`既存の利用者データ: ${clients.length}件\n`);

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // 福祉用具利用者のあおぞらIDと関連情報を取得
    console.log('福祉用具利用者スプレッドシートからデータを読み込み中...');
    const welfareSpreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';
    const welfareResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: 'シート1!B:V',
    });

    const welfareRows = welfareResponse.data.values;
    const welfareData = welfareRows.slice(1); // ヘッダー行を除く

    // 福祉用具利用者の情報をMapに格納
    const welfareEquipmentUserIds = new Set();
    const seihoUsers = new Map(); // あおぞらID -> 生保受給フラグ
    const utilizationStartDates = new Map(); // あおぞらID -> 利用初回日
    const careSupportOffices = new Map(); // あおぞらID -> 居宅介護支援事業所

    welfareData.forEach(row => {
      const aozoraId = row[0]; // B列: 利用者名（あおぞらID）
      const seihoReceiving = row[7]; // I列: 生保受給（0-indexedなので7）
      const startDate = row[9]; // K列: 利用初回日（0-indexedなので9）
      const careOffice = row[20]; // V列: 介護事業所（0-indexedなので20）

      if (aozoraId) {
        welfareEquipmentUserIds.add(aozoraId);

        // 生保受給に〇がついている場合
        if (seihoReceiving === '〇') {
          seihoUsers.set(aozoraId, true);
        }

        // 利用初回日が存在する場合
        if (startDate) {
          utilizationStartDates.set(aozoraId, startDate);
        }

        // 居宅介護支援事業所が存在する場合
        if (careOffice) {
          careSupportOffices.set(aozoraId, careOffice);
        }
      }
    });

    console.log(`福祉用具利用者: ${welfareEquipmentUserIds.size}件`);
    console.log(`生保受給者: ${seihoUsers.size}件`);
    console.log(`利用初回日あり: ${utilizationStartDates.size}件`);
    console.log(`居宅介護支援事業所あり: ${careSupportOffices.size}件\n`);

    // クライアントデータを更新
    console.log('クライアントデータを更新中...\n');
    let welfareUserUpdated = 0;
    let seihoUpdated = 0;
    let startDateUpdated = 0;
    let careSupportOfficeUpdated = 0;

    clients.forEach(client => {
      const aozoraId = client.aozoraId;

      // 福祉用具利用者フラグを更新
      if (welfareEquipmentUserIds.has(aozoraId)) {
        if (!client.isWelfareEquipmentUser) {
          client.isWelfareEquipmentUser = true;
          welfareUserUpdated++;
        }

        // 生保受給フラグを更新
        if (seihoUsers.has(aozoraId)) {
          if (client.paymentType !== '生保') {
            client.paymentType = '生保';
            seihoUpdated++;
          }
        }

        // 居宅介護支援事業所を更新
        if (careSupportOffices.has(aozoraId)) {
          const careOffice = careSupportOffices.get(aozoraId);
          if (client.careSupportOffice !== careOffice) {
            client.careSupportOffice = careOffice;
            careSupportOfficeUpdated++;
          }
        }

        // 利用初回日を変更履歴に追加（既存のレコードがない場合のみ）
        if (utilizationStartDates.has(aozoraId)) {
          const rawStartDate = utilizationStartDates.get(aozoraId);

          // 日付をYYYY-MM-DD形式に変換
          let formattedStartDate = '';
          const dateMatch = rawStartDate.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
          if (dateMatch) {
            const year = dateMatch[1];
            const month = dateMatch[2].padStart(2, '0');
            const day = dateMatch[3].padStart(2, '0');
            formattedStartDate = `${year}-${month}-${day}`;
          }

          if (formattedStartDate) {
            // 同じIDの変更レコードが既に存在するかチェック
            const existingRecord = client.changeRecords.find(r => r.id === `${aozoraId}-initial`);
            if (!existingRecord) {
              client.changeRecords.push({
                id: `${aozoraId}-initial`,
                recordDate: formattedStartDate,
                office: '鹿児島（ACG）',
                infoType: '新規',
                recorder: '',
                usageCategory: '介護保険レンタル',
                billingStartDateNew: formattedStartDate,
                billingStopDateCancel: '',
                billingStopDateHospital: '',
                wholesalerStopContactStatus: '未対応',
                billingStartDateDischarge: '',
                wholesalerResumeContactStatus: '未対応',
                note: ''
              });
              startDateUpdated++;
            }
          }
        }
      }
    });

    // 更新したデータを保存
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf8');

    console.log(`✓ データを ${clientsPath} に保存しました`);
    console.log(`✓ 福祉用具利用者フラグ更新: ${welfareUserUpdated}件`);
    console.log(`✓ 生保受給フラグ更新: ${seihoUpdated}件`);
    console.log(`✓ 利用初回日追加: ${startDateUpdated}件`);
    console.log(`✓ 居宅介護支援事業所更新: ${careSupportOfficeUpdated}件`);
    console.log(`\n✓ 総福祉用具利用者数: ${clients.filter(c => c.isWelfareEquipmentUser).length}件`);
    console.log(`✓ 総生保受給者数: ${clients.filter(c => c.paymentType === '生保').length}件`);
    console.log(`✓ 変更履歴あり: ${clients.filter(c => c.changeRecords.length > 0).length}件`);

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

importWelfareData();
