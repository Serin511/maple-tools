import test from 'node:test';
import assert from 'node:assert/strict';
import { solveAdditionalTrade } from '../additional-trade-engine.mjs';

const GRADES = ['에픽', '유니크', '레전드리'];
const keyOf = ({ g, e, u }) => `${g}/${e}/${u}`;
const close = (actual, expected, tolerance = 2e-8) => assert.ok(
  Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `${actual} != ${expected}`,
);

function makeTinyModel(cfg) {
  const start = GRADES.indexOf(cfg.startGrade);
  const states = [];
  const add = (g, e = 0, u = 0) => states.push({ g, e, u });
  if (start === 0) {
    for (let e = 0; e <= cfg.pity.에픽; e++) for (let u = 0; u <= cfg.pity.유니크; u++) add(0, e, u);
    for (let u = 0; u <= cfg.pity.유니크; u++) add(1, 0, u);
    add(2);
  } else if (start === 1) {
    for (let u = 0; u <= cfg.pity.유니크; u++) add(1, 0, u);
    add(2);
  } else add(2);
  const stateIndex = new Map(states.map((s, i) => [keyOf(s), i]));
  const indexOf = (g, e, u) => {
    const i = stateIndex.get(keyOf({ g, e, u }));
    assert.notEqual(i, undefined, `oracle transition missing state ${g}/${e}/${u}`);
    return i;
  };
  const initial = indexOf(start, cfg.stacks.에픽 ?? 0, cfg.stacks.유니크 ?? 0);

  const transitions = states.map((state, source) => {
    const branches = [];
    if (state.g === 2) {
      branches.push({ p: 1, g: 2, e: 0, u: 0 });
    } else {
      const grade = GRADES[state.g];
      const stack = state.g === 0 ? state.e : state.u;
      const cap = cfg.pity[grade];
      const up = stack >= cap ? 1 : cfg.upRates[grade];
      if (up < 1) branches.push({
        p: 1 - up, g: state.g,
        e: state.g === 0 ? Math.min(state.e + 1, cap) : state.e,
        u: state.g === 1 ? Math.min(state.u + 1, cap) : state.u,
      });
      if (up > 0) branches.push({
        p: up, g: state.g + 1,
        e: state.g === 0 ? 0 : state.e,
        u: state.g === 1 ? 0 : state.u,
      });
    }

    const choices = [];
    for (const branch of branches) {
      const resultGrade = GRADES[branch.g];
      const distribution = cfg.distributions[resultGrade];
      for (const outcome of distribution) {
        const price = resultGrade === '레전드리' && cfg.autoSell
          ? (outcome.price == null ? (cfg.floorPrice > 0 ? cfg.floorPrice : null) : Math.max(outcome.price, cfg.floorPrice ?? 0))
          : resultGrade === '레전드리' && outcome.price == null
            ? (!cfg.distributions.레전드리.some(row => row.price != null) && cfg.floorPrice > 0 ? cfg.floorPrice : null)
            : outcome.price;
        const canSell = price != null;
        const saleCash = canSell ? price * (1 - cfg.fee / 100) - cfg.itemPrice : null;
        const holdIndex = indexOf(branch.g, branch.e, branch.u);
        const sellIndex = indexOf(start, branch.e, branch.u);
        choices.push({
          p: branch.p * outcome.probability,
          firstKey: outcome.firstKey, price,
          holdIndex, sellIndex, saleCash,
          rewardHold: -cfg.costs[GRADES[state.g]],
          rewardSell: -cfg.costs[GRADES[state.g]] + saleCash,
          forcedHold: !canSell,
        });
      }
    }
    assert.ok(choices.length > 0);
    assert.ok(Math.abs(choices.reduce((sum, x) => sum + x.p, 0) - 1) < 1e-10);
    return { source, choices };
  });
  const variableChoices = transitions.flatMap((row, i) => row.choices
    .map((choice, j) => ({ state: i, outcome: j, choice }))
    .filter(({ choice }) => !choice.forcedHold));
  assert.ok(variableChoices.length < 22, `oracle case too large (${variableChoices.length} action bits)`);
  return { states, transitions, initial, variableChoices };
}

function policyForMask(model, mask) {
  const sells = model.transitions.map(row => row.choices.map(choice => !choice.forcedHold));
  model.variableChoices.forEach(({ state, outcome }, bit) => {
    sells[state][outcome] = (mask & (1 << bit)) !== 0;
  });
  return model.transitions.map((row, i) => {
    const transitionMap = new Map();
    let reward = 0;
    row.choices.forEach((choice, j) => {
      const sell = sells[i][j];
      const target = sell ? choice.sellIndex : choice.holdIndex;
      transitionMap.set(target, (transitionMap.get(target) ?? 0) + choice.p);
      reward += choice.p * (sell ? choice.rewardSell : choice.rewardHold);
    });
    return { transitions: [...transitionMap], reward };
  });
}

function reachableFrom(rows, initial) {
  const reached = new Set([initial]), pending = [initial];
  while (pending.length) {
    const i = pending.pop();
    for (const [j, p] of rows[i].transitions) if (p > 0 && !reached.has(j)) {
      reached.add(j); pending.push(j);
    }
  }
  return [...reached];
}

function recurrentClasses(rows, reachable) {
  let nextIndex = 0;
  const indices = new Map(), low = new Map(), stack = [], onStack = new Set(), result = [];
  function visit(v) {
    indices.set(v, nextIndex); low.set(v, nextIndex); nextIndex++;
    stack.push(v); onStack.add(v);
    for (const [w, p] of rows[v].transitions) if (p > 0 && reachable.includes(w)) {
      if (!indices.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v), indices.get(w)));
    }
    if (low.get(v) === indices.get(v)) {
      const component = [];
      while (true) {
        const w = stack.pop(); onStack.delete(w); component.push(w);
        if (w === v) break;
      }
      result.push(component);
    }
  }
  for (const i of reachable) if (!indices.has(i)) visit(i);
  return result.filter(component => {
    const members = new Set(component);
    return component.every(i => rows[i].transitions.every(([j, p]) => p === 0 || members.has(j)));
  });
}

function solveLinear(matrix, rhs) {
  const n = rhs.length;
  if (n === 0) return [];
  const a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    assert.ok(Math.abs(a[pivot][col]) > 1e-13, 'oracle linear system is singular');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const scale = a[col][col];
    for (let k = col; k <= n; k++) a[col][k] /= scale;
    for (let row = 0; row < n; row++) if (row !== col) {
      const factor = a[row][col];
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map(row => row[n]);
}

function stationaryGain(rows, component) {
  const n = component.length, positions = new Map(component.map((state, i) => [state, i]));
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  const rhs = Array(n).fill(0);
  for (let equation = 0; equation < n - 1; equation++) {
    const target = component[equation];
    for (const source of component) {
      const sourcePosition = positions.get(source);
      const p = rows[source].transitions.find(([state]) => state === target)?.[1] ?? 0;
      matrix[equation][sourcePosition] = p - (source === target ? 1 : 0);
    }
  }
  matrix[n - 1].fill(1); rhs[n - 1] = 1;
  const stationary = solveLinear(matrix, rhs);
  return component.reduce((sum, state, i) => sum + stationary[i] * rows[state].reward, 0);
}

function gainForPolicy(rows, initial) {
  const reachable = reachableFrom(rows, initial);
  const classes = recurrentClasses(rows, reachable);
  const classOf = new Map(); classes.forEach((component, i) => component.forEach(state => classOf.set(state, i)));
  const transient = reachable.filter(state => !classOf.has(state));
  const gains = classes.map(component => stationaryGain(rows, component));
  if (classOf.has(initial)) return gains[classOf.get(initial)];
  const m = transient.length, pos = new Map(transient.map((state, i) => [state, i]));
  const matrix = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) =>
    (i === j ? 1 : 0) - (rows[transient[i]].transitions.find(([state]) => state === transient[j])?.[1] ?? 0)));
  const absorption = classes.map((component, c) => {
    const members = new Set(component);
    const rhs = transient.map(state => rows[state].transitions.reduce((sum, [next, p]) => sum + (members.has(next) ? p : 0), 0));
    return solveLinear(matrix, rhs);
  });
  const initialPos = pos.get(initial);
  return classes.reduce((sum, _, c) => sum + absorption[c][initialPos] * gains[c], 0);
}

function enumerateOracle(input) {
  const model = makeTinyModel(input);
  let best = -Infinity, bestMask = null;
  const policyCount = 2 ** model.variableChoices.length;
  for (let mask = 0; mask < policyCount; mask++) {
    const gain = gainForPolicy(policyForMask(model, mask), model.initial);
    if (gain > best) { best = gain; bestMask = mask; }
  }
  return { best, bestMask, policyCount };
}

// An independent full Markov oracle keeps actual Prime reset states. It does
// not use the production absorbing-session formulas or gain root solver.
function enumeratePrimeOracle(cfg) {
  const model = makeTinyModel(cfg), option = cfg.prime.options[0], primeCost = cfg.prime.cost;
  const prices = [...new Set([null, ...option.distribution.map(row => row.price), ...cfg.distributions.레전드리.map(row => row.price)])]
    .sort((a, b) => (a ?? -Infinity) - (b ?? -Infinity));
  const primeIndex = new Map(prices.map((price, index) => [price, model.states.length + index]));
  const replacement = model.states.findIndex(state => state.g === GRADES.indexOf(cfg.startGrade) && state.e === 0 && state.u === 0);
  const cash = price => price * (1 - cfg.fee / 100) - cfg.itemPrice;
  const rows = model.transitions.map(row => ({ choices: row.choices.map(choice => ({ p: choice.p, actions: [
    { target: choice.holdIndex, reward: choice.rewardHold },
    ...(!choice.forcedHold ? [{ target: choice.sellIndex, reward: choice.rewardSell }] : []),
    ...(choice.firstKey === option.key ? [{ target: primeIndex.get(choice.price), reward: choice.rewardHold }] : []),
  ] })) }));
  for (const oldPrice of prices) {
    rows.push({ choices: option.distribution.map(outcome => {
      const retained = (outcome.price ?? -Infinity) > (oldPrice ?? -Infinity) ? outcome.price : oldPrice;
      return { p: outcome.probability, actions: [
        { target: primeIndex.get(retained), reward: -primeCost },
        ...(retained !== null ? [{ target: replacement, reward: -primeCost + cash(retained) }] : []),
      ] };
    }) });
  }
  const choices = rows.flatMap((row, state) => row.choices.map((choice, outcome) => ({ state, outcome, ...choice }))).filter(choice => choice.actions.length > 1);
  const selected = rows.map(row => row.choices.map(() => 0));
  let best = -Infinity, policyCount = 0;
  function enumerate(cursor) {
    if (cursor < choices.length) {
      const choice = choices[cursor];
      for (let action = 0; action < choice.actions.length; action++) { selected[choice.state][choice.outcome] = action; enumerate(cursor + 1); }
      return;
    }
    const chain = rows.map((row, state) => {
      const transitions = new Map(); let reward = 0;
      row.choices.forEach((choice, outcome) => {
        const action = choice.actions[selected[state][outcome]];
        transitions.set(action.target, (transitions.get(action.target) ?? 0) + choice.p);
        reward += choice.p * action.reward;
      });
      return { transitions: [...transitions], reward };
    });
    best = Math.max(best, gainForPolicy(chain, model.initial)); policyCount++;
  }
  enumerate(0);
  return { best, policyCount };
}

test('Prime absorption agrees with an exhaustive full-state oracle through both pity counters and replacement', () => {
  const cfg = {
    startGrade: '에픽', itemPrice: 5, fee: 10, floorPrice: 0, autoSell: true,
    costs: { 에픽: 3, 유니크: 4, 레전드리: 10 },
    upRates: { 에픽: .3, 유니크: .4 }, pity: { 에픽: 1, 유니크: 0 }, stacks: { 에픽: 1, 유니크: 0 },
    distributions: { 에픽: [outcome(1, 4)], 유니크: [outcome(.5, 15), outcome(.5, null)],
      레전드리: [{ probability: .6, price: null, firstKey: 'A' }, { probability: .4, price: 100, firstKey: 'B' }] },
    prime: { on: true, cost: 2, fixedKey: 'A', options: [{ key: 'A', distribution: [outcome(.5, null), outcome(.5, 100)] }] },
  };
  const oracle = enumeratePrimeOracle(cfg), result = solveAdditionalTrade(cfg);
  assert.ok(oracle.policyCount > 100);
  close(result.steady.profitPerReset, oracle.best);
  close(result.convergence.bellmanProfitPerReset, oracle.best);
  assert.ok(result.current.expectedPrimeAttempts > 0);
  assert.ok(result.current.expectedAttempts !== result.steady.expectedAttempts); // current stack differs
});

test('Prime full-state oracle includes a cheaper no-sale recurrent class', () => {
  const cfg = { startGrade: '레전드리', itemPrice: 200, fee: 0, floorPrice: 0, autoSell: true,
    costs: { 레전드리: 10 }, upRates: {}, pity: {}, stacks: {},
    distributions: { 레전드리: [{ probability: .5, price: null, firstKey: 'A' }, { probability: .5, price: 1, firstKey: 'B' }] },
    prime: { on: true, cost: 1, fixedKey: 'A', options: [{ key: 'A', distribution: [outcome(.5, null), outcome(.5, 1)] }] },
  };
  const oracle = enumeratePrimeOracle(cfg), result = solveAdditionalTrade(cfg);
  close(result.steady.profitPerReset, oracle.best);
  assert.equal(result.possible, false);
});

const outcome = (probability, price, targetId = null) => ({ probability, price, targetId });
function input(overrides = {}) {
  return {
    startGrade: '에픽', itemPrice: 7, fee: 13, floorPrice: 0,
    autoSell: true, miracle: false,
    costs: { 에픽: 2, 유니크: 3, 레전드리: 5 },
    upRates: { 에픽: 0.35, 유니크: 0.4 },
    pity: { 에픽: 1, 유니크: 1 }, stacks: { 에픽: 0, 유니크: 0 },
    distributions: {
      에픽: [outcome(1, 10, 'epic')],
      유니크: [outcome(1, 20, 'unique')],
      레전드리: [outcome(1, null)],
    },
    ...overrides,
  };
}

const cases = [
  ['Epic start with two pity counters and positive all-sell revenue', input()],
  ['Epic start with mixed priced and missing outcomes plus negative cash', input({
    itemPrice: 15, fee: 20, costs: { 에픽: 2, 유니크: 4, 레전드리: 8 },
    upRates: { 에픽: 0.6, 유니크: 0.25 },
    pity: { 에픽: 1, 유니크: 0 }, stacks: { 에픽: 0, 유니크: 0 },
    distributions: {
      에픽: [outcome(0.4, 8, 'epic-low'), outcome(0.6, 30, 'epic-high')],
      유니크: [outcome(0.5, 12, 'unique-low'), outcome(0.5, null)],
      레전드리: [outcome(1, null)],
    },
  })],
  ['Unique start with a mixed transient path into the no-sale Legendary sink', input({
    startGrade: '유니크', itemPrice: 7, fee: 10,
    costs: { 에픽: 2, 유니크: 3, 레전드리: 6 },
    upRates: { 에픽: 0.4, 유니크: 0.5 },
    pity: { 에픽: 1, 유니크: 1 }, stacks: { 에픽: 0, 유니크: 0 },
    distributions: {
      에픽: [outcome(1, 10, 'epic')],
      유니크: [outcome(0.6, 30, 'unique'), outcome(0.4, null)],
      레전드리: [outcome(1, null)],
    },
  })],
  ['Unique start with negative sale cash where selling can still beat the trap', input({
    startGrade: '유니크', itemPrice: 25, fee: 10,
    costs: { 에픽: 2, 유니크: 3, 레전드리: 12 },
    upRates: { 에픽: 0.4, 유니크: 0.5 },
    pity: { 에픽: 1, 유니크: 1 }, stacks: { 에픽: 0, 유니크: 0 },
    distributions: {
      에픽: [outcome(1, 10, 'epic')],
      유니크: [outcome(1, 20, 'unique')],
      레전드리: [outcome(1, null)],
    },
  })],
];

function seededCases(seed, count) {
  let state = seed >>> 0;
  const next = max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
  const rates = [0, 0.2, 0.6, 1];
  const possiblePrices = [6, 14, 32];
  return Array.from({ length: count }, (_, i) => {
    const startGrade = i % 2 === 0 ? '에픽' : '유니크';
    const pity = { 에픽: next(2), 유니크: startGrade === '유니크' ? 1 : next(2) };
    const epicPrice = possiblePrices[next(possiblePrices.length)];
    const uniquePrice = possiblePrices[next(possiblePrices.length)];
    const uniqueUpRate = startGrade === '유니크' ? rates[next(rates.length - 1)] : rates[next(rates.length)];
    return [`seeded tiny policy grid case ${i + 1}`, input({
      startGrade,
      itemPrice: [0, 9, 27][next(3)], fee: [0, 12, 37][next(3)],
      costs: { 에픽: 1 + next(5), 유니크: 1 + next(5), 레전드리: 1 + next(9) },
      upRates: { 에픽: rates[next(rates.length)], 유니크: uniqueUpRate },
      pity, stacks: {
        에픽: startGrade === '에픽' ? next(pity.에픽 + 1) : 0,
        유니크: startGrade === '유니크' ? 0 : next(pity.유니크 + 1),
      },
      distributions: {
        에픽: [outcome(1, epicPrice, epicPrice == null ? null : 'epic')],
        유니크: [outcome(1, uniquePrice, uniquePrice == null ? null : 'unique')],
        레전드리: [outcome(1, null)],
      },
    })];
  });
}

test('oracle sanity check: zero-pity forced promotion earns 16 per reset when selling', () => {
  const scenario = input({
    itemPrice: 3, fee: 0, costs: { 에픽: 1, 유니크: 2, 레전드리: 3 },
    upRates: { 에픽: 0, 유니크: 0 }, pity: { 에픽: 0, 유니크: 0 },
    distributions: {
      에픽: [outcome(1, 10, 'epic')],
      유니크: [outcome(1, 20, 'unique')],
      레전드리: [outcome(1, null)],
    },
  });
  assert.equal(enumerateOracle(scenario).best, 16);
});

for (const [name, scenario] of [...cases, ...seededCases(0xA11CE, 8)]) {
  test(`multichain exhaustive oracle: ${name}`, () => {
    const oracle = enumerateOracle(scenario);
    const result = solveAdditionalTrade(scenario);
    assert.equal(result.convergence.converged, true);
    close(result.steady.profitPerReset, oracle.best);
    assert.ok(oracle.policyCount <= 2 ** 10, `unexpected oracle size ${oracle.policyCount}`);
  });
}
