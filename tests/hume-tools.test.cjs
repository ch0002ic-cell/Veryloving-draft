'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadHumeToolConfig(request, parent, isMain) {
  if (request === '../utils/config' && parent?.filename.endsWith('/src/services/hume-tools.js')) {
    return { config: {} };
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
