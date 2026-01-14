const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function createSalesSpreadsheet() {
  try {
    console.log('販売データ用スプレッドシートを作成中...\n');

    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive'
      ],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive = google.drive({ version: 'v3', auth: authClient });

    // スプレッドシートを作成
    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: '販売データ管理',
        },
        sheets: [
          {
            properties: {
              title: '販売一覧',
              gridProperties: {
                frozenRowCount: 1,
              },
            },
          },
        ],
      },
    });

    const spreadsheetId = createResponse.data.spreadsheetId;
    console.log(`✓ スプレッドシート作成完了`);
    console.log(`  ID: ${spreadsheetId}`);
    console.log(`  URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}\n`);

    // ヘッダーを設定
    const headers = [
      'あおぞらID',       // A - 必須
      '利用者名',         // B - 参照用
      '商品名',           // C - 必須
      '受注日',           // D
      '納品日',           // E
      '営業担当',         // F
      '数量',             // G
      '単価（税抜）',     // H
      '税区分',           // I - 非課税/10％/軽8％/税込
      '税込金額',         // J - 自動計算または手入力
      '送料',             // K
      '取引内容',         // L - 社内間取引/社内外取引
      '支払い方法',       // M - 口座引き落とし/現金集金/受領委任払い/償還払い/日常生活給付
      '利用者自己負担割合', // N
      '申請',             // O - TRUE/FALSE
      '申請市町村',       // P
      '備考',             // Q
    ];

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: '販売一覧!A1:Q1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });

    console.log('✓ ヘッダー設定完了');
    console.log('  列構成:');
    headers.forEach((h, i) => {
      const col = String.fromCharCode(65 + i);
      console.log(`    ${col}. ${h}`);
    });

    // ヘッダー行のスタイルを設定
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // ヘッダー行の背景色を緑に
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.6, blue: 0.2 },
                  textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
                  horizontalAlignment: 'CENTER',
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
            },
          },
          // 列幅を調整
          {
            updateDimensionProperties: {
              range: { sheetId: 0, dimension: 'COLUMNS', startIndex: 0, endIndex: 17 },
              properties: { pixelSize: 120 },
              fields: 'pixelSize',
            },
          },
        ],
      },
    });

    console.log('\n✓ スタイル設定完了');

    // データ入力規則を設定（税区分、取引内容、支払い方法）
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          // 税区分のドロップダウン (I列)
          {
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: [
                    { userEnteredValue: '非課税' },
                    { userEnteredValue: '10％' },
                    { userEnteredValue: '軽8％' },
                    { userEnteredValue: '税込' },
                  ],
                },
                showCustomUi: true,
              },
            },
          },
          // 取引内容のドロップダウン (L列)
          {
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 11, endColumnIndex: 12 },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: [
                    { userEnteredValue: '社内間取引' },
                    { userEnteredValue: '社内外取引' },
                  ],
                },
                showCustomUi: true,
              },
            },
          },
          // 支払い方法のドロップダウン (M列)
          {
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 12, endColumnIndex: 13 },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: [
                    { userEnteredValue: '口座引き落とし' },
                    { userEnteredValue: '現金集金' },
                    { userEnteredValue: '受領委任払い' },
                    { userEnteredValue: '償還払い' },
                    { userEnteredValue: '日常生活給付' },
                  ],
                },
                showCustomUi: true,
              },
            },
          },
          // 利用者自己負担割合のドロップダウン (N列)
          {
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 13, endColumnIndex: 14 },
              rule: {
                condition: {
                  type: 'ONE_OF_LIST',
                  values: [
                    { userEnteredValue: '自己負担０（日常生活給付）' },
                    { userEnteredValue: '一部負担（日常生活給付）' },
                    { userEnteredValue: '１割負担（受領委任払い）' },
                    { userEnteredValue: '２割負担（受領委任払い）' },
                    { userEnteredValue: '３割負担（受領委任払い）' },
                    { userEnteredValue: '全額負担（償還払い）' },
                  ],
                },
                showCustomUi: true,
              },
            },
          },
          // 申請のチェックボックス (O列)
          {
            setDataValidation: {
              range: { sheetId: 0, startRowIndex: 1, startColumnIndex: 14, endColumnIndex: 15 },
              rule: {
                condition: { type: 'BOOLEAN' },
                showCustomUi: true,
              },
            },
          },
        ],
      },
    });

    console.log('✓ データ入力規則設定完了');

    // スプレッドシートを共有設定（リンクを知っている人は閲覧可能）
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: {
        role: 'writer',
        type: 'anyone',
      },
    });

    console.log('✓ 共有設定完了（リンクを知っている人は編集可能）');

    console.log('\n========================================');
    console.log('販売データスプレッドシート作成完了');
    console.log('========================================');
    console.log(`\nスプレッドシートID: ${spreadsheetId}`);
    console.log(`URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
    console.log('\n次のステップ:');
    console.log('1. 上記URLでスプレッドシートを開く');
    console.log('2. 販売データを入力');
    console.log('3. importSalesData.cjs でアプリにインポート');

  } catch (error) {
    console.error('エラー:', error.message);
    if (error.response) {
      console.error('詳細:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

createSalesSpreadsheet();
