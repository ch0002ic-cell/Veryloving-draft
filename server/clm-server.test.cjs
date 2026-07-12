'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { createHandler } = require('./clm-server.cjs');
const { SAFETY_SYSTEM_PROMPT, getSafetyTips, inferScenario } = require('./safety-companion.cjs');

const silentLogger = { info() {}, warn() {}, error() {} };

async function invoke(options, { method = 'GET', url = '/', headers = {}, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const chunks = [];
  const res = {
    headersSent: false,
    statusCode: null,
    headers: {},
    writeHead(statusCode, responseHeaders = {}) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk) {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.finished = true;
    }
  };
  await createHandler({ logger: silentLogger, ...options })(req, res);
  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = res.headers['Content-Type'] || res.headers['content-type'] || '';
  return {
    status: res.statusCode,
    headers: res.headers,
    text,
    json: text && contentType.includes('application/json') ? JSON.parse(text) : null
  };
}

test('health endpoint reports the CLM service', async () => {
  const response = await invoke({}, { url: '/health' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { status: 'ok', service: 'veryloving-hume-clm' });
});

test('CLM rejects requests without the configured bearer token', async () => {
  const response = await invoke({ clmBearerToken: 'server-only-secret' }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { 'Content-Type': 'application/json' },
    body: { messages: [] }
  });
  assert.equal(response.status, 401);
});

test('CLM fails closed when server credentials are missing', async () => {
  const response = await invoke({ clmBearerToken: '' }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer anything', 'Content-Type': 'application/json' },
    body: { messages: [] }
  });
  assert.equal(response.status, 503);
  assert.deepEqual(response.json, { error: 'CLM authentication is not configured' });
});

test('CLM handles immediate danger locally and preserves the custom session ID', async () => {
  const response = await invoke({ clmBearerToken: 'server-only-secret' }, {
    method: 'POST',
    url: '/chat/completions?custom_session_id=opaque-session-1',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { model: 'veryloving', messages: [{ role: 'user', content: 'Someone has a knife and is attacking me' }] }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /text\/event-stream/);
  assert.match(response.text, /local emergency services/);
  assert.match(response.text, /opaque-session-1/);
  assert.match(response.text, /data: \[DONE\]/);
});

test('CLM emits an OpenAI-compatible custom tool call for safety guidance', async () => {
  const response = await invoke({ clmBearerToken: 'server-only-secret' }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: {
      messages: [{ role: 'user', content: 'What safety tips should I use while walking alone?' }],
      tools: [{ type: 'function', function: { name: 'get_safety_tips', parameters: { type: 'object' } } }]
    }
  });
  assert.match(response.text, /get_safety_tips/);
  assert.match(response.text, /walking_alone/);
  assert.match(response.text, /tool_calls/);
});

test('CLM injects the authoritative safety prompt before upstream context', async () => {
  let upstreamRequest;
  const fetchImpl = async (_url, options) => {
    upstreamRequest = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: 'Stay near other people while we decide the next step.' } }] })
    };
  };
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    fetchImpl
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: {
      messages: [
        { role: 'system', content: 'Speak gently and use the user name when known.' },
        { role: 'user', content: 'I feel uneasy walking home.' }
      ]
    }
  });
  assert.equal(upstreamRequest.messages[0].role, 'system');
  assert.match(upstreamRequest.messages[0].content, new RegExp(SAFETY_SYSTEM_PROMPT.split('\n')[0]));
  assert.match(upstreamRequest.messages[0].content, /Additional configured context/);
  assert.equal(upstreamRequest.messages[1].role, 'user');
  assert.match(response.headers['Content-Type'], /text\/event-stream/);
  assert.match(response.text, /Stay near other people/);
  assert.match(response.text, /data: \[DONE\]/);
});

test('CLM falls back to a local safety response when the upstream times out', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      const error = new Error('upstream timeout');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const response = await invoke({
    clmBearerToken: 'server-only-secret',
    upstreamURL: 'https://model.example/chat/completions',
    upstreamApiKey: 'upstream-secret',
    upstreamModel: 'safety-model',
    upstreamTimeoutMs: 5,
    fetchImpl
  }, {
    method: 'POST',
    url: '/chat/completions',
    headers: { Authorization: 'Bearer server-only-secret', 'Content-Type': 'application/json' },
    body: { messages: [{ role: 'user', content: 'I am feeling unsure right now.' }] }
  });
  assert.equal(response.status, 200);
  assert.match(response.text, /one small, practical next step/);
  assert.match(response.text, /data: \[DONE\]/);
});

test('safety tips endpoint validates app auth and returns curated guidance', async () => {
  const response = await invoke({ verifyAppToken: (token) => token === 'valid-user-token' }, {
    method: 'POST',
    url: '/v1/safety/tips',
    headers: { Authorization: 'Bearer valid-user-token', 'Content-Type': 'application/json' },
    body: { scenario: 'being_followed' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.scenario, 'being_followed');
  assert.equal(response.json.tips.length, 3);
});

test('control-plane endpoint injects the CLM key without returning it to the app', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 204 };
  };
  const response = await invoke({
    verifyAppToken: () => true,
    fetchImpl,
    humeApiKey: 'hume-server-key',
    clmBearerToken: 'clm-server-key'
  }, {
    method: 'POST',
    url: '/v1/hume/session/configure',
    headers: { Authorization: 'Bearer valid-user-token', 'Content-Type': 'application/json' },
    body: { chatId: '8859a139-d98a-4e2f-af54-9dd66d8c96e1', customSessionId: 'opaque-session' }
  });
  assert.equal(response.status, 204);
  assert.equal(response.text, '');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v0\/evi\/chat\/8859a139-d98a-4e2f-af54-9dd66d8c96e1\/send$/);
  assert.equal(calls[0].options.headers['X-Hume-Api-Key'], 'hume-server-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { type: 'session_settings', language_model_api_key: 'clm-server-key' });
});

test('safety classification selects conservative scenarios', () => {
  assert.equal(inferScenario('I think someone is following me'), 'being_followed');
  assert.equal(inferScenario('I am waiting for my rideshare'), 'rideshare');
  assert.equal(getSafetyTips('unknown').scenario, 'general');
});
