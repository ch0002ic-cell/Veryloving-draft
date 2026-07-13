'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadSafetyConfig(request, parent, isMain) {
  if (request === '../utils/config' && parent?.filename.endsWith('/src/services/safety-api.js')) {
    return { config: { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { safetyRequest } = require('../src/services/safety-api');
Module._load = originalLoad;

const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test/' };

test('safety client sends first-party bearer auth and validates HTTP failures', async () => {
  let request;
  const payload = await safetyRequest('/v1/test', {
    accessToken: 'first-party-session',
    method: 'POST',
    body: { mode: 'guardian' },
    runtimeConfig,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
    }
  });
  assert.deepEqual(payload, { status: 'ok' });
  assert.equal(request.url, 'https://api.example.test/v1/test');
  assert.equal(request.options.headers.Authorization, 'Bearer first-party-session');
  assert.deepEqual(JSON.parse(request.options.body), { mode: 'guardian' });

  await assert.rejects(safetyRequest('/v1/test', {
    accessToken: 'expired-session',
    runtimeConfig,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })
  }), (error) => error.code === 'SAFETY_HTTP_401');
});

test('safety client fails closed without auth and aborts stalled requests', async () => {
  await assert.rejects(safetyRequest('/v1/test', {
    runtimeConfig,
    fetchImpl: async () => { throw new Error('must not run'); }
  }), (error) => error.code === 'SAFETY_AUTHENTICATION_REQUIRED');

  await assert.rejects(safetyRequest('/v1/test', {
    accessToken: 'first-party-session',
    runtimeConfig,
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  }), (error) => error.code === 'SAFETY_TIMEOUT');
});
