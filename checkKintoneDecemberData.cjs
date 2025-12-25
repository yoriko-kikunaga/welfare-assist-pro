require('dotenv').config();
const { KintoneRestAPIClient } = require('@kintone/rest-api-client');

async function checkKintoneDecemberData() {
  try {
    const subdomain = process.env.KINTONE_SUBDOMAIN;
    const apiToken197 = process.env.KINTONE_API_TOKEN_197;

    if (!subdomain || !apiToken197) {
      console.error('環境変数が設定されていません');
      return;
    }

    const client197 = new KintoneRestAPIClient({
      baseUrl: `https://${subdomain}.cybozu.com`,
      auth: { apiToken: apiToken197 }
    });

    console.log('=== Kintoneアプリ197のデータ確認 ===\n');

    // 2025年12月のMove_In_Dateを持つレコードを取得
    console.log('1. 2025年12月の入居日（Move_In_Date）を持つレコードを検索中...');
    const dec2025Records = await client197.record.getAllRecords({
      app: 197,
      condition: 'Move_In_Date >= "2025-12-01" and Move_In_Date <= "2025-12-31"'
    });
    console.log(`   取得件数: ${dec2025Records.length}件\n`);

    if (dec2025Records.length > 0) {
      console.log('最初の10件:');
      dec2025Records.slice(0, 10).forEach((rec, idx) => {
        console.log(`${idx + 1}. あおぞらID: ${rec.Aozora_Id?.value}, 入居日: ${rec.Move_In_Date?.value}, 退去日: ${rec.Moving_Out_Date?.value}`);
      });
      if (dec2025Records.length > 10) {
        console.log(`... 他 ${dec2025Records.length - 10}件\n`);
      }
    }

    // 現在のフィルター条件でのデータ取得
    console.log('\n2. 現在のフィルター条件（2025-11-01以降）で取得...');
    const currentFilterRecords = await client197.record.getAllRecords({
      app: 197,
      condition: 'Move_In_Date >= "2025-11-01" or Moving_Out_Date >= "2025-11-01"'
    });
    console.log(`   取得件数: ${currentFilterRecords.length}件\n`);

    // 2025-12のMove_In_Dateを持つレコード数をカウント
    const dec2025Count = currentFilterRecords.filter(rec => {
      const moveInDate = rec.Move_In_Date?.value;
      return moveInDate && moveInDate >= '2025-12-01' && moveInDate <= '2025-12-31';
    }).length;
    console.log(`   うち、入居日が2025-12のレコード: ${dec2025Count}件`);

    // 2025-11のMove_In_Dateを持つレコード数をカウント
    const nov2025Count = currentFilterRecords.filter(rec => {
      const moveInDate = rec.Move_In_Date?.value;
      return moveInDate && moveInDate >= '2025-11-01' && moveInDate <= '2025-11-30';
    }).length;
    console.log(`   うち、入居日が2025-11のレコード: ${nov2025Count}件`);

    // 全期間のMove_In_Dateを取得（制限なし）
    console.log('\n3. 全レコードから2025-12のデータを検索...');
    const allRecords = await client197.record.getAllRecords({
      app: 197
    });
    console.log(`   全レコード数: ${allRecords.length}件`);

    const allDec2025 = allRecords.filter(rec => {
      const moveInDate = rec.Move_In_Date?.value;
      return moveInDate && moveInDate >= '2025-12-01' && moveInDate <= '2025-12-31';
    });
    console.log(`   2025-12の入居日を持つレコード: ${allDec2025.length}件`);

  } catch (error) {
    console.error('エラー:', error.message);
    if (error.response) {
      console.error('APIレスポンス:', error.response.data);
    }
  }
}

checkKintoneDecemberData();
