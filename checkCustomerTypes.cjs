const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');

async function checkCustomerTypes() {
  const auth = new GoogleAuth({
    keyFile: './service-account-key.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const spreadsheetId = '1DhwY6F1LaveixKXtie80fn7FWBYYqsGsY3ADU37CIAA';

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: '利用者!A:H',
  });

  const rows = response.data.values;
  const data = rows.slice(1);

  // H列（顧客種別）のユニークな値を集計
  const customerTypes = {};
  data.forEach(row => {
    const type = row[7] || '(空)';
    customerTypes[type] = (customerTypes[type] || 0) + 1;
  });

  console.log('顧客種別の内訳:\n');
  Object.entries(customerTypes)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}件`);
    });

  console.log(`\n合計: ${data.length}件`);
}

checkCustomerTypes().catch(console.error);
