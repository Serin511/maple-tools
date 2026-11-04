import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FLAME_SETTINGS,
  DEFAULT_XENON_FLAME_SETTINGS,
  FLAME_ARMOR_OPTION_TYPES,
  flameOptionPoolForLevel,
  flameStatFields,
} from '../flame-data.mjs';
import { scoreFlameStats } from '../flame-engine.mjs';
import { buildFlameDistribution } from '../flame-distribution.mjs';
import { calculateFlameStrategy } from '../flame-calculator.mjs';
import {
  FLAME_SETTINGS_KEY,
  LEGACY_FLAME_SETTINGS_KEY,
  createFlameSettingsState,
  normalizeFlameSettingsState,
} from '../flame-settings.mjs';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `${actual} != ${expected}`,
);

const xenonAt = itemLevel => ({ ...DEFAULT_XENON_FLAME_SETTINGS, itemLevel });
const mean = (distribution, key) => distribution.reduce((sum, row) => sum + row.p * row.stats[key], 0);

function tierMoments() {
  const mean = 4 * .29 + 5 * .45 + 6 * .25 + 7 * .01;
  const second = 16 * .29 + 25 * .45 + 36 * .25 + 49 * .01;
  return { mean, second };
}

test('Xenon defaults and mode-specific input descriptors are explicit; missing mode stays normal', () => {
  assert.equal(DEFAULT_XENON_FLAME_SETTINGS.mode, 'xenon');
  assert.equal(DEFAULT_XENON_FLAME_SETTINGS.itemLevel, 200);
  assert.deepEqual(DEFAULT_XENON_FLAME_SETTINGS.current, { STR: 36, DEX: 72, LUK: 36, attack: 5, all: 6 });
  assert.deepEqual(DEFAULT_XENON_FLAME_SETTINGS.efficiencies, { STR: .5, DEX: .5, LUK: .5, attack: 2.5, all: 1 });
  assert.equal(DEFAULT_XENON_FLAME_SETTINGS.mesoPerPercent, 1e8);
  assert.equal(flameStatFields().length, 4);
  assert.equal(flameStatFields('xenon').length, 5);
  assert.deepEqual(flameStatFields('xenon').map(field => field.key), ['STR', 'DEX', 'LUK', 'attack', 'all']);

  const stats = { main: 120, sub: 30, attack: 7, all: 4 };
  const efficiencies = { main: 1, sub: .2, attack: 3, all: 1.1 };
  close(scoreFlameStats(stats, efficiencies), scoreFlameStats(stats, efficiencies, 'normal'));
  close(scoreFlameStats(stats, efficiencies), 12 + .6 + 2.1 + 4.4);
  close(calculateFlameStrategy({ ...DEFAULT_FLAME_SETTINGS, mode: undefined }).currentScore,
    calculateFlameStrategy(DEFAULT_FLAME_SETTINGS).currentScore);
});

test('Xenon scoring converts STR, DEX, LUK and attack to all-stat percentage points', () => {
  const efficiencies = { STR: .5, DEX: .5, LUK: .5, attack: 2.5, all: 1 };
  close(scoreFlameStats({ STR: 100, DEX: 50, LUK: 30, attack: 10, all: 4 }, efficiencies, 'xenon'), 9 + 2.5 + 4);
  // INT and magic are available option identities, but Xenon conversion does not score them.
  close(scoreFlameStats({ STR: 100, DEX: 50, LUK: 30, attack: 10, all: 4, INT: 999, magic: 999 }, efficiencies, 'xenon'), 15.5);
  assert.throws(() => scoreFlameStats({}, efficiencies, 'invalid'), /mode/);
  assert.throws(() => scoreFlameStats({ STR: -1 }, efficiencies, 'xenon'), /nonnegative/);
  assert.throws(() => scoreFlameStats({ STR: Infinity }, efficiencies, 'xenon'), /finite/);
  assert.throws(() => scoreFlameStats({}, { ...efficiencies, DEX: NaN }, 'xenon'), /finite/);
  assert.throws(() => scoreFlameStats({ STR: 1e308 }, { ...efficiencies, STR: 1e308 }, 'xenon'), /large|finite/);
  assert.throws(() => scoreFlameStats({}, { ...efficiencies, all: 1.01 }, 'xenon'), /all-stat|all-stat|fixed|1/);
});

test('Xenon exact distributions conserve probability and match option-pool means at level gates', () => {
  const { mean: tierMean } = tierMoments();
  for (const level of [59, 60, 70, 200, 250]) {
    const distribution = buildFlameDistribution(xenonAt(level));
    const pool = flameOptionPoolForLevel(level);
    const poolSize = pool.length;
    const perEligibleType = 4 / poolSize * tierMean;
    const single = level === 250 ? 12 : Math.floor(level / 20) + 1;
    const dual = Math.floor(level / 40) + 1;
    close(distribution.reduce((sum, row) => sum + row.p, 0), 1);
    for (const stat of ['STR', 'DEX', 'LUK']) close(mean(distribution, stat), perEligibleType * (single + 3 * dual));
    close(mean(distribution, 'attack'), level >= 60 ? perEligibleType : 0);
    close(mean(distribution, 'all'), level >= 70 ? perEligibleType : 0);
    assert.ok(distribution.every(row => ['STR', 'DEX', 'LUK', 'attack', 'all'].every(key => key in row.stats)));
    assert.ok(distribution.every(row => !('INT' in row.stats) && !('magic' in row.stats)));
    assert.equal(pool.some(option => option.id === 'luk'), true);
    assert.equal(FLAME_ARMOR_OPTION_TYPES.find(option => option.id === 'magic').stats.includes('magic'), true);
  }
});

test('STR+DEX option retains cross-stat dependence and LUK enters Xenon totals', () => {
  const level = 200;
  const distribution = buildFlameDistribution(xenonAt(level));
  const { mean: t, second: t2 } = tierMoments();
  const pool = flameOptionPoolForLevel(level);
  const n = pool.length;
  const single = Math.floor(level / 20) + 1;
  const dual = Math.floor(level / 40) + 1;
  const str = pool.map(option => option.stats.includes('STR') ? (option.kind === 'single' ? single : dual) : 0);
  const dex = pool.map(option => option.stats.includes('DEX') ? (option.kind === 'single' ? single : dual) : 0);
  const pairProducts = str.reduce((sum, a, i) => sum + dex.reduce((inner, b, j) => inner + (i === j ? 0 : a * b), 0), 0);
  const shared = str.reduce((sum, amount, i) => sum + amount * dex[i], 0);
  const expectedCross = (4 * 3 / (n * (n - 1))) * pairProducts * t ** 2 + (4 / n) * shared * t2;
  const cross = distribution.reduce((sum, row) => sum + row.p * row.stats.STR * row.stats.DEX, 0);
  close(cross, expectedCross);
  assert.ok(Math.abs(cross - mean(distribution, 'STR') * mean(distribution, 'DEX')) > 1);
  assert.ok(distribution.some(row => row.stats.LUK > 0));
  assert.ok(distribution.some(row => row.stats.STR > 0 && row.stats.LUK > 0));
});

test('Xenon default is 289 grade and its exact current stat tuple is reachable', () => {
  const result = calculateFlameStrategy(xenonAt(200));
  const distribution = buildFlameDistribution(xenonAt(200));
  close(result.currentScore, 14.45);
  close(result.currentScore * 20, 289);
  assert.ok(result.targetScore > 0);
  assert.ok(result.examples.length > 0);
  const exactDefaultRows = distribution.filter(row =>
    Object.keys(DEFAULT_XENON_FLAME_SETTINGS.current).every(key => row.stats[key] === DEFAULT_XENON_FLAME_SETTINGS.current[key]));
  assert.ok(exactDefaultRows.length > 0, 'expected the exact default stat tuple in the distribution');
  for (const row of exactDefaultRows) close(row.score, result.currentScore);
  for (const example of result.examples) {
    close(example.score, scoreFlameStats(example.stats, DEFAULT_XENON_FLAME_SETTINGS.efficiencies, 'xenon'));
    assert.ok(example.score >= result.targetScore);
  }
});

test('Xenon efficiency profiles, fixed all-stat efficiency, and zero-value cases are isolated', () => {
  const base = xenonAt(200);
  const strWeighted = calculateFlameStrategy({ ...base, efficiencies: { ...base.efficiencies, STR: 1 } });
  const dexWeighted = calculateFlameStrategy({ ...base, efficiencies: { ...base.efficiencies, DEX: 1 } });
  assert.notEqual(strWeighted.currentScore, dexWeighted.currentScore);
  close(strWeighted.targetScore, dexWeighted.targetScore);
  close(strWeighted.currentScore, scoreFlameStats(base.current, { ...base.efficiencies, STR: 1 }, 'xenon'));
  assert.throws(() => calculateFlameStrategy({ ...base, efficiencies: { ...base.efficiencies, all: 2 } }), /all-stat|fixed|1/);
  const zeroPrice = calculateFlameStrategy({ ...base, mesoPerPercent: 0 });
  assert.equal(zeroPrice.targetScore, null);
  assert.deepEqual(zeroPrice.examples, []);
  const noFlatValue = calculateFlameStrategy({ ...base, current: { STR: 0, DEX: 0, LUK: 0, attack: 0, all: 0 }, efficiencies: { STR: 0, DEX: 0, LUK: 0, attack: 0, all: 1 } });
  assert.ok(noFlatValue.targetScore > 0);
  assert.ok(noFlatValue.shouldReset);
  const allOnly = buildFlameDistribution({ ...base, efficiencies: { STR: 0, DEX: 0, LUK: 0, attack: 0, all: 1 } });
  assert.ok(allOnly.every(row => row.score === row.stats.all));
  const allOnlyStrategy = calculateFlameStrategy({ ...base, current: { STR: 0, DEX: 0, LUK: 0, attack: 0, all: 0 }, efficiencies: { STR: 0, DEX: 0, LUK: 0, attack: 0, all: 1 } });
  assert.ok(allOnlyStrategy.targetScore > 0);
  assert.ok(allOnlyStrategy.shouldReset);
  assert.equal(noFlatValue.currentScore, 0);
});

test('Xenon validation rejects unknown modes, invalid numeric inputs, and overflow', () => {
  const base = xenonAt(200);
  assert.throws(() => calculateFlameStrategy({ ...base, mode: 'other' }), /mode|추가옵션/);
  for (const current of [{ ...base.current, LUK: -1 }, { ...base.current, STR: NaN }, { ...base.current, attack: Infinity }]) {
    assert.throws(() => calculateFlameStrategy({ ...base, current }));
  }
  for (const efficiencies of [
    { ...base.efficiencies, LUK: -1 },
    { ...base.efficiencies, DEX: NaN },
    { ...base.efficiencies, attack: Infinity },
  ]) assert.throws(() => calculateFlameStrategy({ ...base, efficiencies }));
  assert.throws(() => calculateFlameStrategy({ ...base, current: { ...base.current, STR: 1e308 }, efficiencies: { ...base.efficiencies, STR: 1e308 } }), /large|finite|score/);
});

test('versioned flame settings migrate legacy normal state and retain both editable profiles', () => {
  assert.equal(FLAME_SETTINGS_KEY, 'maple:flame:settings:v2');
  assert.equal(LEGACY_FLAME_SETTINGS_KEY, 'maple:flame:settings:v1');
  const initial = createFlameSettingsState();
  assert.equal(initial.mode, 'normal');
  assert.ok(initial.profiles.normal);
  assert.ok(initial.profiles.xenon);

  const legacy = { ...DEFAULT_FLAME_SETTINGS, current: { main: '', sub: 0, attack: 3, all: 2 } };
  const migrated = normalizeFlameSettingsState(null, legacy);
  assert.equal(migrated.mode, 'normal');
  assert.equal(migrated.profiles.normal.current.main, '');
  assert.ok(migrated.profiles.xenon);

  const v2 = {
    mode: 'xenon',
    profiles: {
      normal: { ...DEFAULT_FLAME_SETTINGS, itemLevel: '', current: { main: 12, sub: '', attack: 0, all: 3 } },
      xenon: { ...DEFAULT_XENON_FLAME_SETTINGS, current: { STR: '', DEX: 72, LUK: 36, attack: 5, all: 6 }, efficiencies: { ...DEFAULT_XENON_FLAME_SETTINGS.efficiencies, all: 1 } },
    },
  };
  const normalized = normalizeFlameSettingsState(v2, legacy);
  assert.equal(normalized.mode, 'xenon');
  assert.equal(normalized.profiles.normal.itemLevel, '');
  assert.equal(normalized.profiles.normal.current.sub, '');
  assert.equal(normalized.profiles.xenon.current.STR, '');
  assert.equal(normalized.profiles.xenon.efficiencies.all, 1);
  const roundTrip = normalizeFlameSettingsState(normalized, legacy);
  assert.deepEqual(roundTrip, normalized);

  const malformed = normalizeFlameSettingsState({ ...v2, profiles: { ...v2.profiles, xenon: { ...v2.profiles.xenon, current: { ...v2.profiles.xenon.current, DEX: 'bad' }, efficiencies: { ...v2.profiles.xenon.efficiencies, all: 1.5 } } } }, legacy);
  assert.equal(malformed.mode, 'xenon');
  assert.equal(malformed.profiles.xenon.current.DEX, DEFAULT_XENON_FLAME_SETTINGS.current.DEX);
  assert.equal(malformed.profiles.xenon.efficiencies.all, 1);
  assert.equal(malformed.profiles.normal.current.main, 12);

  const wrongBank = normalizeFlameSettingsState({ ...v2, profiles: { ...v2.profiles, xenon: { ...v2.profiles.xenon, mode: 'normal' } } }, legacy);
  assert.equal(wrongBank.mode, 'xenon');
  assert.deepEqual(wrongBank.profiles.xenon.current, DEFAULT_XENON_FLAME_SETTINGS.current);
  assert.equal(wrongBank.profiles.normal.current.main, 12);
});
