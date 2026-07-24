'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  localSafetyToolResult,
  parseSafetyToolParameters
} = require('../src/services/hume-tool-utils');
const { createOpaqueSessionId } = require('../src/utils/session-id');
const {
  buildHumeWebSocketURL,
  classifyHumeClose,
  createDeviceUpdatePayload,
  createProxyAuthenticationPayload,
  createSessionSettingsPayload,
  createToolErrorPayload,
  createToolResponsePayload,
  normalizeHumeConfigId,
  normalizePersonaId,
  normalizeVoiceLocale,
  reconnectDelay
} = require('../src/services/websocket/hume-protocol');
const { humeVoiceOverride, validHumeVoiceId } = require('../src/utils/hume-voice');

test('tool parameters accept only supported scenarios', () => {
  assert.deepEqual(parseSafetyToolParameters('{"scenario":"rideshare"}'), { scenario: 'rideshare' });
  assert.deepEqual(parseSafetyToolParameters('{"scenario":"invented"}'), { scenario: 'general' });
  assert.throws(() => parseSafetyToolParameters('{bad json'), /invalid/i);
});

test('offline tool fallback is useful and does not claim an action occurred', () => {
  const result = localSafetyToolResult('being_followed');
  assert.equal(result.source, 'offline_curated');
  assert.equal(result.tips.length, 3);
  assert.doesNotMatch(result.tips.join(' '), /sent|notified|called/i);
});

test('custom session IDs are opaque and deterministic under injected sources', () => {
  const sessionId = createOpaqueSessionId(() => 123456, () => 0.5);
  assert.match(sessionId, /^call-123456-[a-z0-9]+$/);
  assert.doesNotMatch(sessionId, /user|email|phone/i);
});

test('Hume protocol uses official session and resume field names', () => {
  const url = buildHumeWebSocketURL({
    apiKey: 'development-key',
    configId: 'config-id',
    voiceId: 'voice-id',
    resumedChatGroupId: 'chat-group-id'
  });
  assert.match(url, /^wss:\/\/api\.hume\.ai\/v0\/evi\/chat\?/);
  assert.match(url, /api_key=development-key/);
  assert.match(url, /config_id=config-id/);
  assert.match(url, /resumed_chat_group_id=chat-group-id/);
  const settings = createSessionSettingsPayload({
    customSessionId: 'opaque-session',
    systemPrompt: 'Be helpful.',
    locale: 'ES',
    personaId: 'bestie'
  });
  assert.equal(settings.type, 'session_settings');
  assert.equal(settings.custom_session_id, 'opaque-session');
  assert.deepEqual(settings.audio, { format: 'linear16', sample_rate: 48000, channels: 1 });
  assert.equal(settings.audio.encoding, undefined);
  assert.equal(settings.language_model_api_key, undefined);
  assert.deepEqual(settings.variables, {
    veryloving_locale: 'es',
    veryloving_persona: 'bestie'
  });
  assert.equal(normalizeVoiceLocale('zh_CN'), 'zh-cn');
  assert.equal(normalizeVoiceLocale('fr'), 'fr');
  assert.equal(normalizePersonaId('muscleMan'), 'muscleMan');
  assert.equal(normalizePersonaId('../persona'), undefined);
});

test('Hume protocol omits blank config IDs and preserves configured IDs', () => {
  for (const connection of [
    { apiKey: 'development-key' },
    { apiKey: 'development-key' }
  ]) {
    const defaultURL = new URL(buildHumeWebSocketURL({ ...connection, configId: '   ' }));
    assert.equal(defaultURL.searchParams.has('config_id'), false);

    const configuredURL = new URL(buildHumeWebSocketURL({
      ...connection,
      configId: '  configured-id  '
    }));
    assert.equal(
      configuredURL.searchParams.get('config_id'),
      'configured-id'
    );
  }
  assert.equal(normalizeHumeConfigId(''), undefined);
  assert.equal(normalizeHumeConfigId(null), undefined);
});

test('proxy WebSocket URL never contains the app session token', () => {
  const proxyURL = buildHumeWebSocketURL({
    proxyURL: 'wss://voice.veryloving.test/api/voice/hume-ws',
    appAccessToken: 'must-not-appear-in-url',
    configId: 'config-id'
  });
  assert.equal(proxyURL, 'wss://voice.veryloving.test/api/voice/hume-ws');
  assert.doesNotMatch(proxyURL, /token|must-not-appear/);
  assert.deepEqual(createProxyAuthenticationPayload({
    accessToken: 'first-party-session',
    configId: 'config-id',
    locale: 'fr',
    personaId: 'capybara'
  }), {
    type: 'authenticate',
    access_token: 'first-party-session',
    connection: {
      config_id: 'config-id',
      voice_id: undefined,
      persona_id: 'capybara',
      locale: 'fr',
      resumed_chat_group_id: undefined
    }
  });
  assert.deepEqual(createProxyAuthenticationPayload({
    accessToken: 'session',
    devices: [
      { deviceId: 'w1', deviceType: 'wearable', online: true },
      { deviceId: 'r1', deviceType: 'home_robot', online: false }
    ]
  }).connection.devices, [
    { device_id: 'w1', device_type: 'wearable', online: true },
    { device_id: 'r1', device_type: 'home_robot', online: false }
  ]);
});

test('proxy presence updates sanitize and bound dual-device snapshots', () => {
  const payload = createDeviceUpdatePayload([
    { deviceId: 'wearable-1', deviceType: 'wearable', online: true },
    { deviceId: 'robot-1', deviceType: 'home_robot', online: false },
    { deviceId: 'ignored', deviceType: 'unknown', online: true }
  ]);
  assert.deepEqual(payload, {
    type: 'devices_update',
    devices: [
      { device_id: 'wearable-1', device_type: 'wearable', online: true },
      { device_id: 'robot-1', device_type: 'home_robot', online: false }
    ]
  });
});

test('voice overrides accept only Hume UUIDs and otherwise use the configured voice', () => {
  const selectedId = '12c45d67-89ab-4cde-8f01-23456789abcd';
  const brandedId = '98765432-10ab-4cde-8f01-23456789abcd';

  assert.equal(validHumeVoiceId('capybear'), false);
  assert.equal(humeVoiceOverride({ selectedVoiceId: 'capybear' }), undefined);
  assert.equal(humeVoiceOverride({ selectedVoiceId: selectedId }), selectedId);
  assert.equal(humeVoiceOverride({ brandedVoiceId: brandedId, selectedVoiceId: selectedId }), brandedId);
  assert.equal(humeVoiceOverride({ brandedVoiceId: 'not-a-hume-id', selectedVoiceId: selectedId }), selectedId);
});

test('Hume tool payloads preserve tool-call correlation and safe fallback content', () => {
  const response = createToolResponsePayload({
    toolCallId: 'call-1',
    toolCall: { name: 'get_safety_tips', tool_type: 'function' },
    customSessionId: 'session-1',
    content: { tips: ['Stay visible.'] }
  });
  assert.equal(response.tool_call_id, 'call-1');
  assert.equal(response.custom_session_id, 'session-1');
  assert.deepEqual(JSON.parse(response.content), { tips: ['Stay visible.'] });

  const failure = createToolErrorPayload({
    toolCallId: 'call-1',
    error: 'private timeout diagnostic',
    fallbackContent: 'Tips are unavailable.'
  });
  assert.deepEqual(failure, {
    type: 'tool_error',
    tool_call_id: 'call-1',
    error: 'TOOL_EXECUTION_FAILED',
    fallback_content: 'Tips are unavailable.',
    level: 'warn'
  });
  assert.doesNotMatch(JSON.stringify(failure), /private timeout diagnostic/);
  assert.equal(reconnectDelay(1000, 5), 16000);
});

test('Hume close classification never reconnects terminal sessions', () => {
  for (const closeCode of [1000, 1008]) {
    assert.equal(classifyHumeClose({ closeCode }).shouldReconnect, false);
  }

  for (const serverErrorCode of ['E0714', 'E0715', 'E0721', 'E0602', 'E0703']) {
    assert.equal(
      classifyHumeClose({ closeCode: 1006, serverErrorCode }).shouldReconnect,
      false,
      `${serverErrorCode} must be terminal`
    );
  }

  assert.deepEqual(
    classifyHumeClose({ closeCode: 1006 }),
    { shouldReconnect: true, category: 'transient-transport' }
  );
  assert.equal(classifyHumeClose({ closeCode: 1011 }).shouldReconnect, true);
  assert.equal(classifyHumeClose({ closeCode: 1006, closeReason: '403 Unauthorized' }).shouldReconnect, false);
});

test('Hume resume fallback retries only the intentional fresh-chat close', () => {
  assert.deepEqual(
    classifyHumeClose({ closeCode: 4002, serverErrorCode: 'E0708' }),
    { shouldReconnect: true, category: 'resume-without-chat-group' }
  );
  assert.equal(classifyHumeClose({ closeCode: 1000, serverErrorCode: 'E0708' }).shouldReconnect, false);
  assert.equal(classifyHumeClose({ closeCode: 4002 }).shouldReconnect, false);
});
