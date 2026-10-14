import test from 'node:test';
import assert from 'node:assert/strict';
import { migratePotentialPrices, normalizePotentialPresets, normalizePotentialSettings } from '../potential-settings.mjs';

test('missing and malformed snapshots restore the original defaults as independent values', () => {
  const expected = {
    level: 200, part: 'acc', itemPriceEok: '3', fee: '3', pity: '0', floorEok: '1.5',
    miracle: false, autoExclude: true, allstatCount: true,
    costs: { epic: 18000000, unique: 38250000, legend: 45000000 }, statPrices: {},
    hatRows: [{ cd: 2, statMin: 12, stat: 'STR', price: '' }, { cd: 3, statMin: 0, stat: 'STR', price: '' }, { cd: 4, statMin: 0, stat: 'STR', price: '' }],
    gloveRows: [{ crit: 8, statMin: 12, stat: 'STR', price: '' }, { crit: 16, statMin: 0, stat: 'STR', price: '' }, { crit: 24, statMin: 0, stat: 'STR', price: '' }],
    accPrices: { drop2: '', meso2: '', dropmeso: '', dm3: '' },
    pityMode: 'single', primeOn: false, primeCostEok: '7', primeFixed: 'auto',
  };
  for (const value of [undefined, null, false, 1, 'bad', [], {}]) assert.deepEqual(normalizePotentialSettings(value), expected);
  const changed = normalizePotentialSettings();
  changed.costs.epic = 1;
  changed.hatRows[0].price = '99';
  assert.deepEqual(normalizePotentialSettings(), expected);
});

test('corrupt scalar values and unsupported enums recover without coercing objects', () => {
  const saved = {
    level: {}, part: 'unknown', itemPriceEok: { valueOf: null, toString: null }, fee: 101,
    pity: '2.5', floorEok: -1, primeCostEok: Infinity, primeFixed: 'unknown', pityMode: {},
    miracle: 'false', autoExclude: 0, allstatCount: null, primeOn: 'true',
    costs: { epic: {}, unique: 'not numeric', legend: -5, extra: 1 },
    accPrices: { drop2: [], meso2: '1oops', dropmeso: NaN, dm3: true, extra: 1 }, extra: 'ignored',
  };
  const result = normalizePotentialSettings(saved);
  assert.deepEqual(result, normalizePotentialSettings());
  assert.equal(saved.part, 'unknown');
});

test('valid inputs and blank editable numbers survive loading with level-specific costs', () => {
  const result = normalizePotentialSettings({
    level: '250', part: 'hat', itemPriceEok: '', fee: '', pity: '', floorEok: '0', primeCostEok: '',
    costs: { epic: '', unique: '123.5' }, miracle: true, autoExclude: false, allstatCount: false,
    primeOn: true, primeFixed: 'CD2', pityMode: 'campaign', accPrices: { drop2: '1e2', dm3: 0 },
  });
  assert.equal(result.level, 250);
  assert.deepEqual(result.costs, { epic: '', unique: '123.5', legend: 50000000 });
  for (const key of ['itemPriceEok', 'fee', 'pity', 'primeCostEok']) assert.equal(result[key], '');
  assert.equal(result.floorEok, '0');
  assert.equal(result.accPrices.drop2, '1e2');
  assert.equal(result.accPrices.dm3, 0);
  assert.equal(result.miracle, true);
  assert.equal(result.autoExclude, false);
  assert.equal(result.allstatCount, true);
  assert.equal(result.primeOn, true);
  assert.equal(result.primeFixed, 'CD2');
  assert.equal(result.pityMode, 'campaign');
  assert.equal(normalizePotentialSettings({ part: 'acc', primeFixed: 'CD2' }).primeFixed, 'auto');
});

test('Prime defaults to automatic selection while saved manual options remain explicit', () => {
  for (const primeFixed of [undefined, null, 'invalid', 'CRIT'])
    assert.equal(normalizePotentialSettings({ part: 'hat', primeFixed }).primeFixed, 'auto');
  for (const primeFixed of ['auto', 'STR', 'ALL', 'CD2']) {
    const saved = { part: 'hat', primeOn: true, primeFixed, primeCostEok: '9' };
    const before = structuredClone(saved);
    const restored = normalizePotentialPresets({ selected: saved }).selected;
    assert.equal(restored.primeFixed, primeFixed);
    assert.equal(restored.primeCostEok, '9');
    assert.equal(restored.primeOn, true);
    assert.deepEqual(saved, before);
  }
});

test('retired all-stat settings and presets always restore inclusion without altering saved inputs', () => {
  const saved = { allstatCount: false, part: 'hat', level: 250, itemPriceEok: '2.5',
    pity: '42', statPrices: { 'l:STR_26': '12', 'l:HP_26': '5' }, hatRows: [] };
  const before = structuredClone(saved);
  const restored = normalizePotentialSettings(saved);
  assert.equal(restored.allstatCount, true);
  assert.equal(restored.itemPriceEok, saved.itemPriceEok);
  assert.equal(restored.pity, saved.pity);
  assert.deepEqual(restored.statPrices, saved.statPrices);
  assert.deepEqual(restored.hatRows, []);
  assert.deepEqual(normalizePotentialPresets({ old: saved }).old, restored);
  assert.deepEqual(saved, before);
});

test('special rows preserve deliberate empty lists and sanitize broken rows', () => {
  const empty = normalizePotentialSettings({ hatRows: [], gloveRows: [] });
  assert.deepEqual(empty.hatRows, []);
  assert.deepEqual(empty.gloveRows, []);
  assert.deepEqual(normalizePotentialSettings({ hatRows: 'bad' }).hatRows, normalizePotentialSettings().hatRows);
  const result = normalizePotentialSettings({
    hatRows: [null, false, 'bad', [], { cd: 99, statMin: {}, stat: 'bad', price: {} }, { cd: '6', statMin: '13.5', stat: 'INT', price: '2.25', extra: true }],
    gloveRows: [{ crit: 7, statMin: -1, price: -1 }, { crit: '24', statMin: 12, stat: 'LUK', price: '' }],
  });
  assert.deepEqual(result.hatRows, [{ cd: 2, statMin: 0, stat: 'STR', price: '' }, { cd: 6, statMin: 13.5, stat: 'INT', price: '2.25' }]);
  assert.deepEqual(result.gloveRows, [{ crit: 8, statMin: 0, stat: 'STR', price: '' }, { crit: 24, statMin: 12, stat: 'LUK', price: '' }]);
});

test('legacy prices migrate to both grades while valid level thresholds and blanks remain', () => {
  const prices = Object.assign(Object.create({ STR_12: 'inherited' }), {
    INT_24: '5', 'u:INT_24': '7', 'l:STR_39': 10, ALL_30: '', 'u:HP_12': 0,
    'u:DEX_15': {}, 'l:LUK_12': '-1', 'u:INT_21': 'Infinity',
    wrong: 1, 'p:STR_12': 2, 'u:ALL_12': 3, 'u:STR_99': 4,
  });
  assert.deepEqual(migratePotentialPrices(prices), {
    'u:INT_24': '7', 'l:INT_24': '5', 'l:STR_39': 10, 'u:ALL_30': '', 'l:ALL_30': '', 'u:HP_12': 0,
    'u:DEX_15': '', 'l:LUK_12': '', 'u:INT_21': '',
  });
  assert.deepEqual(migratePotentialPrices(['5']), {});
  assert.deepEqual(migratePotentialPrices('5'), {});
});

test('preset maps contain only own record entries and normalize every snapshot', () => {
  const source = Object.assign(Object.create({ inherited: { part: 'hat' } }), {
    empty: { part: 'hat', hatRows: [], gloveRows: [] },
    old: { statPrices: { INT_24: '5' } }, broken: { part: 'unknown', hatRows: [null] },
    nullValue: null, stringValue: 'bad', arrayValue: [], ' ': {},
  });
  const result = normalizePotentialPresets(source);
  assert.deepEqual(Object.keys(result), ['empty', 'old', 'broken']);
  assert.deepEqual(result.empty.hatRows, []);
  assert.deepEqual(result.empty.gloveRows, []);
  assert.deepEqual(result.old.statPrices, { 'u:INT_24': '5', 'l:INT_24': '5' });
  assert.equal(result.broken.part, 'acc');
  assert.deepEqual(result.broken.hatRows, []);
  result.empty.hatRows.push({});
  assert.deepEqual(source.empty.hatRows, []);
  assert.deepEqual(normalizePotentialPresets([]), {});
  assert.deepEqual(normalizePotentialPresets(null), {});
});

test('inherited settings never override defaults and prototype-like preset names remain own data', () => {
  assert.deepEqual(normalizePotentialSettings(Object.create({ part: 'hat', level: 250 })), normalizePotentialSettings());
  const result = normalizePotentialPresets(JSON.parse('{"__proto__":{"part":"hat","hatRows":[]}}'));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result.__proto__.part, 'hat');
  assert.deepEqual(result.__proto__.hatRows, []);
});
