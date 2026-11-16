import { validateFlameSettings, validateFlameTransfer, resetCostForLevel } from './flame-data.mjs';
import { buildFlameDistribution } from './flame-distribution.mjs';
import { evaluateFlameTransfer, scoreFlameStats, solveStopping } from './flame-engine.mjs';

/**
 * Evaluate an enabled transfer draft, reporting invalid input on the transfer
 * result instead of failing the whole calculation.
 *
 * @param {object} settings - Validated flame settings with an enabled transfer.
 * @param {Array<object>} distribution - One-reset score distribution.
 * @param {number} resetCost - Meso cost of one reset.
 * @param {number} currentScore - Score of the current flame.
 * @returns {object} The `evaluateFlameTransfer` result, or `{ error }` with a Korean message.
 */
function evaluateTransferDraft(settings, distribution, resetCost, currentScore) {
  const mode = settings.mode ?? 'normal';
  try {
    validateFlameTransfer(settings.transfer, mode);
    return evaluateFlameTransfer(distribution, {
      resetCost,
      mesoPerPercent: settings.mesoPerPercent,
      currentScore,
      sourceScore: scoreFlameStats(settings.transfer.source, settings.efficiencies, mode),
      ticketPrice: settings.transfer.ticketPrice,
      sourcePrice: settings.transfer.sourcePrice,
    });
  } catch (failure) {
    return { error: failure.message || '추가옵션 전승권 입력을 확인해 주세요.' };
  }
}

export function calculateFlameStrategy(settings) {
  validateFlameSettings(settings);
  const distribution = buildFlameDistribution(settings);
  const currentScore = scoreFlameStats(settings.current, settings.efficiencies, settings.mode ?? 'normal');
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
  const transfer = settings.transfer?.enabled ? evaluateTransferDraft(settings, distribution, resetCost, currentScore) : null;
  return { ...result, currentScore, resetCost, examples, transfer, distributionSize: distribution.length };
}
