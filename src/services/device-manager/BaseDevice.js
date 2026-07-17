export const DEVICE_TYPES = Object.freeze({
  wearable: 'wearable',
  homeRobot: 'home_robot'
});

export class BaseDevice {
  constructor({ deviceId, deviceType, name } = {}) {
    if (!deviceId || typeof deviceId !== 'string') throw new TypeError('deviceId is required');
    if (!Object.values(DEVICE_TYPES).includes(deviceType)) throw new TypeError('deviceType is invalid');
    this.deviceId = deviceId;
    this.deviceType = deviceType;
    this.name = name || deviceId;
    this.status = Object.freeze({ online: false, connectionState: 'disconnected' });
    this.telemetryListeners = new Set();
  }

  async connect() { throw new Error('connect() must be implemented'); }
  async disconnect() { throw new Error('disconnect() must be implemented'); }
  async sendCommand() { throw new Error('sendCommand() must be implemented'); }

  onTelemetry(callback) {
    if (typeof callback !== 'function') throw new TypeError('Telemetry callback is required');
    this.telemetryListeners.add(callback);
    return () => this.telemetryListeners.delete(callback);
  }

  emitTelemetry(telemetry) {
    for (const listener of this.telemetryListeners) listener(telemetry);
  }

  getStatus() { return { ...this.status }; }

  setStatus(patch) {
    this.status = Object.freeze({ ...this.status, ...patch });
    return this.getStatus();
  }
}
