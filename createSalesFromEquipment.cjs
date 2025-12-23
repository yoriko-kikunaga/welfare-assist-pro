const fs = require('fs');

async function createSalesFromEquipment() {
  try {
    console.log('福祉用具選定データから売上レコードを作成中...\n');

    // 既存のclients.jsonを読み込む
    const clientsPath = './clients.json';
    if (!fs.existsSync(clientsPath)) {
      console.error('エラー: clients.jsonが見つかりません。');
      return;
    }

    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    console.log(`既存の利用者データ: ${clients.length}件\n`);

    let totalSalesCreated = 0;
    let clientsWithSales = 0;

    // 各クライアントの福祉用具選定データを処理
    clients.forEach(client => {
      // 自費レンタルの福祉用具を抽出
      const selfPayEquipment = client.selectedEquipment.filter(eq => eq.status === '自費レンタル');

      if (selfPayEquipment.length === 0) {
        return; // 自費レンタルがない場合はスキップ
      }

      // 自費レンタルの福祉用具を売上レコードに変換
      selfPayEquipment.forEach(equipment => {
        // 既に同じ福祉用具IDの売上レコードが存在するかチェック
        const existingSales = client.salesRecords.find(
          sales => sales.id === `sales-${equipment.id}`
        );

        if (existingSales) {
          // 既に存在する場合はスキップ
          return;
        }

        // 新しい売上レコードを作成
        const salesRecord = {
          id: `sales-${equipment.id}`,
          office: equipment.office || '鹿児島（ACG）',
          status: '自費レンタル',
          aozoraId: client.aozoraId,
          clientName: client.name,
          facilityName: client.facilityName || '',
          productName: equipment.selfPayProductName || equipment.name || '',
          quantity: equipment.quantity || 0,
          unitPrice: equipment.unitPrice || 0,
          taxType: equipment.taxType || '非課税'
        };

        client.salesRecords.push(salesRecord);
        totalSalesCreated++;
      });

      if (selfPayEquipment.length > 0) {
        clientsWithSales++;
      }
    });

    // 更新したデータを保存
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf8');

    console.log(`✓ データを ${clientsPath} に保存しました`);
    console.log(`✓ 作成した売上レコード: ${totalSalesCreated}件`);
    console.log(`✓ 売上レコードを持つ利用者: ${clientsWithSales}件`);

    // 統計情報を表示
    const totalSalesRecords = clients.reduce((sum, c) => sum + c.salesRecords.length, 0);
    console.log(`\n✓ 総売上レコード数: ${totalSalesRecords}件`);

    // サンプルデータを表示
    console.log('\n【サンプルデータ】');
    const clientsWithNewSales = clients.filter(c =>
      c.salesRecords.some(s => s.status === '自費レンタル')
    );

    clientsWithNewSales.slice(0, 5).forEach((client, i) => {
      const selfPaySales = client.salesRecords.filter(s => s.status === '自費レンタル');
      console.log(`\n${i + 1}. ${client.name} (${client.aozoraId})`);
      selfPaySales.forEach((sales, j) => {
        console.log(`   [${j + 1}] ${sales.productName}`);
        console.log(`       単価: ${sales.unitPrice}円 x 数量: ${sales.quantity} | 税区分: ${sales.taxType}`);
        console.log(`       事業所: ${sales.office}`);
      });
    });

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    console.error(error.stack);
  }
}

createSalesFromEquipment();
