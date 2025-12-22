const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function importAdditionalData() {
  try {
    console.log('追加データをスプレッドシートから取得中...\n');

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // 新しいスプレッドシートID
    const newSpreadsheetId = '11WYWyOy5FK2LSCPvK9iFQEh2rQ0501Fn6krD__3ZndU';

    // まずスプレッドシートのメタデータを取得してシート名を確認
    console.log('スプレッドシートのメタデータを取得中...');
    const metadata = await sheets.spreadsheets.get({
      spreadsheetId: newSpreadsheetId,
    });

    const sheetNames = metadata.data.sheets.map(sheet => sheet.properties.title);
    console.log(`利用可能なシート: ${sheetNames.join(', ')}\n`);

    const sheetName = sheetNames[0]; // 最初のシートを使用
    console.log(`シート「${sheetName}」からデータを読み込み中...`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: newSpreadsheetId,
      range: `${sheetName}!A:Z`, // 全列を読み込み
    });

    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log('データが見つかりませんでした。');
      return;
    }

    // ヘッダー行を表示
    console.log('\nヘッダー行:');
    console.log(rows[0]);
    console.log('\nサンプルデータ（最初の3行）:');
    rows.slice(1, 4).forEach((row, i) => {
      console.log(`\n${i + 1}行目:`);
      rows[0].forEach((header, idx) => {
        if (row[idx]) {
          console.log(`  ${header}: ${row[idx]}`);
        }
      });
    });

    // データをマッピング（ヘッダーから列のインデックスを取得）
    const headers = rows[0];
    const nameIndex = headers.findIndex(h => h.includes('利用者名'));
    const kanaIndex = headers.findIndex(h => h.includes('利用者カナ'));
    const careLevelIndex = headers.findIndex(h => h.includes('要介護度') || h.includes('介護度'));
    const copayRateIndex = headers.findIndex(h => h.includes('給付率'));
    const careManagerIndex = headers.findIndex(h => h.includes('担当ケアマネ'));

    console.log(`\n列インデックス:`);
    console.log(`  利用者名: ${nameIndex} (${headers[nameIndex] || 'なし'})`);
    console.log(`  利用者カナ: ${kanaIndex} (${headers[kanaIndex] || 'なし'})`);
    console.log(`  要介護度: ${careLevelIndex} (${headers[careLevelIndex] || 'なし'})`);
    console.log(`  給付率: ${copayRateIndex} (${headers[copayRateIndex] || 'なし'})`);
    console.log(`  担当ケアマネ: ${careManagerIndex} (${headers[careManagerIndex] || 'なし'})`);

    // 給付率から負担割合への変換関数
    const convertCopayRate = (kyufuRate) => {
      if (!kyufuRate) return '';
      const rate = String(kyufuRate).trim();
      if (rate.startsWith('90')) return '1割';
      if (rate.startsWith('80')) return '2割';
      if (rate.startsWith('70')) return '3割';
      return '';
    };

    // 要介護度の正規化関数
    const normalizeCareLevel = (level) => {
      if (!level) return '';
      let normalized = String(level).trim();
      // 全角数字を半角に変換
      normalized = normalized.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
      // スペースを除去
      normalized = normalized.replace(/\s+/g, '');
      return normalized;
    };

    // データを格納（名前とカナでマッチング用）
    const additionalData = new Map();
    const dataRows = rows.slice(1); // ヘッダー行を除く

    dataRows.forEach(row => {
      const name = nameIndex >= 0 ? row[nameIndex] : '';
      const kana = kanaIndex >= 0 ? row[kanaIndex] : '';

      if (name) {
        const careLevel = careLevelIndex >= 0 ? normalizeCareLevel(row[careLevelIndex]) : '';
        const copayRate = copayRateIndex >= 0 ? convertCopayRate(row[copayRateIndex]) : '';
        const careManager = careManagerIndex >= 0 ? row[careManagerIndex] : '';

        if (careLevel || copayRate || careManager) {
          const key = `${name}|${kana}`;
          additionalData.set(key, {
            careLevel,
            copayRate,
            careManager,
            name,
            kana
          });
        }
      }
    });

    console.log(`\n追加データ取得完了: ${additionalData.size}件\n`);

    // 既存のclients.jsonを読み込み
    console.log('既存のclients.jsonを読み込み中...');
    const clientsData = JSON.parse(fs.readFileSync('./clients.json', 'utf8'));
    console.log(`既存クライアント数: ${clientsData.length}件`);

    // データを更新（名前とカナでマッチング）
    let careLevelUpdated = 0;
    let copayRateUpdated = 0;
    let careManagerUpdated = 0;
    let matchedCount = 0;

    clientsData.forEach(client => {
      const clientKey = `${client.name}|${client.nameKana}`;

      if (additionalData.has(clientKey)) {
        matchedCount++;
        const newData = additionalData.get(clientKey);

        if (newData.careLevel && newData.careLevel !== client.careLevel) {
          client.careLevel = newData.careLevel;
          careLevelUpdated++;
        }

        if (newData.copayRate && newData.copayRate !== client.copayRate) {
          client.copayRate = newData.copayRate;
          copayRateUpdated++;
        }

        if (newData.careManager && newData.careManager !== client.careManager) {
          client.careManager = newData.careManager;
          careManagerUpdated++;
        }
      }
    });

    console.log(`\n一致したクライアント: ${matchedCount}件`);

    // 更新したデータを保存
    fs.writeFileSync('./clients.json', JSON.stringify(clientsData, null, 2), 'utf8');

    console.log('\n✓ データ更新完了');
    console.log(`✓ 要介護度を更新: ${careLevelUpdated}件`);
    console.log(`✓ 負担割合を更新: ${copayRateUpdated}件`);
    console.log(`✓ 担当CMを更新: ${careManagerUpdated}件`);

    // サンプルデータを表示
    console.log('\n【更新されたサンプルデータ】');
    const updatedClients = clientsData.filter(c => {
      const key = `${c.name}|${c.nameKana}`;
      return additionalData.has(key);
    }).slice(0, 5);

    updatedClients.forEach((client, i) => {
      console.log(`\n${i + 1}. ${client.name} (${client.nameKana})`);
      console.log(`   あおぞらID: ${client.aozoraId}`);
      console.log(`   要介護度: ${client.careLevel}`);
      console.log(`   負担割合: ${client.copayRate}`);
      console.log(`   担当CM: ${client.careManager}`);
    });

  } catch (error) {
    console.error('エラーが発生しました:');
    console.error(`エラーメッセージ: ${error.message}`);
    if (error.response) {
      console.error(`ステータスコード: ${error.response.status}`);
      console.error(`詳細: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

importAdditionalData();
