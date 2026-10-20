import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAME_SETTINGS, flameOptionPoolForLevel } from '../flame-data.mjs';
import { buildFlameDistribution } from '../flame-distribution.mjs';
import { DEFAULT_FLAME_EFFICIENCIES } from '../flame-engine.mjs';
import {
  DEFAULT_FLAME_TRADE_SETTINGS, DEFAULT_FLAME_TRADE_WEIGHTS, FLAME_TRADE_STATS,
  buildFlameTradeDistribution, calculateFlameTrade, flameTradePriceLadder, flameTradeRowScore, newFlameTradeRow, validateFlameTradeSettings,
} from '../flame-trade-calculator.mjs';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
const atLeast = (rows, threshold) => rows.reduce((sum, row) => sum + (row.score >= threshold - 1e-6 ? row.p : 0), 0);
const settingsWith = (prices, patch = {}) => ({ ...DEFAULT_FLAME_TRADE_SETTINGS, mainStats: [...DEFAULT_FLAME_TRADE_SETTINGS.mainStats], prices, ...patch });

test('default conversion table equals the efficiency calculator defaults in grade units', () => {
  const { main, sub, attack, all } = DEFAULT_FLAME_EFFICIENCIES;
  close(DEFAULT_FLAME_TRADE_WEIGHTS.sub, sub / main);
  close(DEFAULT_FLAME_TRADE_WEIGHTS.attack, attack / main);
  close(DEFAULT_FLAME_TRADE_WEIGHTS.all, 10 * all / main);
  close(flameTradeRowScore(newFlameTradeRow('a', { mode: 'stats', main: 100, sub: 50, attack: 10, all: 5 }), DEFAULT_FLAME_TRADE_WEIGHTS), 190);
  assert.equal(flameTradeRowScore(newFlameTradeRow('b', { total: 150 }), DEFAULT_FLAME_TRADE_WEIGHTS), 150);
});

test('one main stat reproduces the efficiency calculator distribution in grades', () => {
  for (const level of [59, 60, 70, 140, 200, 250]) {
    const flame = buildFlameDistribution({ ...DEFAULT_FLAME_SETTINGS, itemLevel: level }).map(row => ({ score: row.score * 10, p: row.p }));
    const trade = buildFlameTradeDistribution({ level, mainStats: ['STR'], weights: DEFAULT_FLAME_TRADE_WEIGHTS });
    close(trade.reduce((sum, row) => sum + row.p, 0), 1);
    for (const threshold of [0, 40, 80, 100, 120, 140, 160, 180, 200, 220]) close(atLeast(trade, threshold), atLeast(flame, threshold));
  }
});

test('the grade mean matches independent option-selection expectations', () => {
  const level = 200;
  const pool = flameOptionPoolForLevel(level).length;
  const perType = 4 / pool * 4.98;
  const stat = perType * ((Math.floor(level / 20) + 1) + 3 * (Math.floor(level / 40) + 1));
  const trade = buildFlameTradeDistribution({ level, mainStats: ['LUK'], weights: { sub: 0.5, attack: 4, all: 10 } });
  close(trade.reduce((sum, row) => sum + row.p * row.score, 0), stat + 0.5 * stat + 4 * perType + 10 * perType);
});

test('every main stat has the same single-stat distribution and the best of several stats dominates each', () => {
  const single = Object.fromEntries(FLAME_TRADE_STATS.map(stat => [stat, buildFlameTradeDistribution({ level: 160, mainStats: [stat], weights: DEFAULT_FLAME_TRADE_WEIGHTS })]));
  const all = buildFlameTradeDistribution({ level: 160, mainStats: [...FLAME_TRADE_STATS], weights: DEFAULT_FLAME_TRADE_WEIGHTS });
  close(all.reduce((sum, row) => sum + row.p, 0), 1);
  for (const threshold of [60, 100, 130, 150, 170, 190]) {
    const each = FLAME_TRADE_STATS.map(stat => atLeast(single[stat], threshold));
    for (const value of each) close(value, each[0]);
    const best = atLeast(all, threshold);
    assert.ok(best >= each[0] - 1e-12, `max over stats must dominate at ${threshold}`);
    assert.ok(best <= Math.min(1, each.reduce((sum, value) => sum + value, 0)) + 1e-12, `union bound at ${threshold}`);
    if (threshold >= 100) assert.ok(best > each[0], `several stats must raise the chance at ${threshold}`);
  }
  const magic = buildFlameTradeDistribution({ level: 160, mainStats: ['INT'], weights: { sub: 0, attack: 100, all: 0 } });
  const attack = buildFlameTradeDistribution({ level: 160, mainStats: ['STR'], weights: { sub: 0, attack: 100, all: 0 } });
  close(atLeast(magic, 500), atLeast(attack, 500));
});

test('price ladder applies the highest reached threshold and the best price among equal thresholds', () => {
  const rows = [
    newFlameTradeRow('low', { total: 140, price: 2e8 }),
    newFlameTradeRow('mid', { total: 160, price: 5e8 }),
    newFlameTradeRow('stat', { mode: 'stats', main: 150, sub: 0, attack: 0, all: 1, price: 4e8 }),
    newFlameTradeRow('dup', { total: 140, price: 3e8 }),
    newFlameTradeRow('blank', { total: 120, price: '' }),
  ];
  const ladder = flameTradePriceLadder(rows, DEFAULT_FLAME_TRADE_WEIGHTS);
  assert.deepEqual(ladder.map(step => [step.id, step.threshold, step.upper]), [['dup', 140, 160], ['mid', 160, 161], ['stat', 161, null]]);
  assert.deepEqual(ladder[0].shadowedIds, ['low']);
  const result = calculateFlameTrade(settingsWith(rows, { itemPrice: 0 }));
  assert.ok(result.warnings.some(warning => warning.includes('더 높은 급수 조건의 판매가가 더 낮습니다')));
  assert.ok(result.warnings.some(warning => warning.includes('가장 높은 판매가 하나만')));
});

test('trade result conserves probability and follows the purchase-price sale rule', () => {
  const rows = [
    newFlameTradeRow('a', { total: 140, price: 2e8 }),
    newFlameTradeRow('b', { total: 160, price: 8e8 }),
    newFlameTradeRow('c', { mode: 'stats', main: 120, sub: 0, attack: 2, all: 6, price: 15e8 }),
  ];
  for (const [itemPrice, expectedFrom] of [[1e8, 140], [2.5e8, 160]]) {
    const result = calculateFlameTrade(settingsWith(rows, { itemPrice }));
    assert.equal(result.possible, true);
    assert.equal(result.objective, 'per-reset');
    close(result.rows.reduce((sum, row) => sum + row.probability, 0) + result.unpricedProbability, 1);
    for (const row of result.rows) assert.equal(row.decision === 'sell', row.netPrice > itemPrice);
    assert.equal(result.sellFrom, expectedFrom);
    close(result.metrics.acceptanceProbability, result.rows.filter(row => row.decision === 'sell').reduce((sum, row) => sum + row.probability, 0));
    close(result.rows.reduce((sum, row) => sum + row.saleShare, 0), 1);
    assert.ok(result.examples.length > 0);
    for (const example of result.examples) {
      assert.ok(example.score >= expectedFrom - 1e-9);
      close(example.score, flameTradeRowScore({ mode: 'stats', ...example.values }, DEFAULT_FLAME_TRADE_WEIGHTS));
    }
    assert.ok(result.rows.every((row, index) => index === 0 || row.atLeastProbability <= result.rows[index - 1].atLeastProbability));
  }
  const manual = calculateFlameTrade(settingsWith(rows, { itemPrice: 2.5e8, autoSell: false }));
  assert.equal(manual.objective, 'manual');
  assert.equal(manual.sellFrom, 140);
  assert.equal(manual.comparison, null);
  const auto = calculateFlameTrade(settingsWith(rows, { itemPrice: 2.5e8 }));
  close(auto.comparison.metrics.profitPerReset, manual.metrics.profitPerReset);
  assert.ok(auto.metrics.profitPerReset > manual.metrics.profitPerReset);
});

test('a component price row equals the total row with the same converted grade', () => {
  const total = calculateFlameTrade(settingsWith([newFlameTradeRow('a', { total: 144, price: 3e8 })]));
  const stats = calculateFlameTrade(settingsWith([newFlameTradeRow('a', { mode: 'stats', main: 100, sub: 0, attack: 0, all: 4, price: 3e8 })]));
  close(stats.metrics.profitPerReset, total.metrics.profitPerReset);
  close(stats.rows[0].probability, total.rows[0].probability);
  // A larger all-stat conversion makes the same row easier to reach for results but also raises the row threshold.
  const cheaper = calculateFlameTrade(settingsWith([newFlameTradeRow('a', { total: 144, price: 3e8 })], { weights: { ...DEFAULT_FLAME_TRADE_WEIGHTS, all: 20 } }));
  assert.ok(cheaper.rows[0].probability > total.rows[0].probability);
});

test('unreachable prices report the reason; the floor price is only a fallback sale', () => {
  const unreachable = calculateFlameTrade(settingsWith([newFlameTradeRow('a', { total: 900, price: 3e8 })]));
  assert.equal(unreachable.possible, false);
  assert.ok(unreachable.warnings.some(warning => warning.includes('도달할 수 없거나')));
  const floor = calculateFlameTrade(settingsWith([newFlameTradeRow('a', { total: 900, price: 3e8 })], { floorPrice: 5e7 }));
  assert.equal(floor.possible, true);
  assert.equal(floor.sellsFloor, true);
  assert.equal(floor.sellFrom, 0);
  assert.deepEqual(floor.examples, []);
  assert.ok(floor.warnings.some(warning => warning.includes('잡추옵 처분가')));
});

test('validation rejects unusable inputs and ignores rows without a price', () => {
  const valid = settingsWith([newFlameTradeRow('a', { total: 150, price: 1e8 }), newFlameTradeRow('b', { total: '', price: '' })]);
  assert.equal(validateFlameTradeSettings(valid), true);
  assert.throws(() => validateFlameTradeSettings(settingsWith([newFlameTradeRow('b', { total: 150, price: '' })])), /1개 이상/);
  assert.throws(() => validateFlameTradeSettings(settingsWith([newFlameTradeRow('a', { total: '', price: 1e8 })])), /환산 급수/);
  assert.throws(() => validateFlameTradeSettings(settingsWith([newFlameTradeRow('a', { mode: 'stats', main: '', price: 1e8 })])), /주스탯 수치/);
  assert.throws(() => validateFlameTradeSettings(settingsWith([newFlameTradeRow('a', { total: 1, price: 1 }), newFlameTradeRow('a', { total: 2, price: 1 })])), /식별값/);
  assert.throws(() => validateFlameTradeSettings({ ...valid, fee: 101 }), /수수료/);
  assert.throws(() => validateFlameTradeSettings({ ...valid, itemPrice: '' }), /노작 매입가/);
  assert.throws(() => validateFlameTradeSettings({ ...valid, mainStats: [] }), /주스탯/);
  assert.throws(() => validateFlameTradeSettings({ ...valid, mainStats: ['STR', 'STR'] }), /주스탯/);
  assert.throws(() => validateFlameTradeSettings({ ...valid, weights: { ...valid.weights, all: -1 } }), /올스탯/);
  assert.throws(() => validateFlameTradeSettings({ ...valid, level: 301 }), /레벨/);
  assert.throws(() => calculateFlameTrade({ ...valid, resetCost: NaN }), /재설정 비용/);
});