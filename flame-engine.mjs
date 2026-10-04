/**
 * Values are measured in equivalent main-stat percentage points.
 * The first three efficiency inputs are the value of 10 points; all is the
 * value of one percentage point of all-stat bonus.
 */
export const DEFAULT_FLAME_EFFICIENCIES = Object.freeze({
  main: 1,
  sub: 0.1,
  attack: 3,
  all: 1.1,
});

function finiteNumber(value, name, { nonnegative = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0)) {
    throw new RangeError(`${name} must be a finite${nonnegative ? ' nonnegative' : ''} number`);
  }
  return value;
}

function accumulator() {
  let sum = 0;
  let correction = 0;
  return {
    add(value) {
      const adjusted = value - correction;
      const next = sum + adjusted;
      correction = (next - sum) - adjusted;
      sum = next;
    },
    value() { return sum; },
  };
}

export function scoreStats(stats, efficiencies = DEFAULT_FLAME_EFFICIENCIES) {
  if (!stats || typeof stats !== 'object') throw new TypeError('stats must be an object');
  if (!efficiencies || typeof efficiencies !== 'object') throw new TypeError('efficiencies must be an object');
  let score = 0;
  for (const key of ['main', 'sub', 'attack', 'all']) {
    const amount = finiteNumber(stats[key] ?? 0, `stats.${key}`, { nonnegative: true });
    const efficiency = finiteNumber(efficiencies[key] ?? DEFAULT_FLAME_EFFICIENCIES[key], `efficiencies.${key}`, { nonnegative: true });
    score += amount * efficiency / (key === 'all' ? 1 : 10);
  }
  if (!Number.isFinite(score)) throw new RangeError('The converted stat score is too large');
  return score;
}

function normalizeDistribution(distribution) {
  if (!Array.isArray(distribution) || distribution.length === 0) {
    throw new RangeError('distribution must contain at least one outcome');
  }
  const total = accumulator();
  const outcomes = distribution.map((outcome, index) => {
    if (!outcome || typeof outcome !== 'object') throw new TypeError(`distribution[${index}] must be an object`);
    const score = finiteNumber(outcome.score, `distribution[${index}].score`);
    const p = finiteNumber(outcome.p, `distribution[${index}].p`, { nonnegative: true });
    total.add(p);
    return { ...outcome, score, p };
  });
  const mass = total.value();
  if (!(mass > 0) || !Number.isFinite(mass)) throw new RangeError('distribution must have finite positive total probability');
  const normalized = outcomes.filter(outcome => outcome.p > 0).map(outcome => ({ ...outcome, p: outcome.p / mass }));
  normalized.sort((a, b) => a.score - b.score);
  const support = [];
  for (const outcome of normalized) {
    const previous = support.at(-1);
    if (previous?.score === outcome.score) previous.mass.add(outcome.p);
    else {
      const sum = accumulator();
      sum.add(outcome.p);
      support.push({ score: outcome.score, mass: sum });
    }
  }
  return { outcomes: normalized, support: support.map(item => ({ score: item.score, p: item.mass.value() })) };
}

function expectedUpgrade(support, score) {
  const sum = accumulator();
  for (const outcome of support) {
    if (outcome.score > score) sum.add(outcome.p * (outcome.score - score));
  }
  return sum.value();
}

/** Find t with E[(X - t)+] = budget, without subtracting large weighted scores. */
function reservationScore(support, budget) {
  let upper = support.at(-1).score;
  const probability = accumulator();
  probability.add(support.at(-1).p);
  const excess = accumulator();
  for (let index = support.length - 2; index >= 0; index--) {
    const lower = support[index].score;
    const increase = probability.value() * (upper - lower);
    const atLower = excess.value() + increase;
    const tolerance = 16 * Number.EPSILON * Math.max(Math.abs(budget), Math.abs(atLower));
    if (budget <= atLower + tolerance) {
      const threshold = upper - (budget - excess.value()) / probability.value();
      // At a support boundary, retain the indifferent outcome. It minimizes
      // attempts without changing expected net value.
      return Math.max(lower, Math.min(upper, threshold));
    }
    excess.add(increase);
    probability.add(support[index].p);
    upper = lower;
  }
  return upper - (budget - excess.value()) / probability.value();
}

/**
 * Optimal IID, unlimited-horizon stopping rule for a constant reset cost.
 * Stop at scores >= t, where v * E[(X - t)+] = resetCost. Each complete
 * outcome is accepted or rejected as a whole. This rule applies both when
 * rerolls replace the previous result and when the best result can be kept.
 * Current scores may be any finite number; stat conversion itself is >= 0.
 */
export function solveStopping(distribution, resetCost, mesoPerPercent, currentScore) {
  finiteNumber(resetCost, 'resetCost', { nonnegative: true });
  finiteNumber(mesoPerPercent, 'mesoPerPercent', { nonnegative: true });
  finiteNumber(currentScore, 'currentScore');
  const { outcomes, support } = normalizeDistribution(distribution);
  const nextAttemptExpectedUpgrade = expectedUpgrade(support, currentScore);
  const marginalUpgradeValue = nextAttemptExpectedUpgrade * mesoPerPercent;

  if (mesoPerPercent === 0 || !Number.isFinite(resetCost / mesoPerPercent)) {
    return {
      threshold: null,
      targetScore: null,
      shouldReset: false,
      acceptanceProbability: 0,
      expectedAttempts: 0,
      expectedCost: 0,
      expectedFinalScore: currentScore,
      expectedGain: 0,
      expectedNetValue: 0,
      nextAttemptExpectedUpgrade,
      marginalUpgradeValue,
      examples: [],
    };
  }

  const threshold = reservationScore(support, resetCost / mesoPerPercent);
  const targetScore = support.find(outcome => outcome.score >= threshold)?.score ?? support.at(-1).score;
  const accepted = outcomes.filter(outcome => outcome.score >= targetScore);
  const acceptanceMass = accumulator();
  const acceptedExcess = accumulator();
  for (const outcome of accepted) {
    acceptanceMass.add(outcome.p);
    acceptedExcess.add(outcome.p * (outcome.score - targetScore));
  }
  const acceptanceProbability = acceptanceMass.value();
  // Compare in score units so a very large willingness does not overflow
  // both the upgrade value and its comparison tolerance to Infinity.
  const scoreBudget = resetCost / mesoPerPercent;
  const comparisonTolerance = 16 * Number.EPSILON * Math.max(nextAttemptExpectedUpgrade, scoreBudget);
  const shouldReset = nextAttemptExpectedUpgrade > scoreBudget + comparisonTolerance;
  const expectedAttempts = shouldReset ? 1 / acceptanceProbability : 0;
  const expectedCost = shouldReset ? resetCost / acceptanceProbability : 0;
  const expectedFinalScore = shouldReset ? targetScore + acceptedExcess.value() / acceptanceProbability : currentScore;
  const expectedGain = expectedFinalScore - currentScore;
  const expectedNetValue = shouldReset ? mesoPerPercent * (threshold - currentScore) : 0;
  const examples = accepted.slice(0, 6).map(outcome => ({
    ...outcome,
    conditionalProbability: outcome.p / acceptanceProbability,
  }));

  return {
    threshold,
    targetScore,
    shouldReset,
    acceptanceProbability,
    expectedAttempts,
    expectedCost,
    expectedFinalScore,
    expectedGain,
    expectedNetValue,
    nextAttemptExpectedUpgrade,
    marginalUpgradeValue,
    examples,
  };
}
