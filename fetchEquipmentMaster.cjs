const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function fetchEquipmentMaster() {
  try {
    console.log('福祉用具マスターデータを取得中...\n');

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = '1M71D95bawphCx9stXDOvo1CEZm4H9s-aomPHK_SdNN8';

    // スプレッドシートのデータを取得（A列からI列まで）
    console.log('スプレッドシートを読み込み中...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'A:I', // A列（品目）からI列（月間単位数）まで
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('データが見つかりませんでした。');
      return;
    }

    const headers = rows[0];
    console.log(`ヘッダー行: ${headers.join(', ')}\n`);

    const dataRows = rows.slice(1); // ヘッダーを除く
    console.log(`データ行数: ${dataRows.length}件\n`);

    // データを変換
    const equipmentMaster = dataRows.map((row, index) => {
      return {
        itemType: row[0] || '',        // A列: 品目
        productName: row[1] || '',      // B列: 商品名
        productCode: row[3] || '',      // D列: 商品コード（タイスコード）
        manufacturer: row[5] || '',     // F列: メーカー名
        monthlyUnits: row[8] || ''      // I列: 月間単位数
      };
    }).filter(item => item.productName); // 商品名が空でないものだけ

    console.log(`変換完了: ${equipmentMaster.length}件の福祉用具マスターデータ\n`);

    // ユニークな値を抽出
    const itemTypes = [...new Set(equipmentMaster.map(item => item.itemType).filter(Boolean))].sort();
    const manufacturers = [...new Set(equipmentMaster.map(item => item.manufacturer).filter(Boolean))].sort();

    console.log('【品目一覧】');
    console.log(`総数: ${itemTypes.length}種類`);
    itemTypes.slice(0, 10).forEach(type => console.log(`  - ${type}`));
    if (itemTypes.length > 10) console.log(`  ... 他${itemTypes.length - 10}件`);

    console.log('\n【メーカー一覧】');
    console.log(`総数: ${manufacturers.length}社`);
    manufacturers.slice(0, 10).forEach(mfr => console.log(`  - ${mfr}`));
    if (manufacturers.length > 10) console.log(`  ... 他${manufacturers.length - 10}件`);

    console.log('\n【サンプルデータ】');
    equipmentMaster.slice(0, 5).forEach((item, i) => {
      console.log(`\n${i + 1}. 品目: ${item.itemType}`);
      console.log(`   商品名: ${item.productName}`);
      console.log(`   商品コード: ${item.productCode}`);
      console.log(`   メーカー: ${item.manufacturer}`);
      console.log(`   月間単位数: ${item.monthlyUnits}`);
    });

    // JSONファイルとして保存
    const outputPath = './public/equipmentMaster.json';
    fs.writeFileSync(outputPath, JSON.stringify({
      equipmentList: equipmentMaster,
      itemTypes: itemTypes,
      manufacturers: manufacturers
    }, null, 2), 'utf8');

    console.log(`\n✓ データを ${outputPath} に保存しました`);
    console.log(`✓ 総件数: ${equipmentMaster.length}件`);
    console.log(`✓ 品目: ${itemTypes.length}種類`);
    console.log(`✓ メーカー: ${manufacturers.length}社`);

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

fetchEquipmentMaster();
