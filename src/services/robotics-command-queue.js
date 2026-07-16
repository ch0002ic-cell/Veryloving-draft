import { encodeRoboticsCommand } from './robotics-mock-driver';
import { logger } from '../utils/logger';

export const ROBOTICS_PRIORITY = Object.freeze({ CRITICAL: 'critical', STANDARD: 'standard', BACKGROUND: 'background' });

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

export class RoboticsCommandQueue {
  constructor({ driver, deviceId, loggerImpl = logger } = {}) {
    this.driver = driver;
    this.deviceId = deviceId;
    this.logger = loggerImpl;
    this.standard = [];
    this.background = [];
    this.processing = false;
    this.criticalInFlight = 0;
  }

  setDevice(deviceId) { this.deviceId = deviceId; }

  write(action, withResponse) {
    if (!this.driver || !this.deviceId) return Promise.reject(new Error('A connected robot is required'));
    return this.driver.writeCommand(this.deviceId, bytesToBase64(encodeRoboticsCommand(action)), { withResponse });
  }

  enqueue(action, { priority = ROBOTICS_PRIORITY.STANDARD } = {}) {
    if (priority === ROBOTICS_PRIORITY.CRITICAL) {
      this.criticalInFlight += 1;
      this.logger.info?.('[RoboticsQueue] critical command bypassed queue', { action: action?.name || action?.type });
      return this.write(action, false).finally(() => {
        this.criticalInFlight -= 1;
        this.scheduleDrain();
      });
    }
    return new Promise((resolve, reject) => {
      const entry = { action, resolve, reject };
      (priority === ROBOTICS_PRIORITY.BACKGROUND ? this.background : this.standard).push(entry);
      this.logger.info?.('[RoboticsQueue] command queued', { priority, action: action?.name || action?.type });
      this.scheduleDrain();
    });
  }

  scheduleDrain() {
    if (this.processing) return;
    Promise.resolve().then(() => this.drain()).catch(() => {});
  }

  async drain() {
    if (this.processing || this.criticalInFlight) return;
    const entry = this.standard.shift() || this.background.shift();
    if (!entry) return;
    this.processing = true;
    try {
      await this.write(entry.action, true);
      entry.resolve(true);
    } catch (error) {
      entry.reject(error);
    } finally {
      this.processing = false;
      this.scheduleDrain();
    }
  }

  clear(error = new Error('Robotics command queue cleared')) {
    for (const entry of [...this.standard.splice(0), ...this.background.splice(0)]) entry.reject(error);
  }
}

export function priorityForRobotAction(action) {
  const name = String(action?.name || action?.type || '').toLowerCase();
  if (name.includes('stop') || name.includes('emergency')) return ROBOTICS_PRIORITY.CRITICAL;
  if (name.includes('telemetry') || name.includes('battery')) return ROBOTICS_PRIORITY.BACKGROUND;
  return ROBOTICS_PRIORITY.STANDARD;
}
