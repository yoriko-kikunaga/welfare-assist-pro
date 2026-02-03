/**
 * OCR利用者名マッチングサービス
 *
 * 請求書OCRで抽出した利用者名を、clients.jsonのマスターデータと照合する。
 * - 異体字対応の正規化
 * - あいまいマッチング（文字列類似度）
 * - 学習データの活用
 */

import { Client, MatchCandidate, MatchResult, OcrNameMapping } from '../../types';

// ===== 異体字正規化マップ =====
const VARIANT_MAP: Record<string, string> = {
  // 旧字体・異体字 → 新字体・標準形
  '﨑': '崎',
  '髙': '高',
  '濵': '浜',
  '濱': '浜',
  '邊': '辺',
  '邉': '辺',
  '齋': '斎',
  '齊': '斎',
  '廣': '広',
  '實': '実',
  '覺': '覚',
  '國': '国',
  '嶋': '島',
  '澤': '沢',
  '櫻': '桜',
  '萬': '万',
  '壽': '寿',
  '惠': '恵',
  '繪': '絵',
  '圓': '円',
  '學': '学',
  '藝': '芸',
  '榮': '栄',
  '鷗': '鴎',
  '靜': '静',
  '關': '関',
  '龍': '竜',
  '瀧': '滝',
  '眞': '真',
  '塚': '塚', // 異体字がある
  '黑': '黒',
  '增': '増',
  '德': '徳',
  '條': '条',
  '劍': '剣',
  '兒': '児',
  '卷': '巻',
  '卽': '即',
  '晝': '昼',
  '曾': '曽',
  '來': '来',
  '內': '内',
  '冩': '写',
  '寫': '写',
  '兩': '両',
  '斷': '断',
  '舊': '旧',
  '氣': '気',
  '盡': '尽',
  '聲': '声',
  '號': '号',
  '證': '証',
  '讀': '読',
  '變': '変',
  '譽': '誉',
  '豐': '豊',
  '邨': '村',
  '鑛': '鉱',
  '鐵': '鉄',
  '錢': '銭',
  '鬪': '闘',

  // カタカナ・ひらがな統一
  'ヶ': 'ケ',
  'ノ': 'の',
  'ッ': 'っ',

  // 全角・半角統一
  '　': ' ', // 全角スペース → 半角
};

/**
 * ひらがなをカタカナに変換
 */
function hiraganaToKatakana(str: string): string {
  return str.replace(/[\u3041-\u3096]/g, (match) => {
    return String.fromCharCode(match.charCodeAt(0) + 0x60);
  });
}

/**
 * カタカナをひらがなに変換
 */
function katakanaToHiragana(str: string): string {
  return str.replace(/[\u30A1-\u30F6]/g, (match) => {
    return String.fromCharCode(match.charCodeAt(0) - 0x60);
  });
}

/**
 * 名前を正規化（異体字変換＋スペース除去＋カタカナ統一）
 */
export function normalizeName(name: string): string {
  let result = name;

  // 異体字を標準形に変換
  for (const [variant, standard] of Object.entries(VARIANT_MAP)) {
    result = result.split(variant).join(standard);
  }

  // スペースを除去
  result = result.replace(/[\s　]/g, '');

  // ひらがなをカタカナに統一（照合時の一致率向上）
  result = hiraganaToKatakana(result);

  return result;
}

/**
 * 文字列類似度を計算（Levenshtein距離ベース）
 * 戻り値: 0-1（1が完全一致）
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Levenshtein距離を計算
  const matrix: number[][] = [];

  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // 削除
        matrix[i][j - 1] + 1,      // 挿入
        matrix[i - 1][j - 1] + cost // 置換
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLen = Math.max(s1.length, s2.length);

  return 1 - distance / maxLen;
}

/**
 * マスターデータのキャッシュ（正規化済み）
 */
interface NormalizedMaster {
  aozoraId: string;
  originalName: string;
  normalizedName: string;
}

let masterCache: NormalizedMaster[] | null = null;

/**
 * マスターデータをキャッシュに読み込み
 */
export function initializeMasterCache(clients: Client[]): void {
  masterCache = clients
    .filter(c => c.name)
    .map(c => ({
      aozoraId: c.aozoraId,
      originalName: c.name,
      normalizedName: normalizeName(c.name),
    }));

  console.log(`[nameMatchingService] Master cache initialized: ${masterCache.length} clients`);
}

/**
 * マスターキャッシュをクリア
 */
export function clearMasterCache(): void {
  masterCache = null;
}

/**
 * マスターキャッシュが初期化されているか確認
 */
export function isMasterCacheInitialized(): boolean {
  return masterCache !== null;
}

/**
 * 学習データから照合（完全一致）
 */
export function matchFromLearned(
  ocrNameNormalized: string,
  learnedMappings: OcrNameMapping[]
): MatchCandidate | null {
  const found = learnedMappings.find(m => m.ocrName === ocrNameNormalized);

  if (found) {
    return {
      aozoraId: found.aozoraId,
      masterName: found.masterName,
      similarity: found.confidence,
      isExactMatch: true,
      matchSource: 'learned',
    };
  }

  return null;
}

/**
 * あいまいマッチングで候補を取得
 */
export function findFuzzyCandidates(
  ocrNameNormalized: string,
  topN: number = 5,
  minSimilarity: number = 0.5
): MatchCandidate[] {
  if (!masterCache) {
    console.warn('[nameMatchingService] Master cache not initialized');
    return [];
  }

  // 全マスターと類似度を計算
  const withSimilarity = masterCache.map(m => ({
    ...m,
    similarity: calculateSimilarity(ocrNameNormalized, m.normalizedName),
  }));

  // 類似度でソートし、閾値以上のものを返す
  return withSimilarity
    .filter(m => m.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topN)
    .map(m => ({
      aozoraId: m.aozoraId,
      masterName: m.originalName,
      similarity: m.similarity,
      isExactMatch: m.similarity === 1,
      matchSource: 'fuzzy' as const,
    }));
}

/**
 * OCR名前をマッチング
 *
 * 1. 学習データを検索
 * 2. ヒットしなければあいまいマッチング
 * 3. 類似度に基づいてステータスを決定
 */
export function matchOcrName(
  ocrName: string,
  learnedMappings: OcrNameMapping[],
  options: {
    autoMatchThreshold?: number;  // 自動マッチとする類似度閾値（デフォルト: 0.9）
    candidateThreshold?: number;  // 候補として表示する最低類似度（デフォルト: 0.5）
    topCandidates?: number;       // 候補の最大数（デフォルト: 5）
  } = {}
): MatchResult {
  const {
    autoMatchThreshold = 0.9,
    candidateThreshold = 0.5,
    topCandidates = 5,
  } = options;

  const normalized = normalizeName(ocrName);

  // 1. 学習データから検索
  const learnedMatch = matchFromLearned(normalized, learnedMappings);
  if (learnedMatch) {
    return {
      ocrName,
      ocrNameNormalized: normalized,
      status: 'matched',
      matchedCandidate: learnedMatch,
    };
  }

  // 2. あいまいマッチング
  const candidates = findFuzzyCandidates(normalized, topCandidates, candidateThreshold);

  if (candidates.length === 0) {
    // 候補なし
    return {
      ocrName,
      ocrNameNormalized: normalized,
      status: 'unmatched',
    };
  }

  // 3. 最高類似度が閾値以上なら自動マッチ
  const best = candidates[0];
  if (best.similarity >= autoMatchThreshold) {
    return {
      ocrName,
      ocrNameNormalized: normalized,
      status: 'matched',
      matchedCandidate: best,
    };
  }

  // 4. 候補あり（ユーザー確認必要）
  return {
    ocrName,
    ocrNameNormalized: normalized,
    status: 'candidates',
    candidates,
  };
}

/**
 * 複数のOCR名前を一括マッチング
 */
export function matchOcrNames(
  ocrNames: string[],
  learnedMappings: OcrNameMapping[],
  options?: Parameters<typeof matchOcrName>[2]
): MatchResult[] {
  // 重複を除去して処理
  const uniqueNames = [...new Set(ocrNames)];
  const results = new Map<string, MatchResult>();

  for (const name of uniqueNames) {
    results.set(name, matchOcrName(name, learnedMappings, options));
  }

  // 元の順序で返す
  return ocrNames.map(name => results.get(name)!);
}

/**
 * マッチング統計を取得
 */
export function getMatchingStats(results: MatchResult[]): {
  total: number;
  matched: number;
  candidates: number;
  unmatched: number;
  autoMatchRate: number;
} {
  const matched = results.filter(r => r.status === 'matched').length;
  const candidates = results.filter(r => r.status === 'candidates').length;
  const unmatched = results.filter(r => r.status === 'unmatched').length;

  return {
    total: results.length,
    matched,
    candidates,
    unmatched,
    autoMatchRate: results.length > 0 ? matched / results.length : 0,
  };
}
