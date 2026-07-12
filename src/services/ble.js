import { Platform } from 'react-native';
import { explainPermission } from './permissions';
import { logger } from '../utils/logger';
import { OperationTimeoutError, withTimeout } from '../utils/async';
import { translate } from '../i18n/core';

const DEFAULT_SCAN_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 10000;

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
      logger.warn('[BLE] Native BLE unavailable; using simulated device list. Use a development build for real pairing.');
      this.manager = false;
    }
    return this.manager;
  }

  async scanForDevices(onDevice, { onError, onComplete, timeoutMs = DEFAULT_SCAN_TIMEOUT_MS } = {}) {
    if (!await explainPermission('bluetooth')) {
      onComplete?.('permission-declined');
      return () => {};
    }

    this.stopScan('restarted');
    const manager = this.getManager();
    const operation = {
      stopped: false,
      manager,
      retryCount: 0,
      retryTimer: null,
      timeoutTimer: null,
      simulationTimer: null,
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
    operation.timeoutTimer = setTimeout(() => operation.finish('timeout'), timeoutMs);

    if (!manager || Platform.OS === 'web') {
      operation.simulationTimer = setTimeout(() => {
        if (operation.stopped) return;
        onDevice?.({ id: 'VL01-DEMO', name: 'NorthStar VL01', rssi: -48 });
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
            logger.error('[BLE] Scan error', scanError);
            try { manager.stopDeviceScan(); } catch {}
            if (operation.retryCount < 2) {
              operation.retryCount += 1;
              operation.retryTimer = setTimeout(startScan, 1000 * operation.retryCount);
            } else {
              operation.finish('error', new Error(translate('jewelry.scanFailed')));
            }
            return;
          }
          if (device?.name?.includes('NorthStar') || device?.name?.includes('VL01')) onDevice?.(device);
        });
      } catch (scanError) {
        logger.error('[BLE] Unable to start scan', scanError);
        operation.finish('error', new Error(translate('jewelry.scanAccessFailed')));
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

  async connect(device) {
    const manager = this.getManager();
    if (!manager || !device.connect) {
      return { id: device.id, name: device.name || 'NorthStar VL01', battery: 82, connected: true };
    }
    try {
      const connected = await withTimeout((async () => {
        const candidate = await device.connect();
        await candidate.discoverAllServicesAndCharacteristics();
        return candidate;
      })(), CONNECT_TIMEOUT_MS, translate('jewelry.connectTimeout'));
      return { id: connected.id, name: connected.name || 'NorthStar VL01', battery: 82, connected: true };
    } catch (error) {
      try { await device.cancelConnection?.(); } catch {}
      logger.error('[BLE] Connection failed', error);
      if (error instanceof OperationTimeoutError) {
        throw new Error(translate('jewelry.connectTimeout'));
      }
      throw new Error(translate('jewelry.connectFailed'));
    }
  }
}

export const bleService = new BLEService();
