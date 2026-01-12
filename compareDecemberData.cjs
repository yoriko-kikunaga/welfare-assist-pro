const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function compareDecemberData() {
  try {
    console.log('12月実績データとシート1を比較中...\n');

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const welfareSpreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';

    // シート1のデータを取得
    console.log('シート1を読み込み中...');
    const sheet1Response = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: 'シート1!A:V',
    });

    const sheet1Rows = sheet1Response.data.values;
    const sheet1Headers = sheet1Rows[0];
    const sheet1Data = sheet1Rows.slice(1);

    console.log(`シート1データ: ${sheet1Data.length}件\n`);

    // 12月実績のデータを取得
    console.log('12月実績シートを読み込み中...');
    const decemberResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: '12月実績!A:V',
    });

    const decemberRows = decemberResponse.data.values;
    const decemberHeaders = decemberRows[0];
    const decemberData = decemberRows.slice(1);

    console.log(`12月実績データ: ${decemberData.length}件\n`);

    // ヘッダーを表示して列の位置を確認
    console.log('=== シート1のヘッダー ===');
    sheet1Headers.forEach((header, index) => {
      console.log(`${String.fromCharCode(65 + index)}列 (${index}): ${header}`);
    });

    console.log('\n=== 12月実績のヘッダー ===');
    decemberHeaders.forEach((header, index) => {
      console.log(`${String.fromCharCode(65 + index)}列 (${index}): ${header}`);
    });

    // シート1のデータをマップに変換（あおぞらIDをキーに）
    const sheet1Map = new Map();
    sheet1Data.forEach(row => {
      const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID
      if (aozoraId) {
        sheet1Map.set(aozoraId, {
          aozoraId: aozoraId,
          name: (row[2] || '').trim(), // C列: 氏名
          careSupportOffice: (row[21] || '').trim(), // V列: 居宅介護支援事業所
          units: (row[3] || '').trim(), // D列: 単位数
          startDate: (row[10] || '').trim(), // K列: 利用初回日
        });
      }
    });

    // 12月実績のデータをマップに変換
    const decemberMap = new Map();
    decemberData.forEach(row => {
      const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID
      if (aozoraId) {
        decemberMap.set(aozoraId, {
          aozoraId: aozoraId,
          name: (row[2] || '').trim(), // C列: 氏名
          careSupportOffice: (row[21] || '').trim(), // V列: 居宅介護支援事業所
          units: (row[3] || '').trim(), // D列: 単位数
          startDate: (row[10] || '').trim(), // K列: 利用初回日
        });
      }
    });

    // 差分を抽出
    const newUsers = [];
    const changedUnits = [];
    const changedCareSupportOffice = [];
    const changedStartDate = [];

    // 新規利用者と変更データを検出
    for (const [aozoraId, decemberUser] of decemberMap.entries()) {
      const sheet1User = sheet1Map.get(aozoraId);

      // 新規利用者: シート1に氏名がないが12月実績に氏名がある
      if (!sheet1User || !sheet1User.name) {
        if (decemberUser.name) {
          newUsers.push(decemberUser);
        }
      } else {
        // 既存利用者の変更をチェック

        // 単位数の変更
        if (sheet1User.units !== decemberUser.units && decemberUser.units) {
          changedUnits.push({
            aozoraId: aozoraId,
            name: decemberUser.name,
            oldUnits: sheet1User.units,
            newUnits: decemberUser.units,
          });
        }

        // 居宅介護支援事業所の変更
        if (sheet1User.careSupportOffice !== decemberUser.careSupportOffice && decemberUser.careSupportOffice) {
          changedCareSupportOffice.push({
            aozoraId: aozoraId,
            name: decemberUser.name,
            oldOffice: sheet1User.careSupportOffice,
            newOffice: decemberUser.careSupportOffice,
          });
        }

        // 利用初回日の変更
        if (sheet1User.startDate !== decemberUser.startDate && decemberUser.startDate) {
          changedStartDate.push({
            aozoraId: aozoraId,
            name: decemberUser.name,
            oldStartDate: sheet1User.startDate,
            newStartDate: decemberUser.startDate,
          });
        }
      }
    }

    // 結果を表示
    console.log('\n\n========================================');
    console.log('         差分レポート');
    console.log('========================================\n');

    console.log(`【1】新規利用者: ${newUsers.length}件`);
    if (newUsers.length > 0) {
      console.log('---');
      newUsers.forEach((user, index) => {
        console.log(`${index + 1}. あおぞらID: ${user.aozoraId}`);
        console.log(`   氏名: ${user.name}`);
        console.log(`   居宅介護支援事業所: ${user.careSupportOffice}`);
        console.log(`   利用初回日: ${user.startDate}`);
        console.log(`   単位数: ${user.units}`);
        console.log('');
      });
    }

    console.log(`【2】単位数の変更: ${changedUnits.length}件`);
    if (changedUnits.length > 0) {
      console.log('---');
      changedUnits.forEach((change, index) => {
        console.log(`${index + 1}. ${change.name} (${change.aozoraId})`);
        console.log(`   変更前: ${change.oldUnits} → 変更後: ${change.newUnits}`);
        console.log('');
      });
    }

    console.log(`【3】居宅介護支援事業所の変更: ${changedCareSupportOffice.length}件`);
    if (changedCareSupportOffice.length > 0) {
      console.log('---');
      changedCareSupportOffice.forEach((change, index) => {
        console.log(`${index + 1}. ${change.name} (${change.aozoraId})`);
        console.log(`   変更前: ${change.oldOffice}`);
        console.log(`   変更後: ${change.newOffice}`);
        console.log('');
      });
    }

    console.log(`【4】利用初回日の変更: ${changedStartDate.length}件`);
    if (changedStartDate.length > 0) {
      console.log('---');
      changedStartDate.forEach((change, index) => {
        console.log(`${index + 1}. ${change.name} (${change.aozoraId})`);
        console.log(`   変更前: ${change.oldStartDate}`);
        console.log(`   変更後: ${change.newStartDate}`);
        console.log('');
      });
    }

    console.log('========================================\n');

    // JSONファイルに保存
    const report = {
      generatedAt: new Date().toISOString(),
      summary: {
        newUsers: newUsers.length,
        changedUnits: changedUnits.length,
        changedCareSupportOffice: changedCareSupportOffice.length,
        changedStartDate: changedStartDate.length,
      },
      details: {
        newUsers: newUsers,
        changedUnits: changedUnits,
        changedCareSupportOffice: changedCareSupportOffice,
        changedStartDate: changedStartDate,
      }
    };

    fs.writeFileSync('./december-comparison-report.json', JSON.stringify(report, null, 2), 'utf8');
    console.log('✓ レポートを december-comparison-report.json に保存しました\n');

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    if (error.stack) {
      console.error(`スタックトレース: ${error.stack}`);
    }
  }
}

compareDecemberData();
