import { BaseDevice, DEVICE_TYPES } from './BaseDevice';

const DEFAULT_TIMEOUT_MS = 10000;

export class HomeRobotDevice extends BaseDevice {
  constructor({ deviceId, name, gatewayURL, accessToken, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    super({ deviceId, deviceType: DEVICE_TYPES.homeRobot, name });
    if (!gatewayURL) throw new TypeError('gatewayURL is required');
    this.gatewayURL = gatewayURL.replace(/\/$/, '');
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.commandQueue = Promise.resolve();
  }

  async request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.gatewayURL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          ...options.headers
        }
      });
      if (!response.ok) throw Object.assign(new Error('Robot gateway request failed'), { statusCode: response.status });
      return response.status === 204 ? null : response.json();
    } finally { clearTimeout(timeout); }
  }

  async connect() {
    const status = await this.request(`/v1/devices/${encodeURIComponent(this.deviceId)}/status`);
    return this.setStatus({ ...status, online: status?.online === true, connectionState: status?.online ? 'connected' : 'disconnected' });
  }

  async disconnect() {
    return this.setStatus({ online: false, connectionState: 'disconnected' });
  }

  sendCommand(command) {
    const operation = this.commandQueue.catch(() => {}).then(() => this.request('/v1/manufacturer/robot/command', {
      method: 'POST',
      body: JSON.stringify({ device_id: this.deviceId, command })
    }));
    this.commandQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async refreshTelemetry() {
    const telemetry = await this.request(`/v1/devices/${encodeURIComponent(this.deviceId)}/telemetry`);
    this.emitTelemetry(telemetry);
    return telemetry;
  }
}
