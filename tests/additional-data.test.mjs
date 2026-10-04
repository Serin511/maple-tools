import test from 'node:test';
import assert from 'node:assert/strict';
import archived from '../data/additional-probabilities.json' with { type: 'json' };
import {
  ADDITIONAL_GRADES,
  ADDITIONAL_LEVELS,
  ADDITIONAL_SLOTS,
  ADDITIONAL_SOURCES,
  DEFAULT_ADDITIONAL_SCORE_SETTINGS,
  buildAdditionalDistribution,
  getAdditionalLines,
  scoreAdditionalOption,
  scoreAdditionalOptions,
  validateAdditionalDataSettings,
  validateAdditionalScoreSettings,
} from '../additional-data.mjs';

const selection = { method: 'reset', grade: '에픽', slot: '모자', level: 200 };
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('compact archive preserves sources, exact percentages and unavailable records', () => {
  assert.equal(archived.options.length, 225);
  assert.equal(archived.lines.length, 48);
  assert.equal(archived.tables.length, 26);
  assert.equal(ADDITIONAL_SOURCES.length, 2);
  for (const source of ADDITIONAL_SOURCES) {
    assert.equal(source.collectedAt, '2026-10-05');
    assert.match(source.url, /^https:\/\/maplestory\.nexon\.com\//);
    assert.match(source.originalSha256, /^[a-f0-9]{64}$/);
  }
  for (const source of Object.values(archived.sources)) {
    for (const slots of Object.values(source.grades)) {
      for (const levels of Object.values(slots)) {
        assert.equal(levels['140레벨'], levels['160레벨']);
        assert.equal(levels['160레벨'], levels['200레벨']);
      }
    }
  }
  assert.equal(archived.sources.reset.grades['에픽']['엠블렘']['250레벨'], null);
  assert.equal(archived.sources.strange.grades['에픽']['한벌옷']['250레벨'], null);
});

test('armor and accessory selection preserves published nulls and level bands', () => {
  assert.equal(ADDITIONAL_SLOTS.length, 15);
  for (const slot of ['무기', '엠블렘', '방패', '포스실드, 소울링']) {
    assert.equal(getAdditionalLines({ ...selection, slot }), null);
  }
  for (const slot of ['한벌옷', '벨트', '귀고리', '기계심장']) {
    assert.ok(getAdditionalLines({ ...selection, slot }));
    assert.equal(getAdditionalLines({ ...selection, slot, level: 250 }), null);
  }
  assert.deepEqual(getAdditionalLines({ ...selection, level: 120 }), getAdditionalLines(selection));
  assert.deepEqual(getAdditionalLines({ ...selection, level: 199 }), getAdditionalLines(selection));
  assert.deepEqual(getAdditionalLines({ ...selection, level: 201 }), getAdditionalLines({ ...selection, level: 250 }));
  assert.notDeepEqual(getAdditionalLines(selection), getAdditionalLines({ ...selection, level: 201 }));
  for (const level of [119, 251, 199.5, '200', NaN]) assert.equal(getAdditionalLines({ ...selection, level }), null);
  assert.equal(getAdditionalLines({ ...selection, method: 'strange', grade: '유니크' }), null);
});

test('every available line normalizes published rounding while preserving raw percentages', () => {
  let checked = 0;
  for (const method of ['reset', 'strange']) {
    for (const grade of ADDITIONAL_GRADES) {
      for (const slot of ADDITIONAL_SLOTS) {
        for (const level of ADDITIONAL_LEVELS) {
          const lines = getAdditionalLines({ method, grade, slot, level });
          if (!lines) continue;
          assert.equal(lines.length, 3);
          for (const line of lines) {
            close(line.reduce((sum, row) => sum + row.probability, 0), 1);
            const sumPublished = line.reduce((sum, row) => sum + row.publishedPercent, 0);
            assert.ok(Math.abs(sumPublished - 100) < 0.002);
            for (const row of line) {
              assert.ok(row.probability > 0);
              assert.equal(row.probability, row.publishedPercent / sumPublished);
            }
          }
          checked++;
        }
      }
    }
  }
  assert.equal(checked, 224);
});

test('stat conversions use a single chosen substat, attack type and user efficiencies', () => {
  for (const [label, value] of [
    ['STR +12', 1.2], ['DEX +12', .12], ['INT +12', 0], ['STR +6%', 6],
    ['DEX +6%', .6], ['INT +6%', 0], ['올스탯 +3%', 3.3], ['올스탯 +5', .55],
    ['공격력 +12', 3.6], ['마력 +12', 0], ['공격력 +12%', 0], ['최대 HP +360', 0],
    ['크리티컬 데미지 +3%', 0], ['아이템 드롭률 +5%', 0], ['없음', 0],
  ]) close(scoreAdditionalOption(label), value);
  const intSettings = { mainStat: 'INT', subStat: 'LUK', attackType: 'magic', efficiency: { mainFlat: .2, subFlat: .03, attackFlat: .5 } };
  close(scoreAdditionalOption('INT +15', intSettings), 3);
  close(scoreAdditionalOption('LUK +15', intSettings), .45);
  close(scoreAdditionalOption('마력 +10', intSettings), 5);
  close(scoreAdditionalOption('공격력 +10', intSettings), 0);
  close(scoreAdditionalOption('올스탯 +5', intSettings), 1.15);
});

test('per-nine-level main and substats floor complete level groups', () => {
  close(scoreAdditionalOption('캐릭터 기준 9레벨 당 STR +1'), 3.2);
  close(scoreAdditionalOption('캐릭터 기준 9레벨 당 STR +2'), 6.4);
  close(scoreAdditionalOption('캐릭터 기준 9레벨 당 DEX +2'), .64);
  close(scoreAdditionalOption('캐릭터 기준 9레벨 당 INT +2'), 0);
  close(scoreAdditionalOption('캐릭터 기준 9레벨 당 STR +2', { characterLevel: 287 }), 6.2);
  close(scoreAdditionalOption('캐릭터 기준 9레벨 당 STR +2', { characterLevel: 288 }), 6.4);
});

test('special options receive value only from explicit coefficients or overrides', () => {
  const settings = { efficiency: { criticalDamagePercent: 4, itemDropPercent: .2, cooldownSecond: 5, attackPercent: 2, damagePercent: .3, ignoreDefensePercent: .4 } };
  close(scoreAdditionalOption('크리티컬 데미지 +3%', settings), 12);
  close(scoreAdditionalOption('아이템 드롭률 +5%', settings), 1);
  close(scoreAdditionalOption('스킬 재사용 대기시간 -1초', settings), 5);
  close(scoreAdditionalOption('공격력 +9%', settings), 18);
  close(scoreAdditionalOption('데미지 +10%', settings), 3);
  close(scoreAdditionalOption('몬스터 방어율 무시 +5%', settings), 2);
  close(scoreAdditionalOption('HP 회복 아이템 및 회복 스킬 효율 +30%', { customOptionScores: { 'HP 회복 아이템 및 회복 스킬 효율 +30%': 2.5 } }), 2.5);
  close(scoreAdditionalOption('STR +12', { customOptionScores: { 'STR +12': 0 } }), 0);
});

test('three-line distribution retains zero outcomes and matches marginal analytic means', () => {
  for (const method of ['reset', 'strange']) {
    for (const grade of method === 'strange' ? ['에픽'] : ADDITIONAL_GRADES) {
      const settings = { ...selection, method, grade, ...DEFAULT_ADDITIONAL_SCORE_SETTINGS };
      const lines = getAdditionalLines(settings);
      const distribution = buildAdditionalDistribution(settings);
      close(distribution.reduce((sum, row) => sum + row.probability, 0), 1);
      const mean = lines.reduce((total, line) => total + line.reduce((sum, row) => sum + row.probability * scoreAdditionalOption(row.label, settings), 0), 0);
      close(distribution.reduce((sum, row) => sum + row.score * row.probability, 0), mean);
      const zeroChance = lines.reduce((chance, line) => chance * line.reduce((sum, row) => sum + (scoreAdditionalOption(row.label, settings) === 0 ? row.probability : 0), 0), 1);
      close(distribution.find(row => row.score === 0).probability, zeroChance);
      for (const [index, row] of distribution.entries()) {
        assert.ok(row.probability > 0);
        if (index) assert.ok(row.score > distribution[index - 1].score);
        assert.equal(row.options.length, 3);
        close(scoreAdditionalOptions(row.options, settings), row.score, 1e-8);
        row.options.forEach((label, i) => assert.ok(lines[i].some(option => option.label === label)));
      }
    }
  }
});

test('strange and paid cubes retain different second/third line probabilities', () => {
  const reset = getAdditionalLines(selection);
  const strange = getAdditionalLines({ ...selection, method: 'strange' });
  assert.deepEqual(reset[0], strange[0]);
  assert.notDeepEqual(reset[1], strange[1]);
  assert.deepEqual(reset[1], reset[2]);
  assert.deepEqual(strange[1], strange[2]);
  const mean = method => buildAdditionalDistribution({ ...selection, method }).reduce((sum, row) => sum + row.score * row.probability, 0);
  assert.ok(mean('reset') > mean('strange'));
});

test('invalid selectors and efficiencies fail visibly instead of guessing', () => {
  assert.doesNotThrow(() => validateAdditionalDataSettings({ slot: '장갑', level: 160 }));
  assert.throws(() => validateAdditionalDataSettings({ slot: '한벌옷', level: 250 }), /확률표/);
  assert.throws(() => buildAdditionalDistribution({ ...selection, grade: '레어' }), /확률표/);
  assert.throws(() => validateAdditionalScoreSettings({ mainStat: 'STR', subStat: 'STR' }), /서로 다르게/);
  assert.throws(() => validateAdditionalScoreSettings({ characterLevel: 301 }), /레벨/);
  assert.throws(() => scoreAdditionalOption('STR +12', { efficiency: { mainFlat: -1 } }), /효율/);
  assert.throws(() => scoreAdditionalOption('STR +12', { efficiency: { mainFlat: Infinity } }), /효율/);
  assert.throws(() => scoreAdditionalOption('STR +12', { efficiency: { typo: .1 } }), /효율/);
});
