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
});

test('async timeout guard rejects stalled operations with a typed error', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'Location timed out.'),
    (error) => error instanceof OperationTimeoutError && error.code === 'TIMEOUT'
  );
});
