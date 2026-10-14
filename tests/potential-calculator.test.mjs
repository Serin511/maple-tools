import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePotentialConfig, calculatePotentialStrategy } from '../potential-calculator.mjs';
import { solveEngine, campaignStats } from '../potential-engine.mjs';

const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const settings = (patch = {}) => ({
  part: 'heart', level: 200, targetsU: [{ id: 'str12', kind: 'stat', stat: 'STR', min: 12, price: 500 }], targetsL: [],
  allstatCount: true, miracle: false, autoExclude: false, fee: '3',
  costs: { epic: '2', unique: '3', legend: '5' },
  itemPriceEok: '0.00000007', floorEok: '0.000001', pity: '50', pityMode: 'single',
  primeOn: false, primeCostEok: '', primeFixed: 'STR', priceInputs: ['0.000005', ''], ...patch,
});

test('editable money fields convert from eok once; reset costs and target prices retain meso units', () => {
  const cfg = preparePotentialConfig(settings({ itemPriceEok: '1.25', floorEok: '.5', fee: '2.5', primeOn: true, primeCostEok: '0.125' }));
  assert.equal(cfg.itemPrice, 125_000_000);
  assert.equal(cfg.floorPrice, 50_000_000);
  assert.equal(cfg.prime.cost, 12_500_000);
  assert.deepEqual(cfg.costs, { epic: 2, unique: 3, legend: 5 });
  assert.equal(cfg.targetsU[0].price, 500);
  assert.equal(cfg.fee, 2.5);
  assert.equal(preparePotentialConfig(settings({ itemPriceEok: 0, floorEok: '0', fee: 100 })).itemPrice, 0);
});

test('raw blank, negative and out-of-range editable inputs fail before a calculation', () => {
  for (const patch of [
    { fee: '' }, { fee: '   ' }, { fee: -1 }, { fee: '100.01' }, { fee: 'Infinity' }, { fee: false },
    { pity: '' }, { pity: '-1' }, { pity: '108' }, { pity: '3.5' }, { pity: '0x10' },
    { itemPriceEok: '' }, { itemPriceEok: '-.1' }, { floorEok: null }, { floorEok: 'NaN' },
    { costs: { epic: '', unique: 3, legend: 5 } }, { costs: { epic: 2, unique: -1, legend: 5 } },
    { primeOn: true, primeCostEok: '' }, { primeOn: true, primeCostEok: '-1' },
    { priceInputs: ['-1'] }, { priceInputs: ['NaN'] },
  ]) assert.throws(() => preparePotentialConfig(settings(patch)), Error, JSON.stringify(patch));
  // Empty sale prices and the disabled Prime cost are optional; zero is explicit.
  assert.doesNotThrow(() => preparePotentialConfig(settings({ primeCostEok: '', priceInputs: ['', '0'] })));
});

test('worker calculator returns the same first and campaign expectations as the pure engine', () => {
  const input = settings({ pityMode: 'campaign' }), before = structuredClone(input);
  const actual = calculatePotentialStrategy(input), expectedEngine = solveEngine(preparePotentialConfig(input));
  assert.deepEqual(input, before);
  assert.deepEqual(actual.first, expectedEngine.round(50));
  assert.deepEqual(actual.camp, campaignStats(expectedEngine, 50, actual.cfg.itemPrice));
  close(actual.eng.steady.profit, expectedEngine.steady.profit);
  assert.equal(actual.j0, 50);
  assert.equal(actual.singleRound, true);
  assert.equal(actual.pityMode, 'campaign');
  assert.ok(actual.mc.avgRounds > 1);
  assert.equal(actual.simulationWarning, '');
});

test('the calculator uses the mandatory all-stat rule even for legacy disabled inputs', () => {
  const input = settings({ allstatCount: false });
  assert.equal(preparePotentialConfig(input).allstatCount, true);
  assert.deepEqual(calculatePotentialStrategy(input), calculatePotentialStrategy({ ...input, allstatCount: true }));
  assert.equal(input.allstatCount, false);
});

test('full Prime and baseline result crosses a structured-clone worker boundary without functions', () => {
  const input = settings({ targetsU: [], targetsL: [{ id: 'str36', kind: 'stat', stat: 'STR', min: 36, price: 1e6 }],
    pity: '0', floorEok: '0', primeOn: true, primeCostEok: '0.0000001' });
  const result = calculatePotentialStrategy(input), cloned = structuredClone(result);
  assert.deepEqual(cloned, result);
  assert.equal(result.eng.legMode, 'P');
  assert.equal(result.base.legMode, 'B');
  assert.equal(result.singleRound, false);
  assert.equal(result.camp, null);
  for (const engine of [result.eng, result.base]) {
    assert.equal(Object.hasOwn(engine, 'round'), false);
    assert.equal(Object.hasOwn(engine, 'roundDist'), false);
  }
  const verifyNoFunctions = (value) => {
    assert.notEqual(typeof value, 'function');
    if (value && typeof value === 'object') Object.values(value).forEach(verifyNoFunctions);
  };
  verifyNoFunctions(result);
  assert.ok(Number.isFinite(result.mc.avgProfit));
});

test('simulation budget errors preserve the exact solution and report an optional warning', () => {
  const input = settings(), result = calculatePotentialStrategy(input, { simulation: { maxRounds: 1 } });
  const engine = solveEngine(preparePotentialConfig(input));
  assert.equal(result.mc, null);
  assert.match(result.simulationWarning, /예산/);
  assert.deepEqual(result.first, engine.round(50));
  close(result.eng.steady.profit, engine.steady.profit);
  assert.deepEqual(result.camp, campaignStats(engine, 50, result.cfg.itemPrice));
  assert.doesNotThrow(() => structuredClone(result));
});

test('a non-terminating campaign preserves the single-round result and falls back to independent sampling', () => {
  const input = settings({ targetsU: [{ id: 'always', kind: 'stat', stat: 'STR', min: 0, price: 500 }], pityMode: 'campaign' });
  const result = calculatePotentialStrategy(input), engine = solveEngine(preparePotentialConfig(input));
  assert.equal(result.camp, null);
  assert.match(result.campaignWarning, /종료되지/);
  assert.equal(result.pityMode, 'single');
  assert.equal(result.mc.avgRounds, 1);
  assert.deepEqual(result.first, engine.round(50));
  close(result.eng.steady.resets, engine.epicRolls);
  assert.equal(result.simulationWarning, '');
});

test('actual worker posts matching request ids, serializable results and errors for invalid inputs', async () => {
  const originalSelf = globalThis.self, messages = [];
  const fakeWorker = { postMessage: message => messages.push(structuredClone(message)) };
  globalThis.self = fakeWorker;
  try {
    await import('../potential-worker.mjs');
    fakeWorker.onmessage({ data: { id: 17, settings: settings({ pity: '0', allstatCount: false }) } });
    assert.deepEqual(messages.map(m => [m.id, m.type]), [[17, 'progress'], [17, 'result']]);
    assert.ok(Number.isFinite(messages[1].result.first.profit));
    assert.equal(messages[1].result.cfg.allstatCount, true);
    messages.length = 0;
    fakeWorker.onmessage({ data: { id: 18, settings: settings({ fee: '-1' }) } });
    assert.deepEqual(messages.map(m => [m.id, m.type]), [[18, 'progress'], [18, 'error']]);
    assert.match(messages[1].message, /수수료/);
  } finally {
    if (originalSelf === undefined) delete globalThis.self;
    else globalThis.self = originalSelf;
  }
});
