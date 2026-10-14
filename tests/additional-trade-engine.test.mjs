import test from 'node:test';
import assert from 'node:assert/strict';
import { solveAdditionalTrade } from '../additional-trade-engine.mjs';

const dist = (...rows) => rows.map(([price, probability = 1, targetId = null]) => ({ price, probability, targetId }));
const close = (actual, expected, tol = 1e-8) => assert.ok(Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
function cfg(overrides = {}) {
  return {
    startGrade: '레전드리', distributions: { 레전드리: dist([10, 1, 'sell']) },
    itemPrice: 2, fee: 0, floorPrice: 0, costs: { 레전드리: 1 },
    upRates: {}, pity: {}, stacks: {}, miracle: false, autoSell: false,
    ...overrides,
  };
}

test('geometric Legendary sales report exact current item and long-run metrics', () => {
  const result = solveAdditionalTrade(cfg({ distributions: { 레전드리: dist([8, .25, 'a'], [null, .75, null]) }, costs: { 레전드리: 3 } }));
  assert.equal(result.possible, true);
  close(result.current.expectedAttempts, 4);
  close(result.current.expectedCost, 12);
  close(result.current.expectedRevenue, 8);
  close(result.current.expectedNetRevenue, 8);
  close(result.current.expectedProfit, -6); // sale proceeds less resets and first purchase
  close(result.steady.expectedAttempts, 4);
  close(result.steady.expectedProfit, -6);
  close(result.steady.profitPerReset, -1.5);
  close(result.current.finalGrades.레전드리, 1);
});

test('Legendary cutoff is optimal and agrees with exhaustive one-state policy oracle', () => {
  const prices = [1, 8], probabilities = [.4, .6], itemPrice = 2, fee = 10, cost = 3;
  const result = solveAdditionalTrade(cfg({
    itemPrice, fee, costs: { 레전드리: cost }, autoSell: true,
    distributions: { 레전드리: dist([prices[0], probabilities[0], 'low'], [prices[1], probabilities[1], 'high']) },
  }));
  // Enumerate the four possible fixed sell/hold policies. Every reset returns
  // to the same state, so the ratio for a policy is its one-step reward.
  let oracle = -Infinity;
  for (let mask = 0; mask < 4; mask++) {
    let reward = -cost;
    for (let i = 0; i < 2; i++) if (mask & (1 << i)) reward += probabilities[i] * (prices[i] * (1 - fee / 100) - itemPrice);
    oracle = Math.max(oracle, reward);
  }
  close(result.steady.profitPerReset, oracle);
  close(result.convergence.bellmanProfitPerReset, oracle);
  assert.deepEqual(result.decisions.map(d => d.action), ['hold', 'sell']);
});

test('low-pity Unique optimizer matches exhaustive stationary-policy enumeration', () => {
  const input = {
    startGrade: '유니크', itemPrice: 1, fee: 0, floorPrice: null, autoSell: true,
    distributions: {
      유니크: dist([4, .5, 'u'], [null, .5, null]),
      레전드리: dist([10, .5, 'l'], [null, .5, null]),
    }, costs: { 유니크: 1, 레전드리: 2 }, upRates: { 유니크: 0 }, pity: { 유니크: 1 }, stacks: { 유니크: 0 },
  };
  const actual = solveAdditionalTrade(input).steady.profitPerReset;
  let oracle = -Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const P = Array.from({ length: 3 }, () => [0, 0, 0]), R = [0, 0, 0];
    const branches = [
      { grade: '유니크', cost: 1, outcomes: input.distributions.유니크, next: 1, sellTo: 1 },
      { grade: '레전드리', cost: 1, outcomes: input.distributions.레전드리, next: 2, sellTo: 0 },
      { grade: '레전드리', cost: 2, outcomes: input.distributions.레전드리, next: 2, sellTo: 0 },
    ];
    for (let s = 0; s < 3; s++) {
      const row = branches[s]; R[s] = -row.cost;
      for (let k = 0; k < row.outcomes.length; k++) {
        const outcome = row.outcomes[k], bit = s;
        const sell = outcome.price !== null && !!(mask & (1 << bit));
        if (sell) { P[s][row.sellTo] += outcome.probability; R[s] += outcome.probability * (outcome.price - input.itemPrice); }
        else P[s][row.next] += outcome.probability;
      }
    }
    let pi = [1, 0, 0];
    for (let pass = 0; pass < 10000; pass++) {
      const next = [0, 0, 0];
      for (let s = 0; s < 3; s++) for (let j = 0; j < 3; j++) next[j] += pi[s] * P[s][j];
      const lazy = next.map((x, i) => (x + pi[i]) / 2);
      if (lazy.reduce((sum, x, i) => sum + Math.abs(x - pi[i]), 0) < 1e-14) { pi = lazy; break; }
      pi = lazy;
    }
    oracle = Math.max(oracle, pi.reduce((sum, p, s) => sum + p * R[s], 0));
  }
  close(actual, oracle);
});

test('rare Legendary sale probabilities use the exact geometric expectation', () => {
  const result = solveAdditionalTrade(cfg({ itemPrice: 0, costs: { 레전드리: 1 }, autoSell: true,
    distributions: { 레전드리: dist([100, .000001, 'rare'], [null, .999999, null]) } }));
  close(result.current.expectedAttempts, 1_000_000, 1e-9);
  close(result.current.expectedCost, 1_000_000, 1e-9);
  close(result.steady.expectedAttempts, 1_000_000, 1e-9);
  close(result.current.finalGrades.레전드리, 1, 1e-9);
  const rarer = solveAdditionalTrade(cfg({ itemPrice: 0, costs: { 레전드리: 1 }, autoSell: true,
    distributions: { 레전드리: dist([100, 1e-12, 'rarer'], [null, 1 - 1e-12, null]) } }));
  close(rarer.current.expectedAttempts, 1e12, 1e-9);
});

test('deterministic pity cycles converge under optimal sales', () => {
  const result = solveAdditionalTrade({
    startGrade: '에픽', itemPrice: 0, fee: 0, floorPrice: null, autoSell: true,
    distributions: { 에픽: dist([100, 1, 'e']), 유니크: dist([100, 1, 'u']), 레전드리: dist([100, 1, 'l']) },
    costs: { 에픽: 1, 유니크: 1, 레전드리: 1 }, upRates: { 에픽: 0, 유니크: 0 },
    pity: { 에픽: 1, 유니크: 1 }, stacks: { 에픽: 0, 유니크: 0 },
  });
  assert.equal(result.convergence.converged, true);
  close(result.steady.profitPerReset, 99);
  close(result.steady.attemptsByGrade.에픽, 1);
  close(result.steady.attemptsByGrade.유니크, 0);
  close(result.steady.finalGrades.에픽, .5);
  close(result.steady.finalGrades.유니크, .5);
});

test('zero-pity Epic seller separates the profitable trade class from the Legendary no-sale trap', () => {
  const result = solveAdditionalTrade({
    startGrade: '에픽', itemPrice: 3, fee: 0, floorPrice: null, autoSell: true,
    distributions: { 에픽: dist([10]), 유니크: dist([20]), 레전드리: dist([null]) },
    costs: { 에픽: 1, 유니크: 2, 레전드리: 3 }, upRates: { 에픽: 0, 유니크: 0 },
    pity: { 에픽: 0, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
  });
  assert.equal(result.convergence.converged, true);
  close(result.steady.profitPerReset, 16);
  close(result.convergence.bellmanProfitPerReset, 16);
  assert.equal(result.decisions[0].action, 'sell');
  assert.equal(result.actionSummaries[0].priceCutoffs[0].comparison, 'always');
  assert.equal(result.actionSummaries[0].priceCutoffs[0].sellPriceCutoff, null);
  close(result.convergence.residual, 0);
});

test('gain priority sells a loss-making row when it avoids a worse Legendary trap', () => {
  const result = solveAdditionalTrade({
    startGrade: '에픽', itemPrice: 100, fee: 0, floorPrice: null, autoSell: true,
    distributions: { 에픽: dist([null]), 유니크: dist([1]), 레전드리: dist([null]) },
    costs: { 에픽: 1, 유니크: 2, 레전드리: 1000 }, upRates: { 에픽: 0, 유니크: 0 },
    pity: { 에픽: 0, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
  });
  assert.equal(result.decisions[0].action, 'sell');
  assert.equal(result.actionSummaries[0].priceCutoffs[0].comparison, 'always');
  close(result.steady.profitPerReset, -100);
});

test('zero-probability unpriced Unique rows do not disable the closed Epic sale cycle', () => {
  const result = solveAdditionalTrade({
    startGrade: '에픽', itemPrice: 3, fee: 0, floorPrice: null, autoSell: true,
    distributions: { 에픽: dist([null]), 유니크: dist([20, 1, 'priced'], [null, 0]), 레전드리: dist([null]) },
    costs: { 에픽: 1, 유니크: 2, 레전드리: 3 }, upRates: { 에픽: 0, 유니크: 0 },
    pity: { 에픽: 0, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
  });
  close(result.steady.profitPerReset, 16);
  assert.equal(result.decisions[0].action, 'sell');
});

test('Legendary floor is an unmatched-roll fallback for autoSell and manual fallback only without priced rows', () => {
  const distribution = { 레전드리: dist([5, .5, 'target'], [null, .5, null]) };
  const optimal = solveAdditionalTrade(cfg({ floorPrice: 8, autoSell: true, distributions: distribution }));
  assert.deepEqual(optimal.decisions.map(d => d.price), [8, 8]);
  const manual = solveAdditionalTrade(cfg({ floorPrice: 8, autoSell: false, distributions: distribution }));
  assert.deepEqual(manual.decisions.map(d => d.price), [5, null]);
  assert.equal(manual.convergence.iterations, 0);
});

test('promotion pays the pre-reset grade and draws options from the promoted grade', () => {
  const result = solveAdditionalTrade({
    startGrade: '에픽', itemPrice: 1, fee: 0, floorPrice: 0, miracle: false, autoSell: false,
    distributions: { 에픽: dist([null]), 유니크: dist([null]), 레전드리: dist([9, 1, 'legend']) },
    costs: { 에픽: 2, 유니크: 5, 레전드리: 7 },
    upRates: { 에픽: 1, 유니크: 1 }, pity: { 에픽: 0, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
  });
  close(result.current.expectedAttempts, 2);
  close(result.current.expectedCost, 7);
  close(result.current.expectedRevenue, 9);
  close(result.current.expectedProfit, 1);
  close(result.current.attemptsByGrade.에픽, 1);
  close(result.current.attemptsByGrade.유니크, 1);
  close(result.current.attemptsByGrade.레전드리, 0);
});

test('failure stacks survive sale and successful promotion clears only the tier upgraded', () => {
  const result = solveAdditionalTrade({
    startGrade: '에픽', itemPrice: 0, fee: 0, floorPrice: 0, miracle: false, autoSell: false,
    distributions: { 에픽: dist([2, 1, 'epic']), 유니크: dist([null]), 레전드리: dist([5, 1, 'legend']) },
    costs: { 에픽: 1, 유니크: 1, 레전드리: 1 },
    upRates: { 에픽: 0, 유니크: 0 }, pity: { 에픽: 1, 유니크: 1 }, stacks: { 에픽: 0, 유니크: 0 },
  });
  // First Epic reset fails and sells at stack 1. Re-entry keeps that stack,
  // so the next Epic attempt is forced to upgrade and clears Epic's counter.
  close(result.current.expectedAttempts, 1);
  assert.ok(result.decisions.some(d => d.grade === '에픽' && d.stacks.에픽 === 1 && d.action === 'sell'));
  assert.ok(result.actionSummaries.some(d => d.grade === '유니크' && d.stacks.에픽 === 0 && d.holdProbability > 0));
});

test('Miracle Day doubles ordinary upgrade chance but does not change pity cap', () => {
  const base = {
    startGrade: '에픽', itemPrice: 0, fee: 0, floorPrice: 0, autoSell: false,
    distributions: { 에픽: dist([null]), 유니크: dist([null]), 레전드리: dist([4, 1, 'legend']) },
    costs: { 에픽: 1, 유니크: 1, 레전드리: 1 }, upRates: { 에픽: .25, 유니크: 1 },
    pity: { 에픽: 2, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
  };
  const normal = solveAdditionalTrade(base), miracle = solveAdditionalTrade({ ...base, miracle: true });
  close(normal.current.attemptsByGrade.에픽, 1 + .75 + .75 ** 2);
  close(miracle.current.attemptsByGrade.에픽, 1 + .5 + .5 ** 2);
  const forced = solveAdditionalTrade({ ...base, stacks: { 에픽: 2, 유니크: 0 } });
  close(forced.current.attemptsByGrade.에픽, 1);
});

test('all-no-sale distributions and policies that rationally never sell remain explicit', () => {
  const impossible = solveAdditionalTrade(cfg({ floorPrice: null, distributions: { 레전드리: dist([null]) } }));
  assert.equal(impossible.possible, false);
  assert.match(impossible.reason, /판매 가능한 결과/);

  const negative = solveAdditionalTrade(cfg({ itemPrice: 20, costs: { 레전드리: 3 }, autoSell: true,
    distributions: { 레전드리: dist([1, 1, 'loss']) } }));
  assert.equal(negative.steady.possible, false);
  assert.equal(negative.current.possible, false);
  assert.match(negative.reason, /판매하지 않아/);
  assert.equal(negative.fallback.optimal, false);
  assert.ok(Number.isFinite(negative.fallback.steady.profitPerReset));
});

test('starting at Unique or Legendary validates and uses only reachable grades', () => {
  const unique = solveAdditionalTrade({
    startGrade: '유니크', itemPrice: 1, fee: 0, floorPrice: 0, autoSell: false,
    distributions: { 유니크: dist([null]), 레전드리: dist([6, 1, 'legend']) },
    costs: { 유니크: 2, 레전드리: 4 }, upRates: { 유니크: 1 }, pity: { 유니크: 0 }, stacks: { 유니크: 0 },
  });
  close(unique.current.expectedAttempts, 1);
  close(unique.current.expectedCost, 2);
  close(unique.current.attemptsByGrade.유니크, 1);
  close(unique.current.attemptsByGrade.레전드리, 0);
  const legendary = solveAdditionalTrade(cfg());
  close(legendary.current.expectedAttempts, 1);
});

const primeOption = (key, rows) => ({ key, label: `${key} 고정`, distribution: dist(...rows) });
function primeConfig(overrides = {}) {
  return cfg({ itemPrice: 0, costs: { 레전드리: 10 }, autoSell: true,
    distributions: { 레전드리: [{ price: null, probability: .8, firstKey: 'A' }, { price: 100, probability: .2, firstKey: 'A' }] },
    prime: { on: true, cost: 5, fixedKey: 'auto', options: [primeOption('A', [[null, .8], [100, .2]])] }, ...overrides });
}

test('Prime entry has no extra fee and geometric redraws count in the full reset denominator', () => {
  const result = solveAdditionalTrade(primeConfig());
  close(result.current.expectedAttempts, 5); // 1 normal + .8 * 5 Prime
  close(result.current.expectedPrimeAttempts, 4);
  close(result.current.expectedPrimeCost, 20);
  close(result.current.expectedCost, 30);
  close(result.current.expectedProfit, 70);
  close(result.steady.profitPerReset, 14);
  close(result.convergence.bellmanProfitPerReset, 14);
  assert.deepEqual(result.decisions.map(row => row.action), ['prime', 'sell']);
  close(result.actionSummaries[0].primeProbability, .8);
});

test('Prime eligibility retains first-line identity even when sale prices coincide', () => {
  const result = solveAdditionalTrade(primeConfig({ distributions: { 레전드리: [
    { price: null, probability: .1, firstKey: 'A' },
    { price: null, probability: .8, firstKey: 'B' },
    { price: 100, probability: .1, firstKey: 'B' },
  ] } }));
  assert.deepEqual(result.decisions.map(row => row.action), ['prime', 'hold', 'sell']);
  // Sale/Prime entry occurs with mass .2. Half of sold items use five Prime
  // redraws, while the ordinary waiting time is exactly five resets.
  close(result.current.expectedRegularAttempts, 5);
  close(result.current.expectedPrimeAttempts, 2.5);
  close(result.current.expectedAttempts, 7.5);
  close(result.current.expectedCost, 62.5);
  close(result.steady.profitPerReset, 5);
});

test('Prime costs and proceeds include fee and exactly one replacement purchase', () => {
  const result = solveAdditionalTrade(primeConfig({ itemPrice: 2, fee: 10 }));
  close(result.current.expectedNetRevenue, 90);
  close(result.current.expectedCost, 30);
  close(result.current.expectedProfit, 58);
  close(result.steady.profitPerReset, 11.6);
});

test('automatic fixed-line selection maximizes whole-trade profit rather than conditional Prime yield', () => {
  const input = primeConfig({ distributions: { 레전드리: [
    { price: null, probability: .1, firstKey: 'A' },
    { price: null, probability: .8, firstKey: 'B' },
    { price: 100, probability: .1, firstKey: 'C' },
  ] }, prime: { on: true, cost: 1, fixedKey: 'auto', options: [
    primeOption('A', [[100, 1]]), primeOption('B', [[null, .5], [100, .5]]),
  ] } });
  const auto = solveAdditionalTrade(input);
  const candidates = ['A', 'B'].map(fixedKey => solveAdditionalTrade({ ...input, prime: { ...input.prime, fixedKey } }));
  assert.equal(auto.primeOptimization.selectedFixedKey, 'B');
  close(auto.steady.profitPerReset, Math.max(...candidates.map(result => result.steady.profitPerReset)));
  assert.ok(candidates[0].steady.profitPerReset < candidates[1].steady.profitPerReset);
  assert.ok(auto.primeOptimization.objectiveValue >= auto.primeOptimization.baselineValue);
});

test('high Prime prices retain the baseline policy and zero-probability entry stays disabled', () => {
  const input = primeConfig(), ordinary = solveAdditionalTrade({ ...input, prime: { on: false } });
  const expensive = solveAdditionalTrade({ ...input, prime: { ...input.prime, cost: 1e12 } });
  close(expensive.steady.profitPerReset, ordinary.steady.profitPerReset);
  assert.equal(expensive.primeOptimization.selectedFixedKey, null);
  close(expensive.current.expectedPrimeAttempts, 0);
  const absent = solveAdditionalTrade({ ...input, distributions: { 레전드리: [{ price: 100, probability: 1, firstKey: 'B' }] } });
  assert.equal(absent.primeOptimization.selectedFixedKey, null);
});

test('manual selling stops immediately on a registered price both before and during Prime use', () => {
  const input = primeConfig({ autoSell: false, distributions: { 레전드리: [
    { price: 5, probability: .1, firstKey: 'A' }, { price: null, probability: .8, firstKey: 'A' }, { price: 100, probability: .1, firstKey: 'A' },
  ] }, prime: { on: true, cost: 1, fixedKey: 'A', options: [primeOption('A', [[5, .5], [100, .5]])] } });
  const result = solveAdditionalTrade(input);
  assert.deepEqual(result.decisions.map(row => row.action), ['sell', 'prime', 'sell']);
  close(result.current.expectedPrimeAttempts, .8);
  close(result.current.expectedRevenue, .1 * 5 + .1 * 100 + .8 * 52.5);
});

test('forced manual selling can optimize a finite loss-making Prime cycle below minus Prime cost', () => {
  const input = primeConfig({ autoSell: false, itemPrice: 200, distributions: { 레전드리: [
    { price: 1, probability: .5, firstKey: 'B' }, { price: null, probability: .5, firstKey: 'A' },
  ] }, prime: { on: true, cost: 1, fixedKey: 'A', options: [primeOption('A', [[1, .001], [null, .999]])] } });
  const result = solveAdditionalTrade(input);
  assert.equal(result.possible, true);
  close(result.current.expectedPrimeAttempts, 500);
  close(result.current.expectedAttempts, 501);
  close(result.current.expectedProfit, -709);
  close(result.steady.profitPerReset, -709 / 501);
  assert.deepEqual(result.decisions.map(row => row.action), ['sell', 'prime']);
});

test('cheaper infinite Prime policy remains an explicit impossible sale, including zero cost', () => {
  for (const cost of [1, 0]) {
    const input = primeConfig({ itemPrice: 200, distributions: { 레전드리: [{ price: 1, probability: 1, firstKey: 'A' }] },
      prime: { on: true, cost, fixedKey: 'A', options: [primeOption('A', [[1, 1]])] } });
    const result = solveAdditionalTrade(input);
    assert.equal(result.possible, false);
    assert.equal(result.current.possible, false);
    assert.equal(result.steady.possible, false);
    close(result.steady.profitPerReset, -cost);
    assert.equal(result.current.expectedPrimeAttempts, Infinity);
    assert.match(result.reason, /판매하지 않아/);
    assert.ok(result.fallback);
  }
});

test('no-target Prime compares against the recurrent Legendary cost rather than a cheaper transient grade', () => {
  const input = { startGrade: '에픽', itemPrice: 0, fee: 0, floorPrice: 0, autoSell: true,
    distributions: { 에픽: dist([null]), 유니크: dist([null]), 레전드리: [{ price: null, probability: 1, firstKey: 'A' }] },
    costs: { 에픽: 1, 유니크: 2, 레전드리: 10 }, upRates: { 에픽: 0, 유니크: 0 },
    pity: { 에픽: 0, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
    prime: { on: true, cost: 5, fixedKey: 'A', options: [primeOption('A', [[null, 1]])] } };
  const result = solveAdditionalTrade(input);
  assert.equal(result.possible, false);
  close(result.primeOptimization.baselineValue, -10);
  close(result.steady.profitPerReset, -5);
  assert.equal(result.primeOptimization.reason, 'non-selling');
});

test('Prime off preserves every existing multichain field and ignores inactive Prime settings', () => {
  const input = { startGrade: '에픽', itemPrice: 3, fee: 0, floorPrice: 0, autoSell: true,
    distributions: { 에픽: dist([10]), 유니크: dist([20]), 레전드리: dist([null]) },
    costs: { 에픽: 1, 유니크: 2, 레전드리: 3 }, upRates: { 에픽: 0, 유니크: 0 },
    pity: { 에픽: 0, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 } };
  assert.deepEqual(solveAdditionalTrade({ ...input, prime: { on: false, cost: -1, fixedKey: 'invalid' } }), solveAdditionalTrade(input));
});
