import { BaseDevice, DEVICE_TYPES } from './BaseDevice';
import { acknowledgeDeviceCommand, enqueueDeviceCommand, loadDeviceCommands } from '../device-command-queue';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TELEMETRY_INTERVAL_MS = 30000;
const DEFAULT_TELEMETRY_MAX_AGE_MS = 5 * 60 * 1000;

function normalizePath(value) {
  if (!Array.isArray(value)) return undefined;
  const coordinates = value.slice(0, 500).flatMap((point) => {
    const longitude = Number(Array.isArray(point) ? point[0] : point?.longitude);
    const latitude = Number(Array.isArray(point) ? point[1] : point?.latitude);
    return Number.isFinite(longitude) && Math.abs(longitude) <= 180
      && Number.isFinite(latitude) && Math.abs(latitude) <= 90
      ? [[longitude, latitude]] : [];
  });
  return coordinates.length >= 2 ? coordinates : undefined;
}

function normalizeIndoorPosition(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const identifier = (candidate) => typeof candidate === 'string'
    && /^[A-Za-z0-9._:-]{1,128}$/.test(candidate) ? candidate : undefined;
  const roomId = identifier(value.room_id);
  const floorId = identifier(value.floor_id);
  const mapId = identifier(value.map_id);
  const x = Number(value.x_m);
  const y = Number(value.y_m);
  const hasCoordinates = mapId && Number.isFinite(x) && Math.abs(x) <= 10000
    && Number.isFinite(y) && Math.abs(y) <= 10000;
  if (!roomId && !hasCoordinates) return undefined;
  return {
    ...(roomId ? { roomId } : {}),
    ...(floorId ? { floorId } : {}),
    ...(mapId ? { mapId } : {}),
    ...(hasCoordinates ? { xMeters: x, yMeters: y } : {}),
    ...(Number.isFinite(value.confidence) ? { confidence: value.confidence } : {})
  };
}

export class HomeRobotDevice extends BaseDevice {
  constructor({ deviceId, name, accountId, gatewayURL, accessToken, accessTokenProvider, pairingToken, pairingTokenProvider, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, telemetryIntervalMs = DEFAULT_TELEMETRY_INTERVAL_MS, telemetryMaxAgeMs = DEFAULT_TELEMETRY_MAX_AGE_MS, commandStore, loadNetwork = () => import('expo-network'), setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval, now = Date.now } = {}) {
    super({ deviceId, deviceType: DEVICE_TYPES.homeRobot, name });
    this.gatewayURL = typeof gatewayURL === 'string' ? gatewayURL.replace(/\/$/, '') : '';
    this.accessToken = accessToken;
    this.accessTokenProvider = accessTokenProvider;
    this.accountId = accountId;
    this.pairingToken = pairingToken;
    this.pairingTokenProvider = pairingTokenProvider;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.loadNetwork = loadNetwork;
    this.networkSubscription = null;
    this.activeRequestControllers = new Set();
    this.scheduledCommands = new Map();
    this.pendingScan = null;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.telemetryIntervalMs = Math.max(5000, Number(telemetryIntervalMs) || DEFAULT_TELEMETRY_INTERVAL_MS);
    this.telemetryMaxAgeMs = Math.max(30000, Number(telemetryMaxAgeMs) || DEFAULT_TELEMETRY_MAX_AGE_MS);
    this.now = now;
    this.retryTimer = null;
    this.telemetryTimer = null;
    this.telemetryInFlight = null;
    this.latestTelemetryAt = 0;
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
      const pairingToken = await this.pairingTokenProvider?.(this.deviceId) || this.pairingToken;
      if (path.startsWith('/v1/') && this.pairingTokenProvider && !pairingToken) {
        const error = new Error('Robot pairing credential is unavailable');
        error.code = 'ROBOT_PAIRING_CREDENTIAL_MISSING';
        throw error;
      }
      const response = await this.fetchImpl(`${this.gatewayURL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(pairingToken ? { 'X-Device-Pairing-Token': pairingToken } : {}),
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
      this.startTelemetryPolling();
    }
    return this.getStatus();
  }

  async disconnect() {
    this.stopTelemetryPolling();
    return this.setStatus({ relayOnline: false, online: false, hardwareStatus: 'unknown', connectionState: 'disconnected' });
  }

  startTelemetryPolling() {
    if (this.disposed || this.telemetryTimer) return;
    this.telemetryTimer = this.setIntervalImpl(() => {
      if (this.disposed) return;
      return this.refreshTelemetry().catch(() => this.scheduleNetworkRetry());
    }, this.telemetryIntervalMs);
    this.telemetryTimer?.unref?.();
  }

  stopTelemetryPolling() {
    if (this.telemetryTimer !== null) this.clearIntervalImpl(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  async deliverQueuedCommand(queued) {
    const command = queued.command && typeof queued.command === 'object' ? queued.command : {};
    const candidateCommandId = queued.idempotencyKey || queued.id;
    const commandId = typeof candidateCommandId === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(candidateCommandId)
      ? candidateCommandId
      : null;
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
        this.stopTelemetryPolling();
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
    this.stopTelemetryPolling();
    for (const controller of this.activeRequestControllers) controller.abort();
    this.activeRequestControllers.clear();
    this.networkSubscription?.remove?.();
    this.networkSubscription = null;
  }

  async refreshTelemetry() {
    if (this.telemetryInFlight) return this.telemetryInFlight;
    let operation;
    operation = (async () => {
      let telemetry;
      try {
        telemetry = await this.request(`/v1/devices/${encodeURIComponent(this.deviceId)}/telemetry`);
      } catch (error) {
        this.stopTelemetryPolling();
        throw error;
      }
      const suppliedReportedAt = Number(telemetry?.reported_at);
      const reportedAt = Number.isFinite(suppliedReportedAt) ? suppliedReportedAt : this.now();
      if (reportedAt < this.latestTelemetryAt) return { ...telemetry, ignored: true };
      if (this.now() - reportedAt > this.telemetryMaxAgeMs) {
        this.latestTelemetryAt = reportedAt;
        this.setStatus({
          relayOnline: true,
          online: false,
          hardwareStatus: 'stale',
          connectionState: 'disconnected',
          navigationPath: null,
          lastSeenAt: reportedAt,
          lastErrorCode: 'ROBOT_TELEMETRY_STALE'
        });
        return { ...telemetry, stale: true };
      }
      this.latestTelemetryAt = reportedAt;
      const longitude = Number(telemetry?.location?.longitude);
      const latitude = Number(telemetry?.location?.latitude);
      const location = Number.isFinite(longitude) && Math.abs(longitude) <= 180
        && Number.isFinite(latitude) && Math.abs(latitude) <= 90
        ? { longitude, latitude, capturedAt: reportedAt }
        : undefined;
      const path = normalizePath(telemetry?.navigation_path ?? telemetry?.path);
      const indoorPosition = normalizeIndoorPosition(telemetry?.indoor_position);
      const statusPatch = {
        relayOnline: true,
        lastErrorCode: null,
        navigationPath: path || null,
        indoorPosition: indoorPosition || null,
        lastSeenAt: reportedAt,
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
    })().finally(() => {
      if (this.telemetryInFlight === operation) this.telemetryInFlight = null;
    });
    this.telemetryInFlight = operation;
    return operation;
  }
}
