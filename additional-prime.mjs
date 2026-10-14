import {
  getAdditionalLines,
  scoreAdditionalOption,
  validateAdditionalScoreSettings,
} from './additional-data.mjs';

/**
 * Prime Additional fixes one Legendary first-line option and rerolls the
 * remaining two lines. The line marginals are the archived reset Legendary
 * tables; the caller compares the old and new complete option tuples.
 * Candidate keys are published labels, never converted scores: distinct
 * first-line options remain distinct even when the damage model ignores them.
 */
export const DEFAULT_ADDITIONAL_PRIME = Object.freeze({
  on: false,
  cost: 1_400_000_000,
  fixedKey: 'auto',
});

const primeLines = settings => getAdditionalLines({
  ...settings,
  method: 'reset',
  grade: '레전드리',
});

export function listAdditionalPrimeOptions(settings = {}) {
  return (primeLines(settings)?.[0] ?? []).map(row => ({ ...row, key: row.label }));
}

export function normalizeAdditionalPrime(settings = {}, value = settings.prime) {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const candidates = listAdditionalPrimeOptions(settings);
  return {
    on: typeof saved.on === 'boolean' ? saved.on : DEFAULT_ADDITIONAL_PRIME.on,
    cost: typeof saved.cost === 'number' && Number.isFinite(saved.cost) && saved.cost >= 0
      ? saved.cost : DEFAULT_ADDITIONAL_PRIME.cost,
    fixedKey: saved.fixedKey === 'auto' || candidates.some(row => row.key === saved.fixedKey)
      ? saved.fixedKey : DEFAULT_ADDITIONAL_PRIME.fixedKey,
  };
}

export function getAdditionalPrimeLines(settings = {}, fixedKey) {
  const lines = primeLines(settings);
  if (!lines) throw new Error('선택한 부위·레벨 구간의 프라임 에디셔널 큐브 확률표가 없습니다.');
  const fixed = lines[0].find(row => row.label === fixedKey);
  if (!fixed) throw new Error('현재 부위의 레전드리 첫 줄에 가능한 고정 옵션을 선택해 주세요.');
  return [[{ ...fixed, probability: 1, publishedPercent: 100 }], lines[1], lines[2]];
}

const scoreKey = value => Math.round(value * 1e10) / 1e10;

export function buildAdditionalPrimeDistribution(settings, fixedKey) {
  validateAdditionalScoreSettings(settings);
  const lines = getAdditionalPrimeLines(settings, fixedKey);
  let distribution = [{ score: 0, probability: 1, options: [] }];
  for (const line of lines) {
    const marginal = new Map();
    for (const option of line) {
      const score = scoreKey(scoreAdditionalOption(option.label, settings));
      const existing = marginal.get(score);
      if (existing) existing.probability += option.probability;
      else marginal.set(score, { score, probability: option.probability, label: option.label });
    }
    const combined = new Map();
    for (const before of distribution) {
      for (const option of marginal.values()) {
        const score = scoreKey(before.score + option.score);
        const probability = before.probability * option.probability;
        const existing = combined.get(score);
        if (existing) existing.probability += probability;
        else combined.set(score, {
          score,
          probability,
          options: [...before.options, option.label],
        });
      }
    }
    distribution = [...combined.values()];
  }
  const total = distribution.reduce((sum, row) => sum + row.probability, 0);
  return distribution.map(row => ({ ...row, probability: row.probability / total }))
    .sort((a, b) => a.score - b.score);
}

// Ordinary Legendary resets must retain first-line identity until the engine
// decides whether a Prime branch is available. Equal scores across different
// first options cannot be merged before that decision.
export function buildAdditionalFirstLineDistribution(settings) {
  const candidates = listAdditionalPrimeOptions(settings);
  if (!candidates.length) throw new Error('선택한 부위·레벨 구간의 레전드리 확률표가 없습니다.');
  return candidates.flatMap(candidate => buildAdditionalPrimeDistribution(settings, candidate.key)
    .map(row => ({ ...row, firstKey: candidate.key, probability: row.probability * candidate.probability })))
    .sort((a, b) => a.score - b.score || a.firstKey.localeCompare(b.firstKey));
}
