import {
  ADDITIONAL_GRADES, ADDITIONAL_SLOTS, DEFAULT_ADDITIONAL_EFFICIENCY,
  getAdditionalCharacterSettings, getAdditionalLines, scoreAdditionalOption, buildAdditionalDistribution,
} from './additional-data.mjs';
import { DEFAULT_ADDITIONAL_PRIME, normalizeAdditionalPrime, listAdditionalPrimeOptions, buildAdditionalPrimeDistribution, buildAdditionalFirstLineDistribution } from './additional-prime.mjs';
import { solveAdditionalStrategy, evaluateAdditionalThresholds } from './additional-engine.mjs';

// Fees/rates/pity from the user's 잠재능력 - 나무위키.pdf, pp. 4–6, 10.
// Level-dependent fees are deliberately separate from probability bands.
export function resetAdditionalCosts(level) {
  if (!Number.isInteger(level) || level < 120 || level > 250) return { 에픽: '', 유니크: '', 레전드리: '' };
  if (level < 160) return { 에픽: 27300000, 유니크: 66300000, 레전드리: 78000000 };
  if (level < 200) return { 에픽: 29050000, 유니크: 70550000, 레전드리: 83000000 };
  if (level < 250) return { 에픽: 30800000, 유니크: 74800000, 레전드리: 88000000 };
  return { 에픽: 34300000, 유니크: 83300000, 레전드리: 98000000 };
}

export const suggestedAdditionalAppraisalCost = level => Number.isInteger(level) && level >= 120 && level <= 250 ? (level === 120 ? 2.5 : 20) * level ** 2 : '';

export const DEFAULT_ADDITIONAL_SETTINGS = Object.freeze({
  slot: '모자', level: 200, grade: '에픽', currentOptions: ['없음', '없음', '없음'],
  ...getAdditionalCharacterSettings(), characterLevel: 290,
  efficiency: { ...DEFAULT_ADDITIONAL_EFFICIENCY },
  mesoPerPercent: 1e8, strangeCubePrice: 0, strangeAppraisalCost: suggestedAdditionalAppraisalCost(200), miracle: false,
  costs: resetAdditionalCosts(200),
  upRates: { 에픽: 0.009804, 유니크: 0.007 }, pity: { 에픽: 152, 유니크: 214 },
  stacks: { 에픽: 0, 유니크: 0 }, retainPaid: true, prime: { ...DEFAULT_ADDITIONAL_PRIME },
  manual: { enabled: false, thresholds: { 에픽: 10, 유니크: 15, 레전드리: 20 }, method: 'reset' },
});

const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/** Restore saved inputs without carrying obsolete character or utility settings. */
export function normalizeAdditionalSettings(saved = {}) {
  const source = record(saved);
  const defaults = DEFAULT_ADDITIONAL_SETTINGS;
  const merged = { ...defaults, ...source };
  for (const key of ['efficiency', 'costs', 'upRates', 'pity', 'stacks']) {
    merged[key] = { ...defaults[key], ...record(source[key]) };
  }
  merged.manual = { ...defaults.manual, ...record(source.manual),
    thresholds: { ...defaults.manual.thresholds, ...record(source.manual?.thresholds) },
  };
  merged.prime = normalizeAdditionalPrime(merged, source.prime);
  merged.currentOptions = Array.isArray(merged.currentOptions) ? [...merged.currentOptions] : merged.currentOptions;
  Object.assign(merged, getAdditionalCharacterSettings(merged.mainStat));
  merged.efficiency.itemDropPercent = 0;
  merged.efficiency.mesoPercent = 0;
  return merged;
}

function nonnegative(value, name, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new RangeError(`${name}: 0 이상${Number.isFinite(max) ? ` ${max} 이하` : ''}의 숫자를 입력해 주세요.`);
  }
}

export function validateAdditionalSettings(settings) {
  if (!settings || typeof settings !== 'object') throw new Error('입력값을 확인해 주세요.');
  if (!ADDITIONAL_GRADES.includes(settings.grade)) throw new Error('에픽·유니크·레전드리 중 현재 등급을 선택해 주세요.');
  if (!ADDITIONAL_SLOTS.includes(settings.slot)) throw new Error('지원하는 방어구·장신구 부위를 선택해 주세요.');
  if (!Number.isInteger(settings.level) || settings.level < 120 || settings.level > 250) throw new Error('첨부 확률표가 있는 120~250레벨만 지원합니다.');
  const lines = getAdditionalLines({ method: 'reset', grade: settings.grade, slot: settings.slot, level: settings.level });
  if (!lines) throw new Error('이 부위·레벨은 첨부 확률표에 데이터가 없습니다. 다른 조합을 선택해 주세요.');
  if (!['STR', 'DEX', 'INT', 'LUK'].includes(settings.mainStat)) throw new Error('주스탯은 STR, DEX, INT, LUK 중에서 선택해 주세요.');
  if (!Number.isInteger(settings.characterLevel) || settings.characterLevel < 1 || settings.characterLevel > 300) throw new Error('캐릭터 레벨은 1~300의 정수로 입력해 주세요.');
  for (const key of Object.keys(DEFAULT_ADDITIONAL_EFFICIENCY)) {
    if (key === 'itemDropPercent' || key === 'mesoPercent') continue;
    nonnegative(settings.efficiency?.[key], `환산 효율 ${key}`, 1e6);
  }
  nonnegative(settings.mesoPerPercent, '주스탯 1%당 지불 의향', 1e16);
  nonnegative(settings.strangeCubePrice, '수에큐 가격', 1e16);
  nonnegative(settings.strangeAppraisalCost, '수에큐 추가 비용', 1e16);
  if (!Array.isArray(settings.currentOptions) || settings.currentOptions.length !== 3) throw new Error('현재 옵션 세 줄을 입력해 주세요.');
  settings.currentOptions.forEach((label, index) => {
    if (label !== '없음' && !lines[index].some(row => row.label === label)) {
      throw new Error(`현재 ${index + 1}번째 옵션이 선택한 부위·레벨·등급의 확률표와 맞지 않습니다.`);
    }
  });
  const prime = settings.prime ?? DEFAULT_ADDITIONAL_PRIME;
  if (typeof prime.on !== 'boolean') throw new Error('프라임 에디셔널 큐브 모드를 확인해 주세요.');
  if (prime.on) {
    nonnegative(prime.cost, '프라임 에디셔널 큐브 가격', 1e16);
    if (prime.fixedKey !== 'auto' && !listAdditionalPrimeOptions(settings).some(row => row.key === prime.fixedKey)) throw new Error('현재 부위의 레전드리 첫 줄에 가능한 고정 옵션을 선택해 주세요.');
  }
  if (typeof settings.miracle !== 'boolean' || typeof settings.retainPaid !== 'boolean') throw new Error('재설정 규칙을 확인해 주세요.');
  if (settings.manual?.enabled) {
    for (const grade of ADDITIONAL_GRADES) nonnegative(settings.manual.thresholds?.[grade], `${grade} 종료 기준`, 1e9);
    if (!['reset', 'strange'].includes(settings.manual.method)) throw new Error('직접 입력 전략의 에픽 재설정 수단을 선택해 주세요.');
  }
  return true;
}

export function previewAdditionalScore(settings) {
  return settings.currentOptions.reduce((sum, label) => sum + (label === '없음' ? 0 : scoreAdditionalOption(label, settings)), 0);
}

export function paidRulesIssue(settings) {
  const start = ADDITIONAL_GRADES.indexOf(settings.grade);
  for (const grade of ADDITIONAL_GRADES.slice(start)) {
    if (settings.costs?.[grade] === '' || settings.costs?.[grade] == null) return `${grade}의 1회 메소 비용을 입력해 주세요.`;
    try { nonnegative(settings.costs[grade], `${grade} 메소 비용`, 1e16); } catch (error) { return error.message; }
    if (grade === '레전드리') continue;
    if (settings.upRates?.[grade] === '' || settings.upRates?.[grade] == null) return `${grade}의 평상시 등급업 확률을 입력해 주세요.`;
    try { nonnegative(settings.upRates[grade], `${grade} 등급업 확률`, 1); } catch (error) { return error.message; }
    if (settings.pity?.[grade] === '' || settings.pity?.[grade] == null) return `${grade}의 등급업 보장 직전 실패 횟수를 입력해 주세요.`;
    if (!Number.isInteger(settings.pity[grade]) || settings.pity[grade] < 0 || settings.pity[grade] > 1000) return `${grade}의 보장 직전 실패 횟수는 0~1000의 정수로 입력해 주세요.`;
    if (!Number.isInteger(settings.stacks?.[grade]) || settings.stacks[grade] < 0 || settings.stacks[grade] > settings.pity[grade]) return `${grade} 현재 누적 실패 횟수는 0~${settings.pity[grade]}로 입력해 주세요.`;
  }
  return null;
}

function formatStrategy(raw, id, label, settings, distributions, currentScore) {
  const thresholds = (raw.thresholds || []).map(row => ({
    ...row, threshold: row.cutoff, targetScore: row.cutoff, action: row.actionBelow,
  }));
  const currentRows = thresholds.filter(row => row.stack === (settings.stacks[row.grade] || 0));
  const cutoff = raw.currentCutoff;
  const method = raw.action === 'strange' ? 'strange' : 'reset';
  const distribution = distributions[settings.grade]?.[method] || [];
  const currentPolicyRow = currentRows.find(row => row.grade === settings.grade);
  const examples = currentPolicyRow?.firstLineDependent ? [] : Number.isFinite(cutoff)
    ? distribution.filter(row => row.score >= cutoff - 1e-9).slice(0, 4).map(({ score, options }) => ({ score, options })) : [];
  return {
    id, label, available: raw.possible !== false, reason: raw.reason,
    action: raw.action, threshold: cutoff, expectedCost: raw.expectedCost,
    expectedAttempts: raw.expectedAttempts, expectedStrangeAttempts: raw.strangeAttempts,
    expectedResetAttempts: raw.resetAttempts, expectedPrimeAttempts: raw.primeAttempts ?? 0, expectedPrimeCost: raw.primeCost ?? 0,
    primeEnabled: raw.primeEnabled ?? false, fixedKey: raw.fixedKey, fixedLabel: raw.fixedKey, expectedFinalScore: raw.expectedFinalScore,
    expectedGain: raw.expectedGain, expectedNetValue: raw.netValue,
    finalGrades: raw.finalGradeProbabilities, thresholds: currentRows, allThresholds: thresholds, examples,
  };
}

export function calculateAdditionalStrategy(settings) {
  validateAdditionalSettings(settings);
  const currentScore = previewAdditionalScore(settings);
  const distributions = {};
  for (const grade of ADDITIONAL_GRADES.slice(ADDITIONAL_GRADES.indexOf(settings.grade))) {
    distributions[grade] = { reset: buildAdditionalDistribution({ ...settings, method: 'reset', grade }) };
    if (grade === '에픽') distributions[grade].strange = buildAdditionalDistribution({ ...settings, method: 'strange', grade });
  }
  const issue = paidRulesIssue(settings);
  const config = {
    distributions, costs: settings.costs, strangeCost: settings.strangeCubePrice + settings.strangeAppraisalCost,
    mesoPerPercent: settings.mesoPerPercent, upRates: settings.upRates, pity: settings.pity, stacks: settings.stacks,
    currentGrade: settings.grade, currentScore, miracle: settings.miracle, retainPaid: settings.retainPaid,
  };
  const prime = settings.prime ?? DEFAULT_ADDITIONAL_PRIME;
  const candidates = prime.on ? listAdditionalPrimeOptions(settings).filter(row => prime.fixedKey === 'auto' || row.key === prime.fixedKey) : [];
  const primeDistributions = new Map(candidates.map(row => [row.key, buildAdditionalPrimeDistribution(settings, row.key)]));
  const firstLineDistribution = prime.on && !issue ? buildAdditionalFirstLineDistribution(settings) : null;
  const strategyCache = new Map();
  const strategies = [];
  for (const [id, label] of [['strange', '수에큐만 사용'], ['reset', '메소 재설정만 사용'], ['mixed', '수에큐·메소 최적 선택']]) {
    if (id === 'strange' && settings.grade !== '에픽') {
      strategies.push({ id, label, available: false, reason: '수상한 에디셔널 큐브는 에픽만 계산합니다.' });
    } else if (id !== 'strange' && issue) {
      strategies.push({ id, label, available: false, reason: issue });
    } else {
      const baselineRaw = solveAdditionalStrategy({ ...config, strategy: id });
      const baseline = formatStrategy(baselineRaw, id, label, settings, distributions, currentScore);
      if (!prime.on || id === 'strange') strategies.push(baseline);
      else {
        const cacheKey = settings.grade === '에픽' ? id : 'upper';
        let solved = strategyCache.get(cacheKey);
        if (!solved) {
          const rows = candidates.map(candidate => {
            const primeConfig = {
              ...config, strategy: id, currentFirstKey: settings.currentOptions[0],
              distributions: { ...distributions, 레전드리: { reset: firstLineDistribution } },
              prime: { ...prime, fixedKey: candidate.key, distribution: primeDistributions.get(candidate.key) },
            };
            // Lower-grade behavior can change only if a reachable Legendary
            // result actually uses Prime. Probe that small stationary policy
            // before recomputing hundreds of lower-grade pity rows.
            const probe = settings.grade === '레전드리' ? null : solveAdditionalStrategy({
              ...primeConfig, currentGrade: '레전드리', currentScore: 0, currentFirstKey: null, strategy: 'reset',
            });
            const primeReachable = !probe || probe.thresholds.some(row => row.actionRanges.some(range => range.action === 'prime'));
            const raw = primeReachable ? solveAdditionalStrategy(primeConfig) : { ...baselineRaw, primeEnabled: true, fixedKey: candidate.key };
            return { raw, candidate };
          });
          const best = rows.reduce((winner, row) => !winner || row.raw.netValue > winner.raw.netValue + 1e-5 ? row : winner, null);
          solved = { best, rows }; strategyCache.set(cacheKey, solved);
        }
        if (!solved.best) strategies.push({ ...baseline, primeEnabled: true, reason: '현재 부위에서 고정 가능한 첫 줄 옵션이 없습니다.' });
        else {
          const enhanced = formatStrategy(solved.best.raw, id, label, settings, distributions, currentScore);
          enhanced.baseline = { expectedNetValue: baseline.expectedNetValue, expectedCost: baseline.expectedCost, expectedFinalScore: baseline.expectedFinalScore };
          enhanced.primeComparison = { baselineValue: baseline.expectedNetValue, value: enhanced.expectedNetValue, improvement: enhanced.expectedNetValue - baseline.expectedNetValue };
          enhanced.primeOptimization = {
            selectedFixedKey: enhanced.expectedNetValue > baseline.expectedNetValue + 1e-5 && enhanced.expectedPrimeAttempts > 0 ? solved.best.candidate.key : null, selectedFixedLabel: enhanced.expectedNetValue > baseline.expectedNetValue + 1e-5 && enhanced.expectedPrimeAttempts > 0 ? solved.best.candidate.label : null,
            bestFixedKey: solved.best.candidate.key, bestFixedLabel: solved.best.candidate.label,
            objectiveLabel: '예상 순가치', value: enhanced.expectedNetValue, baselineValue: baseline.expectedNetValue,
            improvement: enhanced.expectedNetValue - baseline.expectedNetValue,
            reason: enhanced.expectedNetValue > baseline.expectedNetValue + 1e-5 ? 'selected' : 'no-benefit',
            candidates: solved.rows.map(({ raw, candidate }) => ({ key: candidate.key, label: candidate.label, value: raw.netValue, expectedPrimeAttempts: raw.primeAttempts })),
          };
          strategies.push(enhanced);
        }
      }
    }
  }
  const ready = strategies.filter(row => row.available);
  const recommended = ready.reduce((best, row) => !best || row.expectedNetValue > best.expectedNetValue + 1e-5 ? row : best, null);
  let manual = null;
  if (settings.manual.enabled) {
    const strangeOnly = settings.grade === '에픽' && settings.manual.method === 'strange';
    if (settings.grade !== '에픽' && settings.manual.method === 'strange') manual = { id: 'manual', label: '직접 입력한 종료 기준', available: false, reason: '수상한 에디셔널 큐브는 에픽 등급에서만 사용할 수 있습니다.' };
    else if (!strangeOnly && issue) manual = { id: 'manual', label: '직접 입력한 종료 기준', available: false, reason: issue };
    else {
      const policy = { thresholds: settings.manual.thresholds, epicAction: settings.manual.method };
      const baselineRaw = evaluateAdditionalThresholds({ ...config, strategy: strangeOnly ? 'strange' : 'reset' }, policy);
      if (!prime.on || strangeOnly) manual = formatStrategy(baselineRaw, 'manual', '직접 입력한 종료 기준', settings, distributions, currentScore);
      else {
        const choices = candidates.map(candidate => ({ candidate, raw: evaluateAdditionalThresholds({
          ...config, strategy: 'reset', currentFirstKey: settings.currentOptions[0],
          distributions: { ...distributions, 레전드리: { reset: firstLineDistribution } },
          prime: { ...prime, fixedKey: candidate.key, distribution: primeDistributions.get(candidate.key) },
        }, policy) }));
        const best = choices.reduce((winner, row) => !winner || row.raw.netValue > winner.raw.netValue + 1e-5 ? row : winner, null);
        manual = formatStrategy(best?.raw ?? baselineRaw, 'manual', '직접 입력한 종료 기준', settings, distributions, currentScore);
        manual.baseline = { expectedNetValue: baselineRaw.netValue, expectedCost: baselineRaw.expectedCost, expectedFinalScore: baselineRaw.expectedFinalScore };
        manual.primeOptimization = {
          selectedFixedKey: manual.expectedPrimeAttempts > 0 ? best?.candidate.key : null, selectedFixedLabel: manual.expectedPrimeAttempts > 0 ? best?.candidate.label : null,
          bestFixedKey: best?.candidate.key ?? null, bestFixedLabel: best?.candidate.label ?? null,
          objectiveLabel: '목표 도달 후 예상 순가치', value: manual.expectedNetValue, baselineValue: baselineRaw.netValue,
          improvement: manual.available && baselineRaw.possible ? manual.expectedNetValue - baselineRaw.netValue : null,
          reason: manual.expectedPrimeAttempts > 0 ? 'selected' : 'no-benefit',
        };
      }
    }
  }
  return {
    currentScore, strategies, recommendedId: recommended?.id ?? null, manual,
    primeOptimization: prime.on ? (recommended?.primeOptimization ?? { selectedFixedKey: null, selectedFixedLabel: null, bestFixedKey: null, bestFixedLabel: null, objectiveLabel: '예상 순가치', value: recommended?.expectedNetValue ?? null, baselineValue: recommended?.expectedNetValue ?? null, improvement: 0, reason: 'no-benefit' }) : null,
    warnings: [
      '첨부된 줄별 확률의 반올림 오차를 정규화해 조합합니다. 직전과 완전히 동일한 결과를 제외하는 규칙은 반영하지 않았습니다.',
      '아이템 드롭률·메소 획득량은 환산 가치에서 제외합니다. 별도 효율이 없는 옵션과 HP 등의 가치는 0이며, 쿨타임은 입력한 효율만 반영합니다.',
      '큐브 수량과 총지출 상한이 없는 기대값 기준입니다. 표시한 기대 비용은 최대 지출액이 아닙니다.',
      ...(prime.on ? ['프라임 에디셔널 큐브는 레전드리의 선택한 첫 줄이 있는 경우에만 사용합니다. 메소 재설정과 프라임 사용·정지를 함께 비교하고 기존·신규 옵션 세 줄 전체 중 더 유리한 결과를 유지합니다.', '프라임 에디셔널 큐브의 나머지 두 줄은 공개된 레전드리 에디셔널 재설정 확률표를 사용합니다. 직전과 동일한 결과 제외 규칙은 반영하지 않습니다.', '프라임 모드의 레전드리 정책은 환산값과 첫 줄 옵션에 따라 달라집니다. 점수 기준만으로 프라임 진입 여부를 판단하지 않습니다. 직접 지정한 종료 기준에서는 목표 이상이면 멈추고, 목표 미만에서는 메소 재설정과 프라임 중 목표 도달 후 예상 순가치가 더 높은 수단을 선택합니다.'] : []),
      ...(issue ? ['메소 전략은 유효한 비용과 실패 스택을 입력한 뒤 비교할 수 있습니다.'] : ['등급업 확률·천장은 첨부 문서의 고정값이며 비용과 현재 실패 스택을 설정할 수 있습니다. 미라클은 등급업 확률만 2배로 계산합니다.']),
      ...(settings.strangeCubePrice + settings.strangeAppraisalCost === 0 ? ['수에큐 총비용 0메소에서는 횟수 제한 없이 가능한 최고 환산값을 목표로 합니다. 기대 사용 개수와 실제 감정 비용을 함께 확인하세요.'] : []),
    ],
  };
}
