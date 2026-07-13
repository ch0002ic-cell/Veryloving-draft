'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');
const {
  BLE_ERROR_CODES,
  BLEOperationError,
  classifyNativeBLEError,
  errorCodeForBluetoothState
} = require('../src/services/ble-errors');
const {
  loadPairedDevice,
  PAIRED_DEVICE_KEY,
  persistPairedDevice,
  DEFAULT_DEVICE
} = require('../src/services/paired-device-store');
const { forgetPairedDevice } = require('../src/services/paired-device-removal');
const { storage } = require('../src/services/storage');
const {
  createVL01Protocol,
  decodeVL01Battery,
  validateVL01GATT
} = require('../src/services/vl01-protocol');

const TEST_PROTOCOL = createVL01Protocol({
  enabled: true,
  serviceUUID: 'fff0',
  batteryCharacteristicUUID: 'fff1'
});
const TEST_FULL_PROTOCOL = createVL01Protocol({
  enabled: true,
  serviceUUID: 'fff0',
  batteryCharacteristicUUID: 'fff1',
  statusCharacteristicUUID: 'fff2',
  eventCharacteristicUUID: 'fff3',
  commandCharacteristicUUID: 'fff4'
});

let permissionGranted = true;
const originalModuleLoad = Module._load;
Module._load = function loadBLETestDependency(request, parent, isMain) {
  const isBLEService = parent?.filename.endsWith('/src/services/ble.js');
  if (isBLEService && request === 'react-native') {
    return {
      PermissionsAndroid: {},
      Platform: { OS: 'ios', Version: '17' }
    };
  }
  if (isBLEService && request === './permissions') {
    return { explainPermission: async () => permissionGranted };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { BLEService } = require('../src/services/ble');
Module._load = originalModuleLoad;

const memory = new Map();
storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
storage.setJSON = async (key, value) => memory.set(key, structuredClone(value));
storage.remove = async (key) => memory.delete(key);

test('BLE state and native failures map to stable actionable codes', () => {
  assert.equal(errorCodeForBluetoothState('PoweredOn'), null);
  assert.equal(errorCodeForBluetoothState('PoweredOff'), BLE_ERROR_CODES.poweredOff);
  assert.equal(errorCodeForBluetoothState('Unauthorized'), BLE_ERROR_CODES.permissionDenied);
  assert.equal(classifyNativeBLEError({ errorCode: 102 }), BLE_ERROR_CODES.poweredOff);
  assert.equal(classifyNativeBLEError({ errorCode: 200 }, 'connect'), BLE_ERROR_CODES.connectFailed);
});

test('paired device persistence strips native data and hydrates as reconnecting', async () => {
  memory.clear();
  await persistPairedDevice({
    accountId: 'google:account-a',
    id: 'VL01-private-id',
    name: 'NorthStar VL01',
    battery: 82,
    connected: true,
    connectionState: 'connected',
    autoReconnect: true,
    connect() {}
  });

  const stored = memory.get(PAIRED_DEVICE_KEY);
  assert.equal(stored.battery, null);
  assert.equal(stored.connect, undefined);
  assert.equal(stored.connected, true);

  const restored = await loadPairedDevice('google:account-a');
  assert.equal(restored.accountId, 'google:account-a');
  assert.equal(restored.id, 'VL01-private-id');
  assert.equal(restored.connected, false);
  assert.equal(restored.connectionState, 'reconnecting');
  assert.equal(restored.autoReconnect, true);
});

test('an explicit disconnect remains disconnected after hydration', async () => {
  memory.clear();
  await persistPairedDevice({
    accountId: 'google:account-a',
    id: 'VL01-user-disconnected',
    name: 'NorthStar VL01',
    connected: false,
    connectionState: 'disconnected',
    autoReconnect: false
  });
  const restored = await loadPairedDevice('google:account-a');
  assert.equal(restored.connectionState, 'disconnected');
  assert.equal(restored.autoReconnect, false);
});

test('removing a paired device clears its identifier and disables hydration reconnect', async () => {
  memory.clear();
  await persistPairedDevice({
    accountId: 'google:account-a',
    id: 'VL01-remove-me',
    name: 'NorthStar VL01',
    connected: true,
    connectionState: 'connected',
    autoReconnect: true
  });

  await persistPairedDevice(DEFAULT_DEVICE);

  assert.equal(memory.has(PAIRED_DEVICE_KEY), false);
  assert.deepEqual(await loadPairedDevice('google:account-a'), { ...DEFAULT_DEVICE });
});

test('paired device metadata is visible only to its owning account', async () => {
  memory.clear();
  await persistPairedDevice({
    accountId: 'apple:owner',
    id: 'VL01-owned',
    connected: false,
    connectionState: 'disconnected',
    autoReconnect: true
  });
  assert.equal((await loadPairedDevice('apple:owner')).id, 'VL01-owned');
  assert.deepEqual(await loadPairedDevice('google:other'), { ...DEFAULT_DEVICE });
});

test('device removal clears remembered state before best-effort native disconnect', async () => {
  const operations = [];
  const result = await forgetPairedDevice(
    { id: ' VL01-remove-order ' },
    {
      clearRememberedDevice: async () => operations.push('clear'),
      disconnectNativeDevice: async (deviceId) => operations.push(`disconnect:${deviceId}`)
    }
  );

  assert.deepEqual(operations, ['clear', 'disconnect:VL01-remove-order']);
  assert.equal(result.removed, true);
  assert.equal(result.nativeDisconnected, true);
});

test('native disconnect failure does not restore removed device metadata', async () => {
  const nativeFailure = new Error('native disconnect failed');
  let cleared = false;
  const result = await forgetPairedDevice(
    { id: 'VL01-best-effort' },
    {
      clearRememberedDevice: async () => { cleared = true; },
      disconnectNativeDevice: async () => { throw nativeFailure; }
    }
  );

  assert.equal(cleared, true);
  assert.equal(result.removed, true);
  assert.equal(result.nativeDisconnected, false);
  assert.equal(result.disconnectError, nativeFailure);
});

test('device removal reports storage failure without pretending the device was forgotten', async () => {
  const storageFailure = new Error('storage unavailable');
  let disconnectCalled = false;

  await assert.rejects(
    forgetPairedDevice(
      { id: 'VL01-still-remembered' },
      {
        clearRememberedDevice: async () => { throw storageFailure; },
        disconnectNativeDevice: async () => { disconnectCalled = true; }
      }
    ),
    storageFailure
  );

  assert.equal(disconnectCalled, false);
});

test('scan reports Bluetooth off with a typed error', async () => {
  permissionGranted = true;
  const service = new BLEService();
  service.manager = { state: async () => 'PoweredOff' };
  let receivedError;
  let completion;

  await service.scanForDevices(() => {}, {
    onError: (error) => { receivedError = error; },
    onComplete: (reason) => { completion = reason; }
  });

  assert.ok(receivedError instanceof BLEOperationError);
  assert.equal(receivedError.code, BLE_ERROR_CODES.poweredOff);
  assert.equal(completion, 'bluetooth-unavailable');
});

test('declined Bluetooth permission reports a typed denial', async () => {
  permissionGranted = false;
  const service = new BLEService();
  let receivedError;
  let completion;
  await service.scanForDevices(() => {}, {
    onError: (error) => { receivedError = error; },
    onComplete: (reason) => { completion = reason; }
  });
  assert.equal(receivedError.code, BLE_ERROR_CODES.permissionDenied);
  assert.equal(completion, 'permission-declined');
});

test('Expo Go BLE fails closed before requesting permissions or loading native code', async () => {
  permissionGranted = false;
  const service = new BLEService({ protocol: TEST_PROTOCOL, expoGo: true });
  let receivedError;
  let completion;
  await service.scanForDevices(() => {}, {
    onError: (error) => { receivedError = error; },
    onComplete: (reason) => { completion = reason; }
  });

  assert.equal(receivedError.code, BLE_ERROR_CODES.unavailable);
  assert.equal(completion, 'unavailable');
  await assert.rejects(
    service.connect({ id: 'VL01-expo-go' }),
    (error) => error.code === BLE_ERROR_CODES.unavailable
  );
});

test('scan timeout reports no matching devices instead of silent success', async () => {
  permissionGranted = true;
  const service = new BLEService({ protocol: TEST_PROTOCOL });
  let scannedServices;
  service.manager = {
    state: async () => 'PoweredOn',
    startDeviceScan(services) { scannedServices = services; },
    stopDeviceScan() {}
  };
  let receivedError;
  const completion = await new Promise((resolve, reject) => {
    service.scanForDevices(() => {}, {
      timeoutMs: 5,
      onError: (error) => { receivedError = error; },
      onComplete: resolve
    }).catch(reject);
  });

  assert.equal(completion, 'no-devices');
  assert.equal(receivedError.code, BLE_ERROR_CODES.noDevices);
  assert.equal(service.scanning, false);
  assert.deepEqual(scannedServices, ['fff0']);
});

test('connect failures retain a typed code and never invent battery data', async () => {
  permissionGranted = true;
  const service = new BLEService({ protocol: TEST_PROTOCOL });
  service.manager = {
    state: async () => 'PoweredOn',
    connectToDevice: async () => { throw { errorCode: 200 }; },
    cancelDeviceConnection: async () => {}
  };

  await assert.rejects(
    service.connect({ id: 'VL01-failure', name: 'NorthStar VL01' }),
    (error) => error instanceof BLEOperationError && error.code === BLE_ERROR_CODES.connectFailed
  );

  service.manager.connectToDevice = async () => ({
    id: 'VL01-success',
    name: 'NorthStar VL01',
    async discoverAllServicesAndCharacteristics() { return this; },
    async services() { return [{ uuid: 'fff0' }]; },
    async characteristicsForService() { return [{ uuid: 'fff1' }]; },
    async readCharacteristicForService() { return { value: 'Ug==' }; },
    monitorCharacteristicForService() { return { remove() {} }; }
  });
  const connected = await service.connect({ id: 'VL01-success', name: 'NorthStar VL01' });
  assert.equal(connected.connected, true);
  assert.equal(connected.battery, 82);
});

test('production BLE fails closed without the approved VL01 GATT registry', async () => {
  const service = new BLEService({ protocol: null });
  service.manager = { state: async () => 'PoweredOn' };
  await assert.rejects(
    service.connect({ id: 'named-spoof', name: 'NorthStar VL01' }),
    (error) => error.code === BLE_ERROR_CODES.protocolNotConfigured
  );
});

test('VL01 battery and GATT validation reject malformed or incompatible devices', () => {
  const originalAtob = globalThis.atob;
  try {
    globalThis.atob = undefined;
    assert.equal(decodeVL01Battery('ZA=='), 100);
  } finally {
    globalThis.atob = originalAtob;
  }
  assert.throws(() => decodeVL01Battery('/w=='), /out of range/);
  assert.equal(validateVL01GATT(
    [{ uuid: 'fff0' }],
    [{ uuid: 'fff1' }],
    TEST_PROTOCOL
  ), true);
  assert.throws(() => validateVL01GATT([{ uuid: 'fff0' }], [], TEST_PROTOCOL), /battery characteristic/);
  assert.equal(validateVL01GATT(
    [{ uuid: '0000fff0-0000-1000-8000-00805f9b34fb' }],
    [{ uuid: '0000fff1-0000-1000-8000-00805f9b34fb', isReadable: true }],
    TEST_PROTOCOL
  ), true);
  assert.equal(createVL01Protocol({
    enabled: true,
    serviceUUID: 'fff0',
    batteryCharacteristicUUID: 'fff1',
    statusCharacteristicUUID: 'not-a-uuid'
  }), null);

  const vendorProtocol = createVL01Protocol({
    enabled: true,
    serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    batteryCharacteristicUUID: '12345678'
  });
  assert.ok(vendorProtocol, 'vendor UUIDs must not be constrained by RFC-4122 version bits');
  assert.equal(validateVL01GATT(
    [{ uuid: vendorProtocol.serviceUUID }],
    [{ uuid: '12345678-0000-1000-8000-00805f9b34fb', isReadable: true }],
    vendorProtocol
  ), true);
});

test('BLE subscribes to approved battery, status, and event characteristics and surfaces degradation', async () => {
  const callbacks = new Map();
  let disconnectCallback;
  let cancelledDeviceId = null;
  let commandWrite = null;
  const service = new BLEService({ protocol: TEST_FULL_PROTOCOL });
  const received = { batteries: [], statuses: [], events: [], degraded: [] };
  service.setEventHandler({
    onBattery: (_id, value) => received.batteries.push(value),
    onStatus: (_id, value) => received.statuses.push(value),
    onEvent: (_id, value) => received.events.push(value),
    onConnectionDegraded: (_id, error, source) => received.degraded.push({ error, source })
  });
  const connectedDevice = {
    id: 'VL01-gatt',
    name: 'NorthStar VL01',
    async discoverAllServicesAndCharacteristics() { return this; },
    async services() { return [{ uuid: 'fff0' }]; },
    async characteristicsForService() {
      return [
        { uuid: 'fff1', isReadable: true, isNotifiable: true },
        { uuid: 'fff2', isReadable: false, isNotifiable: true },
        { uuid: 'fff3', isReadable: false, isNotifiable: true },
        { uuid: 'fff4', isWritableWithResponse: true }
      ];
    },
    async readCharacteristicForService(_service, characteristic) {
      assert.equal(characteristic, 'fff1');
      return { value: 'Ug==' };
    },
    monitorCharacteristicForService(_service, characteristic, callback) {
      callbacks.set(characteristic, callback);
      return { remove() {} };
    },
    async writeCharacteristicWithResponseForService(serviceUUID, characteristicUUID, value) {
      commandWrite = { serviceUUID, characteristicUUID, value };
    }
  };
  service.manager = {
    state: async () => 'PoweredOn',
    connectToDevice: async () => connectedDevice,
    onDeviceDisconnected(_id, callback) {
      disconnectCallback = callback;
      return { remove() {} };
    },
    async cancelDeviceConnection(id) { cancelledDeviceId = id; }
  };
  const connected = await service.connect({ id: connectedDevice.id });
  assert.equal(connected.battery, 82);
  callbacks.get('fff1')(null, { value: 'ZA==' });
  callbacks.get('fff2')(null, { value: 'AQ==' });
  callbacks.get('fff3')(null, { value: 'Ag==' });
  assert.deepEqual(received.batteries, [100]);
  assert.deepEqual(received.statuses, ['AQ==']);
  assert.deepEqual(received.events, ['Ag==']);
  assert.equal(await service.writeCommand(connectedDevice.id, 'AQ=='), true);
  assert.deepEqual(commandWrite, {
    serviceUUID: 'fff0',
    characteristicUUID: 'fff4',
    value: 'AQ=='
  });

  const monitorError = { errorCode: 201 };
  callbacks.get('fff2')(monitorError);
  await Promise.resolve();
  assert.equal(received.degraded[0].source, 'onStatus');
  assert.equal(cancelledDeviceId, connectedDevice.id);
  disconnectCallback?.(null);
});

test('a hanging battery read times out and cancels the partial native connection', async () => {
  let cancelled = false;
  const service = new BLEService({ protocol: TEST_PROTOCOL, gattOperationTimeoutMs: 5 });
  const connectedDevice = {
    id: 'VL01-hanging-read',
    async discoverAllServicesAndCharacteristics() { return this; },
    async services() { return [{ uuid: 'fff0' }]; },
    async characteristicsForService() { return [{ uuid: 'fff1', isReadable: true }]; },
    async readCharacteristicForService() { return new Promise(() => {}); }
  };
  service.manager = {
    state: async () => 'PoweredOn',
    connectToDevice: async () => connectedDevice,
    async cancelDeviceConnection() { cancelled = true; }
  };
  await assert.rejects(
    service.connect({ id: connectedDevice.id }),
    (error) => error.code === BLE_ERROR_CODES.connectTimeout
  );
  assert.equal(cancelled, true);
});

test('BLE reconnect uses bounded exponential attempts and stops on success', async () => {
  const service = new BLEService({ protocol: TEST_PROTOCOL });
  let attempts = 0;
  const delays = [];
  service.connect = async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new BLEOperationError(BLE_ERROR_CODES.connectFailed, 'retry');
      throw error;
    }
    return { id: 'VL01-reconnected', connected: true };
  };
  const connected = await service.reconnectWithBackoff(
    { id: 'VL01-reconnected' },
    { attempts: 4, baseDelayMs: 10, sleep: async (delay) => delays.push(delay) }
  );
  assert.equal(connected.connected, true);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [10, 20]);
});
