import { validateFlameSettings, resetCostForLevel } from './flame-data.mjs';
import { buildFlameDistribution } from './flame-distribution.mjs';
import { scoreStats, solveStopping } from './flame-engine.mjs';

export function calculateFlameStrategy(settings) {
  validateFlameSettings(settings);
  const distribution = buildFlameDistribution(settings);
  const currentScore = scoreStats(settings.current, settings.efficiencies);
  const resetCost = resetCostForLevel(settings.itemLevel);
  const result = solveStopping(distribution, resetCost, settings.mesoPerPercent, currentScore);
  const examples = [];
  // Show actual combinations near the attainable cutoff, with different all-stat
  // values so the user can recognize more than one way to reach it.
  const eligible = distribution.filter(row => result.targetScore !== null && row.score >= result.targetScore)
    .sort((a, b) => a.score - b.score || b.p - a.p);
  const seenAll = new Set();
  for (const row of eligible) {
    if (seenAll.has(row.stats.all)) continue;
    seenAll.add(row.stats.all);
    examples.push({ stats: row.stats, score: row.score, p: row.p });
    if (examples.length === 5) break;
  }
  return { ...result, currentScore, resetCost, examples, distributionSize: distribution.length };
}
