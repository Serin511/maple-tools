import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FLAME_SETTINGS,
  FLAME_ARMOR_OPTION_TYPES,
  FLAME_RESET_COST,
  flameOptionAmount,
  flameOptionPoolForLevel,
  resetCostForLevel,
  validateFlameSettings,
} from '../flame-data.mjs';
import { buildFlameDistribution } from '../flame-distribution.mjs';

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
}

test('meso reset uses fixed official 3 million cost at every valid level', () => {
  for (const level of [1, 59, 60, 69, 70, 140, 200, 250, 300]) {
    assert.equal(resetCostForLevel(level), FLAME_RESET_COST);
  }
  for (const level of [0, 301, 199.5, '200', NaN, Infinity]) assert.equal(resetCostForLevel(level), null);
});

test('all nineteen distinct option identities and official low-level eligibility', () => {
  assert.equal(FLAME_ARMOR_OPTION_TYPES.length, 19);
  assert.equal(new Set(FLAME_ARMOR_OPTION_TYPES.map(option => option.id)).size, 19);
  assert.equal(flameOptionPoolForLevel(59).length, 16);
  assert.equal(flameOptionPoolForLevel(60).length, 18);
  assert.equal(flameOptionPoolForLevel(69).length, 18);
  assert.equal(flameOptionPoolForLevel(70).length, 19);
  assert.ok(!flameOptionPoolForLevel(59).some(option => ['attack', 'magic', 'all'].includes(option.id)));
});

test('stat formulas change at twenty- and forty-level boundaries', () => {
  assert.equal(flameOptionAmount('single', 199, 7), 70);
  assert.equal(flameOptionAmount('single', 200, 7), 77);
  assert.equal(flameOptionAmount('dual', 199, 7), 35);
  assert.equal(flameOptionAmount('dual', 200, 7), 42);
  assert.equal(flameOptionAmount('tier', 250, 7), 7);
});

test('base draw is normalized and matches analytic expectations across all option pools', () => {
  // The mean tier is 4*.29 + 5*.45 + 6*.25 + 7*.01 = 4.98.
  for (const itemLevel of [1, 59, 60, 69, 70, 200, 300]) {
    const settings = { ...DEFAULT_FLAME_SETTINGS, itemLevel };
    const distribution = buildFlameDistribution(settings);
    const poolSize = flameOptionPoolForLevel(itemLevel).length;
    const expectedTierContribution = 4 / poolSize * 4.98;
    const mean = key => distribution.reduce((sum, row) => sum + row.p * row.stats[key], 0);
    close(distribution.reduce((sum, row) => sum + row.p, 0), 1);
    close(mean('main'), expectedTierContribution * (Math.floor(itemLevel / 20) + 1 + 3 * (Math.floor(itemLevel / 40) + 1)));
    close(mean('sub'), mean('main'));
    close(mean('attack'), itemLevel >= 60 ? expectedTierContribution : 0);
    close(mean('all'), itemLevel >= 70 ? expectedTierContribution : 0);
    close(distribution.reduce((sum, row) => sum + (row.stats.all > 0 ? row.p : 0), 0), itemLevel >= 70 ? 4 / poolSize : 0);
    assert.ok(distribution.every((row, index) => row.p > 0 && (index === 0 || row.score >= distribution[index - 1].score)));
  }
});

test('dual main/substat option preserves their correlation', () => {
  const distribution = buildFlameDistribution(DEFAULT_FLAME_SETTINGS);
  const mean = key => distribution.reduce((sum, row) => sum + row.p * row.stats[key], 0);
  const cross = distribution.reduce((sum, row) => sum + row.p * row.stats.main * row.stats.sub, 0);
  // Enumerate expectation of distinct option pairs analytically. The shared
  // STR+DEX line contributes E[tier^2]; every other pair contributes E[tier]^2.
  const mainAmounts = [11, 6, 6, 6];
  const subAmounts = [11, 6, 6, 6];
  const sharedAmount = 6;
  const squaredTier = 16 * .29 + 25 * .45 + 36 * .25 + 49 * .01;
  const distinctPair = 4 * 3 / (19 * 18);
  const sumsProduct = mainAmounts.reduce((a, b) => a + b) * subAmounts.reduce((a, b) => a + b);
  const expectedCross = distinctPair * (sumsProduct - sharedAmount ** 2) * 4.98 ** 2
    + 4 / 19 * sharedAmount ** 2 * squaredTier;
  close(cross, expectedCross);
  assert.ok(Math.abs(cross - mean('main') * mean('sub')) > 1);
});

test('current score never conditions or removes equal-score base draws', () => {
  const first = buildFlameDistribution(DEFAULT_FLAME_SETTINGS);
  const second = buildFlameDistribution({ ...DEFAULT_FLAME_SETTINGS, current: { main: 0, sub: 0, attack: 0, all: 0 } });
  assert.deepEqual(first, second);
  assert.ok(first.some(row => row.score === 0 && row.p > 0));
  assert.ok(first.some(row => row.stats.main === 161 && row.stats.sub === 42 && row.stats.all === 7 && row.stats.attack === 0));
});

test('validation rejects malformed values and accepts zero valuations', () => {
  assert.doesNotThrow(() => validateFlameSettings(DEFAULT_FLAME_SETTINGS));
  assert.doesNotThrow(() => validateFlameSettings({ ...DEFAULT_FLAME_SETTINGS, mesoPerPercent: 0, efficiencies: { main: 0, sub: 0, attack: 0, all: 0 } }));
  assert.throws(() => validateFlameSettings({ ...DEFAULT_FLAME_SETTINGS, itemLevel: 200.5 }), /레벨/);
  assert.throws(() => validateFlameSettings({ ...DEFAULT_FLAME_SETTINGS, current: { ...DEFAULT_FLAME_SETTINGS.current, main: NaN } }), /주스탯/);
  assert.throws(() => validateFlameSettings({ ...DEFAULT_FLAME_SETTINGS, efficiencies: { ...DEFAULT_FLAME_SETTINGS.efficiencies, all: -1 } }), /효율/);
  assert.throws(() => validateFlameSettings({ ...DEFAULT_FLAME_SETTINGS, mesoPerPercent: Infinity }), /최대 금액/);
});
