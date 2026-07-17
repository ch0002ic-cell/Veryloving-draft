import { BaseDevice } from './BaseDevice';
import { loadDeviceEntities } from '../device-entity-store';

export class DeviceRegistry {
  constructor() {
    this.devices = new Map();
    this.listeners = new Set();
    this.deviceSubscriptions = new Map();
    this.rehydrationGeneration = 0;
  }

  snapshot() {
    return this.list().map((device) => ({ ...device.getStatus(), deviceId: device.deviceId, deviceType: device.deviceType, name: device.name }));
  }

  emitChange() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch {}
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Registry listener is required');
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  attach(device) {
    this.deviceSubscriptions.get(device.deviceId)?.();
    this.deviceSubscriptions.set(device.deviceId, device.onStatusChange(() => this.emitChange()));
  }

  register(device) {
    if (!(device instanceof BaseDevice)) throw new TypeError('device must extend BaseDevice');
    if (this.devices.has(device.deviceId)) throw new Error('A device with this ID is already registered');
    this.rehydrationGeneration += 1;
    this.devices.set(device.deviceId, device);
    this.attach(device);
    this.emitChange();
    return device;
  }

  upsert(device) {
    if (!(device instanceof BaseDevice)) throw new TypeError('device must extend BaseDevice');
    this.rehydrationGeneration += 1;
    const previous = this.devices.get(device.deviceId);
    if (previous && previous !== device) previous.dispose?.();
    this.devices.set(device.deviceId, device);
    this.attach(device);
    this.emitChange();
    return device;
  }

  unregister(deviceId) {
    this.rehydrationGeneration += 1;
    const device = this.devices.get(deviceId);
    device?.dispose?.();
    this.deviceSubscriptions.get(deviceId)?.();
    this.deviceSubscriptions.delete(deviceId);
    const removed = this.devices.delete(deviceId);
    if (removed) this.emitChange();
    return removed;
  }
  get(deviceId) { return this.devices.get(deviceId) || null; }
  has(deviceId) { return this.devices.has(deviceId); }
  list({ deviceType, online } = {}) {
    return [...this.devices.values()].filter((device) => {
      if (deviceType && device.deviceType !== deviceType) return false;
      if (typeof online === 'boolean' && device.getStatus().online !== online) return false;
      return true;
    });
  }
  clear() {
    this.rehydrationGeneration += 1;
    this.replaceDevices(new Map());
  }

  replaceDevices(nextDevices) {
    for (const [deviceId, device] of this.devices) {
      if (nextDevices.get(deviceId) !== device) device.dispose?.();
    }
    for (const unsubscribe of this.deviceSubscriptions.values()) unsubscribe();
    this.deviceSubscriptions.clear();
    this.devices = nextDevices;
    for (const device of this.devices.values()) this.attach(device);
    this.emitChange();
  }

  async rehydrateRegistry({ accountId, gatewayURL, accessToken, accessTokenProvider, loadEntities = loadDeviceEntities, wearableFactory, robotFactory } = {}) {
    const generation = ++this.rehydrationGeneration;
    this.replaceDevices(new Map());
    if (!accountId) return [];
    const records = await loadEntities(accountId);
    let createWearable = wearableFactory;
    let createRobot = robotFactory;
    if (!createWearable && records.some((record) => record.deviceType === 'wearable')) {
      const { WearableDevice } = await import('./WearableDevice');
      createWearable = (record) => new WearableDevice({ deviceId: record.deviceId, name: record.name });
    }
    if (!createRobot && records.some((record) => record.deviceType === 'home_robot')) {
      const { HomeRobotDevice } = await import('./HomeRobotDevice');
      createRobot = (record) => new HomeRobotDevice({ deviceId: record.deviceId, name: record.name, accountId, gatewayURL, accessToken, accessTokenProvider });
    }
    const nextDevices = new Map();
    for (const record of records) {
      try {
        const device = record.deviceType === 'wearable'
          ? createWearable(record)
          : createRobot(record);
        device.setStatus({ ...record, online: false, connectionState: record.deviceType === 'wearable' && record.autoReconnect ? 'reconnecting' : 'disconnected' });
        nextDevices.get(device.deviceId)?.dispose?.();
        nextDevices.set(device.deviceId, device);
      } catch {}
    }
    if (generation !== this.rehydrationGeneration) {
      for (const device of nextDevices.values()) device.dispose?.();
      return [];
    }
    this.replaceDevices(nextDevices);
    for (const device of this.devices.values()) {
      if (device.deviceType === 'home_robot') device.startNetworkMonitoring?.().catch(() => {});
    }
    return this.list();
  }

  async connectAll({ deviceType } = {}) {
    const devices = this.list({ deviceType });
    return Promise.allSettled(devices.map((device) => device.connect()));
  }
}

export const deviceRegistry = new DeviceRegistry();
