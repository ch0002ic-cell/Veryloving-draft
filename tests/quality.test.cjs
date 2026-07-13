'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { storage } = require('../src/services/storage');
const {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  mergeSettings,
  persistSettings
} = require('../src/services/settings-store');
const { userFacingVoiceError, voiceCallCopy } = require('../src/utils/user-facing-error');
const {
  createHumeServerError,
  HumeConfigurationError,
  HUME_CONFIGURATION_USER_MESSAGE
} = require('../src/services/websocket/hume-errors');
const { OperationTimeoutError, withTimeout } = require('../src/utils/async');

test('voice and language settings survive storage reloads', async () => {
  let stored = null;
  storage.setJSON = async (key, value) => {
    assert.equal(key, SETTINGS_KEY);
    stored = structuredClone(value);
  };
  storage.getJSON = async () => structuredClone(stored);

  await persistSettings(mergeSettings(DEFAULT_SETTINGS, { selectedVoiceId: 'bestie', language: 'es' }));
  const reloaded = await loadSettings();
  assert.equal(reloaded.selectedVoiceId, 'bestie');
  assert.equal(reloaded.language, 'es');
  assert.equal(reloaded.mode, DEFAULT_SETTINGS.mode);
});

test('voice errors are actionable without leaking raw service details', () => {
  assert.equal(userFacingVoiceError(new Error('Socket is not connected'), { isOnline: false }), voiceCallCopy.offline);
  assert.match(userFacingVoiceError(new Error('chat_metadata timeout')), /took too long/i);
  assert.doesNotMatch(userFacingVoiceError(new Error('401 api key secret-value')), /secret-value/);
  assert.match(userFacingVoiceError(new Error('microphone permission denied')), /Settings/);
  const missingConfiguration = new HumeConfigurationError('missing');
  assert.equal(missingConfiguration.code, 'VOICE_CONFIGURATION_MISSING');
  assert.equal(userFacingVoiceError(missingConfiguration), HUME_CONFIGURATION_USER_MESSAGE);
  assert.equal(HUME_CONFIGURATION_USER_MESSAGE, 'Voice AI is not configured yet. Please contact support.');
  assert.doesNotMatch(missingConfiguration.message, /api key|access token|config[_ -]?id/i);

  const invalidConfiguration = createHumeServerError('Config resource secret-id failed.', 'E0703');
  assert.equal(invalidConfiguration.code, 'VOICE_CONFIGURATION_INVALID');
  assert.doesNotMatch(userFacingVoiceError(invalidConfiguration), /secret-id/);
});

test('async timeout guard rejects stalled operations with a typed error', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'Location timed out.'),
    (error) => error instanceof OperationTimeoutError && error.code === 'TIMEOUT'
  );
});
