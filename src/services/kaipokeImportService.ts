/**
 * カイポケCSVインポートサービス
 *
 * カイポケからエクスポートした2つのCSVファイルを解析し、
 * 介護保険レンタルデータを洗い替えする。
 *
 * データソース:
 * - サービスチェックシート.csv: レンタル品目の詳細（品目用）
 * - 利用者請求.csv: 請求金額（売上用）
 */

import { Client, Equipment, OfficeLocation } from '../../types';
import {
  normalizeGaiji,
  normalizeNameForMatching,
  normalizeKana,
  matchWithGaiji,
} from '../utils/gaiji';

// ===== CSVパース用の型定義 =====

/**
 * サービスチェックシートの行データ
 */
export interface ServiceCheckRow {
  insuranceNumber: string;    // 被保険者番号
  userName: string;           // 利用者名
  nameKana: string;           // フリガナ
  serviceMonth: string;       // サービス提供月（令和7年12月など）
  office: string;             // サービス事業所
  productCode: string;        // 商品コード（タイスコード）
  category: string;           // 品目
  manufacturer: string;       // メーカー
  wholesaler: string;         // 卸業者(法人名/営業所)
  productName: string;        // 商品名
  units: string;              // 単位数/保険外レンタル価格
  purchasePrice: string;      // 仕入価格
}

/**
 * 利用者請求の行データ
 */
export interface BillingRow {
  serviceMonth: string;       // サービス提供年月
  billingMonth: string;       // 請求年月
  office: string;             // サービス事業所
  userName: string;           // 利用者名
  nameKana: string;           // 利用者名カナ
  insuranceNumber: string;    // 被保険者番号
  totalAmount: number;        // 給付対象金額（単位数×10円）
  insurancePayment: number;   // 介護保険給付額
  userBurden: number;         // 保険分　利用者負担額（1〜3割）
  billingTotal: number;       // 利用者請求額　計
  paidAmount: number;         // 利用者入金額
}

/**
 * 未マッチ利用者情報
 */
export interface UnmatchedUser {
  insuranceNumber: string;
  userName: string;
  nameKana: string;
  office: string;
  equipmentCount: number;
}

/**
 * インポート結果
 */
export interface ImportResult {
  success: boolean;
  matchedCount: number;
  unmatchedUsers: UnmatchedUser[];
  importedEquipmentCount: number;
  totalSalesAmount: number;
  errors: string[];
}

/**
 * プレビュー結果
 */
export interface PreviewResult {
  matchedClients: {
    aozoraId: string;
    clientName: string;
    insuranceNumber: string;
    equipmentCount: number;
  }[];
  unmatchedUsers: UnmatchedUser[];
  totalEquipmentCount: number;
  totalSalesAmount: number;
  serviceMonth: string;
}

// ===== CSVパース関数 =====

/**
 * Shift-JIS (OEM) CSVをUTF-8文字列に変換
 */
async function decodeShiftJIS(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder('shift-jis');
  return decoder.decode(buffer);
}

/**
 * CSVテキストを行の配列にパース（クォート処理対応）
 */
function parseCSVLines(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // エスケープされたクォート
          currentCell += '"';
          i++;
        } else {
          // クォート終了
          inQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentLine.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        // CRをスキップ
        continue;
      } else if (char === '\n') {
        currentLine.push(currentCell.trim());
        if (currentLine.some(cell => cell !== '')) {
          lines.push(currentLine);
        }
        currentLine = [];
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
  }

  // 最後のセルと行を処理
  if (currentCell || currentLine.length > 0) {
    currentLine.push(currentCell.trim());
    if (currentLine.some(cell => cell !== '')) {
      lines.push(currentLine);
    }
  }

  return lines;
}

/**
 * サービスチェックシートCSVをパース
 *
 * カラム順序:
 * 被保険者番号, 利用者名, フリガナ, サービス提供月, サービス事業所,
 * ?, ?, 商品コード, 品目, メーカー, 卸業者, 商品名, 単位数, 仕入価格, ...
 */
export async function parseServiceCheckCSV(file: File): Promise<ServiceCheckRow[]> {
  const csvText = await decodeShiftJIS(file);
  const lines = parseCSVLines(csvText);

  if (lines.length < 2) {
    throw new Error('CSVファイルにデータが含まれていません');
  }

  // ヘッダー行を探す
  const headerIndex = lines.findIndex(line =>
    line.some(cell => cell.includes('被保険者番号'))
  );

  if (headerIndex === -1) {
    throw new Error('被保険者番号カラムが見つかりません。サービスチェックシートCSVか確認してください。');
  }

  const header = lines[headerIndex];

  // カラムインデックスを取得
  const getIndex = (searchTerms: string[]): number => {
    return header.findIndex(h => searchTerms.some(term => h.includes(term)));
  };

  const colIndices = {
    insuranceNumber: getIndex(['被保険者番号']),
    userName: getIndex(['利用者名']),
    nameKana: getIndex(['フリガナ', 'カナ']),
    serviceMonth: getIndex(['サービス提供月']),
    office: getIndex(['サービス事業所']),
    productCode: getIndex(['商品コード']),
    category: getIndex(['品目']),
    manufacturer: getIndex(['メーカー']),
    wholesaler: getIndex(['卸業者']),
    productName: getIndex(['商品名']),
    units: getIndex(['単位数', '保険外レンタル価格']),
    purchasePrice: getIndex(['仕入価格']),
  };

  // 必須カラムのチェック
  if (colIndices.insuranceNumber === -1) {
    throw new Error('被保険者番号カラムが見つかりません');
  }
  if (colIndices.userName === -1) {
    throw new Error('利用者名カラムが見つかりません');
  }

  const rows: ServiceCheckRow[] = [];

  // データ行をパース（ヘッダー行の次から）
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // 空行をスキップ
    if (line.every(cell => !cell)) continue;

    const getCell = (index: number): string => {
      if (index === -1 || index >= line.length) return '';
      return line[index] || '';
    };

    const insuranceNumber = getCell(colIndices.insuranceNumber);
    const userName = getCell(colIndices.userName);

    // 被保険者番号と利用者名が両方空の行はスキップ
    if (!insuranceNumber && !userName) continue;

    rows.push({
      insuranceNumber: insuranceNumber,
      userName: normalizeGaiji(userName),
      nameKana: normalizeKana(getCell(colIndices.nameKana)),
      serviceMonth: getCell(colIndices.serviceMonth),
      office: getCell(colIndices.office),
      productCode: getCell(colIndices.productCode),
      category: getCell(colIndices.category),
      manufacturer: getCell(colIndices.manufacturer),
      wholesaler: getCell(colIndices.wholesaler),
      productName: getCell(colIndices.productName),
      units: getCell(colIndices.units),
      purchasePrice: getCell(colIndices.purchasePrice),
    });
  }

  return rows;
}

/**
 * 利用者請求CSVをパース
 *
 * カラム順序:
 * サービス提供年月, 請求年月, サービス事業所, 利用者名, 利用者名カナ,
 * 被保険者番号, 給付対象金額, 介護保険給付額, 保険分利用者負担額,
 * 利用者請求額計, 利用者入金額
 */
export async function parseBillingCSV(file: File): Promise<BillingRow[]> {
  const csvText = await decodeShiftJIS(file);
  const lines = parseCSVLines(csvText);

  if (lines.length < 2) {
    throw new Error('CSVファイルにデータが含まれていません');
  }

  // ヘッダー行を探す
  const headerIndex = lines.findIndex(line =>
    line.some(cell => cell.includes('被保険者番号')) &&
    line.some(cell => cell.includes('給付対象金額') || cell.includes('利用者請求'))
  );

  if (headerIndex === -1) {
    throw new Error('必要なカラムが見つかりません。利用者請求CSVか確認してください。');
  }

  const header = lines[headerIndex];

  // カラムインデックスを取得
  const getIndex = (searchTerms: string[]): number => {
    return header.findIndex(h => searchTerms.some(term => h.includes(term)));
  };

  const colIndices = {
    serviceMonth: getIndex(['サービス提供年月']),
    billingMonth: getIndex(['請求年月']),
    office: getIndex(['サービス事業所']),
    userName: getIndex(['利用者名']),
    nameKana: getIndex(['利用者名カナ', 'カナ']),
    insuranceNumber: getIndex(['被保険者番号']),
    totalAmount: getIndex(['給付対象金額']),
    insurancePayment: getIndex(['介護保険給付額']),
    userBurden: getIndex(['保険分', '利用者負担額']),
    billingTotal: getIndex(['利用者請求額', '計']),
    paidAmount: getIndex(['利用者入金額', '入金額']),
  };

  // 必須カラムのチェック
  if (colIndices.insuranceNumber === -1) {
    throw new Error('被保険者番号カラムが見つかりません');
  }

  const rows: BillingRow[] = [];

  // データ行をパース
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];

    // 空行をスキップ
    if (line.every(cell => !cell)) continue;

    const getCell = (index: number): string => {
      if (index === -1 || index >= line.length) return '';
      return line[index] || '';
    };

    const parseNumber = (value: string): number => {
      const cleaned = value.replace(/[,，]/g, '').trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? 0 : num;
    };

    const insuranceNumber = getCell(colIndices.insuranceNumber);
    const userName = getCell(colIndices.userName);

    // 被保険者番号と利用者名が両方空の行はスキップ
    if (!insuranceNumber && !userName) continue;

    rows.push({
      serviceMonth: getCell(colIndices.serviceMonth),
      billingMonth: getCell(colIndices.billingMonth),
      office: getCell(colIndices.office),
      userName: normalizeGaiji(userName),
      nameKana: normalizeKana(getCell(colIndices.nameKana)),
      insuranceNumber: insuranceNumber,
      totalAmount: parseNumber(getCell(colIndices.totalAmount)),
      insurancePayment: parseNumber(getCell(colIndices.insurancePayment)),
      userBurden: parseNumber(getCell(colIndices.userBurden)),
      billingTotal: parseNumber(getCell(colIndices.billingTotal)),
      paidAmount: parseNumber(getCell(colIndices.paidAmount)),
    });
  }

  return rows;
}

// ===== マッチング関数 =====

/**
 * 事業所名をOfficeLocationに変換
 */
function parseOffice(officeString: string): OfficeLocation {
  if (officeString.includes('福岡') || officeString.includes('Lichi')) {
    return '福岡（Lichi）';
  }
  return '鹿児島（ACG）';
}

/**
 * 利用者マッチング
 *
 * 優先順位:
 * 1. 被保険者番号の完全一致
 * 2. 名前の外字考慮マッチング
 * 3. カナの正規化マッチング
 */
function findMatchingClient(
  insuranceNumber: string,
  userName: string,
  nameKana: string,
  clients: Client[]
): Client | null {
  // 1. 被保険者番号で検索
  if (insuranceNumber) {
    const byInsurance = clients.find(c =>
      c.insuranceNumber === insuranceNumber
    );
    if (byInsurance) return byInsurance;
  }

  // 2. 名前で検索（外字考慮）
  if (userName) {
    const byName = clients.find(c => matchWithGaiji(userName, c.name));
    if (byName) return byName;

    // 正規化した名前でも検索
    const normalizedCsvName = normalizeNameForMatching(userName);
    const byNormalizedName = clients.find(c =>
      normalizeNameForMatching(c.name) === normalizedCsvName
    );
    if (byNormalizedName) return byNormalizedName;
  }

  // 3. カナで検索
  if (nameKana) {
    const normalizedCsvKana = normalizeKana(nameKana);
    const byKana = clients.find(c =>
      normalizeKana(c.nameKana) === normalizedCsvKana
    );
    if (byKana) return byKana;
  }

  return null;
}

/**
 * サービス月を解析してISOフォーマット(YYYY-MM)に変換
 * 「令和7年12月」→「2025-12」
 */
function parseServiceMonth(monthString: string): string {
  // 「令和7年12月」形式
  const reiwaMatch = monthString.match(/令和(\d+)年(\d+)月/);
  if (reiwaMatch) {
    const reiwaYear = parseInt(reiwaMatch[1], 10);
    const month = parseInt(reiwaMatch[2], 10);
    const year = 2018 + reiwaYear; // 令和元年 = 2019年
    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  // 「2025年12月」形式
  const westernMatch = monthString.match(/(\d{4})年(\d+)月/);
  if (westernMatch) {
    const year = parseInt(westernMatch[1], 10);
    const month = parseInt(westernMatch[2], 10);
    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  // 「202512」形式
  if (/^\d{6}$/.test(monthString)) {
    return `${monthString.slice(0, 4)}-${monthString.slice(4, 6)}`;
  }

  // 「2025-12」形式（そのまま）
  if (/^\d{4}-\d{2}$/.test(monthString)) {
    return monthString;
  }

  return '';
}

// ===== メインインポート関数 =====

/**
 * インポートプレビュー
 *
 * CSVをパースしてマッチング結果を返す（Firestoreには保存しない）
 */
export async function previewInsuranceRentalImport(
  serviceCheckFile: File,
  billingFile: File | null,
  clients: Client[]
): Promise<PreviewResult> {
  // 1. CSVパース
  const serviceCheckRows = await parseServiceCheckCSV(serviceCheckFile);

  let billingRows: BillingRow[] = [];
  if (billingFile) {
    billingRows = await parseBillingCSV(billingFile);
  }

  // 2. サービス月を取得（最初の行から）
  const serviceMonth = serviceCheckRows.length > 0
    ? parseServiceMonth(serviceCheckRows[0].serviceMonth)
    : '';

  // 3. 被保険者番号でグループ化
  const groupedByInsurance = new Map<string, ServiceCheckRow[]>();
  serviceCheckRows.forEach(row => {
    const key = row.insuranceNumber || `name:${row.userName}`;
    const existing = groupedByInsurance.get(key) || [];
    existing.push(row);
    groupedByInsurance.set(key, existing);
  });

  // 4. マッチング
  const matchedClients: PreviewResult['matchedClients'] = [];
  const unmatchedUsers: UnmatchedUser[] = [];
  let totalEquipmentCount = 0;

  groupedByInsurance.forEach((rows, key) => {
    const firstRow = rows[0];
    const client = findMatchingClient(
      firstRow.insuranceNumber,
      firstRow.userName,
      firstRow.nameKana,
      clients
    );

    // 重複除去（同じ商品コード+商品名は1件としてカウント）
    const uniqueEquipment = new Map<string, ServiceCheckRow>();
    rows.forEach(row => {
      const equipKey = `${row.productCode}|${row.productName}`;
      if (!uniqueEquipment.has(equipKey)) {
        uniqueEquipment.set(equipKey, row);
      }
    });

    const equipmentCount = uniqueEquipment.size;
    totalEquipmentCount += equipmentCount;

    if (client) {
      matchedClients.push({
        aozoraId: client.aozoraId,
        clientName: client.name,
        insuranceNumber: firstRow.insuranceNumber,
        equipmentCount,
      });
    } else {
      unmatchedUsers.push({
        insuranceNumber: firstRow.insuranceNumber,
        userName: firstRow.userName,
        nameKana: firstRow.nameKana,
        office: firstRow.office,
        equipmentCount,
      });
    }
  });

  // 5. 売上計算（請求CSVから）
  let totalSalesAmount = 0;
  const billingByInsurance = new Map<string, BillingRow>();
  billingRows.forEach(row => {
    billingByInsurance.set(row.insuranceNumber, row);
    totalSalesAmount += row.totalAmount;
  });

  return {
    matchedClients,
    unmatchedUsers,
    totalEquipmentCount,
    totalSalesAmount,
    serviceMonth,
  };
}

/**
 * 介護保険レンタルインポート実行
 *
 * CSVデータをパースし、Equipmentオブジェクトを生成して返す
 */
export async function processInsuranceRentalImport(
  serviceCheckFile: File,
  billingFile: File | null,
  clients: Client[],
  selectedMonth: string
): Promise<{
  equipmentByClient: Map<string, Equipment[]>;
  result: ImportResult;
}> {
  const errors: string[] = [];

  // 1. CSVパース
  let serviceCheckRows: ServiceCheckRow[];
  try {
    serviceCheckRows = await parseServiceCheckCSV(serviceCheckFile);
  } catch (e) {
    throw new Error(`サービスチェックシートCSVの解析に失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  let billingRows: BillingRow[] = [];
  if (billingFile) {
    try {
      billingRows = await parseBillingCSV(billingFile);
    } catch (e) {
      errors.push(`利用者請求CSVの解析に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. 被保険者番号でグループ化
  const groupedByInsurance = new Map<string, ServiceCheckRow[]>();
  serviceCheckRows.forEach(row => {
    const key = row.insuranceNumber || `name:${row.userName}`;
    const existing = groupedByInsurance.get(key) || [];
    existing.push(row);
    groupedByInsurance.set(key, existing);
  });

  // 3. 請求データをマップ化
  const billingByInsurance = new Map<string, BillingRow>();
  billingRows.forEach(row => {
    billingByInsurance.set(row.insuranceNumber, row);
  });

  // 4. マッチングとEquipment生成
  const equipmentByClient = new Map<string, Equipment[]>();
  const unmatchedUsers: UnmatchedUser[] = [];
  let matchedCount = 0;
  let importedEquipmentCount = 0;
  let totalSalesAmount = 0;

  groupedByInsurance.forEach((rows, key) => {
    const firstRow = rows[0];
    const client = findMatchingClient(
      firstRow.insuranceNumber,
      firstRow.userName,
      firstRow.nameKana,
      clients
    );

    // 重複除去（同じ商品コード+商品名は1つのEquipmentに）
    const uniqueEquipment = new Map<string, ServiceCheckRow>();
    rows.forEach(row => {
      const equipKey = `${row.productCode}|${row.productName}`;
      if (!uniqueEquipment.has(equipKey)) {
        uniqueEquipment.set(equipKey, row);
      }
    });

    if (client) {
      matchedCount++;

      const equipment: Equipment[] = [];
      uniqueEquipment.forEach((row) => {
        // Equipment オブジェクト生成
        const eq: Equipment = {
          id: `kaipoke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: row.productName,
          category: row.category,
          office: parseOffice(row.office),
          status: '介護保険レンタル',
          taisCode: row.productCode,
          manufacturer: row.manufacturer,
          wholesaler: row.wholesaler,
          units: row.units,
          kaipokeStatus: '登録済',
          startDate: `${selectedMonth}-01`,
        };

        equipment.push(eq);
        importedEquipmentCount++;
      });

      equipmentByClient.set(client.aozoraId, equipment);

      // 売上計算
      const billing = billingByInsurance.get(firstRow.insuranceNumber);
      if (billing) {
        totalSalesAmount += billing.totalAmount;
      }
    } else {
      unmatchedUsers.push({
        insuranceNumber: firstRow.insuranceNumber,
        userName: firstRow.userName,
        nameKana: firstRow.nameKana,
        office: firstRow.office,
        equipmentCount: uniqueEquipment.size,
      });
    }
  });

  return {
    equipmentByClient,
    result: {
      success: unmatchedUsers.length === 0 && errors.length === 0,
      matchedCount,
      unmatchedUsers,
      importedEquipmentCount,
      totalSalesAmount,
      errors,
    },
  };
}
