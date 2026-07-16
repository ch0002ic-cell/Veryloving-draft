'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ROBOTICS_SIMULATOR_URL_KEY,
  loadRoboticsSimulatorURL,
  normalizeRoboticsSimulatorURL,
  resolveRoboticsSimulatorURLs,
  saveRoboticsSimulatorURL
} = require('../src/services/robotics-simulator-config');
const { RoboticsMockDriver } = require('../src/services/robotics-mock-driver');
const { normalizePairedDevice } = require('../src/services/paired-device-store');

function memoryStorage(initial = null) {
  let value = initial;
  return {
    getJSON: async (key, fallback) => key === ROBOTICS_SIMULATOR_URL_KEY ? value ?? fallback : fallback,
    setJSON: async (key, next) => { if (key === ROBOTICS_SIMULATOR_URL_KEY) value = next; },
    remove: async (key) => { if (key === ROBOTICS_SIMULATOR_URL_KEY) value = null; }
  };
}

test('runtime simulator URLs accept private LAN or secure tunnel endpoints only', async () => {
  assert.equal(normalizeRoboticsSimulatorURL('ws://192.168.1.20:9090'), 'ws://192.168.1.20:9090');
  assert.equal(normalizeRoboticsSimulatorURL('wss://robot-bench.example.test/socket'), 'wss://robot-bench.example.test/socket');
  assert.equal(normalizeRoboticsSimulatorURL('ws://public.example.test:9090'), null);
  assert.equal(normalizeRoboticsSimulatorURL('wss://user:password@example.test'), null);
  assert.equal(normalizeRoboticsSimulatorURL('wss://example.test?token=secret'), null);

  const storage = memoryStorage();
  await saveRoboticsSimulatorURL('ws://10.0.0.8:9090', storage);
  assert.equal(await loadRoboticsSimulatorURL(storage), 'ws://10.0.0.8:9090');
  await saveRoboticsSimulatorURL('', storage);
  assert.equal(await loadRoboticsSimulatorURL(storage), null);
});

test('URL resolution prefers the runtime QA override and derives the Expo host as fallback', async () => {
  const urls = await resolveRoboticsSimulatorURLs({
    configuredURL: 'ws://192.168.1.4:9090',
    constants: { expoConfig: { hostUri: '192.168.1.9:8081' }, platform: { ios: {} } },
    storageImpl: memoryStorage('wss://bench.example.test/socket')
  });
  assert.deepEqual(urls.slice(0, 3), [
    'wss://bench.example.test/socket',
    'ws://192.168.1.4:9090',
    'ws://192.168.1.9:9090'
  ]);
});

test('mock driver falls through failed WebSocket candidates and cleans up listeners on dispose', async () => {
  const attempts = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      attempts.push(url);
      globalThis.queueMicrotask(() => {
        if (url.includes('unavailable')) this.onerror?.(new Error('offline'));
        else {
          this.readyState = 1;
          this.onopen?.();
        }
      });
    }
    close() { this.readyState = 3; this.onclose?.(); }
    send() {}
  }
  const driver = new RoboticsMockDriver({
    WebSocketImpl: FakeWebSocket,
    connectTimeoutMs: 50,
    resolveURLs: async () => ['ws://unavailable.local:9090', 'ws://192.168.1.7:9090']
  });
  const states = [];
  const remove = driver.addConnectionStateListener((state) => states.push(state));
  const socket = await driver.ensureSocket();
  assert.equal(socket.url, 'ws://192.168.1.7:9090');
  assert.deepEqual(attempts, ['ws://unavailable.local:9090', 'ws://192.168.1.7:9090']);
  assert.equal(states.includes('socket-connected'), true);
  remove();
  driver.dispose();
  assert.equal(driver.connectionStateHandlers.size, 0);
  assert.equal(socket.readyState, 3);
});

test('only the explicit robotics WebSocket simulation is reconnectable after hydration', () => {
  const genericDemo = normalizePairedDevice({ id: 'demo', simulated: true, autoReconnect: true }, { forHydration: true });
  const robotics = normalizePairedDevice({
    id: 'robot-1',
    simulated: true,
    roboticsMock: true,
    autoReconnect: true
  }, { forHydration: true });
  assert.equal(genericDemo.connectionState, 'disconnected');
  assert.equal(genericDemo.autoReconnect, false);
  assert.equal(robotics.connectionState, 'reconnecting');
  assert.equal(robotics.autoReconnect, true);
});

test('writeCommand uses the default VL01 UUID registry when Expo overrides are absent', async () => {
  const writes = [];
  const driver = new RoboticsMockDriver();
  driver.request = async (type, payload, options) => {
    writes.push({ type, payload, options });
    return { complete: true };
  };

  await driver.writeCommand('robot-1', 'AQID', { withResponse: true });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].type, 'writeCharacteristic');
  assert.equal(writes[0].payload.serviceUUID, 'f0001100-0451-4000-b000-000000000000');
  assert.equal(writes[0].payload.characteristicUUID, 'f0001104-0451-4000-b000-000000000000');
});

test('a synchronous WebSocket send failure rejects immediately and clears pending requests', async () => {
  class ThrowingWebSocket {
    constructor() {
      this.readyState = 0;
      globalThis.queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
    close() { this.readyState = 3; }
    send() { throw new Error('socket closed'); }
  }
  const driver = new RoboticsMockDriver({
    WebSocketImpl: ThrowingWebSocket,
    requestTimeoutMs: 1000,
    resolveURLs: async () => ['ws://127.0.0.1:9090']
  });

  await assert.rejects(driver.scan(), (error) => error.code === 'BLE_CONNECT_FAILED');
  assert.equal(driver.pending.size, 0);
  driver.dispose();
});
