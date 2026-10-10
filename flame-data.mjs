import { DEFAULT_FLAME_EFFICIENCIES } from './flame-engine.mjs';

// Korean MapleStory, as of the March 19, 2026 meso-reset update.
// The level affects option amounts; the meso-reset price is a fixed 3 million.
export const FLAME_RESET_COST = 3_000_000;
export const FLAME_MODEL = Object.freeze({
  equipment: '보스 방어구·장신구',
  optionsPerReset: 4,
  subStats: 1,
  identicalResultExclusion: false,
  note: '주스탯 1종·부스탯 1종 기준입니다. 기존과 완전히 동일한 결과를 제외하는 게임 규칙은 근사 계산에서 생략합니다.',
});

export const FLAME_SOURCES = Object.freeze([
  Object.freeze({
    label: '넥슨 공식 추가옵션 확률·종류',
    url: 'https://maplestory.nexon.com/Guide/OtherProbability/game/gameAddOption',
  }),
  Object.freeze({
    label: '2026.03.19 공식 업데이트 — 메소 재설정 300만 메소',
    url: 'https://maplestory.nexon.com/News/Update/799',
  }),
  Object.freeze({
    label: '옵션 수치 공식 — 인벤 이용자 정리',
    url: 'https://www.inven.co.kr/board/maple/2304/27668',
  }),
]);

export const DEFAULT_FLAME_SETTINGS = Object.freeze({
  itemLevel: 200,
  current: Object.freeze({ main: 100, sub: 0, attack: 0, all: 5 }),
  efficiencies: DEFAULT_FLAME_EFFICIENCIES,
  mesoPerPercent: 100_000_000,
});

export const FLAME_TIER_PROBABILITIES = Object.freeze([
  Object.freeze({ tier: 4, p: 0.29 }),
  Object.freeze({ tier: 5, p: 0.45 }),
  Object.freeze({ tier: 6, p: 0.25 }),
  Object.freeze({ tier: 7, p: 0.01 }),
]);

// STR is the canonical main stat and DEX the canonical single substat.
// Renaming STR/DEX to any distinct main/sub pair leaves the distribution
// unchanged. The selected attack/magic option uses `attack`; the other is
// ignored. The two unrelated stats still occupy their actual option slots.
export const FLAME_ARMOR_OPTION_TYPES = Object.freeze([
  { id: 'str', label: 'STR', kind: 'single', keys: ['main'] },
  { id: 'dex', label: 'DEX', kind: 'single', keys: ['sub'] },
  { id: 'int', label: 'INT', kind: 'single', keys: [] },
  { id: 'luk', label: 'LUK', kind: 'single', keys: [] },
  { id: 'strDex', label: 'STR+DEX', kind: 'dual', keys: ['main', 'sub'] },
  { id: 'strInt', label: 'STR+INT', kind: 'dual', keys: ['main'] },
  { id: 'strLuk', label: 'STR+LUK', kind: 'dual', keys: ['main'] },
  { id: 'dexInt', label: 'DEX+INT', kind: 'dual', keys: ['sub'] },
  { id: 'dexLuk', label: 'DEX+LUK', kind: 'dual', keys: ['sub'] },
  { id: 'intLuk', label: 'INT+LUK', kind: 'dual', keys: [] },
  { id: 'hp', label: '최대 HP', kind: 'ignored', keys: [] },
  { id: 'mp', label: '최대 MP', kind: 'ignored', keys: [] },
  { id: 'levelReduction', label: '착용 레벨 감소', kind: 'ignored', keys: [] },
  { id: 'defense', label: '방어력', kind: 'ignored', keys: [] },
  { id: 'attack', label: '공격력', kind: 'tier', keys: ['attack'], minLevel: 60 },
  { id: 'magic', label: '마력', kind: 'ignored', keys: [], minLevel: 60 },
  { id: 'speed', label: '이동속도', kind: 'ignored', keys: [] },
  { id: 'jump', label: '점프력', kind: 'ignored', keys: [] },
  { id: 'all', label: '올스탯%', kind: 'tier', keys: ['all'], minLevel: 70 },
].map(option => Object.freeze({ ...option, keys: Object.freeze(option.keys) })));

export function resetCostForLevel(level) {
  return Number.isInteger(level) && level >= 1 && level <= 300 ? FLAME_RESET_COST : null;
}

export function flameOptionPoolForLevel(level) {
  if (resetCostForLevel(level) === null) throw new Error('아이템 레벨 제한은 1~300 사이의 정수로 입력해 주세요.');
  return FLAME_ARMOR_OPTION_TYPES.filter(option => level >= (option.minLevel ?? 1));
}

export function flameOptionAmount(kind, level, tier) {
  // Level-250 armor uses 12 per tier rather than the general formula's 13.
  if (kind === 'single') return (level === 250 ? 12 : Math.floor(level / 20) + 1) * tier;
  if (kind === 'dual') return (Math.floor(level / 40) + 1) * tier;
  if (kind === 'tier') return tier;
  return 0;
}

export function validateFlameSettings(settings) {
  if (!settings || typeof settings !== 'object') throw new Error('추가옵션 설정을 확인해 주세요.');
  if (resetCostForLevel(settings.itemLevel) === null) {
    throw new Error('아이템 레벨 제한은 1~300 사이의 정수로 입력해 주세요.');
  }
  const labels = { main: '주스탯', sub: '부스탯', attack: '공격력/마력', all: '올스탯%' };
  for (const key of Object.keys(labels)) {
    const current = settings.current?.[key];
    if (!Number.isFinite(current) || current < 0) {
      throw new Error(`현재 ${labels[key]}은 0 이상의 숫자로 입력해 주세요.`);
    }
    const efficiency = settings.efficiencies?.[key];
    if (!Number.isFinite(efficiency) || efficiency < 0) {
      throw new Error(`${labels[key]} 효율은 0 이상의 숫자로 입력해 주세요.`);
    }
  }
  if (!Number.isFinite(settings.mesoPerPercent) || settings.mesoPerPercent < 0) {
    throw new Error('주스탯 1%당 지불할 최대 금액은 0 이상의 숫자로 입력해 주세요.');
  }
}
