import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADDITIONAL_SETTINGS, calculateAdditionalStrategy, previewAdditionalScore,
  resetAdditionalCosts, suggestedAdditionalAppraisalCost, validateAdditionalSettings,
} from '../additional-calculator.mjs';
import { buildAdditionalDistribution, getAdditionalLines } from '../additional-data.mjs';
import { solveStopping } from '../flame-engine.mjs';

const fresh = () => structuredClone(DEFAULT_ADDITIONAL_SETTINGS);
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test('PDF fee brackets and appraisal cost distinguish level120 and next-level boundaries', () => {
  assert.deepEqual(resetAdditionalCosts(159), { 에픽: 27300000, 유니크: 66300000, 레전드리: 78000000 });
  assert.deepEqual(resetAdditionalCosts(160), { 에픽: 29050000, 유니크: 70550000, 레전드리: 83000000 });
  assert.equal(resetAdditionalCosts(199).에픽, 29050000);
  assert.deepEqual(resetAdditionalCosts(200), { 에픽: 30800000, 유니크: 74800000, 레전드리: 88000000 });
  assert.equal(resetAdditionalCosts(249).레전드리, 88000000);
  assert.deepEqual(resetAdditionalCosts(250), { 에픽: 34300000, 유니크: 83300000, 레전드리: 98000000 });
  for (const [level, fee] of [[120, 36000], [121, 292820], [140, 392000], [160, 512000], [200, 800000], [250, 1250000]]) {
    assert.equal(suggestedAdditionalAppraisalCost(level), fee);
  }
});

test('real default distributions give normalized final grades and mixed strategy dominates either single method', () => {
  const settings = fresh(), result = calculateAdditionalStrategy(settings);
  assert.equal(result.strategies.length, 3);
  for (const row of result.strategies) {
    assert.equal(row.available, true);
    close(Object.values(row.finalGrades).reduce((a, b) => a + b), 1);
    close(row.expectedAttempts, row.expectedStrangeAttempts + row.expectedResetAttempts);
    close(row.expectedNetValue, row.expectedGain * settings.mesoPerPercent - row.expectedCost);
    assert.ok(row.expectedCost >= 0 && Number.isFinite(row.expectedCost));
  }
  const mixed = result.strategies.find(row => row.id === 'mixed');
  assert.ok(mixed.expectedNetValue >= Math.max(...result.strategies.map(row => row.expectedNetValue)) - 1e-5);
  assert.deepEqual(mixed.thresholds.map(row => row.grade), ['에픽', '유니크', '레전드리']);
});

test('strange-only real strategy matches independent IID solver including appraisal on every attempt', () => {
  const settings = fresh(); settings.strangeCubePrice = 12345;
  const actual = calculateAdditionalStrategy(settings).strategies.find(row => row.id === 'strange');
  const distribution = buildAdditionalDistribution({ ...settings, method: 'strange' });
  const expected = solveStopping(distribution.map(row => ({ ...row, p: row.probability })), settings.strangeCubePrice + settings.strangeAppraisalCost, settings.mesoPerPercent, 0);
  close(actual.threshold, expected.targetScore);
  close(actual.expectedCost, expected.expectedCost);
  close(actual.expectedAttempts, expected.expectedAttempts);
  close(actual.expectedFinalScore, expected.expectedFinalScore);
});

test('free cube price still charges appraisal and higher-level fee is charged for each cube', () => {
  const settings = fresh(); settings.level = 250;
  settings.costs = resetAdditionalCosts(250); settings.strangeAppraisalCost = suggestedAdditionalAppraisalCost(250);
  const row = calculateAdditionalStrategy(settings).strategies.find(row => row.id === 'strange');
  assert.ok(row.expectedStrangeAttempts > 0);
  close(row.expectedCost, row.expectedStrangeAttempts * 1250000);
});

test('full pity upgrades on next roll; fresh pity with zero ordinary chance needs cap+1 attempts', () => {
  const settings = fresh();
  settings.manual = { enabled: true, method: 'reset', thresholds: { 에픽: 1000, 유니크: 0, 레전드리: 0 } };
  settings.stacks.에픽 = 152;
  let row = calculateAdditionalStrategy(settings).manual;
  close(row.expectedAttempts, 1);
  close(row.expectedCost, settings.costs.에픽);
  close(row.finalGrades.유니크, 1);
  settings.stacks.에픽 = 0; settings.upRates.에픽 = 0;
  row = calculateAdditionalStrategy(settings).manual;
  close(row.expectedAttempts, 153);
  close(row.expectedCost, 153 * settings.costs.에픽);
});

test('current Legendary works without unreachable grade mechanics and strange is excluded', () => {
  const settings = fresh(); settings.grade = '레전드리';
  settings.costs.에픽 = ''; settings.costs.유니크 = ''; settings.pity = {}; settings.upRates = {}; settings.stacks = {};
  const result = calculateAdditionalStrategy(settings);
  assert.equal(result.strategies[0].available, false);
  assert.equal(result.strategies[1].available, true);
  assert.equal(result.strategies[2].available, true);
  assert.deepEqual(result.strategies[1].thresholds.map(row => row.grade), ['레전드리']);
});

test('zero willingness stops at the selected options and never spends on free cubes with appraisal', () => {
  const settings = fresh(); settings.mesoPerPercent = 0;
  settings.currentOptions = getAdditionalLines({ ...settings, method: 'reset' }).map(line => line.find(row => row.label.startsWith('STR +')).label);
  const result = calculateAdditionalStrategy(settings);
  assert.ok(previewAdditionalScore(settings) > 0);
  for (const row of result.strategies) {
    assert.equal(row.action, 'stop'); assert.equal(row.expectedCost, 0); assert.equal(row.expectedAttempts, 0);
    close(row.expectedFinalScore, result.currentScore);
  }
});

test('unavailable slot bands, mismatched current lines and malformed inputs fail instead of silently falling back', () => {
  for (const patch of [{ slot: '무기' }, { slot: '벨트', level: 250 }, { level: 251 }, { subStat: 'STR' }, { strangeAppraisalCost: '' }, { currentOptions: ['STR +999%', '없음', '없음'] }]) {
    assert.throws(() => validateAdditionalSettings({ ...fresh(), ...patch }));
  }
  const settings = fresh(); settings.manual.enabled = true;
  settings.manual.thresholds = { 에픽: 1000, 유니크: 1000, 레전드리: 1000 };
  const failed = calculateAdditionalStrategy(settings).manual;
  assert.equal(failed.available, false);
  assert.equal(failed.expectedFinalScore, null);
  assert.equal(failed.expectedGain, null);
  settings.grade = '유니크'; settings.manual.method = 'strange';
  assert.match(calculateAdditionalStrategy(settings).manual.reason, /에픽/);
});
