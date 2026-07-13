'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadAuthClientDependency(request, parent, isMain) {
  if (parent?.filename.endsWith('/src/services/auth-session.js') && request === '../utils/config') {
    return { config: { apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { refreshApplicationSession } = require('../src/services/auth-session');
Module._load = originalLoad;

test('mobile auth refresh rotates both secure session tokens', async () => {
  let request;
  const result = await refreshApplicationSession('old-refresh-token', {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accessToken: 'new-access-token',
          expiresAt: Date.now() + 60_000,
          refreshToken: 'new-refresh-token',
          refreshExpiresAt: Date.now() + 86400_000
        })
      };
    }
  });
  assert.equal(request.url, 'https://api.example.test/v1/auth/refresh');
  assert.deepEqual(JSON.parse(request.options.body), { refreshToken: 'old-refresh-token' });
  assert.equal(result.accessToken, 'new-access-token');
  assert.equal(result.refreshToken, 'new-refresh-token');
});

test('mobile auth refresh exposes rejection status without leaking a token', async () => {
  await assert.rejects(refreshApplicationSession('sensitive-refresh-token', {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Refresh session is invalid or expired' })
    })
  }), (error) => error.code === 'AUTH_HTTP_401' && !error.message.includes('sensitive-refresh-token'));
});
