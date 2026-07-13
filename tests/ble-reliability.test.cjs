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
  persistPairedDevice
} = require('../src/services/paired-device-store');
const { storage } = require('../src/services/storage');

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

  const restored = await loadPairedDevice();
  assert.equal(restored.id, 'VL01-private-id');
  assert.equal(restored.connected, false);
  assert.equal(restored.connectionState, 'reconnecting');
  assert.equal(restored.autoReconnect, true);
});

test('an explicit disconnect remains disconnected after hydration', async () => {
  memory.clear();
  await persistPairedDevice({
    id: 'VL01-user-disconnected',
    name: 'NorthStar VL01',
    connected: false,
    connectionState: 'disconnected',
    autoReconnect: false
  });
  const restored = await loadPairedDevice();
  assert.equal(restored.connectionState, 'disconnected');
  assert.equal(restored.autoReconnect, false);
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

test('scan timeout reports no matching devices instead of silent success', async () => {
  permissionGranted = true;
  const service = new BLEService();
  service.manager = {
    state: async () => 'PoweredOn',
    startDeviceScan() {},
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
});

test('connect failures retain a typed code and never invent battery data', async () => {
  permissionGranted = true;
  const service = new BLEService();
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
    async discoverAllServicesAndCharacteristics() { return this; }
  });
  const connected = await service.connect({ id: 'VL01-success', name: 'NorthStar VL01' });
  assert.equal(connected.connected, true);
  assert.equal(connected.battery, null);
});
