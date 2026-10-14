import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADE_UP, PITY, ESCAPE, COST_DEFAULT, POOL_TOTALS, STATS,
  buildTierAtoms, enumerateRolls, comboSums, familize, bestHit, gradeStats,
  primeAtomList, solvePrime, buildEngine, solveEngine, mulberry32,
  sampleGeometric, runMC, campaignStats,
} from '../potential-engine.mjs';

const close = (actual, expected, tol = 1e-10) => assert.ok(
  Math.abs(actual - expected) <= tol * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`,
);
const stat = (id, min, price, name = 'STR') => ({ id, kind: 'stat', stat: name, min, price });
const config = (overrides = {}) => ({
  part: 'heart', level: 200, targetsU: [], targetsL: [], allstatCount: true,
  fee: 3, miracle: false, costs: { epic: 2, unique: 3, legend: 5 },
  itemPrice: 7, floorPrice: 100, autoExclude: false, ...overrides,
});
// Independent closed form for min(geometric(p), maximum).
const pityMean = (p, maximum) => (1 - (1 - p) ** maximum) / p;

test('every supported part, level and tier has a nonnegative normalized atom pool', () => {
  for (const part of Object.keys(POOL_TOTALS)) for (const level of Object.keys(COST_DEFAULT).map(Number)) {
    for (const tier of ['epic', 'unique', 'legend']) {
      const pool = buildTierAtoms(part, tier, level);
      assert.equal(pool.atoms.reduce((s, a) => s + a.weight, 0), pool.total);
      assert.equal(new Set(pool.atoms.map(a => a.key)).size, pool.atoms.length);
      assert.ok(pool.atoms.every(a => a.weight > 0 && Number.isFinite(a.value)));
      const str = pool.atoms.find(a => a.key === 'STR');
      assert.equal(str.value, { epic: 6, unique: 9, legend: 12 }[tier] + (level === 250 ? 1 : 0));
    }
  }
});

test('three-line distributions conserve probability and respect all duplicate limits', () => {
  for (const part of Object.keys(POOL_TOTALS)) for (const level of Object.keys(COST_DEFAULT).map(Number)) {
    for (const grade of ['unique', 'legend']) {
      let mass = 0, count = 0;
      enumerateRolls(part, level, grade, (p, ...atoms) => {
        mass += p; count++;
        assert.ok(p > 0 && p <= 1);
        for (const [kind, max] of [['useful', 1], ['invulT', 1], ['invulP', 2], ['dmgIg', 2]])
          assert.ok(atoms.filter(a => a.kind === kind).length <= max);
      });
      close(mass, 1);
      assert.ok(count > 0);
    }
  }
});

test('every supported Prime fixed line preserves probability and the first atom', () => {
  for (const part of Object.keys(POOL_TOTALS)) for (const level of [200, 250]) {
    for (const fixed of primeAtomList(part, level)) {
      let mass = 0;
      enumerateRolls(part, level, 'legend', (p, a1) => { mass += p; assert.equal(a1, fixed); }, fixed);
      close(mass, 1);
    }
  }
});

test('all-stat contribution is optional and HP remains a separate family', () => {
  const atoms = buildTierAtoms('heart', 'legend', 200).atoms;
  const str = atoms.find(a => a.key === 'STR'), all = atoms.find(a => a.key === 'ALL'), hp = atoms.find(a => a.key === 'HP');
  assert.deepEqual(comboSums(str, all, hp, false).s, { STR: 12, DEX: 0, INT: 0, LUK: 0 });
  assert.deepEqual(comboSums(str, all, hp, true).s, { STR: 21, DEX: 9, INT: 9, LUK: 9 });
  assert.equal(comboSums(str, all, hp, true).hp, 12);
  assert.equal(comboSums(str, all, hp, true).allSum, 9);
});

test('same-family pricing chooses its interval; different families compete by highest price', () => {
  const targets = [stat('str12', 12, 100), stat('str21', 21, 10), stat('int12', 12, 20, 'INT'),
    { id: 'hp12', kind: 'hp', min: 12, price: 30 }];
  const { fams, rest } = familize(targets);
  const result = bestHit(fams, rest, { s: { STR: 24, DEX: 0, INT: 18, LUK: 0 }, hp: 12, allSum: 0 });
  assert.deepEqual(result.hits.map(t => t.id).sort(), ['hp12', 'int12', 'str21']);
  assert.equal(result.best.id, 'hp12');
});

test('auto hold preserves excluded upper price intervals instead of selling them at a lower threshold price', () => {
  const targetsL = [stat('low', 12, 1e10), stat('high', 21, 1)];
  const eng = buildEngine(config({ targetsL, floorPrice: 0, autoExclude: true }));
  assert.equal(eng.judgeL.low, true);
  assert.equal(eng.judgeL.high, false);
  close(eng.lSt.q, eng.lProb.low);
  close(eng.lSt.satisf.low, eng.lProb.low);
  const withoutBoundary = gradeStats('heart', 200, 'legend', [targetsL[0]], true, 1);
  close(withoutBoundary.q, eng.lProb.low + eng.lProb.high);
  assert.ok(eng.lSt.q < withoutBoundary.q);
  const unique = buildEngine(config({ targetsU: targetsL, autoExclude: true }));
  assert.equal(unique.judgeU.low, true);
  assert.equal(unique.judgeU.high, false);
  close(unique.uSt.q, unique.uProb.low);
});

test('sales pick one highest price and probability shares and displayed combos preserve mass', () => {
  const targets = STATS.map(s => stat(s, 12, 100, s));
  const combos = {}, result = gradeStats('hat', 250, 'legend', targets, true, .97, combos);
  close(Object.values(result.share).reduce((s, p) => s + p, 0), result.q);
  close(result.cum.at(-1).c, result.q);
  close(result.rev, 97);
  for (const t of targets) close(Object.values(combos[t.id]).reduce((s, p) => s + p, 0), result.satisf[t.id]);
});

test('Epic and Unique pity expectations match independent truncated-geometric formulas', () => {
  for (const miracle of [false, true]) {
    const cfg = config({ miracle }), eng = buildEngine(cfg);
    const epic = pityMean(GRADE_UP.epic * (miracle ? 2 : 1), PITY.epic + 1);
    close(eng.epicRolls, epic);
    for (const j of [0, 1, 50, PITY.unique]) {
      const unique = pityMean(GRADE_UP.unique * (miracle ? 2 : 1), PITY.unique - j + 1);
      const round = eng.round(j);
      close(round.resets, epic + unique);
      close(round.cost, epic * cfg.costs.epic + unique * cfg.costs.unique);
      close(round.rev, cfg.floorPrice * .97);
      close(round.profit, round.rev - round.cost - cfg.itemPrice);
      close(eng.roundDist(j).reduce((s, p) => s + p, 0), 1);
      close(eng.roundDist(j)[0], 1);
    }
  }
});

test('Legendary max STR probability and reroll wait match independent three-line geometry', () => {
  const cfg = config({ targetsL: [stat('str36', 36, 1000)], floorPrice: 0 });
  const eng = buildEngine(cfg);
  const q = (12 / POOL_TOTALS.heart.legend) ** 3 * ESCAPE.line2 * ESCAPE.line3;
  close(eng.lSt.q, q);
  assert.equal(eng.legMode, 'B');
  const beforeLegend = eng.epicRolls + pityMean(eng.pL, PITY.unique + 1);
  close(eng.round(0).resets, beforeLegend + (1 - q) / q);
  close(eng.round(0).rev, 970);
});

test('carry-forward Unique pity transition includes sale stacks and is stationary across rounds', () => {
  const cfg = config({ targetsU: [stat('u12', 12, 500)] }), eng = buildEngine(cfg);
  const q = eng.uSt.q, r = (1 - eng.pL) * (1 - q);
  assert.ok(q > 0 && q < 1);
  for (const j of [0, 1, 50, 107]) {
    const d = eng.roundDist(j);
    close(d.reduce((s, p) => s + p, 0), 1);
    if (j > 0) close(d[j], q);
    for (let k = j + 1; k <= PITY.unique; k++)
      close(d[k], (1 - q) * r ** (k - j - 1) * (1 - eng.pL) * q);
    if (j > 0) for (let k = 1; k < j; k++) close(d[k], 0);
  }
  // Independently solve stationary transitions with lazy iteration.
  let pi = Array(108).fill(0); pi[0] = 1;
  for (let i = 0; i < 1000; i++) {
    const next = Array(108).fill(0);
    for (let j = 0; j < 108; j++) if (pi[j]) eng.roundDist(j).forEach((p, k) => { next[k] += pi[j] * p; });
    pi = next.map((x, j) => (x + pi[j]) / 2);
  }
  for (const metric of ['rev', 'cost', 'resets', 'profit'])
    close(eng.steady[metric], pi.reduce((s, p, j) => s + p * eng.round(j)[metric], 0), 1e-8);
});

test('Prime optimal stopping satisfies revenue minus costs and its Bellman equations', () => {
  const fixed = primeAtomList('heart', 200).find(a => a.key === 'STR');
  const Cp = 10, g = 2, feeMul = .97;
  const solved = solvePrime('heart', 200, fixed, [stat('str21', 21, 150), stat('str30', 30, 500)], true, feeMul, 50, Cp, g, true);
  close(solved.states.reduce((s, st) => s + st.p, 0), 1);
  for (let k = 0; k < solved.states.length; k++) {
    close(solved.V[k], solved.R[k] - (Cp + g) * solved.N[k]);
    const keepValue = solved.states.reduce((s, st, m) => s + st.p * solved.V[Math.max(k, m)], 0) - Cp - g;
    close(solved.V[k], Math.max(solved.states[k].price * feeMul, keepValue));
    assert.ok(solved.N[k] >= 0);
  }
});

test('Prime does not treat targets below the floor as improvements under automatic selling', () => {
  const fixed = primeAtomList('heart', 200).find(a => a.key === 'STR');
  const solved = solvePrime('heart', 200, fixed, [stat('low', 12, 100), stat('high', 30, 1000)], true, 1, 200, 10, 0, true);
  assert.equal(solved.idx.low, 0);
  assert.deepEqual(solved.states.map(st => st.price), [200, 1000]);
  close(solved.states.reduce((s, st) => s + st.p, 0), 1);
});

test('rare Prime-entry alternatives use an exact continuation value instead of truncated value iteration', () => {
  const cfg = config({ targetsL: [stat('str36', 36, 1e12)], floorPrice: 0, autoExclude: true,
    prime: { on: true, cost: 1e15, fixedKey: 'STR' } });
  const eng = buildEngine(cfg);
  assert.equal(eng.legMode, 'P');
  close(eng.l1.q, eng.lSt.q);
  close(eng.l1.W, 1e12 * .97 - cfg.costs.legend / eng.lSt.q);
  close(eng.legPrimeRolls, 0);
});

test('geometric wait sampling honors exact boundaries and avoids a loop for rare probabilities', () => {
  assert.equal(sampleGeometric(1, () => 0), 1);
  assert.equal(sampleGeometric(.5, () => 0), 1);
  assert.equal(sampleGeometric(.5, () => .75), 3);
  assert.equal(sampleGeometric(.5, () => .9999, 4), 4);
  assert.equal(sampleGeometric(1e-12, () => .5), 693147180560);
  const a = mulberry32(123), b = mulberry32(123);
  for (let i = 0; i < 100; i++) { const x = a(); assert.equal(x, b()); assert.ok(x >= 0 && x < 1); }
});

test('simulation is deterministic, has ordered quantiles and agrees with analytic campaign and independent means', () => {
  const cfg = config({ targetsU: [stat('u12', 12, 500)] }), eng = buildEngine(cfg);
  for (const mode of ['independent', 'chain', 'campaign']) {
    const sampled = runMC(eng, cfg, 50, 20000, mode);
    assert.deepEqual(sampled, runMC(eng, cfg, 50, 20000, mode));
    assert.ok(sampled.p10 <= sampled.p50 && sampled.p50 <= sampled.p90);
    assert.equal(Object.values(sampled.tidCount).reduce((s, n) => s + n, 0), sampled.compRounds);
    const exact = mode === 'independent' ? eng.round(50) : mode === 'chain' ? eng.steady : campaignStats(eng, 50, cfg.itemPrice);
    close(sampled.avgResets, exact.resets, .035);
    close(sampled.avgProfit, exact.profit, .04);
    if (mode === 'campaign') close(sampled.avgRounds, exact.rounds, .035);
    else assert.equal(sampled.avgRounds, 1);
  }
});

test('Prime simulation charges the canonical prime.cost even without costs.prime', () => {
  const cfg = config({ targetsL: [stat('str36', 36, 1e6)], floorPrice: 0,
    prime: { on: true, cost: 10, fixedKey: 'STR' } });
  const eng = buildEngine(cfg), sampled = runMC(eng, cfg, 0, 20000, 'independent');
  assert.equal(eng.legMode, 'P');
  assert.ok(eng.legPrimeRolls > 0);
  assert.ok(Number.isFinite(sampled.avgProfit));
  close(sampled.avgResets, eng.round(0).resets, .04);
  close(sampled.avgProfit, eng.round(0).profit, .02);
  assert.deepEqual(sampled, runMC(eng, { ...cfg, costs: { ...cfg.costs, prime: 1e99 } }, 0, 20000, 'independent'));
});

test('campaign starts at zero and detects non-termination instead of returning fabricated finite values', () => {
  const cfg = config(), eng = buildEngine(cfg);
  const campaign = campaignStats(eng, 0, cfg.itemPrice);
  close(campaign.rounds, 1);
  close(campaign.profit, eng.round(0).profit);
  const saleCfg = config({ targetsU: [stat('u12', 12, 500)] }), saleEngine = buildEngine(saleCfg);
  const saleCampaign = campaignStats(saleEngine, 0, saleCfg.itemPrice);
  const sampled = runMC(saleEngine, saleCfg, 0, 20000, 'campaign');
  close(sampled.avgRounds, saleCampaign.rounds, .035);
  close(sampled.avgResets, saleCampaign.resets, .035);
  close(sampled.avgProfit, saleCampaign.profit, .04);
  const alwaysSell = buildEngine(config({ targetsU: [stat('always', 0, 100)] }));
  assert.equal(alwaysSell.uSt.q, 1);
  close(alwaysSell.round(107).resets, alwaysSell.epicRolls);
  close(alwaysSell.roundDist(107)[107], 1);
  assert.throws(() => campaignStats(alwaysSell, 1, 7), /종료되지/);
  assert.throws(() => runMC(alwaysSell, config(), 0, 10, 'campaign'), /종료되지/);
  assert.throws(() => runMC(eng, cfg, 0, 10, 'independent', { maxRounds: 5 }), /예산/);
});

test('invalid costs, fees, targets, Prime options and simulation inputs fail explicitly', () => {
  for (const bad of [
    { part: 'weapon' }, { level: 150 }, { fee: -1 }, { fee: 101 }, { itemPrice: -1 }, { floorPrice: Infinity },
    { costs: { epic: 2, unique: 3, legend: NaN } }, { targetsU: [stat('x', -1, 5)] },
    { targetsL: [stat('x', 12, 5), stat('x', 21, 10)] }, { targetsL: [stat('x', 12, NaN)] },
    { prime: { on: true, cost: -1, fixedKey: 'STR' } }, { prime: { on: true, cost: 10, fixedKey: 'CRIT' } },
  ]) assert.throws(() => solveEngine(config(bad)), RangeError);
  const cfg = config(), eng = buildEngine(cfg);
  for (const j of [-1, 108, .5, NaN]) {
    assert.throws(() => runMC(eng, cfg, j, 10), RangeError);
    assert.throws(() => campaignStats(eng, j, 7), RangeError);
    assert.throws(() => eng.round(j), RangeError);
    assert.throws(() => eng.roundDist(j), RangeError);
  }
  for (const samples of [0, -1, 1.5, 1_000_001]) assert.throws(() => runMC(eng, cfg, 0, samples), RangeError);
  assert.throws(() => runMC(eng, cfg, 0, 10, 'unknown'), RangeError);
  assert.throws(() => buildTierAtoms('heart', 'rare', 200), RangeError);
  assert.throws(() => enumerateRolls('heart', 200, 'epic', () => {}), RangeError);
});
