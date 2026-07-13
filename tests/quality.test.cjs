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
const { chooseOfflineResponse } = require('../src/mocks/offlineResponses');
const { sanitizeLogPayload, sanitizeUrl } = require('../src/utils/logger');

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
