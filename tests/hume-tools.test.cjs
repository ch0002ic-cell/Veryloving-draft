'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadHumeToolConfig(request, parent, isMain) {
  if (request === '../utils/config' && parent?.filename.endsWith('/src/services/hume-tools.js')) {
    return { config: {
      apiBaseUrl: 'https://api.example.test',
      humeCustomizationURL: 'https://voice.example.test'
    } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { executeHumeTool } = require('../src/services/hume-tools');
Module._load = originalLoad;

test('AI help dial invokes the confirmed native SOS flow and reports honest status', async () => {
  let calls = 0;
  const result = JSON.parse(await executeHumeTool({ name: 'request_help_dial', parameters: {} }, {
    async requestHelpDial() {
      calls += 1;
      return { status: 'cancelled', backendStatus: 'not_requested' };
    }
  }));
  assert.equal(calls, 1);
  assert.deepEqual(result, { status: 'cancelled', backend_status: 'not_requested' });
});

test('STOP is forwarded through the signed wearable action path', async () => {
  let request;
  const result = await executeHumeTool({
    name: 'stop',
    parameters: JSON.stringify({ device_type: 'wearable', device_id: 'wearable-1', parameters: {} })
  }, {
    async requestDeviceAction(value) {
      request = value;
      return 'accepted';
    }
  });
  assert.equal(result, 'accepted');
  assert.equal(request.name, 'stop');
  assert.equal(request.parameters.device_type, 'wearable');
});

test('AI Angel uses the scenario transport without accepting client device targets', async () => {
  let request;
  const result = await executeHumeTool({
    name: 'trigger_ai_angel',
    parameters: '{}'
  }, {
    async requestAINativeScenario(value) {
      request = value;
      return 'scenario accepted';
    }
  });
  assert.equal(result, 'scenario accepted');
  assert.equal(request.name, 'trigger_ai_angel');
  assert.deepEqual(request.parameters, {});

  await assert.rejects(() => executeHumeTool({
    name: 'trigger_ai_angel',
    parameters: JSON.stringify({ device_id: 'robot-attacker-selected' })
  }, {
    async requestAINativeScenario() { throw new Error('must not run'); }
  }), /does not accept device identifiers/);
});

test('fallback device actions use bounded no-redirect HTTP', async () => {
  let request;
  const result = await executeHumeTool({
    name: 'check_medication',
    parameters: { device_type: 'home_robot', device_id: 'robot-1' }
  }, {
    accessToken: 'session-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 202,
        headers: { get: (name) => name === 'content-length' ? '21' : null },
        text: async () => '{"status":"accepted"}'
      };
    }
  });
  assert.deepEqual(JSON.parse(result), { status: 'accepted' });
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers.Authorization, 'Bearer session-token');

  const startedAt = Date.now();
  await assert.rejects(executeHumeTool({
    name: 'check_medication',
    parameters: { device_type: 'home_robot', device_id: 'robot-1' }
  }, {
    accessToken: 'session-token',
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  }), (error) => error.code === 'HTTP_REQUEST_TIMEOUT');
  assert.ok(Date.now() - startedAt < 500);
});

test('remote safety tips fall back promptly when fetch ignores AbortSignal', async () => {
  const startedAt = Date.now();
  const result = JSON.parse(await executeHumeTool({
    name: 'get_safety_tips',
    parameters: { scenario: 'walking_alone' }
  }, {
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  }));
  assert.ok(Array.isArray(result.tips));
  assert.ok(Date.now() - startedAt < 500);
});
