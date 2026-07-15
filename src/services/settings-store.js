import { storage } from './storage';
import { supportedLanguages, SYSTEM_LANGUAGE } from '../i18n/core';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const SETTINGS_KEY = 'veryloving.settings';
export const SETTINGS_SCHEMA_VERSION = 2;
export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  mode: 'home',
  selectedVoiceId: 'capybara',
  language: SYSTEM_LANGUAGE,
  showCompanion: true,
  offlineMode: false,
  reminderEnabled: false
});

const VALID_MODES = new Set(['home', 'guardian', 'emergency']);
const VALID_VOICE_IDS = new Set(['capybara', 'bestie', 'boyfriend', 'muscleMan']);
const VALID_LANGUAGES = new Set([SYSTEM_LANGUAGE, ...supportedLanguages]);

let settingsWriteQueue = Promise.resolve();

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validString(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function validBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeFields(value, fallback) {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode: validString(value?.mode, VALID_MODES, fallback.mode),
    selectedVoiceId: validString(value?.selectedVoiceId, VALID_VOICE_IDS, fallback.selectedVoiceId),
    language: validString(value?.language, VALID_LANGUAGES, fallback.language),
    showCompanion: validBoolean(value?.showCompanion, fallback.showCompanion),
    offlineMode: validBoolean(value?.offlineMode, fallback.offlineMode),
    reminderEnabled: validBoolean(value?.reminderEnabled, fallback.reminderEnabled)
  };
}

export function normalizeSettings(value) {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  const declaredVersion = value.schemaVersion;
  const legacy = declaredVersion === undefined || declaredVersion === 0 || declaredVersion === 1;
  const legacyOrCurrent = legacy || declaredVersion === SETTINGS_SCHEMA_VERSION;
  if (!legacyOrCurrent) return { ...DEFAULT_SETTINGS };
  if (legacy) {
    // Earlier builds persisted `true` even though no notification was
    // scheduled. Do not convert that placeholder value into notification
    // consent during migration.
    return normalizeFields({ ...value, reminderEnabled: false }, DEFAULT_SETTINGS);
  }
  return normalizeFields(value, DEFAULT_SETTINGS);
}

export function mergeSettings(current, patch) {
  const normalizedCurrent = normalizeSettings(current);
  if (!isRecord(patch)) return normalizedCurrent;
  return normalizeFields(patch, normalizedCurrent);
}

export async function loadSettings() {
  return normalizeSettings(await storage.getJSON(SETTINGS_KEY, DEFAULT_SETTINGS));
}

export function persistSettings(settings) {
  const snapshot = normalizeSettings(settings);
  const operation = settingsWriteQueue
    .catch(() => {})
    .then(() => runLocalUserDataMutation(() => storage.setJSON(SETTINGS_KEY, snapshot)))
    .then(() => snapshot);
  settingsWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function drainSettingsMutations() {
  await settingsWriteQueue.catch(() => {});
}
