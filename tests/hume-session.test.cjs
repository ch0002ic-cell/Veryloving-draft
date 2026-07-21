'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadHumeSessionConfig(request, parent, isMain) {
  if (request === '../utils/config' && parent?.filename.endsWith('/src/services/hume-session.js')) {
    return { config: {
      humeCLMEnabled: true,
      humeWSProxyURL: '',
      humeCustomizationURL: 'https://voice.example.test'
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { configureHumeCustomSession } = require('../src/services/hume-session');
Module._load = originalLoad;

test('voice customization uses a bounded no-redirect request and releases its body', async () => {
  let request;
  let cancelled = 0;
  await configureHumeCustomSession({
    chatId: 'chat-1',
    customSessionId: 'session-1',
    accessToken: 'access-token'
  }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 204, body: { async cancel() { cancelled += 1; } } };
    }
  });
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer access-token');
  assert.equal(cancelled, 1);

  const startedAt = Date.now();
  await assert.rejects(configureHumeCustomSession({
    chatId: 'chat-1',
    customSessionId: 'session-1',
    accessToken: 'access-token'
  }, {
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  }), /timed out/i);
  assert.ok(Date.now() - startedAt < 500);
});
