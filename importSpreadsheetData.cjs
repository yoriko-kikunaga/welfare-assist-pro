const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const { getAllClientEdits, mergeAllClientEdits } = require('./firestoreAdmin.cjs');

async function importSpreadsheetData() {
  try {
    console.log('スプレッドシートからデータを取得中...\n');

    // Firestoreからユーザー編集データを取得
    console.log('Firestoreからユーザー編集データを取得中...');
    const firestoreEditsMap = await getAllClientEdits();

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

    // 福祉用具利用者シートのデータを取得（別のスプレッドシート）
    console.log('福祉用具利用者スプレッドシートを読み込み中...');
    const welfareSpreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';
    const welfareResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: 'シート1!A:V',  // A列から取得（自費レンタル判定 + 居宅介護支援事業所）
    });

    const welfareRows = welfareResponse.data.values;
    const welfareHeaders = welfareRows[0];
    const welfareData = welfareRows.slice(1);

    console.log(`福祉用具利用者データ: ${welfareData.length}件\n`);

    // 被保険者証情報スプレッドシートのデータを取得
    console.log('被保険者証情報スプレッドシートを読み込み中...');
    const insuranceSpreadsheetId = '11WYWyOy5FK2LSCPvK9iFQEh2rQ0501Fn6krD__3ZndU';

    // まずメタデータを取得してシート名を確認
    const insuranceMetadata = await sheets.spreadsheets.get({
      spreadsheetId: insuranceSpreadsheetId,
    });
    const insuranceSheetName = insuranceMetadata.data.sheets[0].properties.title;

    const insuranceResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: insuranceSpreadsheetId,
      range: `${insuranceSheetName}!A:Z`,
    });

    const insuranceRows = insuranceResponse.data.values;
    const insuranceHeaders = insuranceRows[0];
    const insuranceData = insuranceRows.slice(1);

    console.log(`被保険者証情報データ: ${insuranceData.length}件\n`);

    // ヘッダーから列インデックスを取得
    const nameIndex = insuranceHeaders.findIndex(h => h.includes('利用者名'));
    const kanaIndex = insuranceHeaders.findIndex(h => h.includes('利用者カナ'));
    const careLevelIndex = insuranceHeaders.findIndex(h => h.includes('要介護度') || h.includes('介護度'));
    const copayRateIndex = insuranceHeaders.findIndex(h => h.includes('給付率'));
    const careManagerIndex = insuranceHeaders.findIndex(h => h.includes('担当ケアマネ'));

    // 給付率から負担割合への変換関数
    const convertCopayRate = (kyufuRate) => {
      if (!kyufuRate) return '1割';
      const rate = String(kyufuRate).trim();
      if (rate.startsWith('90')) return '1割';
      if (rate.startsWith('80')) return '2割';
      if (rate.startsWith('70')) return '3割';
      return '1割';
    };

    // 要介護度の正規化関数
    const normalizeCareLevel = (level) => {
      if (!level) return '申請中';
      let normalized = String(level).trim();
      // 全角数字を半角に変換
      normalized = normalized.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
      // スペースを除去
      normalized = normalized.replace(/\s+/g, '');
      return normalized || '申請中';
    };

    // 被保険者証情報を名前+カナでマッピング
    const insuranceDataMap = new Map();
    insuranceData.forEach(row => {
      const name = nameIndex >= 0 ? row[nameIndex] : '';
      const kana = kanaIndex >= 0 ? row[kanaIndex] : '';

      if (name) {
        const careLevel = careLevelIndex >= 0 ? normalizeCareLevel(row[careLevelIndex]) : '申請中';
        const copayRate = copayRateIndex >= 0 ? convertCopayRate(row[copayRateIndex]) : '1割';
        const careManager = careManagerIndex >= 0 ? row[careManagerIndex] : '';

        const key = `${name}|${kana}`;
        insuranceDataMap.set(key, {
          careLevel,
          copayRate,
          careManager
        });
      }
    });

    console.log(`被保険者証情報マップ: ${insuranceDataMap.size}件\n`);

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

    // 数値文字列をパース（カンマを除去）
    const parseNumber = (value) => {
      if (!value) return 0;
      const cleaned = String(value).replace(/,/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };

    // 福祉用具利用者のあおぞらIDと関連情報をマッピング
    const welfareUserIds = new Set();
    const seihoUsers = new Set();
    const careSupportOffices = new Map();
    const selfPayRentalEquipment = new Map(); // あおぞらID -> Equipment[]

    welfareData.forEach(row => {
      const usageType = row[0]; // A列: 利用区分
      const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID（列番号+1）

      if (aozoraId) {
        welfareUserIds.add(aozoraId);

        // 生保受給（I列、A列を含むので0-indexedで8）
        const seihoReceiving = row[8];
        if (seihoReceiving === '〇') {
          seihoUsers.add(aozoraId);
        }

        // 居宅介護支援事業所（V列、A列を含むので0-indexedで21）
        const careOffice = row[21];
        if (careOffice) {
          careSupportOffices.set(aozoraId, careOffice);
        }

        // 自費レンタル福祉用具の処理
        if (usageType === '自費レンタル') {
          const productName = row[14] || ''; // O列: 商品名（請求費目）
          const unitPrice = parseNumber(row[15]); // P列: 単価
          const quantity = parseNumber(row[16]); // Q列: 数量
          const subtotalAmount = parseNumber(row[17]); // R列: 請求額（小計）
          const taxType = row[18] || '非課税'; // S列: 税区分
          const taxIncludedAmount = parseNumber(row[19]); // T列: 税込み請求額

          if (productName) {
            if (!selfPayRentalEquipment.has(aozoraId)) {
              selfPayRentalEquipment.set(aozoraId, []);
            }

            const equipment = {
              id: `selfpay-${aozoraId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: productName,
              category: '自費レンタル',
              status: '自費レンタル',
              selfPayProductName: productName,
              unitPrice: unitPrice,
              quantity: quantity,
              subtotalAmount: subtotalAmount,
              taxType: taxType,
              taxIncludedAmount: taxIncludedAmount,
              office: '鹿児島（ACG）',
              recorder: '',
              propertyAttribute: 'リース物件',
              ownProductCategory: '',
              ownProductId: '',
              billingAmount: '',
              taisCode: '',
              manufacturer: '',
              wholesaler: '',
              units: '',
              kaipokeStatus: '未登録',
              orderReceivedDate: '',
              orderPlacedDate: '',
              purchaseDate: '',
              deliveryDate: '',
              startDate: '',
              endDate: '',
              monthlyCost: taxIncludedAmount
            };

            selfPayRentalEquipment.get(aozoraId).push(equipment);
          }
        }
      }
    });

    console.log('データを変換中...\n');

    // 性別補正カウンター
    let genderCorrectionCount = 0;
    let careLevelUpdateCount = 0;
    let copayRateUpdateCount = 0;
    let careManagerUpdateCount = 0;
    let careSupportOfficeUpdateCount = 0;
    let seihoUpdateCount = 0;

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

      const fullName = `${lastName} ${firstName}`.trim();
      const fullNameKana = `${lastNameKana} ${firstNameKana}`.trim();

      // 施設情報を取得
      const facilityInfo = facilityMap[aozoraId] || {
        facilityName: '',
        roomNumber: '',
        isGroupHome: false
      };

      // 被保険者証情報を取得（名前+カナでマッチング）
      const insuranceKey = `${fullName}|${fullNameKana}`;
      const insuranceInfo = insuranceDataMap.get(insuranceKey) || {
        careLevel: '申請中',
        copayRate: '1割',
        careManager: ''
      };

      // 統計カウント
      if (insuranceInfo.careLevel !== '申請中') careLevelUpdateCount++;
      if (insuranceInfo.copayRate !== '1割') copayRateUpdateCount++;
      if (insuranceInfo.careManager) careManagerUpdateCount++;

      // 福祉用具利用者情報を取得
      const careSupportOffice = careSupportOffices.get(aozoraId) || '';
      const isSeiho = seihoUsers.has(aozoraId);

      if (careSupportOffice) careSupportOfficeUpdateCount++;
      if (isSeiho) seihoUpdateCount++;

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

      // 性別補正: 女性名パターンマッチング
      let correctedGender = gender === '男性' ? '男性' : '女性';
      if (gender === '男性' && firstName) {
        const femaleNamePatterns = ['子', '美', '恵', '代', '枝', '江', '乃', '香', '花', '奈', '菜', '音', '絵', '愛', '実', '穂', '世', '千', '紀', '希', '妃', '姫', '織', '里', '梨', '莉', '理', '利'];
        const lastChar = firstName.charAt(firstName.length - 1);
        if (femaleNamePatterns.includes(lastChar)) {
          correctedGender = '女性';
          genderCorrectionCount++;
        }
      }

      // 自費レンタル福祉用具を取得
      const selfPayEquipment = selfPayRentalEquipment.get(aozoraId) || [];

      // 自費レンタル福祉用具から売上レコードを作成
      const salesRecords = selfPayEquipment.map(equipment => ({
        id: `sales-${equipment.id}`,
        office: equipment.office || '鹿児島（ACG）',
        status: '自費レンタル',
        aozoraId: aozoraId,
        clientName: fullName,
        facilityName: facilityInfo.facilityName || '',
        productName: equipment.selfPayProductName || equipment.name || '',
        quantity: equipment.quantity || 0,
        unitPrice: equipment.unitPrice || 0,
        taxType: equipment.taxType || '非課税',
        taxIncludedAmount: equipment.taxIncludedAmount || 0
      }));

      return {
        id: aozoraId,
        aozoraId: aozoraId,
        name: fullName,
        nameKana: fullNameKana,
        birthDate: formattedBirthDate,
        gender: correctedGender,
        facilityName: facilityInfo.facilityName,
        roomNumber: facilityInfo.roomNumber,
        careLevel: insuranceInfo.careLevel,
        copayRate: insuranceInfo.copayRate,
        insuranceCardStatus: '未確認',
        burdenProportionCertificateStatus: '未確認',
        currentStatus: currentStatus,
        paymentType: isSeiho ? '生保' : '非生保',
        kaipokeRegistrationStatus: '未登録',
        keyPerson: {
          name: '',
          relationship: '',
          contact: ''
        },
        careSupportOffice: careSupportOffice,
        careManager: insuranceInfo.careManager,
        address: '',
        medicalHistory: '',
        isWelfareEquipmentUser: welfareUserIds.has(aozoraId),
        meetings: [],
        changeRecords: [],
        plannedEquipment: [],
        selectedEquipment: selfPayEquipment,
        startDate: '',
        salesRecords: salesRecords
      };
    });

    console.log(`変換完了: ${clients.length}件のクライアントデータ\n`);

    // Firestoreのユーザー編集データをマージ
    console.log('Firestoreのユーザー編集データをマージ中...');
    const mergedClients = mergeAllClientEdits(clients, firestoreEditsMap);
    console.log(`✓ マージ完了\n`);

    // マージされたデータの統計
    const clientsWithMeetings = mergedClients.filter(c => c.meetings && c.meetings.length > 0).length;
    const totalMeetings = mergedClients.reduce((sum, c) => sum + (c.meetings ? c.meetings.length : 0), 0);
    const clientsWithChangeRecords = mergedClients.filter(c => c.changeRecords && c.changeRecords.length > 0).length;
    const totalChangeRecords = mergedClients.reduce((sum, c) => sum + (c.changeRecords ? c.changeRecords.length : 0), 0);

    console.log('【Firestoreからマージされたデータ】');
    console.log(`✓ 会議記録を持つ利用者: ${clientsWithMeetings}件`);
    console.log(`✓ 総会議記録数: ${totalMeetings}件`);
    console.log(`✓ 変更記録を持つ利用者: ${clientsWithChangeRecords}件`);
    console.log(`✓ 総変更記録数: ${totalChangeRecords}件\n`);

    // JSONファイルとして保存
    const outputPath = './clients.json';
    fs.writeFileSync(outputPath, JSON.stringify(mergedClients, null, 2), 'utf8');

    // 自費レンタル福祉用具の統計
    const selfPayRentalCount = mergedClients.filter(c =>
      c.selectedEquipment && c.selectedEquipment.some(e => e.status === '自費レンタル')
    ).length;
    const totalSelfPayEquipment = mergedClients.reduce((sum, c) =>
      sum + (c.selectedEquipment ? c.selectedEquipment.filter(e => e.status === '自費レンタル').length : 0), 0
    );

    // 売上レコードの統計
    const clientsWithSales = mergedClients.filter(c => c.salesRecords && c.salesRecords.length > 0).length;
    const totalSalesRecords = mergedClients.reduce((sum, c) => sum + (c.salesRecords ? c.salesRecords.length : 0), 0);

    console.log(`✓ データを ${outputPath} に保存しました`);
    console.log(`✓ 総件数: ${mergedClients.length}件`);
    console.log(`✓ 施設入居者: ${mergedClients.filter(c => c.currentStatus === '施設入居中').length}件`);
    console.log(`✓ 在宅: ${mergedClients.filter(c => c.currentStatus === '在宅').length}件`);
    console.log(`✓ 福祉用具利用者: ${mergedClients.filter(c => c.isWelfareEquipmentUser).length}件`);
    console.log(`✓ 生保受給者: ${seihoUpdateCount}件`);
    console.log(`✓ 自費レンタル福祉用具を持つ利用者: ${selfPayRentalCount}件`);
    console.log(`✓ 自費レンタル福祉用具総数: ${totalSelfPayEquipment}件`);
    console.log(`✓ 売上レコードを持つ利用者: ${clientsWithSales}件`);
    console.log(`✓ 総売上レコード数: ${totalSalesRecords}件`);
    console.log('\n【データ品質向上】');
    console.log(`✓ 要介護度を更新: ${careLevelUpdateCount}件`);
    console.log(`✓ 負担割合を更新: ${copayRateUpdateCount}件`);
    console.log(`✓ 担当ケアマネージャーを更新: ${careManagerUpdateCount}件`);
    console.log(`✓ 居宅介護支援事業所を更新: ${careSupportOfficeUpdateCount}件`);
    console.log(`✓ 性別補正（女性名パターンマッチング）: ${genderCorrectionCount}件`);

    // サンプルデータを表示
    console.log('\n【サンプルデータ】');
    mergedClients.slice(0, 3).forEach((client, i) => {
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
