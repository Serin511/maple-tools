// Eliminate an absorbing Prime session, then solve the grade/pity Bellman
// equations backwards. The root uses profit per *all* resets, not per entry.
const GRADES = ['에픽', '유니크', '레전드리'];
const tolerance = (scale) => 2e-11 * Math.max(1, scale);

function effectivePrice(cfg, price) {
  return cfg.autoSell ? (price === null ? (cfg.floorPrice > 0 ? cfg.floorPrice : null) : Math.max(price, cfg.floorPrice ?? 0))
    : (price ?? (!cfg.legendHasPrice && cfg.floorPrice > 0 ? cfg.floorPrice : null));
}

export function prepareAdditionalTradePrime(cfg, prime, option) {
  if (!option || typeof option.key !== 'string' || !Array.isArray(option.distribution) || !option.distribution.length) throw new Error('프라임 고정 옵션별 확률이 없습니다.');
  let mass = 0;
  const probabilities = new Map();
  for (const row of option.distribution) {
    if (typeof row.probability !== 'number' || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1
      || (row.price !== null && (typeof row.price !== 'number' || !Number.isFinite(row.price) || row.price < 0))) throw new Error('프라임 판매가·확률을 확인해 주세요.');
    mass += row.probability;
    const price = effectivePrice(cfg, row.price);
    probabilities.set(price, (probabilities.get(price) ?? 0) + row.probability);
  }
  if (Math.abs(mass - 1) > 1e-7) throw new Error('프라임 확률의 합이 1이어야 합니다.');
  const priceSet = new Set([...probabilities.keys(), ...cfg.distributions.레전드리.map(row => row.effectivePrice)]);
  const prices = [...priceSet].sort((a, b) => (a ?? -Infinity) - (b ?? -Infinity));
  return { key: option.key, label: option.label ?? option.key, cost: prime.cost,
    prices, probability: prices.map(price => (probabilities.get(price) ?? 0) / mass),
    index: new Map(prices.map((price, i) => [price, i])),
    eligible: cfg.distributions.레전드리.some(row => row.firstKey === option.key && row.probability > 0),
    sellable: prices.some((price, i) => price !== null && (probabilities.get(price) ?? 0) > 0),
  };
}

function primeSession(cfg, prime, gain) {
  const costWithGain = prime.cost + gain;
  if (cfg.autoSell && costWithGain < -tolerance(cfg.moneyScale)) return null;
  const values = new Float64Array(prime.prices.length), summaries = Array(prime.prices.length);
  let improveMass = 0, improveValue = 0, improveAttempts = 0, improveGross = 0;
  for (let i = prime.prices.length - 1; i >= 0; i--) {
    const price = prime.prices[i], sale = price === null ? -Infinity : price * (1 - cfg.fee) - cfg.itemPrice;
    const continuation = improveMass > 0 ? (-(cfg.autoSell ? Math.max(0, costWithGain) : costWithGain) + improveValue) / improveMass : -Infinity;
    // Whole old/new triplets are compared by their resulting sale value. The
    // first line stays fixed and future draws have the same distribution.
    const stop = (!cfg.autoSell && price !== null) || sale >= continuation - tolerance(cfg.moneyScale);
    values[i] = stop ? sale : continuation;
    const attempts = stop ? 0 : (1 + improveAttempts) / improveMass;
    const gross = stop ? price : improveGross / improveMass;
    summaries[i] = { attempts, cost: attempts * prime.cost, revenue: gross, netRevenue: gross * (1 - cfg.fee), stop };
    const probability = prime.probability[i];
    if (probability > 0 && Number.isFinite(values[i])) {
      improveMass += probability; improveValue += probability * values[i];
      improveAttempts += probability * attempts; improveGross += probability * gross;
    }
  }
  return { values, summaries };
}

// Solve x = D + E[max(cash + x, 0)]. Used for a complete Epic grade-up
// cycle returning to the same Epic state after selling a Unique result.
function epicRelativeBias(D, rows, automatic) {
  const priced = rows.filter(row => row.probability > 0 && row.cash !== null);
  let activeMass = 0, activeCash = 0;
  if (!automatic) {
    for (const row of priced) { activeMass += row.probability; activeCash += row.probability * row.cash; }
    return activeMass < 1 - 1e-14 ? (D + activeCash) / (1 - activeMass) : null;
  }
  const breaks = [...new Set(priced.map(row => -row.cash))].sort((a, b) => a - b);
  const bounds = [-Infinity, ...breaks, Infinity];
  for (let k = 0; k < bounds.length - 1; k++) {
    if (activeMass < 1 - 1e-14) {
      const candidate = (D + activeCash) / (1 - activeMass);
      if (candidate >= bounds[k] - 1e-8 && candidate <= bounds[k + 1] + 1e-8) return candidate;
    }
    if (k < breaks.length) for (const row of priced) if (-row.cash === breaks[k]) {
      activeMass += row.probability; activeCash += row.probability * row.cash;
    }
  }
  return null; // g is at/below the gain of a closed Epic sale class.
}

// Solve the Legendary self-loop exactly by eliminating hold probability.
function legendaryBias(cfg, events, gain) {
  let mandatoryMass = 0, mandatoryValue = 0;
  const optional = [];
  for (const event of events) {
    if (event.mandatory) { mandatoryMass += event.probability; mandatoryValue += event.probability * event.value; }
    else if (Number.isFinite(event.value)) optional.push(event);
  }
  optional.sort((a, b) => b.value - a.value);
  let activeMass = mandatoryMass, activeValue = mandatoryValue;
  for (let k = 0; k <= optional.length; k++) {
    const upper = k === 0 ? Infinity : optional[k - 1].value;
    const lower = k === optional.length ? -Infinity : optional[k].value;
    if (activeMass > 0) {
      const candidate = (activeValue - cfg.costs.레전드리 - gain) / activeMass;
      if (candidate <= upper + tolerance(cfg.moneyScale) && candidate >= lower - tolerance(cfg.moneyScale)) return candidate;
    }
    if (k < optional.length) { activeMass += optional[k].probability; activeValue += optional[k].probability * optional[k].value; }
  }
  return null;
}

function evaluate(cfg, prime, gain) {
  const session = primeSession(cfg, prime, gain);
  if (!session) return null;
  const cash = (row) => row.effectivePrice === null ? null : row.effectivePrice * (1 - cfg.fee) - cfg.itemPrice;
  const legendEvents = cfg.distributions.레전드리.map(row => ({ probability: row.probability,
    value: Math.max(cash(row) ?? -Infinity, row.firstKey === prime.key && (cfg.autoSell || cash(row) === null) ? session.values[prime.index.get(row.effectivePrice)] : -Infinity),
    mandatory: !cfg.autoSell && cash(row) !== null,
  }));
  const hLegend = legendaryBias(cfg, legendEvents, gain);
  if (hLegend === null || !Number.isFinite(hLegend)) return null;
  const legendExpectation = hLegend + cfg.costs.레전드리 + gain;
  const unique = (cfg.distributions.유니크 ?? []).map(row => ({ ...row, cash: cash(row) }));
  let tau = 0, survived = 1;
  if (cfg.startIndex === 0) for (let e = 0; e <= cfg.pity.에픽; e++) {
    tau += survived;
    survived *= 1 - (e >= cfg.pity.에픽 ? 1 : cfg.upRates.에픽);
  }
  const epicCash = (cfg.distributions.에픽 ?? []).reduce((sum, row) => sum + row.probability * (cfg.autoSell ? Math.max(0, cash(row) ?? 0) : (cash(row) ?? 0)), 0);
  const z = cfg.startIndex === 0 ? epicRelativeBias(tau * (-cfg.costs.에픽 - gain) + (tau - 1) * epicCash, unique, cfg.autoSell) : 0;
  if (z === null) return null;
  const uniqueCash = unique.reduce((sum, row) => sum + row.probability * (cfg.autoSell ? Math.max(0, (row.cash ?? -Infinity) + z) : (row.cash === null ? 0 : row.cash + z)), 0);
  const hUnique = new Float64Array((cfg.pity.유니크 ?? 0) + 1);
  if (cfg.startIndex <= 1) for (let u = cfg.pity.유니크; u >= 0; u--) {
    const up = u >= cfg.pity.유니크 ? 1 : cfg.upRates.유니크;
    hUnique[u] = -cfg.costs.유니크 - gain + up * legendExpectation + (up < 1 ? (1 - up) * (hUnique[u + 1] + uniqueCash) : 0);
  }
  const residual = cfg.startIndex === 2 ? hLegend : hUnique[0] + (cfg.startIndex === 0 ? z : 0);
  return { residual, gain, session, hLegend, hUnique, z, uniqueCash, epicCash };
}

/** Returns null when the optional Prime entry cannot improve the baseline. */
export function optimizeAdditionalTradePrime(cfg, model, prime, baselineGain) {
  if (!prime.eligible || !prime.sellable) return null;
  const eps = tolerance(Math.max(cfg.moneyScale, prime.cost, Math.abs(baselineGain)));
  let low = cfg.autoSell ? Math.max(baselineGain, -prime.cost) : baselineGain;
  let high = Math.max(low + cfg.moneyScale, ...prime.prices.filter(price => price !== null));
  const lowEvaluation = evaluate(cfg, prime, low + eps);
  if (!lowEvaluation || lowEvaluation.residual <= eps) return null;
  let highEvaluation = evaluate(cfg, prime, high);
  for (let pass = 0; (!highEvaluation || highEvaluation.residual > 0) && pass < 64; pass++) {
    high = high * 2 + cfg.moneyScale;
    highEvaluation = evaluate(cfg, prime, high);
  }
  if (!highEvaluation || highEvaluation.residual > 0) throw new Error('프라임 장기 기대 이득의 상한을 찾지 못했습니다.');
  let iterations = 0;
  for (; iterations < 90; iterations++) {
    const middle = low + (high - low) / 2, evaluation = evaluate(cfg, prime, middle);
    if (!evaluation) throw new Error('프라임 최적 정책의 유한 판매 상태를 계산하지 못했습니다.');
    if (evaluation.residual > 0) low = middle; else high = middle;
    if (high - low <= eps) break;
  }
  const solved = evaluate(cfg, prime, (low + high) / 2);
  if (!solved || iterations >= 90) throw new Error('프라임 장기 최적 정책 계산이 수렴하지 않았습니다.');
  const { gain, session, hLegend, hUnique, z, uniqueCash, epicCash } = solved;
  const h = new Float64Array(model.n);
  const tauByStack = new Float64Array((cfg.pity.에픽 ?? 0) + 1);
  if (cfg.startIndex === 0) for (let e = cfg.pity.에픽; e >= 0; e--) {
    const up = e >= cfg.pity.에픽 ? 1 : cfg.upRates.에픽;
    tauByStack[e] = 1 + (up < 1 ? (1 - up) * tauByStack[e + 1] : 0);
  }
  for (let i = 0; i < model.n; i++) {
    const { g, e, u } = model.states[i];
    const bias = g === 2 ? hLegend : g === 1 ? hUnique[u]
      : tauByStack[e] * (-cfg.costs.에픽 - gain) + (tauByStack[e] - 1) * epicCash + hUnique[u] + uniqueCash;
    h[i] = bias / cfg.moneyScale;
  }
  const decisions = Array.from({ length: model.n }, () => []), actionSummaries = [];
  let exactResidual = 0;
  for (let i = 0; i < model.n; i++) {
    const row = model.rows[i]; let rhs = -row.cost - gain, sellMass = 0, holdMass = 0, primeMass = 0;
    for (const branch of row.branches) for (const o of branch.outcomes) if (o.p > 0) {
      const hold = h[o.holdIndex] * cfg.moneyScale;
      const sell = o.saleCash === null ? -Infinity : o.saleCash + h[o.sellIndex] * cfg.moneyScale;
      const primeIndex = prime.index.get(o.effectivePrice);
      const primeValue = branch.gradeIndex === 2 && o.firstKey === prime.key && (cfg.autoSell || o.saleCash === null) ? session.values[primeIndex] + h[o.sellIndex] * cfg.moneyScale : -Infinity;
      let action = cfg.autoSell ? (sell > hold + eps ? 'sell' : 'hold') : (o.saleCash !== null ? 'sell' : 'hold');
      let value = action === 'sell' ? sell : hold;
      if (primeValue > value + eps && session.summaries[primeIndex].attempts > 0) { action = 'prime'; value = primeValue; }
      rhs += o.p * value;
      if (action === 'hold') holdMass += o.p;
      else { sellMass += o.p; if (action === 'prime') primeMass += o.p; }
      decisions[i].push({ grade: GRADES[branch.gradeIndex], resultGrade: GRADES[branch.gradeIndex],
        sourceGrade: GRADES[row.state.g], sourceStacks: { 에픽: row.state.e, 유니크: row.state.u },
        stacks: { 에픽: branch.e, 유니크: branch.u }, targetId: o.targetId, price: o.effectivePrice,
        firstKey: o.firstKey, probability: o.p, action,
        ...(action === 'prime' ? { prime: session.summaries[primeIndex], fixedKey: prime.key } : {}),
      });
    }
    exactResidual = Math.max(exactResidual, Math.abs(h[i] * cfg.moneyScale - rhs));
    actionSummaries.push({ grade: GRADES[row.state.g], stacks: { 에픽: row.state.e, 유니크: row.state.u },
      sellProbability: sellMass, holdProbability: holdMass, primeProbability: primeMass,
      priceCutoffs: row.branches.map(branch => {
        const first = branch.outcomes.find(o => o.p > 0);
        return { resultGrade: GRADES[branch.gradeIndex], probabilityMass: branch.p,
          sellPriceCutoff: cfg.autoSell && first && cfg.fee < 1 ? (cfg.itemPrice + (h[first.holdIndex] - h[first.sellIndex]) * cfg.moneyScale) / (1 - cfg.fee) : null,
          comparison: cfg.autoSell && cfg.fee < 1 ? '>' : null, registeredPricesOnly: !cfg.autoSell };
      }),
    });
  }
  if (!Number.isFinite(exactResidual) || exactResidual > 1e-7 * Math.max(cfg.moneyScale, Math.abs(gain))) throw new Error('프라임 최적 정책의 평균 이득 검증을 통과하지 못했습니다.');
  return { h, gain: gain / (2 * cfg.moneyScale), converged: true, residual: exactResidual / cfg.moneyScale,
    iterations, exactResidual, decisions, actionSummaries };
}
