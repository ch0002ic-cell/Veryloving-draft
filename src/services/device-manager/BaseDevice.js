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
    this.statusListeners = new Set();
    this.disposed = false;
    this.commandGeneration = 0;
    // Every device owns a queue. A stalled GATT write can serialize later
    // writes to that wearable without blocking a different device instance.
    this.commandQueue = Promise.resolve();
  }

  async connect() { throw new Error('connect() must be implemented'); }
  async disconnect() { throw new Error('disconnect() must be implemented'); }
  async sendCommand() { throw new Error('sendCommand() must be implemented'); }

  enqueueCommand(operation) {
    if (typeof operation !== 'function') throw new TypeError('Command operation is required');
    if (this.disposed) return Promise.reject(this.disposedError());
    const generation = this.commandGeneration;
    const queued = this.commandQueue.catch(() => {}).then(() => {
      if (this.disposed || generation !== this.commandGeneration) throw this.disposedError();
      return operation();
    });
    this.commandQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  async drainCommandQueue() { await this.commandQueue.catch(() => {}); }

  disposedError() {
    const error = new Error('Device is no longer active.');
    error.code = 'DEVICE_DISPOSED';
    return error;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.commandGeneration += 1;
    this.telemetryListeners.clear();
    this.statusListeners.clear();
  }

  onTelemetry(callback) {
    if (typeof callback !== 'function') throw new TypeError('Telemetry callback is required');
    this.telemetryListeners.add(callback);
    return () => this.telemetryListeners.delete(callback);
  }

  emitTelemetry(telemetry) {
    for (const listener of this.telemetryListeners) listener(telemetry);
  }

  getStatus() { return { ...this.status }; }

  onStatusChange(callback) {
    if (typeof callback !== 'function') throw new TypeError('Status callback is required');
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  setStatus(patch) {
    this.status = Object.freeze({ ...this.status, ...patch });
    for (const listener of this.statusListeners) {
      try { listener(this.getStatus()); } catch {}
    }
    return this.getStatus();
  }
}
