import {
  FLAME_MODEL,
  FLAME_TIER_PROBABILITIES,
  flameOptionAmount,
  flameOptionPoolForLevel,
  validateFlameSettings,
} from './flame-data.mjs';
import { scoreFlameStats } from './flame-engine.mjs';

function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let i = 1; i <= k; i++) value = value * (n - i + 1) / i;
  return value;
}

/**
 * Exact base draw over stat totals for boss armor/accessories. Four distinct
 * available types are selected uniformly; each selected type independently
 * receives a tier. `keysOf(option)` names the totals in `statKeys` that the
 * option raises. Types without keys are integrated out combinatorially.
 * `visit(stats, p)` receives every combination of useful types and tiers;
 * `stats` is reused between calls, so copy it to keep it.
 */
export function forEachFlameOutcome(itemLevel, statKeys, keysOf, visit) {
  const pool = flameOptionPoolForLevel(itemLevel);
  const useful = pool.map(option => ({ option, keys: keysOf(option) })).filter(({ keys }) => keys.length > 0);
  const ignoredCount = pool.length - useful.length;
  const denominator = combinations(pool.length, FLAME_MODEL.optionsPerReset);
  const selected = [];
  const stats = Object.fromEntries(statKeys.map(key => [key, 0]));

  function assignTiers(index, p) {
    if (index === selected.length) {
      visit(stats, p);
      return;
    }
    const { option, keys } = selected[index];
    for (const { tier, p: tierProbability } of FLAME_TIER_PROBABILITIES) {
      const amount = flameOptionAmount(option.kind, itemLevel, tier);
      for (const key of keys) stats[key] += amount;
      assignTiers(index + 1, p * tierProbability);
      for (const key of keys) stats[key] -= amount;
    }
  }

  function selectTypes(start, remaining) {
    if (remaining === 0) {
      const ignoredSlots = FLAME_MODEL.optionsPerReset - selected.length;
      const p = combinations(ignoredCount, ignoredSlots) / denominator;
      if (p > 0) assignTiers(0, p);
      return;
    }
    for (let index = start; index <= useful.length - remaining; index++) {
      selected.push(useful[index]);
      selectTypes(index + 1, remaining - 1);
      selected.pop();
    }
  }

  for (let usefulSlots = 0; usefulSlots <= FLAME_MODEL.optionsPerReset; usefulSlots++) {
    selectTypes(0, usefulSlots);
  }
}

/** The base draw grouped by attained stat tuple; equal-score tuples stay distinct. */
export function flameStatDistribution(itemLevel, statKeys, keysOf = option => option.keys) {
  const rowsByStats = new Map();
  forEachFlameOutcome(itemLevel, statKeys, keysOf, (stats, p) => {
    const key = statKeys.map(name => stats[name]).join(',');
    const row = rowsByStats.get(key);
    if (row) row.p += p;
    else rowsByStats.set(key, { p, stats: { ...stats } });
  });
  return [...rowsByStats.values()];
}

/**
 * Build the normal or Xenon efficiency-calculator distribution from the base
 * armor option draw. The real game rejects an identical complete prior result;
 * this unconditional model retains those draws because prior option identities
 * and tiers are not among the calculator inputs.
 */
export function buildFlameDistribution(settings) {
  validateFlameSettings(settings);
  const mode = settings.mode ?? 'normal';
  if (mode === 'xenon') {
    const relevant = new Set(['STR', 'DEX', 'LUK', 'attack', 'all']);
    const rows = flameStatDistribution(settings.itemLevel, ['STR', 'DEX', 'LUK', 'attack', 'all'], option => option.stats.filter(key => relevant.has(key)));
    return rows.map(row => ({ ...row, score: scoreFlameStats(row.stats, settings.efficiencies, mode) }))
      .sort((a, b) => a.score - b.score);
  }
  // Keeping each attained stat tuple preserves valid example combinations,
  // including different combinations with identical converted scores.
  return flameStatDistribution(settings.itemLevel, ['main', 'sub', 'attack', 'all'])
    .map(row => ({ ...row, score: scoreFlameStats(row.stats, settings.efficiencies, mode) }))
    .sort((a, b) => a.score - b.score);
}
