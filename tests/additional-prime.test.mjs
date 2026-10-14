import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDITIONAL_LEVELS, ADDITIONAL_SLOTS, buildAdditionalDistribution, getAdditionalLines, scoreAdditionalOptions } from '../additional-data.mjs';
import {
  DEFAULT_ADDITIONAL_PRIME,
  buildAdditionalFirstLineDistribution,
  buildAdditionalPrimeDistribution,
  getAdditionalPrimeLines,
  listAdditionalPrimeOptions,
  normalizeAdditionalPrime,
} from '../additional-prime.mjs';

const settings = { slot: '모자', level: 200, mainStat: 'STR' };
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('Prime Additional defaults to automatic selection and a 14억 meso cube price', () => {
  assert.deepEqual(DEFAULT_ADDITIONAL_PRIME, { on: false, cost: 1_400_000_000, fixedKey: 'auto' });
  assert.deepEqual(normalizeAdditionalPrime(settings), DEFAULT_ADDITIONAL_PRIME);
  assert.deepEqual(normalizeAdditionalPrime(settings, { on: true, cost: 0, fixedKey: 'STR +20' }), {
    on: true, cost: 0, fixedKey: 'STR +20',
  });
  for (const cost of [-1, NaN, Infinity, '1400000000']) {
    assert.equal(normalizeAdditionalPrime(settings, { cost }).cost, DEFAULT_ADDITIONAL_PRIME.cost);
  }
  for (const value of [null, false, [], 'bad']) assert.deepEqual(normalizeAdditionalPrime(settings, value), DEFAULT_ADDITIONAL_PRIME);
});

test('fixed candidates use exactly Legendary first-line options, preserving ignored option identities', () => {
  const candidates = listAdditionalPrimeOptions({ ...settings, method: 'strange', grade: '에픽' });
  const lines = getAdditionalLines({ ...settings, method: 'reset', grade: '레전드리' });
  assert.deepEqual(candidates, lines[0].map(row => ({ ...row, key: row.label })));
  assert.equal(new Set(candidates.map(row => row.key)).size, candidates.length);
  assert.ok(candidates.some(row => row.key === '최대 HP +360'));
  assert.ok(candidates.some(row => row.key === '최대 MP +360'));
  const secondOnly = lines[1].find(row => !candidates.some(candidate => candidate.key === row.label));
  assert.ok(secondOnly);
  assert.throws(() => getAdditionalPrimeLines(settings, secondOnly.label), /첫 줄/);
  assert.throws(() => getAdditionalPrimeLines(settings, 'auto'), /첫 줄/);
  assert.throws(() => getAdditionalPrimeLines(settings, '없는 옵션'), /첫 줄/);
});

test('fixed line is deterministic while second and third retain their own published marginal rules', () => {
  const regular = getAdditionalLines({ ...settings, method: 'reset', grade: '레전드리' });
  const prime = getAdditionalPrimeLines(settings, 'STR +20');
  assert.deepEqual(prime[0], [{ label: 'STR +20', probability: 1, publishedPercent: 100 }]);
  assert.deepEqual(prime[1], regular[1]);
  assert.deepEqual(prime[2], regular[2]);
  assert.notDeepEqual(prime[1], regular[0]);
  // Returned arrays cannot accidentally mutate the archive or another request.
  prime[2][0].probability = 0;
  assert.deepEqual(getAdditionalPrimeLines(settings, 'STR +20')[2], regular[2]);
});

test('fixed distributions have unit mass, guaranteed fixed identity, and true scalar score support', () => {
  for (const fixedKey of ['STR +20', '최대 HP +360', '최대 MP +360']) {
    const distribution = buildAdditionalPrimeDistribution(settings, fixedKey);
    close(distribution.reduce((sum, row) => sum + row.probability, 0), 1);
    assert.equal(new Set(distribution.map(row => row.score)).size, distribution.length);
    for (const [index, row] of distribution.entries()) {
      assert.equal(row.options.length, 3);
      assert.equal(row.options[0], fixedKey);
      assert.ok(row.probability > 0);
      close(row.score, scoreAdditionalOptions(row.options, settings));
      if (index) assert.ok(distribution[index - 1].score < row.score);
    }
  }
  // Different ignored fixed options share scalar utility but retain identity.
  const hp = buildAdditionalPrimeDistribution(settings, '최대 HP +360');
  const mp = buildAdditionalPrimeDistribution(settings, '최대 MP +360');
  assert.deepEqual(hp.map(({ score, probability }) => ({ score, probability })), mp.map(({ score, probability }) => ({ score, probability })));
  assert.notDeepEqual(hp.map(row => row.options), mp.map(row => row.options));
});

test('Prime scalar convolution matches an explicit independent draw of only the two rerolled lines', () => {
  const config = { ...settings, efficiency: { mainFlat: 0.123456789, cooldownSecond: 7.35 }, customOptionScores: { '최대 HP +360': 2.8 } };
  const [fixed, second, third] = getAdditionalPrimeLines(config, '최대 HP +360');
  const expected = new Map();
  for (const a of second) for (const b of third) {
    const score = Math.round(scoreAdditionalOptions([fixed[0].label, a.label, b.label], config) * 1e10) / 1e10;
    expected.set(score, (expected.get(score) ?? 0) + a.probability * b.probability);
  }
  const actual = buildAdditionalPrimeDistribution(config, '최대 HP +360');
  assert.equal(actual.length, expected.size);
  for (const row of actual) close(row.probability, expected.get(row.score));
});

test('supported slots and level bands use only real tables, and stale fixed choices restore to auto', () => {
  for (const slot of ADDITIONAL_SLOTS) for (const level of ADDITIONAL_LEVELS) {
    const selection = { ...settings, slot, level };
    const regular = getAdditionalLines({ ...selection, method: 'reset', grade: '레전드리' });
    const candidates = listAdditionalPrimeOptions(selection);
    assert.equal(candidates.length, regular?.[0].length ?? 0);
    if (candidates.length) close(candidates.reduce((sum, row) => sum + row.probability, 0), 1);
    else assert.throws(() => getAdditionalPrimeLines(selection, 'STR +20'), /확률표/);
  }
  for (const selection of [{ ...settings, level: 119 }, { ...settings, level: 251 }, { ...settings, slot: '무기' }, { ...settings, slot: '한벌옷', level: 250 }]) {
    assert.deepEqual(listAdditionalPrimeOptions(selection), []);
    assert.throws(() => getAdditionalPrimeLines(selection, 'STR +20'), /확률표/);
  }
  assert.equal(normalizeAdditionalPrime({ ...settings, level: 250 }, { fixedKey: 'STR +20' }).fixedKey, 'auto');
  assert.equal(normalizeAdditionalPrime(settings, { fixedKey: '없는 옵션' }).fixedKey, 'auto');
});

test('ordinary Legendary resets retain distinct first-line identity before allowing a fixed branch', () => {
  const actual = buildAdditionalFirstLineDistribution(settings);
  const candidates = listAdditionalPrimeOptions(settings);
  close(actual.reduce((sum, row) => sum + row.probability, 0), 1);
  for (const candidate of candidates) {
    const rows = actual.filter(row => row.firstKey === candidate.key);
    close(rows.reduce((sum, row) => sum + row.probability, 0), candidate.probability);
    for (const row of rows) assert.equal(row.options[0], candidate.label);
  }
  const mergedScores = new Map();
  for (const row of actual) mergedScores.set(row.score, (mergedScores.get(row.score) ?? 0) + row.probability);
  const regular = buildAdditionalDistribution({ ...settings, method: 'reset', grade: '레전드리' });
  assert.equal(mergedScores.size, regular.length);
  for (const row of regular) close(mergedScores.get(row.score), row.probability);
  const ignoredFirstOptions = actual.filter(row => row.score === 0);
  assert.ok(new Set(ignoredFirstOptions.map(row => row.firstKey)).size > 1);
});
