import {
  DEFAULT_FLAME_SETTINGS,
  DEFAULT_XENON_FLAME_SETTINGS,
  validateFlameSettings,
  validateFlameTransfer,
} from './flame-data.mjs';

export const FLAME_SETTINGS_KEY = 'maple:flame:settings:v2';
export const LEGACY_FLAME_SETTINGS_KEY = 'maple:flame:settings:v1';

const clone = value => structuredClone(value);

export function createFlameSettingsState() {
  return {
    mode: 'normal',
    profiles: {
      normal: clone(DEFAULT_FLAME_SETTINGS),
      xenon: clone(DEFAULT_XENON_FLAME_SETTINGS),
    },
  };
}

const blankAsZero = value => value === '' ? 0 : value;

/**
 * Merge a saved transfer draft over defaults, keeping only the mode's stat keys.
 * Blank fields stay as drafts; any other invalid value resets the transfer only.
 */
function mergeTransfer(defaults, candidate, mode) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return clone(defaults);
  const transfer = {
    enabled: candidate.enabled === true,
    ticketPrice: candidate.ticketPrice ?? defaults.ticketPrice,
    sourcePrice: candidate.sourcePrice ?? defaults.sourcePrice,
    source: Object.fromEntries(Object.entries(defaults.source)
      .map(([key, fallback]) => [key, candidate.source?.[key] ?? fallback])),
  };
  try {
    validateFlameTransfer({
      ticketPrice: blankAsZero(transfer.ticketPrice),
      sourcePrice: blankAsZero(transfer.sourcePrice),
      source: Object.fromEntries(Object.entries(transfer.source).map(([key, value]) => [key, blankAsZero(value)])),
    }, mode);
    return transfer;
  } catch {
    return clone(defaults);
  }
}

function validateProfile(candidate, defaults, mode) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  if (candidate.mode !== undefined && candidate.mode !== mode) return null;
  const profile = {
    ...clone(defaults),
    ...candidate,
    mode,
    current: { ...clone(defaults.current), ...(candidate.current ?? {}) },
    efficiencies: { ...clone(defaults.efficiencies), ...(candidate.efficiencies ?? {}) },
    transfer: mergeTransfer(defaults.transfer, candidate.transfer, mode),
  };
  // Empty strings are intentional drafts: validate against safe surrogates
  // while retaining the blank values for the UI and storage.
  const checked = clone(profile);
  if (checked.itemLevel === '') checked.itemLevel = defaults.itemLevel;
  for (const group of ['current', 'efficiencies']) {
    for (const [key, value] of Object.entries(checked[group])) {
      if (value === '') checked[group][key] = 0;
    }
  }
  if (checked.mesoPerPercent === '') checked.mesoPerPercent = 0;
  try {
    validateFlameSettings(checked);
    return profile;
  } catch {
    return null;
  }
}

/** Merge persisted profiles independently, so one corrupt mode cannot erase the other. */
export function normalizeFlameSettingsState(savedV2, legacyV1) {
  const state = createFlameSettingsState();
  if (savedV2 && typeof savedV2 === 'object' && !Array.isArray(savedV2)) {
    const profiles = savedV2.profiles;
    for (const mode of ['normal', 'xenon']) {
      const normalized = validateProfile(profiles?.[mode], state.profiles[mode], mode);
      if (normalized) state.profiles[mode] = normalized;
    }
    if (savedV2.mode === 'normal' || savedV2.mode === 'xenon') state.mode = savedV2.mode;
  }

  // A valid v1 record seeds normal only when v2 did not provide a valid one.
  const v2Normal = validateProfile(savedV2?.profiles?.normal, DEFAULT_FLAME_SETTINGS, 'normal');
  if (!v2Normal) {
    const legacy = legacyV1?.settings && typeof legacyV1.settings === 'object'
      ? legacyV1.settings
      : legacyV1;
    const normalized = validateProfile(legacy, DEFAULT_FLAME_SETTINGS, 'normal');
    if (normalized) state.profiles.normal = normalized;
  }
  return state;
}
