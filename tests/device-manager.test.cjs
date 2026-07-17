'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { BaseDevice, DEVICE_TYPES } = require('../src/services/device-manager/BaseDevice');
const { DeviceRegistry } = require('../src/services/device-manager/DeviceRegistry');
const { HomeRobotDevice } = require('../src/services/device-manager/HomeRobotDevice');
const { normalizeDeviceEntity, persistDeviceEntities } = require('../src/services/device-entity-store');
const { enqueueDeviceCommand } = require('../src/services/device-command-queue');

class TestDevice extends BaseDevice {
  async connect() { return this.setStatus({ online: true }); }
  async disconnect() { return this.setStatus({ online: false }); }
  async sendCommand(command) { return command; }
}

class QueuedWearable extends TestDevice {
  constructor(options, writeCommand = async () => {}) { super(options); this.writeCommand = writeCommand; }
  sendCommand(command) { return this.enqueueCommand(() => this.writeCommand(command)); }
}

test('DeviceRegistry rejects non-devices and duplicate identities', () => {
  const registry = new DeviceRegistry();
  const device = new TestDevice({ deviceId: 'wearable-1', deviceType: DEVICE_TYPES.wearable });
  assert.throws(() => registry.register({ deviceId: 'bad' }), /BaseDevice/);
  assert.equal(registry.register(device), device);
  assert.throws(() => registry.register(device), /already registered/);
});

test('DeviceRegistry filters devices by type and online status', async () => {
  const registry = new DeviceRegistry();
  const wearable = registry.register(new TestDevice({ deviceId: 'w1', deviceType: DEVICE_TYPES.wearable }));
  registry.register(new TestDevice({ deviceId: 'r1', deviceType: DEVICE_TYPES.homeRobot }));
  await wearable.connect();
  assert.deepEqual(registry.list({ deviceType: 'wearable', online: true }), [wearable]);
});

test('HomeRobotDevice serializes commands through the backend relay', async () => {
  const bodies = [];
  const robot = new HomeRobotDevice({
    deviceId: 'robot-1', gatewayURL: 'https://api.example.test', accessToken: 'session',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, status: 202, json: async () => ({ accepted: true }) };
    }
  });
  await Promise.all([robot.sendCommand({ type: 'first' }), robot.sendCommand({ type: 'second' })]);
  assert.deepEqual(bodies.map((body) => body.type), ['first', 'second']);
});

test('process death rebuilds wearable and robot registry from account-bound descriptors', async () => {
  let snapshot = null;
  const storageImpl = {
    async getJSON(_key, fallback) { return snapshot || fallback; },
    async setJSON(_key, value) { snapshot = value; }
  };
  await persistDeviceEntities('user-a', [
    { deviceId: 'w1', deviceType: 'wearable', name: 'Travel', online: true, location: { longitude: 103.8, latitude: 1.3 }, hardwareSerial: 'secret' },
    { deviceId: 'r1', deviceType: 'home_robot', name: 'Home', pairingToken: 'secret' }
  ], { storageImpl });
  assert.doesNotMatch(JSON.stringify(snapshot), /hardwareSerial|pairingToken|secret/);

  const registryAfterDeath = new DeviceRegistry();
  await registryAfterDeath.rehydrateRegistry({
    accountId: 'user-a', gatewayURL: 'https://api.example.test', accessToken: 'session',
    wearableFactory: (record) => new QueuedWearable({ deviceId: record.deviceId, deviceType: DEVICE_TYPES.wearable, name: record.name }),
    robotFactory: (record) => new HomeRobotDevice({ deviceId: record.deviceId, name: record.name, gatewayURL: 'https://api.example.test', loadNetwork: async () => ({ addNetworkStateListener: () => ({ remove() {} }) }) }),
    loadEntities: async (accountId) => accountId === snapshot.accountId
      ? snapshot.entities.map((entity) => normalizeDeviceEntity(entity, accountId)) : []
  });
  assert.deepEqual(registryAfterDeath.list().map((item) => item.deviceId).sort(), ['r1', 'w1']);
  assert.equal(registryAfterDeath.get('w1').getStatus().online, false);
  assert.equal(registryAfterDeath.get('r1').getStatus().online, false);
  assert.deepEqual(registryAfterDeath.get('w1').getStatus().location, { longitude: 103.8, latitude: 1.3 });
});

test('per-device queues isolate a stalled BLE wearable from robot HTTP delivery', async () => {
  let releaseWearable;
  const wearable = new QueuedWearable(
    { deviceId: 'w1', deviceType: DEVICE_TYPES.wearable },
    () => new Promise((resolve) => { releaseWearable = resolve; })
  );
  let robotDelivered = false;
  const robot = new HomeRobotDevice({
    deviceId: 'r1', gatewayURL: 'https://api.example.test',
    fetchImpl: async () => { robotDelivered = true; return { ok: true, status: 202, text: async () => '' }; }
  });
  const stalled = wearable.sendCommand({ payload: 'QQ==' });
  const robotResult = await robot.sendCommand({ action: 'check_medication', parameters: {} });
  assert.equal(robotDelivered, true);
  assert.equal(robotResult.accepted, true);
  releaseWearable();
  await stalled;
});

test('robot network failure marks it offline and retains its durable command', async () => {
  const queued = [];
  const commandStore = {
    async enqueue(item) { const next = { id: 'q1', command: item.command }; queued.push(next); return next; },
    async acknowledge(id) { const index = queued.findIndex((item) => item.id === id); if (index >= 0) queued.splice(index, 1); },
    async load() { return [...queued]; }
  };
  const robot = new HomeRobotDevice({
    deviceId: 'r1', accountId: 'user-a', gatewayURL: 'https://api.example.test', commandStore,
    fetchImpl: async () => { throw new Error('airplane mode'); }
  });
  robot.setStatus({ online: true, connectionState: 'connected' });
  await assert.rejects(robot.sendCommand({ action: 'check_medication', parameters: {} }), /airplane mode/);
  assert.equal(robot.getStatus().online, false);
  assert.equal(queued.length, 1);
});

test('registry ignores a stale account rehydrate that finishes after a newer account', async () => {
  const registry = new DeviceRegistry();
  let releaseAccountA;
  const accountALoad = new Promise((resolve) => { releaseAccountA = resolve; });
  let staleDevice;
  const hydrateA = registry.rehydrateRegistry({
    accountId: 'account-a',
    loadEntities: async () => {
      await accountALoad;
      return [{ accountId: 'account-a', deviceId: 'a-wearable', deviceType: 'wearable', name: 'A' }];
    },
    wearableFactory: (record) => {
      staleDevice = new TestDevice({ deviceId: record.deviceId, deviceType: DEVICE_TYPES.wearable });
      return staleDevice;
    }
  });
  await registry.rehydrateRegistry({
    accountId: 'account-b',
    loadEntities: async () => [{ accountId: 'account-b', deviceId: 'b-wearable', deviceType: 'wearable', name: 'B' }],
    wearableFactory: (record) => new TestDevice({ deviceId: record.deviceId, deviceType: DEVICE_TYPES.wearable })
  });
  releaseAccountA();
  await hydrateA;

  assert.deepEqual(registry.list().map((device) => device.deviceId), ['b-wearable']);
  assert.equal(staleDevice.disposed, true);
});

test('upserting a replacement disposes the old device and cancels its queued work', async () => {
  const registry = new DeviceRegistry();
  let releaseFirst;
  const oldDevice = registry.register(new QueuedWearable(
    { deviceId: 'same-id', deviceType: DEVICE_TYPES.wearable },
    (command) => command === 'first'
      ? new Promise((resolve) => { releaseFirst = resolve; })
      : Promise.resolve(command)
  ));
  const first = oldDevice.sendCommand('first');
  while (!releaseFirst) await Promise.resolve();
  const second = oldDevice.sendCommand('second');
  registry.upsert(new TestDevice({ deviceId: 'same-id', deviceType: DEVICE_TYPES.wearable }));
  releaseFirst('done');

  assert.equal(await first, 'done');
  await assert.rejects(second, (error) => error?.code === 'DEVICE_DISPOSED');
  assert.equal(oldDevice.disposed, true);
});

test('robot durable scan deduplicates delivery and binds identity with a stable idempotency key', async () => {
  const queued = [{
    id: 'command-q1',
    command: {
      action: 'check_medication',
      device_id: 'attacker-selected-device',
      device_type: 'wearable',
      parameters: { medication_id: 'morning' }
    }
  }];
  let loads = 0;
  let deliveries = 0;
  let body;
  let headers;
  let releaseDelivery;
  const commandStore = {
    async enqueue() { throw new Error('not used'); },
    async load() { loads += 1; return [...queued]; },
    async acknowledge(id) { queued.splice(queued.findIndex((item) => item.id === id), 1); }
  };
  const robot = new HomeRobotDevice({
    deviceId: 'bound-robot', accountId: 'account-a', gatewayURL: 'https://api.example.test', commandStore,
    fetchImpl: async (_url, options) => {
      deliveries += 1;
      body = JSON.parse(options.body);
      headers = options.headers;
      return new Promise((resolve) => { releaseDelivery = () => resolve({ ok: true, status: 202, text: async () => '' }); });
    }
  });
  const firstScan = robot.retryPendingCommands();
  const secondScan = robot.retryPendingCommands();
  while (!releaseDelivery) await Promise.resolve();
  assert.equal(deliveries, 1);
  releaseDelivery();
  await Promise.all([firstScan, secondScan]);

  assert.equal(loads, 1);
  assert.equal(body.device_id, 'bound-robot');
  assert.equal(body.device_type, 'home_robot');
  assert.equal(body.idempotency_key, 'command-q1');
  assert.deepEqual(body.parameters, { medication_id: 'morning' });
  assert.equal(headers['Idempotency-Key'], 'command-q1');
});

test('generic relay health never labels manufacturer hardware online', async () => {
  const robot = new HomeRobotDevice({
    deviceId: 'robot-unknown', gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ status: 'ok' }) })
  });
  const status = await robot.connect();
  assert.equal(status.relayOnline, true);
  assert.equal(status.online, false);
  assert.equal(status.hardwareStatus, 'unknown');
  assert.equal(status.connectionState, 'unknown');
});

test('successful telemetry persists robot location without cancelling a failed command retry', async () => {
  let retry;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-location',
    accountId: 'account-a',
    gatewayURL: 'https://api.example.test',
    commandStore: {
      async load() { return [{ id: 'pending-1', command: { action: 'check_medication', parameters: {} } }]; },
      async acknowledge() { throw new Error('failed command must not be acknowledged'); }
    },
    setTimeoutImpl(callback) { retry = callback; return { unref() {} }; },
    clearTimeoutImpl() {},
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'ok' }) };
      if (url.includes('/telemetry')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ online: true, location: { longitude: 103.8, latitude: 1.3 }, reported_at: 1234 })
        };
      }
      return { ok: false, status: 503, text: async () => '' };
    }
  });
  const status = await robot.connect();
  assert.deepEqual(status.location, { longitude: 103.8, latitude: 1.3, capturedAt: 1234 });
  assert.equal(status.online, true);
  assert.equal(typeof retry, 'function');
  robot.dispose();
});

test('a full durable command queue fails closed instead of evicting an older command', async () => {
  const existing = Array.from({ length: 100 }, (_, index) => ({
    id: `existing-${index}`,
    accountId: 'account-a',
    deviceId: 'robot-1',
    command: { action: 'check_medication' }
  }));
  let stored = existing;
  const storageImpl = {
    async getJSON() { return stored; },
    async setJSON(_key, value) { stored = value; }
  };
  await assert.rejects(
    enqueueDeviceCommand({ accountId: 'account-a', deviceId: 'robot-1', command: { action: 'check_medication' } }, { storageImpl }),
    (error) => error.code === 'DEVICE_COMMAND_QUEUE_FULL'
  );
  assert.equal(stored.length, 100);
  assert.equal(stored[0].id, 'existing-0');
});

test('robot relay failures schedule bounded recovery even without another network event', async () => {
  let retry;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-retry',
    gatewayURL: 'https://gateway.example.test',
    setTimeoutImpl(callback) { retry = callback; return { unref() {} }; },
    clearTimeoutImpl() {},
    fetchImpl: async () => { throw new Error('relay unavailable'); }
  });
  await assert.rejects(robot.sendCommand({ action: 'check_medication', parameters: {} }), /relay unavailable/);
  assert.equal(typeof retry, 'function');
  robot.dispose();
});

test('AppContext keeps restored wearable location, removes stale wearables, and starts new robot monitoring', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  assert.match(source, /location:\s*device\.location\s*\?\?\s*restoredWearable\?\.location\s*\?\?\s*null/);
  assert.match(source, /deviceRegistry\.list\(\{ deviceType: 'wearable' \}\)[\s\S]*deviceRegistry\.unregister\(registered\.deviceId\)/);
  assert.match(source, /registered\.startNetworkMonitoring\?\.\(\)\.catch/);
  assert.doesNotMatch(source, /\}, \[accessToken, authLoading, user\?\.id\]\);/);
});
