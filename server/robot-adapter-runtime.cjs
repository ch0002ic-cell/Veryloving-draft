'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  createManufacturerPairingVerifier,
  createManufacturerPrivacyClient,
  createManufacturerRobotResetClient
} = require('./manufacturer-client.cjs');

const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SUPPORTED_VENDORS = new Set(['yongyida', 'jiangzhi']);
const MEDICATION_ACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MOCK_MANUFACTURER_API_KEY = 'mock-server-only-api-key';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function loadCompiledAdapterModule(modulePath = path.join(__dirname, 'dist', 'adapters')) {
  try {
    return require(modulePath);
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND') {
      throw new Error('Robot adapter build is missing; run npm run build:adapters before starting the gateway');
    }
    throw error;
  }
}

function normalizeURL(value, label, { production }) {
  if (!value) return '';
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  if (production && parsed.protocol !== 'https:') throw new Error(`${label} must use HTTPS in production`);
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${label} must not contain credentials, query parameters, or fragments`);
  }
  return parsed.toString();
}

function mockManufacturerURLFromEnv(env, { production }) {
  const value = env.MOCK_MANUFACTURER_URL;
  if (!value) return '';
  if (production || !['development', 'test'].includes(env.NODE_ENV)) {
    throw new Error('MOCK_MANUFACTURER_URL is allowed only when NODE_ENV is development or test');
  }
  const normalized = normalizeURL(value, 'Mock manufacturer URL', { production: false });
  const parsed = new URL(normalized);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(hostname)
    || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.pathname !== '/') {
    throw new Error('MOCK_MANUFACTURER_URL must be a loopback origin without a path');
  }
  return normalized;
}

function mockManufacturerAPIKeyFromEnv(env, mockManufacturerURL) {
  if (!mockManufacturerURL) return '';
  const apiKey = env.MOCK_MANUFACTURER_API_KEY || DEFAULT_MOCK_MANUFACTURER_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 4096) {
    throw new Error('MOCK_MANUFACTURER_API_KEY is invalid');
  }
  const vendorKeys = [env.YONGYIDA_BRIDGE_API_KEY, env.JIANGZHI_BRIDGE_API_KEY]
    .filter((value) => typeof value === 'string' && value.length > 0);
  if (vendorKeys.includes(apiKey)) {
    throw new Error('MOCK_MANUFACTURER_API_KEY must differ from vendor bridge credentials');
  }
  return apiKey;
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const selected = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return selected;
}

function adapterTimestamp(value, label) {
  const timestamp = Number.isSafeInteger(value) ? Number(value) : Date.parse(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error(`${label} timestamp is invalid`);
  return timestamp;
}

function normalizeConfiguration(raw, { production = false } = {}) {
  if (!raw || !SUPPORTED_VENDORS.has(raw.vendor)) throw new Error('Robot adapter vendor is invalid');
  if (!ADAPTER_ID_PATTERN.test(raw.adapterId || '')) throw new Error('Robot adapter id is invalid');
  const baseUrl = normalizeURL(raw.baseUrl, `${raw.adapterId} bridge URL`, { production });
  if (!baseUrl) throw new Error(`${raw.adapterId} bridge URL is required`);
  if (typeof raw.apiKey !== 'string' || raw.apiKey.length < (production ? 32 : 8)) {
    throw new Error(`${raw.adapterId} bridge API key is invalid`);
  }
  if (typeof raw.callbackApiKey !== 'string' || raw.callbackApiKey.length < (production ? 32 : 8)) {
    throw new Error(`${raw.adapterId} callback API key is invalid`);
  }
  return Object.freeze({
    vendor: raw.vendor,
    adapterId: raw.adapterId,
    baseUrl,
    apiKey: raw.apiKey,
    callbackApiKey: raw.callbackApiKey,
    pairingVerifyURL: normalizeURL(raw.pairingVerifyURL, `${raw.adapterId} pairing URL`, { production }),
    resetURL: normalizeURL(raw.resetURL, `${raw.adapterId} reset URL`, { production }),
    privacyExportURL: normalizeURL(raw.privacyExportURL, `${raw.adapterId} privacy export URL`, { production }),
    privacyDeleteURL: normalizeURL(raw.privacyDeleteURL, `${raw.adapterId} privacy deletion URL`, { production }),
    timeoutMs: boundedInteger(raw.timeoutMs, 5000, 1, 120000, 'Robot adapter timeout'),
    maxAttempts: boundedInteger(raw.maxAttempts, 3, 1, 5, 'Robot adapter maximum attempts'),
    retryBaseDelayMs: boundedInteger(raw.retryBaseDelayMs, 100, 0, 30000, 'Robot adapter retry base'),
    retryMaxDelayMs: boundedInteger(raw.retryMaxDelayMs, 2000, 0, 60000, 'Robot adapter retry maximum'),
    allowInsecureHttp: !production && raw.allowInsecureHttp === true
  });
}

function adapterConfigurationsFromEnv(env = process.env, { production = env.NODE_ENV === 'production' } = {}) {
  const mockManufacturerURL = mockManufacturerURLFromEnv(env, { production });
  const mockManufacturerAPIKey = mockManufacturerAPIKeyFromEnv(env, mockManufacturerURL);
  const definitions = [
    {
      enabled: env.YONGYIDA_ADAPTER_ENABLED === 'true',
      vendor: 'yongyida',
      adapterId: env.YONGYIDA_ADAPTER_ID || 'yongyida-cloud',
      baseUrl: mockManufacturerURL || env.YONGYIDA_BRIDGE_URL || '',
      apiKey: mockManufacturerAPIKey || env.YONGYIDA_BRIDGE_API_KEY || '',
      callbackApiKey: env.YONGYIDA_CALLBACK_API_KEY || '',
      pairingVerifyURL: mockManufacturerURL ? '' : env.YONGYIDA_PAIRING_VERIFY_URL || '',
      resetURL: mockManufacturerURL ? '' : env.YONGYIDA_RESET_URL || '',
      privacyExportURL: mockManufacturerURL ? '' : env.YONGYIDA_PRIVACY_EXPORT_URL || '',
      privacyDeleteURL: mockManufacturerURL ? '' : env.YONGYIDA_PRIVACY_DELETE_URL || ''
    },
    {
      enabled: env.JIANGZHI_ADAPTER_ENABLED === 'true',
      vendor: 'jiangzhi',
      adapterId: env.JIANGZHI_ADAPTER_ID || 'jiangzhi-edge',
      baseUrl: mockManufacturerURL || env.JIANGZHI_BRIDGE_URL || '',
      apiKey: mockManufacturerAPIKey || env.JIANGZHI_BRIDGE_API_KEY || '',
      callbackApiKey: env.JIANGZHI_CALLBACK_API_KEY || '',
      pairingVerifyURL: mockManufacturerURL ? '' : env.JIANGZHI_PAIRING_VERIFY_URL || '',
      resetURL: mockManufacturerURL ? '' : env.JIANGZHI_RESET_URL || '',
      privacyExportURL: mockManufacturerURL ? '' : env.JIANGZHI_PRIVACY_EXPORT_URL || '',
      privacyDeleteURL: mockManufacturerURL ? '' : env.JIANGZHI_PRIVACY_DELETE_URL || ''
    }
  ];
  return definitions.filter((entry) => entry.enabled).map((entry) => normalizeConfiguration({
    ...entry,
    timeoutMs: Number(env.ROBOT_ADAPTER_TIMEOUT_MS || 5000),
    maxAttempts: Number(env.ROBOT_ADAPTER_MAX_ATTEMPTS || 3),
    retryBaseDelayMs: Number(env.ROBOT_ADAPTER_RETRY_BASE_MS || 100),
    retryMaxDelayMs: Number(env.ROBOT_ADAPTER_RETRY_MAX_MS || 2000),
    allowInsecureHttp: mockManufacturerURL
      ? new URL(mockManufacturerURL).protocol === 'http:'
      : env.ROBOT_ADAPTER_ALLOW_INSECURE_HTTP === 'true'
  }, { production }));
}

class RobotAdapterRuntime {
  constructor({
    configurations = [],
    factoryClass,
    adapterModule,
    fetchImpl = globalThis.fetch,
    logger = console,
    now = Date.now,
    telemetryMaxAgeMs = 5 * 60 * 1000,
    telemetryFutureSkewMs = 60 * 1000,
    pairingIdempotencySecret,
    production = false
  } = {}) {
    this.configurations = new Map();
    const callbackCredentials = new Set();
    const outboundCredentials = new Set();
    for (const raw of configurations) {
      const configuration = normalizeConfiguration(raw, { production });
      if (this.configurations.has(configuration.adapterId)) throw new Error('Robot adapter id is duplicated');
      if (callbackCredentials.has(configuration.callbackApiKey)
        || configuration.callbackApiKey === configuration.apiKey
        || outboundCredentials.has(configuration.callbackApiKey)
        || callbackCredentials.has(configuration.apiKey)) {
        throw new Error('Robot adapter callback credentials must be unique and separate from outbound credentials');
      }
      callbackCredentials.add(configuration.callbackApiKey);
      outboundCredentials.add(configuration.apiKey);
      this.configurations.set(configuration.adapterId, configuration);
    }
    const module = adapterModule || (factoryClass ? null : loadCompiledAdapterModule());
    this.Factory = factoryClass || module?.AdapterFactory;
    if (typeof this.Factory !== 'function') throw new Error('Compiled Robot AdapterFactory is unavailable');
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.now = now;
    this.pairingIdempotencySecret = pairingIdempotencySecret;
    this.telemetryMaxAgeMs = boundedInteger(telemetryMaxAgeMs, 5 * 60 * 1000, 1, 24 * 60 * 60 * 1000, 'Robot telemetry maximum age');
    this.telemetryFutureSkewMs = boundedInteger(telemetryFutureSkewMs, 60 * 1000, 0, 5 * 60 * 1000, 'Robot telemetry future skew');
  }

  get size() { return this.configurations.size; }

  requireConfiguration(adapterId) {
    const configuration = this.configurations.get(adapterId);
    if (!configuration) throw Object.assign(new Error('Robot adapter is not configured'), { code: 'ROBOT_ADAPTER_NOT_CONFIGURED' });
    return configuration;
  }

  resolvePairingAdapterId(selector) {
    if (this.configurations.has(selector)) return selector;
    if (SUPPORTED_VENDORS.has(selector)) {
      const matches = [...this.configurations.values()].filter((entry) => entry.vendor === selector);
      if (matches.length === 1) return matches[0].adapterId;
    }
    throw Object.assign(new Error('Robot adapter is not configured'), { code: 'ROBOT_ADAPTER_NOT_CONFIGURED' });
  }

  createAdapter(configuration, onAttempt) {
    const factory = new this.Factory({
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      wallClockNow: this.now,
      onAttempt: async (operation, attempt) => {
        if (operation === 'deliver_signed_action') await onAttempt?.(attempt);
      }
    });
    const {
      callbackApiKey: _callback,
      pairingVerifyURL: _pairing,
      resetURL: _reset,
      privacyExportURL: _privacyExport,
      privacyDeleteURL: _privacyDelete,
      ...adapterConfiguration
    } = configuration;
    return factory.create(adapterConfiguration);
  }

  async deliverSignedAction(adapterId, signedAction, { onAttempt } = {}) {
    const configuration = this.requireConfiguration(adapterId);
    if (signedAction?.envelope?.adapter_id !== adapterId
      || signedAction?.envelope?.version !== 2
      || signedAction?.envelope?.contract_version !== 'vl-robot-action/2'
      || !Number.isSafeInteger(signedAction?.envelope?.binding_epoch)
      || signedAction.envelope.binding_epoch <= 0
      || !DEVICE_ID_PATTERN.test(signedAction?.envelope?.manufacturer_device_id || '')) {
      throw Object.assign(new Error('Signed robot action does not match its adapter binding'), {
        code: 'ROBOT_ADAPTER_BINDING_MISMATCH'
      });
    }
    const adapter = this.createAdapter(configuration, onAttempt);
    await adapter.initialize({ deviceId: signedAction.envelope.manufacturer_device_id });
    const result = await adapter.deliverSignedAction(signedAction);
    return Object.freeze({ status: result.statusCode, acknowledged: result.acknowledged });
  }

  async getDeviceStatus(adapterId, manufacturerDeviceId) {
    const configuration = this.requireConfiguration(adapterId);
    if (!DEVICE_ID_PATTERN.test(manufacturerDeviceId || '')) throw new Error('Manufacturer device id is invalid');
    const adapter = this.createAdapter(configuration);
    await adapter.initialize({ deviceId: manufacturerDeviceId });
    const status = await adapter.getDeviceStatus();
    return this.normalizeDeviceStatus(status);
  }

  normalizeDeviceStatus(status, currentTime = this.now()) {
    const reportedAt = adapterTimestamp(status.observedAt, 'Robot adapter status');
    if (!Number.isSafeInteger(currentTime) || currentTime <= 0) throw new Error('Robot adapter clock is invalid');
    if (reportedAt > currentTime + this.telemetryFutureSkewMs
      || currentTime - reportedAt > this.telemetryMaxAgeMs) {
      return Object.freeze({
        online: false,
        hardware_status: 'unknown',
        reported_at: reportedAt,
        telemetry_error: reportedAt > currentTime ? 'future_timestamp' : 'stale_timestamp'
      });
    }
    return Object.freeze({
      online: status.online === true,
      hardware_status: status.state,
      reported_at: reportedAt,
      ...(status.firmwareVersion ? { firmware_version: status.firmwareVersion } : {})
    });
  }

  async getTelemetrySnapshot(adapterId, manufacturerDeviceId) {
    const configuration = this.requireConfiguration(adapterId);
    if (!DEVICE_ID_PATTERN.test(manufacturerDeviceId || '')) throw new Error('Manufacturer device id is invalid');
    const adapter = this.createAdapter(configuration);
    await adapter.initialize({ deviceId: manufacturerDeviceId });
    const snapshot = await adapter.getTelemetrySnapshot();
    const currentTime = this.now();
    const normalizedStatus = this.normalizeDeviceStatus(snapshot.status, currentTime);
    // Never relay sensor/event data when its authoritative status timestamp is
    // stale or in the future. The mobile client still receives a deterministic
    // offline status and can surface the telemetry_error without trusting data.
    if (normalizedStatus.telemetry_error) return normalizedStatus;

    const freshTimestamp = (value, label, maximumAgeMs = this.telemetryMaxAgeMs) => {
      const timestamp = adapterTimestamp(value, label);
      return timestamp <= currentTime + this.telemetryFutureSkewMs
        && currentTime - timestamp <= maximumAgeMs;
    };
    // Optional spatial telemetry is fail-closed: a bridge or custom adapter
    // using the older timestamp-less shape must not inherit status freshness.
    const freshOptionalTimestamp = (value, label) => {
      if (!Number.isSafeInteger(value) || value <= 0) return false;
      return freshTimestamp(value, label);
    };
    const battery = snapshot.battery
      && freshTimestamp(snapshot.battery.observedAt, 'Robot adapter battery')
      && Object.freeze({
        percentage: snapshot.battery.percentage,
        charging: snapshot.battery.charging,
        observed_at: adapterTimestamp(snapshot.battery.observedAt, 'Robot adapter battery')
      });
    const freshVitals = snapshot.vitals?.filter((vital) => (
      freshTimestamp(vital.observedAt, 'Robot adapter vital')
    ));
    const vitals = freshVitals?.length ? Object.freeze(
      freshVitals.map((vital) => Object.freeze({
        kind: vital.kind,
        value: vital.value,
        unit: vital.unit,
        observed_at: adapterTimestamp(vital.observedAt, 'Robot adapter vital'),
        ...(vital.quality ? { quality: vital.quality } : {})
      }))
    ) : undefined;
    const location = snapshot.location
      && freshOptionalTimestamp(snapshot.location.capturedAt, 'Robot adapter location')
      && Object.freeze({
        longitude: snapshot.location.longitude,
        latitude: snapshot.location.latitude
      });
    const navigationPath = snapshot.navigationPath
      && freshOptionalTimestamp(snapshot.navigationPath.capturedAt, 'Robot adapter navigation path')
      && Object.freeze(
        snapshot.navigationPath.coordinates.map((point) => Object.freeze([...point]))
      );
    const indoorPosition = snapshot.indoorPosition
      && freshOptionalTimestamp(snapshot.indoorPosition.capturedAt, 'Robot adapter indoor position')
      && Object.freeze({
        ...(snapshot.indoorPosition.mapId ? { map_id: snapshot.indoorPosition.mapId } : {}),
        ...(snapshot.indoorPosition.floorId ? { floor_id: snapshot.indoorPosition.floorId } : {}),
        ...(snapshot.indoorPosition.roomId ? { room_id: snapshot.indoorPosition.roomId } : {}),
        ...(snapshot.indoorPosition.xMeters === undefined ? {} : {
          x_m: snapshot.indoorPosition.xMeters,
          y_m: snapshot.indoorPosition.yMeters
        }),
        ...(snapshot.indoorPosition.confidence === undefined ? {} : {
          confidence: snapshot.indoorPosition.confidence
        }),
        captured_at: snapshot.indoorPosition.capturedAt
      });
    const freshSafetyEvents = snapshot.safetyEvents?.filter((event) => (
      freshTimestamp(event.occurredAt, 'Robot adapter safety event')
    ));
    const safetyEvents = freshSafetyEvents?.length ? Object.freeze(
      freshSafetyEvents.map((event) => Object.freeze({
        event_type: event.eventType,
        event_id: event.eventId,
        occurred_at: event.occurredAt,
        ...(event.confidence === undefined ? {} : { confidence: event.confidence })
      }))
    ) : undefined;
    const freshMedicationAcknowledgements = snapshot.medicationAcknowledgements?.filter((acknowledgement) => (
      freshTimestamp(
        acknowledgement.deliveredAt,
        'Robot adapter medication acknowledgement',
        MEDICATION_ACK_MAX_AGE_MS
      )
    ));
    const medicationAcknowledgements = freshMedicationAcknowledgements?.length ? Object.freeze(
      freshMedicationAcknowledgements.map((acknowledgement) => Object.freeze({
        reminder_id: acknowledgement.reminderId,
        receipt_id: acknowledgement.receiptId,
        delivered_at: acknowledgement.deliveredAt
      }))
    ) : undefined;
    return Object.freeze({
      ...normalizedStatus,
      ...(battery ? { battery } : {}),
      ...(vitals ? { vitals } : {}),
      ...(location ? { location } : {}),
      ...(navigationPath ? { navigation_path: navigationPath } : {}),
      ...(indoorPosition ? { indoor_position: indoorPosition } : {}),
      ...(safetyEvents ? { safety_events: safetyEvents } : {}),
      ...(medicationAcknowledgements ? { medication_acknowledgements: medicationAcknowledgements } : {})
    });
  }

  async verifyPairingCode(adapterSelector, qrCode) {
    const adapterId = this.resolvePairingAdapterId(adapterSelector);
    const configuration = this.requireConfiguration(adapterId);
    if (!configuration.pairingVerifyURL) {
      throw Object.assign(new Error('Robot pairing is not configured for this adapter'), { statusCode: 503 });
    }
    const verifier = createManufacturerPairingVerifier({
      url: configuration.pairingVerifyURL,
      apiKey: configuration.apiKey,
      adapterId,
      idempotencySecret: this.pairingIdempotencySecret || configuration.apiKey,
      fetchImpl: this.fetchImpl,
      timeoutMs: configuration.timeoutMs
    });
    return verifier(qrCode);
  }

  async resetRobot(adapterId, resetRequest) {
    const configuration = this.requireConfiguration(adapterId);
    const manufacturerDeviceId = resetRequest?.manufacturerDeviceId;
    if (!DEVICE_ID_PATTERN.test(manufacturerDeviceId || '')) throw new Error('Manufacturer device id is invalid');
    if (!configuration.resetURL) {
      throw Object.assign(new Error('Robot reset is not configured for this adapter'), {
        statusCode: 503,
        code: 'ROBOT_ADAPTER_RESET_NOT_CONFIGURED'
      });
    }
    const reset = createManufacturerRobotResetClient({
      url: configuration.resetURL,
      apiKey: configuration.apiKey,
      fetchImpl: this.fetchImpl,
      timeoutMs: configuration.timeoutMs
    });
    return reset(resetRequest);
  }

  privacyClient(adapterId) {
    const configuration = this.requireConfiguration(adapterId);
    return createManufacturerPrivacyClient({
      exportURL: configuration.privacyExportURL,
      deleteURL: configuration.privacyDeleteURL,
      apiKey: configuration.apiKey,
      fetchImpl: this.fetchImpl,
      timeoutMs: configuration.timeoutMs
    });
  }

  exportRobotData(adapterId, manufacturerDeviceIds) {
    return this.privacyClient(adapterId).exportRobotData(manufacturerDeviceIds);
  }

  deleteRobotData(adapterId, manufacturerDeviceIds) {
    return this.privacyClient(adapterId).deleteRobotData(manufacturerDeviceIds);
  }

  authenticateCallback(adapterId, presentedKey) {
    const configuration = this.configurations.get(adapterId);
    return Boolean(configuration && safeEqual(presentedKey, configuration.callbackApiKey));
  }
}

function createRobotAdapterRuntime(options = {}) {
  return new RobotAdapterRuntime(options);
}

module.exports = {
  RobotAdapterRuntime,
  adapterConfigurationsFromEnv,
  createRobotAdapterRuntime,
  loadCompiledAdapterModule,
  mockManufacturerAPIKeyFromEnv,
  mockManufacturerURLFromEnv,
  normalizeConfiguration,
  safeEqual
};
