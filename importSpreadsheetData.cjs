const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const { getAllClientEdits, mergeAllClientEdits } = require('./firestoreAdmin.cjs');

// コマンドライン引数を解析
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--monthly-sheet=')) {
      result.monthlySheet = args[i].split('=')[1];
    } else if (args[i] === '--force') {
      // 安全ガード（利用者数激減チェック）をスキップする。
      // 正当な大量削減（事業所統廃合等）の場合のみ手動実行で使用。
      result.force = true;
    }
  }

  return result;
}

async function importSpreadsheetData() {
  try {
    const cliArgs = parseArgs();
    console.log('スプレッドシートからデータを取得中...\n');

    if (cliArgs.monthlySheet) {
      console.log(`📅 月次実績シート指定: ${cliArgs.monthlySheet}\n`);
    }

    // 既存のclients.jsonから保持すべきデータを読み込む
    const existingChangeRecordsMap = new Map();
    const existingInsuranceNumberMap = new Map();
    const existingKaipokeStatusMap = new Map();
    const existingSalesEquipmentMap = new Map();
    const existingInsuranceRentalEquipmentMap = new Map(); // 介護保険レンタル（月次サービスチェックシートから）
    const existingSelfPayRentalEquipmentMap = new Map(); // 自費レンタル（月次処理で更新）
    const existingCareLevelMap = new Map(); // 要介護度（月次処理で更新）
    const existingCopayRateMap = new Map(); // 負担割合（月次処理で更新）
    let previousClientCount = 0; // 安全ガード用: 前回clients.jsonの利用者数

    if (fs.existsSync('./clients.json')) {
      try {
        const existingClients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
        previousClientCount = existingClients.length;
        existingClients.forEach(client => {
          // changeRecordsの保持
          if (client.changeRecords && client.changeRecords.length > 0) {
            existingChangeRecordsMap.set(client.aozoraId, client.changeRecords);
          }

          // insuranceNumberの保持（被保険者番号）
          if (client.insuranceNumber) {
            existingInsuranceNumberMap.set(client.aozoraId, client.insuranceNumber);
          }

          // kaipokeRegistrationStatusの保持（登録済の場合のみ）
          if (client.kaipokeRegistrationStatus === '登録済') {
            existingKaipokeStatusMap.set(client.aozoraId, client.kaipokeRegistrationStatus);
          }

          // selectedEquipment内の用具の保持（すべて月次で更新、日次では保持）
          if (client.selectedEquipment && client.selectedEquipment.length > 0) {
            // 介護保険レンタルを保持
            const insuranceRentals = client.selectedEquipment.filter(e => e.status === '介護保険レンタル');
            if (insuranceRentals.length > 0) {
              existingInsuranceRentalEquipmentMap.set(client.aozoraId, insuranceRentals);
            }
            // 自費レンタルを保持
            const selfPayRentals = client.selectedEquipment.filter(e => e.status === '自費レンタル');
            if (selfPayRentals.length > 0) {
              existingSelfPayRentalEquipmentMap.set(client.aozoraId, selfPayRentals);
            }
            // 販売を保持
            const salesItems = client.selectedEquipment.filter(e => e.status === '販売');
            if (salesItems.length > 0) {
              existingSalesEquipmentMap.set(client.aozoraId, salesItems);
            }
          }

          // 要介護度・負担割合を保持（月次で更新）
          if (client.careLevel && client.careLevel !== '申請中') {
            existingCareLevelMap.set(client.aozoraId, client.careLevel);
          }
          if (client.copayRate) {
            existingCopayRateMap.set(client.aozoraId, client.copayRate);
          }
        });
        console.log(`✓ Loaded existing data from clients.json:`);
        console.log(`  - Change records: ${existingChangeRecordsMap.size} clients`);
        console.log(`  - Insurance numbers: ${existingInsuranceNumberMap.size} clients`);
        console.log(`  - Kaipoke registered: ${existingKaipokeStatusMap.size} clients`);
        console.log(`  - Insurance rental equipment: ${existingInsuranceRentalEquipmentMap.size} clients`);
        console.log(`  - Self-pay rental equipment: ${existingSelfPayRentalEquipmentMap.size} clients`);
        console.log(`  - Sales equipment: ${existingSalesEquipmentMap.size} clients`);
        console.log(`  - Care level: ${existingCareLevelMap.size} clients`);
        console.log(`  - Copay rate: ${existingCopayRateMap.size} clients`);
        console.log(`  (Note: 日次では保持のみ、月次で更新)\n`);
      } catch (error) {
        console.warn('Warning: Could not load existing data:', error.message);
      }
    }

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
    let welfareData = welfareRows.slice(1);

    console.log(`福祉用具利用者データ（シート1）: ${welfareData.length}件\n`);

    // 月次実績シートのデータを取得（オプション）
    let monthlyData = [];
    if (cliArgs.monthlySheet) {
      try {
        console.log(`月次実績シート「${cliArgs.monthlySheet}」を読み込み中...`);
        const monthlyResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: welfareSpreadsheetId,
          range: `${cliArgs.monthlySheet}!A:V`,
        });

        const monthlyRows = monthlyResponse.data.values;
        if (monthlyRows && monthlyRows.length > 1) {
          monthlyData = monthlyRows.slice(1); // ヘッダーをスキップ
          console.log(`月次実績データ: ${monthlyData.length}件\n`);

          // 月次実績データをシート1データにマージ
          console.log('月次実績データをマージ中...');
          const mergedData = mergeWelfareData(welfareData, monthlyData);
          welfareData = mergedData.data;
          console.log(`✓ マージ完了: 新規 ${mergedData.newCount}件、更新 ${mergedData.updateCount}件\n`);
        } else {
          console.log(`⚠ 月次実績シート「${cliArgs.monthlySheet}」にデータがありません\n`);
        }
      } catch (error) {
        console.warn(`⚠ 月次実績シート「${cliArgs.monthlySheet}」の読み込みに失敗しました: ${error.message}\n`);
      }
    }

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
    // 【2026-06-11 設計変更】自費レンタルはアプリ（Firestore clientEdits）が唯一の管理元。
    // スプレッドシートからは取り込まないため、自費レンタル用Mapは廃止。

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

        // 【2026-06-11 設計変更】自費レンタルはアプリ（Firestore clientEdits）に一本化。
        // スプレッドシート（シート1/月次実績）からの自費レンタル取り込みは廃止した。
        // 自費レンタルは下部の mergeAllClientEdits(Firestore) で全件付与される。
        // （ここで base に入れないことで、アプリ上での自費レンタル削除も正しく反映される）
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

      // 既存の介護保険レンタル用具を取得（サービスチェックシートから月次インポート）
      const existingInsuranceRentals = existingInsuranceRentalEquipmentMap.get(aozoraId) || [];

      // 自費レンタル用具
      // 【2026-06-11 設計変更】自費レンタルはアプリ（Firestore clientEdits）が唯一の管理元。
      // スプレッドシート・既存clients.jsonからは取り込まず、空配列にする。
      // 全自費レンタルは下部の mergeAllClientEdits(Firestore) で付与される。
      // これにより (1) 月次インポートの破壊的上書きが根絶され、(2) アプリ上の削除も正しく反映される。
      const selfPayRentalsToUse = [];

      // 既存の販売用具を取得
      const existingSales = existingSalesEquipmentMap.get(aozoraId) || [];

      // 既存の被保険者番号を取得
      const existingInsuranceNumber = existingInsuranceNumberMap.get(aozoraId) || '';

      // 既存のカイポケ登録ステータスを取得（登録済の場合は保持）
      const existingKaipokeStatus = existingKaipokeStatusMap.get(aozoraId) || '未登録';

      // 要介護度・負担割合
      // 月次処理: スプレッドシートから取得
      // 日次処理: 既存データを保持
      const existingCareLevel = cliArgs.monthlySheet ? null : existingCareLevelMap.get(aozoraId);
      const existingCopayRate = cliArgs.monthlySheet ? null : existingCopayRateMap.get(aozoraId);

      // selectedEquipmentは介護保険レンタル + 自費レンタル + 販売を結合
      const combinedEquipment = [...existingInsuranceRentals, ...selfPayRentalsToUse, ...existingSales];

      // 自費レンタル福祉用具から売上レコードを作成
      const salesRecords = selfPayRentalsToUse.map(equipment => ({
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
        office: '鹿児島（ACG）', // デフォルト事業所
        name: fullName,
        nameKana: fullNameKana,
        birthDate: formattedBirthDate,
        gender: correctedGender,
        facilityName: facilityInfo.facilityName,
        roomNumber: facilityInfo.roomNumber,
        careLevel: existingCareLevel || insuranceInfo.careLevel,
        copayRate: existingCopayRate || insuranceInfo.copayRate,
        insuranceCardStatus: '未確認',
        burdenProportionCertificateStatus: '未確認',
        currentStatus: currentStatus,
        paymentType: isSeiho ? '生保' : '非生保',
        kaipokeRegistrationStatus: existingKaipokeStatus,
        insuranceNumber: existingInsuranceNumber,
        keyPerson: {
          name: '',
          relationship: '',
          contact: ''
        },
        careSupportOffice: careSupportOffice,
        careManager: insuranceInfo.careManager,
        address: '',
        medicalHistory: '',
        isWelfareEquipmentUser: welfareUserIds.has(aozoraId) || combinedEquipment.length > 0,
        meetings: [],
        changeRecords: existingChangeRecordsMap.get(aozoraId) || [],
        plannedEquipment: [],
        selectedEquipment: combinedEquipment,
        startDate: '',
        salesRecords: salesRecords
      };
    });

    console.log(`変換完了: ${clients.length}件のクライアントデータ\n`);

    // Firestoreのユーザー編集データをマージ
    console.log('Firestoreのユーザー編集データをマージ中...');
    const mergedClients = mergeAllClientEdits(clients, firestoreEditsMap);
    console.log(`✓ マージ完了\n`);

    // マージ後にisWelfareEquipmentUserフラグを再確認
    // 用具がある、またはFirestoreで手動設定されていればtrue
    mergedClients.forEach(client => {
      const hasEquipment = (client.selectedEquipment || []).length > 0;
      const manuallySetAsWelfareUser = client._firestoreWelfareUserFlag === true;
      client.isWelfareEquipmentUser = hasEquipment || manuallySetAsWelfareUser;
      // 内部フラグを削除
      delete client._firestoreWelfareUserFlag;
    });

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

    // ===== 安全ガード: 利用者数の異常な激減を検知してインポートを中断 =====
    // 【2026-06-11 追加】2026-06-01にスプレッドシート読み込み障害でclients.jsonが0件で
    // 生成・コミット・自動デプロイされ、本番データが壊れた事故への再発防止策。
    // 異常時は exit(1) でワークフローを失敗させ、コミット・デプロイに進ませない。
    const newClientCount = mergedClients.length;
    const ABSOLUTE_FLOOR = 8000;        // 利用者数の絶対下限（現状8900前後）
    const RELATIVE_THRESHOLD = 0.9;     // 前回比でこの割合を下回ったら異常とみなす
    const relativeFloor = Math.floor(previousClientCount * RELATIVE_THRESHOLD);

    const belowAbsolute = newClientCount < ABSOLUTE_FLOOR;
    const belowRelative = previousClientCount > 0 && newClientCount < relativeFloor;

    if ((belowAbsolute || belowRelative) && !cliArgs.force) {
      console.error('\n========================================');
      console.error('🛑 安全ガード作動: 利用者数が異常に少ないためインポートを中断しました');
      console.error('========================================');
      console.error(`  今回の利用者数: ${newClientCount}件`);
      console.error(`  前回の利用者数: ${previousClientCount}件`);
      if (belowAbsolute) console.error(`  → 絶対下限 ${ABSOLUTE_FLOOR}件を下回っています`);
      if (belowRelative) console.error(`  → 前回比 ${Math.round(RELATIVE_THRESHOLD * 100)}%（${relativeFloor}件）を下回っています`);
      console.error('  clients.json は書き換えていません（既存データを保護）。');
      console.error('  スプレッドシート/Kintone読み込み障害の可能性があります。ログを確認してください。');
      console.error('  正当な大量削減の場合のみ --force を付けて再実行してください。');
      console.error('========================================\n');
      process.exit(1);
    }

    if (cliArgs.force && (belowAbsolute || belowRelative)) {
      console.warn(`⚠ --force 指定により安全ガードをスキップ（${previousClientCount}→${newClientCount}件）\n`);
    }

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

    // 介護保険レンタル福祉用具の統計
    const insuranceRentalCount = mergedClients.filter(c =>
      c.selectedEquipment && c.selectedEquipment.some(e => e.status === '介護保険レンタル')
    ).length;
    const totalInsuranceRentalEquipment = mergedClients.reduce((sum, c) =>
      sum + (c.selectedEquipment ? c.selectedEquipment.filter(e => e.status === '介護保険レンタル').length : 0), 0
    );

    // 被保険者番号の統計
    const clientsWithInsuranceNumber = mergedClients.filter(c => c.insuranceNumber).length;

    // カイポケ登録済の統計
    const clientsWithKaipokeRegistered = mergedClients.filter(c => c.kaipokeRegistrationStatus === '登録済').length;

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
    console.log(`✓ 介護保険レンタル用具を持つ利用者: ${insuranceRentalCount}件`);
    console.log(`✓ 介護保険レンタル用具総数: ${totalInsuranceRentalEquipment}件`);
    console.log(`✓ 被保険者番号あり: ${clientsWithInsuranceNumber}件`);
    console.log(`✓ カイポケ登録済: ${clientsWithKaipokeRegistered}件`);
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

/**
 * 福祉用具利用者データをマージする関数
 * @param {Array} baseData - シート1のデータ（ベース）
 * @param {Array} monthlyData - 月次実績データ（差分）
 * @returns {Object} { data: マージ後のデータ, newCount: 新規件数, updateCount: 更新件数 }
 */
function mergeWelfareData(baseData, monthlyData) {
  // あおぞらIDでインデックス化
  const baseMap = new Map();
  baseData.forEach((row, index) => {
    const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID
    if (aozoraId) {
      baseMap.set(aozoraId, { row, index });
    }
  });

  let newCount = 0;
  let updateCount = 0;
  const result = [...baseData]; // ベースデータをコピー

  // 自費レンタルの重複チェック用Set（あおぞらID + 商品名）
  const selfPayKeys = new Set();
  baseData.forEach(row => {
    if (row[0] === '自費レンタル') {
      const key = `${row[1]}|${row[14]}`; // B列: あおぞらID, O列: 商品名
      selfPayKeys.add(key);
    }
  });

  // 月次実績データを処理
  monthlyData.forEach(monthlyRow => {
    const aozoraId = String(monthlyRow[1] || '').trim(); // B列: あおぞらID
    if (!aozoraId) return;

    const usageType = monthlyRow[0] || ''; // A列: 利用区分

    // 自費レンタルは重複チェックしてから追加
    if (usageType === '自費レンタル') {
      const productName = monthlyRow[14] || ''; // O列: 商品名
      const key = `${aozoraId}|${productName}`;
      if (!selfPayKeys.has(key)) {
        result.push(monthlyRow);
        selfPayKeys.add(key);
        newCount++;
      }
      return;
    }

    const existingEntry = baseMap.get(aozoraId);

    if (existingEntry) {
      // 既存データを更新
      // C列: 利用者名、D列: 単位数、K列: 利用初回日、V列: 介護事業所を上書き
      const name = monthlyRow[2] || '';
      const units = monthlyRow[3] || '';
      const startDate = monthlyRow[10] || '';
      const careSupportOffice = monthlyRow[21] || '';

      if (name) result[existingEntry.index][2] = name;
      if (units) result[existingEntry.index][3] = units;
      if (startDate) result[existingEntry.index][10] = startDate;
      if (careSupportOffice) result[existingEntry.index][21] = careSupportOffice;

      updateCount++;
    } else {
      // 新規データを追加
      result.push(monthlyRow);
      baseMap.set(aozoraId, { row: monthlyRow, index: result.length - 1 });
      newCount++;
    }
  });

  return { data: result, newCount, updateCount };
}

importSpreadsheetData();
