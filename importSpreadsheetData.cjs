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

      // 居宅介護支援事業所を基本情報に設定
      const careSupportOffice = careSupportOffices.get(aozoraId) || '';

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
            note: ''
          });
        }
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
        careSupportOffice: careSupportOffice,
        careManager: '',
        address: '',
        medicalHistory: '',
        isWelfareEquipmentUser: welfareEquipmentUserIds.has(aozoraId),
        meetings: [],
        changeRecords: changeRecords,
        plannedEquipment: [],
        selectedEquipment: [],
        startDate: '',
        salesRecords: []
      };
    });

    console.log(`変換完了: ${clients.length}件のクライアントデータ\n`);

    // 被保険者証情報スプレッドシートから追加データを取得
    console.log('被保険者証情報を読み込み中...');
    const insuranceSpreadsheetId = '11WYWyOy5FK2LSCPvK9iFQEh2rQ0501Fn6krD__3ZndU';

    // スプレッドシートのメタデータを取得
    const insuranceMetadata = await sheets.spreadsheets.get({
      spreadsheetId: insuranceSpreadsheetId,
    });

    const insuranceSheetName = insuranceMetadata.data.sheets[0].properties.title;
    const insuranceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: insuranceSpreadsheetId,
      range: `${insuranceSheetName}!A:Z`,
    });

    const insuranceRows = insuranceResponse.data.values;

    if (insuranceRows && insuranceRows.length > 1) {
      const headers = insuranceRows[0];
      const nameIndex = headers.findIndex(h => h.includes('利用者名'));
      const kanaIndex = headers.findIndex(h => h.includes('利用者カナ'));
      const careLevelIndex = headers.findIndex(h => h.includes('要介護度') || h.includes('介護度'));
      const copayRateIndex = headers.findIndex(h => h.includes('給付率'));
      const careManagerIndex = headers.findIndex(h => h.includes('担当ケアマネ'));

      // 給付率から負担割合への変換関数
      const convertCopayRate = (kyufuRate) => {
        if (!kyufuRate) return '';
        const rate = String(kyufuRate).trim();
        if (rate.startsWith('90')) return '1割';
        if (rate.startsWith('80')) return '2割';
        if (rate.startsWith('70')) return '3割';
        return '';
      };

      // 要介護度の正規化関数
      const normalizeCareLevel = (level) => {
        if (!level) return '';
        let normalized = String(level).trim();
        // 全角数字を半角に変換
        normalized = normalized.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        // スペースを除去
        normalized = normalized.replace(/\s+/g, '');
        return normalized;
      };

      // 女性名パターンマッチング関数
      const isFemaleNamePattern = (name) => {
        if (!name) return false;
        const parts = name.trim().split(/\s+/);
        const firstName = parts.length > 1 ? parts[parts.length - 1] : name;

        const femalePatterns = [
          /子$/, /美$/, /江$/, /代$/, /枝$/, /乃$/, /香$/, /花$/, /菜$/, /音$/,
          /葉$/, /恵$/, /絵$/, /加$/, /佳$/, /華$/, /[女婦姫]/
        ];

        const femaleKanaPatterns = [
          /コ$/, /ミ$/, /エ$/, /ヱ$/, /ヨ$/,
          /[ナノカミヨサエリマキヨウハナアイ]$/
        ];

        return femalePatterns.some(pattern => pattern.test(firstName)) ||
               femaleKanaPatterns.some(pattern => pattern.test(firstName));
      };

      // 追加データをMapに格納
      const insuranceData = new Map();
      const dataRows = insuranceRows.slice(1);

      dataRows.forEach(row => {
        const name = nameIndex >= 0 ? row[nameIndex] : '';
        const kana = kanaIndex >= 0 ? row[kanaIndex] : '';

        if (name) {
          const careLevel = careLevelIndex >= 0 ? normalizeCareLevel(row[careLevelIndex]) : '';
          const copayRate = copayRateIndex >= 0 ? convertCopayRate(row[copayRateIndex]) : '';
          const careManager = careManagerIndex >= 0 ? row[careManagerIndex] : '';

          if (careLevel || copayRate || careManager) {
            const key = `${name}|${kana}`;
            insuranceData.set(key, { careLevel, copayRate, careManager });
          }
        }
      });

      // クライアントデータに被保険者証情報をマッチング
      let careLevelUpdated = 0;
      let copayRateUpdated = 0;
      let careManagerUpdated = 0;
      let genderUpdated = 0;

      clients.forEach(client => {
        const clientKey = `${client.name}|${client.nameKana}`;

        // 被保険者証情報とマッチング
        if (insuranceData.has(clientKey)) {
          const newData = insuranceData.get(clientKey);

          if (newData.careLevel && newData.careLevel !== client.careLevel) {
            client.careLevel = newData.careLevel;
            careLevelUpdated++;
          }

          if (newData.copayRate && newData.copayRate !== client.copayRate) {
            client.copayRate = newData.copayRate;
            copayRateUpdated++;
          }

          if (newData.careManager && newData.careManager !== client.careManager) {
            client.careManager = newData.careManager;
            careManagerUpdated++;
          }
        }

        // 福祉用具利用者で女性名パターンに一致する場合、性別を女性に更新
        if (client.isWelfareEquipmentUser && isFemaleNamePattern(client.name)) {
          if (client.gender !== '女性') {
            client.gender = '女性';
            genderUpdated++;
          }
        }
      });

      console.log(`✓ 被保険者証情報マッチング完了`);
      console.log(`  - 要介護度更新: ${careLevelUpdated}件`);
      console.log(`  - 負担割合更新: ${copayRateUpdated}件`);
      console.log(`  - 担当CM更新: ${careManagerUpdated}件`);
      console.log(`  - 性別補正: ${genderUpdated}件\n`);
    }

    // JSONファイルとして保存
    const outputPath = './clients.json';
    fs.writeFileSync(outputPath, JSON.stringify(clients, null, 2), 'utf8');

    console.log(`✓ データを ${outputPath} に保存しました`);
    console.log(`✓ 総件数: ${clients.length}件`);
    console.log(`✓ 福祉用具利用者: ${clients.filter(c => c.isWelfareEquipmentUser).length}件`);
    console.log(`✓ 生保受給者: ${clients.filter(c => c.paymentType === '生保').length}件`);
    console.log(`✓ 利用初回日登録: ${clients.filter(c => c.changeRecords.length > 0).length}件`);
    console.log(`✓ 居宅介護支援事業所登録: ${clients.filter(c => c.careSupportOffice).length}件`);
    console.log(`✓ 担当CM登録: ${clients.filter(c => c.careManager).length}件`);
    console.log(`✓ 女性: ${clients.filter(c => c.gender === '女性').length}件`);
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
