export const DEVICE_TYPES = Object.freeze({
  wearable: 'wearable',
  homeRobot: 'home_robot'
});

export const COMMAND_PRIORITIES = Object.freeze({
  critical: 0,
  standard: 1,
  background: 2
});

export const DEFAULT_DEVICE_COMMAND_QUEUE_DEPTH = 100;

function commandQueueFullError() {
  const error = new Error('Device command queue is full.');
  error.code = 'DEVICE_COMMAND_QUEUE_FULL';
  return error;
}

export class BaseDevice {
  constructor({
    deviceId,
    deviceType,
    name,
    maxCommandQueueDepth = DEFAULT_DEVICE_COMMAND_QUEUE_DEPTH
  } = {}) {
    if (!deviceId || typeof deviceId !== 'string') throw new TypeError('deviceId is required');
    if (!Object.values(DEVICE_TYPES).includes(deviceType)) throw new TypeError('deviceType is invalid');
    if (!Number.isSafeInteger(maxCommandQueueDepth)
      || maxCommandQueueDepth < 1
      || maxCommandQueueDepth > 1000) {
      throw new TypeError('maxCommandQueueDepth is invalid');
    }
    this.deviceId = deviceId;
    this.deviceType = deviceType;
    this.name = name || deviceId;
    this.status = Object.freeze({ online: false, connectionState: 'disconnected' });
    this.telemetryListeners = new Set();
    this.statusListeners = new Set();
    this.disposed = false;
    this.commandGeneration = 0;
    // Every device owns an independent, stable priority queue. An active
    // operation is never pre-empted, but queued safety work overtakes standard
    // and background work without blocking a different device instance.
    this.pendingCommands = [];
    this.commandActive = false;
    this.commandQueuePaused = false;
    this.commandSequence = 0;
    this.commandDrainWaiters = new Set();
    this.maxCommandQueueDepth = maxCommandQueueDepth;
  }

  async connect() { throw new Error('connect() must be implemented'); }
  async disconnect() { throw new Error('disconnect() must be implemented'); }
  async sendCommand() { throw new Error('sendCommand() must be implemented'); }

  enqueueCommand(operation, { priority = 'standard', bypass = false } = {}) {
    if (typeof operation !== 'function') throw new TypeError('Command operation is required');
    if (this.disposed) return Promise.reject(this.disposedError());
    const generation = this.commandGeneration;
    if (bypass) return Promise.resolve().then(() => {
      if (this.disposed || generation !== this.commandGeneration) throw this.disposedError();
      return operation();
    });
    if (!(priority in COMMAND_PRIORITIES)) throw new TypeError('Command priority is invalid');
    if (this.pendingCommands.length + (this.commandActive ? 1 : 0) >= this.maxCommandQueueDepth) {
      return Promise.reject(commandQueueFullError());
    }
    return new Promise((resolve, reject) => {
      this.pendingCommands.push({
        operation,
        priority: COMMAND_PRIORITIES[priority],
        sequence: this.commandSequence++,
        generation,
        resolve,
        reject
      });
      this.pendingCommands.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      this.pumpCommandQueue();
    });
  }

  pumpCommandQueue() {
    if (this.commandActive || this.commandQueuePaused || this.disposed) return;
    const next = this.pendingCommands.shift();
    if (!next) {
      for (const resolve of this.commandDrainWaiters) resolve();
      this.commandDrainWaiters.clear();
      return;
    }
    this.commandActive = true;
    Promise.resolve().then(() => {
      if (this.disposed || next.generation !== this.commandGeneration) throw this.disposedError();
      return next.operation();
    }).then(next.resolve, next.reject).finally(() => {
      this.commandActive = false;
      this.pumpCommandQueue();
    });
  }

  drainCommandQueue() {
    if (!this.commandActive && this.pendingCommands.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.commandDrainWaiters.add(resolve));
  }

  pauseCommandQueue() {
    this.commandQueuePaused = true;
  }

  resumeCommandQueue() {
    if (this.disposed || !this.commandQueuePaused) return;
    this.commandQueuePaused = false;
    this.pumpCommandQueue();
  }

  disposedError() {
    const error = new Error('Device is no longer active.');
    error.code = 'DEVICE_DISPOSED';
    return error;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.commandQueuePaused = false;
    this.commandGeneration += 1;
    const error = this.disposedError();
    for (const command of this.pendingCommands.splice(0)) command.reject(error);
    for (const resolve of this.commandDrainWaiters) resolve();
    this.commandDrainWaiters.clear();
    this.telemetryListeners.clear();
    this.statusListeners.clear();
  }

  onTelemetry(callback) {
    if (typeof callback !== 'function') throw new TypeError('Telemetry callback is required');
    this.telemetryListeners.add(callback);
    return () => this.telemetryListeners.delete(callback);
  }

  emitTelemetry(telemetry) {
    // A consumer is not part of the hardware transport. Isolate callback
    // failures so one screen or analytics subscriber cannot terminate a robot
    // telemetry poll or a wearable notification fan-out for every listener.
    for (const listener of this.telemetryListeners) {
      try { listener(telemetry); } catch {}
    }
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
