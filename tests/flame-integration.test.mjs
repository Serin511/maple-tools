import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAME_SETTINGS } from '../flame-data.mjs';
import { calculateFlameStrategy } from '../flame-calculator.mjs';
import { scoreStats } from '../flame-engine.mjs';

const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('real armor distribution produces consistent costs, gains and attainable stopping examples', () => {
  const settings = { ...DEFAULT_FLAME_SETTINGS, current: { main: 0, sub: 0, attack: 0, all: 0 } };
  const result = calculateFlameStrategy(settings);
  assert.equal(result.shouldReset, true);
  assert.ok(result.targetScore >= result.threshold);
  close(result.expectedAttempts * result.acceptanceProbability, 1);
  close(result.expectedCost, result.expectedAttempts * 3_000_000);
  close(result.expectedNetValue, settings.mesoPerPercent * result.expectedGain - result.expectedCost);
  assert.ok(result.examples.length > 0);
  for (const row of result.examples) {
    close(row.score, scoreStats(row.stats, settings.efficiencies));
    assert.ok(row.score >= result.targetScore);
  }
});

test('zero price has no target or examples, and zero efficiencies immediately stop', () => {
  const zeroPrice = calculateFlameStrategy({ ...DEFAULT_FLAME_SETTINGS, mesoPerPercent: 0 });
  assert.equal(zeroPrice.targetScore, null);
  assert.equal(zeroPrice.shouldReset, false);
  assert.deepEqual(zeroPrice.examples, []);
  const zeroEfficiency = calculateFlameStrategy({ ...DEFAULT_FLAME_SETTINGS, efficiencies: { main: 0, sub: 0, attack: 0, all: 0 } });
  assert.equal(zeroEfficiency.targetScore, 0);
  assert.equal(zeroEfficiency.shouldReset, false);
  assert.equal(zeroEfficiency.expectedCost, 0);
});

test('increasing willingness raises the target while current stats only change the action', () => {
  const cheap = calculateFlameStrategy({ ...DEFAULT_FLAME_SETTINGS, mesoPerPercent: 1e7 });
  const costly = calculateFlameStrategy({ ...DEFAULT_FLAME_SETTINGS, mesoPerPercent: 1e9 });
  assert.ok(costly.targetScore > cheap.targetScore);
  const strong = calculateFlameStrategy({ ...DEFAULT_FLAME_SETTINGS, current: { main: 500, sub: 0, attack: 0, all: 0 } });
  assert.equal(strong.shouldReset, false);
  assert.equal(strong.expectedAttempts, 0);
  assert.equal(strong.expectedFinalScore, 50);
});
