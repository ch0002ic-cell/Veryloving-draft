import { PermissionsAndroid, Platform } from 'react-native';
import { explainPermission } from './permissions';
import {
  getAndroidBluetoothPermissions,
  hasGrantedAndroidBluetoothPermissions
} from './ble-permissions';
import { logger } from '../utils/logger';
import { OperationTimeoutError, withTimeout } from '../utils/async';
import { translate } from '../i18n/core';
import {
  BLE_ERROR_CODES,
  BLEOperationError,
  classifyNativeBLEError,
  errorCodeForBluetoothState
} from './ble-errors';
import {
  createVL01Protocol,
  decodeVL01Battery,
  equalVL01UUID,
  validateVL01GATT
} from './vl01-protocol';
import { base64ToBytes } from '../utils/base64';
import { isExpoGoRuntime } from '../utils/runtime-environment';

const DEFAULT_SCAN_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 10000;
const GATT_OPERATION_TIMEOUT_MS = 5000;
const BLUETOOTH_STATE_TIMEOUT_MS = 3000;
const BLE_RESTORE_IDENTIFIER = 'com.veryloving.vl01.central';
const DEVELOPMENT_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;
const CONFIGURED_VL01_PROTOCOL = createVL01Protocol({
  enabled: process.env.EXPO_PUBLIC_VL01_ENABLED === 'true',
  serviceUUID: process.env.EXPO_PUBLIC_VL01_SERVICE_UUID,
  batteryCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID,
  statusCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID,
  eventCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID,
  commandCharacteristicUUID: process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID
});

const BLE_ERROR_MESSAGE_KEYS = {
  [BLE_ERROR_CODES.unavailable]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.notReady]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.poweredOff]: 'jewelry.scanFailed',
  [BLE_ERROR_CODES.permissionNotRequested]: 'permissions.bluetoothRationaleMessage',
  [BLE_ERROR_CODES.permissionDenied]: 'jewelry.permissionDenied',
  [BLE_ERROR_CODES.permissionRequestFailed]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.noDevices]: 'jewelry.noDevices',
  [BLE_ERROR_CODES.scanStartFailed]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.scanFailed]: 'jewelry.scanFailed',
  [BLE_ERROR_CODES.invalidDevice]: 'jewelry.connectFailed',
  [BLE_ERROR_CODES.connectTimeout]: 'jewelry.connectTimeout',
  [BLE_ERROR_CODES.connectFailed]: 'jewelry.connectFailed',
  [BLE_ERROR_CODES.protocolNotConfigured]: 'jewelry.connectFailed',
  [BLE_ERROR_CODES.incompatibleDevice]: 'jewelry.connectFailed',
  [BLE_ERROR_CODES.disconnectFailed]: 'jewelry.connectFailed'
};

function createBLEError(code, cause, phase) {
  if (cause instanceof BLEOperationError && cause.code === code) return cause;
  const nativeErrorCode = Number(cause?.errorCode);
  return new BLEOperationError(
    code,
    translate(BLE_ERROR_MESSAGE_KEYS[code] || 'jewelry.scanAccessFailed'),
    {
      nativeErrorCode: Number.isFinite(nativeErrorCode) ? nativeErrorCode : undefined,
      phase
    }
  );
}

function logBLEFailure(message, error, context = {}) {
  logger.error(message, {
    errorCode: error?.code || 'BLE_OPERATION_FAILED',
    nativeErrorCode: error?.nativeErrorCode ?? error?.errorCode,
    phase: error?.phase,
    ...context
  });
}

async function assertBluetoothReady(manager, phase) {
  if (!manager?.state) return;
  let state;
  try {
    state = await manager.state();
  } catch (error) {
    throw createBLEError(classifyNativeBLEError(error, phase), error, phase);
  }
  if (['Unknown', 'Resetting'].includes(state) && typeof manager.onStateChange === 'function') {
    try {
      state = await new Promise((resolve) => {
        let subscription;
        let settled = false;
        const finish = (nextState) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          subscription?.remove?.();
          resolve(nextState);
        };
        const timer = setTimeout(() => finish(state), BLUETOOTH_STATE_TIMEOUT_MS);
        subscription = manager.onStateChange((nextState) => {
          if (!['Unknown', 'Resetting'].includes(nextState)) finish(nextState);
        }, false);
      });
    } catch (error) {
      throw createBLEError(classifyNativeBLEError(error, phase), error, phase);
    }
  }
  const errorCode = errorCodeForBluetoothState(state);
  if (errorCode) throw createBLEError(errorCode, null, phase);
}

async function requestAndroidBluetoothAccess() {
  if (Platform.OS !== 'android') return true;
  const permissions = getAndroidBluetoothPermissions(Platform.Version);
  const existing = await Promise.all(
    permissions.map((permission) => PermissionsAndroid.check(permission))
  );
  if (existing.every(Boolean)) return true;
  const results = await PermissionsAndroid.requestMultiple(permissions);
  return hasGrantedAndroidBluetoothPermissions(
    results,
    permissions,
    PermissionsAndroid.RESULTS.GRANTED
  );
}

export class BLEService {
  manager = null;
  scanning = false;
  activeScan = null;
  sessions = new Map();
  eventHandler = {};
  eventHandlers = new Set();
  restoredDevices = [];

  constructor({
    protocol = CONFIGURED_VL01_PROTOCOL,
    gattOperationTimeoutMs = GATT_OPERATION_TIMEOUT_MS,
    expoGo = isExpoGoRuntime()
  } = {}) {
    this.protocol = protocol;
    this.gattOperationTimeoutMs = gattOperationTimeoutMs;
    this.expoGo = expoGo;
  }

  setEventHandler(handler) {
    this.eventHandler = handler || {};
    if (this.restoredDevices.length) this.eventHandler.onRestored?.([...this.restoredDevices]);
    return () => {
      if (this.eventHandler === handler) this.eventHandler = {};
    };
  }

  addEventHandler(handler) {
    if (!handler || typeof handler !== 'object') throw new TypeError('BLE event handler is required');
    this.eventHandlers.add(handler);
    if (this.restoredDevices.length) handler.onRestored?.([...this.restoredDevices]);
    return () => this.eventHandlers.delete(handler);
  }

  emitEvent(name, ...args) {
    this.eventHandler[name]?.(...args);
    for (const handler of this.eventHandlers) {
      try { handler[name]?.(...args); } catch (error) {
        logBLEFailure('[BLE] Event listener failed', error, { eventName: name });
      }
    }
  }

  requireProtocol() {
    if (this.protocol) return this.protocol;
    throw createBLEError(BLE_ERROR_CODES.protocolNotConfigured, null, 'protocol');
  }

  cleanupSession(deviceId) {
    const session = this.sessions.get(deviceId);
    if (!session) return;
    this.sessions.delete(deviceId);
    for (const subscription of session.subscriptions) {
      try { subscription?.remove?.(); } catch {}
    }
  }

  getManager() {
    if (this.manager !== null) return this.manager;
    if (this.expoGo) {
      logger.info('[BLE] Expo Go cannot load the VL01 native module; use a development build');
      this.manager = false;
      return this.manager;
    }
    try {
      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager({
        restoreStateIdentifier: BLE_RESTORE_IDENTIFIER,
        restoreStateFunction: (state) => {
          this.restoredDevices = Array.isArray(state?.connectedPeripherals)
            ? state.connectedPeripherals.filter((device) => device?.id)
            : [];
          if (this.restoredDevices.length) this.emitEvent('onRestored', [...this.restoredDevices]);
        }
      });
    } catch {
      logger.warn('[BLE] Native BLE unavailable', {
        developmentSimulationEnabled: DEVELOPMENT_RUNTIME
      });
      this.manager = false;
    }
    return this.manager;
  }

  async scanForDevices(onDevice, { onError, onComplete, timeoutMs = DEFAULT_SCAN_TIMEOUT_MS } = {}) {
    if (this.expoGo) {
      logger.info('[BLE] Expo Go cannot scan for VL01 devices; use a development build');
      onError?.(createBLEError(BLE_ERROR_CODES.unavailable, null, 'scan'));
      onComplete?.('unavailable');
      return () => {};
    }
    if (!await explainPermission('bluetooth')) {
      onError?.(createBLEError(BLE_ERROR_CODES.permissionNotRequested, null, 'permission'));
      onComplete?.('rationale-declined');
      return () => {};
    }
    try {
      if (!await requestAndroidBluetoothAccess()) {
        onError?.(createBLEError(BLE_ERROR_CODES.permissionDenied, null, 'permission'));
        onComplete?.('permission-declined');
        return () => {};
      }
    } catch (permissionError) {
      const error = createBLEError(BLE_ERROR_CODES.permissionRequestFailed, permissionError, 'permission');
      logBLEFailure('[BLE] Permission request failed', error);
      onError?.(error);
      onComplete?.('permission-error');
      return () => {};
    }

    this.stopScan('restarted');
    const manager = this.getManager();
    if (manager && Platform.OS !== 'web') {
      try {
        await assertBluetoothReady(manager, 'scan');
      } catch (error) {
        logBLEFailure('[BLE] Scan blocked by Bluetooth state', error);
        onError?.(error);
        onComplete?.('bluetooth-unavailable');
        return () => {};
      }
    }
    const operation = {
      stopped: false,
      manager,
      retryCount: 0,
      retryTimer: null,
      timeoutTimer: null,
      simulationTimer: null,
      matchedDeviceCount: 0,
      finish: null
    };
    operation.finish = (reason = 'cancelled', error = null) => {
      if (operation.stopped) return;
      operation.stopped = true;
      clearTimeout(operation.retryTimer);
      clearTimeout(operation.timeoutTimer);
      clearTimeout(operation.simulationTimer);
      try { operation.manager?.stopDeviceScan?.(); } catch {}
      if (this.activeScan === operation) {
        this.activeScan = null;
        this.scanning = false;
      }
      if (error) onError?.(error);
      onComplete?.(reason);
    };

    this.activeScan = operation;
    this.scanning = true;
    operation.timeoutTimer = setTimeout(() => {
      if (operation.matchedDeviceCount === 0) {
        operation.finish('no-devices', createBLEError(BLE_ERROR_CODES.noDevices, null, 'scan'));
        return;
      }
      operation.finish('timeout');
    }, timeoutMs);

    if (!manager || Platform.OS === 'web') {
      if (!DEVELOPMENT_RUNTIME || this.expoGo) {
        operation.finish('unavailable', createBLEError(BLE_ERROR_CODES.unavailable, null, 'scan'));
        return () => {};
      }
      operation.simulationTimer = setTimeout(() => {
        if (operation.stopped) return;
        operation.matchedDeviceCount += 1;
        onDevice?.({ id: 'VL01-DEMO', name: 'NorthStar VL01', rssi: -48, simulated: true });
        operation.finish('complete');
      }, 500);
      return () => operation.finish('cancelled');
    }

    let protocol;
    try {
      protocol = this.requireProtocol();
    } catch (error) {
      operation.finish('protocol-unavailable', error);
      return () => {};
    }

    const startScan = () => {
      if (operation.stopped || this.activeScan !== operation) return;
      try {
        manager.startDeviceScan([protocol.serviceUUID], null, (scanError, device) => {
          if (operation.stopped || this.activeScan !== operation) return;
          if (scanError) {
            const errorCode = classifyNativeBLEError(scanError, 'scan');
            const error = createBLEError(errorCode, scanError, 'scan');
            logBLEFailure('[BLE] Scan error', error, { retryCount: operation.retryCount });
            try { manager.stopDeviceScan(); } catch {}
            const stateFailure = [
              BLE_ERROR_CODES.poweredOff,
              BLE_ERROR_CODES.permissionDenied,
              BLE_ERROR_CODES.unavailable
            ].includes(error.code);
            if (!stateFailure && operation.retryCount < 2) {
              operation.retryCount += 1;
              operation.retryTimer = setTimeout(startScan, 1000 * operation.retryCount);
            } else {
              operation.finish('error', error);
            }
            return;
          }
          if (device?.id) {
            operation.matchedDeviceCount += 1;
            onDevice?.(device);
          }
        });
      } catch (scanError) {
        const classifiedCode = classifyNativeBLEError(scanError, 'scan');
        const errorCode = classifiedCode === BLE_ERROR_CODES.scanFailed
          ? BLE_ERROR_CODES.scanStartFailed
          : classifiedCode;
        const error = createBLEError(errorCode, scanError, 'scan');
        logBLEFailure('[BLE] Unable to start scan', error);
        operation.finish('error', error);
      }
    };
    startScan();
    return () => operation.finish('cancelled');
  }

  stopScan(reason = 'cancelled') {
    if (this.activeScan) {
      this.activeScan.finish(reason);
      return;
    }
    try { this.manager?.stopDeviceScan?.(); } catch {}
    this.scanning = false;
  }

  async connect(device, { allowSimulation = true } = {}) {
    if (!device?.id) throw createBLEError(BLE_ERROR_CODES.invalidDevice, null, 'connect');
    const manager = this.getManager();
    if (!manager || Platform.OS === 'web') {
      if (!allowSimulation || !DEVELOPMENT_RUNTIME || this.expoGo) {
        throw createBLEError(BLE_ERROR_CODES.unavailable, null, 'connect');
      }
      return {
        id: device.id,
        name: device.name || 'NorthStar VL01',
        battery: null,
        connected: true,
        connectionState: 'connected',
        autoReconnect: false,
        simulated: true
      };
    }
    const protocol = this.requireProtocol();
    try {
      await assertBluetoothReady(manager, 'connect');
      const connection = await withTimeout((async () => {
        const candidate = typeof device.connect === 'function'
          ? await device.connect()
          : await manager.connectToDevice(device.id);
        await candidate.discoverAllServicesAndCharacteristics();
        const services = await candidate.services();
        const characteristics = await candidate.characteristicsForService(protocol.serviceUUID);
        validateVL01GATT(services, characteristics, protocol);
        return { device: candidate, characteristics };
      })(), CONNECT_TIMEOUT_MS, translate('jewelry.connectTimeout'));
      const connected = connection.device;
      const batteryCharacteristic = await withTimeout(
        connected.readCharacteristicForService(
          protocol.serviceUUID,
          protocol.batteryCharacteristicUUID
        ),
        this.gattOperationTimeoutMs,
        translate('jewelry.connectTimeout')
      );
      const battery = decodeVL01Battery(batteryCharacteristic?.value);
      this.cleanupSession(connected.id);
      const subscriptions = [];
      const session = {
        device: connected,
        subscriptions,
        failed: false,
        failure: null
      };
      // Register the provisional session before installing native callbacks.
      // Some BLE implementations can report an error synchronously while a
      // monitor is being attached; cleanup must be able to find that session.
      this.sessions.set(connected.id, session);
      const addSubscription = (subscription) => {
        if (!subscription) return;
        if (session.failed || this.sessions.get(connected.id) !== session) {
          try { subscription.remove?.(); } catch {}
          return;
        }
        subscriptions.push(subscription);
      };
      const degrade = (monitorError, eventName) => {
        if (session.failed) return;
        session.failed = true;
        session.failure = monitorError || new Error(`VL01 ${eventName} channel disconnected.`);
        logBLEFailure(`[BLE] ${eventName} monitor failed`, session.failure, { hasDeviceId: true });
        this.cleanupSession(connected.id);
        this.emitEvent('onConnectionDegraded', connected.id, session.failure, eventName);
        Promise.resolve(manager.cancelDeviceConnection?.(connected.id)).catch(() => {});
      };
      const monitor = (characteristicUUID, eventName) => {
        if (!characteristicUUID || typeof connected.monitorCharacteristicForService !== 'function') return;
        addSubscription(connected.monitorCharacteristicForService(
          protocol.serviceUUID,
          characteristicUUID,
          (monitorError, characteristic) => {
            if (monitorError) {
              degrade(monitorError, eventName);
              return;
            }
            this.emitEvent(eventName, connected.id, characteristic?.value || null);
          }
        ));
      };
      const batteryDefinition = connection.characteristics.find(
        (characteristic) => equalVL01UUID(characteristic.uuid, protocol.batteryCharacteristicUUID)
      );
      const batterySupportsNotifications = batteryDefinition?.isNotifiable === true
        || batteryDefinition?.isIndicatable === true;
      if (batterySupportsNotifications && typeof connected.monitorCharacteristicForService === 'function') {
        addSubscription(connected.monitorCharacteristicForService(
          protocol.serviceUUID,
          protocol.batteryCharacteristicUUID,
          (monitorError, characteristic) => {
            if (monitorError) {
              degrade(monitorError, 'battery');
              return;
            }
            try {
              this.emitEvent('onBattery', connected.id, decodeVL01Battery(characteristic?.value));
            } catch (error) {
              logBLEFailure('[BLE] Ignored invalid battery notification', error, { hasDeviceId: true });
            }
          }
        ));
      }
      monitor(protocol.statusCharacteristicUUID, 'onStatus');
      monitor(protocol.eventCharacteristicUUID, 'onEvent');

      const statusDefinition = connection.characteristics.find(
        (characteristic) => equalVL01UUID(characteristic.uuid, protocol.statusCharacteristicUUID)
      );
      if (protocol.statusCharacteristicUUID && statusDefinition?.isReadable === true) {
        try {
          const status = await withTimeout(
            connected.readCharacteristicForService(protocol.serviceUUID, protocol.statusCharacteristicUUID),
            this.gattOperationTimeoutMs,
            translate('jewelry.connectTimeout')
          );
          this.emitEvent('onStatus', connected.id, status?.value || null);
        } catch (statusError) {
          logBLEFailure('[BLE] Initial status read failed', statusError, { hasDeviceId: true });
        }
      }
      if (typeof manager.onDeviceDisconnected === 'function') {
        addSubscription(manager.onDeviceDisconnected(connected.id, (disconnectError) => {
          session.failed = true;
          session.failure = disconnectError || new Error('VL01 disconnected.');
          this.cleanupSession(connected.id);
          this.emitEvent('onDisconnected', connected.id, disconnectError || null);
        }));
      }
      if (session.failed || this.sessions.get(connected.id) !== session) {
        throw session.failure || new Error('VL01 disconnected during setup.');
      }
      return {
        id: connected.id,
        name: connected.name || device.name || 'NorthStar VL01',
        battery,
        connected: true,
        connectionState: 'connected',
        autoReconnect: true,
        simulated: false
      };
    } catch (error) {
      this.cleanupSession(device.id);
      try {
        if (typeof device.cancelConnection === 'function') await device.cancelConnection();
        else await manager.cancelDeviceConnection?.(device.id);
      } catch {}
      const protocolFailure = /VL01|characteristic|service|battery/i.test(error?.message || '');
      const errorCode = error instanceof OperationTimeoutError
        ? BLE_ERROR_CODES.connectTimeout
        : protocolFailure
          ? BLE_ERROR_CODES.incompatibleDevice
        : classifyNativeBLEError(error, 'connect');
      const typedError = createBLEError(errorCode, error, 'connect');
      logBLEFailure('[BLE] Connection failed', typedError, { hasDeviceId: true });
      throw typedError;
    }
  }

  async reconnect(device) {
    return this.reconnectWithBackoff(device);
  }

  async writeCommand(deviceId, base64Value, { withResponse = true } = {}) {
    const protocol = this.requireProtocol();
    if (!protocol.commandCharacteristicUUID) {
      throw createBLEError(BLE_ERROR_CODES.protocolNotConfigured, null, 'write');
    }
    if (typeof base64Value !== 'string' || !base64Value || base64Value.length > 1024) {
      throw createBLEError(BLE_ERROR_CODES.incompatibleDevice, null, 'write');
    }
    try {
      const decoded = base64ToBytes(base64Value);
      if (!decoded.length || decoded.length > 512) throw new Error('VL01 command payload is invalid.');
    } catch (error) {
      throw createBLEError(BLE_ERROR_CODES.incompatibleDevice, error, 'write');
    }
    const session = this.sessions.get(deviceId);
    const connected = session?.device;
    if (!connected) throw createBLEError(BLE_ERROR_CODES.connectFailed, null, 'write');
    const method = withResponse
      ? connected.writeCharacteristicWithResponseForService
      : connected.writeCharacteristicWithoutResponseForService;
    if (typeof method !== 'function') {
      throw createBLEError(BLE_ERROR_CODES.incompatibleDevice, null, 'write');
    }
    try {
      await withTimeout(
        method.call(
          connected,
          protocol.serviceUUID,
          protocol.commandCharacteristicUUID,
          base64Value
        ),
        this.gattOperationTimeoutMs,
        translate('jewelry.connectTimeout')
      );
      return true;
    } catch (error) {
      const code = error instanceof OperationTimeoutError
        ? BLE_ERROR_CODES.connectTimeout
        : classifyNativeBLEError(error, 'write');
      const typedError = createBLEError(code, error, 'write');
      logBLEFailure('[BLE] GATT command write failed', typedError, { hasDeviceId: true });
      throw typedError;
    }
  }

  async reconnectWithBackoff(device, { attempts = 4, baseDelayMs = 1000, sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)) } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await this.connect(device, { allowSimulation: false });
      } catch (error) {
        lastError = error;
        const terminal = [
          BLE_ERROR_CODES.permissionDenied,
          BLE_ERROR_CODES.poweredOff,
          BLE_ERROR_CODES.unavailable,
          BLE_ERROR_CODES.protocolNotConfigured,
          BLE_ERROR_CODES.incompatibleDevice
        ].includes(error?.code);
        if (terminal || attempt === attempts - 1) break;
        await sleep(baseDelayMs * Math.pow(2, attempt));
      }
    }
    throw lastError || createBLEError(BLE_ERROR_CODES.connectFailed, null, 'reconnect');
  }

  async disconnect(deviceId) {
    if (!deviceId) return;
    this.cleanupSession(deviceId);
    const manager = this.getManager();
    if (!manager || Platform.OS === 'web') return;
    try {
      await manager.cancelDeviceConnection(deviceId);
    } catch (error) {
      // A device that is already disconnected has reached the requested state.
      if (Number(error?.errorCode) === 205) return;
      const typedError = createBLEError(classifyNativeBLEError(error, 'disconnect'), error, 'disconnect');
      logBLEFailure('[BLE] Disconnect failed', typedError, { hasDeviceId: true });
      throw typedError;
    }
  }
}

export const bleService = new BLEService();
