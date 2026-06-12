/**
 * 変更情報同期シート（シート1）の整形クリーンアップ
 * - 中段に紛れたヘッダー行・空行を除去
 * - recordId 重複を除去（先勝ち）
 * - データ連携日(N列)昇順で並べ替え（空は末尾） ※同期関数と同じ順序
 * - ヘッダーを1行目に戻して書き直し、書式設定＋1行目を固定（再ソート事故防止）
 *
 * 実行: node fixChangeRecordsSheet.cjs          （ドライラン・バックアップのみ）
 *       node fixChangeRecordsSheet.cjs --apply   （本番シートへ書き込み）
 */
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

const SPREADSHEET_ID = '1E3jT222WbUYs2s_TXsme3HpmNqWG8fKHxqgQFBrEcQU';
const SHEET_NAME = 'シート1';
const APPLY = process.argv.includes('--apply');

const HEADERS = [
  'レコードID', '入力日', 'あおぞらID', '利用者名', '施設名', '情報種別', '利用区分',
  '請求開始日（新規）', '請求停止日（入院）', '請求開始日（退院）', '請求停止日（解約）',
  'デモ開始日', 'デモ終了日', 'データ連携日', '卸会社停止連絡', '卸会社再開連絡',
  '記録者', '事業所', '特記',
];

(async () => {
  const scopes = APPLY
    ? ['https://www.googleapis.com/auth/spreadsheets']
    : ['https://www.googleapis.com/auth/spreadsheets.readonly'];
  const auth = new GoogleAuth({ keyFile: './service-account-key.json', scopes });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

  // sheetId 取得
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = (meta.data.sheets || []).find(s => s.properties.title === SHEET_NAME);
  const sheetId = sheet.properties.sheetId;

  // 全行読み取り
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_NAME}!A:S` });
  const rows = resp.data.values || [];
  console.log('読み取り総行数:', rows.length);

  // バックアップ（ローカル）
  fs.writeFileSync('./changeRecordsSheet_backup.json', JSON.stringify(rows, null, 2), 'utf8');
  console.log('✓ バックアップを changeRecordsSheet_backup.json に保存');

  // 整形: ヘッダー行・空行を除去（A列=recordIdが空の行 / B列が"入力日"の行 を除外）
  let blankRemoved = 0, headerRemoved = 0;
  const dataRows = rows.filter(row => {
    const a = (row && row[0] ? String(row[0]).trim() : '');
    const b = (row && row[1] ? String(row[1]).trim() : '');
    if (b === '入力日' || a === 'レコードID') { headerRemoved++; return false; }
    if (!a) { blankRemoved++; return false; }
    return true;
  });

  // 重複除去（recordId 先勝ち）
  const seen = new Set();
  let dupRemoved = 0;
  const unique = [];
  for (const row of dataRows) {
    const id = String(row[0]).trim();
    if (seen.has(id)) { dupRemoved++; continue; }
    seen.add(id);
    unique.push(row);
  }

  // 入力日(index 1 = recordDate)昇順・空は末尾（全レコードが値を持つので自然な時系列順）
  unique.sort((a, b) => {
    const da = a[1] || '', db = b[1] || '';
    if (!da) return 1;
    if (!db) return -1;
    return String(da).localeCompare(String(db));
  });

  // 全行を19列に正規化
  const norm = r => { const x = r.slice(0, 19); while (x.length < 19) x.push(''); return x; };
  const finalValues = [HEADERS, ...unique.map(norm)];

  console.log('\n=== 整形サマリ ===');
  console.log('  ヘッダー行除去:', headerRemoved);
  console.log('  空行除去:', blankRemoved);
  console.log('  重複recordId除去:', dupRemoved);
  console.log('  最終データ行数:', unique.length, '（+ヘッダー1行 =', finalValues.length, '行）');
  console.log('  先頭3データ行(A,B,C,F):');
  unique.slice(0, 3).forEach(r => console.log('    ' + [r[0], r[1], r[2], r[5]].join(' | ')));
  console.log('  末尾3データ行(A,B,C,F):');
  unique.slice(-3).forEach(r => console.log('    ' + [r[0], r[1], r[2], r[5]].join(' | ')));

  if (!APPLY) {
    console.log('\n[DRY RUN] 書き込みは行っていません。--apply で実行します。');
    process.exit(0);
  }

  // 安全のため「先に新データを書き込み → 末尾の余剰行をクリア」の順序
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: finalValues },
  });
  // 旧データが新データより多い分（末尾）をクリア
  if (rows.length > finalValues.length) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A${finalValues.length + 1}:S${rows.length + 5}`,
    });
  }
  console.log('\n✓ シートを書き直しました:', finalValues.length, '行');

  // ヘッダー書式 + 1行目固定
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: {
              backgroundColor: { red: 0.2, green: 0.5, blue: 0.8 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11, bold: true },
              horizontalAlignment: 'CENTER',
            } },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
      ],
    },
  });
  console.log('✓ ヘッダー書式設定＋1行目を固定しました');
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
