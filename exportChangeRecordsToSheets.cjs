const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// スプレッドシートID
const SPREADSHEET_ID = '1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU';
const SHEET_NAME = 'シート1'; // デフォルトのシート名

// サービスアカウントキーの読み込み
const SERVICE_ACCOUNT_KEY_PATH = path.join(__dirname, 'service-account-key.json');

async function exportChangeRecordsToSheets() {
  try {
    console.log('利用者変更情報のエクスポートを開始します...');

    // clients.jsonを読み込む
    const clientsPath = path.join(__dirname, 'clients.json');
    if (!fs.existsSync(clientsPath)) {
      throw new Error('clients.json が見つかりません');
    }

    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf-8'));
    console.log(`${clients.length}件の利用者データを読み込みました`);

    // 福祉用具利用者のみから変更情報を抽出
    const allChangeRecords = [];

    clients.forEach(client => {
      // 福祉用具利用者でない場合はスキップ
      if (!client.isWelfareEquipmentUser) {
        return;
      }

      if (client.changeRecords && Array.isArray(client.changeRecords)) {
        client.changeRecords.forEach(record => {
          // データ連携日を情報種別に応じて設定
          let dataLinkDate = '';
          switch (record.infoType) {
            case '新規':
            case '新規（自費レンタル）':
            case '新規（購入）':
              dataLinkDate = record.billingStartDateNew || '';
              break;
            case '入院（サービス停止）':
              dataLinkDate = record.billingStopDateHospital || '';
              break;
            case '退院（サービス開始）':
              dataLinkDate = record.billingStartDateDischarge || '';
              break;
            case '解約':
            case '解約（保険レンタル）':
            case '解約（自費レンタル）':
            case '解約（購入）':
              dataLinkDate = record.billingStopDateCancel || '';
              break;
            default:
              dataLinkDate = '';
          }

          allChangeRecords.push({
            recordDate: record.recordDate || '',
            aozoraId: client.aozoraId || '',
            clientName: client.name || '',
            facilityName: client.facilityName || '',
            infoType: record.infoType || '',
            billingStartDateNew: record.billingStartDateNew || '',
            billingStopDateHospital: record.billingStopDateHospital || '',
            billingStartDateDischarge: record.billingStartDateDischarge || '',
            billingStopDateCancel: record.billingStopDateCancel || '',
            dataLinkDate: dataLinkDate,
            recorder: record.recorder || '',
            office: record.office || ''
          });
        });
      }
    });

    console.log(`${allChangeRecords.length}件の変更情報を抽出しました（福祉用具利用者のみ）`);

    if (allChangeRecords.length === 0) {
      console.log('エクスポートする変更情報がありません');
      return;
    }

    // データ連携日の昇順でソート（古い順）
    allChangeRecords.sort((a, b) => {
      if (!a.dataLinkDate) return 1;
      if (!b.dataLinkDate) return -1;
      return a.dataLinkDate.localeCompare(b.dataLinkDate);
    });

    // Google Sheets APIの認証
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // ヘッダー行
    const headers = [
      '入力日',
      'あおぞらID',
      '利用者名',
      '施設名',
      '情報種別',
      '請求開始日（新規）',
      '請求停止日（入院）',
      '請求開始日（退院）',
      '請求停止日（解約）',
      'データ連携日',
      '記録者',
      '事業所'
    ];

    // データ行を準備
    const rows = allChangeRecords.map(record => [
      record.recordDate,
      record.aozoraId,
      record.clientName,
      record.facilityName,
      record.infoType,
      record.billingStartDateNew,
      record.billingStopDateHospital,
      record.billingStartDateDischarge,
      record.billingStopDateCancel,
      record.dataLinkDate,
      record.recorder,
      record.office
    ]);

    // ヘッダーとデータを結合
    const values = [headers, ...rows];

    // スプレッドシートの既存データをクリア
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:Z`,
    });

    console.log('既存データをクリアしました');

    // 新しいデータを書き込む
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: {
        values: values
      }
    });

    console.log(`✓ ${response.data.updatedRows}行を書き込みました`);
    console.log(`✓ スプレッドシートURL: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);

    // ヘッダー行のフォーマット設定
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: 0,
                startRowIndex: 0,
                endRowIndex: 1
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.2,
                    green: 0.5,
                    blue: 0.8
                  },
                  textFormat: {
                    foregroundColor: {
                      red: 1.0,
                      green: 1.0,
                      blue: 1.0
                    },
                    fontSize: 11,
                    bold: true
                  },
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: 0,
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: 12
              }
            }
          }
        ]
      }
    });

    console.log('✓ ヘッダー行をフォーマットしました');
    console.log('エクスポート完了！');

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.response) {
      console.error('APIレスポンス:', error.response.data);
    }
    process.exit(1);
  }
}

// スクリプトを実行
exportChangeRecordsToSheets();
