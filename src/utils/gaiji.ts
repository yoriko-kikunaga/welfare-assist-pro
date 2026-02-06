/**
 * 外字（異体字）変換ユーティリティ
 *
 * カイポケCSVと利用者マスターデータの名前マッチングで
 * 異体字による不一致を解消するためのユーティリティ。
 */

/**
 * 外字ペア: [標準字体, 異体字]
 * マッチング時は両方の字体を同一視する
 */
export const GAIJI_PAIRS: [string, string][] = [
  // manualMatchConfig.json から抽出した初期マッピング
  ['高', '髙'],  // 面高→面髙
  ['富', '冨'],  // 富士雄→冨士雄

  // 一般的な異体字（追加可能）
  ['崎', '﨑'],  // 赤崎→赤﨑
  ['辺', '邊'],
  ['辺', '邉'],
  ['斉', '齊'],
  ['斎', '齋'],
  ['浜', '濱'],
  ['沢', '澤'],
  ['広', '廣'],
  ['国', '國'],
  ['竜', '龍'],
  ['弥', '彌'],
  ['真', '眞'],
  ['芳', '方'],
  ['祐', '祐'],
  ['亀', '龜'],
  ['桜', '櫻'],
  ['渡', '渡'],
  ['黒', '黑'],
  ['徳', '德'],
  ['慎', '愼'],
  ['穂', '穗'],
  ['禎', '禮'],
  ['禄', '祿'],
  ['福', '福'],  // 旧字体
  ['神', '神'],  // 旧字体
  ['礼', '禮'],
  ['祥', '祥'],
  ['祇', '祇'],
  ['榮', '栄'],
  ['繁', '繁'],
  ['寿', '壽'],
  ['寛', '寬'],
  ['応', '應'],
  ['恵', '惠'],
  ['晃', '晄'],
  ['昌', '昌'],
  ['晋', '晉'],
  ['曽', '曾'],
  ['朗', '朗'],
  ['杉', '杉'],
  ['梅', '梅'],
  ['楠', '楠'],
  ['様', '樣'],
  ['槻', '槻'],
  ['橋', '橋'],
  ['淵', '渕'],
  ['滝', '瀧'],
  ['濃', '濃'],
  ['瀬', '瀨'],
  ['灘', '灘'],
  ['燈', '灯'],
  ['琢', '琢'],
  ['瑛', '瑛'],
  ['祢', '禰'],
  ['禅', '禪'],
  ['秀', '秀'],
  ['穣', '穰'],
  ['綾', '綾'],
  ['緒', '緖'],
  ['翔', '翔'],
  ['聡', '聰'],
  ['舗', '舖'],
  ['芦', '蘆'],
  ['茂', '茂'],
  ['荘', '莊'],
  ['菊', '菊'],
  ['薗', '園'],
  ['藤', '藤'],
  ['蔵', '藏'],
  ['虎', '虎'],
  ['蛍', '螢'],
  ['裕', '裕'],
  ['覚', '覺'],
  ['誠', '誠'],
  ['豊', '豐'],
  ['賢', '賢'],
  ['逸', '逸'],
  ['達', '達'],
  ['郎', '郞'],
  ['都', '都'],
  ['釜', '釜'],
  ['鉄', '鐵'],
  ['録', '錄'],
  ['鋭', '鋭'],
  ['鑑', '鑒'],
  ['関', '關'],
  ['陽', '陽'],
  ['雄', '雄'],
  ['青', '靑'],
  ['静', '靜'],
  ['頼', '賴'],
  ['顕', '顯'],
  ['駿', '駿'],
  ['麻', '蔴'],
  ['齢', '齡'],
];

/**
 * 標準字体への変換マップを作成
 * 異体字 → 標準字体
 */
const variantToStandard = new Map<string, string>();
GAIJI_PAIRS.forEach(([standard, variant]) => {
  variantToStandard.set(variant, standard);
});

/**
 * 標準字体から異体字への変換マップを作成
 * 標準字体 → 異体字
 */
const standardToVariant = new Map<string, string>();
GAIJI_PAIRS.forEach(([standard, variant]) => {
  standardToVariant.set(standard, variant);
});

/**
 * 文字列内の異体字を標準字体に正規化する
 * @param text 入力テキスト
 * @returns 正規化されたテキスト
 */
export function normalizeGaiji(text: string): string {
  if (!text) return '';

  let result = text;
  variantToStandard.forEach((standard, variant) => {
    result = result.replaceAll(variant, standard);
  });

  return result;
}

/**
 * 文字列内の標準字体を異体字に変換する（逆変換）
 * @param text 入力テキスト
 * @returns 異体字に変換されたテキスト
 */
export function denormalizeGaiji(text: string): string {
  if (!text) return '';

  let result = text;
  standardToVariant.forEach((variant, standard) => {
    result = result.replaceAll(standard, variant);
  });

  return result;
}

/**
 * 名前の正規化（スペース除去、外字正規化）
 * @param name 名前
 * @returns 正規化された名前
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  return normalizeGaiji(
    name
      // 全角スペースを半角に
      .replace(/　/g, ' ')
      // 連続スペースを1つに
      .replace(/\s+/g, ' ')
      // 前後スペース除去
      .trim()
  );
}

/**
 * 名前のマッチング用正規化（すべてのスペースを除去）
 * @param name 名前
 * @returns マッチング用に正規化された名前
 */
export function normalizeNameForMatching(name: string): string {
  if (!name) return '';

  return normalizeGaiji(
    name
      // すべてのスペースを除去
      .replace(/[\s　]/g, '')
      // ダッシュを除去
      .replace(/[-ー－]/g, '')
  );
}

/**
 * 外字を考慮した名前マッチング
 * @param csvName CSVから読み取った名前
 * @param masterName マスターデータの名前
 * @returns 一致するかどうか
 */
export function matchWithGaiji(csvName: string, masterName: string): boolean {
  if (!csvName || !masterName) return false;

  // 正規化して比較
  const normalizedCsv = normalizeNameForMatching(csvName);
  const normalizedMaster = normalizeNameForMatching(masterName);

  if (normalizedCsv === normalizedMaster) {
    return true;
  }

  // CSVを標準字体に正規化したものと、マスターを異体字に変換したものを比較
  const csvToStandard = normalizeNameForMatching(csvName);
  const masterToVariant = normalizeNameForMatching(denormalizeGaiji(masterName));

  if (csvToStandard === masterToVariant) {
    return true;
  }

  return false;
}

/**
 * カナの正規化（半角カナを全角に、長音記号の統一）
 * @param kana カナ文字列
 * @returns 正規化されたカナ
 */
export function normalizeKana(kana: string): string {
  if (!kana) return '';

  // 半角カナを全角に変換
  const halfToFull: { [key: string]: string } = {
    'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
    'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
    'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
    'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
    'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
    'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
    'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
    'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
    'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
    'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
    'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
    'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
    'ﾞ': '゛', 'ﾟ': '゜', 'ｰ': 'ー',
    'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
    'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
    'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
    'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
    'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
    'ｳﾞ': 'ヴ',
  };

  let result = kana;

  // 濁点・半濁点の組み合わせを先に処理
  Object.entries(halfToFull)
    .sort((a, b) => b[0].length - a[0].length) // 長いものから処理
    .forEach(([half, full]) => {
      result = result.replaceAll(half, full);
    });

  // スペース除去
  result = result.replace(/[\s　]/g, '');

  return result;
}
