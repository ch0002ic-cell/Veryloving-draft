import { encodeRoboticsCommand } from './robotics-mock-driver';
import { logger } from '../utils/logger';

export const ROBOTICS_PRIORITY = Object.freeze({ CRITICAL: 'critical', STANDARD: 'standard', BACKGROUND: 'background' });
export const ROBOTICS_COMMAND_FAILED_MESSAGE = 'Robot navigation failed. Please retry.';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 250;
const DEFAULT_WRITE_TIMEOUT_MS = 6000;
const MAX_DEAD_LETTERS = 50;

function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const triple = (bytes[index] << 16) | ((bytes[index + 1] || 0) << 8) | (bytes[index + 2] || 0);
    result += chars[(triple >>> 18) & 63] + chars[(triple >>> 12) & 63];
    result += index + 1 < bytes.length ? chars[(triple >>> 6) & 63] : '=';
    result += index + 2 < bytes.length ? chars[triple & 63] : '=';
  }
  return result;
}

function queueError(message, code, cause) {
  return Object.assign(new Error(message), { code, cause });
}

function connectionFailure(error) {
  return ['BLE_CONNECT_FAILED', 'BLE_UNAVAILABLE', 'ROBOTICS_NOT_CONNECTED'].includes(error?.code);
}

function actionName(action) {
  return action?.name || action?.type || 'unknown';
}

export class RoboticsCommandQueue {
  constructor({
    driver,
    deviceId = null,
    connectionReady = false,
    loggerImpl = logger,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseMs = DEFAULT_RETRY_BASE_MS,
    writeTimeoutMs = DEFAULT_WRITE_TIMEOUT_MS,
    sleep
  } = {}) {
    this.driver = driver;
    this.deviceId = deviceId;
    this.connectionReady = connectionReady === true;
    this.logger = loggerImpl;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.sleepImpl = sleep;
    this.critical = [];
    this.standard = [];
    this.background = [];
    this.failed = [];
    this.failureHandlers = new Set();
    this.processing = false;
    this.criticalInFlight = 0;
    this.currentEntries = new Set();
    this.timers = new Set();
    this.pendingWaiters = new Set();
    this.generation = 0;
    this.closed = false;
    this.nextEntryId = 0;
  }

  setDevice(deviceId) {
    const previous = this.deviceId;
    this.deviceId = deviceId || null;
    if (!this.deviceId) this.setConnectionReady(false);
    if (previous && this.deviceId && previous !== this.deviceId) {
      for (const entries of [this.critical, this.standard, this.background]) {
        const retained = [];
        for (const entry of entries) {
          if (!entry.targetDeviceId || entry.targetDeviceId === this.deviceId) retained.push(entry);
          else this.deadLetter(entry, queueError('The selected robot changed.', 'ROBOT_CHANGED'));
        }
        entries.splice(0, entries.length, ...retained);
      }
    }
    this.scheduleDrain();
  }

  setConnectionReady(ready, { deviceId } = {}) {
    if (deviceId !== undefined) this.setDevice(deviceId);
    this.connectionReady = ready === true && Boolean(this.deviceId);
    this.logger.info?.('[RoboticsQueue] connection state changed', { ready: this.connectionReady });
    if (this.connectionReady) this.scheduleDrain();
  }

  addFailureListener(handler) {
    if (typeof handler !== 'function') return () => {};
    this.failureHandlers.add(handler);
    return () => this.failureHandlers.delete(handler);
  }

  createEntry(action, priority, options, resolve, reject) {
    return {
      id: ++this.nextEntryId,
      action,
      priority,
      targetDeviceId: options.targetDeviceId || this.deviceId || null,
      expiresAt: Number.isFinite(options.expiresAt) ? options.expiresAt : null,
      attempts: 0,
      resolve,
      reject,
      settled: false
    };
  }

  settle(entry, method, value) {
    if (entry.settled) return;
    entry.settled = true;
    entry[method](value);
  }

  enqueue(action, { priority = ROBOTICS_PRIORITY.STANDARD, ...options } = {}) {
    if (this.closed) return Promise.reject(queueError('Robotics command queue is closed.', 'ROBOT_QUEUE_CLOSED'));
    return new Promise((resolve, reject) => {
      const entry = this.createEntry(action, priority, options, resolve, reject);
      if (priority === ROBOTICS_PRIORITY.CRITICAL) this.critical.push(entry);
      else (priority === ROBOTICS_PRIORITY.BACKGROUND ? this.background : this.standard).push(entry);
      this.logger.info?.('[RoboticsQueue] command queued', { priority, action: actionName(action), connectionReady: this.connectionReady });
      this.scheduleDrain();
    });
  }

  scheduleDrain() {
    if (this.closed || !this.connectionReady) return;
    Promise.resolve().then(() => this.drain()).catch((error) => {
      this.logger.warn?.('[RoboticsQueue] drain failed', { errorCode: error?.code || error?.name || 'ROBOT_QUEUE_DRAIN_FAILED' });
    });
  }

  drain() {
    if (this.closed || !this.connectionReady) return;
    while (this.critical.length && this.connectionReady) {
      const entry = this.critical.shift();
      this.runCritical(entry);
    }
    if (this.processing || this.criticalInFlight || !this.connectionReady) return;
    const entry = this.standard.shift() || this.background.shift();
    if (!entry) return;
    this.processing = true;
    this.currentEntries.add(entry);
    const generation = this.generation;
    this.executeWithRetry(entry, true, generation).then((result) => {
      if (result === 'paused') this.requeue(entry, true);
      else if (result === 'superseded') this.settle(entry, 'resolve', { superseded: true });
      else this.settle(entry, 'resolve', true);
    }).catch((error) => this.deadLetter(entry, error)).finally(() => {
      this.currentEntries.delete(entry);
      this.processing = false;
      this.scheduleDrain();
    });
  }

  runCritical(entry) {
    this.criticalInFlight += 1;
    this.currentEntries.add(entry);
    const generation = this.generation;
    this.logger.info?.('[RoboticsQueue] critical command bypassed waiting work', { action: actionName(entry.action) });
    this.executeWithRetry(entry, false, generation).then((result) => {
      if (result === 'paused') this.requeue(entry, true);
      else this.settle(entry, 'resolve', result === 'superseded' ? { superseded: true } : true);
    }).catch((error) => this.deadLetter(entry, error)).finally(() => {
      this.currentEntries.delete(entry);
      this.criticalInFlight = Math.max(0, this.criticalInFlight - 1);
      this.scheduleDrain();
    });
  }

  requeue(entry, front = false) {
    if (entry.settled || this.closed) return;
    const queue = entry.priority === ROBOTICS_PRIORITY.CRITICAL
      ? this.critical
      : entry.priority === ROBOTICS_PRIORITY.BACKGROUND ? this.background : this.standard;
    if (front) queue.unshift(entry);
    else queue.push(entry);
  }

  async executeWithRetry(entry, withResponse, generation) {
    if (entry.priority !== ROBOTICS_PRIORITY.CRITICAL && entry.expiresAt && entry.expiresAt <= Date.now()) {
      throw queueError('Robot action expired before execution.', 'ROBOT_ACTION_EXPIRED');
    }
    while (entry.attempts <= this.maxRetries) {
      if (this.closed || generation !== this.generation) throw queueError('Robotics command queue was cleared.', 'ROBOT_QUEUE_CLEARED');
      if (!this.connectionReady) return 'paused';
      if (!entry.targetDeviceId) entry.targetDeviceId = this.deviceId;
      if (!entry.targetDeviceId || entry.targetDeviceId !== this.deviceId) {
        throw queueError('The selected robot changed.', 'ROBOT_CHANGED');
      }
      entry.attempts += 1;
      try {
        await this.write(entry, withResponse, generation);
        return 'complete';
      } catch (error) {
        if (error?.code === 'COMMAND_SUPERSEDED') return 'superseded';
        if (connectionFailure(error)) {
          entry.attempts = Math.max(0, entry.attempts - 1);
          this.connectionReady = false;
          this.logger.warn?.('[RoboticsQueue] paused after connection loss', { action: actionName(entry.action), errorCode: error.code });
          return 'paused';
        }
        if (entry.attempts > this.maxRetries) throw error;
        const delayMs = this.retryBaseMs * Math.pow(2, entry.attempts - 1);
        this.logger.warn?.('[RoboticsQueue] command retry scheduled', {
          action: actionName(entry.action),
          attempt: entry.attempts,
          errorCode: error?.code || error?.name || 'ROBOT_COMMAND_FAILED'
        });
        await this.delay(delayMs, generation);
      }
    }
    throw queueError('Robot command retry budget was exhausted.', 'ROBOT_RETRY_EXHAUSTED');
  }

  write(entry, withResponse, generation) {
    if (!this.driver || !entry.targetDeviceId) return Promise.reject(queueError('A connected robot is required.', 'ROBOTICS_NOT_CONNECTED'));
    const operation = Promise.resolve().then(() => this.driver.writeCommand(
      entry.targetDeviceId,
      bytesToBase64(encodeRoboticsCommand(entry.action)),
      { withResponse }
    ));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (method, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.timers.delete(timer);
        this.pendingWaiters.delete(cancel);
        method(value);
      };
      const cancel = (error) => finish(reject, error);
      const timer = setTimeout(() => {
        finish(reject, queueError('Robot command timed out.', 'ROBOT_COMMAND_TIMEOUT'));
      }, this.writeTimeoutMs);
      this.timers.add(timer);
      this.pendingWaiters.add(cancel);
      operation.then((result) => {
        if (generation !== this.generation) finish(reject, queueError('Robotics command queue was cleared.', 'ROBOT_QUEUE_CLEARED'));
        else finish(resolve, result);
      }, (error) => {
        finish(reject, error);
      });
    });
  }

  delay(milliseconds, generation) {
    if (typeof this.sleepImpl === 'function') return this.sleepImpl(milliseconds);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (method, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.timers.delete(timer);
        this.pendingWaiters.delete(cancel);
        method(value);
      };
      const cancel = (error) => finish(reject, error);
      const timer = setTimeout(() => {
        if (generation !== this.generation) finish(reject, queueError('Robotics command queue was cleared.', 'ROBOT_QUEUE_CLEARED'));
        else finish(resolve);
      }, milliseconds);
      this.timers.add(timer);
      this.pendingWaiters.add(cancel);
    });
  }

  deadLetter(entry, error) {
    if (entry.settled) return;
    const failure = Object.freeze({
      id: entry.id,
      action: entry.action,
      priority: entry.priority,
      attempts: entry.attempts,
      errorCode: error?.code || error?.name || 'ROBOT_COMMAND_FAILED',
      message: ROBOTICS_COMMAND_FAILED_MESSAGE,
      failedAt: Date.now()
    });
    this.failed.push(failure);
    if (this.failed.length > MAX_DEAD_LETTERS) this.failed.splice(0, this.failed.length - MAX_DEAD_LETTERS);
    this.logger.error?.('[RoboticsQueue] command moved to dead letters', {
      action: actionName(entry.action),
      attempts: entry.attempts,
      errorCode: failure.errorCode
    });
    for (const handler of this.failureHandlers) handler(failure);
    this.settle(entry, 'reject', Object.assign(error || new Error(failure.message), { userMessage: failure.message }));
  }

  clear(error = queueError('Robotics command queue cleared.', 'ROBOT_QUEUE_CLEARED')) {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.connectionReady = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const cancel of this.pendingWaiters) cancel(error);
    this.pendingWaiters.clear();
    const entries = new Set([
      ...this.critical.splice(0),
      ...this.standard.splice(0),
      ...this.background.splice(0),
      ...this.currentEntries
    ]);
    for (const entry of entries) this.settle(entry, 'reject', error);
    this.currentEntries.clear();
    this.failureHandlers.clear();
  }
}

export function priorityForRobotAction(action) {
  const name = String(action?.name || action?.type || '').toLowerCase();
  if (name.includes('stop') || name.includes('emergency')) return ROBOTICS_PRIORITY.CRITICAL;
  if (name.includes('telemetry') || name.includes('battery')) return ROBOTICS_PRIORITY.BACKGROUND;
  return ROBOTICS_PRIORITY.STANDARD;
}
