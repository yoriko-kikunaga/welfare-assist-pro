/**
 * 販売データインポートスクリプト
 *
 * スプレッドシートから販売データを読み込み、clients.jsonに追加します。
 *
 * 使用方法:
 *   node importSalesData.cjs
 *
 * スプレッドシート: 1zeU-ui7jtc1djMn4virPyHJeb5zIL7c-Sbr1D4oH6nQ
 * シート名: 販売データ
 */

const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function importSalesData() {
  try {
    console.log('販売データをインポート中...\n');

    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    const spreadsheetId = '1zeU-ui7jtc1djMn4virPyHJeb5zIL7c-Sbr1D4oH6nQ';
    const sheetName = '販売データ';

    // 販売データを取得
    console.log(`スプレッドシートからデータを取得中...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Q`,
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      console.log('販売データがありません。');
      return;
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);
    console.log(`✓ ${dataRows.length}件のデータを取得\n`);

    // ヘッダーのインデックスを取得
    const getIndex = (name) => headers.indexOf(name);
    const idx = {
      aozoraId: getIndex('あおぞらID'),
      clientName: getIndex('利用者名'),
      productName: getIndex('商品名'),
      orderReceivedDate: getIndex('受注日'),
      deliveryDate: getIndex('納品日'),
      salesPerson: getIndex('営業担当'),
      quantity: getIndex('数量'),
      unitPrice: getIndex('単価（税抜）'),
      taxType: getIndex('税区分'),
      taxIncludedAmount: getIndex('税込金額'),
      shippingCost: getIndex('送料'),
      transactionType: getIndex('取引内容'),
      paymentMethod: getIndex('支払い方法'),
      userBurdenType: getIndex('利用者自己負担割合'),
      applicationStatus: getIndex('申請'),
      applicationMunicipality: getIndex('申請市町村'),
      note: getIndex('備考'),
    };

    // clients.jsonを読み込む
    if (!fs.existsSync('./clients.json')) {
      console.error('clients.jsonが見つかりません。');
      return;
    }

    const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    console.log(`✓ clients.json読み込み完了（${clients.length}件）\n`);

    // あおぞらID → クライアントのマップを作成
    const clientMap = new Map();
    clients.forEach(client => {
      clientMap.set(client.aozoraId, client);
    });

    // 販売データをクライアントに追加
    let addedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;

    const salesByClient = new Map();

    dataRows.forEach((row, rowIndex) => {
      const aozoraId = String(row[idx.aozoraId] || '').trim();

      if (!aozoraId) {
        skippedCount++;
        return;
      }

      const client = clientMap.get(aozoraId);
      if (!client) {
        console.log(`  ⚠ クライアント未発見: ${aozoraId}`);
        notFoundCount++;
        return;
      }

      // 販売用Equipmentオブジェクトを作成
      const salesEquipment = {
        id: `sales-import-${aozoraId}-${Date.now()}-${rowIndex}`,
        name: row[idx.productName] || '',
        category: '',
        status: '販売',
        office: client.office || '鹿児島（ACG）',
        orderReceivedDate: row[idx.orderReceivedDate] || '',
        deliveryDate: row[idx.deliveryDate] || '',
        salesPerson: row[idx.salesPerson] || '',
        quantity: parseInt(row[idx.quantity]) || 1,
        unitPrice: parseInt(row[idx.unitPrice]) || 0,
        taxType: row[idx.taxType] || '非課税',
        taxIncludedAmount: parseInt(row[idx.taxIncludedAmount]) || 0,
        shippingCost: parseInt(row[idx.shippingCost]) || 0,
        transactionType: row[idx.transactionType] || '',
        paymentMethod: row[idx.paymentMethod] || '',
        userBurdenType: row[idx.userBurdenType] || '',
        applicationStatus: row[idx.applicationStatus] === 'TRUE' || row[idx.applicationStatus] === true,
        applicationMunicipality: row[idx.applicationMunicipality] || '',
        note: row[idx.note] || '',
      };

      if (!salesByClient.has(aozoraId)) {
        salesByClient.set(aozoraId, []);
      }
      salesByClient.get(aozoraId).push(salesEquipment);
      addedCount++;
    });

    // クライアントのselectedEquipmentに販売データを追加
    let updatedClientCount = 0;
    salesByClient.forEach((salesItems, aozoraId) => {
      const client = clientMap.get(aozoraId);
      if (client) {
        // 既存の販売データを除去（重複防止）
        const existingNonSales = (client.selectedEquipment || []).filter(
          e => e.status !== '販売' || !e.id.startsWith('sales-import-')
        );

        // 新しい販売データを追加
        client.selectedEquipment = [...existingNonSales, ...salesItems];
        updatedClientCount++;
      }
    });

    // 結果をclients.jsonに保存
    fs.writeFileSync('./clients.json', JSON.stringify(clients, null, 2), 'utf8');

    // public/assetsにもコピー
    fs.copyFileSync('./clients.json', './public/assets/clients.json');

    console.log('========================================');
    console.log('販売データインポート完了');
    console.log('========================================');
    console.log(`✓ 追加: ${addedCount}件`);
    console.log(`✓ 更新クライアント: ${updatedClientCount}件`);
    console.log(`⚠ スキップ（空行）: ${skippedCount}件`);
    console.log(`⚠ クライアント未発見: ${notFoundCount}件`);
    console.log('\n次のステップ:');
    console.log('1. npm run build');
    console.log('2. firebase deploy --only hosting');

  } catch (error) {
    console.error('エラー:', error.message);
    if (error.response) {
      console.error('詳細:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

importSalesData();
