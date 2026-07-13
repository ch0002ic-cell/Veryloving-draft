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

const DEFAULT_SCAN_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 10000;
const BLUETOOTH_STATE_TIMEOUT_MS = 3000;
const DEVELOPMENT_RUNTIME = typeof __DEV__ !== 'undefined' && __DEV__;

const BLE_ERROR_MESSAGE_KEYS = {
  [BLE_ERROR_CODES.unavailable]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.notReady]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.poweredOff]: 'jewelry.scanFailed',
  [BLE_ERROR_CODES.permissionDenied]: 'jewelry.permissionDenied',
  [BLE_ERROR_CODES.permissionRequestFailed]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.noDevices]: 'jewelry.noDevices',
  [BLE_ERROR_CODES.scanStartFailed]: 'jewelry.scanAccessFailed',
  [BLE_ERROR_CODES.scanFailed]: 'jewelry.scanFailed',
  [BLE_ERROR_CODES.invalidDevice]: 'jewelry.connectFailed',
  [BLE_ERROR_CODES.connectTimeout]: 'jewelry.connectTimeout',
  [BLE_ERROR_CODES.connectFailed]: 'jewelry.connectFailed',
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

function isNorthStarDevice(device) {
  const advertisedName = `${device?.name || ''} ${device?.localName || ''}`.toLowerCase();
  return advertisedName.includes('northstar') || advertisedName.includes('vl01');
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

  getManager() {
    if (this.manager !== null) return this.manager;
    try {
      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager();
    } catch {
      logger.warn('[BLE] Native BLE unavailable', {
        developmentSimulationEnabled: DEVELOPMENT_RUNTIME
      });
      this.manager = false;
    }
    return this.manager;
  }

  async scanForDevices(onDevice, { onError, onComplete, timeoutMs = DEFAULT_SCAN_TIMEOUT_MS } = {}) {
    if (!await explainPermission('bluetooth')) {
      onError?.(createBLEError(BLE_ERROR_CODES.permissionDenied, null, 'permission'));
      onComplete?.('permission-declined');
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
      if (!DEVELOPMENT_RUNTIME) {
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

    const startScan = () => {
      if (operation.stopped || this.activeScan !== operation) return;
      try {
        manager.startDeviceScan(null, null, (scanError, device) => {
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
          if (isNorthStarDevice(device)) {
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
      if (!allowSimulation || !DEVELOPMENT_RUNTIME) {
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
    try {
      await assertBluetoothReady(manager, 'connect');
      const connected = await withTimeout((async () => {
        const candidate = typeof device.connect === 'function'
          ? await device.connect()
          : await manager.connectToDevice(device.id);
        await candidate.discoverAllServicesAndCharacteristics();
        return candidate;
      })(), CONNECT_TIMEOUT_MS, translate('jewelry.connectTimeout'));
      return {
        id: connected.id,
        name: connected.name || device.name || 'NorthStar VL01',
        battery: null,
        connected: true,
        connectionState: 'connected',
        autoReconnect: true,
        simulated: false
      };
    } catch (error) {
      try {
        if (typeof device.cancelConnection === 'function') await device.cancelConnection();
        else await manager.cancelDeviceConnection?.(device.id);
      } catch {}
      const errorCode = error instanceof OperationTimeoutError
        ? BLE_ERROR_CODES.connectTimeout
        : classifyNativeBLEError(error, 'connect');
      const typedError = createBLEError(errorCode, error, 'connect');
      logBLEFailure('[BLE] Connection failed', typedError, { hasDeviceId: true });
      throw typedError;
    }
  }

  async reconnect(device) {
    return this.connect(device, { allowSimulation: false });
  }

  async disconnect(deviceId) {
    if (!deviceId) return;
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
