import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ADDITIONAL_SETTINGS, calculateAdditionalStrategy, previewAdditionalScore,
  normalizeAdditionalSettings, resetAdditionalCosts, suggestedAdditionalAppraisalCost, validateAdditionalSettings,
} from '../additional-calculator.mjs';
import { buildAdditionalDistribution, getAdditionalLines } from '../additional-data.mjs';
import { DEFAULT_ADDITIONAL_TRADE_SETTINGS, additionalTradeScore } from '../additional-trade-calculator.mjs';
import { solveStopping } from '../flame-engine.mjs';

const fresh = () => structuredClone(DEFAULT_ADDITIONAL_SETTINGS);
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);

test('strategy and trade use identical common efficiency defaults and character conversions', () => {
  assert.deepEqual(DEFAULT_ADDITIONAL_SETTINGS.efficiency, DEFAULT_ADDITIONAL_TRADE_SETTINGS.efficiency);
  const currentOptions = ['캐릭터 기준 9레벨 당 LUK +2', '마력 +12', '크리티컬 데미지 +3%'];
  for (const mainStat of ['STR', 'DEX', 'INT', 'LUK']) {
    const settings = { ...fresh(), mainStat, subStat: 'STR', attackType: 'attack', currentOptions };
    const merchant = additionalTradeScore(currentOptions, { ...DEFAULT_ADDITIONAL_TRADE_SETTINGS, slot: '장갑', separateCrit: false });
    close(previewAdditionalScore(settings), merchant.scores[mainStat]);
  }
});

test('saved settings normalize obsolete character and utility choices while preserving explicit custom efficiencies', () => {
  const saved = { mainStat: 'INT', subStat: 'DEX', attackType: 'attack',
    efficiency: { mainFlat: .2, criticalDamagePercent: 0, itemDropPercent: 90, mesoPercent: 80 },
    manual: { enabled: true, thresholds: { 에픽: 7 } },
  };
  const before = structuredClone(saved);
  const restored = normalizeAdditionalSettings(saved);
  assert.deepEqual(saved, before);
  assert.equal(restored.subStat, 'LUK');
  assert.equal(restored.attackType, 'magic');
  assert.equal(restored.efficiency.mainFlat, .2);
  assert.equal(restored.efficiency.criticalDamagePercent, 0);
  assert.equal(restored.efficiency.itemDropPercent, 0);
  assert.equal(restored.efficiency.mesoPercent, 0);
  assert.deepEqual(restored.manual.thresholds, { 에픽: 7, 유니크: 15, 레전드리: 20 });
  assert.equal(validateAdditionalSettings(restored), true);
  const defaults = normalizeAdditionalSettings();
  assert.equal(defaults.efficiency.criticalDamagePercent, 4);
  defaults.currentOptions[0] = 'STR +12';
  defaults.efficiency.mainFlat = 9;
  assert.equal(DEFAULT_ADDITIONAL_SETTINGS.currentOptions[0], '없음');
  assert.equal(DEFAULT_ADDITIONAL_SETTINGS.efficiency.mainFlat, .1);
});

test('legacy drop and meso values and overrides cannot affect selected options or strategy recommendations', () => {
  const settings = fresh();
  settings.slot = '반지'; settings.grade = '레전드리';
  settings.currentOptions = ['아이템 드롭률 +5%', '메소 획득량 +5%', '없음'];
  const expected = calculateAdditionalStrategy(settings);
  settings.efficiency.itemDropPercent = 99;
  settings.efficiency.mesoPercent = 88;
  settings.customOptionScores = { '아이템 드롭률 +5%': 777, '메소 획득량 +5%': 666 };
  assert.equal(previewAdditionalScore(settings), 0);
  assert.deepEqual(calculateAdditionalStrategy(settings), expected);
});

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
  for (const patch of [{ slot: '무기' }, { slot: '벨트', level: 250 }, { level: 251 }, { mainStat: 'HP' }, { strangeAppraisalCost: '' }, { currentOptions: ['STR +999%', '없음', '없음'] }]) {
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
