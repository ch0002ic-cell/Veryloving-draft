'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { BaseDevice, DEVICE_TYPES } = require('../src/services/device-manager/BaseDevice');
const { DeviceRegistry } = require('../src/services/device-manager/DeviceRegistry');
const { HomeRobotDevice } = require('../src/services/device-manager/HomeRobotDevice');
const { normalizeDeviceEntity, persistDeviceEntities } = require('../src/services/device-entity-store');
const { enqueueDeviceCommand } = require('../src/services/device-command-queue');

const originalModuleLoad = Module._load;
Module._load = function loadWearableWithoutNativeBLE(request, parent, isMain) {
  if (request === '../ble' && parent?.filename?.endsWith('/device-manager/WearableDevice.js')) {
    return { bleService: {} };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { WearableDevice } = require('../src/services/device-manager/WearableDevice');
Module._load = originalModuleLoad;

class TestDevice extends BaseDevice {
  async connect() { return this.setStatus({ online: true }); }
  async disconnect() { return this.setStatus({ online: false }); }
  async sendCommand(command) { return command; }
}

class QueuedWearable extends TestDevice {
  constructor(options, writeCommand = async () => {}) { super(options); this.writeCommand = writeCommand; }
  sendCommand(command) { return this.enqueueCommand(() => this.writeCommand(command)); }
}

function gatewayTextResponse(payload, status = 200) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-length'
          ? String(Buffer.byteLength(text))
          : null;
      }
    },
    text: async () => text
  };
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

test('DeviceRegistry forwards typed telemetry with its bound device identity', () => {
  const registry = new DeviceRegistry();
  const device = registry.register(new TestDevice({ deviceId: 'w-telemetry', deviceType: DEVICE_TYPES.wearable }));
  const events = [];
  const unsubscribe = registry.subscribeTelemetry((event) => events.push(event));
  device.emitTelemetry({ type: 'event', value: 'firmware-envelope' });
  unsubscribe();
  assert.deepEqual(events, [{
    deviceId: 'w-telemetry',
    deviceType: 'wearable',
    telemetry: { type: 'event', value: 'firmware-envelope' }
  }]);
});

test('telemetry fan-out isolates a failing consumer', () => {
  const device = new TestDevice({ deviceId: 'w-isolated', deviceType: DEVICE_TYPES.wearable });
  const delivered = [];
  device.onTelemetry(() => { throw new Error('screen unmounted'); });
  device.onTelemetry((event) => delivered.push(event));

  assert.doesNotThrow(() => device.emitTelemetry({ type: 'battery', value: 80 }));
  assert.deepEqual(delivered, [{ type: 'battery', value: 80 }]);
});

test('wearable telemetry keeps one BLE bridge until the final listener unsubscribes', () => {
  let nativeHandler;
  let registrations = 0;
  let removals = 0;
  const wearable = new WearableDevice({
    deviceId: 'wearable-multi-listener',
    bleClient: {
      addEventHandler(handler) {
        registrations += 1;
        nativeHandler = handler;
        return () => { removals += 1; };
      }
    }
  });
  const firstEvents = [];
  const secondEvents = [];
  const removeFirst = wearable.onTelemetry((event) => firstEvents.push(event));
  const removeSecond = wearable.onTelemetry((event) => secondEvents.push(event));

  assert.equal(registrations, 1);
  nativeHandler.onBattery('wearable-multi-listener', 87);
  removeFirst();
  assert.equal(removals, 0);
  nativeHandler.onEvent('wearable-multi-listener', 'fall');
  assert.deepEqual(firstEvents, [{ type: 'battery', battery: 87 }]);
  assert.deepEqual(secondEvents, [
    { type: 'battery', battery: 87 },
    { type: 'event', value: 'fall' }
  ]);

  removeSecond();
  removeSecond();
  assert.equal(removals, 1);
  wearable.dispose();
  assert.equal(removals, 1);
});

test('HomeRobotDevice serializes commands through the backend relay', async () => {
  const bodies = [];
  const redirects = [];
  const robot = new HomeRobotDevice({
    deviceId: 'robot-1', gatewayURL: 'https://api.example.test', accessToken: 'session',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      redirects.push(options.redirect);
      return gatewayTextResponse({ accepted: true }, 202);
    }
  });
  await Promise.all([robot.sendCommand({ type: 'first' }), robot.sendCommand({ type: 'second' })]);
  assert.deepEqual(bodies.map((body) => body.type), ['first', 'second']);
  assert.deepEqual(redirects, ['error', 'error']);
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
    fetchImpl: async () => { robotDelivered = true; return gatewayTextResponse('', 202); }
  });
  const stalled = wearable.sendCommand({ payload: 'QQ==' });
  const robotResult = await robot.sendCommand({ action: 'check_medication', parameters: {} });
  assert.equal(robotDelivered, true);
  assert.equal(robotResult.accepted, true);
  releaseWearable();
  await stalled;
});

test('per-device queues prioritize safety work and STOP bypasses a stalled write', async () => {
  const order = [];
  let releaseActive;
  const device = new TestDevice({ deviceId: 'priority-1', deviceType: DEVICE_TYPES.wearable });
  const active = device.enqueueCommand(() => new Promise((resolve) => {
    order.push('active');
    releaseActive = resolve;
  }));
  while (!releaseActive) await Promise.resolve();
  const background = device.enqueueCommand(async () => order.push('background'), { priority: 'background' });
  const standard = device.enqueueCommand(async () => order.push('standard'));
  const critical = device.enqueueCommand(async () => order.push('critical'), { priority: 'critical' });
  releaseActive();
  await Promise.all([active, background, standard, critical]);
  assert.deepEqual(order, ['active', 'critical', 'standard', 'background']);

  let releaseWrite;
  const writes = [];
  const running = device.enqueueCommand(() => new Promise((resolve) => {
    writes.push('RUN');
    releaseWrite = resolve;
  }), { priority: 'background' });
  while (!releaseWrite) await Promise.resolve();
  await device.enqueueCommand(async () => writes.push('HALT'), { priority: 'critical', bypass: true });
  assert.deepEqual(writes, ['RUN', 'HALT']);
  releaseWrite();
  await running;

  let releaseNativeWrite;
  const nativeWrites = [];
  const wearable = new WearableDevice({
    deviceId: 'real-stop-1',
    bleClient: {
      writeCommand(_id, payload) {
        nativeWrites.push(payload);
        if (payload === 'RUN') return new Promise((resolve) => { releaseNativeWrite = resolve; });
        return Promise.resolve();
      }
    }
  });
  const nativeRunning = wearable.sendCommand({ payload: 'RUN', priority: 'background' });
  while (!releaseNativeWrite) await Promise.resolve();
  await wearable.sendCommand({ payload: 'HALT', action: 'stop' });
  assert.deepEqual(nativeWrites, ['RUN', 'HALT']);
  releaseNativeWrite();
  await nativeRunning;
});

test('a stalled device command queue has a hard admission cap while STOP still bypasses it', async () => {
  let releaseActive;
  const device = new TestDevice({
    deviceId: 'bounded-queue',
    deviceType: DEVICE_TYPES.wearable,
    maxCommandQueueDepth: 3
  });
  const active = device.enqueueCommand(() => new Promise((resolve) => {
    releaseActive = resolve;
  }));
  while (!releaseActive) await Promise.resolve();
  const second = device.enqueueCommand(async () => 'second');
  const third = device.enqueueCommand(async () => 'third');

  await assert.rejects(
    device.enqueueCommand(async () => 'overflow'),
    (error) => error.code === 'DEVICE_COMMAND_QUEUE_FULL'
  );
  assert.equal(
    await device.enqueueCommand(async () => 'STOP', { priority: 'critical', bypass: true }),
    'STOP'
  );
  assert.equal(device.pendingCommands.length, 2);

  releaseActive('first');
  assert.deepEqual(await Promise.all([active, second, third]), ['first', 'second', 'third']);
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

test('robot recovery stages older durable commands before newer in-memory work', async () => {
  const durable = [];
  let sequence = 0;
  let networkAvailable = false;
  const successfulActions = [];
  const commandStore = {
    async enqueue(item) {
      const queued = { id: `ordered-${++sequence}`, command: item.command };
      durable.push(queued);
      return queued;
    },
    async load() { return [...durable]; },
    async acknowledge(id) {
      const index = durable.findIndex((entry) => entry.id === id);
      if (index >= 0) durable.splice(index, 1);
    }
  };
  const robot = new HomeRobotDevice({
    deviceId: 'robot-durable-fifo',
    accountId: 'account-a',
    gatewayURL: 'https://api.example.test',
    commandStore,
    now: () => 50_000,
    fetchImpl: async (url, options = {}) => {
      if (!networkAvailable) throw new Error('offline');
      if (url.endsWith('/health')) return gatewayTextResponse({ status: 'ok' });
      if (url.includes('/telemetry')) {
        return gatewayTextResponse({ online: true, reported_at: 50_000 });
      }
      const action = JSON.parse(options.body).action;
      successfulActions.push(action);
      return gatewayTextResponse({ accepted: true }, 202);
    }
  });

  await assert.rejects(robot.sendCommand({ action: 'older' }), /offline/);
  const newer = robot.sendCommand({ action: 'newer' });
  await Promise.resolve();
  assert.deepEqual(durable.map((entry) => entry.command.action), ['older', 'newer']);

  networkAvailable = true;
  await robot.connect();
  assert.deepEqual(await newer, { accepted: true });
  assert.deepEqual(successfulActions, ['older', 'newer']);
  assert.deepEqual(durable, []);
  robot.dispose();
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
      return new Promise((resolve) => { releaseDelivery = () => resolve(gatewayTextResponse('', 202)); });
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
    fetchImpl: async () => gatewayTextResponse({ status: 'ok' })
  });
  const status = await robot.connect();
  assert.equal(status.relayOnline, true);
  assert.equal(status.online, false);
  assert.equal(status.hardwareStatus, 'unknown');
  assert.equal(status.connectionState, 'disconnected');
  assert.equal(status.lastErrorCode, 'ROBOT_TELEMETRY_TIMESTAMP_INVALID');
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
    now: () => 1234,
    setTimeoutImpl(callback) { retry = callback; return { unref() {} }; },
    clearTimeoutImpl() {},
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) return gatewayTextResponse({ status: 'ok' });
      if (url.includes('/telemetry')) {
        return gatewayTextResponse({ online: true, location: { longitude: 103.8, latitude: 1.3 }, reported_at: 1234 });
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

test('home robot polls telemetry, validates navigation paths, and cleans up the lifecycle timer', async () => {
  let poll;
  let cleared = false;
  let telemetryReads = 0;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-path',
    gatewayURL: 'https://api.example.test',
    telemetryIntervalMs: 5000,
    now: () => 50_000,
    setIntervalImpl(callback, delay) { assert.equal(delay, 5000); poll = callback; return 'poll-1'; },
    clearIntervalImpl(timer) { assert.equal(timer, 'poll-1'); cleared = true; },
    fetchImpl: async (url) => {
      if (url.endsWith('/health')) return gatewayTextResponse({ status: 'ok' });
      telemetryReads += 1;
      return gatewayTextResponse({
          online: true,
          reported_at: 50_000,
          battery: { percentage: 81, charging: true, observed_at: 50_000 },
          indoor_position: { room_id: 'living-room', floor_id: 'floor-1', map_id: 'home-map', x_m: 3.5, y_m: 4.25, confidence: 0.96, captured_at: 50_000 },
          navigation_path: [[103.8, 1.3], { longitude: 103.81, latitude: 1.31 }, [999, 999]]
      });
    }
  });
  const status = await robot.connect();
  assert.deepEqual(status.navigationPath, [[103.8, 1.3], [103.81, 1.31]]);
  assert.deepEqual(status.indoorPosition, {
    roomId: 'living-room', floorId: 'floor-1', mapId: 'home-map', xMeters: 3.5, yMeters: 4.25, confidence: 0.96, capturedAt: 50_000
  });
  assert.equal(status.lastSeenAt, 50_000);
  assert.equal(status.battery, 81);
  assert.equal(status.batteryCharging, true);
  assert.equal(typeof poll, 'function');
  await poll();
  assert.equal(telemetryReads, 2);
  robot.dispose();
  assert.equal(cleared, true);

  const mapSource = readFileSync(path.resolve(process.cwd(), 'app/(tabs)/map.js'), 'utf8');
  assert.match(mapSource, /id="home-robot-navigation-paths"/);
  assert.match(mapSource, /geometry:\s*\{ type: 'LineString', coordinates \}/);
  assert.match(mapSource, /robotPathSourceRef\.current\?\.setNativeProps/);
});

test('home robot telemetry is single-flight, rejects older samples, and suspends polling offline', async () => {
  let resolveFirst;
  let requests = 0;
  let intervalCallback;
  let intervalCleared = false;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-ordering',
    gatewayURL: 'https://api.example.test',
    now: () => 20_000,
    setIntervalImpl(callback) { intervalCallback = callback; return 'timer'; },
    clearIntervalImpl() { intervalCleared = true; },
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return gatewayTextResponse({ online: true, reported_at: 19_000 });
    }
  });
  const first = robot.refreshTelemetry();
  const coalesced = robot.refreshTelemetry();
  while (!resolveFirst) await Promise.resolve();
  assert.equal(requests, 1);
  resolveFirst(gatewayTextResponse({ online: true, reported_at: 20_000, navigation_path: [[1, 1], [2, 2]] }));
  await Promise.all([first, coalesced]);
  const ignored = await robot.refreshTelemetry();
  assert.equal(ignored.ignored, true);
  assert.equal(robot.getStatus().lastSeenAt, 20_000);
  assert.deepEqual(robot.getStatus().navigationPath, [[1, 1], [2, 2]]);

  robot.startTelemetryPolling();
  assert.equal(typeof intervalCallback, 'function');
  const Network = {
    addNetworkStateListener(callback) { callback({ isConnected: false, isInternetReachable: false }); return { remove() {} }; },
    async getNetworkStateAsync() { return null; }
  };
  robot.loadNetwork = async () => Network;
  await robot.startNetworkMonitoring();
  assert.equal(intervalCleared, true);
  assert.equal(robot.getStatus().online, false);
  robot.dispose();
});

test('home robot keeps the relay online but rejects malformed gateway JSON', async () => {
  const robot = new HomeRobotDevice({
    deviceId: 'robot-malformed',
    gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => '{not-json'
    })
  });
  await assert.rejects(robot.request('/v1/devices/robot-malformed/telemetry'), /response is invalid/);
  assert.equal(robot.getStatus().relayOnline, true);
  assert.equal(robot.getStatus().online, false);
  assert.equal(robot.getStatus().lastErrorCode, 'ROBOT_GATEWAY_INVALID_RESPONSE');
  robot.dispose();

  const multibyte = new HomeRobotDevice({
    deviceId: 'robot-multibyte',
    gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => `{"padding":"${'😀'.repeat(300_000)}"}`
    })
  });
  await assert.rejects(multibyte.request('/v1/devices/robot-multibyte/telemetry'), /response is invalid/);
  assert.equal(multibyte.getStatus().lastErrorCode, 'ROBOT_GATEWAY_INVALID_RESPONSE');
  multibyte.dispose();

  let streamCancelled = 0;
  const streamed = new HomeRobotDevice({
    deviceId: 'robot-stream-oversize',
    gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: {
        getReader: () => ({
          async read() { return { done: false, value: new Uint8Array((1024 * 1024) + 1) }; },
          async cancel() { streamCancelled += 1; },
          releaseLock() {}
        })
      }
    })
  });
  await assert.rejects(streamed.request('/v1/devices/robot-stream-oversize/telemetry'), /response is invalid/);
  assert.equal(streamCancelled, 1);
  streamed.dispose();
});

test('home robot refuses unbounded non-stream response bodies without Content-Length', async () => {
  let bodyReads = 0;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-unbounded-text',
    gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        bodyReads += 1;
        return JSON.stringify({ status: 'ok' });
      }
    })
  });

  await assert.rejects(
    robot.request('/health'),
    (error) => error.code === 'ROBOT_GATEWAY_INVALID_RESPONSE'
  );
  assert.equal(bodyReads, 0);
  robot.dispose();
});

test('home robot cancels non-success response bodies before releasing the request', async () => {
  let cancelled = 0;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-http-error-body',
    gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      body: { async cancel() { cancelled += 1; } }
    })
  });
  await assert.rejects(robot.request('/health'), (error) => error.statusCode === 503);
  assert.equal(cancelled, 1);
  robot.dispose();
});

test('home robot cancels an unexpected body on a successful 204 response', async () => {
  let cancelled = 0;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-204-body',
    gatewayURL: 'https://api.example.test',
    fetchImpl: async () => ({
      ok: true,
      status: 204,
      body: { async cancel() { cancelled += 1; } }
    })
  });
  assert.equal(await robot.request('/v1/device-actions'), null);
  assert.equal(cancelled, 1);
  robot.dispose();
});

test('explicit robot disconnect removes recovery work, requests, and network monitoring', async () => {
  let retryCallback;
  let telemetryCallback;
  let networkCallback;
  let removed = 0;
  let clearedRetries = 0;
  let clearedTelemetry = 0;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-explicit-disconnect',
    gatewayURL: 'https://api.example.test',
    setTimeoutImpl(callback) { retryCallback = callback; return 11; },
    clearTimeoutImpl() { clearedRetries += 1; },
    setIntervalImpl(callback) { telemetryCallback = callback; return 22; },
    clearIntervalImpl() { clearedTelemetry += 1; },
    loadNetwork: async () => ({
      addNetworkStateListener(callback) {
        networkCallback = callback;
        return { remove() { removed += 1; } };
      }
    })
  });
  await robot.startNetworkMonitoring();
  robot.scheduleNetworkRetry();
  robot.startTelemetryPolling();
  const requestController = new AbortController();
  robot.activeRequestControllers.add(requestController);

  await robot.disconnect();
  assert.equal(requestController.signal.aborted, true);
  assert.equal(removed, 1);
  assert.equal(clearedRetries, 1);
  assert.equal(clearedTelemetry, 1);
  assert.equal(robot.networkSubscription, null);
  assert.equal(robot.retryTimer, null);
  assert.equal(robot.telemetryTimer, null);

  networkCallback?.({ isConnected: true, isInternetReachable: true });
  retryCallback?.();
  telemetryCallback?.();
  assert.equal(robot.getStatus().connectionState, 'disconnected');
  assert.equal(robot.retryTimer, null);
  assert.equal(robot.telemetryTimer, null);
  robot.dispose();
});

test('home robot parks queued commands after disconnect and resumes them only after health recovery', async () => {
  const requests = [];
  const robot = new HomeRobotDevice({
    deviceId: 'robot-parked-command',
    gatewayURL: 'https://api.example.test',
    now: () => 50_000,
    fetchImpl: async (url) => {
      requests.push(url);
      if (url.endsWith('/health')) {
        return gatewayTextResponse({ status: 'ok' });
      }
      if (url.includes('/telemetry')) {
        return gatewayTextResponse({ online: true, reported_at: 50_000 });
      }
      return gatewayTextResponse({ accepted: true }, 202);
    }
  });

  await robot.disconnect();
  const queued = robot.sendCommand({ action: 'check_medication', parameters: {} });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requests.length, 0);

  await robot.connect();
  assert.deepEqual(await queued, { accepted: true });
  assert.equal(requests.filter((url) => url.endsWith('/v1/device-actions')).length, 1);
  robot.dispose();
});

test('late response bodies cannot mutate a robot after disconnect or disposal', async () => {
  for (const terminate of ['disconnect', 'dispose']) {
    let releaseBody;
    let cancelledBodies = 0;
    const robot = new HomeRobotDevice({
      deviceId: `robot-late-${terminate}`,
      gatewayURL: 'https://api.example.test',
      now: () => 50_000,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => '37' },
        body: { async cancel() { cancelledBodies += 1; } },
        text: () => new Promise((resolve) => { releaseBody = resolve; })
      })
    });
    robot.setStatus({ online: true, hardwareStatus: 'online', connectionState: 'connected' });
    const telemetry = robot.refreshTelemetry();
    while (!releaseBody) await Promise.resolve();

    if (terminate === 'disconnect') await robot.disconnect();
    else robot.dispose();
    assert.equal(cancelledBodies, 1);
    releaseBody(JSON.stringify({ online: true, reported_at: 50_000 }));

    await assert.rejects(telemetry, (error) => (
      error?.code === (terminate === 'dispose' ? 'DEVICE_DISPOSED' : 'DEVICE_DISCONNECTED')
    ));
    assert.equal(robot.getStatus().connectionState, terminate === 'dispose' ? 'connected' : 'disconnected');
    assert.equal(robot.getStatus().lastSeenAt, undefined);
    robot.dispose();
  }
});

test('home robot request timeout survives fetch implementations that ignore AbortSignal', async () => {
  let requestSignal;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-timeout',
    gatewayURL: 'https://api.example.test',
    timeoutMs: 10,
    fetchImpl: async (_url, options) => {
      requestSignal = options.signal;
      return new Promise(() => {});
    }
  });

  const startedAt = Date.now();
  await assert.rejects(robot.request('/health'), (error) => {
    assert.equal(error.code, 'ROBOT_NETWORK_TIMEOUT');
    return true;
  });
  assert.equal(requestSignal.aborted, true);
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(robot.getStatus().relayOnline, false);
  robot.dispose();
});

test('home robot request timeout also bounds stalled credential retrieval', async () => {
  let fetches = 0;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-credential-timeout',
    gatewayURL: 'https://api.example.test',
    timeoutMs: 10,
    accessTokenProvider: async () => new Promise(() => {}),
    fetchImpl: async () => {
      fetches += 1;
      return { ok: true, status: 204 };
    }
  });
  await assert.rejects(robot.request('/health'), { code: 'ROBOT_NETWORK_TIMEOUT' });
  assert.equal(fetches, 0);
  robot.dispose();
});

test('home robot timeout covers a stalled response body and cancels it', async () => {
  let cancelled = 0;
  let releaseText;
  const robot = new HomeRobotDevice({
    deviceId: 'robot-body-timeout',
    gatewayURL: 'https://api.example.test',
    timeoutMs: 10,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => '2' },
      body: {
        async cancel() {
          cancelled += 1;
          releaseText?.('{}');
        }
      },
      text: () => new Promise((resolve) => { releaseText = resolve; })
    })
  });

  await assert.rejects(robot.request('/v1/devices/robot-body-timeout/telemetry'), (error) => {
    assert.equal(error.code, 'ROBOT_NETWORK_TIMEOUT');
    return true;
  });
  assert.equal(cancelled, 1);
  assert.equal(robot.getStatus().relayOnline, true);
  assert.equal(robot.getStatus().online, false);
  robot.dispose();
});

test('home robot rejects unsafe timeout configuration', () => {
  assert.throws(() => new HomeRobotDevice({
    deviceId: 'robot-bad-timeout',
    gatewayURL: 'https://api.example.test',
    timeoutMs: 0
  }), /timeout is invalid/);
});

test('home robot never treats telemetry without a valid vendor timestamp as fresh', async () => {
  const robot = new HomeRobotDevice({
    deviceId: 'robot-no-timestamp',
    gatewayURL: 'https://api.example.test',
    now: () => 50_000,
    fetchImpl: async () => gatewayTextResponse({
      online: true,
      location: { longitude: 103.8, latitude: 1.3 }
    })
  });
  const telemetry = await robot.refreshTelemetry();
  assert.equal(telemetry.invalid, true);
  assert.equal(robot.getStatus().relayOnline, true);
  assert.equal(robot.getStatus().online, false);
  assert.equal(robot.getStatus().lastSeenAt, undefined);
  assert.equal(robot.getStatus().lastErrorCode, 'ROBOT_TELEMETRY_TIMESTAMP_INVALID');
  robot.dispose();
});

test('home robot fails closed when fresh telemetry omits required online state', async () => {
  const robot = new HomeRobotDevice({
    deviceId: 'robot-missing-online',
    gatewayURL: 'https://api.example.test',
    now: () => 50_000,
    fetchImpl: async () => gatewayTextResponse({ reported_at: 50_000 })
  });
  robot.setStatus({ online: true, hardwareStatus: 'online', connectionState: 'connected' });
  const telemetry = await robot.refreshTelemetry();
  assert.equal(telemetry.invalid, true);
  assert.equal(robot.getStatus().online, false);
  assert.equal(robot.getStatus().connectionState, 'disconnected');
  assert.equal(robot.getStatus().lastErrorCode, 'ROBOT_TELEMETRY_SCHEMA_INVALID');
  assert.equal(robot.getStatus().lastSeenAt, undefined);
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

test('AppContext keeps restored wearable location, preserves multiple wearables, and starts new robot monitoring', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  assert.match(source, /location:\s*device\.location\s*\?\?\s*restoredWearable\?\.location\s*\?\?\s*null/);
  assert.match(source, /wearableEntitiesRef\.current[\s\S]*\.filter\(\(entry\) => entry\.deviceId && entry\.deviceId !== device\.id\)/);
  assert.match(source, /const primaryWearable = device\.id/);
  assert.match(source, /setStatus\(\{ \.\.\.primaryWearable/);
  assert.match(source, /filter\(\(entry\) => entry\.deviceId !== rememberedDevice\.id\)/);
  assert.match(source, /registered\.startNetworkMonitoring\?\.\(\)\.catch/);
  assert.doesNotMatch(source, /\}, \[accessToken, authLoading, user\?\.id\]\);/);
});

test('AppContext bounds registry hydration retries without accumulating uncancellable native reads', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/context/AppContext.js'), 'utf8');
  assert.match(source, /DEVICE_HYDRATION_MAX_ATTEMPTS = 3/);
  assert.match(source, /deviceHydrationRetryRef\.current\.accountId !== accountId/);
  assert.match(source, /deviceHydrationOperationRef = useRef\(null\)/);
  assert.match(source, /hydration\?\.accountId !== accountId \|\| hydration\.state === 'rejected'/);
  assert.match(source, /deviceHydrationOperationRef\.current !== hydration[\s\S]*hydration\.state !== 'pending'/);
  assert.match(source, /deviceRegistry\.clear\(\);[\s\S]*nextAttempt < DEVICE_HYDRATION_MAX_ATTEMPTS/);
  assert.match(source, /setDeviceHydrationErrorCode\([\s\S]*setDeviceEntitiesAccountId\(accountId\)/);
  assert.match(source, /deviceHydrationErrorCode/);
  assert.match(source, /deviceEntitiesAccountId !== user\.id \|\| deviceHydrationErrorCode/);
  assert.match(source, /const retryDeviceHydration = useCallback/);
  assert.match(source, /nextState === 'active'\) retryDeviceHydration\(\)/);
  const timeoutObserver = source.slice(
    source.indexOf('timeoutTimer = setTimeout'),
    source.indexOf('\n    return () => {', source.indexOf('timeoutTimer = setTimeout'))
  );
  assert.doesNotMatch(timeoutObserver, /rehydrateRegistry\(/);
  const management = readFileSync(path.resolve(process.cwd(), 'app/device-management.js'), 'utf8');
  assert.match(management, /deviceHydrationErrorCode/);
  assert.match(management, /onPress=\{retryDeviceHydration\}/);
});

test('My Devices can pair an additional wearable without replacing the primary device', () => {
  const setup = readFileSync(path.resolve('app/(auth)/jewelry-setup.js'), 'utf8');
  const management = readFileSync(path.resolve('app/device-management.js'), 'utf8');
  assert.match(setup, /mode === 'additional'/);
  assert.match(setup, /setWearableEntities\(\(current\)/);
  assert.match(management, /jewelry-setup\?mode=additional/);
});
