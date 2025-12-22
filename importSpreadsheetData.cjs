const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function importSpreadsheetData() {
  try {
    console.log('スプレッドシートからデータを取得中...\n');

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = '1DhwY6F1LaveixKXtie80fn7FWBYYqsGsY3ADU37CIAA';

    // 福祉用具利用者のあおぞらIDと関連情報を取得
    console.log('福祉用具利用者データを読み込み中...');
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

    // 利用者シートのデータを取得
    console.log('「利用者」シートを読み込み中...');
    const usersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: '利用者!A:H',
    });

    const usersRows = usersResponse.data.values;
    const usersHeaders = usersRows[0];
    const usersData = usersRows.slice(1);

    console.log(`利用者データ: ${usersData.length}件\n`);

    // 施設利用者シートのデータを取得
    console.log('「施設利用者」シートを読み込み中...');
    const facilityResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: '施設利用者!A:H',
    });

    const facilityRows = facilityResponse.data.values;
    const facilityHeaders = facilityRows[0];
    const facilityData = facilityRows.slice(1);

    console.log(`施設利用者データ: ${facilityData.length}件\n`);

    // 施設情報をあおぞらIDでマッピング
    const facilityMap = {};
    facilityData.forEach(row => {
      const aozoraId = row[0];
      if (aozoraId) {
        facilityMap[aozoraId] = {
          facilityName: row[5] || '',
          roomNumber: row[6] || '',
          isGroupHome: row[7] === 'GH'
        };
      }
    });

    console.log('データを変換中...\n');

    // Client型に変換
    const clients = usersData.map((row, index) => {
      const aozoraId = row[0] || '';
      const lastName = row[1] || '';
      const firstName = row[2] || '';
      const lastNameKana = row[3] || '';
      const firstNameKana = row[4] || '';
      const birthDate = row[5] || '';
      const gender = row[6] || '男性';
      const customerType = row[7] || '利用者';

      // 施設情報を取得
      const facilityInfo = facilityMap[aozoraId] || {
        facilityName: '',
        roomNumber: '',
        isGroupHome: false
      };

      // 生年月日をYYYY-MM-DD形式に変換
      let formattedBirthDate = '';
      if (birthDate) {
        const dateMatch = birthDate.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
        if (dateMatch) {
          const year = dateMatch[1];
          const month = dateMatch[2].padStart(2, '0');
          const day = dateMatch[3].padStart(2, '0');
          formattedBirthDate = `${year}-${month}-${day}`;
        }
      }

      // 現在の状況を判定
      let currentStatus = '在宅';
      if (facilityInfo.facilityName) {
        currentStatus = '施設入居中';
      }

      // 支払い区分を判定（生保受給者は「生保」、それ以外は「非生保」）
      const paymentType = seihoUsers.has(aozoraId) ? '生保' : '非生保';

      // 利用初回日を変更履歴に追加
      const changeRecords = [];
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
          changeRecords.push({
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
            note: '福祉用具利用初回日'
          });
        }
      }

      // 居宅介護支援事業所を議事録に追加
      const meetings = [];
      if (careSupportOffices.has(aozoraId)) {
        const careOffice = careSupportOffices.get(aozoraId);

        meetings.push({
          id: `${aozoraId}-care-office`,
          date: '',
          type: 'カンファレンス時',
          office: '鹿児島（ACG）',
          recorder: '',
          place: '',
          attendees: '',
          careSupportOffice: careOffice,
          careManager: '',
          hospital: '',
          socialWorker: '',
          usageCategory: '介護保険レンタル',
          carePlanStatus: '未確認',
          serviceTicketStatus: '未確認',
          content: '',
          reminder: 'なし'
        });
      }

      return {
        id: aozoraId,
        aozoraId: aozoraId,
        name: `${lastName} ${firstName}`.trim(),
        nameKana: `${lastNameKana} ${firstNameKana}`.trim(),
        birthDate: formattedBirthDate,
        gender: gender === '男性' ? '男性' : '女性',
        facilityName: facilityInfo.facilityName,
        roomNumber: facilityInfo.roomNumber,
        careLevel: '申請中',
        copayRate: '1割',
        insuranceCardStatus: '未確認',
        burdenProportionCertificateStatus: '未確認',
        currentStatus: currentStatus,
        paymentType: paymentType,
        kaipokeRegistrationStatus: '未登録',
        keyPerson: {
          name: '',
          relationship: '',
          contact: ''
        },
        address: '',
        medicalHistory: '',
        isWelfareEquipmentUser: welfareEquipmentUserIds.has(aozoraId),
        meetings: meetings,
        changeRecords: changeRecords,
        plannedEquipment: [],
        selectedEquipment: [],
        startDate: '',
        salesRecords: []
      };
    });

    console.log(`変換完了: ${clients.length}件のクライアントデータ\n`);

    // JSONファイルとして保存
    const outputPath = './clients.json';
    fs.writeFileSync(outputPath, JSON.stringify(clients, null, 2), 'utf8');

    console.log(`✓ データを ${outputPath} に保存しました`);
    console.log(`✓ 総件数: ${clients.length}件`);
    console.log(`✓ 福祉用具利用者: ${clients.filter(c => c.isWelfareEquipmentUser).length}件`);
    console.log(`✓ 生保受給者: ${clients.filter(c => c.paymentType === '生保').length}件`);
    console.log(`✓ 利用初回日登録: ${clients.filter(c => c.changeRecords.length > 0).length}件`);
    console.log(`✓ 居宅介護支援事業所登録: ${clients.filter(c => c.meetings.length > 0).length}件`);
    console.log(`✓ 施設入居者: ${clients.filter(c => c.currentStatus === '施設入居中').length}件`);
    console.log(`✓ 在宅: ${clients.filter(c => c.currentStatus === '在宅').length}件`);

    // サンプルデータを表示
    console.log('\n【サンプルデータ】');
    clients.slice(0, 3).forEach((client, i) => {
      console.log(`\n${i + 1}. ${client.name} (${client.nameKana})`);
      console.log(`   あおぞらID: ${client.aozoraId}`);
      console.log(`   生年月日: ${client.birthDate}`);
      console.log(`   性別: ${client.gender}`);
      console.log(`   現在の状況: ${client.currentStatus}`);
      if (client.facilityName) {
        console.log(`   施設: ${client.facilityName} ${client.roomNumber}`);
      }
    });

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

importSpreadsheetData();
