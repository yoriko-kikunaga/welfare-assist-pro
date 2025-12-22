const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function updateGenderFromNames() {
  try {
    console.log('福祉用具利用者の氏名から性別を更新中...\n');

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // 福祉用具利用者スプレッドシート
    const welfareSpreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';

    console.log('福祉用具利用者データを読み込み中...');
    const welfareResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: welfareSpreadsheetId,
      range: 'シート1!B:C', // B列: 利用者名（あおぞらID）、C列以降: その他の情報
    });

    const welfareRows = welfareResponse.data.values;
    const welfareData = welfareRows.slice(1); // ヘッダー行を除く

    console.log(`福祉用具利用者データ: ${welfareData.length}件\n`);

    // 女性と判断できる名前のパターン
    const isFemaleNamePattern = (name) => {
      if (!name) return false;

      // 名前部分を抽出（スペースで分割して後半）
      const parts = name.trim().split(/\s+/);
      const firstName = parts.length > 1 ? parts[parts.length - 1] : name;

      // 女性名の典型的なパターン
      const femalePatterns = [
        /子$/,       // ～子で終わる
        /美$/,       // ～美で終わる
        /江$/,       // ～江で終わる
        /代$/,       // ～代で終わる
        /枝$/,       // ～枝で終わる
        /乃$/,       // ～乃で終わる
        /香$/,       // ～香で終わる
        /花$/,       // ～花で終わる
        /菜$/,       // ～菜で終わる
        /音$/,       // ～音で終わる
        /葉$/,       // ～葉で終わる
        /恵$/,       // ～恵で終わる
        /絵$/,       // ～絵で終わる
        /加$/,       // ～加で終わる
        /佳$/,       // ～佳で終わる
        /華$/,       // ～華で終わる
        /[女婦姫]/, // 女、婦、姫を含む
      ];

      // カタカナの「子」「ヱ」「ミ」などで終わるパターン
      const femaleKanaPatterns = [
        /コ$/,   // ～コで終わる
        /ミ$/,   // ～ミで終わる
        /エ$/,   // ～エで終わる
        /ヱ$/,   // ～ヱで終わる
        /ヨ$/,   // ～ヨで終わる
        /[ナノカミヨサエリマキヨウハナアイ]$/,
      ];

      return femalePatterns.some(pattern => pattern.test(firstName)) ||
             femaleKanaPatterns.some(pattern => pattern.test(firstName));
    };

    // 福祉用具利用者のあおぞらIDをSetに格納
    const femaleNameIds = new Set();

    welfareData.forEach(row => {
      const aozoraId = row[0]; // B列: 利用者名（あおぞらID）

      if (aozoraId) {
        // 実際にはあおぞらIDではなく氏名が入っているので、clients.jsonとマッチングする
        femaleNameIds.add(aozoraId);
      }
    });

    console.log(`福祉用具利用者: ${femaleNameIds.size}件`);

    // 既存のclients.jsonを読み込み
    console.log('\n既存のclients.jsonを読み込み中...');
    const clientsData = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    console.log(`既存クライアント数: ${clientsData.length}件`);

    // データを更新
    let genderUpdated = 0;
    const femaleClients = [];

    clientsData.forEach(client => {
      // 福祉用具利用者で、かつ名前が女性のパターンに一致する場合
      if (client.isWelfareEquipmentUser && isFemaleNamePattern(client.name)) {
        if (client.gender !== '女性') {
          client.gender = '女性';
          genderUpdated++;
          femaleClients.push(client);
        }
      }
    });

    // 更新したデータを保存
    fs.writeFileSync('./clients.json', JSON.stringify(clientsData, null, 2), 'utf8');

    console.log('\n✓ データ更新完了');
    console.log(`✓ 性別を女性に更新: ${genderUpdated}件`);

    // サンプルデータを表示
    console.log('\n【女性に更新されたサンプルデータ】');
    femaleClients.slice(0, 10).forEach((client, i) => {
      console.log(`${i + 1}. ${client.name} (${client.nameKana}) - ID: ${client.aozoraId}`);
    });

    // 統計情報
    const stats = {
      total: clientsData.length,
      male: clientsData.filter(c => c.gender === '男性').length,
      female: clientsData.filter(c => c.gender === '女性').length,
      welfareUsers: clientsData.filter(c => c.isWelfareEquipmentUser).length,
      welfareUsersFemale: clientsData.filter(c => c.isWelfareEquipmentUser && c.gender === '女性').length,
    };

    console.log('\n【統計情報】');
    console.log(`総クライアント数: ${stats.total}件`);
    console.log(`  男性: ${stats.male}件`);
    console.log(`  女性: ${stats.female}件`);
    console.log(`福祉用具利用者: ${stats.welfareUsers}件`);
    console.log(`  うち女性: ${stats.welfareUsersFemale}件`);

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

updateGenderFromNames();
