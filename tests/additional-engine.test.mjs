import test from 'node:test';
import assert from 'node:assert/strict';
import { solveAdditionalStrategy, evaluateAdditionalThresholds } from '../additional-engine.mjs';

const delta = (score) => [{ score, probability: 1 }];
const coin = [{ score: 0, probability: .5 }, { score: 10, probability: .5 }];
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function settings(overrides = {}) {
  return {
    distributions: { 에픽: { reset: coin, strange: coin }, 유니크: { reset: coin }, 레전드리: { reset: coin } },
    costs: { 에픽: 1, 유니크: 1, 레전드리: 1 }, strangeCost: 2,
    mesoPerPercent: 1, upRates: { 에픽: 0, 유니크: 0 }, pity: { 에픽: 2, 유니크: 3 },
    stacks: { 에픽: 0, 유니크: 0 }, currentGrade: '레전드리', currentScore: 0, strategy: 'reset',
    ...overrides,
  };
}

test('stationary replacement and retained resets agree with a geometric calculation', () => {
  for (const retainPaid of [false, true]) {
    const r = solveAdditionalStrategy(settings({ retainPaid }));
    assert.equal(r.action, 'reset'); close(r.expectedAttempts, 2); close(r.expectedCost, 2);
    close(r.expectedFinalScore, 10); close(r.netValue, 8); assert.equal(r.currentCutoff, 10);
    assert.deepEqual(r.finalGradeProbabilities, { 에픽: 0, 유니크: 0, 레전드리: 1 });
  }
});

test('an already valuable current result stops, including one outside the draw support', () => {
  const r = solveAdditionalStrategy(settings({ currentScore: 20 }));
  assert.equal(r.action, 'stop'); assert.equal(r.expectedCost, 0); assert.equal(r.expectedFinalScore, 20); assert.equal(r.netValue, 0);
  const indifferent = solveAdditionalStrategy(settings({ currentScore: 8 }));
  assert.equal(indifferent.action, 'stop');
});

test('free strange cubes reach their finite maximum without an infinite-loop policy', () => {
  const cfg = {
    strategy: 'strange', currentGrade: '에픽', currentScore: 0, mesoPerPercent: 100000000, strangeCost: 0,
    distributions: { 에픽: { strange: [{ score: 0, probability: .75 }, { score: 12, probability: .25 }] } },
  };
  const r = solveAdditionalStrategy(cfg);
  assert.equal(r.action, 'strange'); close(r.strangeAttempts, 4); close(r.expectedFinalScore, 12);
  assert.equal(r.expectedCost, 0); assert.equal(r.currentCutoff, 12);
  assert.equal(solveAdditionalStrategy({ ...cfg, currentScore: 12 }).action, 'stop');
});

test('pity means max failures then forced upgrade and consumes only paid rolls', () => {
  const cfg = settings({ currentGrade: '에픽', distributions: { 에픽: { reset: delta(0), strange: delta(8) }, 유니크: { reset: delta(10) }, 레전드리: { reset: delta(20) } }, costs: { 에픽: 1, 유니크: 100, 레전드리: 100 } });
  const paid = solveAdditionalStrategy(cfg);
  close(paid.resetAttempts, 3); close(paid.expectedCost, 3); close(paid.expectedFinalScore, 10);
  assert.equal(paid.currentCutoff, Infinity);
  const progressed = solveAdditionalStrategy({ ...cfg, stacks: { 에픽: 1, 유니크: 0 } });
  close(progressed.resetAttempts, 2);
  const mixed = solveAdditionalStrategy({ ...cfg, strategy: 'mixed', strangeCost: 0 });
  assert.equal(mixed.action, 'strange'); close(mixed.expectedFinalScore, 8); close(mixed.resetAttempts, 0);
  const nearUpgrade = solveAdditionalStrategy({ ...cfg, strategy: 'mixed', strangeCost: 0, stacks: { 에픽: 2, 유니크: 0 } });
  assert.equal(nearUpgrade.action, 'reset'); close(nearUpgrade.expectedFinalScore, 10); close(nearUpgrade.resetAttempts, 1);
});

test('a saved next-grade pity stack is used and gradeup always draws the new grade', () => {
  const cfg = settings({
    currentGrade: '에픽', currentScore: 5, retainPaid: true,
    distributions: { 에픽: { reset: delta(50) }, 유니크: { reset: delta(0) }, 레전드리: { reset: delta(100) } },
    pity: { 에픽: 0, 유니크: 5 }, stacks: { 에픽: 0, 유니크: 5 },
  });
  const r = evaluateAdditionalThresholds(cfg, { thresholds: { 에픽: Infinity, 유니크: Infinity, 레전드리: 100 } });
  close(r.resetAttempts, 2); close(r.expectedFinalScore, 100); close(r.expectedCost, 2);
  const forced = evaluateAdditionalThresholds(cfg, { thresholds: { 에픽: Infinity, 유니크: 0, 레전드리: 100 } });
  close(forced.resetAttempts, 1); close(forced.expectedFinalScore, 0);
});

test('miracle doubles ordinary gradeup chance and leaves forced pity unchanged', () => {
  const cfg = settings({ currentGrade: '에픽', distributions: { 에픽: { reset: delta(0) }, 유니크: { reset: delta(10) }, 레전드리: { reset: delta(10) } }, upRates: { 에픽: .25, 유니크: 0 }, pity: { 에픽: 2, 유니크: 0 }, costs: { 에픽: 1, 유니크: 100, 레전드리: 100 } });
  close(solveAdditionalStrategy(cfg).resetAttempts, 1 + .75 + .75 ** 2);
  close(solveAdditionalStrategy({ ...cfg, miracle: true }).resetAttempts, 1 + .5 + .5 ** 2);
  const forced = { ...cfg, stacks: { 에픽: 2, 유니크: 0 } };
  close(solveAdditionalStrategy(forced).resetAttempts, 1);
  close(solveAdditionalStrategy({ ...forced, miracle: true }).resetAttempts, 1);
});

test('manual threshold policies report impossible infinite targets and zero-price retries', () => {
  const unreachable = evaluateAdditionalThresholds(settings(), { thresholds: { 에픽: Infinity, 유니크: Infinity, 레전드리: 11 } });
  assert.equal(unreachable.possible, false); assert.equal(unreachable.expectedAttempts, Infinity);
  assert.equal(unreachable.expectedCost, Infinity); assert.equal(unreachable.expectedFinalScore, null);
  const free = evaluateAdditionalThresholds(settings({ currentGrade: '에픽', strategy: 'mixed', strangeCost: 0 }), { thresholds: { 에픽: 11, 유니크: 0, 레전드리: 0 }, epicAction: 'strange' });
  assert.equal(free.possible, false); assert.equal(free.expectedCost, 0); assert.equal(free.strangeAttempts, Infinity);
  const stop = evaluateAdditionalThresholds(settings({ currentScore: 20 }), { thresholds: { 에픽: Infinity, 유니크: Infinity, 레전드리: 11 } });
  assert.equal(stop.action, 'stop'); assert.equal(stop.possible, true);
});

test('manual policies expose partial termination when a higher-grade target is impossible', () => {
  const cfg = settings({ currentGrade: '유니크', upRates: { 에픽: 0, 유니크: .5 }, pity: { 에픽: 0, 유니크: 1 } });
  const r = evaluateAdditionalThresholds(cfg, { thresholds: { 에픽: Infinity, 유니크: 10, 레전드리: 11 } });
  assert.equal(r.possible, false); close(r.completionProbability, .25);
  assert.equal(r.expectedCost, Infinity); assert.equal(r.expectedAttempts, Infinity);
  assert.ok(!Number.isNaN(r.expectedCost));
});

test('manual geometric success matches cost, final score and grade probabilities', () => {
  const cfg = settings({ currentGrade: '에픽', strategy: 'mixed', strangeCost: 3 });
  const r = evaluateAdditionalThresholds(cfg, { thresholds: { 에픽: 10, 유니크: 10, 레전드리: 10 }, epicAction: 'strange' });
  assert.equal(r.possible, true); close(r.strangeAttempts, 2); close(r.expectedCost, 6);
  close(r.expectedFinalScore, 10); close(r.netValue, 4); close(r.finalGradeProbabilities.에픽, 1);
});

// Independent finite-state value iteration (including old/new retention and
// strange self-loops) checks the backward solver over every score and stack.
function bruteValues(cfg) {
  const grades = ['에픽', '유니크', '레전드리'], scores = [0, 3, 8];
  const states = [], lookup = new Map();
  for (let g = 0; g < 3; g++) for (let k = 0; k <= (g === 2 ? 0 : cfg.pity[grades[g]]); k++) for (const score of scores) {
    const s = { g, k, score, value: score * cfg.mesoPerPercent }; lookup.set(`${g}/${k}/${score}`, s); states.push(s);
  }
  const value = (g, k, score) => lookup.get(`${g}/${k}/${score}`).value;
  for (let pass = 0; pass < 2000; pass++) {
    let residual = 0;
    for (const s of states) {
      const grade = grades[s.g];
      let paid = -cfg.costs[grade];
      const up = s.g === 2 ? 0 : s.k === cfg.pity[grade] ? 1 : Math.min(1, cfg.upRates[grade] * (cfg.miracle ? 2 : 1));
      if (up) for (const d of cfg.distributions[grades[s.g + 1]].reset) paid += up * d.probability * value(s.g + 1, cfg.stacks[grades[s.g + 1]] ?? 0, d.score);
      if (up < 1) for (const d of cfg.distributions[grade].reset) paid += (1 - up) * d.probability * value(s.g, s.g === 2 ? 0 : s.k + 1, cfg.retainPaid ? Math.max(s.score, d.score) : d.score);
      let best = Math.max(s.score * cfg.mesoPerPercent, paid);
      if (s.g === 0) {
        const strange = -cfg.strangeCost + cfg.distributions.에픽.strange.reduce((v, d) => v + d.probability * value(0, s.k, d.score), 0);
        best = Math.max(best, strange);
      }
      residual = Math.max(residual, Math.abs(s.value - best)); s.value = best;
    }
    if (residual < 1e-12) return states;
  }
  throw new Error('Independent value iteration did not converge');
}

test('all grade/pity/score states agree with independent Bellman iteration', () => {
  const reset = [{ score: 0, probability: .4 }, { score: 3, probability: .4 }, { score: 8, probability: .2 }];
  const strange = [{ score: 0, probability: .2 }, { score: 3, probability: .7 }, { score: 8, probability: .1 }];
  for (const retainPaid of [false, true]) for (const miracle of [false, true]) {
    const cfg = settings({ strategy: 'mixed', retainPaid, miracle, distributions: { 에픽: { reset, strange }, 유니크: { reset }, 레전드리: { reset } }, costs: { 에픽: .3, 유니크: .7, 레전드리: 1.3 }, strangeCost: .4, upRates: { 에픽: .1, 유니크: .2 }, pity: { 에픽: 2, 유니크: 2 } });
    for (const state of bruteValues(cfg)) {
      const grade = ['에픽', '유니크', '레전드리'][state.g];
      const r = solveAdditionalStrategy({ ...cfg, currentGrade: grade, currentScore: state.score, stacks: { ...cfg.stacks, [grade]: state.k } });
      close(r.expectedFinalValue, state.value, 1e-8);
      close(Object.values(r.finalGradeProbabilities).reduce((a, b) => a + b, 0), 1);
      assert.ok(r.netValue >= -1e-8);
      assert.ok(r.expectedCost >= 0);
    }
  }
});

test('zero valuation stops and malformed inputs fail explicitly', () => {
  assert.equal(solveAdditionalStrategy(settings({ mesoPerPercent: 0 })).action, 'stop');
  for (const mesoPerPercent of [-1, NaN, Infinity, '']) assert.throws(() => solveAdditionalStrategy(settings({ mesoPerPercent })));
  assert.throws(() => solveAdditionalStrategy(settings({ currentGrade: '에픽', pity: { 에픽: Infinity, 유니크: 0 } })));
  assert.throws(() => solveAdditionalStrategy(settings({ currentGrade: '에픽', stacks: { 에픽: 99, 유니크: 0 } })));
  assert.throws(() => solveAdditionalStrategy(settings({ currentGrade: '에픽', upRates: { 에픽: 2, 유니크: 0 } })));
  assert.throws(() => solveAdditionalStrategy(settings({ currentGrade: '에픽', distributions: { 에픽: { reset: [{ score: 0, probability: .3 }] } } })));
});

test('only reachable grades require rules and distributions', () => {
  const cfg = { currentGrade: '레전드리', currentScore: 0, mesoPerPercent: 1, strategy: 'reset', distributions: { 레전드리: { reset: coin } }, costs: { 레전드리: 1 } };
  close(solveAdditionalStrategy(cfg).expectedCost, 2);
  close(evaluateAdditionalThresholds(cfg, { thresholds: { 레전드리: 10 } }).expectedCost, 2);
  assert.equal(solveAdditionalStrategy(cfg).thresholds.length, 1);
});

test('compact action ranges merge adjacent attainable scores without interpolating boundaries', () => {
  const strange = [{ score: 1, probability: .5 }, { score: 7, probability: .4 }, { score: 13, probability: .1 }];
  const cfg = { currentGrade: '에픽', currentScore: .25, mesoPerPercent: 1, strategy: 'strange', strangeCost: 0, distributions: { 에픽: { strange } } };
  const r = solveAdditionalStrategy(cfg);
  assert.deepEqual(r.currentActionRanges, [
    { minScore: 1, maxScore: 7, action: 'strange' },
    { minScore: 13, maxScore: 13, action: 'stop' },
  ]);
  assert.deepEqual(r.thresholds[0].actionRanges, r.currentActionRanges);
  const manual = evaluateAdditionalThresholds(cfg, { thresholds: { 에픽: 6 }, epicAction: 'strange' });
  assert.deepEqual(manual.currentActionRanges, [
    { minScore: 1, maxScore: 1, action: 'strange' },
    { minScore: 7, maxScore: 13, action: 'stop' },
  ]);
  assert.equal(manual.currentCutoff, 6);
});

test('a mixed strategy exposes pity-dependent strange and reset action ranges', () => {
  const cfg = settings({ currentGrade: '에픽', strategy: 'mixed', retainPaid: true, strangeCost: 0,
    distributions: { 에픽: { reset: delta(0), strange: delta(8) }, 유니크: { reset: delta(10) }, 레전드리: { reset: delta(20) } },
    costs: { 에픽: 1, 유니크: 100, 레전드리: 100 } });
  const r = solveAdditionalStrategy(cfg);
  assert.deepEqual(r.currentActionRanges, [
    { minScore: 0, maxScore: 0, action: 'strange' },
    { minScore: 8, maxScore: 8, action: 'stop' },
  ]);
  assert.deepEqual(r.thresholds.find(row => row.grade === '에픽' && row.stack === 2).actionRanges,
    [{ minScore: 0, maxScore: 8, action: 'reset' }]);
});
