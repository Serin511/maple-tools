import {
  ADDITIONAL_GRADES, ADDITIONAL_LEVELS, ADDITIONAL_SLOTS, ADDITIONAL_STATS,
  DEFAULT_ADDITIONAL_EFFICIENCY, getAdditionalLines, scoreAdditionalOption,
} from './additional-data.mjs';
import { resetAdditionalCosts } from './additional-calculator.mjs';
import { solveAdditionalTrade } from './additional-trade-engine.mjs';

const TRADE_GRADES = ADDITIONAL_GRADES;
const SUBSTATS = Object.freeze({ STR: 'DEX', DEX: 'STR', INT: 'LUK', LUK: 'DEX' });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const finite = (v, max = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const atLeast = (value, threshold) => value >= threshold - Number.EPSILON * 16 * Math.max(1, Math.abs(value), Math.abs(threshold));

export const DEFAULT_ADDITIONAL_TRADE_SETTINGS = Object.freeze({
  slot: '모자', level: 200, startGrade: '에픽', characterLevel: 290,
  efficiency: { ...DEFAULT_ADDITIONAL_EFFICIENCY, criticalDamagePercent: 4 },
  itemPrice: 0, fee: 3, floorPrice: 0, miracle: false, autoSell: true,
  separateGrades: false, separateCrit: true,
  prices: { shared: [], 에픽: [], 유니크: [], 레전드리: [] },
  costs: resetAdditionalCosts(200),
  upRates: { 에픽: 0.009804, 유니크: 0.007 },
  pity: { 에픽: 152, 유니크: 214 }, stacks: { 에픽: 0, 유니크: 0 },
});

function invalid(message) { throw new Error(message); }
function nonnegative(value, label, max = 1e16) {
  if (!finite(value, max)) invalid(`${label}: 0 이상의 유한한 숫자를 입력해 주세요.`);
}

function activePriceLists(s) {
  return s.separateGrades ? TRADE_GRADES.map(grade => [grade, s.prices?.[grade] ?? []]) : [['공통', s.prices?.shared ?? []]];
}

function validateRows(rows, familyName) {
  if (!Array.isArray(rows)) invalid(`${familyName} 가격 조건을 확인해 주세요.`);
  const seenIds = new Set(), seenThresholds = new Set();
  for (const row of rows) {
    // Empty-price rows are retained UI placeholders, so they have no active
    // targeting semantics and may be incomplete while the user edits them.
    if (row?.price === '') continue;
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim()) invalid('가격 조건 식별값을 확인해 주세요.');
    if (seenIds.has(row.id)) invalid('가격 조건 ID가 중복되었습니다.');
    seenIds.add(row.id);
    if (!ADDITIONAL_STATS.includes(row.stat)) invalid('가격 조건의 주스탯을 선택해 주세요.');
    if (!finite(row.min, 1e6)) invalid('가격 조건 목표 환산값에는 0 이상의 유한한 숫자를 입력해 주세요.');
    if (!Number.isInteger(row.cd) || row.cd < 0 || row.cd > 3) invalid('쿨감 합계는 0~3초의 정수로 입력해 주세요.');
    if (![0, 1, 2, 3, 4, 5, 6, 7, 9].includes(row.crit)) invalid('크뎀 합계는 가능한 0·1·2·3·4·5·6·7·9% 중에서 선택해 주세요.');
    if (row.price !== '' && !finite(row.price, 1e16)) invalid('가격 조건의 판매가는 비워 두거나 0 이상의 유한한 숫자로 입력해 주세요.');
    const signature = `${row.stat}|${row.min}|${row.cd}|${row.crit}`;
    if (seenThresholds.has(signature)) invalid('같은 주스탯·쿨감·크뎀 구간의 목표 환산값을 중복 입력할 수 없습니다.');
    seenThresholds.add(signature);
  }
}

export function validateAdditionalTradeSettings(settings) {
  if (!settings || typeof settings !== 'object') invalid('입력값을 확인해 주세요.');
  const s = { ...DEFAULT_ADDITIONAL_TRADE_SETTINGS, ...settings };
  if (!ADDITIONAL_SLOTS.includes(s.slot)) invalid('지원하는 방어구·장신구 부위를 선택해 주세요.');
  if (!ADDITIONAL_LEVELS.includes(s.level)) invalid('140·160·200·250레벨 장비만 지원합니다.');
  if (!TRADE_GRADES.includes(s.startGrade)) invalid('에픽·유니크·레전드리 중 시작 등급을 선택해 주세요.');
  if (!Number.isInteger(s.characterLevel) || s.characterLevel < 1 || s.characterLevel > 300) invalid('캐릭터 레벨은 1~300의 정수로 입력해 주세요.');
  for (const [key, value] of Object.entries(s.efficiency ?? {})) {
    if (!own(DEFAULT_ADDITIONAL_EFFICIENCY, key) || !finite(value, 1e6)) invalid('스탯 환산 효율은 허용된 항목의 0 이상의 유한한 숫자로 입력해 주세요.');
  }
  for (const key of ['itemPrice', 'floorPrice']) nonnegative(s[key], key === 'itemPrice' ? '매입가' : '레전드리 최소 처분가');
  if (!finite(s.fee, 100)) invalid('경매장 수수료율은 0~100%로 입력해 주세요.');
  for (const k of ['miracle', 'autoSell', 'separateGrades', 'separateCrit']) if (typeof s[k] !== 'boolean') invalid('재설정 규칙 토글을 확인해 주세요.');
  if (!s.prices || typeof s.prices !== 'object') invalid('가격 조건을 확인해 주세요.');
  for (const [, rows] of activePriceLists(s)) validateRows(rows, '활성');
  const activeRows = activePriceLists(s).flatMap(([, rows]) => rows).filter(row => row?.price !== '');
  if (s.slot !== '모자' && activeRows.some(row => row.cd > 0)) invalid('쿨감 가격 조건은 모자에서만 사용할 수 있습니다.');
  if (s.slot !== '장갑' && activeRows.some(row => row.crit > 0)) invalid('크뎀 가격 조건은 장갑에서만 사용할 수 있습니다.');
  if (s.slot === '장갑' && !s.separateCrit && activeRows.some(row => row.crit > 0)) invalid('크뎀 가격 조건은 크뎀 분리 모드에서만 사용할 수 있습니다.');
  if (!s.costs || !s.upRates || !s.pity || !s.stacks) invalid('재설정 규칙을 확인해 주세요.');
  const startIndex = TRADE_GRADES.indexOf(s.startGrade);
  for (const grade of TRADE_GRADES.slice(startIndex)) {
    if (!getAdditionalLines({ method: 'reset', grade, slot: s.slot, level: s.level })) invalid(`${grade} ${s.slot} 확률표가 없습니다.`);
    nonnegative(s.costs[grade], `${grade} 1회 재설정 비용`);
    if (grade !== '레전드리') {
      if (!finite(s.upRates[grade], 1)) invalid(`${grade} 등급업 확률은 0~1로 입력해 주세요.`);
      if (!Number.isInteger(s.pity[grade]) || s.pity[grade] < 0 || s.pity[grade] > 1000) invalid(`${grade} 천장 실패 횟수는 0~1000의 정수로 입력해 주세요.`);
      if (!Number.isInteger(s.stacks[grade]) || s.stacks[grade] < 0 || s.stacks[grade] > s.pity[grade]) invalid(`${grade} 현재 누적 실패 횟수는 0~${s.pity[grade]}로 입력해 주세요.`);
    }
  }
  if (s.startGrade === '레전드리' && !activePriceLists(s).some(([, rows]) => rows.some(row => row.price !== '' && row.price != null))) {
    nonnegative(s.floorPrice, '레전드리 최소 처분가');
  }
  return true;
}

function cleanEfficiency(efficiency = {}, settings = {}) {
  return {
    ...DEFAULT_ADDITIONAL_TRADE_SETTINGS.efficiency, ...efficiency,
    itemDropPercent: 0, mesoPercent: 0, cooldownSecond: 0,
    ...(settings.slot === '장갑' && settings.separateCrit ? { criticalDamagePercent: 0 } : {}),
  };
}

function optionScores(label, settings) {
  const efficiency = cleanEfficiency(settings.efficiency, settings);
  const scores = {};
  for (const stat of ADDITIONAL_STATS) {
    // The conversion helper maps its selected main and sub stats. The game's
    // fixed trade-stat mapping is applied here; INT uses magic.
    scores[stat] = scoreAdditionalOption(label, {
      mainStat: stat, subStat: SUBSTATS[stat], attackType: stat === 'INT' ? 'magic' : 'attack',
      characterLevel: settings.characterLevel, efficiency,
    });
  }
  const cd = Number(label.match(/^스킬 재사용 대기시간 -(\d+(?:\.\d+)?)초$/)?.[1] ?? 0);
  const crit = Number(label.match(/^크리티컬 데미지 \+(\d+(?:\.\d+)?)%$/)?.[1] ?? 0);
  return { scores, cd, crit };
}

function priceRows(settings, grade) {
  return settings.separateGrades ? settings.prices?.[grade] ?? [] : settings.prices?.shared ?? [];
}

function rowIsPriced(row) { return row.price !== '' && row.price != null; }
export function classifyAdditionalTradeOutcome(priceRowsForGrade, scores, cd = 0, crit = 0) {
  // For each stat/cooldown/critical-damage family, use the highest threshold
  // reached; then choose the most valuable single matching sale result.
  const families = new Map();
  for (const row of priceRowsForGrade) {
    if (!rowIsPriced(row) || !atLeast(scores[row.stat], row.min) || !atLeast(cd, row.cd) || !atLeast(crit, row.crit)) continue;
    const family = `${row.stat}|${row.cd}|${row.crit}`;
    const previous = families.get(family);
    if (!previous || row.min > previous.min || (row.min === previous.min && row.price > previous.price)) families.set(family, row);
  }
  let winner = null;
  for (const row of families.values()) if (!winner || row.price > winner.price) winner = row;
  return { winner, eligibleIds: priceRowsForGrade.filter(row => rowIsPriced(row)
    && atLeast(scores[row.stat], row.min) && atLeast(cd, row.cd) && atLeast(crit, row.crit)).map(row => row.id) };
}

export function additionalTradeScore(options, settings = DEFAULT_ADDITIONAL_TRADE_SETTINGS) {
  const s = { ...DEFAULT_ADDITIONAL_TRADE_SETTINGS, ...settings, efficiency: cleanEfficiency(settings.efficiency, settings) };
  if (!Array.isArray(options) || options.length !== 3) invalid('옵션 세 줄을 확인해 주세요.');
  const totals = Object.fromEntries(ADDITIONAL_STATS.map(stat => [stat, 0]));
  let cd = 0, crit = 0;
  for (const label of options) {
    const detail = optionScores(label, s);
    for (const stat of ADDITIONAL_STATS) totals[stat] += detail.scores[stat];
    cd += detail.cd; crit += detail.crit;
  }
  return { scores: totals, cd, crit: s.slot === '장갑' && s.separateCrit ? crit : 0 };
}

function distributionForGrade(settings, grade) {
  const lines = getAdditionalLines({ method: 'reset', grade, slot: settings.slot, level: settings.level });
  if (!lines) invalid(`${grade} ${settings.slot} 확률표가 없습니다.`);
  const cachedLines = lines.map(line => line.map(row => ({ ...row, detail: optionScores(row.label, settings) })));
  const priceRowsForGrade = priceRows(settings, grade);
  const results = new Map(), rowProbabilities = new Map();
  for (const a of cachedLines[0]) for (const b of cachedLines[1]) for (const c of cachedLines[2]) {
    const probability = a.probability * b.probability * c.probability;
    const totals = Object.fromEntries(ADDITIONAL_STATS.map(stat => [stat, a.detail.scores[stat] + b.detail.scores[stat] + c.detail.scores[stat]]));
    const cd = a.detail.cd + b.detail.cd + c.detail.cd;
    const crit = a.detail.crit + b.detail.crit + c.detail.crit;
    const { winner, eligibleIds } = classifyAdditionalTradeOutcome(priceRowsForGrade, totals, cd, crit);
    for (const id of eligibleIds) rowProbabilities.set(id, (rowProbabilities.get(id) ?? 0) + probability);
    const targetId = winner?.id ?? null, price = winner ? Number(winner.price) : null;
    const signature = JSON.stringify([price, targetId]);
    const previous = results.get(signature);
    if (previous) previous.probability += probability;
    else results.set(signature, { price, probability, targetId });
  }
  const rows = [...results.values()];
  const mass = rows.reduce((sum, row) => sum + row.probability, 0);
  return { distribution: rows.map(row => ({ ...row, probability: row.probability / mass })), rowProbabilities: new Map([...rowProbabilities].map(([id, p]) => [id, p / mass])) };
}

function priceRowSummaries(settings, distributions, rowProbabilities) {
  const out = [];
  const grades = TRADE_GRADES.slice(TRADE_GRADES.indexOf(settings.startGrade));
  for (const grade of grades) {
    const rows = priceRows(settings, grade);
    const stats = rowProbabilities[grade];
    for (const row of rows) {
      out.push({
        grade: settings.separateGrades ? grade : `${grade} · 공통`, id: row.id,
        label: `${row.stat} ${row.min}%급 이상${row.cd ? ` · 쿨감 ${row.cd}초 이상` : ''}${row.crit ? ` · 크뎀 ${row.crit}% 이상` : ''}`,
        price: row.price === '' ? null : Number(row.price),
        probability: stats.total.get(row.id) ?? 0,
        winningProbability: stats.winning.get(row.id) ?? 0,
      });
    }
  }
  return out;
}

export function calculateAdditionalTrade(settings) {
  validateAdditionalTradeSettings(settings);
  const s = { ...DEFAULT_ADDITIONAL_TRADE_SETTINGS, ...settings, efficiency: cleanEfficiency(settings.efficiency, settings) };
  const distributions = {};
  const rowProbabilities = {};
  for (const grade of TRADE_GRADES.slice(TRADE_GRADES.indexOf(s.startGrade))) {
    const generated = distributionForGrade(s, grade);
    distributions[grade] = generated.distribution;
    const winning = new Map();
    for (const outcome of generated.distribution) if (outcome.targetId) winning.set(outcome.targetId, (winning.get(outcome.targetId) ?? 0) + outcome.probability);
    rowProbabilities[grade] = { total: generated.rowProbabilities, winning };
  }
  const engineResult = solveAdditionalTrade({ ...s, distributions });
  return {
    ...engineResult,
    distributions,
    priceRows: priceRowSummaries(s, distributions, rowProbabilities),
    warnings: [
      ...(engineResult.warnings ?? []),
      '스탯별 옵션은 같은 3줄 결과 안에서 함께 계산합니다. 여러 판매 조건에 맞아도 가장 높은 판매가 한 건만 적용합니다.',
      '아이템 드롭률·메소 획득량·HP 옵션은 가치 계산에서 제외했습니다. 제논·데몬어벤져 전용 가격 조건은 지원하지 않습니다.',
      '공개된 줄별 확률의 반올림 오차를 정규화해 결합합니다. 직전 결과 재등장 제한은 반영하지 않습니다.',
    ],
  };
}

export { SUBSTATS as ADDITIONAL_TRADE_SUBSTATS };
