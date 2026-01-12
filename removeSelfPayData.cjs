const fs = require('fs');

function removeSelfPayData() {
  try {
    console.log('自費レンタルデータを削除中...\n');

    // 削除対象のあおぞらIDを読み込み
    const deletedReport = JSON.parse(fs.readFileSync('./deleted-selfpay-users.json', 'utf8'));
    const deletedIds = deletedReport.deletedSelfPayUsers;

    console.log(`削除対象: ${deletedIds.length}件\n`);

    // clients.jsonを読み込み
    const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));

    let updatedCount = 0;
    let removedEquipmentCount = 0;
    let removedSalesCount = 0;

    // 各クライアントから自費レンタルデータを削除
    const updatedClients = clients.map(client => {
      if (deletedIds.includes(client.aozoraId)) {
        const beforeEquipmentCount = client.selectedEquipment?.filter(e => e.status === '自費レンタル').length || 0;
        const beforeSalesCount = client.salesRecords?.length || 0;

        // 自費レンタル以外の用具を保持
        const filteredEquipment = client.selectedEquipment?.filter(e => e.status !== '自費レンタル') || [];

        // 売上レコードをすべて削除（自費レンタルの売上レコードのみ削除）
        const filteredSales = [];

        const afterEquipmentCount = filteredEquipment.length;
        const afterSalesCount = filteredSales.length;

        removedEquipmentCount += (beforeEquipmentCount - afterEquipmentCount);
        removedSalesCount += (beforeSalesCount - afterSalesCount);

        console.log(`✓ ${client.aozoraId}: ${client.name}`);
        console.log(`  - 自費レンタル用具: ${beforeEquipmentCount}件 → ${filteredEquipment.filter(e => e.status === '自費レンタル').length}件`);
        console.log(`  - 売上レコード: ${beforeSalesCount}件 → ${afterSalesCount}件`);

        updatedCount++;

        return {
          ...client,
          selectedEquipment: filteredEquipment,
          salesRecords: filteredSales
        };
      }

      return client;
    });

    console.log('\n=== 削除サマリー ===');
    console.log(`更新されたクライアント: ${updatedCount}件`);
    console.log(`削除された自費レンタル用具: ${removedEquipmentCount}件`);
    console.log(`削除された売上レコード: ${removedSalesCount}件\n`);

    // バックアップを作成
    const backupPath = './clients.json.backup-before-selfpay-removal';
    fs.writeFileSync(backupPath, JSON.stringify(clients, null, 2), 'utf8');
    console.log(`✓ バックアップを作成: ${backupPath}`);

    // 更新されたデータを保存
    fs.writeFileSync('./clients.json', JSON.stringify(updatedClients, null, 2), 'utf8');
    console.log('✓ clients.json を更新しました');

    // 統計情報を表示
    const totalSelfPayEquipment = updatedClients.reduce((sum, c) =>
      sum + (c.selectedEquipment?.filter(e => e.status === '自費レンタル').length || 0), 0
    );
    const totalSalesRecords = updatedClients.reduce((sum, c) =>
      sum + (c.salesRecords?.length || 0), 0
    );

    console.log('\n=== 更新後の統計 ===');
    console.log(`自費レンタル用具総数: ${totalSelfPayEquipment}件`);
    console.log(`売上レコード総数: ${totalSalesRecords}件`);

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

removeSelfPayData();
