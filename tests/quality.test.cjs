'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { storage } = require('../src/services/storage');
const {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_KEY,
  loadSettings,
  mergeSettings,
  normalizeSettings,
  persistSettings
} = require('../src/services/settings-store');
const {
  userFacingVoiceError,
  userFacingVoiceErrorKey,
  voiceCallCopy
} = require('../src/utils/user-facing-error');
const {
  createHumeServerError,
  HumeConfigurationError,
  HUME_CONFIGURATION_USER_MESSAGE
} = require('../src/services/websocket/hume-errors');
const { OperationTimeoutError, withTimeout } = require('../src/utils/async');
const { chooseOfflineResponse } = require('../src/mocks/offlineResponses');
const { sanitizeLogPayload, sanitizeUrl } = require('../src/utils/logger');

test('voice, language, and companion visibility settings survive storage reloads', async () => {
  let stored = null;
  storage.setJSON = async (key, value) => {
    assert.equal(key, SETTINGS_KEY);
    stored = structuredClone(value);
  };
  storage.getJSON = async () => structuredClone(stored);

  await persistSettings(mergeSettings(DEFAULT_SETTINGS, {
    selectedVoiceId: 'bestie',
    language: 'es',
    showCompanion: false
  }));
  const reloaded = await loadSettings();
  assert.equal(reloaded.selectedVoiceId, 'bestie');
  assert.equal(reloaded.language, 'es');
  assert.equal(reloaded.showCompanion, false);
  assert.equal(reloaded.mode, DEFAULT_SETTINGS.mode);
  assert.equal(reloaded.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(stored.schemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(DEFAULT_SETTINGS.showCompanion, true);
});

test('legacy settings migrate to a strict versioned schema and discard unknown fields', () => {
  assert.deepEqual(normalizeSettings({
    mode: 'guardian',
    selectedVoiceId: 'bestie',
    language: 'fr',
    showCompanion: false,
    offlineMode: true,
    reminderEnabled: false,
    staleField: 'discard me'
  }), {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode: 'guardian',
    selectedVoiceId: 'bestie',
    language: 'fr',
    showCompanion: false,
    offlineMode: true,
    reminderEnabled: false
  });
});

test('legacy placeholder reminder state never migrates as notification consent', () => {
  assert.equal(normalizeSettings({
    schemaVersion: 1,
    reminderEnabled: true
  }).reminderEnabled, false);
  assert.equal(DEFAULT_SETTINGS.reminderEnabled, false);
});

test('invalid and future settings fail closed to supported defaults', () => {
  assert.deepEqual(normalizeSettings({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode: 'invalid-mode',
    selectedVoiceId: 'unknown-voice',
    language: 'not-a-locale',
    showCompanion: 'false',
    offlineMode: 1,
    reminderEnabled: null
  }), { ...DEFAULT_SETTINGS });

  assert.deepEqual(normalizeSettings({
    schemaVersion: SETTINGS_SCHEMA_VERSION + 1,
    mode: 'emergency',
    selectedVoiceId: 'boyfriend',
    language: 'es',
    showCompanion: false,
    offlineMode: true,
    reminderEnabled: false
  }), { ...DEFAULT_SETTINGS });
});

test('invalid setting patches preserve the last valid values', () => {
  const current = normalizeSettings({
    mode: 'emergency',
    selectedVoiceId: 'muscleMan',
    language: 'es',
    showCompanion: false,
    offlineMode: true,
    reminderEnabled: false
  });
  assert.deepEqual(mergeSettings(current, {
    mode: 'not-a-mode',
    selectedVoiceId: '',
    language: 'zh-Hant',
    showCompanion: 'yes',
    offlineMode: null,
    reminderEnabled: 0,
    unknown: true
  }), current);
});

test('settings hydration normalizes malformed persisted values', async () => {
  storage.getJSON = async () => ({
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode: 'guardian',
    selectedVoiceId: 'not-installed',
    language: 'de',
    showCompanion: false,
    offlineMode: 'false',
    reminderEnabled: true
  });

  assert.deepEqual(await loadSettings(), {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    mode: 'guardian',
    selectedVoiceId: DEFAULT_SETTINGS.selectedVoiceId,
    language: DEFAULT_SETTINGS.language,
    showCompanion: false,
    offlineMode: DEFAULT_SETTINGS.offlineMode,
    reminderEnabled: true
  });
});

test('companion preference hides only the Home shortcut, not emergency access', () => {
  const homeSource = fs.readFileSync(path.resolve('app/(tabs)/index.js'), 'utf8');
  const emergencySource = fs.readFileSync(path.resolve('app/emergency-sos.js'), 'utf8');

  assert.match(
    homeSource,
    /settings\.showCompanion\s*\?\s*\([\s\S]*?t\('home\.safetyCall'\)[\s\S]*?router\.push\('\/safety-call'\)/
  );
  assert.match(
    emergencySource,
    /t\('emergency\.callCompanion'\)[\s\S]*?router\.push\('\/safety-call'\)/
  );
});

test('store builds never present visual-development danger zones as live safety data', () => {
  const mapboxCore = fs.readFileSync(path.resolve('src/services/mapbox-core.js'), 'utf8');
  assert.match(mapboxCore, /DEVELOPMENT_RUNTIME \? SAMPLE_DANGER_ZONES : \[\]/);
  assert.doesNotMatch(mapboxCore, /export const dangerZones = \[/);
});

test('localized status UI preserves language casing and selected-locale dates', () => {
  const homeSource = fs.readFileSync(path.resolve('app/(tabs)/index.js'), 'utf8');
  const mapSource = fs.readFileSync(path.resolve('app/(tabs)/map.js'), 'utf8');
  const emergencySource = fs.readFileSync(path.resolve('app/emergency-sos.js'), 'utf8');

  assert.doesNotMatch(homeSource, /modeName\.toUpperCase\(\)/);
  assert.match(mapSource, /toLocaleString\(locale\)/);
  assert.match(emergencySource, /toLocaleString\(locale\)/);
});

test('voice errors are actionable without leaking raw service details', () => {
  assert.equal(userFacingVoiceErrorKey(new Error('microphone permission denied')), 'errors.microphone');
  assert.equal(userFacingVoiceErrorKey(new Error('chat_metadata timeout')), 'errors.timeout');
  assert.equal(userFacingVoiceError(new Error('Socket is not connected'), { isOnline: false }), voiceCallCopy.offline);
  assert.match(userFacingVoiceError(new Error('chat_metadata timeout')), /took too long/i);
  assert.doesNotMatch(userFacingVoiceError(new Error('401 api key secret-value')), /secret-value/);
  assert.match(userFacingVoiceError(new Error('microphone permission denied')), /Settings/);
  const missingConfiguration = new HumeConfigurationError('missing');
  assert.equal(missingConfiguration.code, 'VOICE_CONFIGURATION_MISSING');
  assert.equal(
    userFacingVoiceError(missingConfiguration),
    'The voice companion is unavailable right now. Try again later or continue with the offline companion.'
  );
  assert.equal(HUME_CONFIGURATION_USER_MESSAGE, 'Voice AI is not configured yet. Please contact support.');
  assert.doesNotMatch(missingConfiguration.message, /api key|access token|config[_ -]?id/i);

  const invalidConfiguration = createHumeServerError('Config resource secret-id failed.', 'E0703');
  assert.equal(invalidConfiguration.code, 'VOICE_CONFIGURATION_INVALID');
  assert.equal(userFacingVoiceErrorKey(invalidConfiguration), 'releaseCritical.voiceConfiguration');
  assert.doesNotMatch(userFacingVoiceError(invalidConfiguration), /secret-id/);
});

test('BLE and voice screens localize typed failures at the render boundary', () => {
  const jewelrySource = fs.readFileSync(path.resolve('app/(auth)/jewelry-setup.js'), 'utf8');
  const locationPermissionSource = fs.readFileSync(path.resolve('app/(auth)/location-permission.js'), 'utf8');
  const safetyCallSource = fs.readFileSync(path.resolve('app/safety-call.js'), 'utf8');
  const voiceHookSource = fs.readFileSync(path.resolve('src/hooks/useHumeVoiceCall.js'), 'utf8');

  assert.match(jewelrySource, /translationKey: bleErrorTranslationKey/);
  assert.match(jewelrySource, /error\?\.translationKey \? t\(error\.translationKey\)/);
  assert.doesNotMatch(jewelrySource, /scanError\?*\.message|connectionError\?*\.message/);
  assert.doesNotMatch(locationPermissionSource, /permissionError\?*\.message/);
  assert.match(safetyCallSource, /error\?\.translationKey \? t\(error\.translationKey\)/);
  assert.doesNotMatch(safetyCallSource, /message=\{error\?\.message\}/);
  assert.match(voiceHookSource, /userFacingVoiceErrorKey/);
});

test('offline companion returns actionable safety guidance for the safety-tips prompt', () => {
  const response = chooseOfflineResponse('Could you give me some safety tips?');
  assert.equal(response.id, 'safety-tips-1');
  assert.match(response.text, /well-lit public place/i);
  assert.match(response.text, /share your location/i);
});

test('diagnostic logging recursively redacts credential fields and bearer values', () => {
  const sanitized = sanitizeLogPayload({
    authorization: 'Bearer top-level-secret',
    connection: {
      api_key: 'nested-secret',
      detail: 'request failed with Bearer embedded-secret',
      query: 'wss://voice.example.test?access_token=query-secret&config_id=public-id'
    }
  });

  assert.equal(sanitized.authorization, '[REDACTED]');
  assert.equal(sanitized.connection.api_key, '[REDACTED]');
  assert.equal(sanitized.connection.detail, 'request failed with Bearer [REDACTED]');
  assert.equal(
    sanitizeUrl(sanitized.connection.query),
    'wss://voice.example.test?access_token=[REDACTED]&config_id=public-id'
  );
  assert.doesNotMatch(JSON.stringify(sanitized), /top-level-secret|nested-secret|embedded-secret|query-secret/);
});

test('async timeout guard rejects stalled operations with a typed error', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'Location timed out.'),
    (error) => error instanceof OperationTimeoutError && error.code === 'TIMEOUT'
  );
});
