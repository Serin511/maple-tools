import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdditionalTrade,
  DEFAULT_ADDITIONAL_TRADE_SETTINGS,
} from '../additional-trade-calculator.mjs';

const settings = () => structuredClone(DEFAULT_ADDITIONAL_TRADE_SETTINGS);
const price = (id, stat, min, value, cd = 0, crit = 0) => ({ id, stat, min, price: value, cd, crit });
const close = (actual, expected, tolerance = 1e-7) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `${actual} != ${expected}`,
);

test('full Epic input uses the real probability tables and accepts both current pity caps', () => {
  const input = settings();
  input.startGrade = '에픽';
  input.stacks = { 에픽: input.pity.에픽, 유니크: input.pity.유니크 };

  const result = calculateAdditionalTrade(input);

  assert.equal(result.possible, false); // No market targets were entered.
  assert.match(result.reason, /판매 가능한 결과/);
  for (const grade of ['에픽', '유니크', '레전드리']) {
    const mass = result.distributions[grade].reduce((sum, outcome) => sum + outcome.probability, 0);
    close(mass, 1);
  }
});

test('shared STR threshold is unreachable in Epic and Unique but reachable in Legendary', () => {
  const input = settings();
  input.startGrade = '에픽';
  input.prices.shared = [price('str-19', 'STR', 19, 1e12)];
  // Move directly through the two grade-ups so the only sale chance is the
  // rare Legendary result; this also exercises a long but finite first sale.
  input.upRates = { 에픽: 1, 유니크: 1 };
  input.pity = { 에픽: 0, 유니크: 0 };
  input.stacks = { 에픽: 0, 유니크: 0 };
  input.autoSell = false;

  const result = calculateAdditionalTrade(input);
  const rows = result.priceRows;
  const epic = rows.find(row => row.grade.startsWith('에픽'));
  const unique = rows.find(row => row.grade.startsWith('유니크'));
  const legendary = rows.find(row => row.grade.startsWith('레전드리'));

  assert.equal(epic.probability, 0);
  assert.equal(unique.probability, 0);
  assert.ok(legendary.probability > 0);
  close(result.current.finalGrades.레전드리, 1);
  // The initial Epic reset upgrades before drawing the first Unique options,
  // then the next reset draws Legendary options and starts the geometric wait.
  close(result.current.expectedAttempts, 1 + 1 / legendary.winningProbability, 2e-6);
});

test('grade-specific price rows are validated and applied only to their own grade', () => {
  const input = settings();
  input.startGrade = '에픽';
  input.separateGrades = true;
  input.autoSell = false;
  input.prices = {
    shared: [],
    에픽: [price('epic-str', 'STR', 0, 11)],
    유니크: [price('unique-str', 'STR', 0, 22)],
    레전드리: [price('legend-str', 'STR', 0, 33)],
  };
  const result = calculateAdditionalTrade(input);
  for (const [grade, id, amount] of [['에픽', 'epic-str', 11], ['유니크', 'unique-str', 22], ['레전드리', 'legend-str', 33]]) {
    const distribution = result.distributions[grade];
    assert.ok(distribution.length > 0);
    assert.ok(distribution.every(outcome => outcome.targetId === id && outcome.price === amount));
    const row = result.priceRows.find(candidate => candidate.grade === grade && candidate.id === id);
    assert.equal(row.probability, 1);
    assert.equal(row.winningProbability, 1);
  }
});

test('an Epic priced outcome can sell and re-enter at Epic with its failure stack intact', () => {
  const input = settings();
  input.startGrade = '에픽';
  input.autoSell = false;
  input.itemPrice = 0;
  input.fee = 0;
  input.separateGrades = true;
  input.prices = { shared: [], 에픽: [price('epic', 'STR', 0, 10)], 유니크: [price('unique', 'STR', 0, 20)], 레전드리: [] };
  input.upRates = { 에픽: 0, 유니크: 0 };
  input.pity = { 에픽: 1, 유니크: 1 };
  input.stacks = { 에픽: 0, 유니크: 0 };
  const result = calculateAdditionalTrade(input);

  assert.equal(result.decisions.length, 1);
  assert.equal(result.decisions[0].sourceGrade, '에픽');
  assert.equal(result.decisions[0].resultGrade, '에픽');
  assert.equal(result.decisions[0].action, 'sell');
  close(result.current.expectedAttempts, 1);
  close(result.current.expectedRevenue, 10);
  close(result.current.finalGrades.에픽, 1);
  // Selling the first failed Epic result re-enters Epic at stack 1. That next
  // reset is forced upward and its Unique option is sold as another item.
  const reentry = result.actionSummaries.find(row => row.grade === '에픽' && row.stacks.에픽 === 1);
  assert.ok(reentry);
  close(reentry.sellProbability, 1);
  close(result.steady.finalGrades.에픽, .5);
  close(result.steady.finalGrades.유니크, .5);
});

test('actual rare hat 3-second cooldown and glove 9% critical damage have finite exact waits', () => {
  const cases = [
    { slot: '모자', cd: 3, crit: 0, id: 'hat-cd-3', expectedAttempts: 323093356.1466614 },
    { slot: '장갑', cd: 0, crit: 9, id: 'glove-crit-9', expectedAttempts: 1037789895.2762289 },
  ];

  for (const scenario of cases) {
    const input = settings();
    input.slot = scenario.slot;
    input.startGrade = '레전드리';
    input.prices.shared = [price(scenario.id, 'STR', 0, 1e16, scenario.cd, scenario.crit)];
    input.costs.레전드리 = 1;
    input.itemPrice = 0;
    input.fee = 0;
    input.autoSell = false;
    input.separateCrit = true;

    const result = calculateAdditionalTrade(input);
    const probability = result.priceRows[0].winningProbability;
    assert.ok(probability > 0 && probability < 1);
    close(result.current.expectedAttempts, 1 / probability, 2e-6);
    close(result.current.expectedCost, 1 / probability, 2e-6);
    close(result.current.expectedRevenue, 1e16, 2e-6);
    close(result.steady.expectedAttempts, 1 / probability, 2e-6);
    close(result.current.finalGrades.레전드리, 1);
    // Pin the independently enumerated published-table probabilities so a
    // change in the source data or cooldown/crit condition is visible.
    close(probability, 1 / scenario.expectedAttempts, 2e-6);
  }
});

test('all four main-stat price conditions form one mutually exclusive sale outcome', () => {
  const input = settings();
  input.startGrade = '레전드리';
  input.prices.shared = [
    price('str', 'STR', 0, 100), price('dex', 'DEX', 0, 200),
    price('int', 'INT', 0, 300), price('luk', 'LUK', 0, 400),
  ];
  input.itemPrice = 25;
  input.fee = 10;
  input.costs.레전드리 = 10;
  input.autoSell = false;

  const result = calculateAdditionalTrade(input);

  assert.equal(result.priceRows.length, 4);
  assert.ok(result.priceRows.every(row => row.probability === 1));
  assert.equal(result.priceRows.find(row => row.id === 'luk').winningProbability, 1);
  assert.ok(result.priceRows.filter(row => row.id !== 'luk').every(row => row.winningProbability === 0));
  close(result.current.expectedRevenue, 400);
  close(result.current.expectedNetRevenue, 360);
  close(result.current.expectedCost, 10);
  close(result.current.expectedAttempts, 1);
  close(result.current.expectedProfit, 325);
});

test('grade-specific prices and money scaling preserve the same sale policy', () => {
  const shared = settings();
  shared.startGrade = '레전드리';
  shared.prices.shared = [price('str-10', 'STR', 10, 100), price('str-20', 'STR', 20, 200)];
  shared.itemPrice = 150;
  shared.costs.레전드리 = 3;
  shared.autoSell = true;

  const bySharedPrice = calculateAdditionalTrade(shared);
  const separate = structuredClone(shared);
  separate.separateGrades = true;
  separate.prices.레전드리 = [price('str-10', 'STR', 10, 100), price('str-20', 'STR', 20, 500)];
  const byGradePrice = calculateAdditionalTrade(separate);

  assert.ok(bySharedPrice.decisions.some(row => row.targetId === 'str-10' && row.action === 'hold'));
  assert.ok(bySharedPrice.decisions.some(row => row.targetId === 'str-20' && row.action === 'sell'));
  assert.ok(byGradePrice.current.expectedProfit > bySharedPrice.current.expectedProfit);

  const scaled = structuredClone(shared);
  const factor = 10;
  scaled.itemPrice *= factor;
  scaled.costs.레전드리 *= factor;
  scaled.prices.shared = scaled.prices.shared.map(row => ({ ...row, price: row.price * factor }));
  const byScaledPrice = calculateAdditionalTrade(scaled);
  assert.deepEqual(
    byScaledPrice.decisions.map(row => row.action),
    bySharedPrice.decisions.map(row => row.action),
  );
  close(byScaledPrice.steady.profitPerReset, factor * bySharedPrice.steady.profitPerReset, 2e-6);
});

test('fixed sell policy matches exact geometric current-item totals and invalid/no-target inputs are explicit', () => {
  const input = settings();
  input.startGrade = '레전드리';
  input.prices.shared = [price('always', 'STR', 0, 500)];
  input.itemPrice = 100;
  input.fee = 5;
  input.costs.레전드리 = 40;
  input.autoSell = false;
  const sold = calculateAdditionalTrade(input);
  close(sold.current.expectedAttempts, 1);
  close(sold.current.expectedCost, 40);
  close(sold.current.expectedNetRevenue, 475);
  close(sold.current.expectedProfit, 335);

  const noTargets = settings();
  const none = calculateAdditionalTrade(noTargets);
  assert.equal(none.possible, false);
  assert.match(none.reason, /가격 조건/);

  const invalid = settings();
  invalid.prices.shared = [price('bad', 'STR', -1, 100)];
  assert.throws(() => calculateAdditionalTrade(invalid), /목표 환산값/);
});

test('a negative automatic-sale policy keeps the item and exposes an explicit sell-everything comparison', () => {
  const input = settings();
  input.startGrade = '레전드리';
  input.prices.shared = [price('loss', 'STR', 0, 100)];
  input.itemPrice = 1_000;
  input.costs.레전드리 = 10;
  input.fee = 0;
  input.autoSell = true;

  const result = calculateAdditionalTrade(input);

  assert.equal(result.steady.possible, false);
  assert.equal(result.current.possible, false);
  assert.ok(result.fallback);
  close(result.fallback.current.expectedAttempts, 1);
  close(result.fallback.current.expectedProfit, -910);
  assert.match(result.reason, /판매하지 않아/);
});

test('real-table Prime auto compares every possible first line and retains the winning fixed-line identity', () => {
  const input = settings();
  input.startGrade = '레전드리'; input.itemPrice = 0; input.fee = 0;
  input.prices.shared = [price('str-19', 'STR', 19, 1e12)];
  input.costs.레전드리 = 1e8;
  input.prime = { on: true, cost: 1, fixedKey: 'auto' };
  const result = calculateAdditionalTrade(input);
  assert.equal(result.primeOptimization.selectedFixedKey, 'STR +8%');
  assert.equal(result.primeOptimization.reason, 'selected');
  assert.ok(result.current.expectedPrimeAttempts > 0);
  assert.ok(result.primeOptimization.candidates.length > 10);
  close(result.steady.profitPerReset, Math.max(...result.primeOptimization.candidates.map(candidate => candidate.objectiveValue)));
  close(result.steady.profitPerReset, result.current.expectedProfit / result.current.expectedAttempts);
  assert.ok(result.distributions.레전드리.every(row => typeof row.firstKey === 'string'));
  assert.ok(result.decisions.filter(row => row.action === 'prime').every(row => row.firstKey === result.primeOptimization.selectedFixedKey));
  // Equal-price rolls from different first lines remain separate entry events.
  assert.ok(result.distributions.레전드리.filter(row => row.price === null).length > 1);
  assert.match(result.warnings.at(-1), /일반 에디셔널 레전드리 확률표/);
});

test('Prime uses Legendary price banks and keeps the ordinary off-mode distributions unchanged', () => {
  const input = settings(); input.startGrade = '레전드리'; input.itemPrice = 0; input.fee = 0;
  input.costs.레전드리 = 100; input.prices.shared = [price('shared', 'STR', 0, 1e5)];
  const ordinary = calculateAdditionalTrade(input);
  const inactive = calculateAdditionalTrade({ ...input, prime: { on: false, cost: -1, fixedKey: 'invalid' } });
  assert.deepEqual(inactive, ordinary);
  input.separateGrades = true;
  input.prices.레전드리 = [price('legend', 'STR', 19, 1e10)];
  input.prices.에픽 = [price('epic', 'STR', 0, 1e16)];
  input.prime = { on: true, cost: 1, fixedKey: 'STR +8%' };
  const result = calculateAdditionalTrade(input);
  close(result.current.expectedRevenue, 1e10);
  assert.ok(result.current.expectedPrimeAttempts > 0);
  assert.ok(result.distributions.레전드리.filter(row => row.price !== null).every(row => row.price === 1e10));
});

test('Prime defaults to fourteen hundred million and rejects invalid active costs and fixed options', () => {
  const input = settings();
  assert.deepEqual(input.prime, { on: false, cost: 1.4e9, fixedKey: 'auto' });
  for (const prime of [{ on: true, cost: -1, fixedKey: 'auto' }, { on: true, cost: 1, fixedKey: 'missing' }]) {
    assert.throws(() => calculateAdditionalTrade({ ...input, prime }), /프라임|첫 줄/);
  }
});
