const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// コマンドライン引数からスプレッドシートIDとシート名を取得（オプション）
const args = process.argv.slice(2);
const SPREADSHEET_ID = args[0] || '1DiynE1PvqdrzuM-Yso39aG0-9d7nO3SYS2twZ4CWjSE';
const SHEET_NAME = args[1] || '12月サービスチェックシート';

async function importServiceCheckSheet() {
  try {
    console.log('=== サービスチェックシート インポート ===\n');
    console.log(`スプレッドシートID: ${SPREADSHEET_ID}`);
    console.log(`シート名: ${SHEET_NAME}\n`);

    // 手動マッチング設定を読み込み
    let manualMatchConfig = { mappings: [] };
    try {
      manualMatchConfig = JSON.parse(fs.readFileSync('./manualMatchConfig.json', 'utf8'));
      console.log(`手動マッチング設定: ${manualMatchConfig.mappings.length}件読み込み`);
    } catch (e) {
      console.log('手動マッチング設定ファイルなし（自動マッチングのみ）');
    }

    // 被保険者番号 → aozoraId のマッピングを作成
    const manualMatchMap = new Map();
    manualMatchConfig.mappings.forEach(m => {
      manualMatchMap.set(m.spreadsheetInsuranceNumber, m.clientsJsonAozoraId);
    });

    // clients.jsonを読み込み
    const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    console.log(`クライアント総数: ${clients.length}人\n`);

    // Step 1: 全クライアントから介護保険レンタルを削除（クリーンインポート）
    console.log('Step 1: 既存の介護保険レンタルを全削除...');
    let removedCount = 0;
    clients.forEach(client => {
      if (!client.selectedEquipment) return;
      const before = client.selectedEquipment.length;
      client.selectedEquipment = client.selectedEquipment.filter(eq => eq.status !== '介護保険レンタル');
      removedCount += before - client.selectedEquipment.length;
    });
    console.log(`  削除した介護保険レンタル: ${removedCount}件\n`);

    // 認証
    console.log('Step 2: スプレッドシートを読み込み...');
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // サービスチェックシートを読み込み
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:Q`,
    });

    const rows = response.data.values;
    const dataRows = rows.slice(1); // ヘッダーをスキップ
    console.log(`  総レコード数: ${dataRows.length}件\n`);

    // Step 3: 被保険者番号ごとにデータをグループ化
    console.log('Step 3: データをグループ化...');
    const userEquipmentMap = new Map();

    dataRows.forEach(row => {
      const insuranceNumber = String(row[0] || '').trim(); // A列: 被保険者番号
      const userName = row[1]; // B列: 利用者名
      const nameKana = row[2]; // C列: フリガナ
      const serviceMonth = row[3]; // D列: サービス提供月
      const office = row[4]; // E列: サービス事業所
      const productCode = row[7]; // H列: 商品コード
      const category = row[8]; // I列: 品目
      const manufacturer = row[9]; // J列: メーカー
      const wholesaler = row[10]; // K列: 卸業者
      const productName = row[11]; // L列: 商品名
      const units = row[12]; // M列: 単位数
      const purchasePrice = row[13]; // N列: 仕入価格
      const unitPrice = row[15]; // P列: 単位数単価

      if (!insuranceNumber) return;

      if (!userEquipmentMap.has(insuranceNumber)) {
        userEquipmentMap.set(insuranceNumber, {
          insuranceNumber,
          userName,
          nameKana,
          equipment: []
        });
      }

      userEquipmentMap.get(insuranceNumber).equipment.push({
        productCode: productCode || '',
        category: category || '',
        manufacturer: manufacturer || '',
        wholesaler: wholesaler || '',
        productName: productName || '',
        units: units || '',
        purchasePrice: purchasePrice || '',
        unitPrice: unitPrice || ''
      });
    });

    console.log(`  スプレッドシートの利用者数: ${userEquipmentMap.size}人\n`);

    // Step 4: クライアントとマッチング（重複マッチ防止）
    console.log('Step 4: クライアントとマッチング...');
    let matchedCount = 0;
    let manualMatchedCount = 0;
    let autoMatchedCount = 0;
    let addedEquipmentCount = 0;
    const matchedInsuranceNumbers = new Set();
    const unmatchedUsers = [];

    // 4-1: 手動マッチング設定を優先処理
    for (const [insuranceNumber, aozoraId] of manualMatchMap.entries()) {
      if (!userEquipmentMap.has(insuranceNumber)) continue;
      if (matchedInsuranceNumbers.has(insuranceNumber)) continue;

      const client = clients.find(c => c.aozoraId === aozoraId);
      if (!client) {
        console.log(`  ⚠ 手動マッチング: aozoraId ${aozoraId} が見つかりません`);
        continue;
      }

      const userData = userEquipmentMap.get(insuranceNumber);
      matchedInsuranceNumbers.add(insuranceNumber);
      matchedCount++;
      manualMatchedCount++;

      client.insuranceNumber = insuranceNumber;

      const newEquipment = userData.equipment.map(eq => ({
        id: uuidv4(),
        name: eq.productName,
        category: eq.category,
        status: '介護保険レンタル',
        taisCode: eq.productCode,
        manufacturer: eq.manufacturer,
        wholesaler: eq.wholesaler,
        units: eq.units,
        office: client.office || '鹿児島（ACG）',
        kaipokeStatus: '未登録'
      }));

      client.selectedEquipment = [...(client.selectedEquipment || []), ...newEquipment];
      addedEquipmentCount += newEquipment.length;
    }

    // 4-2: 被保険者番号での自動マッチング
    clients.forEach(client => {
      if (!client.insuranceNumber) return;
      if (!userEquipmentMap.has(client.insuranceNumber)) return;
      if (matchedInsuranceNumbers.has(client.insuranceNumber)) return;

      const userData = userEquipmentMap.get(client.insuranceNumber);
      matchedInsuranceNumbers.add(client.insuranceNumber);
      matchedCount++;
      autoMatchedCount++;

      const newEquipment = userData.equipment.map(eq => ({
        id: uuidv4(),
        name: eq.productName,
        category: eq.category,
        status: '介護保険レンタル',
        taisCode: eq.productCode,
        manufacturer: eq.manufacturer,
        wholesaler: eq.wholesaler,
        units: eq.units,
        office: client.office || '鹿児島（ACG）',
        kaipokeStatus: '未登録'
      }));

      client.selectedEquipment = [...(client.selectedEquipment || []), ...newEquipment];
      addedEquipmentCount += newEquipment.length;
    });

    // 4-3: 名前での自動マッチング（被保険者番号でマッチしなかったもの）
    for (const [insuranceNumber, userData] of userEquipmentMap.entries()) {
      if (matchedInsuranceNumbers.has(insuranceNumber)) continue;

      const userNameNorm = (userData.userName || '').replace(/\s/g, '');
      const userKanaNorm = (userData.nameKana || '').replace(/\s/g, '');

      let matched = false;
      for (const client of clients) {
        const clientNameNorm = (client.name || '').replace(/\s/g, '');
        const clientKanaNorm = (client.nameKana || '').replace(/\s/g, '');

        const nameMatch = userNameNorm && clientNameNorm && userNameNorm === clientNameNorm;
        const kanaMatch = userKanaNorm && clientKanaNorm && userKanaNorm === clientKanaNorm;

        if (nameMatch || kanaMatch) {
          matchedInsuranceNumbers.add(insuranceNumber);
          matchedCount++;
          autoMatchedCount++;
          client.insuranceNumber = insuranceNumber;

          const newEquipment = userData.equipment.map(eq => ({
            id: uuidv4(),
            name: eq.productName,
            category: eq.category,
            status: '介護保険レンタル',
            taisCode: eq.productCode,
            manufacturer: eq.manufacturer,
            wholesaler: eq.wholesaler,
            units: eq.units,
            office: client.office || '鹿児島（ACG）',
            kaipokeStatus: '未登録'
          }));

          client.selectedEquipment = [...(client.selectedEquipment || []), ...newEquipment];
          addedEquipmentCount += newEquipment.length;
          matched = true;
          break;
        }
      }

      if (!matched) {
        unmatchedUsers.push({
          insuranceNumber,
          userName: userData.userName,
          equipmentCount: userData.equipment.length
        });
      }
    }

    console.log(`  マッチング成功: ${matchedCount}人 (手動: ${manualMatchedCount}, 自動: ${autoMatchedCount})`);
    console.log(`  追加した用具: ${addedEquipmentCount}件\n`);

    // マッチしなかった利用者を表示
    if (unmatchedUsers.length > 0) {
      console.log('=== マッチしなかった利用者 ===');
      console.log('以下の利用者はmanualMatchConfig.jsonに追加してください:');
      unmatchedUsers.forEach(u => {
        console.log(`  ${u.insuranceNumber}: ${u.userName} (${u.equipmentCount}件)`);
      });
      console.log('');
    }

    // Step 5: 保存
    console.log('Step 5: 保存...');
    fs.writeFileSync('./clients.json', JSON.stringify(clients, null, 2), 'utf8');
    fs.writeFileSync('./public/assets/clients.json', JSON.stringify(clients, null, 2), 'utf8');
    console.log('  ✓ clients.json を更新\n');

    // 最終統計
    const totalInsurance = clients.reduce((sum, c) =>
      sum + (c.selectedEquipment?.filter(e => e.status === '介護保険レンタル').length || 0), 0
    );
    const totalSelfPay = clients.reduce((sum, c) =>
      sum + (c.selectedEquipment?.filter(e => e.status === '自費レンタル').length || 0), 0
    );
    const totalSales = clients.reduce((sum, c) =>
      sum + (c.selectedEquipment?.filter(e => e.status === '販売').length || 0), 0
    );

    console.log('=== 最終統計 ===');
    console.log(`介護保険レンタル: ${totalInsurance}件 (スプレッドシート: ${dataRows.length}件)`);
    console.log(`自費レンタル: ${totalSelfPay}件`);
    console.log(`販売: ${totalSales}件`);
    console.log(`合計: ${totalInsurance + totalSelfPay + totalSales}件`);

    if (unmatchedUsers.length > 0) {
      const unmatchedEquipment = unmatchedUsers.reduce((sum, u) => sum + u.equipmentCount, 0);
      console.log(`\n⚠ 未マッチ: ${unmatchedUsers.length}人 (${unmatchedEquipment}件)`);
    }

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

importServiceCheckSheet();
