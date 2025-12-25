const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function checkWelfareEquipmentData() {
  try {
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const spreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';

    // スプレッドシート内のシート一覧を取得
    const spreadsheetInfo = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId
    });

    console.log('スプレッドシート内のシート一覧:\n');
    spreadsheetInfo.data.sheets.forEach((sheet, i) => {
      console.log(`${i + 1}. ${sheet.properties.title}`);
    });

    // 最初のシートのヘッダー行を取得
    const firstSheetName = spreadsheetInfo.data.sheets[0].properties.title;
    console.log(`\n「${firstSheetName}」シートのヘッダー行:\n`);

    const headersResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${firstSheetName}!1:1`,
    });

    const headers = headersResponse.data.values[0];
    headers.forEach((header, i) => {
      const columnLetter = String.fromCharCode(65 + i);
      console.log(`${columnLetter}列: ${header}`);
    });

    // サンプルデータを取得
    console.log('\nサンプルデータ（最初の5行）:\n');
    const dataResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: `${firstSheetName}!A1:Z6`,
    });

    const rows = dataResponse.data.values;
    rows.forEach((row, i) => {
      console.log(`\n--- 行 ${i + 1} ---`);
      row.forEach((cell, j) => {
        if (cell) {
          console.log(`  ${headers[j]}: ${cell}`);
        }
      });
    });

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
  }
}

checkWelfareEquipmentData();
