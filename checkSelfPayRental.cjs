const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function checkSelfPayRentalData() {
  try {
    console.log('新規福祉用具タブの構造を確認中...\n');

    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';

    // スプレッドシートのメタデータを取得してシート名を確認
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });

    console.log('利用可能なシート:');
    metadata.data.sheets.forEach(sheet => {
      console.log(`  - ${sheet.properties.title} (ID: ${sheet.properties.sheetId})`);
    });

    // シート1のデータを取得
    console.log('\nシート1のデータを読み込み中...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'シート1!A:Z',
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log('データが見つかりませんでした。');
      return;
    }

    const headers = rows[0];
    console.log('\nヘッダー行:');
    headers.forEach((header, index) => {
      const column = String.fromCharCode(65 + index); // A, B, C, ...
      console.log(`  ${column}列: ${header}`);
    });

    console.log(`\n総行数: ${rows.length}件`);

    // A列に「自費レンタル」があるデータを検索
    const selfPayRentalRows = rows.slice(1).filter(row => row[0] === '自費レンタル');
    console.log(`\nA列に「自費レンタル」があるデータ: ${selfPayRentalRows.length}件`);

    // サンプルデータを表示（最初の5件）
    console.log('\nサンプルデータ（最初の5件）:');
    selfPayRentalRows.slice(0, 5).forEach((row, i) => {
      console.log(`\n${i + 1}件目:`);
      headers.forEach((header, index) => {
        if (row[index]) {
          const column = String.fromCharCode(65 + index);
          console.log(`  ${column}列 (${header}): ${row[index]}`);
        }
      });
    });

    // 重要な列のインデックスを確認
    console.log('\n重要な列のインデックス:');
    const importantColumns = [
      'あおぞらID',
      '利用者名',
      '商品名（請求費目）', // O列
      '単価', // P列
      '数量',
      '請求額（小計）',
      '税区分',
      '税込み金額'
    ];

    importantColumns.forEach(colName => {
      const index = headers.indexOf(colName);
      if (index !== -1) {
        const column = String.fromCharCode(65 + index);
        console.log(`  ${colName}: ${column}列 (インデックス ${index})`);
      } else {
        console.log(`  ${colName}: 見つかりませんでした`);
      }
    });

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(error.message);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

checkSelfPayRentalData();
