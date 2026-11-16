/**
 * Bonus-stat transfer scroll decisions for the flame efficiency calculator.
 *
 * Scenarios:
 *   - The value-based verdict compares v * (max(s, t) - max(x, t)) with the
 *     ticket price plus the source item price, where t is the stopping threshold.
 *   - Sources below the stopping threshold add no value; worse sources lose value.
 *   - Zero willingness never justifies a paid transfer.
 *   - Reference reroll cost to reach the source score, including unreachable scores.
 *   - Calculator integration, Korean validation messages and persisted settings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FLAME_SETTINGS, DEFAULT_XENON_FLAME_SETTINGS } from '../flame-data.mjs';
import { evaluateFlameTransfer, scoreFlameStats } from '../flame-engine.mjs';
import { calculateFlameStrategy } from '../flame-calculator.mjs';
import { normalizeFlameSettingsState } from '../flame-settings.mjs';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
  `${actual} != ${expected}`,
);

// Two equally likely outcomes; reset cost 1 and v = 1 give E[(X - t)+] = 1 at t = 8.
const twoPoint = [{ score: 0, p: 0.5 }, { score: 10, p: 0.5 }];
const base = { resetCost: 1, mesoPerPercent: 1, currentScore: 0, ticketPrice: 0.3, sourcePrice: 0.5 };

test('transfer is worth it when the reservation value gain exceeds ticket plus item price', () => {
  const result = evaluateFlameTransfer(twoPoint, { ...base, sourceScore: 9 });
  close(result.threshold, 8);
  close(result.valueGain, 1);
  close(result.transferCost, 0.8);
  close(result.netBenefit, 0.2);
  assert.equal(result.shouldTransfer, true);
  close(result.breakEvenSourcePrice, 0.7);
  assert.equal(result.sourceReachable, true);
  close(result.rerollAttemptsToMatch, 2);
  close(result.rerollCostToMatch, 2);
  assert.equal(result.resetAfterTransfer, false);
  assert.equal(result.resetWithoutTransfer, true);
});

test('a source below the stopping threshold adds no value, so any positive cost rejects it', () => {
  const result = evaluateFlameTransfer(twoPoint, { ...base, sourceScore: 5, ticketPrice: 0.01, sourcePrice: 0 });
  close(result.valueGain, 0);
  close(result.netBenefit, -0.01);
  assert.equal(result.shouldTransfer, false);
  assert.equal(result.resetAfterTransfer, true);
  close(result.breakEvenSourcePrice, -0.01);
});

test('a source no better than the current flame never transfers and needs no rerolls to match', () => {
  const result = evaluateFlameTransfer(twoPoint, { ...base, currentScore: 9.5, sourceScore: 9, ticketPrice: 0, sourcePrice: 0 });
  close(result.valueGain, -0.5);
  assert.equal(result.shouldTransfer, false);
  assert.equal(result.rerollAttemptsToMatch, 0);
  assert.equal(result.rerollCostToMatch, 0);
});

test('zero willingness has no threshold and no transfer value', () => {
  const result = evaluateFlameTransfer(twoPoint, { ...base, mesoPerPercent: 0, sourceScore: 10, ticketPrice: 0, sourcePrice: 0 });
  assert.equal(result.threshold, null);
  assert.equal(result.valueGain, 0);
  assert.equal(result.shouldTransfer, false);
});

test('a source score above every reroll outcome is unreachable by rerolling', () => {
  const result = evaluateFlameTransfer(twoPoint, { ...base, sourceScore: 20 });
  close(result.valueGain, 12);
  assert.equal(result.shouldTransfer, true);
  assert.equal(result.sourceReachable, false);
  assert.equal(result.rerollAttemptsToMatch, Infinity);
  assert.equal(result.rerollCostToMatch, Infinity);
});

test('invalid transfer inputs fail before calculating', () => {
  for (const patch of [{ ticketPrice: -1 }, { sourcePrice: NaN }, { sourceScore: Infinity }]) {
    assert.throws(() => evaluateFlameTransfer(twoPoint, { ...base, sourceScore: 9, ...patch }), RangeError);
  }
});

const withTransfer = (settings, transfer) => ({ ...settings, transfer: { ...settings.transfer, enabled: true, ...transfer } });

test('calculator reports the transfer verdict from the real distribution only when enabled', () => {
  assert.equal(calculateFlameStrategy(DEFAULT_FLAME_SETTINGS).transfer, null);
  const source = { main: 150, sub: 0, attack: 3, all: 6 };
  const settings = withTransfer(DEFAULT_FLAME_SETTINGS, { ticketPrice: 5e7, sourcePrice: 3e8, source });
  const result = calculateFlameStrategy(settings);
  const { transfer } = result;
  close(transfer.sourceScore, scoreFlameStats(source, settings.efficiencies));
  close(transfer.threshold, result.threshold);
  close(transfer.transferCost, 3.5e8);
  close(transfer.netBenefit, transfer.valueGain - transfer.transferCost);
  close(transfer.valueGain, settings.mesoPerPercent * (Math.max(transfer.sourceScore, result.threshold) - Math.max(result.currentScore, result.threshold)));
  assert.equal(transfer.shouldTransfer, transfer.netBenefit > 0);
  assert.ok(transfer.sourceReachable);
  assert.ok(transfer.rerollCostToMatch > 0);
});

test('Xenon transfer uses the Xenon score of the source flame', () => {
  const source = { STR: 60, DEX: 90, LUK: 60, attack: 6, all: 7 };
  const settings = withTransfer(DEFAULT_XENON_FLAME_SETTINGS, { ticketPrice: 0, sourcePrice: 0, source });
  const { transfer } = calculateFlameStrategy(settings);
  close(transfer.sourceScore, scoreFlameStats(source, settings.efficiencies, 'xenon'));
  assert.equal(transfer.shouldTransfer, true);
});

test('enabled transfer validation names the bad field in Korean', () => {
  const settings = withTransfer(DEFAULT_FLAME_SETTINGS, { ticketPrice: 1e8, sourcePrice: 1e8, source: { main: 150, sub: 0, attack: 0, all: 6 } });
  assert.throws(() => calculateFlameStrategy({ ...settings, transfer: { ...settings.transfer, ticketPrice: '' } }), /전승권 가격/);
  assert.throws(() => calculateFlameStrategy({ ...settings, transfer: { ...settings.transfer, sourcePrice: -1 } }), /추옵템 가격/);
  assert.throws(() => calculateFlameStrategy({ ...settings, transfer: { ...settings.transfer, source: { ...settings.transfer.source, main: -5 } } }), /전승할 추가옵션 주스탯/);
  // A disabled transfer keeps blank drafts without blocking the main calculation.
  assert.doesNotThrow(() => calculateFlameStrategy({ ...settings, transfer: { ...settings.transfer, enabled: false, ticketPrice: '' } }));
});

test('saved profiles gain disabled transfer defaults and keep blank transfer drafts', () => {
  const legacyProfile = { ...DEFAULT_FLAME_SETTINGS };
  delete legacyProfile.transfer;
  const migrated = normalizeFlameSettingsState({ mode: 'normal', profiles: { normal: legacyProfile } }, null);
  assert.deepEqual(migrated.profiles.normal.transfer, DEFAULT_FLAME_SETTINGS.transfer);
  assert.equal(migrated.profiles.normal.transfer.enabled, false);
  assert.deepEqual(Object.keys(migrated.profiles.xenon.transfer.source), ['STR', 'DEX', 'LUK', 'attack', 'all']);

  const draft = withTransfer(DEFAULT_FLAME_SETTINGS, { ticketPrice: '', sourcePrice: 2e8, source: { main: '', sub: 0, attack: 0, all: 6 } });
  const restored = normalizeFlameSettingsState({ mode: 'normal', profiles: { normal: draft } }, null);
  assert.equal(restored.profiles.normal.transfer.enabled, true);
  assert.equal(restored.profiles.normal.transfer.ticketPrice, '');
  assert.equal(restored.profiles.normal.transfer.source.main, '');
  assert.equal(restored.profiles.normal.transfer.sourcePrice, 2e8);

  const corrupt = normalizeFlameSettingsState({ mode: 'normal', profiles: { normal: withTransfer(DEFAULT_FLAME_SETTINGS, { ticketPrice: -3 }) } }, null);
  assert.deepEqual(corrupt.profiles.normal.transfer, DEFAULT_FLAME_SETTINGS.transfer);
});
