// All probabilities, prices and game rules are supplied by the caller. Scores
// are equivalent main-stat percentages; prices and the reported value use meso.
export const ADDITIONAL_GRADES = ['에픽', '유니크', '레전드리'];
const G = ADDITIONAL_GRADES;
const WIDTH = 7; // cost, paid rolls, strange rolls, final score, final grades
const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
const exceeds = (a, b) => a > b && !near(a, b);

function number(value, label, { integer = false, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}: 유효한 ${integer ? '정수' : '숫자'}를 입력해 주세요.`);
  }
  return value;
}

function distribution(input, label) {
  if (!Array.isArray(input) || !input.length) throw new Error(`${label}: 확률 분포가 없습니다.`);
  const aggregated = new Map();
  for (const entry of input) {
    const score = number(entry.score, `${label} 점수`);
    const p = number(entry.probability ?? entry.p, `${label} 확률`, { max: 1 });
    if (p) aggregated.set(score, (aggregated.get(score) || 0) + p);
  }
  const mass = [...aggregated.values()].reduce((a, b) => a + b, 0);
  if (!mass || Math.abs(mass - 1) > 1e-6) throw new Error(`${label}: 확률의 합이 1이어야 합니다.`);
  return [...aggregated].sort((a, b) => a[0] - b[0]).map(([score, p]) => ({ score, probability: p / mass }));
}

function prepare(config) {
  const strategy = config.strategy ?? config.mode ?? 'mixed';
  if (!['mixed', 'reset', 'strange'].includes(strategy)) throw new Error('지원하지 않는 전략입니다.');
  const currentGrade = config.currentGrade ?? G[0];
  if (!G.includes(currentGrade)) throw new Error('에픽 / 유니크 / 레전드리 등급을 선택해 주세요.');
  const currentScore = number(config.currentScore, '현재 환산 주스탯');
  const mesoPerPercent = number(config.mesoPerPercent, '주스탯 1%당 지불 금액');
  const currentIndex = G.indexOf(currentGrade), paid = strategy !== 'strange';
  const strange = currentIndex === 0 && strategy !== 'reset' && !!config.distributions?.[G[0]]?.strange?.length;
  if (strategy === 'strange' && currentIndex === 0 && !strange) throw new Error('수상한 에디셔널 큐브 확률 분포가 없습니다.');
  const cfg = { ...config, strategy, currentGrade, currentScore, mesoPerPercent, paid, strange,
    divisor: mesoPerPercent || 1, rewardWeight: mesoPerPercent > 0 ? 1 : 0, currentIndex,
    distributions: {}, costs: {}, upRates: {}, pity: {}, stacks: {}, strangeCost: 0 };
  if (strange) cfg.strangeCost = number(config.strangeCost ?? 0, '수상한 에디셔널 큐브 가격');
  for (const [index, grade] of G.entries()) {
    cfg.distributions[grade] = {};
    if (paid && index >= currentIndex) {
      cfg.distributions[grade].reset = distribution(config.distributions?.[grade]?.reset, `${grade} 재설정`);
      cfg.costs[grade] = number(config.costs?.[grade], `${grade} 재설정 가격`);
    }
    if (!index && strange) cfg.distributions[grade].strange = distribution(config.distributions[grade].strange, '수상한 에디셔널 큐브');
    if (index >= currentIndex && index < 2 && paid) {
      cfg.upRates[grade] = Math.min(1, number(config.upRates?.[grade], `${grade} 등급 상승 확률`, { max: 1 }) * (config.miracle ? 2 : 1));
      cfg.pity[grade] = number(config.pity?.[grade], `${grade} 등급 상승 보장 실패 횟수`, { integer: true, max: 10000 });
      cfg.stacks[grade] = number(config.stacks?.[grade] ?? 0, `${grade} 누적 실패 횟수`, { integer: true, max: cfg.pity[grade] });
    } else { cfg.pity[grade] = 0; cfg.stacks[grade] = 0; }
  }
  return cfg;
}

const zero = () => new Float64Array(WIDTH);
function terminal(score, gradeIndex) { const a = zero(); a[3] = score; a[4 + gradeIndex] = 1; return a; }
function add(a, b, p = 1) { if (p > 0) for (let j = 0; j < WIDTH; j++) a[j] += p * b[j]; return a; }
function divided(a, p) { return Float64Array.from(a, x => x / p); }
function actionStats(cost, kind, future) { const a = Float64Array.from(future); a[0] += cost; a[kind === 'reset' ? 1 : 2]++; return a; }
function forever(cost, kind) { const a = zero(); a[0] = cost ? Infinity : 0; a[kind === 'reset' ? 1 : 2] = Infinity; return a; }

function gridFor(cfg, grade) {
  const lists = Object.values(cfg.distributions[grade]);
  const attainable = [...new Set(lists.flat().map(x => x.score))].sort((a, b) => a - b);
  const scores = [...new Set([...attainable, ...(grade === cfg.currentGrade ? [cfg.currentScore] : [])])].sort((a, b) => a - b);
  if (!scores.length) scores.push(0);
  const indices = new Map(scores.map((s, i) => [s, i]));
  const probabilities = {};
  for (const [kind, entries] of Object.entries(cfg.distributions[grade])) {
    probabilities[kind] = new Float64Array(scores.length);
    for (const { score, probability } of entries) probabilities[kind][indices.get(score)] = probability;
  }
  return { scores, attainable, indices, probabilities };
}

function expectation(row, probabilities) {
  let value = 0; const stats = zero();
  for (let i = 0; i < probabilities.length; i++) if (probabilities[i]) {
    value += probabilities[i] * row.values[i]; add(stats, row.stats[i], probabilities[i]);
  }
  return { value, stats };
}

const weighted = (value, p) => p > 0 ? p * value : 0;

// V(x) = max(x, -c + E V(Y)). Sorting the alternatives gives its exact
// reservation value, including the free-roll case (accept the finite maximum).
function reservationValue(values, probabilities, cost) {
  const outcomes = values.map((value, i) => [value, probabilities[i]]).filter(([, p]) => p > 0).sort((a, b) => b[0] - a[0]);
  let mass = 0, sum = 0;
  for (let i = 0; i < outcomes.length; i++) {
    const [value, p] = outcomes[i]; mass += p; sum += p * value;
    const q = (sum - cost) / mass;
    if (i === outcomes.length - 1 || q >= outcomes[i + 1][0]) return q;
  }
  return -Infinity;
}

function stoppingRow(grid, gradeIndex, cfg) {
  return { values: grid.scores.map(s => s * cfg.rewardWeight), stats: grid.scores.map(s => terminal(s, gradeIndex)), actions: grid.scores.map(() => 'stop') };
}

// A replacement roll returns to the same row. Below q all such states share
// one continuation action; eliminate that self-loop analytically.
function addRepeatAction(row, probabilities, cost, kind, cfg) {
  const q = reservationValue(row.values, probabilities, cost / cfg.divisor);
  let escape = 0; const future = zero();
  for (let i = 0; i < probabilities.length; i++) if (probabilities[i] && !exceeds(q, row.values[i])) {
    escape += probabilities[i]; add(future, row.stats[i], probabilities[i]);
  }
  if (!(escape > 0)) throw new Error('재설정 정책의 종료 확률을 계산할 수 없습니다.');
  const stats = divided(actionStats(cost, kind, future), escape);
  for (let i = 0; i < row.values.length; i++) if (exceeds(q, row.values[i])) {
    row.values[i] = q; row.stats[i] = stats; row.actions[i] = kind;
  }
}

function paidContinuations(cfg, grade, grid, nextRow, upgraded, up) {
  const n = grid.scores.length;
  const values = new Float64Array(n), stats = new Array(n);
  const cost = cfg.costs[grade], probabilities = grid.probabilities.reset;
  const failure = 1 - up;
  if (!failure) {
    for (let i = 0; i < n; i++) {
      values[i] = -cost / cfg.divisor + upgraded.value;
      stats[i] = actionStats(cost, 'reset', upgraded.stats);
    }
    return { values, stats };
  }
  if (!cfg.retainPaid) {
    const ordinary = expectation(nextRow, probabilities);
    const value = -cost / cfg.divisor + weighted(upgraded.value, up) + weighted(ordinary.value, failure);
    const totals = actionStats(cost, 'reset', add(add(zero(), upgraded.stats, up), ordinary.stats, failure));
    for (let i = 0; i < n; i++) { values[i] = value; stats[i] = totals; }
    return { values, stats };
  }
  // Retention only applies on a failed grade-up. Values are monotone in score,
  // so choosing the higher old/new score also maximizes future option value.
  // Prefix mass and suffix expectations keep each pity row linear in support.
  const suffixValues = new Float64Array(n + 1), suffixStats = Array.from({ length: n + 1 }, zero);
  for (let i = n - 1; i >= 0; i--) {
    suffixValues[i] = suffixValues[i + 1] + weighted(nextRow.values[i], probabilities[i]);
    suffixStats[i] = add(Float64Array.from(suffixStats[i + 1]), nextRow.stats[i], probabilities[i]);
  }
  let mass = 0;
  for (let i = 0; i < n; i++) {
    mass += probabilities[i];
    const ordinary = add(Float64Array.from(suffixStats[i + 1]), nextRow.stats[i], mass);
    values[i] = -cost / cfg.divisor + weighted(upgraded.value, up) + failure * (weighted(nextRow.values[i], mass) + suffixValues[i + 1]);
    stats[i] = actionStats(cost, 'reset', add(add(zero(), upgraded.stats, up), ordinary, failure));
  }
  return { values, stats };
}

function summary(cfg, stats, action, rows, currentRow, grid, manual) {
  const completionProbability = stats[4] + stats[5] + stats[6];
  const possible = completionProbability >= 1 - 1e-9 && Number.isFinite(stats[1] + stats[2]);
  const expectedFinalScore = possible ? stats[3] : null;
  const expectedGain = possible ? expectedFinalScore - cfg.currentScore : null;
  const current = rows.find(r => r.grade === cfg.currentGrade && r.stack === cfg.stacks[cfg.currentGrade]);
  const result = {
    action, possible, completionProbability, expectedCost: stats[0], expectedAttempts: stats[1] + stats[2],
    resetAttempts: stats[1], strangeAttempts: stats[2], expectedFinalScore, expectedGain,
    netValue: possible ? expectedGain * cfg.mesoPerPercent - stats[0] : -Infinity,
    expectedFinalValue: possible ? expectedFinalScore * cfg.mesoPerPercent - stats[0] : -Infinity,
    finalGradeProbabilities: Object.fromEntries(G.map((grade, i) => [grade, stats[4 + i]])),
    currentCutoff: current?.cutoff ?? Infinity, currentActionRanges: current?.actionRanges ?? [], thresholds: rows,
    strategy: cfg.strategy, retainPaid: !!cfg.retainPaid,
  };
  if (!possible) result.reason = '이 종료 기준으로는 도달할 수 없는 결과가 있어 유한한 기대 횟수로 종료하지 못합니다.';
  if (manual) result.manual = true;
  if (cfg.includePolicy) result.currentPolicy = grid.scores.map((score, i) => ({ score, action: currentRow.actions[i], value: currentRow.values[i] * cfg.divisor }));
  return result;
}

function rowSummary(grade, stack, row, grid) {
  const cutoff = grid.attainable.find(score => row.actions[grid.indices.get(score)] === 'stop') ?? Infinity;
  const actions = [...new Set(row.actions.filter(a => a !== 'stop'))];
  // Boundaries refer only to scores in the finite attainable support. Merge
  // consecutive support entries, without claiming a policy for scores between
  // them; an arbitrary current score still has its separately reported action.
  const actionRanges = [];
  for (const score of grid.attainable) {
    const action = row.actions[grid.indices.get(score)], last = actionRanges.at(-1);
    if (last?.action === action) last.maxScore = score;
    else actionRanges.push({ minScore: score, maxScore: score, action });
  }
  return { grade, stack, cutoff, actionBelow: actions.length === 1 ? actions[0] : actions.length ? 'mixed' : 'stop', actionRanges };
}

/** Maximize E[mesoPerPercent * (finalScore - currentScore) - totalCost].
 * Stop ties immediately. Pity k=max means the NEXT paid roll upgrades.
 * Strange rolls neither increase nor clear paid pity. Upgrades use the saved
 * next-grade stack and always replace the options with a next-grade draw.
 * cutoff is the smallest attainable score that stops, not an interpolated
 * percentage; Infinity means no attainable current-grade result stops.
 */
export function solveAdditionalStrategy(config) {
  const cfg = prepare(config), grids = G.map(g => gridFor(cfg, g)), saved = {}, rows = [];
  let currentRow;
  for (let gi = cfg.paid ? 2 : cfg.currentIndex; gi >= cfg.currentIndex; gi--) {
    const grade = G[gi], grid = grids[gi], max = cfg.pity[grade];
    let nextRow;
    const upgraded = gi < 2 && cfg.paid ? expectation(saved[G[gi + 1]], grids[gi + 1].probabilities.reset) : null;
    for (let stack = max; stack >= 0; stack--) {
      const row = stoppingRow(grid, gi, cfg);
      if (cfg.paid && gi === 2) addRepeatAction(row, grid.probabilities.reset, cfg.costs[grade], 'reset', cfg);
      else if (cfg.paid) {
        const up = stack === max ? 1 : cfg.upRates[grade];
        const paid = paidContinuations(cfg, grade, grid, nextRow, upgraded, up);
        for (let i = 0; i < grid.scores.length; i++) if (exceeds(paid.values[i], row.values[i])) {
          row.values[i] = paid.values[i]; row.stats[i] = paid.stats[i]; row.actions[i] = 'reset';
        }
      }
      if (gi === 0 && cfg.strange) addRepeatAction(row, grid.probabilities.strange, cfg.strangeCost, 'strange', cfg);
      rows.push(rowSummary(grade, stack, row, grid));
      if (stack === cfg.stacks[grade]) {
        saved[grade] = row;
        if (grade === cfg.currentGrade) currentRow = row;
      }
      nextRow = row;
    }
  }
  rows.sort((a, b) => G.indexOf(a.grade) - G.indexOf(b.grade) || a.stack - b.stack);
  const grid = grids[G.indexOf(cfg.currentGrade)], index = grid.indices.get(cfg.currentScore);
  return summary(cfg, currentRow.stats[index], currentRow.actions[index], rows, currentRow, grid);
}

function thresholdRepeat(row, grid, threshold, probabilities, cost, kind, gi) {
  let escape = 0; const accepted = zero();
  for (let i = 0; i < probabilities.length; i++) if (probabilities[i] && grid.scores[i] >= threshold) {
    escape += probabilities[i]; add(accepted, terminal(grid.scores[i], gi), probabilities[i]);
  }
  const stats = escape ? divided(actionStats(cost, kind, accepted), escape) : forever(cost, kind);
  for (let i = 0; i < grid.scores.length; i++) if (grid.scores[i] < threshold) { row.stats[i] = stats; row.actions[i] = kind; }
}

/** Evaluate a fixed target per grade. Infinity means never stop in that grade.
 * epicAction='strange' stays Epic; it never silently switches to paid rolls.
 * With retained paid results this evaluator keeps the higher same-grade score.
 */
export function evaluateAdditionalThresholds(config, policy = {}) {
  const cfg = prepare(config), thresholds = policy.thresholds ?? policy.targets ?? config.thresholds;
  if (!thresholds) throw new Error('등급별 종료 기준을 입력해 주세요.');
  for (const grade of G.slice(cfg.currentIndex, cfg.paid ? 3 : cfg.currentIndex + 1)) if (thresholds[grade] !== Infinity) number(thresholds[grade], `${grade} 종료 기준`);
  const epicAction = policy.epicAction ?? (cfg.strategy === 'strange' ? 'strange' : 'reset');
  if (!['strange', 'reset'].includes(epicAction)) throw new Error('에픽 등급의 재설정 방법을 선택해 주세요.');
  if (cfg.currentIndex === 0 && epicAction === 'strange' && !cfg.strange) throw new Error('이 전략에서는 수상한 에디셔널 큐브를 사용할 수 없습니다.');
  if (cfg.currentIndex === 0 && epicAction === 'reset' && !cfg.paid) throw new Error('이 전략에서는 에디셔널 잠재능력 재설정을 사용할 수 없습니다.');
  const grids = G.map(g => gridFor(cfg, g)), saved = {}, rows = [];
  let currentRow;
  for (let gi = cfg.paid ? 2 : cfg.currentIndex; gi >= cfg.currentIndex; gi--) {
    const grade = G[gi], grid = grids[gi], threshold = thresholds[grade], max = cfg.pity[grade];
    let nextRow;
    const upgraded = gi < 2 && cfg.paid ? expectation(saved[G[gi + 1]], grids[gi + 1].probabilities.reset) : null;
    for (let stack = max; stack >= 0; stack--) {
      const row = stoppingRow(grid, gi, cfg);
      if (gi === 0 && epicAction === 'strange') thresholdRepeat(row, grid, threshold, grid.probabilities.strange, cfg.strangeCost, 'strange', gi);
      else if (cfg.paid && gi === 2) thresholdRepeat(row, grid, threshold, grid.probabilities.reset, cfg.costs[grade], 'reset', gi);
      else if (cfg.paid) {
        const up = stack === max ? 1 : cfg.upRates[grade];
        const paid = paidContinuations(cfg, grade, grid, nextRow, upgraded, up);
        for (let i = 0; i < grid.scores.length; i++) if (grid.scores[i] < threshold) { row.stats[i] = paid.stats[i]; row.actions[i] = 'reset'; }
      } else {
        for (let i = 0; i < grid.scores.length; i++) if (grid.scores[i] < threshold) { row.stats[i] = forever(0, 'reset'); row.actions[i] = 'unavailable'; }
      }
      for (let i = 0; i < grid.scores.length; i++) row.values[i] = row.stats[i][3] * cfg.rewardWeight - row.stats[i][0] / cfg.divisor;
      rows.push({ ...rowSummary(grade, stack, row, grid), cutoff: threshold, actionBelow: gi === 0 ? epicAction : cfg.paid ? 'reset' : 'unavailable' });
      if (stack === cfg.stacks[grade]) {
        saved[grade] = row;
        if (grade === cfg.currentGrade) currentRow = row;
      }
      nextRow = row;
    }
  }
  rows.sort((a, b) => G.indexOf(a.grade) - G.indexOf(b.grade) || a.stack - b.stack);
  const grid = grids[G.indexOf(cfg.currentGrade)], index = grid.indices.get(cfg.currentScore);
  return summary(cfg, currentRow.stats[index], currentRow.actions[index], rows, currentRow, grid, true);
}

export const optimizeAdditional = solveAdditionalStrategy;
export const evaluateThresholdPolicy = evaluateAdditionalThresholds;
