import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAME_EFFICIENCIES, scoreStats, solveStopping } from '../flame-engine.mjs';

function close(actual, expected, tolerance = 1e-11) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);
}

test('flame stats use the requested main-stat percentage defaults and configurable efficiencies', () => {
  assert.deepEqual(DEFAULT_FLAME_EFFICIENCIES, { main: 1, sub: 0.1, attack: 3, all: 1.1 });
  close(scoreStats({ main: 100, sub: 50, attack: 10, all: 5 }), 19);
  close(scoreStats({ main: 100, sub: 50, attack: 10, all: 5 }, { main: 2, sub: 0, attack: 1, all: 1 }), 26);
  close(scoreStats({ main: 100 }), 10);
  close(scoreStats({}, { main: 0, sub: 0, attack: 0, all: 0 }), 0);
  assert.throws(() => scoreStats({ main: -1 }), /nonnegative/);
  assert.throws(() => scoreStats({ main: Infinity }), /finite/);
  assert.throws(() => scoreStats({}, { attack: NaN }), /finite/);
});

test('two-point distribution has the exact reservation value and geometric expected cost', () => {
  const result = solveStopping([{ score: 0, p: 0.5 }, { score: 10, p: 0.5 }], 1, 1, 0);
  close(result.threshold, 8);
  assert.equal(result.targetScore, 10);
  assert.equal(result.shouldReset, true);
  close(result.acceptanceProbability, 0.5);
  close(result.expectedAttempts, 2);
  close(result.expectedCost, 2);
  close(result.expectedFinalScore, 10);
  close(result.expectedGain, 10);
  close(result.expectedNetValue, 8);
  close(result.marginalUpgradeValue, 5);
});

test('an indifferent support boundary accepts that result and stops at that current score', () => {
  const distribution = [{ score: 0, p: 0.2 }, { score: 4, p: 0.5 }, { score: 10, p: 0.3 }];
  const result = solveStopping(distribution, 1.8, 1, 0);
  close(result.threshold, 4);
  assert.equal(result.targetScore, 4);
  close(result.acceptanceProbability, 0.8);
  close(result.expectedAttempts, 1.25);
  close(result.expectedFinalScore, 6.25);
  close(result.expectedCost, 2.25);
  close(result.expectedNetValue, 4);
  const stop = solveStopping(distribution, 1.8, 1, 4);
  assert.equal(stop.shouldReset, false);
  assert.equal(stop.expectedFinalScore, 4);
  assert.equal(stop.expectedAttempts, 0);
  assert.equal(stop.expectedGain, 0);
});

test('zero willingness stops; free resets seek the maximum reachable score', () => {
  const distribution = [{ score: 0, p: 0.7 }, { score: 10, p: 0.3 }];
  const zeroValue = solveStopping(distribution, 3, 0, 2);
  assert.equal(zeroValue.shouldReset, false);
  assert.equal(zeroValue.threshold, null);
  assert.equal(zeroValue.expectedFinalScore, 2);
  const free = solveStopping(distribution, 0, 1, 2);
  assert.equal(free.shouldReset, true);
  assert.equal(free.threshold, 10);
  close(free.expectedAttempts, 1 / 0.3);
  assert.equal(free.expectedCost, 0);
  assert.equal(free.expectedFinalScore, 10);
  assert.equal(solveStopping(distribution, 0, 1, 10).shouldReset, false);
});

test('duplicate scores and unnormalized positive masses preserve the solution', () => {
  const distribution = [{ score: 0, p: 2 }, { score: 4, p: 2 }, { score: 4, p: 3 }, { score: 10, p: 3 }, { score: 999, p: 0 }];
  const result = solveStopping(distribution, 1.8, 1, 0);
  close(result.threshold, 4);
  close(result.acceptanceProbability, 0.8);
  close(result.expectedFinalScore, 6.25);
});

test('tiny success probabilities retain the upper tail and its finite reservation value', () => {
  const probability = 1e-14;
  const result = solveStopping([{ score: 0, p: 1 - probability }, { score: 10, p: probability }], 5 * probability, 1, 0);
  close(result.threshold, 5);
  assert.equal(result.targetScore, 10);
  close(result.acceptanceProbability, probability, 1e-20);
  close(result.expectedAttempts, 1 / probability);
  close(result.expectedCost, 5);
  close(result.expectedNetValue, 5);
});

test('reservation value solves Bellman and globally beats every deterministic accepted subset', () => {
  const distribution = [{ score: -2, p: 0.1 }, { score: 1, p: 0.35 }, { score: 5, p: 0.3 }, { score: 11, p: 0.25 }];
  for (const cost of [0.01, 0.5, 1, 2, 4, 20]) {
    for (const price of [0.1, 1, 3]) {
      const result = solveStopping(distribution, cost, price, -10);
      const stopValue = price * result.threshold;
      const continuationValue = -cost + distribution.reduce((sum, outcome) => sum + outcome.p * Math.max(price * outcome.score, stopValue), 0);
      close(stopValue, continuationValue);
      // Independently enumerate all nonempty accept/reject sets. Their
      // expected final utility is (sum accepted p*v*x - cost)/P(accepted).
      let best = -Infinity;
      for (let mask = 1; mask < 1 << distribution.length; mask++) {
        let mass = 0;
        let reward = 0;
        for (let index = 0; index < distribution.length; index++) {
          if (mask & (1 << index)) {
            mass += distribution[index].p;
            reward += distribution[index].p * price * distribution[index].score;
          }
        }
        best = Math.max(best, (reward - cost) / mass);
      }
      close(stopValue, best);
      for (const current of [-10, -2, 0, 1, 3, 5, 10, 11, 20]) {
        const state = solveStopping(distribution, cost, price, current);
        const value = Math.max(price * current, best);
        close(price * current + state.expectedNetValue, value);
        assert.equal(state.shouldReset, best > price * current + 1e-11);
        if (state.shouldReset) close(state.expectedNetValue, price * state.expectedGain - state.expectedCost);
      }
    }
  }
});

test('current score affects the decision, never the reservation threshold', () => {
  const distribution = [{ score: 5, p: 0.9 }, { score: 20, p: 0.1 }];
  const lower = solveStopping(distribution, 1, 1, 4);
  const upper = solveStopping(distribution, 1, 1, 15);
  close(lower.threshold, 10);
  close(upper.threshold, 10);
  assert.equal(lower.shouldReset, true);
  assert.equal(upper.shouldReset, false);
  assert.equal(upper.expectedFinalScore, 15);
});

test('large finite willingness still compares upgrade value without overflow', () => {
  const result = solveStopping([{ score: 0, p: 0.5 }, { score: 10, p: 0.5 }], 1, 1e308, 0);
  assert.equal(result.shouldReset, true);
  assert.equal(result.targetScore, 10);
  assert.equal(result.expectedAttempts, 2);
});

test('invalid distribution and numeric inputs fail before calculating', () => {
  const distribution = [{ score: 5, p: 1 }];
  for (const invalid of [[], [{ score: 5, p: 0 }], [{ score: 5, p: -1 }], [{ score: Infinity, p: 1 }], [{ score: 5, p: NaN }]]) {
    assert.throws(() => solveStopping(invalid, 1, 1, 0));
  }
  assert.throws(() => solveStopping(distribution, -1, 1, 0));
  assert.throws(() => solveStopping(distribution, 1, -1, 0));
  assert.throws(() => solveStopping(distribution, 1, 1, Infinity));
  assert.throws(() => solveStopping(distribution, 1, '1', 0));
});
