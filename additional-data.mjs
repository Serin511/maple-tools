import data from './data/additional-probabilities.json' with { type: 'json' };

/**
 * Uploaded Nexon option tables, losslessly deduplicated in data/*.json.
 * Selection: { method: 'reset'|'strange', grade: Korean grade, slot, level }.
 * Scoring: { mainStat, subStat, attackType: 'attack'|'magic', characterLevel,
 *            efficiency: per-one-unit conversions, customOptionScores? }.
 * getAdditionalLines returns three arrays of {label, probability,
 * publishedPercent}, or null when the uploaded source has no matching table.
 * buildAdditionalDistribution combines the three published line marginals,
 * returning sorted {score, probability, options: representativeLabels[]}.
 */

export const ADDITIONAL_GRADES = Object.freeze(['에픽', '유니크', '레전드리']);
export const ADDITIONAL_LEVELS = Object.freeze([140, 160, 200, 250]);
export const ADDITIONAL_STATS = Object.freeze(['STR', 'DEX', 'INT', 'LUK']);
// The requested calculator covers armor and accessories. Weapon/offhand
// tables remain intact in the archival data, but are not selectable here.
export const ADDITIONAL_SLOTS = Object.freeze([
  '모자', '상의', '한벌옷', '하의', '신발', '장갑', '망토', '벨트',
  '어깨장식', '얼굴장식', '눈장식', '귀고리', '반지', '펜던트', '기계심장',
]);

export const DEFAULT_ADDITIONAL_EFFICIENCY = Object.freeze({
  mainFlat: 0.1,
  subFlat: 0.01,
  attackFlat: 0.3,
  subPercent: 0.1,
  allPercent: 1.1,
  attackPercent: 0,
  damagePercent: 0,
  bossPercent: 0,
  ignoreDefensePercent: 0,
  criticalDamagePercent: 0,
  criticalRatePercent: 0,
  itemDropPercent: 0,
  mesoPercent: 0,
  cooldownSecond: 0,
});

export const DEFAULT_ADDITIONAL_SCORE_SETTINGS = Object.freeze({
  mainStat: 'STR',
  subStat: 'DEX',
  attackType: 'attack',
  characterLevel: 290,
  efficiency: DEFAULT_ADDITIONAL_EFFICIENCY,
});

export const ADDITIONAL_SOURCES = Object.freeze(Object.entries(data.sources).map(([method, source]) => Object.freeze({
  method,
  label: method === 'reset' ? '에디셔널 잠재능력 재설정 확률' : '수상한 에디셔널 큐브 확률',
  url: source.metadata['출처'],
  collectedAt: source.metadata['수집일'],
  originalFile: source.originalFile,
  originalSha256: source.originalSha256,
  notes: Object.freeze([...source.metadata['참고']]),
})));

export const ADDITIONAL_MODEL = Object.freeze({
  optionsPerReset: 3,
  subStats: 1,
  independentLines: true,
  identicalResultExclusion: false,
  combinationRestrictions: false,
  minimumLevel: 120,
  maximumLevel: 250,
  note: '공개된 줄별 확률을 정규화해 결합하는 모델입니다. 첨부 문서의 중복 제한 대상은 이 옵션 풀에 없으며, 직전 결과 재등장 제한은 반영하지 않습니다.',
});

function resolveLevel(level) {
  if (!Number.isInteger(level) || level < 120 || level > 250) return null;
  // Both uploads explicitly identify these bands; all three original
  // 140/160/200 tables were verified identical for every slot and grade.
  return level <= 200 ? '200레벨' : '250레벨';
}

export function getAdditionalLines({ method = 'reset', grade, slot, level } = {}) {
  if (!ADDITIONAL_SLOTS.includes(slot)) return null;
  const levelKey = resolveLevel(level);
  if (levelKey === null) return null;
  const tableIndex = data.sources[method]?.grades[grade]?.[slot]?.[levelKey];
  // A literal null means unavailable, never table index zero or a fallback.
  if (tableIndex === null || tableIndex === undefined) return null;
  return data.tables[tableIndex].map(lineIndex => {
    const rows = data.lines[lineIndex];
    const total = rows.reduce((sum, [, percent]) => sum + percent, 0);
    return rows.map(([optionIndex, publishedPercent]) => ({
      label: data.options[optionIndex],
      probability: publishedPercent / total,
      publishedPercent,
    }));
  });
}

export function isAdditionalAvailable(selection) {
  return getAdditionalLines(selection) !== null;
}

export function validateAdditionalScoreSettings(settings = {}) {
  const config = { ...DEFAULT_ADDITIONAL_SCORE_SETTINGS, ...settings };
  if (!ADDITIONAL_STATS.includes(config.mainStat) || !ADDITIONAL_STATS.includes(config.subStat)) {
    throw new Error('주스탯과 부스탯은 STR, DEX, INT, LUK 중에서 선택해 주세요.');
  }
  if (config.mainStat === config.subStat) throw new Error('주스탯과 부스탯은 서로 다르게 선택해 주세요.');
  if (!['attack', 'magic'].includes(config.attackType)) throw new Error('공격력 또는 마력을 선택해 주세요.');
  if (!Number.isInteger(config.characterLevel) || config.characterLevel < 1 || config.characterLevel > 300) {
    throw new Error('캐릭터 레벨은 1~300 사이의 정수로 입력해 주세요.');
  }
  for (const [key, value] of Object.entries(settings.efficiency ?? {})) {
    if (!(key in DEFAULT_ADDITIONAL_EFFICIENCY) || !Number.isFinite(value) || value < 0) {
      throw new Error('스탯 환산 효율은 0 이상의 유한한 숫자로 입력해 주세요.');
    }
  }
  for (const [label, value] of Object.entries(settings.customOptionScores ?? {})) {
    if (!label || !Number.isFinite(value) || value < 0) throw new Error('개별 옵션 환산값은 0 이상의 숫자로 입력해 주세요.');
  }
}

function scoringConfig(settings) {
  validateAdditionalScoreSettings(settings);
  return {
    ...DEFAULT_ADDITIONAL_SCORE_SETTINGS,
    ...settings,
    efficiency: { ...DEFAULT_ADDITIONAL_EFFICIENCY, ...settings.efficiency },
  };
}

const PERCENT_OPTION_EFFICIENCY = Object.freeze({
  '데미지': 'damagePercent',
  '보스 몬스터 데미지': 'bossPercent',
  '몬스터 방어율 무시': 'ignoreDefensePercent',
  '크리티컬 데미지': 'criticalDamagePercent',
  '크리티컬 확률': 'criticalRatePercent',
  '아이템 드롭률': 'itemDropPercent',
  '메소 획득량': 'mesoPercent',
});

function evaluateOption(label, config) {
  if (Object.hasOwn(config.customOptionScores ?? {}, label)) return config.customOptionScores[label];
  const efficiency = config.efficiency;
  let match = label.match(/^캐릭터 기준 (\d+)레벨 당 (STR|DEX|INT|LUK) \+(\d+)$/);
  if (match) {
    const amount = Math.floor(config.characterLevel / Number(match[1])) * Number(match[3]);
    return amount * (match[2] === config.mainStat ? efficiency.mainFlat : match[2] === config.subStat ? efficiency.subFlat : 0);
  }
  match = label.match(/^(STR|DEX|INT|LUK) \+(\d+(?:\.\d+)?)(%)?$/);
  if (match) {
    const amount = Number(match[2]);
    if (match[1] === config.mainStat) return amount * (match[3] ? 1 : efficiency.mainFlat);
    if (match[1] === config.subStat) return amount * (match[3] ? efficiency.subPercent : efficiency.subFlat);
    return 0;
  }
  match = label.match(/^올스탯 \+(\d+(?:\.\d+)?)(%)?$/);
  if (match) return Number(match[1]) * (match[2] ? efficiency.allPercent : efficiency.mainFlat + efficiency.subFlat);
  match = label.match(/^(공격력|마력) \+(\d+(?:\.\d+)?)(%)?$/);
  if (match) {
    const desired = config.attackType === 'magic' ? '마력' : '공격력';
    return match[1] === desired ? Number(match[2]) * (match[3] ? efficiency.attackPercent : efficiency.attackFlat) : 0;
  }
  match = label.match(/^(.+) \+(\d+(?:\.\d+)?)%$/);
  if (match && Object.hasOwn(PERCENT_OPTION_EFFICIENCY, match[1])) {
    return Number(match[2]) * efficiency[PERCENT_OPTION_EFFICIENCY[match[1]]];
  }
  match = label.match(/^스킬 재사용 대기시간 -(\d+(?:\.\d+)?)초$/);
  if (match) return Number(match[1]) * efficiency.cooldownSecond;
  // HP/MP, defense, speed, recovery and utility have no inferred main-stat
  // value. An explicit customOptionScores entry can value a specific label.
  return 0;
}

export function scoreAdditionalOption(label, settings = {}) {
  if (typeof label !== 'string') throw new Error('옵션을 선택해 주세요.');
  return evaluateOption(label, scoringConfig(settings));
}

export function scoreAdditionalOptions(options, settings = {}) {
  const config = scoringConfig(settings);
  if (!Array.isArray(options) || options.some(label => typeof label !== 'string')) throw new Error('현재 옵션을 확인해 주세요.');
  return options.reduce((score, label) => score + evaluateOption(label, config), 0);
}

export function validateAdditionalDataSettings(settings) {
  validateAdditionalScoreSettings(settings);
  if (!getAdditionalLines({ ...settings, grade: settings?.grade ?? '에픽' })) throw new Error('선택한 부위·등급·레벨 구간의 확률표가 없습니다. 120~250레벨의 지원 부위를 선택해 주세요.');
}

// Only floating-point accumulation noise is merged, not user-visible 0.1%
// bins. Arbitrary efficiency inputs therefore retain attainable thresholds.
const scoreKey = value => Math.round(value * 1e10) / 1e10;

export function buildAdditionalDistribution(settings) {
  validateAdditionalDataSettings(settings);
  const config = scoringConfig(settings);
  const lines = getAdditionalLines(settings);
  if (!lines) throw new Error('계산할 에디셔널 잠재능력 등급의 확률표가 없습니다.');
  let distribution = [{ score: 0, probability: 1, options: [] }];
  for (const line of lines) {
    // Every ignored label remains in the marginal probability mass. Labels
    // with equal converted value can share a representative for convolution.
    const marginal = new Map();
    for (const row of line) {
      const score = scoreKey(evaluateOption(row.label, config));
      const existing = marginal.get(score);
      if (existing) existing.probability += row.probability;
      else marginal.set(score, { score, probability: row.probability, label: row.label });
    }
    const combined = new Map();
    for (const before of distribution) {
      for (const outcome of marginal.values()) {
        const score = scoreKey(before.score + outcome.score);
        const probability = before.probability * outcome.probability;
        const existing = combined.get(score);
        if (existing) existing.probability += probability;
        else combined.set(score, { score, probability, options: [...before.options, outcome.label] });
      }
    }
    distribution = [...combined.values()];
  }
  const total = distribution.reduce((sum, row) => sum + row.probability, 0);
  return distribution.map(row => ({ ...row, probability: row.probability / total })).sort((a, b) => a.score - b.score);
}
