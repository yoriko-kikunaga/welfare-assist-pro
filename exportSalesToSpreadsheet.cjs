const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function exportSalesToSpreadsheet() {
  try {
    console.log('売上レコードをスプレッドシートにエクスポート中...\n');

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

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // ユーザーが提供したスプレッドシートを使用
    const spreadsheetId = '1zeU-ui7jtc1djMn4virPyHJeb5zIL7c-Sbr1D4oH6nQ';
    const sheetName = `自費レンタル売上_${new Date().toISOString().split('T')[0]}`;
    const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

    console.log(`スプレッドシートにデータを書き込み中...\nスプレッドシートID: ${spreadsheetId}\n`);

    // 新しいシートを追加
    let sheetId = null;
    try {
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        requestBody: {
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName
                }
              }
            }
          ]
        }
      });
      sheetId = addSheetResponse.data.replies[0].addSheet.properties.sheetId;
      console.log(`✓ シート「${sheetName}」を追加しました（シートID: ${sheetId}）\n`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`⚠ シート「${sheetName}」は既に存在します。シートIDを取得中...\n`);
        // 既存のシートIDを取得
        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId: spreadsheetId
        });
        const existingSheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
        if (existingSheet) {
          sheetId = existingSheet.properties.sheetId;
          console.log(`✓ シートID: ${sheetId}\n`);
        }
      } else {
        throw error;
      }
    }

    // ヘッダー行を作成
    const headers = [
      '事業所',
      'Status',
      'あおぞらID',
      '利用者名',
      '施設名',
      '商品名（請求費目）',
      '数量',
      '単価',
      '税区分',
      '税込み請求額'
    ];

    // データ行を作成
    const rows = [headers];
    selfPaySales.forEach(sales => {
      rows.push([
        sales.office || '',
        sales.status || '',
        sales.aozoraId || '',
        sales.clientName || '',
        sales.facilityName || '',
        sales.productName || '',
        sales.quantity || 0,
        sales.unitPrice || 0,
        sales.taxType || '',
        sales.taxIncludedAmount || 0
      ]);
    });

    // スプレッドシートにデータを書き込む
    console.log('データを書き込み中...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: rows
      }
    });

    // ヘッダー行をフォーマット
    if (sheetId !== null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: spreadsheetId,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1
                },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.2,
                    green: 0.6,
                    blue: 0.86
                  },
                  textFormat: {
                    foregroundColor: {
                      red: 1.0,
                      green: 1.0,
                      blue: 1.0
                    },
                    fontSize: 11,
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)'
            }
          },
            {
              autoResizeDimensions: {
                dimensions: {
                  sheetId: sheetId,
                  dimension: 'COLUMNS',
                  startIndex: 0,
                  endIndex: headers.length
                }
              }
            }
          ]
        }
      });
    }

    console.log(`✓ データ書き込み完了: ${selfPaySales.length}行`);
    console.log(`\n✓ スプレッドシートURL:\n${spreadsheetUrl}`);
    console.log(`\n✓ スプレッドシートID:\n${spreadsheetId}`);

    // サマリーを表示
    const totalAmount = selfPaySales.reduce((sum, s) => sum + (s.unitPrice * s.quantity), 0);
    const officeBreakdown = {};
    selfPaySales.forEach(s => {
      if (!officeBreakdown[s.office]) {
        officeBreakdown[s.office] = { count: 0, amount: 0 };
      }
      officeBreakdown[s.office].count++;
      officeBreakdown[s.office].amount += s.unitPrice * s.quantity;
    });

    console.log('\n【売上サマリー】');
    console.log(`総件数: ${selfPaySales.length}件`);
    console.log(`総売上額（税抜）: ${totalAmount.toLocaleString()}円`);
    console.log('\n事業所別:');
    Object.entries(officeBreakdown).forEach(([office, data]) => {
      console.log(`  ${office}: ${data.count}件 / ${data.amount.toLocaleString()}円`);
    });

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    console.error(error.stack);
  }
}

exportSalesToSpreadsheet();
