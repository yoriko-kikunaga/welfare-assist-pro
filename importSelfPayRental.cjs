const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function importSelfPayRental() {
  try {
    console.log('自費レンタル福祉用具情報をインポート中...\n');

    // 既存のclients.jsonを読み込む
    const clientsPath = './clients.json';
    if (!fs.existsSync(clientsPath)) {
      console.error('エラー: clients.jsonが見つかりません。先にimportSpreadsheetData.cjsを実行してください。');
      return;
    }

    const clients = JSON.parse(fs.readFileSync(clientsPath, 'utf8'));
    console.log(`既存の利用者データ: ${clients.length}件\n`);

    // サービスアカウントキーを使用して認証
    const auth = new GoogleAuth({
      keyFile: './service-account-key.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const authClient = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    // 福祉用具利用者スプレッドシートからデータを取得
    console.log('福祉用具利用者スプレッドシート「シート1」からデータを読み込み中...');
    const spreadsheetId = '1v_TEkErlpYJRKJADX2AcDzIE2mJBuiwoymVi1quAVDs';
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: 'シート1!A:T',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('データが見つかりませんでした。');
      return;
    }

    const headers = rows[0];
    const dataRows = rows.slice(1);

    // A列が「自費レンタル」のデータをフィルター
    const selfPayRentalRows = dataRows.filter(row => row[0] === '自費レンタル');
    console.log(`A列が「自費レンタル」のデータ: ${selfPayRentalRows.length}件\n`);

    // 数値文字列をパース（カンマを除去）
    const parseNumber = (value) => {
      if (!value) return 0;
      const cleaned = String(value).replace(/,/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };

    // あおぞらIDでクライアントを検索するためのMapを作成
    const clientsByAozoraId = new Map();
    clients.forEach(client => {
      clientsByAozoraId.set(client.aozoraId, client);
    });

    // 自費レンタルデータをインポート
    console.log('自費レンタルデータを処理中...\n');
    let equipmentAdded = 0;
    let clientsNotFound = 0;
    const notFoundIds = [];

    selfPayRentalRows.forEach((row, index) => {
      const aozoraId = String(row[1] || '').trim(); // B列: あおぞらID
      const productName = row[14] || ''; // O列: 商品名（請求費目）
      const unitPrice = parseNumber(row[15]); // P列: 単価
      const quantity = parseNumber(row[16]); // Q列: 数量
      const subtotalAmount = parseNumber(row[17]); // R列: 請求額（小計）
      const taxType = row[18] || '非課税'; // S列: 税区分
      const taxIncludedAmount = parseNumber(row[19]); // T列: 税込み請求額

      // あおぞらIDでクライアントを検索
      const client = clientsByAozoraId.get(aozoraId);

      if (!client) {
        clientsNotFound++;
        notFoundIds.push(aozoraId);
        return;
      }

      // selectedEquipmentに追加
      const equipmentId = `selfpay-${aozoraId}-${Date.now()}-${index}`;
      const equipment = {
        id: equipmentId,
        name: productName,
        category: '自費レンタル',
        status: '自費レンタル',
        selfPayProductName: productName,
        unitPrice: unitPrice,
        quantity: quantity,
        subtotalAmount: subtotalAmount,
        taxType: taxType,
        taxIncludedAmount: taxIncludedAmount
      };

      client.selectedEquipment.push(equipment);
      equipmentAdded++;
    });

    // 更新したデータを保存
    fs.writeFileSync(clientsPath, JSON.stringify(clients, null, 2), 'utf8');

    console.log(`✓ データを ${clientsPath} に保存しました`);
    console.log(`✓ 自費レンタル福祉用具を追加: ${equipmentAdded}件`);

    if (clientsNotFound > 0) {
      console.log(`\n⚠ あおぞらIDが見つからなかったデータ: ${clientsNotFound}件`);
      console.log(`見つからなかったあおぞらID（最初の10件）:`);
      notFoundIds.slice(0, 10).forEach(id => {
        console.log(`  - ${id}`);
      });
      if (notFoundIds.length > 10) {
        console.log(`  ... 他 ${notFoundIds.length - 10}件`);
      }
    }

    // 統計情報を表示
    const clientsWithSelfPay = clients.filter(c =>
      c.selectedEquipment.some(e => e.status === '自費レンタル')
    );
    console.log(`\n✓ 自費レンタル福祉用具を持つ利用者: ${clientsWithSelfPay.length}件`);
    console.log(`✓ 総福祉用具数: ${clients.reduce((sum, c) => sum + c.selectedEquipment.length, 0)}件`);

    // サンプルデータを表示
    console.log('\n【サンプルデータ】');
    clientsWithSelfPay.slice(0, 3).forEach((client, i) => {
      const selfPayEquipment = client.selectedEquipment.filter(e => e.status === '自費レンタル');
      console.log(`\n${i + 1}. ${client.name} (${client.aozoraId})`);
      selfPayEquipment.forEach((eq, j) => {
        console.log(`   [${j + 1}] ${eq.selfPayProductName}`);
        console.log(`       単価: ${eq.unitPrice}円 x 数量: ${eq.quantity} = 小計: ${eq.subtotalAmount}円`);
        console.log(`       税区分: ${eq.taxType} | 税込: ${eq.taxIncludedAmount}円`);
      });
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

importSelfPayRental();
