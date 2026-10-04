import {
  ADDITIONAL_GRADES, ADDITIONAL_SLOTS, DEFAULT_ADDITIONAL_EFFICIENCY,
  getAdditionalLines, scoreAdditionalOption, buildAdditionalDistribution,
} from './additional-data.mjs';
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
  mainStat: 'STR', subStat: 'DEX', attackType: 'attack', characterLevel: 290,
  efficiency: { ...DEFAULT_ADDITIONAL_EFFICIENCY },
  mesoPerPercent: 1e8, strangeCubePrice: 0, strangeAppraisalCost: suggestedAdditionalAppraisalCost(200), miracle: false,
  costs: resetAdditionalCosts(200),
  upRates: { 에픽: 0.009804, 유니크: 0.007 }, pity: { 에픽: 152, 유니크: 214 },
  stacks: { 에픽: 0, 유니크: 0 }, retainPaid: true,
  manual: { enabled: false, thresholds: { 에픽: 10, 유니크: 15, 레전드리: 20 }, method: 'reset' },
});

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
  if (!['STR', 'DEX', 'INT', 'LUK'].includes(settings.mainStat)
    || !['STR', 'DEX', 'INT', 'LUK'].includes(settings.subStat) || settings.mainStat === settings.subStat) {
    throw new Error('주스탯과 부스탯을 서로 다르게 선택해 주세요.');
  }
  if (!['attack', 'magic'].includes(settings.attackType)) throw new Error('공격력 또는 마력을 선택해 주세요.');
  if (!Number.isInteger(settings.characterLevel) || settings.characterLevel < 1 || settings.characterLevel > 300) throw new Error('캐릭터 레벨은 1~300의 정수로 입력해 주세요.');
  for (const key of Object.keys(DEFAULT_ADDITIONAL_EFFICIENCY)) {
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
  const examples = Number.isFinite(cutoff)
    ? distribution.filter(row => row.score >= cutoff - 1e-9).slice(0, 4).map(({ score, options }) => ({ score, options })) : [];
  return {
    id, label, available: raw.possible !== false, reason: raw.reason,
    action: raw.action, threshold: cutoff, expectedCost: raw.expectedCost,
    expectedAttempts: raw.expectedAttempts, expectedStrangeAttempts: raw.strangeAttempts,
    expectedResetAttempts: raw.resetAttempts, expectedFinalScore: raw.expectedFinalScore,
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
  const strategies = [];
  for (const [id, label] of [['strange', '수에큐만 사용'], ['reset', '메소 재설정만 사용'], ['mixed', '수에큐·메소 최적 선택']]) {
    if (id === 'strange' && settings.grade !== '에픽') {
      strategies.push({ id, label, available: false, reason: '수상한 에디셔널 큐브는 에픽만 계산합니다.' });
    } else if (id !== 'strange' && issue) {
      strategies.push({ id, label, available: false, reason: issue });
    } else {
      strategies.push(formatStrategy(solveAdditionalStrategy({ ...config, strategy: id }), id, label, settings, distributions, currentScore));
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
      manual = formatStrategy(evaluateAdditionalThresholds({ ...config, strategy: strangeOnly ? 'strange' : 'reset' }, {
        thresholds: settings.manual.thresholds, epicAction: settings.manual.method,
      }), 'manual', '직접 입력한 종료 기준', settings, distributions, currentScore);
    }
  }
  return {
    currentScore, strategies, recommendedId: recommended?.id ?? null, manual,
    warnings: [
      '첨부된 줄별 확률의 반올림 오차를 정규화해 조합합니다. 직전과 완전히 동일한 결과를 제외하는 규칙은 반영하지 않았습니다.',
      '입력한 환산 효율이 없는 옵션의 가치는 0입니다. 쿨타임·드롭·메소·HP 등의 가치는 자동으로 추정하지 않습니다.',
      '큐브 수량과 총지출 상한이 없는 기대값 기준입니다. 표시한 기대 비용은 최대 지출액이 아닙니다.',
      ...(issue ? ['메소 전략은 재설정 규칙을 입력한 뒤 비교할 수 있습니다.'] : ['비용·등급업·천장 기본값은 첨부 나무위키 문서를 따르며 직접 수정할 수 있습니다. 미라클은 등급업 확률만 2배로 계산합니다.']),
      ...(settings.strangeCubePrice + settings.strangeAppraisalCost === 0 ? ['수에큐 총비용 0메소에서는 횟수 제한 없이 가능한 최고 환산값을 목표로 합니다. 기대 사용 개수와 실제 감정 비용을 함께 확인하세요.'] : []),
    ],
  };
}
