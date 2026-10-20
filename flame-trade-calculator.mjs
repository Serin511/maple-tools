import { FLAME_RESET_COST } from './flame-data.mjs';
import { forEachFlameOutcome } from './flame-distribution.mjs';
import { ADDITIONAL_STATS, getAdditionalCharacterSettings } from './additional-data.mjs';
import { solveFlameTrade, FLAME_TRADE_FLOOR_ID } from './flame-trade-engine.mjs';

export const FLAME_TRADE_STATS = ADDITIONAL_STATS;
// Levels where common boss armor and accessories are traded; the amount
// formulas only change at 20/40-level boundaries and at level 250.
export const FLAME_TRADE_LEVELS = Object.freeze([100, 110, 120, 130, 140, 150, 160, 200, 250]);
// Grades are main-stat points. These ratios equal the default efficiencies of
// the bonus-stat efficiency calculator: sub 10 = 0.1%, attack 10 = 3%, all 1% = 1.1%.
export const DEFAULT_FLAME_TRADE_WEIGHTS = Object.freeze({ sub: 0.1, attack: 3, all: 11 });
export const FLAME_TRADE_ROW_STATS = Object.freeze(['main', 'sub', 'attack', 'all']);
export const FLAME_TRADE_ROW_LABELS = Object.freeze({ main: '주스탯', sub: '부스탯', attack: '공격력·마력', all: '올스탯%' });
const WEIGHT_LABELS = Object.freeze({ sub: '부스탯', attack: '공격력·마력', all: '올스탯%' });
const STAT_ORDER = Object.freeze(['STR', 'DEX', 'INT', 'LUK', 'attack', 'magic', 'all']);

export const DEFAULT_FLAME_TRADE_SETTINGS = Object.freeze({
  level: 200,
  itemPrice: 100_000_000,
  fee: 3,
  floorPrice: 0,
  resetCost: FLAME_RESET_COST,
  autoSell: true,
  mainStats: Object.freeze([...FLAME_TRADE_STATS]),
  weights: DEFAULT_FLAME_TRADE_WEIGHTS,
  prices: Object.freeze([]),
});

export function newFlameTradeRow(id, patch = {}) {
  return { id, mode: 'total', total: '', main: 0, sub: 0, attack: 0, all: 0, price: '', ...patch };
}

const finite = (value, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const invalid = message => { throw new Error(message); };
const sameScore = (a, b) => Math.abs(a - b) <= 16 * Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
const atLeast = (value, threshold) => value >= threshold || sameScore(value, threshold);
const isPriced = row => row.price !== '' && row.price != null;

/** Grade threshold of a price row; component rows use the conversion table. */
export function flameTradeRowScore(row, weights) {
  if (row.mode === 'total') return row.total;
  return row.main + weights.sub * row.sub + weights.attack * row.attack + weights.all * row.all;
}

export function validateFlameTradeSettings(settings) {
  if (!settings || typeof settings !== 'object') invalid('입력값을 확인해 주세요.');
  const s = settings;
  if (!Number.isInteger(s.level) || s.level < 1 || s.level > 300) invalid('아이템 레벨 제한을 선택해 주세요.');
  if (!finite(s.itemPrice, 1e16)) invalid('노작 매입가는 0 이상의 숫자로 입력해 주세요.');
  if (!finite(s.fee, 100)) invalid('경매장 수수료는 0~100%로 입력해 주세요.');
  if (!finite(s.floorPrice, 1e16)) invalid('잡추옵 처분가는 0 이상의 숫자로 입력해 주세요.');
  if (!finite(s.resetCost, 1e16)) invalid('추가옵션 재설정 비용은 0 이상의 숫자로 입력해 주세요.');
  if (typeof s.autoSell !== 'boolean') invalid('판매 자동 최적화 설정을 확인해 주세요.');
  if (!Array.isArray(s.mainStats) || !s.mainStats.length || new Set(s.mainStats).size !== s.mainStats.length
    || s.mainStats.some(stat => !FLAME_TRADE_STATS.includes(stat))) invalid('판매 대상 주스탯을 1개 이상 선택해 주세요.');
  for (const key of Object.keys(WEIGHT_LABELS)) {
    if (!finite(s.weights?.[key], 1e6)) invalid(`환산표의 ${WEIGHT_LABELS[key]} 값은 0 이상의 숫자로 입력해 주세요.`);
  }
  if (!Array.isArray(s.prices)) invalid('판매가 조건을 확인해 주세요.');
  const ids = new Set();
  s.prices.forEach((row, index) => {
    if (!row || typeof row !== 'object') invalid('판매가 조건을 확인해 주세요.');
    // Rows without a price are kept as editing placeholders and never sold.
    if (!isPriced(row)) return;
    const name = `${index + 1}번 판매가 조건`;
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id)) invalid('판매가 조건 식별값을 확인해 주세요.');
    ids.add(row.id);
    if (!finite(row.price, 1e16)) invalid(`${name}의 판매가는 비워 두거나 0 이상의 숫자로 입력해 주세요.`);
    if (row.mode === 'total') {
      if (!finite(row.total, 1e6)) invalid(`${name}의 추가옵션 환산 급수를 0 이상의 숫자로 입력해 주세요.`);
    } else if (row.mode === 'stats') {
      for (const key of FLAME_TRADE_ROW_STATS) {
        if (!finite(row[key], 1e6)) invalid(`${name}의 ${FLAME_TRADE_ROW_LABELS[key]} 수치를 0 이상의 숫자로 입력해 주세요.`);
      }
    } else invalid(`${name}의 입력 방식을 선택해 주세요.`);
  });
  if (!ids.size) invalid('판매가를 입력한 조건이 1개 이상 필요합니다.');
  return true;
}

/** Each selected main stat with its fixed substat and attack type. */
export function flameTradeProfiles(mainStats) {
  return FLAME_TRADE_STATS.filter(stat => mainStats.includes(stat)).map(stat => getAdditionalCharacterSettings(stat));
}

/**
 * Visits every exact flame outcome with its sale grade. A result is sold to
 * the selected main stat with the highest converted grade (the earlier stat on
 * ties). `stats` is reused between calls.
 */
export function forEachFlameTradeOutcome({ level, mainStats, weights }, visit) {
  const profiles = flameTradeProfiles(mainStats);
  const relevant = new Set(['all']);
  for (const profile of profiles) {
    relevant.add(profile.mainStat);
    relevant.add(profile.subStat);
    relevant.add(profile.attackType);
  }
  const statKeys = STAT_ORDER.filter(key => relevant.has(key));
  forEachFlameOutcome(level, statKeys, option => option.stats.filter(key => relevant.has(key)), (stats, p) => {
    let bestScore = -Infinity;
    let bestProfile = null;
    for (const profile of profiles) {
      const score = stats[profile.mainStat] + weights.sub * stats[profile.subStat]
        + weights.attack * stats[profile.attackType] + weights.all * stats.all;
      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }
    visit(bestScore, p, bestProfile, stats);
  });
}

const valuesFor = (stats, profile) => ({
  main: stats[profile.mainStat], sub: stats[profile.subStat], attack: stats[profile.attackType], all: stats.all,
});

/** All outcomes sorted by grade, for inspection and tests. */
export function buildFlameTradeDistribution(settings) {
  const rows = [];
  forEachFlameTradeOutcome(settings, (score, p, profile, stats) => rows.push({ score, p, stat: profile.mainStat, values: valuesFor(stats, profile) }));
  return rows.sort((a, b) => a.score - b.score);
}

/**
 * Price ladder sorted by threshold. A result sells at the price of the highest
 * threshold it reaches; equal thresholds keep the highest price.
 */
export function flameTradePriceLadder(rows, weights) {
  const priced = rows.map((row, index) => ({ row, index, threshold: flameTradeRowScore(row, weights) })).filter(({ row }) => isPriced(row));
  priced.sort((a, b) => a.threshold - b.threshold || b.row.price - a.row.price || a.index - b.index);
  const ladder = [];
  for (const { row, threshold } of priced) {
    const previous = ladder.at(-1);
    if (previous && sameScore(previous.threshold, threshold)) previous.shadowedIds.push(row.id);
    else ladder.push({ id: row.id, mode: row.mode, threshold, price: row.price, shadowedIds: [] });
  }
  ladder.forEach((step, index) => { step.upper = ladder[index + 1]?.threshold ?? null; });
  return ladder;
}

// Index of the highest reached threshold, or -1 below every threshold.
function bandIndex(ladder, score) {
  let low = 0, high = ladder.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (atLeast(score, ladder[middle].threshold)) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

function classify(settings, ladder) {
  const bandProbability = ladder.map(() => 0);
  // Per band, the lowest result for each all-stat value, so examples show
  // different ways of just reaching a sale (as in the efficiency calculator).
  const bandExamples = ladder.map(() => new Map());
  let unpricedProbability = 0, maxScore = -Infinity, outcomes = 0;
  forEachFlameTradeOutcome(settings, (score, p, profile, stats) => {
    outcomes += 1;
    if (score > maxScore) maxScore = score;
    const band = bandIndex(ladder, score);
    if (band < 0) {
      unpricedProbability += p;
      return;
    }
    bandProbability[band] += p;
    const key = stats.all;
    const previous = bandExamples[band].get(key);
    if (!previous || score < previous.score || (score === previous.score && p > previous.p)) {
      bandExamples[band].set(key, { key, stat: profile.mainStat, subStat: profile.subStat, attackType: profile.attackType, values: valuesFor(stats, profile), score, p });
    }
  });
  const atLeastProbability = ladder.map(() => 0);
  let tail = 0;
  for (let index = ladder.length - 1; index >= 0; index--) {
    tail += bandProbability[index];
    atLeastProbability[index] = tail;
  }
  return { bandProbability, atLeastProbability, unpricedProbability, bandExamples, maxScore, outcomes };
}

function examplesFor(ladder, bandExamples, acceptedIds) {
  const accepted = new Set(acceptedIds);
  const candidates = ladder.flatMap((step, index) => accepted.has(step.id) ? [...bandExamples[index].values()] : [])
    .sort((a, b) => a.score - b.score || b.p - a.p);
  const seen = new Set();
  const examples = [];
  for (const { key, ...example } of candidates) {
    if (seen.has(key)) continue;
    seen.add(key);
    examples.push(example);
    if (examples.length === 5) break;
  }
  return examples;
}

// The immediate-sale reference is only informative when it is a different policy.
function differentPolicy(a, b) {
  if (!a.possible) return true;
  const ids = result => result.sales.map(sale => `${sale.id}|${sale.gross}`).sort().join(',');
  return ids(a) !== ids(b);
}

export function calculateFlameTrade(settings) {
  validateFlameTradeSettings(settings);
  const s = settings;
  const ladder = flameTradePriceLadder(s.prices, s.weights);
  const { bandProbability, atLeastProbability, unpricedProbability, bandExamples, maxScore, outcomes } = classify(s, ladder);
  const common = {
    fee: s.fee, floorPrice: s.floorPrice, itemPrice: s.itemPrice, resetCost: s.resetCost, unpricedProbability,
    bands: ladder.map((step, index) => ({ id: step.id, price: step.price, p: bandProbability[index] })),
  };
  const solved = solveFlameTrade({ ...common, autoSell: s.autoSell });
  const immediate = s.autoSell ? solveFlameTrade({ ...common, autoSell: false }) : null;
  const accepted = new Set(solved.acceptedIds ?? []);
  const sales = new Map((solved.sales ?? []).map(sale => [sale.id, sale]));
  const rows = ladder.map((step, index) => {
    const probability = bandProbability[index];
    const sale = sales.get(step.id);
    return {
      ...step,
      probability,
      atLeastProbability: atLeastProbability[index],
      netPrice: step.price * (1 - s.fee / 100),
      decision: !(probability > 0) ? 'unreachable' : !accepted.has(step.id) ? 'hold' : sale?.atFloor ? 'floor' : 'sell',
      saleShare: sale?.share ?? 0,
    };
  });
  const reachable = rows.filter(row => row.decision !== 'unreachable');
  const firstSold = reachable.findIndex(row => row.decision !== 'hold');
  const upwardClosed = firstSold >= 0 && reachable.slice(firstSold).every(row => row.decision !== 'hold');
  const sellFrom = solved.sellsFloor ? 0 : upwardClosed ? reachable[firstSold].threshold : null;

  const warnings = [];
  if (rows.some((row, index) => rows.slice(0, index).some(lower => lower.price > row.price))) {
    warnings.push('더 높은 급수 조건의 판매가가 더 낮습니다. 각 결과에는 도달한 가장 높은 기준의 가격만 적용합니다.');
  }
  if (rows.some(row => row.shadowedIds.length)) warnings.push('환산 급수가 같은 조건이 여러 개면 가장 높은 판매가 하나만 사용합니다.');
  const unreachable = rows.filter(row => row.decision === 'unreachable').length;
  if (unreachable) warnings.push(`${unreachable}개 판매 조건은 선택한 레벨·주스탯의 추가옵션으로 도달할 수 없거나 바로 위 조건과 구간이 겹쳐 확률이 0입니다.`);
  if (solved.possible && solved.objective === 'per-item') warnings.push('현재 시세로는 재설정할수록 이익이 나는 판매 기준이 없습니다. 매물당 기대 손실이 가장 작은 기준을 표시합니다.');
  if (solved.possible && !solved.hasPricedResult) warnings.push('도달 가능한 판매 조건이 없어 첫 재설정 결과를 잡추옵 처분가로 판매하는 경우만 계산했습니다.');

  return {
    ...solved,
    rows,
    unpricedProbability,
    unpricedDecision: solved.sellsFloor ? 'floor' : 'hold',
    sellFrom,
    examples: solved.possible && !solved.sellsFloor ? examplesFor(ladder, bandExamples, solved.acceptedIds) : [],
    comparison: immediate?.possible && differentPolicy(solved, immediate) ? { metrics: immediate.metrics } : null,
    model: {
      level: s.level,
      resetCost: s.resetCost,
      mainStats: flameTradeProfiles(s.mainStats).map(profile => profile.mainStat),
      weights: { ...s.weights },
      outcomes,
      maxScore,
    },
    warnings,
  };
}

export { FLAME_TRADE_FLOOR_ID };