'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const {
  clearRobotPairingCredentials,
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
const {
  factoryResetHomeRobot,
  loadOrRecoverHomeRobotCredential,
  pairHomeRobot
} = require('../src/services/robot-pairing');
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

function jsonResponse(payload, status = 200) {
  const responseBody = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => name.toLowerCase() === 'content-length'
        ? String(Buffer.byteLength(responseBody))
        : null
    },
    text: async () => responseBody
  };
}

test('QR pairing closes the same-render duplicate callback window synchronously', () => {
  const screen = readFileSync(path.resolve(process.cwd(), 'app/robot-pairing.js'), 'utf8');
  const pairing = screen.slice(
    screen.indexOf('const pair = useCallback'),
    screen.indexOf('\n\n  if (!permission)')
  );
  const fenceCheck = pairing.indexOf('pairingInFlightRef.current');
  const fenceSet = pairing.indexOf('pairingInFlightRef.current = true');
  const stateSet = pairing.indexOf('setBusy(true)');

  assert.match(screen, /const pairingInFlightRef = useRef\(false\)/);
  assert.ok(fenceCheck >= 0 && fenceCheck < fenceSet && fenceSet < stateSet);
  assert.match(pairing, /catch \{\s*pairingInFlightRef\.current = false;[\s\S]*setBusy\(false\)/);
  assert.match(screen, /onBarcodeScanned=\{busy \? undefined : pair\}/);
});

test('robot pairing credentials are account-bound and never enter device descriptors', async () => {
  const secureStorageImpl = memorySecureStore();
  await saveRobotPairingCredential('user-a', 'robot-1', token, { secureStorageImpl });
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), token);
  assert.equal(await loadRobotPairingCredential('user-b', 'robot-1', { secureStorageImpl }), null);
  assert.doesNotMatch(JSON.stringify({ deviceId: 'robot-1', deviceType: 'home_robot' }), new RegExp(token));
  assert.equal(await removeRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), true);
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), null);
});

test('concurrent robot credential mutations cannot lose a device or resurrect data after clear', async () => {
  const secureStorageImpl = memorySecureStore();
  await Promise.all([
    saveRobotPairingCredential('user-a', 'robot-a', 'a'.repeat(43), { secureStorageImpl }),
    saveRobotPairingCredential('user-a', 'robot-b', 'b'.repeat(43), { secureStorageImpl })
  ]);
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-a', { secureStorageImpl }), 'a'.repeat(43));
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-b', { secureStorageImpl }), 'b'.repeat(43));

  let releaseWrite;
  const originalSet = secureStorageImpl.setItemAsync;
  secureStorageImpl.setItemAsync = async (...args) => {
    await new Promise((resolve) => { releaseWrite = resolve; });
    return originalSet(...args);
  };
  const pendingSave = saveRobotPairingCredential(
    'user-a', 'robot-c', 'c'.repeat(43), { secureStorageImpl }
  );
  while (!releaseWrite) await Promise.resolve();
  const pendingClear = clearRobotPairingCredentials({ secureStorageImpl });
  releaseWrite();
  await Promise.all([pendingSave, pendingClear]);
  assert.equal(secureStorageImpl.raw(), undefined);
});

test('pairing stores the one-time response in protected storage and reset proves possession', async () => {
  const secureStorageImpl = memorySecureStore();
  const requests = [];
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') {
      const responseBody = JSON.stringify({ robot_id: 'robot-1', pairing_token: token, device_type: 'home_robot' });
      return {
        ok: true,
        status: 201,
        headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(Buffer.byteLength(responseBody)) : null },
        text: async () => responseBody
      };
    }
    return { ok: true, status: 204, json: async () => null };
  };

  assert.deepEqual(await pairHomeRobot('q'.repeat(24), 'access-token', {
    accountId: 'user-a', vendor: 'jiangzhi', secureStorageImpl, runtimeConfig, fetchImpl
  }), { robot_id: 'robot-1', device_type: 'home_robot' });
  assert.equal(JSON.parse(requests[0].options.body).robot_vendor, 'jiangzhi');
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), token);
  assert.doesNotMatch(JSON.stringify(requests[0]), new RegExp(token));

  await factoryResetHomeRobot('robot-1', 'access-token', {
    accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl
  });
  assert.equal(requests[1].options.headers['X-Device-Pairing-Token'], token);
  assert.equal(await loadRobotPairingCredential('user-a', 'robot-1', { secureStorageImpl }), null);
});

test('local data cleanup also fences a late one-time pairing response', async () => {
  const secureStorageImpl = memorySecureStore();
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => { markRequestStarted = resolve; });
  let releaseResponse;
  const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
  const pairing = pairHomeRobot('q'.repeat(24), 'old-account-access-token', {
    accountId: 'user-old',
    vendor: 'jiangzhi',
    secureStorageImpl,
    runtimeConfig,
    fetchImpl: async () => {
      markRequestStarted();
      await responseReady;
      return jsonResponse({
        robot_id: 'robot-pairing-race',
        pairing_token: token,
        device_type: 'home_robot'
      }, 201);
    }
  });

  await requestStarted;
  await clearRobotPairingCredentials({ secureStorageImpl });
  releaseResponse();
  await assert.rejects(
    pairing,
    (error) => error?.code === 'ROBOT_CREDENTIAL_CLEANUP_SUPERSEDED'
  );
  assert.equal(secureStorageImpl.raw(), undefined);
});

test('a missing local robot credential is recovered once and persisted account-bound', async () => {
  const secureStorageImpl = memorySecureStore();
  const requests = [];
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({
      robot_id: 'robot-1',
      pairing_token: token,
      device_type: 'home_robot'
    });
  };

  assert.equal(await loadOrRecoverHomeRobotCredential('robot-1', 'access-token', {
    accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl
  }), token);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    'https://api.example.test/v1/devices/home-robots/robot-1/pairing-credential/recover'
  );
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.body, '{}');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer access-token');
  assert.equal(requests[0].options.headers['X-Device-Pairing-Token'], undefined);
  assert.doesNotMatch(JSON.stringify(requests[0]), new RegExp(token));
  assert.equal(await loadRobotPairingCredential(
    'user-a',
    'robot-1',
    { secureStorageImpl }
  ), token);
  assert.equal(await loadRobotPairingCredential(
    'user-b',
    'robot-1',
    { secureStorageImpl }
  ), null);

  assert.equal(await loadOrRecoverHomeRobotCredential('robot-1', 'access-token', {
    accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl
  }), token);
  assert.equal(requests.length, 1);
});

test('concurrent robot credential recovery is coalesced per account and robot', async () => {
  const secureStorageImpl = memorySecureStore();
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  let requestCount = 0;
  let releaseResponse;
  const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
  const fetchImpl = async () => {
    requestCount += 1;
    await responseReady;
    return jsonResponse({
      robot_id: 'robot-1',
      pairing_token: token,
      device_type: 'home_robot'
    });
  };

  const options = { accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl };
  const first = loadOrRecoverHomeRobotCredential('robot-1', 'access-token', options);
  const second = loadOrRecoverHomeRobotCredential('robot-1', 'access-token', options);
  while (requestCount === 0) await Promise.resolve();
  assert.equal(requestCount, 1);
  releaseResponse();
  assert.deepEqual(await Promise.all([first, second]), [token, token]);
  assert.equal(requestCount, 1);
});

test('local data cleanup fences a late robot credential recovery response', async () => {
  const secureStorageImpl = memorySecureStore();
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  let markRequestStarted;
  const requestStarted = new Promise((resolve) => { markRequestStarted = resolve; });
  let releaseResponse;
  const responseReady = new Promise((resolve) => { releaseResponse = resolve; });
  const fetchImpl = async () => {
    markRequestStarted();
    await responseReady;
    return jsonResponse({
      robot_id: 'robot-cleanup-race',
      pairing_token: token,
      device_type: 'home_robot'
    });
  };

  const recovery = loadOrRecoverHomeRobotCredential(
    'robot-cleanup-race',
    'old-account-access-token',
    {
      accountId: 'user-old',
      secureStorageImpl,
      runtimeConfig,
      fetchImpl
    }
  );
  await requestStarted;
  await clearRobotPairingCredentials({ secureStorageImpl });
  releaseResponse();
  await assert.rejects(
    recovery,
    (error) => error?.code === 'ROBOT_CREDENTIAL_CLEANUP_SUPERSEDED'
  );
  assert.equal(secureStorageImpl.raw(), undefined);
});

test('invalid recovered robot credentials are rejected without persistence', async () => {
  for (const payload of [
    { robot_id: 'robot-other', pairing_token: token, device_type: 'home_robot' },
    { robot_id: 'robot-1', pairing_token: 'short', device_type: 'home_robot' },
    { robot_id: 'robot-1', pairing_token: token, device_type: 'wearable' }
  ]) {
    const secureStorageImpl = memorySecureStore();
    const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
    await assert.rejects(
      loadOrRecoverHomeRobotCredential('robot-1', 'access-token', {
        accountId: 'user-a',
        secureStorageImpl,
        runtimeConfig,
        fetchImpl: async () => jsonResponse(payload)
      }),
      /recovered robot pairing credential is invalid/
    );
    assert.equal(await loadRobotPairingCredential(
      'user-a',
      'robot-1',
      { secureStorageImpl }
    ), null);
  }
});

test('factory reset recovers a credential lost after process death before proving possession', async () => {
  const secureStorageImpl = memorySecureStore();
  const requests = [];
  const runtimeConfig = { safetyBackendEnabled: true, apiBaseUrl: 'https://api.example.test' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'POST') {
      return jsonResponse({
        robot_id: 'robot-1',
        pairing_token: token,
        device_type: 'home_robot'
      });
    }
    return { ok: true, status: 204, headers: { get: () => null } };
  };

  await factoryResetHomeRobot('robot-1', 'access-token', {
    accountId: 'user-a', secureStorageImpl, runtimeConfig, fetchImpl
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /pairing-credential\/recover$/);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[1].options.method, 'DELETE');
  assert.equal(requests[1].options.headers['X-Device-Pairing-Token'], token);
  assert.equal(await loadRobotPairingCredential(
    'user-a',
    'robot-1',
    { secureStorageImpl }
  ), null);
});
