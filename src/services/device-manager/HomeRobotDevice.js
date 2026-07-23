import { BaseDevice, DEVICE_TYPES } from './BaseDevice';
import { acknowledgeDeviceCommand, enqueueDeviceCommand, loadDeviceCommands } from '../device-command-queue';
import { readBoundedByteStream } from '../../utils/bounded-http';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_TELEMETRY_INTERVAL_MS = 30000;
const DEFAULT_TELEMETRY_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_GATEWAY_RESPONSE_BYTES = 1024 * 1024;
const MAX_TELEMETRY_CLOCK_SKEW_MS = 60 * 1000;

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function invalidGatewayResponse(statusCode) {
  const error = new Error('Robot gateway response is invalid');
  error.code = 'ROBOT_GATEWAY_INVALID_RESPONSE';
  error.statusCode = statusCode;
  return error;
}

function gatewayTimeoutError(statusCode) {
  const error = new Error('Robot gateway request timed out');
  error.name = 'AbortError';
  error.code = 'ROBOT_NETWORK_TIMEOUT';
  if (Number.isFinite(statusCode)) error.statusCode = statusCode;
  return error;
}

async function cancelGatewayResponse(response) {
  try { await response?.body?.cancel?.(); } catch {}
}

async function readGatewayResponseText(response, signal, cancelResponseImpl) {
  const getHeader = response.headers?.get;
  const rawContentLength = typeof getHeader === 'function'
    ? getHeader.call(response.headers, 'content-length')
    : undefined;
  if (rawContentLength !== undefined && rawContentLength !== null) {
    if (!/^\d{1,12}$/.test(rawContentLength) || Number(rawContentLength) > MAX_GATEWAY_RESPONSE_BYTES) {
      await cancelGatewayResponse(response);
      throw invalidGatewayResponse(response.status);
    }
  }
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const bytes = await readBoundedByteStream(reader, {
      signal,
      maxBytes: MAX_GATEWAY_RESPONSE_BYTES,
      invalidError: () => invalidGatewayResponse(response.status),
      tooLargeError: () => invalidGatewayResponse(response.status)
    });
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
      throw invalidGatewayResponse(response.status);
    }
  }
  // Native fetch implementations that do not expose a byte stream must give
  // us an authenticated Content-Length before text() is allowed to allocate.
  if (rawContentLength === undefined || rawContentLength === null) {
    await cancelGatewayResponse(response);
    throw invalidGatewayResponse(response.status);
  }
  if (typeof response.text !== 'function') throw invalidGatewayResponse(response.status);
  const cancelOnAbort = () => {
    void Promise.resolve(
      cancelResponseImpl ? cancelResponseImpl() : cancelGatewayResponse(response)
    ).catch(() => {});
  };
  if (signal?.aborted) cancelOnAbort();
  else signal?.addEventListener('abort', cancelOnAbort, { once: true });
  let text;
  try {
    text = await response.text();
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
  }
  if (typeof text !== 'string' || utf8ByteLength(text) > MAX_GATEWAY_RESPONSE_BYTES) {
    throw invalidGatewayResponse(response.status);
  }
  return text;
}

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

function normalizeIndoorPosition(value, currentTime, maximumAgeMs) {
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
  const capturedAt = Number(value.captured_at);
  if ((!roomId && !hasCoordinates)
    || !Number.isSafeInteger(capturedAt)
    || capturedAt <= 0
    || capturedAt > currentTime + MAX_TELEMETRY_CLOCK_SKEW_MS
    || currentTime - capturedAt > maximumAgeMs) return undefined;
  return {
    ...(roomId ? { roomId } : {}),
    ...(floorId ? { floorId } : {}),
    ...(mapId ? { mapId } : {}),
    ...(hasCoordinates ? { xMeters: x, yMeters: y } : {}),
    ...(Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1
      ? { confidence: value.confidence }
      : {}),
    capturedAt
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
    this.timeoutMs = Number(timeoutMs);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120000) {
      throw new Error('Robot gateway timeout is invalid');
    }
    this.loadNetwork = loadNetwork;
    this.networkSubscription = null;
    this.networkMonitoringGeneration = 0;
    this.networkAvailable = null;
    this.lifecycleGeneration = 0;
    this.explicitlyDisconnected = false;
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
    this.connectInFlight = null;
    this.latestTelemetryAt = 0;
    this.retryAttempt = 0;
    this.commandStore = commandStore || (accountId ? {
      enqueue: enqueueDeviceCommand,
      load: loadDeviceCommands,
      acknowledge: acknowledgeDeviceCommand
    } : null);
  }

  lifecycleError() {
    if (this.disposed) return this.disposedError();
    const error = new Error('Robot device is disconnected.');
    error.code = 'DEVICE_DISCONNECTED';
    return error;
  }

  isLifecycleCurrent(generation) {
    return !this.disposed
      && !this.explicitlyDisconnected
      && generation === this.lifecycleGeneration;
  }

  assertLifecycleCurrent(generation) {
    if (!this.isLifecycleCurrent(generation)) throw this.lifecycleError();
  }

  async request(path, options = {}, lifecycleGeneration = this.lifecycleGeneration) {
    this.assertLifecycleCurrent(lifecycleGeneration);
    if (!this.gatewayURL) {
      const error = new Error('Robot gateway is not configured');
      error.code = 'ROBOT_GATEWAY_NOT_CONFIGURED';
      this.setStatus({ online: false, connectionState: 'disconnected', lastErrorCode: error.code });
      throw error;
    }
    const controller = new AbortController();
    this.activeRequestControllers.add(controller);
    let response;
    let timedOut = false;
    let responseCancelled = false;
    let timeoutHandle;
    const cancelResponse = async () => {
      if (!response || responseCancelled) return;
      responseCancelled = true;
      await cancelGatewayResponse(response);
    };
    try {
      const operation = (async () => {
        const providedAccessToken = await this.accessTokenProvider?.();
        this.assertLifecycleCurrent(lifecycleGeneration);
        const accessToken = providedAccessToken || this.accessToken;
        const providedPairingToken = await this.pairingTokenProvider?.(this.deviceId);
        this.assertLifecycleCurrent(lifecycleGeneration);
        const pairingToken = providedPairingToken || this.pairingToken;
        if (timedOut) throw gatewayTimeoutError();
        if (path.startsWith('/v1/') && this.pairingTokenProvider && !pairingToken) {
          const error = new Error('Robot pairing credential is unavailable');
          error.code = 'ROBOT_PAIRING_CREDENTIAL_MISSING';
          throw error;
        }
        response = await this.fetchImpl(`${this.gatewayURL}${path}`, {
          ...options,
          redirect: 'error',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(pairingToken ? { 'X-Device-Pairing-Token': pairingToken } : {}),
            ...options.headers
          }
        });
        if (!this.isLifecycleCurrent(lifecycleGeneration)) {
          // AbortController is advisory: a native or mocked fetch may resolve
          // after disconnect. Start body cleanup before rejecting the stale
          // lifecycle so that response cannot retain its socket indefinitely.
          void cancelResponse();
          throw this.lifecycleError();
        }
        if (timedOut) {
          await cancelResponse();
          throw gatewayTimeoutError(response?.status);
        }
        if (!response.ok) {
          await cancelResponse();
          this.assertLifecycleCurrent(lifecycleGeneration);
          throw Object.assign(new Error('Robot gateway request failed'), { statusCode: response.status });
        }
        if (response.status === 204) {
          await cancelResponse();
          this.assertLifecycleCurrent(lifecycleGeneration);
          return null;
        }
        const responseText = await readGatewayResponseText(response, controller.signal, cancelResponse);
        this.assertLifecycleCurrent(lifecycleGeneration);
        if (timedOut) {
          await cancelResponse();
          throw gatewayTimeoutError(response?.status);
        }
        if (typeof responseText !== 'string' || utf8ByteLength(responseText) > MAX_GATEWAY_RESPONSE_BYTES) {
          throw invalidGatewayResponse(response.status);
        }
        if (!responseText) return { accepted: true, status: response.status };
        try {
          const parsed = JSON.parse(responseText);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw invalidGatewayResponse(response.status);
          }
          return parsed;
        } catch (error) {
          if (error?.code === 'ROBOT_GATEWAY_INVALID_RESPONSE') throw error;
          throw invalidGatewayResponse(response.status);
        }
      })();
      void operation.catch(() => {});
      const timeout = new Promise((_, reject) => {
        timeoutHandle = this.setTimeoutImpl(() => {
          timedOut = true;
          controller.abort();
          void cancelResponse();
          reject(gatewayTimeoutError(response?.status));
        }, this.timeoutMs);
      });
      return await Promise.race([operation, timeout]);
    } catch (error) {
      const relayResponded = Number.isFinite(error?.statusCode);
      const telemetryRequest = /\/telemetry(?:\?|$)/.test(path);
      const lastErrorCode = error?.code === 'ROBOT_GATEWAY_INVALID_RESPONSE'
        ? error.code
        : error?.name === 'AbortError'
        ? 'ROBOT_NETWORK_TIMEOUT'
        : relayResponded ? `ROBOT_GATEWAY_HTTP_${error.statusCode}` : 'ROBOT_NETWORK_UNAVAILABLE';
      if (this.isLifecycleCurrent(lifecycleGeneration)) {
        if (!relayResponded) this.pauseCommandQueue();
        this.setStatus(relayResponded && telemetryRequest ? {
        relayOnline: true,
        online: false,
        hardwareStatus: 'unknown',
        connectionState: 'disconnected',
        navigationPath: null,
        lastErrorCode
      } : relayResponded ? {
        // A command/status HTTP failure proves the relay answered, not that a
        // fresh independent hardware telemetry sample became false.
        relayOnline: true,
        lastErrorCode
      } : {
        relayOnline: false,
        online: false,
        hardwareStatus: 'unknown',
        connectionState: 'disconnected',
        lastErrorCode
        });
      }
      throw error;
    } finally {
      if (timeoutHandle !== undefined) this.clearTimeoutImpl(timeoutHandle);
      this.activeRequestControllers.delete(controller);
    }
  }

  connect() {
    if (this.disposed) return Promise.reject(this.disposedError());
    if (this.connectInFlight) return this.connectInFlight;
    let operation;
    operation = this.performConnect().finally(() => {
      if (this.connectInFlight === operation) this.connectInFlight = null;
    });
    this.connectInFlight = operation;
    return operation;
  }

  async performConnect() {
    if (this.disposed) throw this.disposedError();
    this.explicitlyDisconnected = false;
    const lifecycleGeneration = this.lifecycleGeneration;
    const status = await this.request('/health', {}, lifecycleGeneration);
    this.assertLifecycleCurrent(lifecycleGeneration);
    const relayOnline = status?.status === 'ok';
    const next = this.setStatus({
      relayOnline,
      online: false,
      hardwareStatus: 'unknown',
      connectionState: relayOnline ? 'unknown' : 'disconnected',
      lastErrorCode: null
    });
    if (!relayOnline) this.pauseCommandQueue();
    if (relayOnline) {
      const telemetryPromise = this.refreshTelemetry(lifecycleGeneration);
      let pendingCommandsPromise;
      try {
        // Durable work may predate commands already parked in this process.
        // Stage it at critical priority before resuming so recovery preserves
        // persisted FIFO ordering instead of running newer work first.
        const staged = await this.stagePendingCommands(lifecycleGeneration, { priority: 'critical' });
        this.assertLifecycleCurrent(lifecycleGeneration);
        this.resumeCommandQueue();
        pendingCommandsPromise = Promise.allSettled(staged);
      } catch (error) {
        // A failed durable scan is not proof that it is safe to run only the
        // in-memory suffix. Keep the queue parked and retry the full recovery.
        pendingCommandsPromise = Promise.reject(error);
      }
      const [telemetry, pendingCommands] = await Promise.allSettled([
        telemetryPromise,
        pendingCommandsPromise
      ]);
      this.assertLifecycleCurrent(lifecycleGeneration);
      const commandQueueDrained = pendingCommands.status === 'fulfilled'
        && pendingCommands.value.every((result) => result.status === 'fulfilled');
      const telemetryUsable = telemetry.status === 'fulfilled'
        && telemetry.value?.invalid !== true
        && telemetry.value?.stale !== true;
      if (telemetryUsable && commandQueueDrained) this.clearNetworkRetry();
      else this.scheduleNetworkRetry();
      this.startTelemetryPolling();
    }
    return this.getStatus();
  }

  async disconnect() {
    this.explicitlyDisconnected = true;
    this.lifecycleGeneration += 1;
    this.networkMonitoringGeneration += 1;
    this.pauseCommandQueue();
    this.clearNetworkRetry();
    this.stopTelemetryPolling();
    this.telemetryInFlight = null;
    this.connectInFlight = null;
    this.pendingScan = null;
    for (const controller of this.activeRequestControllers) controller.abort();
    this.activeRequestControllers.clear();
    this.networkSubscription?.remove?.();
    this.networkSubscription = null;
    return this.setStatus({ relayOnline: false, online: false, hardwareStatus: 'unknown', connectionState: 'disconnected' });
  }

  startTelemetryPolling() {
    if (this.disposed || this.explicitlyDisconnected || this.telemetryTimer) return;
    this.telemetryTimer = this.setIntervalImpl(() => {
      if (this.disposed || this.explicitlyDisconnected) return;
      return this.refreshTelemetry().catch(() => this.scheduleNetworkRetry());
    }, this.telemetryIntervalMs);
    this.telemetryTimer?.unref?.();
  }

  stopTelemetryPolling() {
    if (this.telemetryTimer !== null) this.clearIntervalImpl(this.telemetryTimer);
    this.telemetryTimer = null;
  }

  async deliverQueuedCommand(queued) {
    const lifecycleGeneration = this.lifecycleGeneration;
    this.assertLifecycleCurrent(lifecycleGeneration);
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
      }, lifecycleGeneration);
    } catch (error) {
      this.scheduleNetworkRetry();
      throw error;
    }
    await this.commandStore?.acknowledge(queued.id);
    if (this.isLifecycleCurrent(lifecycleGeneration)) {
      this.setStatus({ relayOnline: true, lastErrorCode: null });
    }
    return result;
  }

  scheduleQueuedCommand(queued, { priority = 'standard' } = {}) {
    if (!queued?.id) return this.enqueueCommand(() => this.deliverQueuedCommand(queued), { priority });
    const scheduled = this.scheduledCommands.get(queued.id);
    if (scheduled) return scheduled;
    let operation;
    operation = this.enqueueCommand(() => this.deliverQueuedCommand(queued), { priority }).finally(() => {
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

  async stagePendingCommands(lifecycleGeneration = this.lifecycleGeneration, { priority = 'critical' } = {}) {
    if (!this.commandStore) return [];
    if (this.pendingScan) return this.pendingScan;
    let scan;
    scan = (async () => {
      const pending = await this.commandStore.load(this.accountId, this.deviceId);
      this.assertLifecycleCurrent(lifecycleGeneration);
      return pending.map((queued) => this.scheduleQueuedCommand(queued, { priority }));
    })().finally(() => {
      if (this.pendingScan === scan) this.pendingScan = null;
    });
    this.pendingScan = scan;
    return scan;
  }

  async retryPendingCommands(lifecycleGeneration = this.lifecycleGeneration) {
    const staged = await this.stagePendingCommands(lifecycleGeneration, { priority: 'critical' });
    return Promise.allSettled(staged);
  }

  async startNetworkMonitoring() {
    if (this.disposed || this.networkSubscription) return;
    this.explicitlyDisconnected = false;
    const generation = ++this.networkMonitoringGeneration;
    const Network = await this.loadNetwork();
    if (this.disposed || this.explicitlyDisconnected || generation !== this.networkMonitoringGeneration || this.networkSubscription) return;
    const handleNetworkState = (state) => {
      if (this.disposed || this.explicitlyDisconnected || generation !== this.networkMonitoringGeneration) return;
      if (state.isConnected === true && state.isInternetReachable !== false) {
        this.networkAvailable = true;
        this.connect().catch(() => this.scheduleNetworkRetry());
      } else if (state.isConnected === false || state.isInternetReachable === false) {
        this.networkAvailable = false;
        this.lifecycleGeneration += 1;
        this.pauseCommandQueue();
        this.clearNetworkRetry();
        this.stopTelemetryPolling();
        this.telemetryInFlight = null;
        this.connectInFlight = null;
        this.pendingScan = null;
        for (const controller of this.activeRequestControllers) controller.abort();
        this.activeRequestControllers.clear();
        this.setStatus({ relayOnline: false, online: false, hardwareStatus: 'unknown', connectionState: 'disconnected', lastErrorCode: 'ROBOT_NETWORK_UNAVAILABLE' });
      }
    };
    this.networkSubscription = Network.addNetworkStateListener(handleNetworkState);
    const current = await Network.getNetworkStateAsync?.();
    if (current && generation === this.networkMonitoringGeneration) handleNetworkState(current);
  }

  clearNetworkRetry() {
    if (this.retryTimer !== null) this.clearTimeoutImpl(this.retryTimer);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  scheduleNetworkRetry() {
    if (this.disposed || this.explicitlyDisconnected || this.networkAvailable === false || this.retryTimer) return;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.retryAttempt, 6));
    this.retryAttempt += 1;
    this.retryTimer = this.setTimeoutImpl(() => {
      this.retryTimer = null;
      if (this.disposed || this.explicitlyDisconnected) return;
      this.connect().catch(() => this.scheduleNetworkRetry());
    }, delay);
    this.retryTimer?.unref?.();
  }

  dispose() {
    this.explicitlyDisconnected = true;
    this.networkAvailable = false;
    this.lifecycleGeneration += 1;
    this.networkMonitoringGeneration += 1;
    this.pauseCommandQueue();
    super.dispose();
    this.clearNetworkRetry();
    this.stopTelemetryPolling();
    for (const controller of this.activeRequestControllers) controller.abort();
    this.activeRequestControllers.clear();
    this.telemetryInFlight = null;
    this.connectInFlight = null;
    this.pendingScan = null;
    this.networkSubscription?.remove?.();
    this.networkSubscription = null;
  }

  async refreshTelemetry(lifecycleGeneration = this.lifecycleGeneration) {
    this.assertLifecycleCurrent(lifecycleGeneration);
    if (this.telemetryInFlight) return this.telemetryInFlight;
    let operation;
    operation = (async () => {
      let telemetry;
      try {
        telemetry = await this.request(
          `/v1/devices/${encodeURIComponent(this.deviceId)}/telemetry`,
          {},
          lifecycleGeneration
        );
      } catch (error) {
        if (this.isLifecycleCurrent(lifecycleGeneration)) this.stopTelemetryPolling();
        throw error;
      }
      this.assertLifecycleCurrent(lifecycleGeneration);
      const suppliedReportedAt = Number(telemetry?.reported_at);
      const currentTime = this.now();
      if (
        !Number.isSafeInteger(suppliedReportedAt)
        || suppliedReportedAt <= 0
        || suppliedReportedAt > currentTime + MAX_TELEMETRY_CLOCK_SKEW_MS
      ) {
        this.setStatus({
          relayOnline: true,
          online: false,
          hardwareStatus: 'unknown',
          connectionState: 'disconnected',
          navigationPath: null,
          lastErrorCode: 'ROBOT_TELEMETRY_TIMESTAMP_INVALID'
        });
        return { ...telemetry, invalid: true };
      }
      const reportedAt = suppliedReportedAt;
      if (typeof telemetry?.online !== 'boolean') {
        this.setStatus({
          relayOnline: true,
          online: false,
          hardwareStatus: 'unknown',
          connectionState: 'disconnected',
          navigationPath: null,
          indoorPosition: null,
          lastErrorCode: 'ROBOT_TELEMETRY_SCHEMA_INVALID'
        });
        return { ...telemetry, invalid: true };
      }
      if (reportedAt < this.latestTelemetryAt) return { ...telemetry, ignored: true };
      if (currentTime - reportedAt > this.telemetryMaxAgeMs) {
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
      const indoorPosition = normalizeIndoorPosition(
        telemetry?.indoor_position,
        currentTime,
        this.telemetryMaxAgeMs
      );
      const battery = Number(telemetry?.battery?.percentage);
      const hasBattery = Number.isInteger(battery) && battery >= 0 && battery <= 100;
      const statusPatch = {
        relayOnline: true,
        lastErrorCode: null,
        navigationPath: path || null,
        indoorPosition: indoorPosition || null,
        lastSeenAt: reportedAt,
        ...(location ? { location } : {}),
        ...(hasBattery ? {
          battery,
          ...(typeof telemetry.battery.charging === 'boolean'
            ? { batteryCharging: telemetry.battery.charging }
            : {})
        } : {})
      };
      Object.assign(statusPatch, {
        online: telemetry.online,
        hardwareStatus: telemetry.online ? 'online' : 'offline',
        connectionState: telemetry.online ? 'connected' : 'disconnected'
      });
      this.assertLifecycleCurrent(lifecycleGeneration);
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
