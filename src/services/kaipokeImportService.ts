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
  unitPricePerUnit: string;   // 単位数単価（P列: 例 10.00）
  itemSubtotal: string;       // 小計（地域単価適用後の品目金額、存在する場合）
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
 * Billingマッチ結果
 */
export interface BillingMatchResult {
  aozoraId: string;
  clientName: string;
  insuranceNumber: string;
  billingAmount: number | null;  // nullの場合はマッチできなかった
  matchedBy?: 'insuranceNumber' | 'name' | 'kana';  // マッチ方法
}

/**
 * 未マッチBilling（利用者請求CSVにあるがサービスチェックシートにマッチしない）
 */
export interface UnmatchedBilling {
  insuranceNumber: string;
  userName: string;
  nameKana: string;
  totalAmount: number;
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
  totalSalesAmount: number;  // 利用者請求CSVの全行合計（正しい金額）
  serviceMonth: string;
  // 追加: Billingマッチ情報
  billingMatchResults?: BillingMatchResult[];  // 各利用者のbillingマッチ結果
  unmatchedBillings?: UnmatchedBilling[];  // 利用者請求CSVにあるがマッチしなかった行
}

// ===== CSVパース関数 =====

/**
 * CSVファイルをデコード（UTF-8とShift-JISの両方に対応）
 */
async function decodeCSV(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  console.log(`[CSV] File: "${file.name}", size: ${buffer.byteLength} bytes`);

  if (buffer.byteLength === 0) {
    throw new Error('ファイルが空です');
  }

  // まずUTF-8でデコードを試す
  const utf8Decoder = new TextDecoder('utf-8');
  const utf8Text = utf8Decoder.decode(buffer);

  // UTF-8で正しくデコードできたか確認（日本語が含まれているか）
  if (utf8Text.includes('被保険者番号') || utf8Text.includes('利用者名') || utf8Text.includes('サービス')) {
    console.log('[CSV] UTF-8エンコーディングで読み込み');
    console.log('[CSV] 先頭200文字:', utf8Text.slice(0, 200));
    return utf8Text;
  }

  // UTF-8で失敗した場合、Shift-JISでデコード
  const sjisDecoder = new TextDecoder('shift-jis');
  const sjisText = sjisDecoder.decode(buffer);
  console.log('[CSV] Shift-JISエンコーディングで読み込み');
  console.log('[CSV] 先頭200文字:', sjisText.slice(0, 200));
  return sjisText;
}

/**
 * CSVテキストを行の配列にパース（クォート処理対応）
 */
function parseCSVLines(csvText: string): string[][] {
  // \r\n → \n、\r のみ → \n に正規化（Windows/Unix/旧Mac 全対応）
  const normalizedText = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  console.log('[CSV] 正規化後の改行数:', (normalizedText.match(/\n/g) || []).length);

  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < normalizedText.length; i++) {
    const char = normalizedText[i];
    const nextChar = normalizedText[i + 1];

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
  const csvText = await decodeCSV(file);
  const lines = parseCSVLines(csvText);

  if (lines.length < 2) {
    throw new Error(
      lines.length === 0
        ? 'サービスチェックシートCSVが空です。カイポケから正しく出力されているか確認してください。'
        : 'サービスチェックシートCSVにデータ行がありません。カイポケの出力対象月・事業所の設定を確認して再出力してください。'
    );
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
    unitPricePerUnit: getIndex(['単位数単価']),
    itemSubtotal: getIndex(['小計']),
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
      unitPricePerUnit: getCell(colIndices.unitPricePerUnit),
      itemSubtotal: getCell(colIndices.itemSubtotal),
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
  const csvText = await decodeCSV(file);
  const lines = parseCSVLines(csvText);

  if (lines.length < 2) {
    throw new Error(
      lines.length === 0
        ? '利用者請求CSVが空です。カイポケから正しく出力されているか確認してください。'
        : '利用者請求CSVにデータ行がありません。カイポケの出力対象月・事業所の設定を確認して再出力してください。'
    );
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
 * クライアント検索用インデックス
 * O(1)でのルックアップを可能にする
 */
interface ClientIndex {
  byInsuranceNumber: Map<string, Client>;
  byNormalizedName: Map<string, Client>;
  byNormalizedKana: Map<string, Client>;
}

/**
 * クライアントインデックスを構築（一度だけ実行）
 */
function buildClientIndex(clients: Client[]): ClientIndex {
  const byInsuranceNumber = new Map<string, Client>();
  const byNormalizedName = new Map<string, Client>();
  const byNormalizedKana = new Map<string, Client>();

  clients.forEach(client => {
    // 被保険者番号インデックス
    if (client.insuranceNumber) {
      byInsuranceNumber.set(client.insuranceNumber, client);
    }

    // 正規化名前インデックス
    const normalizedName = normalizeNameForMatching(client.name);
    if (normalizedName && !byNormalizedName.has(normalizedName)) {
      byNormalizedName.set(normalizedName, client);
    }

    // 正規化カナインデックス
    const normalizedKana = normalizeKana(client.nameKana);
    if (normalizedKana && !byNormalizedKana.has(normalizedKana)) {
      byNormalizedKana.set(normalizedKana, client);
    }
  });

  return { byInsuranceNumber, byNormalizedName, byNormalizedKana };
}

/**
 * 利用者マッチング（インデックス使用版）
 *
 * 優先順位:
 * 1. 被保険者番号の完全一致
 * 2. 名前の正規化マッチング（外字考慮）
 * 3. カナの正規化マッチング
 */
function findMatchingClientWithIndex(
  insuranceNumber: string,
  userName: string,
  nameKana: string,
  index: ClientIndex
): Client | null {
  // 1. 被保険者番号で検索（O(1)）
  if (insuranceNumber) {
    const byInsurance = index.byInsuranceNumber.get(insuranceNumber);
    if (byInsurance) return byInsurance;
  }

  // 2. 名前で検索（O(1)）
  if (userName) {
    const normalizedCsvName = normalizeNameForMatching(userName);
    const byName = index.byNormalizedName.get(normalizedCsvName);
    if (byName) return byName;
  }

  // 3. カナで検索（O(1)）
  if (nameKana) {
    const normalizedCsvKana = normalizeKana(nameKana);
    const byKana = index.byNormalizedKana.get(normalizedCsvKana);
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

  // 3. クライアントインデックスを構築（O(n)、一度だけ）
  const clientIndex = buildClientIndex(clients);

  // 4. 被保険者番号でグループ化
  const groupedByInsurance = new Map<string, ServiceCheckRow[]>();
  serviceCheckRows.forEach(row => {
    const key = row.insuranceNumber || `name:${row.userName}`;
    const existing = groupedByInsurance.get(key) || [];
    existing.push(row);
    groupedByInsurance.set(key, existing);
  });

  // 5. マッチング（インデックス使用でO(1)）
  const matchedClients: PreviewResult['matchedClients'] = [];
  const unmatchedUsers: UnmatchedUser[] = [];
  let totalEquipmentCount = 0;

  groupedByInsurance.forEach((rows, key) => {
    const firstRow = rows[0];
    const client = findMatchingClientWithIndex(
      firstRow.insuranceNumber,
      firstRow.userName,
      firstRow.nameKana,
      clientIndex
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

  // 5. 売上計算と紐づけ情報の生成
  // Build billing lookup maps
  const billingByInsurance = new Map<string, BillingRow>();
  const billingByName = new Map<string, BillingRow>();
  const billingByKana = new Map<string, BillingRow>();
  const usedBillingKeys = new Set<string>();

  billingRows.forEach(row => {
    if (row.insuranceNumber) {
      billingByInsurance.set(row.insuranceNumber, row);
    }
    const normalizedName = normalizeNameForMatching(row.userName);
    if (normalizedName) {
      billingByName.set(normalizedName, row);
    }
    const normalizedKana = normalizeKana(row.nameKana);
    if (normalizedKana) {
      billingByKana.set(normalizedKana, row);
    }
  });

  // 利用者請求CSVの全行合計（これが正しい金額）
  let totalSalesAmount = 0;
  billingRows.forEach(row => {
    totalSalesAmount += row.totalAmount;
  });

  // 各マッチした利用者のbillingマッチ結果を計算
  const billingMatchResults: BillingMatchResult[] = [];
  matchedClients.forEach(matched => {
    const client = clients.find(c => c.aozoraId === matched.aozoraId);
    if (!client) return;

    let billing: BillingRow | undefined;
    let matchedBy: 'insuranceNumber' | 'name' | 'kana' | undefined;

    // Try insurance number first
    billing = billingByInsurance.get(matched.insuranceNumber);
    if (billing) {
      matchedBy = 'insuranceNumber';
      usedBillingKeys.add(matched.insuranceNumber);
    }

    if (!billing && client.insuranceNumber) {
      billing = billingByInsurance.get(client.insuranceNumber);
      if (billing) {
        matchedBy = 'insuranceNumber';
        usedBillingKeys.add(client.insuranceNumber);
      }
    }

    if (!billing) {
      const normalizedClientName = normalizeNameForMatching(client.name);
      billing = billingByName.get(normalizedClientName);
      if (billing) {
        matchedBy = 'name';
        usedBillingKeys.add(`name:${normalizedClientName}`);
      }
    }

    if (!billing) {
      const normalizedClientKana = normalizeKana(client.nameKana);
      billing = billingByKana.get(normalizedClientKana);
      if (billing) {
        matchedBy = 'kana';
        usedBillingKeys.add(`kana:${normalizedClientKana}`);
      }
    }

    billingMatchResults.push({
      aozoraId: matched.aozoraId,
      clientName: client.name,
      insuranceNumber: matched.insuranceNumber || client.insuranceNumber || '',
      billingAmount: billing ? billing.totalAmount : null,
      matchedBy,
    });
  });

  // 利用者請求CSVにあるがマッチしなかった行を抽出
  const unmatchedBillings: UnmatchedBilling[] = [];
  billingRows.forEach(row => {
    const insuranceKey = row.insuranceNumber;
    const nameKey = `name:${normalizeNameForMatching(row.userName)}`;
    const kanaKey = `kana:${normalizeKana(row.nameKana)}`;

    if (!usedBillingKeys.has(insuranceKey) &&
        !usedBillingKeys.has(nameKey) &&
        !usedBillingKeys.has(kanaKey)) {
      unmatchedBillings.push({
        insuranceNumber: row.insuranceNumber,
        userName: row.userName,
        nameKana: row.nameKana,
        totalAmount: row.totalAmount,
      });
    }
  });

  return {
    matchedClients,
    unmatchedUsers,
    totalEquipmentCount,
    totalSalesAmount,
    serviceMonth,
    billingMatchResults,
    unmatchedBillings,
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
  selectedMonth: string,
  manualBillingLinks?: Map<string, string>  // aozoraId → billingInsuranceNumber
): Promise<{
  equipmentByClient: Map<string, Equipment[]>;
  billingByClient: Map<string, number>;  // あおぞらID → 給付対象金額
  officeByClient: Map<string, OfficeLocation>;  // あおぞらID → 事業所（CSVから）
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

  // 2. クライアントインデックスを構築（O(n)、一度だけ）
  const clientIndex = buildClientIndex(clients);

  // 3. 被保険者番号でグループ化
  const groupedByInsurance = new Map<string, ServiceCheckRow[]>();
  serviceCheckRows.forEach(row => {
    const key = row.insuranceNumber || `name:${row.userName}`;
    const existing = groupedByInsurance.get(key) || [];
    existing.push(row);
    groupedByInsurance.set(key, existing);
  });

  // 4. 請求データをマップ化（複数のキーで検索可能に）
  const billingByInsurance = new Map<string, BillingRow>();
  const billingByName = new Map<string, BillingRow>();
  const billingByKana = new Map<string, BillingRow>();
  billingRows.forEach(row => {
    if (row.insuranceNumber) {
      billingByInsurance.set(row.insuranceNumber, row);
    }
    const normalizedName = normalizeNameForMatching(row.userName);
    if (normalizedName) {
      billingByName.set(normalizedName, row);
    }
    const normalizedKana = normalizeKana(row.nameKana);
    if (normalizedKana) {
      billingByKana.set(normalizedKana, row);
    }
  });

  // 5. マッチングとEquipment生成（インデックス使用でO(1)）
  const equipmentByClient = new Map<string, Equipment[]>();
  const billingByClient = new Map<string, number>();  // あおぞらID → 給付対象金額
  const officeByClient = new Map<string, OfficeLocation>();  // あおぞらID → 事業所
  const unmatchedUsers: UnmatchedUser[] = [];
  let matchedCount = 0;
  let importedEquipmentCount = 0;
  let totalSalesAmount = 0;

  groupedByInsurance.forEach((rows, key) => {
    const firstRow = rows[0];
    const client = findMatchingClientWithIndex(
      firstRow.insuranceNumber,
      firstRow.userName,
      firstRow.nameKana,
      clientIndex
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
      // 売上計算（給付対象金額）
      // First check manual link
      let billing: BillingRow | undefined;
      if (manualBillingLinks?.has(client.aozoraId)) {
        const linkedInsuranceNumber = manualBillingLinks.get(client.aozoraId)!;
        billing = billingByInsurance.get(linkedInsuranceNumber);
      }

      // Try automatic matching: insurance number, name, kana
      if (!billing) {
        billing = billingByInsurance.get(firstRow.insuranceNumber);
      }
      if (!billing && client.insuranceNumber) {
        billing = billingByInsurance.get(client.insuranceNumber);
      }
      if (!billing) {
        const normalizedClientName = normalizeNameForMatching(client.name);
        billing = billingByName.get(normalizedClientName);
      }
      if (!billing) {
        const normalizedClientKana = normalizeKana(client.nameKana);
        billing = billingByKana.get(normalizedClientKana);
      }

      // 請求データ未紐づけの利用者はインポートしない（金額整合性のため）
      if (!billing) {
        return;
      }

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
          monthlyCost: (() => {
            // 小計列がある場合は地域単価適用済みの値を優先使用
            const subtotalVal = parseFloat(row.itemSubtotal);
            if (!isNaN(subtotalVal) && subtotalVal > 0) return Math.round(subtotalVal);
            const u = parseFloat(row.units) || 0;
            const p = parseFloat(row.unitPricePerUnit) || 10;
            return Math.round(u * p);
          })(),
          kaipokeStatus: '登録済',
          startDate: `${selectedMonth}-01`,
          endDate: (() => {
            const [y, m] = selectedMonth.split('-').map(Number);
            const lastDay = new Date(y, m, 0).getDate();
            return `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
          })(),
        };

        equipment.push(eq);
        importedEquipmentCount++;
      });

      equipmentByClient.set(client.aozoraId, equipment);
      totalSalesAmount += billing.totalAmount;
      // Store billing amount per client for later use
      billingByClient.set(client.aozoraId, billing.totalAmount);
      // Store office from CSV for client office update
      officeByClient.set(client.aozoraId, parseOffice(firstRow.office));
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
    billingByClient,
    officeByClient,
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
