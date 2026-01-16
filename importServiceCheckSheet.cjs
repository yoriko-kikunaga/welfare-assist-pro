const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

async function importServiceCheckSheet() {
  try {
    console.log('サービスチェックシートから介護保険レンタルデータをインポート中...\n');

    // clients.jsonを読み込み
    const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    console.log(`クライアント総数: ${clients.length}人\n`);

    // 認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = '1TduZae5tt7ZMsop6OlDK3Q6r27DJuqguYe4CvtcPJDs';

    // サービスチェックシートを読み込み
    console.log('サービスチェックシートを読み込み中...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'サービスチェックシート!A:Q',
    });

    const rows = response.data.values;
    const dataRows = rows.slice(1); // ヘッダーをスキップ
    console.log(`総レコード数: ${dataRows.length}件\n`);

    // 被保険者番号ごとにデータをグループ化
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

    console.log(`サービスチェックシートの利用者数: ${userEquipmentMap.size}人\n`);

    // クライアントとマッチングしてデータを追加
    let matchedCount = 0;
    let addedEquipmentCount = 0;
    let updatedClients = [];

    clients.forEach(client => {
      // 名前でマッチング
      let userData = null;
      let matchedInsuranceNumber = null;

      for (const [insuranceNumber, data] of userEquipmentMap.entries()) {
        if (data.userName === client.name || data.nameKana === client.nameKana) {
          userData = data;
          matchedInsuranceNumber = insuranceNumber;
          break;
        }
      }

      if (userData) {
        matchedCount++;

        // 被保険者番号を追加
        client.insuranceNumber = matchedInsuranceNumber;

        // 既存の用具から介護保険レンタル以外を保持
        const existingEquipment = client.selectedEquipment || [];
        const nonInsuranceEquipment = existingEquipment.filter(eq => eq.status !== '介護保険レンタル');

        // 介護保険レンタルの用具を新規作成（重複排除済み）
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

        // 介護保険レンタル以外 + 新しい介護保険レンタルを結合
        client.selectedEquipment = [...nonInsuranceEquipment, ...newEquipment];
        addedEquipmentCount += newEquipment.length;

        console.log(`✓ ${client.aozoraId}: ${client.name} - ${newEquipment.length}件の用具を追加`);
      }

      updatedClients.push(client);
    });

    console.log('\n=== インポートサマリー ===');
    console.log(`マッチング成功: ${matchedCount}人`);
    console.log(`追加された用具: ${addedEquipmentCount}件\n`);

    // バックアップを作成
    const backupPath = './clients.json.backup-before-service-check-import';
    fs.writeFileSync(backupPath, JSON.stringify(clients, null, 2), 'utf8');
    console.log(`✓ バックアップを作成: ${backupPath}`);

    // 更新されたデータを保存
    fs.writeFileSync('./clients.json', JSON.stringify(updatedClients, null, 2), 'utf8');
    console.log('✓ clients.json を更新しました\n');

    // 統計情報を表示
    const totalInsuranceRental = updatedClients.reduce((sum, c) =>
      sum + (c.selectedEquipment?.filter(e => e.status === '介護保険レンタル').length || 0), 0
    );

    console.log('=== 更新後の統計 ===');
    console.log(`介護保険レンタル用具総数: ${totalInsuranceRental}件`);
    console.log(`被保険者番号あり: ${updatedClients.filter(c => c.insuranceNumber).length}人`);

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }

  process.exit(0);
}

importServiceCheckSheet();
