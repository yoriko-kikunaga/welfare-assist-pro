// 入居施設名の表記ゆれ → 正式名 変換（取込・現データ正規化で共通使用）
// ─────────────────────────────────────────────
// 2026-06-22 精査ルール：
//  ・「あおぞら〇〇」は基本名に統合（あおぞらを外す）
//  ・「〇〇・有料」「有料・〇〇」は基本名に統合（有料を外す）
//  ・「野芥1」は「野芥」に統合（数字なし）
//  ・「アルファリビング鹿児島東千石」は他社施設のため空欄（在宅扱い）
//  ・「笑苑」「うらら1」「うらら2」は変更しない（うららは利用者ごとに手動で
//    「介付有料うらら」「GHうらら」へ寄せる運用）
// 新しい表記ゆれが出たら下のマップに追記してください。
const FACILITY_NAME_NORMALIZE = {
  'あおぞら宇美': '宇美',
  'あおぞら田上': '田上',
  'あおぞら田村': '田村',
  'あおぞら南栄': '南栄',
  'あおぞら博多': '博多',
  'あおぞら野芥': '野芥',
  'あおぞら油山': '油山',
  '田村・有料': '田村',
  '有料・田村': '田村',
  '笹貫・有料': '笹貫',
  '野芥1': '野芥',
  'アルファリビング鹿児島東千石': '', // 他社施設＝在宅扱い
};

function normalizeFacilityName(name) {
  if (name == null) return name;
  const key = String(name).trim();
  if (Object.prototype.hasOwnProperty.call(FACILITY_NAME_NORMALIZE, key)) {
    return FACILITY_NAME_NORMALIZE[key];
  }
  return name;
}

module.exports = { FACILITY_NAME_NORMALIZE, normalizeFacilityName };
