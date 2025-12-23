const fs = require('fs');

async function exportSalesToCSV() {
  try {
    console.log('売上レコードをCSVファイルにエクスポート中...\n');

    // 既存のclients.jsonを読み込む
    const clientsPath = './clients.json';
    if (!fs.existsSync(clientsPath)) {
      console.error('エラー: clients.jsonが見つかりません。');
      return;
    }

    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    console.log(`利用者データ: ${clients.length}件\n`);

    // 全売上レコードを収集
    const allSalesRecords = [];
    clients.forEach(client => {
      client.salesRecords.forEach(sales => {
        allSalesRecords.push(sales);
      });
    });

    console.log(`総売上レコード数: ${allSalesRecords.length}件`);

    // 自費レンタルのみをフィルター
    const selfPaySales = allSalesRecords.filter(s => s.status === '自費レンタル');
    console.log(`自費レンタル売上: ${selfPaySales.length}件\n`);

    if (selfPaySales.length === 0) {
      console.log('エクスポートする自費レンタル売上がありません。');
      return;
    }

    // CSVヘッダー
    const headers = [
      '事業所',
      'Status',
      'あおぞらID',
      '利用者名',
      '施設名',
      '商品名（請求費目）',
      '数量',
      '単価',
      '税区分'
    ];

    // CSVデータを作成
    const csvLines = [headers.join(',')];

    selfPaySales.forEach(sales => {
      const row = [
        sales.office || '',
        sales.status || '',
        sales.aozoraId || '',
        `"${(sales.clientName || '').replace(/"/g, '""')}"`, // ダブルクォートをエスケープ
        `"${(sales.facilityName || '').replace(/"/g, '""')}"`,
        `"${(sales.productName || '').replace(/"/g, '""')}"`,
        sales.quantity || 0,
        sales.unitPrice || 0,
        sales.taxType || ''
      ];
      csvLines.push(row.join(','));
    });

    // CSVファイルとして保存
    const timestamp = new Date().toISOString().split('T')[0];
    const outputPath = `./自費レンタル売上_${timestamp}.csv`;

    // UTF-8 with BOM（Excelで正しく開けるように）
    const BOM = '\uFEFF';
    fs.writeFileSync(outputPath, BOM + csvLines.join('\n'), 'utf8');

    console.log(`✓ CSVファイル保存完了: ${outputPath}`);
    console.log(`✓ 出力行数: ${selfPaySales.length}行（ヘッダー除く）`);

    // サマリーを表示
    const totalAmount = selfPaySales.reduce((sum, s) => sum + (s.unitPrice * s.quantity), 0);
    const officeBreakdown = {};
    const taxTypeBreakdown = {};

    selfPaySales.forEach(s => {
      // 事業所別集計
      if (!officeBreakdown[s.office]) {
        officeBreakdown[s.office] = { count: 0, amount: 0 };
      }
      officeBreakdown[s.office].count++;
      officeBreakdown[s.office].amount += s.unitPrice * s.quantity;

      // 税区分別集計
      if (!taxTypeBreakdown[s.taxType]) {
        taxTypeBreakdown[s.taxType] = { count: 0, amount: 0 };
      }
      taxTypeBreakdown[s.taxType].count++;
      taxTypeBreakdown[s.taxType].amount += s.unitPrice * s.quantity;
    });

    console.log('\n【売上サマリー】');
    console.log(`総件数: ${selfPaySales.length}件`);
    console.log(`総売上額（税抜）: ${totalAmount.toLocaleString()}円`);

    console.log('\n事業所別:');
    Object.entries(officeBreakdown).forEach(([office, data]) => {
      console.log(`  ${office}: ${data.count}件 / ${data.amount.toLocaleString()}円`);
    });

    console.log('\n税区分別:');
    Object.entries(taxTypeBreakdown).forEach(([taxType, data]) => {
      console.log(`  ${taxType}: ${data.count}件 / ${data.amount.toLocaleString()}円`);
    });

    console.log('\n【次のステップ】');
    console.log('1. Google Spreadsheetsを開く');
    console.log('2. ファイル > インポート > アップロード を選択');
    console.log(`3. 「${outputPath}」をアップロード`);
    console.log('4. インポート場所: 新しいスプレッドシートを作成');
    console.log('5. 区切り文字の種類: カンマ を選択');
    console.log('6. データをインポート');

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    console.error(error.stack);
  }
}

exportSalesToCSV();
