import {
  FLAME_MODEL,
  FLAME_TIER_PROBABILITIES,
  flameOptionAmount,
  flameOptionPoolForLevel,
  validateFlameSettings,
} from './flame-data.mjs';
import { scoreStats } from './flame-engine.mjs';

function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let value = 1;
  for (let i = 1; i <= k; i++) value = value * (n - i + 1) / i;
  return value;
}

/**
 * Exact base-draw distribution for boss armor/accessories. Four distinct
 * available types are selected uniformly; each selected type independently
 * receives a tier. Irrelevant types are integrated out combinatorially.
 *
 * The real game rejects the identical complete prior result. That conditional
 * rule needs the complete original option identities, tiers and ignored stats,
 * which are not among this calculator's inputs. We retain the unconditional
 * base draw. In particular, equal-score results remain in the distribution.
 */
export function buildFlameDistribution(settings) {
  validateFlameSettings(settings);
  const pool = flameOptionPoolForLevel(settings.itemLevel);
  const useful = pool.filter(option => option.keys.length > 0);
  const ignoredCount = pool.length - useful.length;
  const denominator = combinations(pool.length, FLAME_MODEL.optionsPerReset);
  const rowsByStats = new Map();
  const selected = [];
  const stats = { main: 0, sub: 0, attack: 0, all: 0 };

  function addRow(p) {
    const key = `${stats.main},${stats.sub},${stats.attack},${stats.all}`;
    const row = rowsByStats.get(key);
    if (row) row.p += p;
    else rowsByStats.set(key, { p, stats: { ...stats } });
  }

  function assignTiers(index, p) {
    if (index === selected.length) {
      addRow(p);
      return;
    }
    const option = selected[index];
    for (const { tier, p: tierProbability } of FLAME_TIER_PROBABILITIES) {
      const amount = flameOptionAmount(option.kind, settings.itemLevel, tier);
      for (const key of option.keys) stats[key] += amount;
      assignTiers(index + 1, p * tierProbability);
      for (const key of option.keys) stats[key] -= amount;
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

  // Keeping each attained stat tuple preserves valid example combinations,
  // including different combinations with identical converted scores.
  return [...rowsByStats.values()]
    .map(row => ({ ...row, score: scoreStats(row.stats, settings.efficiencies) }))
    .sort((a, b) => a.score - b.score);
}
