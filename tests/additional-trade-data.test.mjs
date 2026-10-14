import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDITIONAL_TRADE_SUBSTATS, DEFAULT_ADDITIONAL_TRADE_SETTINGS,
  additionalTradeScore, calculateAdditionalTrade, classifyAdditionalTradeOutcome,
  validateAdditionalTradeSettings,
} from '../additional-trade-calculator.mjs';

const base = () => structuredClone(DEFAULT_ADDITIONAL_TRADE_SETTINGS);
const row = (id, stat, min, price, cd = 0, crit = 0) => ({ id, stat, min, price, cd, crit });

test('uses the fixed one-substat mapping for all four main stats', () => {
  assert.deepEqual(ADDITIONAL_TRADE_SUBSTATS, { STR: 'DEX', DEX: 'STR', INT: 'LUK', LUK: 'DEX' });
  const options = ['STR +10', 'DEX +10', '마력 +10'];
  const scores = additionalTradeScore(options, base()).scores;
  assert.equal(scores.STR, 1.1); // +10 STR and +10 DEX substat
  assert.equal(scores.DEX, 1.1); // +10 DEX and +10 STR substat
  assert.equal(scores.INT, 3); // +10 magic is valued for INT only
  assert.equal(scores.LUK, 0.1); // DEX is the fixed LUK substat
});

test('uses character-level floor conversion and honors arbitrary efficiency decimals', () => {
  const s = base();
  s.characterLevel = 290;
  assert.equal(additionalTradeScore(['캐릭터 기준 9레벨 당 STR +1', '없음', '없음'], s).scores.STR, 3.2);
  s.efficiency.mainFlat = 0.123456789;
  assert.equal(additionalTradeScore(['STR +10', '없음', '없음'], s).scores.STR, 1.23456789);
});

test('merchant default values glove critical damage at 4 main-stat percent per 1%', () => {
  const s = base();
  assert.equal(s.efficiency.criticalDamagePercent, 4);
  const score = additionalTradeScore(['크리티컬 데미지 +1%', '없음', '없음'], {
    ...s, slot: '장갑', separateCrit: false,
  });
  assert.equal(score.scores.STR, 4);
  const partial = additionalTradeScore(['크리티컬 데미지 +1%', '없음', '없음'], {
    slot: '장갑', separateCrit: false,
  });
  assert.equal(partial.scores.STR, 4);
  const partialEfficiency = additionalTradeScore(['크리티컬 데미지 +1%', '없음', '없음'], {
    slot: '장갑', separateCrit: false, efficiency: { mainFlat: 0.2 },
  });
  assert.equal(partialEfficiency.scores.STR, 4);
  const explicitZero = additionalTradeScore(['크리티컬 데미지 +1%', '없음', '없음'], {
    slot: '장갑', separateCrit: false, efficiency: { criticalDamagePercent: 0 },
  });
  assert.equal(explicitZero.scores.STR, 0);
});

test('always ignores drop and meso efficiency, and does not count split glove critical damage twice', () => {
  const s = base();
  s.efficiency.itemDropPercent = 100;
  s.efficiency.mesoPercent = 100;
  s.efficiency.criticalDamagePercent = 5;
  const utility = additionalTradeScore(['아이템 드롭률 +5%', '메소 획득량 +5%', '없음'], s);
  assert.equal(utility.scores.STR, 0);
  const glove = additionalTradeScore(['크리티컬 데미지 +3%', '없음', '없음'], { ...s, slot: '장갑', separateCrit: true });
  assert.equal(glove.scores.STR, 0);
  assert.equal(glove.crit, 3);
});

test('uses only the highest attained threshold in each stat and special family, then one highest sale price', () => {
  const rows = [
    row('str-low', 'STR', 10, 100), row('str-high', 'STR', 13.5, 80),
    row('str-cd', 'STR', 10, 130, 1), row('dex', 'DEX', 10, 110),
  ];
  const result = classifyAdditionalTradeOutcome(rows, { STR: 15, DEX: 12, INT: 0, LUK: 0 }, 2, 0);
  assert.equal(result.winner.id, 'str-cd'); // highest price among eligible families
  assert.deepEqual(new Set(result.eligibleIds), new Set(['str-low', 'str-high', 'str-cd', 'dex']));
  const oneFamily = classifyAdditionalTradeOutcome(rows.slice(0, 2), { STR: 15, DEX: 0, INT: 0, LUK: 0 });
  assert.equal(oneFamily.winner.id, 'str-high'); // never count 10% and 13.5% rows together
});

test('cooldown and glove critical-damage targets are inclusive minimums', () => {
  const cdRows = [row('hat-cd', 'STR', 10, 50, 1)];
  assert.equal(classifyAdditionalTradeOutcome(cdRows, { STR: 10 }, 1, 0).winner.id, 'hat-cd');
  assert.equal(classifyAdditionalTradeOutcome(cdRows, { STR: 10 }, 0.999, 0).winner, null);
  const gloveRows = [row('glove-crit', 'STR', 10, 70, 0, 3)];
  assert.equal(classifyAdditionalTradeOutcome(gloveRows, { STR: 10 }, 0, 3).winner.id, 'glove-crit');
  assert.equal(classifyAdditionalTradeOutcome(gloveRows, { STR: 10 }, 0, 2.999).winner, null);
  assert.equal(additionalTradeScore(['크리티컬 데미지 +3%', '없음', '없음'], { ...base(), slot: '장갑' }).crit, 3);
  assert.equal(additionalTradeScore(['크리티컬 데미지 +3%', '없음', '없음'], { ...base(), slot: '장갑', separateCrit: false }).crit, 0);
});

test('validation rejects bad active rows and ignores preserved inactive grade rows', () => {
  const s = base();
  s.prices.shared = [row('x', 'STR', 10.125, 100)];
  s.prices.에픽 = [{ id: '', stat: 'STR', min: -1, cd: 0, crit: 0, price: -1 }];
  assert.equal(validateAdditionalTradeSettings(s), true);
  s.separateGrades = true;
  assert.throws(() => validateAdditionalTradeSettings(s), /가격 조건 식별값/);
});

test('validation rejects duplicate thresholds, negative prices, and unsupported special fields', () => {
  const s = base();
  s.prices.shared = [row('a', 'STR', 10, 100), row('b', 'STR', 10, 200)];
  assert.throws(() => validateAdditionalTradeSettings(s), /중복/);
  s.prices.shared = [row('a', 'STR', 10, -1)];
  assert.throws(() => validateAdditionalTradeSettings(s), /판매가/);
  s.prices.shared = [row('a', 'STR', 10, 1, 0, 1)];
  assert.throws(() => validateAdditionalTradeSettings(s), /크뎀 가격/);
});

test('aggregates joint outcome distributions and reports shared prices only for reachable grades', () => {
  const s = base();
  s.prices.shared = [row('any-str', 'STR', 0, 100)];
  const result = calculateAdditionalTrade(s);
  for (const grade of ['에픽', '유니크', '레전드리']) {
    const distribution = result.distributions[grade];
    assert.ok(distribution.length < 50); // many joint option outcomes collapse to sale/target buckets
    assert.ok(Math.abs(distribution.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 1e-12);
  }
  assert.deepEqual([...new Set(result.priceRows.map(row => row.grade))], ['에픽 · 공통', '유니크 · 공통', '레전드리 · 공통']);
  for (const row of result.priceRows) {
    assert.ok(row.winningProbability >= 0 && row.winningProbability <= 1);
    assert.equal(row.probability, 1);
  }
});
