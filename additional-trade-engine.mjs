// Exact finite-state average-profit optimizer for additional-potential trading.
// Each reset is one decision epoch. The options are observed after the reset;
// the policy then either sells (and buys a replacement) or keeps resetting.
export const ADDITIONAL_TRADE_GRADES = ['에픽', '유니크', '레전드리'];
const GRADES = ADDITIONAL_TRADE_GRADES;
const close = (a, b, tol = 1e-8) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function finite(value, label, { min = 0, max = Infinity, integer = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${label}: 유효한 ${integer ? '정수' : '숫자'}를 입력해 주세요.`);
  }
  return value;
}

function prepare(input) {
  const startGrade = input.startGrade ?? '에픽';
  if (!GRADES.includes(startGrade)) throw new Error('시작 등급은 에픽 / 유니크 / 레전드리 중에서 선택해 주세요.');
  const cfg = {
    startGrade, startIndex: GRADES.indexOf(startGrade),
    itemPrice: finite(input.itemPrice, '매입 가격'),
    fee: finite(input.fee, '수수료', { max: 100 }) / 100,
    floorPrice: input.floorPrice == null ? null : finite(input.floorPrice, '레전드리 하한가'),
    miracle: !!input.miracle, autoSell: !!input.autoSell,
    distributions: {}, costs: {}, upRates: {}, pity: {}, stacks: {},
  };
  for (let gi = cfg.startIndex; gi < 3; gi++) {
    const grade = GRADES[gi], list = input.distributions?.[grade];
    if (!Array.isArray(list) || !list.length) throw new Error(`${grade} 가격 조건별 확률이 없습니다.`);
    let mass = 0;
    cfg.distributions[grade] = list.map((entry, index) => {
      const probability = finite(entry.probability, `${grade} ${index + 1}번째 확률`, { max: 1 });
      mass += probability;
      const price = entry.price === null ? null : finite(entry.price, `${grade} 판매가`);
      if (entry.targetId != null && typeof entry.targetId !== 'string') throw new Error('targetId는 문자열 또는 null이어야 합니다.');
      return { price, probability, targetId: entry.targetId ?? null, index };
    });
    if (Math.abs(mass - 1) > 1e-7) throw new Error(`${grade} 확률의 합이 1이어야 합니다.`);
    cfg.distributions[grade] = cfg.distributions[grade].map(x => ({ ...x, probability: x.probability / mass }));
    cfg.costs[grade] = finite(input.costs?.[grade], `${grade} 재설정 가격`);
    if (gi < 2) {
      cfg.upRates[grade] = Math.min(1, finite(input.upRates?.[grade], `${grade} 등급 상승 확률`, { max: 1 }) * (cfg.miracle ? 2 : 1));
      cfg.pity[grade] = finite(input.pity?.[grade], `${grade} 등급업 천장까지 실패 횟수`, { integer: true, max: 1000 });
      cfg.stacks[grade] = finite(input.stacks?.[grade] ?? 0, `${grade} 천장 스택`, { integer: true, max: cfg.pity[grade] });
    }
  }
  // In auto mode the floor is an alternative sale value for Legendary rolls.
  cfg.legendHasPrice = !!cfg.distributions.레전드리?.some(x => x.price !== null);
  for (let gi = cfg.startIndex; gi < 3; gi++) {
    const grade = GRADES[gi];
    cfg.distributions[grade] = cfg.distributions[grade].map(x => ({
      ...x,
      effectivePrice: grade !== '레전드리' ? x.price : cfg.autoSell
        ? (x.price === null ? (cfg.floorPrice > 0 ? cfg.floorPrice : null) : Math.max(x.price, cfg.floorPrice ?? 0))
        : (x.price ?? (!cfg.legendHasPrice && cfg.floorPrice > 0 ? cfg.floorPrice : null)),
    }));
  }
  cfg.moneyScale = Math.max(1, cfg.itemPrice, cfg.floorPrice ?? 0,
    ...Object.values(cfg.costs),
    ...Object.values(cfg.distributions).flat().map(x => x.effectivePrice ?? 0));
  return cfg;
}

function stateSpace(cfg) {
  const pe = cfg.startIndex === 0 ? cfg.pity.에픽 : 0;
  const pu = cfg.startIndex <= 1 ? cfg.pity.유니크 : 0;
  const states = [], index = new Map();
  const add = (g, e, u) => { const key = `${g}/${e}/${u}`; if (!index.has(key)) { index.set(key, states.length); states.push({ g, e, u }); } };
  if (cfg.startIndex === 0) {
    for (let e = 0; e <= pe; e++) for (let u = 0; u <= pu; u++) add(0, e, u);
    for (let u = 0; u <= pu; u++) add(1, 0, u);
    add(2, 0, 0);
  } else if (cfg.startIndex === 1) {
    for (let u = 0; u <= pu; u++) add(1, 0, u);
    add(2, 0, 0);
  } else add(2, 0, 0);
  const lookup = (g, e, u) => {
    const found = index.get(`${g}/${e}/${u}`);
    if (found === undefined) throw new Error('내부 천장 스택 상태 전이 오류');
    return found;
  };
  return { states, index, lookup, initial: lookup(cfg.startIndex, cfg.stacks.에픽 ?? 0, cfg.stacks.유니크 ?? 0) };
}

function afterResetBranches(cfg, space, s) {
  const { g, e, u } = s, grade = GRADES[g];
  if (g === 2) return [{ p: 1, gradeIndex: 2, e: 0, u: 0, outcomes: cfg.distributions[grade] }];
  const stack = g === 0 ? e : u, cap = cfg.pity[grade];
  const up = stack >= cap ? 1 : cfg.upRates[grade];
  const branches = [];
  if (up < 1) {
    const ne = g === 0 ? Math.min(e + 1, cap) : e;
    const nu = g === 1 ? Math.min(u + 1, cap) : u;
    branches.push({ p: 1 - up, gradeIndex: g, e: ne, u: nu, outcomes: cfg.distributions[grade] });
  }
  if (up > 0) {
    // A successful upgrade clears only that tier's accumulated failures.
    const ne = g === 0 ? 0 : e, nu = g === 1 ? 0 : u;
    branches.push({ p: up, gradeIndex: g + 1, e: ne, u: nu, outcomes: cfg.distributions[GRADES[g + 1]] });
  }
  return branches;
}

function buildModel(cfg) {
  const space = stateSpace(cfg), n = space.states.length;
  const rows = space.states.map((s, si) => ({ state: s, cost: cfg.costs[GRADES[s.g]], branches: afterResetBranches(cfg, space, s).map(branch => ({
    p: branch.p, gradeIndex: branch.gradeIndex, e: branch.e, u: branch.u,
    outcomes: branch.outcomes.map(outcome => {
      const sellIndex = space.lookup(cfg.startIndex, branch.e, branch.u);
      const holdIndex = space.lookup(branch.gradeIndex, branch.e, branch.u);
      return { ...outcome, p: branch.p * outcome.probability, sellIndex, holdIndex,
        saleCash: outcome.effectivePrice === null ? null : outcome.effectivePrice * (1 - cfg.fee) - cfg.itemPrice };
    }),
  })) }));
  const reachableHasSale = rows.some(row => row.branches.some(branch => branch.outcomes.some(o => o.p > 0 && o.saleCash !== null)));
  return { ...space, rows, n, reachableHasSale };
}

function bellman(model, cfg, values, decisions = null) {
  const out = new Float64Array(model.n);
  for (let i = 0; i < model.n; i++) {
    const row = model.rows[i]; let value = -row.cost / cfg.moneyScale;
    for (const branch of row.branches) for (const o of branch.outcomes) if (o.p > 0) {
      const hold = values[o.holdIndex];
      const sell = o.saleCash === null ? -Infinity : o.saleCash / cfg.moneyScale + values[o.sellIndex];
      const action = cfg.autoSell ? (sell > hold + 1e-11 ? 'sell' : 'hold') : (o.saleCash !== null ? 'sell' : 'hold');
      value += o.p * (action === 'sell' ? sell : hold);
      if (decisions) decisions[i].push({ grade: GRADES[branch.gradeIndex], resultGrade: GRADES[branch.gradeIndex],
        sourceGrade: GRADES[row.state.g], sourceStacks: { 에픽: row.state.e, 유니크: row.state.u },
        stacks: { 에픽: branch.e, 유니크: branch.u }, targetId: o.targetId, price: o.effectivePrice, probability: o.p, action });
    }
    out[i] = value;
  }
  return out;
}

// Relative value iteration solves the average-reward Bellman equation without
// enumerating policies or sampling random rolls. State transitions are sparse.
function optimize(cfg, model) {
  const n = model.n, ref = model.initial;
  let h = new Float64Array(n), gain = 0, converged = !cfg.autoSell, residual = cfg.autoSell ? Infinity : 0, iterations = 0;
  const maxIterations = Math.min(30000, Math.max(4000, 120 + 30 * n));
  if (cfg.autoSell) {
    for (let pass = 0; pass < maxIterations; pass++) {
      iterations = pass + 1;
      const bellmanValues = bellman(model, cfg, h), next = new Float64Array(n);
      // Lazy Bellman iteration damps even-period deterministic policy cycles.
      for (let i = 0; i < n; i++) next[i] = (bellmanValues[i] + h[i]) / 2;
      gain = next[ref] - h[ref];
      const base = next[ref];
      residual = 0;
      for (let i = 0; i < n; i++) {
        next[i] -= base;
        residual = Math.max(residual, Math.abs(next[i] - h[i]));
      }
      h = next;
      if (residual < 2e-10) { converged = true; break; }
    }
  }
  const decisions = Array.from({ length: n }, () => []);
  bellman(model, cfg, h, decisions);
  if (!converged) throw new Error('최적 판매 정책 계산이 수렴하지 않았습니다. 천장 스택이나 시세 입력을 줄여 다시 계산해 주세요.');
  const actionSummaries = model.rows.map((row, i) => {
    const total = decisions[i].reduce((sum, d) => sum + d.probability, 0);
    const sellProbability = decisions[i].reduce((sum, d) => sum + (d.action === 'sell' ? d.probability : 0), 0);
    const priceCutoffs = row.branches.map(branch => {
      const first = branch.outcomes.find(o => o.p > 0);
      const threshold = cfg.autoSell && first && cfg.fee < 1
        ? (cfg.itemPrice + (h[first.holdIndex] - h[first.sellIndex]) * cfg.moneyScale) / (1 - cfg.fee)
        : null;
      return { resultGrade: GRADES[branch.gradeIndex], probabilityMass: branch.p,
        sellPriceCutoff: threshold, comparison: threshold === null ? null : '>', registeredPricesOnly: !cfg.autoSell };
    });
    return { grade: GRADES[row.state.g], stacks: { 에픽: row.state.e, 유니크: row.state.u },
      sellProbability, holdProbability: total - sellProbability, priceCutoffs };
  });
  return { h, gain, converged, residual, decisions, actionSummaries, iterations };
}

// With no sellable Legendary result, Legendary is an absorbing no-sale class.
// The state graph then has a grade-ordered structure, so solve its gain/bias
// equations directly instead of forcing the trade cycle and trap to share one
// scalar gain in relative-value iteration.
function optimizeNoLegendSale(cfg, model) {
  const n = model.n, scale = cfg.moneyScale;
  const rawGain = new Float64Array(n), rawBias = new Float64Array(n);
  const index = (g, e, u) => model.lookup(g, e, u);
  const legend = index(2, 0, 0);
  rawGain[legend] = -cfg.costs.레전드리;
  rawBias[legend] = 0;
  const gainTol = 1e-12;
  const gainOrder = (a, b) => {
    const eps = gainTol * Math.max(1, Math.abs(a), Math.abs(b));
    return a > b + eps ? 1 : a < b - eps ? -1 : 0;
  };
  const withCash = (rows) => rows.map(o => ({ ...o, saleCash: o.effectivePrice === null ? null : o.effectivePrice * (1 - cfg.fee) - cfg.itemPrice }));
  const epicRows = withCash(cfg.distributions.에픽), uniqueRows = withCash(cfg.distributions.유니크);
  const mEpic = epicRows.reduce((sum, o) => sum + o.probability * Math.max(0, o.saleCash ?? 0), 0);
  const allUniquePriced = uniqueRows.every(o => o.probability === 0 || o.saleCash !== null);

  let tau = 0, survived = 1;
  for (let e = 0; e <= cfg.pity.에픽; e++) {
    const up = e >= cfg.pity.에픽 ? 1 : cfg.upRates.에픽;
    tau += survived;
    survived *= 1 - up;
  }
  const cycleCash = uniqueRows.reduce((sum, o) => sum + o.probability * (o.saleCash ?? 0), 0);
  const cycleGain = (-cfg.costs.에픽 * tau + mEpic * (tau - 1) + cycleCash) / tau;
  const epicD = (gain) => tau * (-cfg.costs.에픽 - gain) + (tau - 1) * mEpic;

  // Solve z = D + sum p_i max(cash_i + z, 0), the piecewise-linear bias
  // equation for a grade-up outcome when gains tie. Unpriced rows have no
  // sale term and make this root unique unless every row is priced and the
  // trade-cycle gain ties the fallback gain (handled separately).
  function tiedEpicBias(D) {
    const priced = uniqueRows.filter(o => o.probability > 0 && o.saleCash !== null);
    const breaks = [...new Set(priced.map(o => -o.saleCash))].sort((a, b) => a - b);
    let activeMass = 0, activeCash = 0;
    const bounds = [-Infinity, ...breaks, Infinity];
    for (let k = 0; k < bounds.length - 1; k++) {
      const candidate = (D + activeCash) / (1 - activeMass);
      if (candidate >= bounds[k] - 1e-10 && candidate <= bounds[k + 1] + 1e-10) return candidate;
      if (k < breaks.length) {
        for (const o of priced) if (-o.saleCash === breaks[k]) {
          activeMass += o.probability;
          activeCash += o.probability * o.saleCash;
        }
      }
    }
    // Degenerate all-priced/equal-gain case has a continuum of biases. The
    // smallest-price tie is the canonical finite boundary and chooses hold.
    return priced.length ? -Math.min(...priced.map(o => o.saleCash)) : D;
  }

  const epicCap = cfg.pity.에픽, uniqueCap = cfg.pity.유니크;
  let evaluatedStates = 1;
  for (let u = uniqueCap; u >= 0; u--) {
    const uState = index(1, 0, u);
    const upU = u >= uniqueCap ? 1 : cfg.upRates.유니크;
    let uGain = upU * rawGain[legend], uRewardBias = 0;
    const failMass = 1 - upU;
    if (failMass > 0) {
      const eNext = index(0, 0, u + 1), uNext = index(1, 0, u + 1);
      for (const o of uniqueRows) if (o.probability > 0) {
        const sellGain = rawGain[eNext], holdGain = rawGain[uNext];
        const order = o.saleCash === null ? -1 : gainOrder(sellGain, holdGain);
        const sell = order > 0 || (order === 0 && o.saleCash !== null && o.saleCash + rawBias[eNext] > rawBias[uNext] + 1e-10 * scale);
        const next = sell ? eNext : uNext;
        uGain += failMass * o.probability * rawGain[next];
        uRewardBias += failMass * o.probability * ((sell ? o.saleCash : 0) + rawBias[next]);
      }
    }
    rawGain[uState] = uGain;
    rawBias[uState] = -cfg.costs.유니크 - uGain + uRewardBias;
    evaluatedStates++;

    const e0 = index(0, 0, u), compare = allUniquePriced ? gainOrder(cycleGain, uGain) : -1;
    let eGain, eBias;
    if (allUniquePriced && compare > 0) {
      eGain = cycleGain;
      eBias = 0; // normalize this closed trade class at E(0,u)
    } else {
      eGain = uGain;
      const z = tiedEpicBias(epicD(eGain));
      eBias = rawBias[uState] + z;
    }
    rawGain[e0] = eGain;
    rawBias[e0] = eBias;
    evaluatedStates++;

    for (let e = epicCap; e >= 1; e--) {
      const ei = index(0, e, u);
      const nextE = e >= epicCap ? ei : index(0, e + 1, u);
      let upgradeGain = 0, upgradeBias = 0;
      for (const o of uniqueRows) if (o.probability > 0) {
        const sellGain = rawGain[e0], holdIndex = index(1, 0, u), holdGain = rawGain[holdIndex];
        const order = o.saleCash === null ? -1 : gainOrder(sellGain, holdGain);
        const sell = order > 0 || (order === 0 && o.saleCash !== null && o.saleCash + rawBias[e0] > rawBias[holdIndex] + 1e-10 * scale);
        const next = sell ? e0 : holdIndex;
        upgradeGain += o.probability * rawGain[next];
        upgradeBias += o.probability * ((sell ? o.saleCash : 0) + rawBias[next]);
      }
      const epicUp = e >= epicCap ? 1 : cfg.upRates.에픽;
      rawGain[ei] = (1 - epicUp) * rawGain[nextE] + epicUp * upgradeGain;
      rawBias[ei] = -cfg.costs.에픽 - rawGain[ei] + (1 - epicUp) * (mEpic + rawBias[nextE]) + epicUp * upgradeBias;
      evaluatedStates++;
    }
  }

  const decisions = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const row = model.rows[i];
    for (const branch of row.branches) for (const o of branch.outcomes) if (o.p > 0) {
      const sellGain = o.saleCash === null ? -Infinity : rawGain[o.sellIndex];
      const holdGain = rawGain[o.holdIndex];
      const order = gainOrder(sellGain, holdGain);
      const sell = cfg.autoSell && o.saleCash !== null && (order > 0 || (order === 0 && o.saleCash + rawBias[o.sellIndex] > rawBias[o.holdIndex] + 1e-10 * scale));
      decisions[i].push({ grade: GRADES[branch.gradeIndex], resultGrade: GRADES[branch.gradeIndex],
        sourceGrade: GRADES[row.state.g], sourceStacks: { 에픽: row.state.e, 유니크: row.state.u },
        stacks: { 에픽: branch.e, 유니크: branch.u }, targetId: o.targetId, price: o.effectivePrice,
        probability: o.p, action: sell ? 'sell' : 'hold' });
    }
  }

  // Re-evaluate the gain/bias equations from the selected actions. The
  // residual is reported in original currency and guards this specialized path.
  let residual = 0;
  const actionSummaries = model.rows.map((row, i) => {
    const acts = decisions[i]; let cursor = 0, rhs = -row.cost, gainRhs = 0, mass = 0, sellMass = 0;
    const priceCutoffs = row.branches.map(branch => {
      const first = branch.outcomes.find(o => o.p > 0);
      let threshold = null, comparison = null;
      const priced = branch.outcomes.find(o => o.p > 0 && o.saleCash !== null);
      if (cfg.autoSell && (priced || first)) {
        const order = !priced ? -1 : gainOrder(rawGain[priced.sellIndex], rawGain[priced.holdIndex]);
        if (order > 0) comparison = 'always';
        else if (order < 0 && priced) comparison = 'never';
        else if (order === 0 && cfg.fee < 1) {
          threshold = (cfg.itemPrice + rawBias[priced.holdIndex] - rawBias[priced.sellIndex]) / (1 - cfg.fee);
          comparison = '>';
        }
      }
      return { resultGrade: GRADES[branch.gradeIndex], probabilityMass: branch.p,
        sellPriceCutoff: threshold, comparison, registeredPricesOnly: !cfg.autoSell };
    });
    for (const branch of row.branches) for (const o of branch.outcomes) if (o.p > 0) {
      const action = acts[cursor++].action, target = action === 'sell' ? o.sellIndex : o.holdIndex;
      rhs += o.p * ((action === 'sell' ? o.saleCash : 0) + rawBias[target]);
      gainRhs += o.p * rawGain[target];
      mass += o.p; if (action === 'sell') sellMass += o.p;
    }
    const stateResidual = Math.max(Math.abs(rawGain[i] + rawBias[i] - rhs), Math.abs(rawGain[i] - gainRhs));
    residual = Math.max(residual, stateResidual);
    return { grade: GRADES[row.state.g], stacks: { 에픽: row.state.e, 유니크: row.state.u },
      sellProbability: sellMass, holdProbability: mass - sellMass, priceCutoffs };
  });
  if (!Number.isFinite(residual) || residual > 1e-7 * scale) throw new Error('전용 평균 이득 계산 검증을 통과하지 못했습니다. 입력 조건을 확인해 다시 계산해 주세요.');
  return { h: Float64Array.from(rawBias, x => x / scale), gain: rawGain[model.initial] / (2 * scale),
    rawGain, rawBias, converged: true, residual: residual / scale, decisions, actionSummaries,
    iterations: evaluatedStates, exactResidual: residual };
}

function transitionsFor(model, policy) {
  return model.rows.map((row, i) => {
    const acts = policy.decisions[i], trans = new Map(), continuing = new Map(); let revenue = 0, netRevenue = 0, sold = 0, finalGrades = [0, 0, 0];
    let cursor = 0;
    for (const branch of row.branches) for (const o of branch.outcomes) if (o.p > 0) {
      const action = acts[cursor++].action;
      if (action === 'sell') {
        trans.set(o.sellIndex, (trans.get(o.sellIndex) || 0) + o.p);
        revenue += o.p * o.effectivePrice;
        netRevenue += o.p * o.effectivePrice * (1 - model.cfg.fee);
        sold += o.p; finalGrades[branch.gradeIndex] += o.p;
      } else {
        trans.set(o.holdIndex, (trans.get(o.holdIndex) || 0) + o.p);
        continuing.set(o.holdIndex, (continuing.get(o.holdIndex) || 0) + o.p);
      }
    }
    return { transitions: [...trans], continuing: [...continuing], revenue, netRevenue, sold, finalGrades, resetCost: row.cost, grade: row.state.g };
  });
}

function stationary(model, policy, cfg) {
  const chain = transitionsFor(model, policy);
  // Remove self-loop waiting time before finding the recurrent distribution.
  // This makes a 1e-9 sale chance converge as quickly as an ordinary one.
  const jumpEscape = new Float64Array(model.n);
  const jump = chain.map((row, i) => {
    const escape = row.transitions.reduce((sum, [j, p]) => sum + (j === i ? 0 : p), 0);
    jumpEscape[i] = escape;
    return escape > 0 ? row.transitions.filter(([j]) => j !== i).map(([j, p]) => [j, p / escape]) : [[i, 1]];
  });
  let embedded = new Float64Array(model.n); embedded[model.initial] = 1;
  let converged = false;
  for (let pass = 0; pass < 200000; pass++) {
    const next = new Float64Array(model.n);
    for (let i = 0; i < model.n; i++) if (embedded[i]) for (const [j, p] of jump[i]) next[j] += embedded[i] * p;
    // Lazy propagation also converges for deterministic even-period chains.
    for (let i = 0; i < model.n; i++) next[i] = (next[i] + embedded[i]) / 2;
    let diff = 0; for (let i = 0; i < model.n; i++) diff += Math.abs(next[i] - embedded[i]);
    embedded = next;
    if (diff < 2e-13) { converged = true; break; }
  }
  if (!converged) throw new Error('최적 정책의 장기 천장 스택 분포가 수렴하지 않았습니다.');
  let mass = new Float64Array(model.n), norm = 0;
  for (let i = 0; i < model.n; i++) {
    mass[i] = embedded[i] / (jumpEscape[i] > 0 ? jumpEscape[i] : 1);
    norm += mass[i];
  }
  for (let i = 0; i < model.n; i++) mass[i] /= norm;
  let saleRate = 0, revenueRate = 0, netRate = 0, costRate = 0;
  const gradeVisits = [0, 0, 0], soldGrades = [0, 0, 0];
  for (let i = 0; i < model.n; i++) if (mass[i]) {
    const c = chain[i]; saleRate += mass[i] * c.sold; revenueRate += mass[i] * c.revenue;
    netRate += mass[i] * c.netRevenue; costRate += mass[i] * c.resetCost; gradeVisits[c.grade] += mass[i];
    for (let g = 0; g < 3; g++) soldGrades[g] += mass[i] * c.finalGrades[g];
  }
  if (!(saleRate > 0)) return { possible: false, reason: '최적 정책에서는 매물을 판매하지 않아 장기 매물당 지표를 정의할 수 없습니다.', profitPerReset: -costRate };
  const attemptsPerItem = 1 / saleRate;
  return {
    possible: true, saleRate,
    expectedRevenue: revenueRate * attemptsPerItem,
    expectedNetRevenue: netRate * attemptsPerItem,
    expectedCost: costRate * attemptsPerItem,
    expectedAttempts: attemptsPerItem,
    expectedProfit: (netRate - costRate - cfg.itemPrice * saleRate) * attemptsPerItem,
    profitPerReset: netRate - costRate - cfg.itemPrice * saleRate,
    attemptsByGrade: Object.fromEntries(GRADES.map((g, i) => [g, gradeVisits[i] * attemptsPerItem])),
    finalGrades: Object.fromEntries(GRADES.map((g, i) => [g, soldGrades[i] / saleRate])),
  };
}

function transient(model, policy, cfg) {
  const result = Array(model.n);
  // Hold edges either move to a higher grade, a larger ceiling counter, or the
  // single Legend self-loop. Reverse grade/stack order is therefore exact.
  const order = model.states.map((s, i) => ({ s, i })).sort((a, b) => b.s.g - a.s.g || b.s.e - a.s.e || b.s.u - a.s.u);
  for (const { i } of order) {
    const row = model.rows[i], acts = policy.decisions[i]; let attempts = 1, cost = row.cost, gross = 0, net = 0;
    const byGrade = [0, 0, 0], final = [0, 0, 0]; byGrade[row.state.g] = 1;
    let exitMass = 0;
    let cursor = 0;
    for (const branch of row.branches) for (const o of branch.outcomes) if (o.p > 0) {
      const action = acts[cursor++].action;
      if (action === 'sell') {
        exitMass += o.p;
        gross += o.p * o.effectivePrice;
        net += o.p * o.effectivePrice * (1 - cfg.fee);
        final[branch.gradeIndex] += o.p;
      } else if (o.holdIndex === i) {
        // Analytically eliminated below using the directly accumulated exit mass.
      } else {
        exitMass += o.p;
        const next = result[o.holdIndex];
        attempts += o.p * next.attempts; cost += o.p * next.cost;
        gross += o.p * next.gross; net += o.p * next.net;
        for (let g = 0; g < 3; g++) { byGrade[g] += o.p * next.byGrade[g]; final[g] += o.p * next.final[g]; }
      }
    }
    const escape = exitMass;
    if (escape > 0) {
      attempts /= escape; cost /= escape; gross /= escape; net /= escape;
      for (let g = 0; g < 3; g++) { byGrade[g] /= escape; final[g] /= escape; }
      result[i] = { attempts, cost, gross, net, byGrade, final };
    } else result[i] = { attempts: Infinity, cost: Infinity, gross: Infinity, net: Infinity, byGrade: [Infinity, Infinity, Infinity], final: [0, 0, 0] };
  }
  const r = result[model.initial], possible = Number.isFinite(r.attempts);
  return {
    possible, ...(possible ? {} : { reason: '최적 정책에서 첫 판매에 도달하지 않습니다.' }),
    expectedRevenue: r.gross, expectedNetRevenue: r.net,
    expectedCost: r.cost, expectedAttempts: r.attempts,
    expectedProfit: possible ? r.net - r.cost - cfg.itemPrice : -Infinity,
    attemptsByGrade: Object.fromEntries(GRADES.map((g, i) => [g, r.byGrade[i]])),
    finalGrades: Object.fromEntries(GRADES.map((g, i) => [g, r.final[i]])),
  };
}

/** Optimize long-run net profit per reset with exact mutually-exclusive roll probabilities. */
export function solveAdditionalTrade(input) {
  const cfg = prepare(input), model = { ...buildModel(cfg), cfg };
  if (!model.reachableHasSale) {
    return { possible: false, reason: '등록된 가격 조건과 레전드리 하한가로 판매 가능한 결과가 없습니다.', current: null,
      steady: { possible: false, profitPerReset: -Math.min(...Object.values(cfg.costs)) }, decisions: [], limits: ['판매 가능한 결과가 없는 경우'] };
  }
  const noLegendSale = cfg.distributions.레전드리.every(x => x.probability === 0 || x.effectivePrice === null);
  const policy = cfg.autoSell && cfg.startIndex === 0 && noLegendSale
    ? optimizeNoLegendSale(cfg, model)
    : optimize(cfg, model);
  const steady = stationary(model, policy, cfg), current = transient(model, policy, cfg);
  let fallback = null;
  if (!steady.possible && cfg.autoSell) {
    const fallbackCfg = prepare({ ...input, autoSell: false });
    const fallbackModel = { ...buildModel(fallbackCfg), cfg: fallbackCfg };
    const fallbackPolicy = optimize(fallbackCfg, fallbackModel);
    fallback = {
      optimal: false,
      label: '장기 최적 정책은 판매하지 않습니다. 아래 값은 등록된 가격 조건을 모두 판매하는 비교 기준입니다.',
      current: transient(fallbackModel, fallbackPolicy, fallbackCfg),
      steady: stationary(fallbackModel, fallbackPolicy, fallbackCfg),
      decisions: fallbackPolicy.decisions[fallbackModel.initial],
    };
  }
  return {
    possible: current.possible && steady.possible,
    ...(steady.possible ? {} : { reason: steady.reason }),
    current, steady,
    decisions: policy.decisions[model.initial],
    actionSummaries: policy.actionSummaries,
    ...(fallback ? { fallback } : {}),
    profitPerReset: steady.profitPerReset,
    convergence: { converged: policy.converged, residual: policy.residual, iterations: policy.iterations,
      bellmanProfitPerReset: cfg.autoSell ? policy.gain * 2 * cfg.moneyScale : null },
    limits: ['등급별 확률 분포와 천장 스택은 재설정 결과에 따라 갱신합니다.', '판매 후 구매한 교체 장비는 설정한 시작 등급으로 진입하며 천장 스택은 유지합니다.'],
  };
}
