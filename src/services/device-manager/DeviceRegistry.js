import { BaseDevice } from './BaseDevice';

export class DeviceRegistry {
  constructor() { this.devices = new Map(); }

  register(device) {
    if (!(device instanceof BaseDevice)) throw new TypeError('device must extend BaseDevice');
    if (this.devices.has(device.deviceId)) throw new Error('A device with this ID is already registered');
    this.devices.set(device.deviceId, device);
    return device;
  }

  unregister(deviceId) { return this.devices.delete(deviceId); }
  get(deviceId) { return this.devices.get(deviceId) || null; }
  has(deviceId) { return this.devices.has(deviceId); }
  list({ deviceType, online } = {}) {
    return [...this.devices.values()].filter((device) => {
      if (deviceType && device.deviceType !== deviceType) return false;
      if (typeof online === 'boolean' && device.getStatus().online !== online) return false;
      return true;
    });
  }
  clear() { this.devices.clear(); }
}

export const deviceRegistry = new DeviceRegistry();
