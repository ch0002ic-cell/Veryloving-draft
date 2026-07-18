'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');
const {
  ROBOT_PAIRING_CREDENTIALS_KEY,
  loadRobotPairingCredential,
  removeRobotPairingCredential,
  saveRobotPairingCredential
} = require('../src/services/robot-pairing-credential-store');
const originalLoad = Module._load;
Module._load = function loadPairingConfig(request, parent, isMain) {
  if (request === '../utils/config' && parent?.filename.endsWith('/src/services/safety-api.js')) {
    return { config: { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { factoryResetHomeRobot, pairHomeRobot } = require('../src/services/robot-pairing');
Module._load = originalLoad;

function memorySecureStore() {
  const values = new Map();
  return {
    async getItemAsync(key) { return values.get(key) ?? null; },
    async setItemAsync(key, value) { values.set(key, value); },
    async deleteItemAsync(key) { values.delete(key); },
    raw() { return values.get(ROBOT_PAIRING_CREDENTIALS_KEY); }
  };
}

const token = 'a'.repeat(43);

test('robot pairing credentials are account-bound and never enter device descriptors', async () => {
  const secureStorageImpl = memorySecureStore();
  await saveRobotPairingCredential('user-a', 'robot-1', token, { secureStorageImpl });
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), token);
  assert.equal(await loadRobotPairingCredential('user-b', 'robot-1', { secureStorageImpl }), null);
  assert.doesNotMatch(JSON.stringify({ deviceId: 'robot-1', deviceType: 'home_robot' }), new RegExp(token));
  assert.equal(await removeRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), true);
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), null);
});

test('pairing stores the one-time response in protected storage and reset proves possession', async () => {
  const secureStorageImpl = memorySecureStore();
  const requests = [];
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') {
      return {
        ok: true,
        status: 201,
        json: async () => ({ robot_id: 'robot-1', pairing_token: token, device_type: 'home_robot' })
      };
    }
    return { ok: true, status: 204, json: async () => null };
  };

  assert.deepEqual(await pairHomeRobot('q'.repeat(24), 'access-token', {
    accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl
  }), { robot_id: 'robot-1', device_type: 'home_robot' });
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), token);
  assert.doesNotMatch(JSON.stringify(requests[0]), new RegExp(token));

  await factoryResetHomeRobot('robot-1', 'access-token', {
    accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl
  });
  assert.equal(requests[1].options.headers['X-Device-Pairing-Token'], token);
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), null);
});
