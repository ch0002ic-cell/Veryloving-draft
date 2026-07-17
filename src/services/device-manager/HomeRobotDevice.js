import { BaseDevice, DEVICE_TYPES } from './BaseDevice';
import { acknowledgeDeviceCommand, enqueueDeviceCommand, loadDeviceCommands } from '../device-command-queue';

const DEFAULT_TIMEOUT_MS = 10000;

export class HomeRobotDevice extends BaseDevice {
  constructor({ deviceId, name, accountId, gatewayURL, accessToken, accessTokenProvider, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, commandStore, loadNetwork = () => import('expo-network'), setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    super({ deviceId, deviceType: DEVICE_TYPES.homeRobot, name });
    this.gatewayURL = typeof gatewayURL === 'string' ? gatewayURL.replace(/\/$/, '') : '';
    this.accessToken = accessToken;
    this.accessTokenProvider = accessTokenProvider;
    this.accountId = accountId;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.loadNetwork = loadNetwork;
    this.networkSubscription = null;
    this.activeRequestControllers = new Set();
    this.scheduledCommands = new Map();
    this.pendingScan = null;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.commandStore = commandStore || (accountId ? {
      enqueue: enqueueDeviceCommand,
      load: loadDeviceCommands,
      acknowledge: acknowledgeDeviceCommand
    } : null);
  }

  async request(path, options = {}) {
    if (this.disposed) throw this.disposedError();
    if (!this.gatewayURL) {
      const error = new Error('Robot gateway is not configured');
      error.code = 'ROBOT_GATEWAY_NOT_CONFIGURED';
      this.setStatus({ online: false, connectionState: 'disconnected', lastErrorCode: error.code });
      throw error;
    }
    const controller = new AbortController();
    this.activeRequestControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const accessToken = await this.accessTokenProvider?.() || this.accessToken;
      const response = await this.fetchImpl(`${this.gatewayURL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...options.headers
        }
      });
      if (!response.ok) throw Object.assign(new Error('Robot gateway request failed'), { statusCode: response.status });
      if (response.status === 204) return null;
      if (typeof response.text === 'function') {
        const text = await response.text();
        return text ? JSON.parse(text) : { accepted: true, status: response.status };
      }
      return typeof response.json === 'function' ? response.json() : { accepted: true, status: response.status };
    } catch (error) {
      const relayResponded = Number.isFinite(error?.statusCode);
      const lastErrorCode = error?.name === 'AbortError'
        ? 'ROBOT_NETWORK_TIMEOUT'
        : relayResponded ? `ROBOT_GATEWAY_HTTP_${error.statusCode}` : 'ROBOT_NETWORK_UNAVAILABLE';
      this.setStatus(relayResponded ? {
        relayOnline: true,
        lastErrorCode
      } : {
        relayOnline: false,
        online: false,
        hardwareStatus: 'unknown',
        connectionState: 'disconnected',
        lastErrorCode
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      this.activeRequestControllers.delete(controller);
    }
  }

  async connect() {
    const status = await this.request('/health');
    const relayOnline = status?.status === 'ok';
    const next = this.setStatus({
      relayOnline,
      online: false,
      hardwareStatus: 'unknown',
      connectionState: relayOnline ? 'unknown' : 'disconnected',
      lastErrorCode: null
    });
    if (relayOnline) {
      const [telemetry, pendingCommands] = await Promise.allSettled([this.refreshTelemetry(), this.retryPendingCommands()]);
      const commandQueueDrained = pendingCommands.status === 'fulfilled'
        && pendingCommands.value.every((result) => result.status === 'fulfilled');
      if (telemetry.status === 'fulfilled' && commandQueueDrained) this.clearNetworkRetry();
      else this.scheduleNetworkRetry();
    }
    return this.getStatus();
  }

  async disconnect() {
    return this.setStatus({ relayOnline: false, online: false, hardwareStatus: 'unknown', connectionState: 'disconnected' });
  }

  async deliverQueuedCommand(queued) {
    const command = queued.command && typeof queued.command === 'object' ? queued.command : {};
    const commandId = typeof queued.id === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(queued.id) ? queued.id : null;
    const parameters = command.parameters;
    let result;
    try {
      result = await this.request('/v1/device-actions', {
        method: 'POST',
        headers: commandId ? { 'Idempotency-Key': commandId } : undefined,
        body: JSON.stringify({
          ...command,
          ...(parameters === undefined ? {} : { parameters }),
          ...(commandId ? { idempotency_key: commandId } : {}),
          // Bound identity always wins over untrusted command fields.
          device_id: this.deviceId,
          device_type: DEVICE_TYPES.homeRobot
        })
      });
    } catch (error) {
      this.scheduleNetworkRetry();
      throw error;
    }
    await this.commandStore?.acknowledge(queued.id);
    this.setStatus({ relayOnline: true, lastErrorCode: null });
    return result;
  }

  scheduleQueuedCommand(queued) {
    if (!queued?.id) return this.enqueueCommand(() => this.deliverQueuedCommand(queued));
    const scheduled = this.scheduledCommands.get(queued.id);
    if (scheduled) return scheduled;
    let operation;
    operation = this.enqueueCommand(() => this.deliverQueuedCommand(queued)).finally(() => {
      if (this.scheduledCommands.get(queued.id) === operation) this.scheduledCommands.delete(queued.id);
    });
    this.scheduledCommands.set(queued.id, operation);
    return operation;
  }

  async sendCommand(command) {
    const queued = this.commandStore
      ? await this.commandStore.enqueue({ accountId: this.accountId, deviceId: this.deviceId, command })
      : { id: null, command };
    return this.scheduleQueuedCommand(queued);
  }

  async retryPendingCommands() {
    if (!this.commandStore) return [];
    if (this.pendingScan) return this.pendingScan;
    let scan;
    scan = (async () => {
      const pending = await this.commandStore.load(this.accountId, this.deviceId);
      return Promise.allSettled(pending.map((queued) => this.scheduleQueuedCommand(queued)));
    })().finally(() => {
      if (this.pendingScan === scan) this.pendingScan = null;
    });
    this.pendingScan = scan;
    return scan;
  }

  async startNetworkMonitoring() {
    if (this.disposed || this.networkSubscription) return;
    const Network = await this.loadNetwork();
    if (this.disposed || this.networkSubscription) return;
    const handleNetworkState = (state) => {
      if (this.disposed) return;
      if (state.isConnected === true && state.isInternetReachable !== false) {
        this.connect().catch(() => this.scheduleNetworkRetry());
      } else if (state.isConnected === false || state.isInternetReachable === false) {
        this.clearNetworkRetry();
        this.setStatus({ relayOnline: false, online: false, hardwareStatus: 'unknown', connectionState: 'disconnected', lastErrorCode: 'ROBOT_NETWORK_UNAVAILABLE' });
      }
    };
    this.networkSubscription = Network.addNetworkStateListener(handleNetworkState);
    const current = await Network.getNetworkStateAsync?.();
    if (current) handleNetworkState(current);
  }

  clearNetworkRetry() {
    if (this.retryTimer !== null) this.clearTimeoutImpl(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  scheduleNetworkRetry() {
    if (this.disposed || this.retryTimer) return;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.retryAttempt, 6));
    this.retryAttempt += 1;
    this.retryTimer = this.setTimeoutImpl(() => {
      this.retryTimer = null;
      this.connect().catch(() => this.scheduleNetworkRetry());
    }, delay);
    this.retryTimer?.unref?.();
  }

  dispose() {
    super.dispose();
    this.clearNetworkRetry();
    for (const controller of this.activeRequestControllers) controller.abort();
    this.activeRequestControllers.clear();
    this.networkSubscription?.remove?.();
    this.networkSubscription = null;
  }

  async refreshTelemetry() {
    const telemetry = await this.request(`/v1/devices/${encodeURIComponent(this.deviceId)}/telemetry`);
    const longitude = Number(telemetry?.location?.longitude);
    const latitude = Number(telemetry?.location?.latitude);
    const location = Number.isFinite(longitude) && Math.abs(longitude) <= 180
      && Number.isFinite(latitude) && Math.abs(latitude) <= 90
      ? {
          longitude,
          latitude,
          ...(Number.isFinite(Number(telemetry.reported_at)) ? { capturedAt: Number(telemetry.reported_at) } : {})
        }
      : undefined;
    const statusPatch = {
      relayOnline: true,
      lastErrorCode: null,
      ...(location ? { location } : {})
    };
    if (typeof telemetry?.online === 'boolean') {
      Object.assign(statusPatch, {
        online: telemetry.online,
        hardwareStatus: telemetry.online ? 'online' : 'offline',
        connectionState: telemetry.online ? 'connected' : 'disconnected'
      });
    }
    this.setStatus(statusPatch);
    this.emitTelemetry(telemetry);
    return telemetry;
  }
}
