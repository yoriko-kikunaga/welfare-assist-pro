const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function findDeletedSelfPayUsers() {
  try {
    console.log('シート1と12月実績を比較して削除された自費レンタル利用者を特定中...\n');

    // 認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const welfareSpreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';

    // シート1を読み込み
    console.log('シート1を読み込み中...');
    const sheet1Response = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: 'シート1!A:V',
    });

    const sheet1Rows = sheet1Response.data.values;
    const sheet1Data = sheet1Rows.slice(1); // ヘッダーをスキップ

    // 12月実績を読み込み
    console.log('12月実績を読み込み中...');
    const decemberResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: '12月実績!A:V',
    });

    const decemberRows = decemberResponse.data.values;
    const decemberData = decemberRows.slice(1); // ヘッダーをスキップ

    // シート1の自費レンタル利用者を抽出
    const sheet1SelfPayUsers = new Set();
    sheet1Data.forEach(row => {
      const usageType = row[0]; // A列: 利用区分
      const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID

      if (usageType === '自費レンタル' && aozoraId) {
        sheet1SelfPayUsers.add(aozoraId);
      }
    });

    // 12月実績の自費レンタル利用者を抽出
    const decemberSelfPayUsers = new Set();
    decemberData.forEach(row => {
      const usageType = row[0]; // A列: 利用区分
      const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID

      if (usageType === '自費レンタル' && aozoraId) {
        decemberSelfPayUsers.add(aozoraId);
      }
    });

    // 削除された自費レンタル利用者を特定
    const deletedSelfPayUsers = [];
    for (const aozoraId of sheet1SelfPayUsers) {
      if (!decemberSelfPayUsers.has(aozoraId)) {
        deletedSelfPayUsers.push(aozoraId);
      }
    }

    console.log('\n=== 比較結果 ===');
    console.log(`シート1の自費レンタル利用者: ${sheet1SelfPayUsers.size}件`);
    console.log(`12月実績の自費レンタル利用者: ${decemberSelfPayUsers.size}件`);
    console.log(`削除された自費レンタル利用者: ${deletedSelfPayUsers.length}件\n`);

    if (deletedSelfPayUsers.length > 0) {
      console.log('=== 削除対象の利用者 ===');

      // clients.jsonから詳細情報を取得
      const clients = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));

      deletedSelfPayUsers.forEach(aozoraId => {
        const client = clients.find(c => c.aozoraId === aozoraId);
        if (client) {
          const selfPayEquipment = client.selectedEquipment?.filter(e => e.status === '自費レンタル') || [];
          const salesRecords = client.salesRecords || [];

          console.log(`${aozoraId}: ${client.name}`);
          console.log(`  - 自費レンタル用具数: ${selfPayEquipment.length}件`);
          console.log(`  - 売上レコード数: ${salesRecords.length}件`);
          if (selfPayEquipment.length > 0) {
            selfPayEquipment.forEach(eq => {
              console.log(`    - ${eq.selfPayProductName || eq.name}: ¥${eq.taxIncludedAmount || 0}`);
            });
          }
        } else {
          console.log(`${aozoraId}: クライアントデータが見つかりません`);
        }
        console.log('');
      });

      // JSONファイルに保存
      const report = {
        generatedAt: new Date().toISOString(),
        deletedSelfPayUsers: deletedSelfPayUsers,
        count: deletedSelfPayUsers.length
      };

      fs.writeFileSync('./deleted-selfpay-users.json', JSON.stringify(report, null, 2), 'utf8');
      console.log('✓ deleted-selfpay-users.json に保存しました\n');
    } else {
      console.log('削除された自費レンタル利用者はいません。\n');
    }

  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }

  process.exit(0);
}

findDeletedSelfPayUsers();
