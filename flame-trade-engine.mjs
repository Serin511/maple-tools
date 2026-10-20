/**
 * Trading model for one unworked item: buy it, repeat paid bonus-stat resets
 * and sell it once. Reset outcomes are IID. A meso reset keeps either the
 * previous or the new result, so the item always holds its best result so far.
 * In this infinite-horizon search with recall, the optimal rule only depends
 * on the net sale value of each outcome: sell once that value reaches a
 * reservation level. The candidate policies are therefore the sets of the k
 * most valuable sale classes.
 *
 * Per reset, a policy earns sum(p * (net - itemPrice)) over sold classes minus
 * the reset cost: selling and buying a fresh item continues the same IID
 * search. The rate-optimal policy thus sells every class whose net sale beats
 * the purchase price; the enumeration below also covers the per-item fallback.
 */

const FLOOR_ID = '__floor';
const probabilityTolerance = 1e-15;

function finiteNonnegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number`);
  }
  return value;
}

// P(N >= n) for a geometric number of attempts with success probability q.
function survival(q, n) {
  if (n <= 1) return 1;
  if (q >= 1) return 0;
  return Math.exp((n - 1) * Math.log1p(-q));
}

function policyStats(accepted, { itemPrice, resetCost }) {
  let q = 0, gross = 0, net = 0;
  for (const option of accepted) {
    q += option.p;
    gross += option.p * option.gross;
    net += option.p * option.net;
  }
  const expectedResetCost = resetCost / q;
  const expectedNetRevenue = net / q;
  const expectedProfit = expectedNetRevenue - itemPrice - expectedResetCost;
  const outlay = itemPrice + expectedResetCost;
  return {
    acceptanceProbability: q,
    expectedResets: 1 / q,
    expectedResetCost,
    expectedGrossRevenue: gross / q,
    expectedNetRevenue,
    expectedProfit,
    // The renewal-reward rate: expected profit per item / expected resets.
    profitPerReset: net - q * itemPrice - resetCost,
    profitPer100Eok: outlay > 0 ? expectedProfit / outlay * 100e8 : null,
    breakevenItemPrice: (net - resetCost) / q,
  };
}

/** Smallest attempt count n with P(N <= n) >= alpha. */
export function resetQuantile(q, alpha) {
  if (!(q > 0) || q > 1) throw new RangeError('q must be in (0, 1]');
  if (q === 1) return 1;
  return Math.max(1, Math.ceil(Math.log1p(-alpha) / Math.log1p(-q) - 1e-9));
}

/**
 * Exact profit quantile for profit = sale - itemPrice - resetCost * N, where
 * the sale class and the geometric attempt count N are independent.
 */
export function profitQuantile(accepted, { itemPrice, resetCost }, alpha) {
  const q = accepted.reduce((sum, option) => sum + option.p, 0);
  const weights = accepted.map(option => ({ value: option.net - itemPrice, w: option.p / q }))
    .sort((a, b) => a.value - b.value);
  if (resetCost === 0 || q >= 1) {
    // The attempt count is constant (or free), so only the sale class varies.
    const fixed = q >= 1 ? resetCost : 0;
    let cumulative = 0;
    for (const { value, w } of weights) {
      cumulative += w;
      if (cumulative >= alpha - 1e-12) return value - fixed;
    }
    return weights.at(-1).value - fixed;
  }
  const cdf = z => weights.reduce((sum, { value, w }) => sum + w * survival(q, Math.ceil((value - z) / resetCost - 1e-9)), 0);
  const spread = Math.ceil(Math.log(alpha) / Math.log1p(-q)) + 2;
  let low = weights[0].value - resetCost * Math.max(spread, 2);
  let high = weights.at(-1).value - resetCost;
  for (let iteration = 0; iteration < 200 && high - low > 1e-6 * resetCost; iteration++) {
    const middle = (low + high) / 2;
    if (cdf(middle) >= alpha) high = middle;
    else low = middle;
  }
  // Snap to the largest attainable profit that is not above the bracket.
  let best = -Infinity;
  for (const { value } of weights) {
    const attempts = Math.max(1, Math.ceil((value - high) / resetCost - 1e-9));
    best = Math.max(best, value - resetCost * attempts);
  }
  return best;
}

/** Probability that the profit from one item is strictly negative. */
export function lossProbability(accepted, { itemPrice, resetCost }) {
  const q = accepted.reduce((sum, option) => sum + option.p, 0);
  return accepted.reduce((sum, option) => {
    const margin = option.net - itemPrice;
    if (q >= 1) return sum + (margin - resetCost < 0 ? option.p / q : 0);
    if (resetCost === 0) return sum + (margin < 0 ? option.p / q : 0);
    // Profit becomes negative once N exceeds floor(margin / resetCost).
    const affordable = Math.floor(margin / resetCost + 1e-9);
    return sum + option.p / q * survival(q, Math.max(0, affordable) + 1);
  }, 0);
}

/**
 * bands: priced outcomes [{ id, price, p }] in gross meso; unpricedProbability:
 * the mass below every price threshold. With autoSell, a positive floorPrice
 * is the minimum sale price of every result and the policy maximizes profit
 * per reset, falling back to profit per item when no policy is profitable.
 * Without autoSell, every priced result is sold at its own price.
 */
export function solveFlameTrade({ bands, unpricedProbability = 0, fee, floorPrice = 0, itemPrice, resetCost, autoSell }) {
  if (!Array.isArray(bands)) throw new TypeError('bands must be an array');
  finiteNonnegative(fee, 'fee');
  if (fee > 100) throw new RangeError('fee must not exceed 100');
  finiteNonnegative(floorPrice, 'floorPrice');
  finiteNonnegative(itemPrice, 'itemPrice');
  finiteNonnegative(resetCost, 'resetCost');
  finiteNonnegative(unpricedProbability, 'unpricedProbability');
  const feeMul = 1 - fee / 100;
  const costs = { itemPrice, resetCost };

  const options = [];
  for (const band of bands) {
    finiteNonnegative(band.price, 'band.price');
    finiteNonnegative(band.p, 'band.p');
    if (band.p <= probabilityTolerance) continue;
    const atFloor = autoSell && floorPrice > band.price;
    const gross = atFloor ? floorPrice : band.price;
    options.push({ id: band.id, p: band.p, gross, net: gross * feeMul, atFloor });
  }
  const hasPricedResult = options.length > 0;
  if (autoSell && floorPrice > 0 && unpricedProbability > probabilityTolerance) {
    options.push({ id: FLOOR_ID, p: unpricedProbability, gross: floorPrice, net: floorPrice * feeMul, atFloor: true });
  }
  if (!options.length) {
    return {
      possible: false,
      reason: autoSell ? '판매 조건에 도달할 수 있는 결과가 없고 처분가도 없어 매물을 판매할 수 없습니다.'
        : '입력한 판매 조건에 도달할 수 있는 결과가 없습니다.',
    };
  }

  // Equal net values are always accepted together.
  const groups = [];
  for (const option of [...options].sort((a, b) => b.net - a.net)) {
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.net - option.net) <= 1e-9 * Math.max(1, option.net)) previous.options.push(option);
    else groups.push({ net: option.net, options: [option] });
  }
  const candidates = groups.map((group, index) => {
    const accepted = groups.slice(0, index + 1).flatMap(item => item.options);
    return { accepted, minimumNet: group.net, ...policyStats(accepted, costs) };
  });

  let chosen;
  let objective;
  if (!autoSell) {
    chosen = { accepted: options, minimumNet: groups.at(-1).net, ...policyStats(options, costs) };
    objective = 'manual';
  } else {
    // Ties keep the earlier, smaller acceptance set.
    const better = (key, a, b) => a[key] > b[key] + 1e-9 * Math.max(1, Math.abs(b[key]));
    const bestRate = candidates.reduce((best, candidate) => better('profitPerReset', candidate, best) ? candidate : best);
    if (bestRate.profitPerReset > 0) {
      chosen = bestRate;
      objective = 'per-reset';
    } else {
      chosen = candidates.reduce((best, candidate) => better('expectedProfit', candidate, best) ? candidate : best);
      objective = 'per-item';
    }
  }

  const accepted = chosen.accepted;
  const acceptedIds = accepted.map(option => option.id);
  const q = chosen.acceptanceProbability;
  return {
    possible: true,
    autoSell,
    objective,
    hasPricedResult,
    acceptedIds,
    sellsFloor: acceptedIds.includes(FLOOR_ID),
    minimumNetSale: chosen.minimumNet,
    metrics: {
      acceptanceProbability: q,
      expectedResets: chosen.expectedResets,
      expectedResetCost: chosen.expectedResetCost,
      expectedGrossRevenue: chosen.expectedGrossRevenue,
      expectedNetRevenue: chosen.expectedNetRevenue,
      expectedProfit: chosen.expectedProfit,
      profitPerReset: chosen.profitPerReset,
      profitPer100Eok: chosen.profitPer100Eok,
      // The highest item price at which some allowed policy breaks even.
      breakevenItemPrice: autoSell ? Math.max(...candidates.map(candidate => candidate.breakevenItemPrice)) : chosen.breakevenItemPrice,
    },
    sales: accepted.map(option => ({ id: option.id, gross: option.gross, net: option.net, atFloor: option.atFloor, share: option.p / q })),
    risk: {
      profit: Object.fromEntries([['p10', 0.1], ['p50', 0.5], ['p90', 0.9]].map(([key, alpha]) => [key, profitQuantile(accepted, costs, alpha)])),
      lossProbability: lossProbability(accepted, costs),
      resets: Object.fromEntries([['p50', 0.5], ['p90', 0.9], ['p99', 0.99]].map(([key, alpha]) => [key, resetQuantile(Math.min(1, q), alpha)])),
    },
    candidates: candidates.map(({ accepted: set, ...candidate }) => ({ ...candidate, acceptedIds: set.map(option => option.id) })),
  };
}

export { FLOOR_ID as FLAME_TRADE_FLOOR_ID };