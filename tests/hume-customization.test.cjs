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
  createSessionSettingsPayload,
  createToolErrorPayload,
  createToolResponsePayload,
  reconnectDelay
} = require('../src/services/websocket/hume-protocol');

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
  assert.match(url, /resumed_chat_group_id=chat-group-id/);
  const settings = createSessionSettingsPayload({ customSessionId: 'opaque-session', systemPrompt: 'Be helpful.' });
  assert.equal(settings.type, 'session_settings');
  assert.equal(settings.custom_session_id, 'opaque-session');
  assert.equal(settings.audio.sample_rate, 48000);
  assert.equal(settings.language_model_api_key, undefined);
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

  const failure = createToolErrorPayload({ toolCallId: 'call-1', error: 'timeout', content: 'Tips are unavailable.' });
  assert.equal(failure.type, 'tool_error');
  assert.equal(failure.level, 'warn');
  assert.equal(reconnectDelay(1000, 5), 16000);
});
