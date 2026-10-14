import { PITY, solveEngine, runMC, campaignStats } from './potential-engine.mjs';

const numeric = (value, label, { max = Infinity, integer = false } = {}) => {
  if (value == null || !['string', 'number'].includes(typeof value) || (typeof value === 'string' && value.trim() === '')) throw new Error(`${label}을(를) 입력해 주세요.`);
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error(`${label}은(는) 숫자로 입력해 주세요.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${label}은(는) 0${Number.isFinite(max) ? `~${max}` : ' 이상'}의 ${integer ? '정수' : '숫자'}로 입력해 주세요.`);
  }
  return number;
};

// Keep raw editable input validation identical in the UI and worker.
export function preparePotentialConfig(input) {
  numeric(input.pity, '유→레 천장 스택', { max: PITY.unique, integer: true });
  for (const price of input.priceInputs || []) if (price !== '') numeric(price, '판매가');
  return {
    part: input.part, level: input.level, targetsU: input.targetsU, targetsL: input.targetsL,
    allstatCount: input.allstatCount, miracle: input.miracle, autoExclude: input.autoExclude,
    fee: numeric(input.fee, '경매장 수수료', { max: 100 }),
    costs: Object.fromEntries(['epic', 'unique', 'legend'].map(grade => [grade, numeric(input.costs?.[grade], '재설정 비용')])),
    itemPrice: numeric(input.itemPriceEok, '노작 매입가') * 1e8,
    floorPrice: numeric(input.floorEok, '레전드리 처분가') * 1e8,
    prime: { on: input.primeOn, cost: input.primeOn ? numeric(input.primeCostEok, '프라임 큐브 가격') * 1e8 : 0, fixedKey: input.primeFixed },
  };
}

const transferableEngine = ({ round, roundDist, ...engine }) => engine;

export function calculatePotentialStrategy(input, { simulation = {} } = {}) {
  const cfg = preparePotentialConfig(input);
  const eng = solveEngine(cfg);
  const base = input.primeOn ? solveEngine({ ...cfg, prime: { on: false } }) : null;
  const j0 = numeric(input.pity, '유→레 천장 스택', { max: PITY.unique, integer: true });
  const first = eng.round(j0);
  const singleRound = j0 > 0;
  let camp = null, campaignWarning = '';
  if (singleRound) {
    try { camp = campaignStats(eng, j0, cfg.itemPrice); }
    catch (failure) { campaignWarning = failure.message; }
  }
  const pityMode = camp ? input.pityMode : 'single';
  const mode = !singleRound ? 'chain' : pityMode === 'campaign' ? 'campaign' : 'independent';
  const resets = mode === 'campaign' && camp ? camp.resets : eng.steady.resets;
  const samples = Math.max(1000, Math.min(15000, Math.floor(1.5e6 / Math.max(20, resets))));
  let mc = null, simulationWarning = '';
  try { mc = runMC(eng, cfg, j0, samples, mode, simulation); }
  catch (failure) { simulationWarning = failure.message; }
  return {
    eng: transferableEngine(eng), cfg, first, j0, mc, singleRound, camp,
    pityMode, base: base ? transferableEngine(base) : null, campaignWarning,
    targets: { u: input.targetsU, l: input.targetsL }, simulationWarning,
  };
}
