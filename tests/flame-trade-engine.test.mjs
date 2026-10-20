import test from 'node:test';
import assert from 'node:assert/strict';
import { solveFlameTrade, profitQuantile, lossProbability, resetQuantile, FLAME_TRADE_FLOOR_ID } from '../flame-trade-engine.mjs';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const base = { fee: 0, floorPrice: 0, itemPrice: 1, resetCost: 1 };

// Independent check: direct enumeration of every subset of sale classes.
function subsets(items) {
  const out = [];
  for (let mask = 1; mask < 1 << items.length; mask++) out.push(items.filter((_, index) => mask & (1 << index)));
  return out;
}
function policyValue(set, { itemPrice, resetCost }) {
  const q = set.reduce((sum, item) => sum + item.p, 0);
  const sale = set.reduce((sum, item) => sum + item.p * item.net, 0) / q;
  return { q, perItem: sale - itemPrice - resetCost / q, perReset: (sale - itemPrice) * q - resetCost };
}

test('one sale class has the geometric closed form', () => {
  const result = solveFlameTrade({ ...base, bands: [{ id: 'a', price: 10, p: 0.2 }], unpricedProbability: 0.8, autoSell: true });
  assert.equal(result.possible, true);
  assert.deepEqual(result.acceptedIds, ['a']);
  close(result.metrics.acceptanceProbability, 0.2);
  close(result.metrics.expectedResets, 5);
  close(result.metrics.expectedResetCost, 5);
  close(result.metrics.expectedProfit, 10 - 1 - 5);
  close(result.metrics.profitPerReset, 0.8);
  close(result.metrics.breakevenItemPrice, 5);
  close(result.metrics.profitPer100Eok, 4 / 6 * 100e8);
});

test('fee is deducted from sale revenue but not from the gross price', () => {
  const result = solveFlameTrade({ ...base, fee: 3, bands: [{ id: 'a', price: 100, p: 0.5 }], unpricedProbability: 0.5, autoSell: false });
  close(result.metrics.expectedGrossRevenue, 100);
  close(result.metrics.expectedNetRevenue, 97);
  close(result.metrics.expectedProfit, 97 - 1 - 2);
  assert.equal(result.sales[0].gross, 100);
  close(result.sales[0].net, 97);
});

test('per-reset optimum sells exactly the classes whose net sale beats the purchase price', () => {
  const bands = [
    { id: 'low', price: 0.8, p: 0.3 },
    { id: 'edge', price: 1.4, p: 0.2 },
    { id: 'mid', price: 3, p: 0.1 },
    { id: 'high', price: 40, p: 0.01 },
  ];
  const settings = { ...base, fee: 10, itemPrice: 1.2, resetCost: 0.05, bands, unpricedProbability: 0.39 };
  const result = solveFlameTrade({ ...settings, autoSell: true });
  assert.equal(result.objective, 'per-reset');
  // Net prices are 0.72, 1.26, 2.7 and 36, so only 'low' is below 1.2.
  assert.deepEqual([...result.acceptedIds].sort(), ['edge', 'high', 'mid']);
  const classes = bands.map(band => ({ ...band, net: band.price * 0.9 }));
  const best = Math.max(...subsets(classes).map(set => policyValue(set, settings).perReset));
  close(result.metrics.profitPerReset, best);
  close(result.metrics.profitPerReset, classes.filter(item => item.net > 1.2).reduce((sum, item) => sum + item.p * (item.net - 1.2), 0) - 0.05);
  // The renewal-reward identity: profit per item = rate * expected resets.
  close(result.metrics.expectedProfit, result.metrics.profitPerReset * result.metrics.expectedResets);
  assert.equal(result.risk.resets.p50, resetQuantile(result.metrics.acceptanceProbability, 0.5));
  // Manual mode sells every priced class regardless of the purchase price.
  const manual = solveFlameTrade({ ...settings, autoSell: false });
  assert.deepEqual([...manual.acceptedIds].sort(), ['edge', 'high', 'low', 'mid']);
  assert.ok(manual.metrics.profitPerReset < result.metrics.profitPerReset);
});

test('without a profitable rate the policy minimizes the expected loss per item', () => {
  const bands = [{ id: 'a', price: 2, p: 0.3 }, { id: 'b', price: 6, p: 0.05 }, { id: 'c', price: 30, p: 0.001 }];
  const settings = { ...base, itemPrice: 5, resetCost: 1, bands, unpricedProbability: 0.649 };
  const result = solveFlameTrade({ ...settings, autoSell: true });
  assert.equal(result.objective, 'per-item');
  const classes = bands.map(band => ({ ...band, net: band.price }));
  const values = subsets(classes).map(set => policyValue(set, settings));
  assert.ok(Math.max(...values.map(value => value.perReset)) <= 0);
  close(result.metrics.expectedProfit, Math.max(...values.map(value => value.perItem)));
  close(result.metrics.breakevenItemPrice, Math.max(...subsets(classes).map(set => {
    const q = set.reduce((sum, item) => sum + item.p, 0);
    return (set.reduce((sum, item) => sum + item.p * item.net, 0) - 1) / q;
  })));
});

test('a positive floor price raises low sales and makes unpriced results sellable only with optimization', () => {
  const bands = [{ id: 'a', price: 1, p: 0.2 }, { id: 'b', price: 50, p: 0.05 }];
  const settings = { ...base, itemPrice: 2.5, resetCost: 0.1, floorPrice: 3, bands, unpricedProbability: 0.75 };
  const auto = solveFlameTrade({ ...settings, autoSell: true });
  // A floor above the purchase price makes every result worth selling.
  assert.equal(auto.sellsFloor, true);
  close(auto.metrics.acceptanceProbability, 1);
  assert.equal(auto.sales.find(sale => sale.id === 'a').atFloor, true);
  assert.equal(auto.sales.find(sale => sale.id === 'a').gross, 3);
  assert.ok(auto.sales.some(sale => sale.id === FLAME_TRADE_FLOOR_ID));
  const manual = solveFlameTrade({ ...settings, autoSell: false });
  assert.equal(manual.sellsFloor, false);
  close(manual.metrics.acceptanceProbability, 0.25);
  const noFloor = solveFlameTrade({ ...settings, floorPrice: 0, autoSell: true });
  assert.equal(noFloor.sellsFloor, false);
  assert.ok(!noFloor.acceptedIds.includes(FLAME_TRADE_FLOOR_ID));
});

test('unreachable sales are reported instead of producing infinite expectations', () => {
  const bands = [{ id: 'a', price: 10, p: 0 }];
  assert.equal(solveFlameTrade({ ...base, bands, unpricedProbability: 1, autoSell: false }).possible, false);
  assert.equal(solveFlameTrade({ ...base, bands, unpricedProbability: 1, autoSell: true }).possible, false);
  const floorOnly = solveFlameTrade({ ...base, floorPrice: 0.5, bands, unpricedProbability: 1, autoSell: true });
  assert.equal(floorOnly.possible, true);
  assert.equal(floorOnly.hasPricedResult, false);
  close(floorOnly.metrics.expectedProfit, 0.5 - 1 - 1);
});

test('profit quantiles and loss probability match direct enumeration of attempts', () => {
  const accepted = [{ p: 0.03, net: 9 }, { p: 0.01, net: 25 }, { p: 0.001, net: 120 }];
  const costs = { itemPrice: 4, resetCost: 0.13 };
  const q = accepted.reduce((sum, item) => sum + item.p, 0);
  const outcomes = [];
  for (let n = 1; n < 20000; n++) {
    const pn = Math.pow(1 - q, n - 1) * q;
    for (const item of accepted) outcomes.push({ value: item.net - costs.itemPrice - costs.resetCost * n, p: pn * item.p / q });
  }
  outcomes.sort((a, b) => a.value - b.value);
  const quantile = alpha => {
    let cumulative = 0;
    for (const outcome of outcomes) { cumulative += outcome.p; if (cumulative >= alpha - 1e-12) return outcome.value; }
    return outcomes.at(-1).value;
  };
  for (const alpha of [0.1, 0.5, 0.9]) close(profitQuantile(accepted, costs, alpha), quantile(alpha), 1e-9);
  close(lossProbability(accepted, costs), outcomes.filter(outcome => outcome.value < -1e-12).reduce((sum, outcome) => sum + outcome.p, 0), 1e-9);
});

test('reset quantiles are geometric and degenerate cases stay finite', () => {
  assert.equal(resetQuantile(0.5, 0.5), 1);
  assert.equal(resetQuantile(0.5, 0.9), 4);
  assert.equal(resetQuantile(0.01, 0.5), Math.ceil(Math.log(0.5) / Math.log(0.99)));
  assert.equal(resetQuantile(1, 0.99), 1);
  assert.equal(resetQuantile(1e-12, 0.5) > 1e11, true);
  const certain = solveFlameTrade({ ...base, resetCost: 2, bands: [{ id: 'a', price: 2, p: 0.5 }, { id: 'b', price: 10, p: 0.5 }], autoSell: false });
  assert.deepEqual(certain.risk.profit, { p10: 2 - 1 - 2, p50: 2 - 1 - 2, p90: 10 - 1 - 2 });
  close(certain.risk.lossProbability, 0.5);
  const free = solveFlameTrade({ ...base, resetCost: 0, bands: [{ id: 'a', price: 3, p: 0.1 }], unpricedProbability: 0.9, autoSell: true });
  for (const value of Object.values(free.risk.profit)) close(value, 2);
  assert.equal(free.risk.lossProbability, 0);
  close(free.metrics.profitPer100Eok, 2 / 1 * 100e8);
  const freeItem = solveFlameTrade({ ...base, itemPrice: 0, resetCost: 0, bands: [{ id: 'a', price: 3, p: 1 }], autoSell: true });
  assert.equal(freeItem.metrics.profitPer100Eok, null);
});

test('rare classes keep their exact tail probability', () => {
  const p = 1e-12;
  const result = solveFlameTrade({ ...base, itemPrice: 1, resetCost: 1e-6, bands: [{ id: 'jackpot', price: 1e8, p }], unpricedProbability: 1 - p, autoSell: true });
  close(result.metrics.acceptanceProbability, p, 1e-6);
  close(result.metrics.expectedResets, 1 / p, 1e-6);
  assert.ok(Number.isFinite(result.risk.profit.p90));
});

test('invalid engine inputs throw', () => {
  assert.throws(() => solveFlameTrade({ ...base, fee: 101, bands: [], autoSell: true }), /fee/);
  assert.throws(() => solveFlameTrade({ ...base, itemPrice: -1, bands: [], autoSell: true }), /itemPrice/);
  assert.throws(() => solveFlameTrade({ ...base, bands: [{ id: 'a', price: NaN, p: 1 }], autoSell: true }), /price/);
  assert.throws(() => solveFlameTrade({ ...base, bands: null, autoSell: true }), /bands/);
});