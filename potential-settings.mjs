import { COST_DEFAULT, PART_LABELS, PITY, STATS, primeAtomList } from './potential-engine.mjs';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = value => isRecord(value) ? value : {};
const own = (value, key) => Object.hasOwn(value, key) ? value[key] : undefined;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const scalar = (value, fallback, { max = Infinity, integer = false, blank = true } = {}) => {
  if (blank && value === '') return '';
  if (typeof value !== 'number' && !(typeof value === 'string' && decimal.test(value))) return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max && (!integer || Number.isInteger(number))
    ? value : fallback;
};
const boolean = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const choice = (value, values, fallback) => values.includes(value) ? value : fallback;
const priceThresholds = new Set([12, 14, 15, 17, 18, 20, 21, 23, 24, 26, 27, 30, 33, 36, 39]);
const allThresholds = new Set([18, 21, 24, 27, 30]);

function priceKey(key) {
  const match = /^(?:[ul]:)?(STR|DEX|INT|LUK|HP|ALL)_(\d+)$/.exec(key);
  return !!match && (match[1] === 'ALL' ? allThresholds : priceThresholds).has(Number(match[2]));
}

// Legacy unprefixed prices applied to both grades. Preserve that migration and
// retain all supported level thresholds when the selected item level changes.
export function migratePotentialPrices(value) {
  const prices = {};
  for (const [key, valueAtKey] of Object.entries(record(value))) {
    if (!priceKey(key)) continue;
    const price = scalar(valueAtKey, '');
    if (key.startsWith('u:') || key.startsWith('l:')) prices[key] = price;
    else {
      prices[`u:${key}`] = price;
      prices[`l:${key}`] = price;
    }
  }
  return prices;
}

function rows(value, kind) {
  if (!Array.isArray(value)) {
    return (kind === 'cd' ? [2, 3, 4] : [8, 16, 24]).map((amount, index) => ({
      [kind]: amount, statMin: index === 0 ? 12 : 0, stat: 'STR', price: '',
    }));
  }
  const allowed = kind === 'cd' ? [2, 3, 4, 5, 6] : [8, 16, 24];
  return value.filter(isRecord).map(row => ({
    [kind]: choice(Number(scalar(own(row, kind), allowed[0], { integer: true, blank: false })), allowed, allowed[0]),
    // A saved threshold can remain useful after switching item level even when
    // it is absent from the new level's quick choices.
    statMin: Number(scalar(own(row, 'statMin'), 0, { blank: false })),
    stat: choice(own(row, 'stat'), STATS, 'STR'),
    price: scalar(own(row, 'price'), ''),
  }));
}

export function normalizePotentialSettings(value) {
  const saved = record(value);
  const level = choice(Number(scalar(own(saved, 'level'), 200, { integer: true, blank: false })), [140, 160, 200, 250], 200);
  const part = choice(own(saved, 'part'), Object.keys(PART_LABELS), 'acc');
  const costs = record(own(saved, 'costs'));
  const accPrices = record(own(saved, 'accPrices'));
  const primeKeys = primeAtomList(part, level).map(atom => atom.key);
  return {
    level, part,
    itemPriceEok: scalar(own(saved, 'itemPriceEok'), '3'),
    fee: scalar(own(saved, 'fee'), '3', { max: 100 }),
    pity: scalar(own(saved, 'pity'), '0', { max: PITY.unique, integer: true }),
    floorEok: scalar(own(saved, 'floorEok'), '1.5'),
    miracle: boolean(own(saved, 'miracle'), false),
    autoExclude: boolean(own(saved, 'autoExclude'), true),
    allstatCount: boolean(own(saved, 'allstatCount'), true),
    costs: Object.fromEntries(Object.entries(COST_DEFAULT[level]).map(([grade, fallback]) => [grade, scalar(own(costs, grade), fallback)])),
    statPrices: migratePotentialPrices(own(saved, 'statPrices')),
    hatRows: rows(own(saved, 'hatRows'), 'cd'),
    gloveRows: rows(own(saved, 'gloveRows'), 'crit'),
    accPrices: Object.fromEntries(['drop2', 'meso2', 'dropmeso', 'dm3'].map(key => [key, scalar(own(accPrices, key), '')])),
    pityMode: choice(own(saved, 'pityMode'), ['single', 'campaign'], 'single'),
    primeOn: boolean(own(saved, 'primeOn'), false),
    primeCostEok: scalar(own(saved, 'primeCostEok'), '7'),
    primeFixed: choice(own(saved, 'primeFixed'), primeKeys, 'STR'),
  };
}

export function normalizePotentialPresets(value) {
  return Object.fromEntries(Object.entries(record(value))
    .filter(([name, snapshot]) => name.trim() && isRecord(snapshot))
    .map(([name, snapshot]) => [name, normalizePotentialSettings(snapshot)]));
}
