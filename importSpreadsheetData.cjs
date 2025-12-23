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
        paymentType: '非生保',
        kaipokeRegistrationStatus: '未登録',
        keyPerson: {
          name: '',
          relationship: '',
          contact: ''
        },
        careSupportOffice: '',
        careManager: '',
        address: '',
        medicalHistory: '',
        isWelfareEquipmentUser: false,
        meetings: [],
        changeRecords: [],
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
