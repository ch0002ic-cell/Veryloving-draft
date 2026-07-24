import { RobotAdapterError } from './AdapterErrors';
import {
  type BatteryInfo,
  type CallStatus,
  type CommandResult,
  type DeviceStatus,
  type IndoorPosition,
  type MedicationAcknowledgement,
  type NavigationCoordinate,
  type Medication,
  type RobotAdapter,
  type RobotAdapterOperationOptions,
  type RobotConfig,
  type RobotCredentials,
  type RobotLocation,
  type RobotNavigationPath,
  type RobotSafetyEvent,
  type RobotTelemetrySnapshot,
  type RobotVendor,
  type SafetyFinding,
  type SafetyReport,
  type SignedActionDeliveryResult,
  type SignedRobotAction,
  type User,
  type VitalSign,
  type VitalSignKind
} from './RobotAdapter';
import {
  createStructuredAdapterLogger,
  createSafeAdapterReference,
  type AdapterLogSink,
  type StructuredAdapterLogger
} from './StructuredAdapterLogger';

const { providerVoiceLocaleTag } = require('../../voice-locales.cjs') as {
  providerVoiceLocaleTag(
    value: unknown,
    options?: { readonly allowCatalogCode?: boolean }
  ): string | undefined;
};

export interface BridgeResponseHeaders {
  get?(name: string): string | null;
}

export interface BridgeBodyReader {
  read(): Promise<{ readonly done: boolean; readonly value?: Uint8Array }>;
  cancel?(): Promise<void>;
}

export interface BridgeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: BridgeResponseHeaders;
  readonly body?: { getReader(): BridgeBodyReader } | null;
  arrayBuffer?(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
}

export interface BridgeRequestInit {
  readonly method: 'POST';
  readonly redirect: 'error';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly signal: unknown;
}

export type FetchLike = (url: string, init: BridgeRequestInit) => Promise<BridgeResponse>;

export interface AdapterMetric {
  readonly adapterId: string;
  readonly vendor: RobotVendor;
  readonly operation: string;
  readonly attempt: number;
  readonly latencyMs: number;
  readonly outcome: 'success' | 'retry' | 'failure';
  readonly statusCode?: number;
  readonly errorCode?: string;
}

export interface RestRobotAdapterOptions {
  readonly adapterId: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxRequestBytes?: number;
  readonly maxTelemetryPages?: number;
  readonly allowInsecureHttp?: boolean;
  /** Explicit test/prototype gate. Production side effects use signed actions. */
  readonly allowProvisionalUnsignedCommands?: boolean;
  readonly logger?: AdapterLogSink;
  readonly onMetric?: (metric: AdapterMetric) => void;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly random?: () => number;
  readonly idGenerator?: () => string;
  /** Awaited immediately before each physical transport attempt. */
  readonly onAttempt?: (
    operation: string,
    attempt: number,
    signal?: AbortSignal
  ) => void | Promise<void>;
  /** Epoch clock for signed-action freshness; kept separate from metric time. */
  readonly wallClockNow?: () => number;
}

interface JsonObject {
  readonly [key: string]: unknown;
}

interface RequestOptions<T> {
  readonly operation: string;
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string;
  readonly allowUninitialized?: boolean;
  readonly expiresAt?: number;
  readonly signal?: AbortSignal;
  /** Parse the operation schema before transport success is recorded. */
  readonly parseResponse: (payload: JsonObject, statusCode: number) => T;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
// Must remain identical to ActionGateway's signed adapter_id allowlist.
const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const COMMAND_STATES = new Set(['accepted', 'completed', 'rejected']);
const SIGNED_ACTION_STATES = new Set(['accepted', 'completed', 'rejected']);
const CALL_STATES = new Set(['accepted', 'ringing', 'connected', 'ended', 'failed']);
const DEVICE_STATES = new Set(['online', 'offline', 'degraded', 'busy']);
const VITAL_KINDS = new Set<VitalSignKind>([
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'blood_glucose',
  'heart_rate',
  'oxygen_saturation',
  'respiratory_rate',
  'temperature'
]);
const TELEMETRY_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TELEMETRY_RECEIPT_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_SNAPSHOT_VITALS = 100;
const MAX_NAVIGATION_POINTS = 500;
const MAX_SAFETY_EVENTS = 20;
const MAX_MEDICATION_ACKNOWLEDGEMENTS = 20;

function invalidRequest(message: string): RobotAdapterError {
  return new RobotAdapterError('ADAPTER_REQUEST_INVALID', message);
}

function assertString(
  value: unknown,
  field: string,
  maximum: number,
  pattern?: RegExp
): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || (pattern && !pattern.test(value))) {
    throw invalidRequest(`${field} is invalid`);
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredObject(value: unknown): JsonObject {
  if (!isObject(value)) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  return value;
}

function requiredString(value: unknown, maximum = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  return value;
}

function requiredTimestamp(value: unknown): string {
  const timestamp = requiredString(value, 64);
  const milliseconds = Date.parse(timestamp);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  return timestamp;
}

function parseContentLength(response: BridgeResponse): number | undefined {
  const raw = response.headers?.get?.('content-length');
  if (!raw || !/^\d{1,12}$/.test(raw)) return undefined;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : undefined;
}

async function readBoundedBytes(
  response: BridgeResponse,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const advertisedLength = parseContentLength(response);
  if (advertisedLength !== undefined && advertisedLength > maximumBytes) {
    try { await response.body?.getReader().cancel?.(); } catch {}
    throw new RobotAdapterError('ADAPTER_RESPONSE_TOO_LARGE', 'Robot bridge response exceeds the configured limit');
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const cancelOnAbort = (): void => { void Promise.resolve(reader.cancel?.()).catch(() => undefined); };
    if (signal?.aborted) cancelOnAbort();
    else signal?.addEventListener('abort', cancelOnAbort, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) {
          await reader.cancel?.();
          throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
        }
        length += chunk.value.byteLength;
        if (length > maximumBytes) {
          await reader.cancel?.();
          throw new RobotAdapterError('ADAPTER_RESPONSE_TOO_LARGE', 'Robot bridge response exceeds the configured limit');
        }
        chunks.push(chunk.value);
      }
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  if (typeof response.arrayBuffer === 'function') {
    if (advertisedLength === undefined) {
      throw new RobotAdapterError(
        'ADAPTER_RESPONSE_INVALID',
        'Robot bridge response cannot be read within the configured limit'
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      throw new RobotAdapterError('ADAPTER_RESPONSE_TOO_LARGE', 'Robot bridge response exceeds the configured limit');
    }
    return bytes;
  }

  if (typeof response.text === 'function') {
    if (advertisedLength === undefined) {
      throw new RobotAdapterError(
        'ADAPTER_RESPONSE_INVALID',
        'Robot bridge response cannot be read within the configured limit'
      );
    }
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maximumBytes) {
      throw new RobotAdapterError('ADAPTER_RESPONSE_TOO_LARGE', 'Robot bridge response exceeds the configured limit');
    }
    return bytes;
  }

  throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
}

export async function readBoundedJsonObject(
  response: BridgeResponse,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<JsonObject> {
  const bytes = await readBoundedBytes(response, maximumBytes, signal);
  if (bytes.byteLength === 0) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof RobotAdapterError) throw error;
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid', { cause: error });
  }
  return requiredObject(payload);
}

function defaultNow(): number {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelledError());
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(cancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function cancelledError(): RobotAdapterError {
  return new RobotAdapterError('ADAPTER_CANCELLED', 'Robot adapter operation was cancelled');
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}

async function awaitWithCancellation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  throwIfCancelled(signal);
  let rejectCancellation: ((error: RobotAdapterError) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
  const onAbort = (): void => rejectCancellation?.(cancelledError());
  signal.addEventListener('abort', onAbort, { once: true });
  void operation.catch(() => undefined);
  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function defaultIdGenerator(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') {
    throw new RobotAdapterError(
      'ADAPTER_CONFIGURATION_INVALID',
      'A cryptographically secure id generator is required'
    );
  }
  return randomUUID.call(globalThis.crypto);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot adapter configuration is invalid');
  }
  return selected;
}

function parseCommandResult(payload: JsonObject): CommandResult {
  const commandId = requiredString(payload.command_id, 128);
  const state = requiredString(payload.state, 32);
  if (!COMMAND_STATES.has(state)
    || typeof payload.success !== 'boolean'
    || (state === 'rejected') === payload.success) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  const acceptedAt = payload.accepted_at === undefined ? undefined : requiredTimestamp(payload.accepted_at);
  return Object.freeze({
    success: payload.success,
    commandId,
    state: state as CommandResult['state'],
    ...(acceptedAt === undefined ? {} : { acceptedAt })
  });
}

function parseSafetyReport(payload: JsonObject): SafetyReport {
  const commandId = requiredString(payload.command_id, 128);
  if (typeof payload.accepted !== 'boolean' || !Array.isArray(payload.findings) || payload.findings.length > 100) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  const findings: SafetyFinding[] = payload.findings.map((rawFinding) => {
    const finding = requiredObject(rawFinding);
    const code = requiredString(finding.code, 64);
    const severity = requiredString(finding.severity, 16);
    if (!['info', 'warning', 'critical'].includes(severity)) {
      throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
    }
    return Object.freeze({ code, severity: severity as SafetyFinding['severity'] });
  });
  return Object.freeze({ commandId, accepted: payload.accepted, findings: Object.freeze(findings) });
}

function parseCallStatus(payload: JsonObject): CallStatus {
  const commandId = requiredString(payload.command_id, 128);
  const state = requiredString(payload.state, 32);
  if (!CALL_STATES.has(state)) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  return Object.freeze({ commandId, state: state as CallStatus['state'] });
}

function parseBatteryInfo(payload: JsonObject): BatteryInfo {
  if (!Number.isInteger(payload.percentage)
    || Number(payload.percentage) < 0
    || Number(payload.percentage) > 100
    || typeof payload.charging !== 'boolean') {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  return Object.freeze({
    percentage: Number(payload.percentage),
    charging: payload.charging,
    observedAt: requiredTimestamp(payload.observed_at)
  });
}

function parseDeviceStatus(payload: JsonObject): DeviceStatus {
  const state = requiredString(payload.state, 32);
  if (typeof payload.online !== 'boolean'
    || !DEVICE_STATES.has(state)
    || payload.online !== (state !== 'offline')) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  const firmwareVersion = payload.firmware_version === undefined
    ? undefined
    : requiredString(payload.firmware_version, 64);
  return Object.freeze({
    online: payload.online,
    state: state as DeviceStatus['state'],
    observedAt: requiredTimestamp(payload.observed_at),
    ...(firmwareVersion === undefined ? {} : { firmwareVersion })
  });
}

function parseVitalSign(value: unknown): VitalSign {
  const payload = requiredObject(value);
  const kind = requiredString(payload.kind, 64) as VitalSignKind;
  const unit = requiredString(payload.unit, 32);
  const quality = payload.quality === undefined ? undefined : requiredString(payload.quality, 16);
  if (!VITAL_KINDS.has(kind)
    || typeof payload.value !== 'number'
    || !Number.isFinite(payload.value)
    || (quality !== undefined && !['good', 'uncertain', 'poor'].includes(quality))) {
    throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
  }
  return Object.freeze({
    kind,
    value: payload.value,
    unit,
    observedAt: requiredTimestamp(payload.observed_at),
    ...(quality === undefined ? {} : { quality: quality as VitalSign['quality'] })
  });
}

function invalidResponse(): never {
  throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge response is invalid');
}

function parseLocation(value: unknown): RobotLocation {
  const payload = requiredObject(value);
  if (typeof payload.longitude !== 'number'
    || !Number.isFinite(payload.longitude)
    || Math.abs(payload.longitude) > 180
    || typeof payload.latitude !== 'number'
    || !Number.isFinite(payload.latitude)
    || Math.abs(payload.latitude) > 90
    || !Number.isSafeInteger(payload.captured_at)
    || Number(payload.captured_at) <= 0) invalidResponse();
  return Object.freeze({
    longitude: payload.longitude,
    latitude: payload.latitude,
    capturedAt: Number(payload.captured_at)
  });
}

function parseNavigationCoordinate(value: unknown): NavigationCoordinate {
  const longitude = Array.isArray(value) ? value[0] : isObject(value) ? value.longitude : undefined;
  const latitude = Array.isArray(value) ? value[1] : isObject(value) ? value.latitude : undefined;
  if ((Array.isArray(value) && value.length !== 2)
    || typeof longitude !== 'number'
    || !Number.isFinite(longitude)
    || Math.abs(longitude) > 180
    || typeof latitude !== 'number'
    || !Number.isFinite(latitude)
    || Math.abs(latitude) > 90) invalidResponse();
  return Object.freeze([longitude, latitude]) as NavigationCoordinate;
}

function parseNavigationPath(value: unknown): RobotNavigationPath {
  const payload = requiredObject(value);
  if (!Array.isArray(payload.points)
    || payload.points.length < 2
    || payload.points.length > MAX_NAVIGATION_POINTS
    || !Number.isSafeInteger(payload.captured_at)
    || Number(payload.captured_at) <= 0) invalidResponse();
  return Object.freeze({
    coordinates: Object.freeze(payload.points.map(parseNavigationCoordinate)),
    capturedAt: Number(payload.captured_at)
  });
}

function optionalTelemetryIdentifier(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TELEMETRY_IDENTIFIER_PATTERN.test(value)) invalidResponse();
  return value;
}

function parseIndoorPosition(value: unknown): IndoorPosition {
  const payload = requiredObject(value);
  const mapId = optionalTelemetryIdentifier(payload.map_id);
  const floorId = optionalTelemetryIdentifier(payload.floor_id);
  const roomId = optionalTelemetryIdentifier(payload.room_id);
  const hasX = payload.x_m !== undefined;
  const hasY = payload.y_m !== undefined;
  const hasCoordinates = hasX && hasY;
  if (hasX !== hasY
    || (hasCoordinates && (!mapId
      || typeof payload.x_m !== 'number'
      || !Number.isFinite(payload.x_m)
      || Math.abs(payload.x_m) > 10_000
      || typeof payload.y_m !== 'number'
      || !Number.isFinite(payload.y_m)
      || Math.abs(payload.y_m) > 10_000))
    || (!roomId && !hasCoordinates)
    || (payload.confidence !== undefined && (typeof payload.confidence !== 'number'
      || !Number.isFinite(payload.confidence)
      || payload.confidence < 0
      || payload.confidence > 1))
    || !Number.isSafeInteger(payload.captured_at)
    || Number(payload.captured_at) <= 0) invalidResponse();
  return Object.freeze({
    ...(mapId === undefined ? {} : { mapId }),
    ...(floorId === undefined ? {} : { floorId }),
    ...(roomId === undefined ? {} : { roomId }),
    ...(hasCoordinates ? { xMeters: Number(payload.x_m), yMeters: Number(payload.y_m) } : {}),
    ...(payload.confidence === undefined ? {} : { confidence: payload.confidence as number }),
    capturedAt: Number(payload.captured_at)
  });
}

function parseSafetyEvents(value: unknown): readonly RobotSafetyEvent[] {
  if (!Array.isArray(value) || value.length > MAX_SAFETY_EVENTS) invalidResponse();
  return Object.freeze(value.map((candidate) => {
    const payload = requiredObject(candidate);
    const eventType = requiredString(payload.event_type, 32);
    const eventId = requiredString(payload.event_id, 128);
    if (!['fall', 'fall_detected'].includes(eventType)
      || !TELEMETRY_RECEIPT_PATTERN.test(eventId)
      || !Number.isSafeInteger(payload.occurred_at)
      || Number(payload.occurred_at) <= 0
      || (payload.confidence !== undefined && (typeof payload.confidence !== 'number'
        || !Number.isFinite(payload.confidence)
        || payload.confidence < 0
        || payload.confidence > 1))) invalidResponse();
    return Object.freeze({
      eventType: 'fall' as const,
      eventId,
      occurredAt: Number(payload.occurred_at),
      ...(payload.confidence === undefined ? {} : { confidence: payload.confidence as number })
    });
  }));
}

function parseMedicationAcknowledgements(value: unknown): readonly MedicationAcknowledgement[] {
  if (!Array.isArray(value) || value.length > MAX_MEDICATION_ACKNOWLEDGEMENTS) invalidResponse();
  return Object.freeze(value.map((candidate) => {
    const payload = requiredObject(candidate);
    const reminderId = requiredString(payload.reminder_id, 128);
    const receiptId = requiredString(payload.receipt_id, 128);
    if (!TELEMETRY_RECEIPT_PATTERN.test(reminderId)
      || !TELEMETRY_RECEIPT_PATTERN.test(receiptId)
      || !Number.isSafeInteger(payload.delivered_at)
      || Number(payload.delivered_at) <= 0) invalidResponse();
    return Object.freeze({
      reminderId,
      receiptId,
      deliveredAt: Number(payload.delivered_at)
    });
  }));
}

function parseTelemetrySnapshot(payload: JsonObject): RobotTelemetrySnapshot {
  const status = parseDeviceStatus(requiredObject(payload.status));
  const battery = payload.battery === undefined ? undefined : parseBatteryInfo(requiredObject(payload.battery));
  let vitals: readonly VitalSign[] | undefined;
  if (payload.vitals !== undefined) {
    if (!Array.isArray(payload.vitals) || payload.vitals.length > MAX_SNAPSHOT_VITALS) invalidResponse();
    vitals = Object.freeze(payload.vitals.map(parseVitalSign));
  }
  const location = payload.location === undefined ? undefined : parseLocation(payload.location);
  const navigationPath = payload.navigation_path === undefined
    ? undefined
    : parseNavigationPath(payload.navigation_path);
  const indoorPosition = payload.indoor_position === undefined
    ? undefined
    : parseIndoorPosition(payload.indoor_position);
  const safetyEvents = payload.safety_events === undefined
    ? undefined
    : parseSafetyEvents(payload.safety_events);
  const medicationAcknowledgements = payload.medication_acknowledgements === undefined
    ? undefined
    : parseMedicationAcknowledgements(payload.medication_acknowledgements);
  return Object.freeze({
    status,
    ...(battery === undefined ? {} : { battery }),
    ...(vitals === undefined ? {} : { vitals }),
    ...(location === undefined ? {} : { location }),
    ...(navigationPath === undefined ? {} : { navigationPath }),
    ...(indoorPosition === undefined ? {} : { indoorPosition }),
    ...(safetyEvents === undefined ? {} : { safetyEvents }),
    ...(medicationAcknowledgements === undefined ? {} : { medicationAcknowledgements })
  });
}

interface VitalPage {
  readonly items: readonly VitalSign[];
  readonly nextCursor?: string;
}

function parseVitalPage(payload: JsonObject): VitalPage {
  if (!Array.isArray(payload.items) || payload.items.length > 100) invalidResponse();
  const nextCursor = payload.next_cursor === undefined || payload.next_cursor === null
    ? undefined
    : requiredString(payload.next_cursor, 256);
  return Object.freeze({
    items: Object.freeze(payload.items.map(parseVitalSign)),
    ...(nextCursor === undefined ? {} : { nextCursor })
  });
}

/** Shared hardened transport for the provisional Veryloving bridge contracts. */
export abstract class RestRobotAdapter implements RobotAdapter {
  readonly adapterId!: string;
  readonly vendor!: RobotVendor;

  protected abstract readonly contractPrefix: string;
  protected abstract translateOperation(operation: string): string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxRequestBytes: number;
  private readonly maxTelemetryPages: number;
  private readonly logger: StructuredAdapterLogger;
  private readonly onMetric?: (metric: AdapterMetric) => void;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly idGenerator: () => string;
  private readonly onAttempt?: (
    operation: string,
    attempt: number,
    signal?: AbortSignal
  ) => void | Promise<void>;
  private readonly wallClockNow: () => number;
  private readonly allowProvisionalUnsignedCommands: boolean;

  private initializedDeviceId?: string;
  private sessionToken?: string;
  private initializationPromise?: Promise<void>;
  private initializationKey?: string;

  protected constructor(vendor: RobotVendor, options: RestRobotAdapterOptions) {
    if (!ADAPTER_ID_PATTERN.test(options.adapterId)) {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot adapter id is invalid');
    }
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(options.baseUrl);
    } catch (error) {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot bridge URL is invalid', { cause: error });
    }
    if (parsedBaseUrl.username || parsedBaseUrl.password
      || (parsedBaseUrl.protocol !== 'https:' && !(options.allowInsecureHttp === true && parsedBaseUrl.protocol === 'http:'))) {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot bridge URL is invalid');
    }
    if (typeof options.apiKey !== 'string' || options.apiKey.length < 8 || options.apiKey.length > 4096) {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot bridge credentials are invalid');
    }
    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    if (typeof fetchImpl !== 'function') {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Native fetch is unavailable');
    }

    Object.defineProperty(this, 'adapterId', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: options.adapterId
    });
    Object.defineProperty(this, 'vendor', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: vendor
    });

    parsedBaseUrl.pathname = parsedBaseUrl.pathname.replace(/\/*$/, '/');
    parsedBaseUrl.search = '';
    parsedBaseUrl.hash = '';
    this.baseUrl = parsedBaseUrl.toString();
    this.apiKey = options.apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = boundedInteger(options.timeoutMs, 5_000, 1, 120_000);
    this.maxAttempts = boundedInteger(options.maxAttempts, 3, 1, 5);
    this.retryBaseDelayMs = boundedInteger(options.retryBaseDelayMs, 100, 0, 30_000);
    this.retryMaxDelayMs = boundedInteger(options.retryMaxDelayMs, 2_000, 0, 60_000);
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, 64 * 1024, 128, 1024 * 1024);
    this.maxRequestBytes = boundedInteger(options.maxRequestBytes, 64 * 1024, 128, 1024 * 1024);
    this.maxTelemetryPages = boundedInteger(options.maxTelemetryPages, 100, 1, 1_000);
    this.logger = createStructuredAdapterLogger(options.logger);
    this.onMetric = options.onMetric;
    this.now = options.now ?? defaultNow;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.idGenerator = options.idGenerator ?? defaultIdGenerator;
    this.onAttempt = options.onAttempt;
    this.wallClockNow = options.wallClockNow ?? Date.now;
    if (options.allowProvisionalUnsignedCommands !== undefined
      && typeof options.allowProvisionalUnsignedCommands !== 'boolean') {
      throw new RobotAdapterError('ADAPTER_CONFIGURATION_INVALID', 'Robot adapter configuration is invalid');
    }
    this.allowProvisionalUnsignedCommands = options.allowProvisionalUnsignedCommands === true;
  }

  async initialize(
    credentials: RobotCredentials,
    options: RobotAdapterOperationOptions = {}
  ): Promise<void> {
    throwIfCancelled(options.signal);
    assertString(credentials?.deviceId, 'deviceId', 256, IDENTIFIER_PATTERN);
    if (credentials.pairingToken !== undefined) {
      assertString(credentials.pairingToken, 'pairingToken', 4096);
    }
    if (this.initializedDeviceId !== undefined) {
      if (this.initializedDeviceId !== credentials.deviceId) {
        throw new RobotAdapterError(
          'ADAPTER_INITIALIZATION_CONFLICT',
          'Robot adapter is already bound to another device'
        );
      }
      throwIfCancelled(options.signal);
      return;
    }

    const key = `${credentials.deviceId}\u0000${credentials.pairingToken ?? ''}`;
    if (this.initializationPromise) {
      if (this.initializationKey !== key) {
        throw new RobotAdapterError(
          'ADAPTER_INITIALIZATION_CONFLICT',
          'Robot adapter initialization is already in progress'
        );
      }
      return awaitWithCancellation(this.initializationPromise, options.signal);
    }

    this.initializationKey = key;
    this.initializationPromise = this.performInitialization(credentials, options.signal)
      .finally(() => {
        // A failed attempt must not poison future initialization. The one-time
        // claim is not retained in adapter state after either outcome.
        this.initializationPromise = undefined;
        this.initializationKey = undefined;
      });
    return this.initializationPromise;
  }

  private async performInitialization(credentials: RobotCredentials, signal?: AbortSignal): Promise<void> {
    const sessionToken = await this.requestJson({
      operation: 'initialize',
      path: 'session',
      allowUninitialized: true,
      signal,
      body: {
        schema_version: 'veryloving.robot-bridge.v1',
        device_id: credentials.deviceId,
        ...(credentials.pairingToken === undefined ? {} : { pairing_token: credentials.pairingToken })
      },
      parseResponse: (payload) => {
        if (payload.authenticated !== true) {
          throw new RobotAdapterError('ADAPTER_AUTH_FAILED', 'Robot bridge authentication failed');
        }
        return payload.session_token === undefined
          ? undefined
          : requiredString(payload.session_token, 4096);
      }
    });
    throwIfCancelled(signal);
    this.initializedDeviceId = credentials.deviceId;
    this.sessionToken = sessionToken;
  }

  async sendMedicationReminder(medication: Medication, user: User): Promise<CommandResult> {
    assertString(medication?.id, 'medication.id', 128, IDENTIFIER_PATTERN);
    assertString(medication.name, 'medication.name', 256);
    assertString(user?.id, 'user.id', 256, IDENTIFIER_PATTERN);
    if (medication.dosage !== undefined) assertString(medication.dosage, 'medication.dosage', 256);
    if (medication.instructions !== undefined) assertString(medication.instructions, 'medication.instructions', 2_048);
    if (medication.scheduledAt !== undefined && !Number.isFinite(Date.parse(medication.scheduledAt))) {
      throw invalidRequest('medication.scheduledAt is invalid');
    }
    const preferredLanguage = user.preferredLanguage === undefined
      ? undefined
      : providerVoiceLocaleTag(user.preferredLanguage, { allowCatalogCode: true });
    if (user.preferredLanguage !== undefined && !preferredLanguage) {
      throw invalidRequest('user.preferredLanguage is invalid or unsupported');
    }
    return this.sendCommand('send_medication_reminder', {
      medication: {
        id: medication.id,
        name: medication.name,
        ...(medication.dosage === undefined ? {} : { dosage: medication.dosage }),
        ...(medication.instructions === undefined ? {} : { instructions: medication.instructions }),
        ...(medication.scheduledAt === undefined ? {} : { scheduled_at: medication.scheduledAt })
      },
      user: {
        id: user.id,
        ...(preferredLanguage === undefined ? {} : { preferred_language: preferredLanguage })
      }
    }, medication.requestId);
  }

  async activateFallAlert(location: string): Promise<CommandResult> {
    assertString(location, 'location', 256);
    return this.sendCommand('activate_fall_alert', { location });
  }

  async streamVitals(): Promise<AsyncIterable<VitalSign>> {
    this.requireInitialized();
    const adapter = this;
    return Object.freeze({
      async *[Symbol.asyncIterator](): AsyncIterator<VitalSign> {
        let cursor: string | undefined;
        for (let pageNumber = 0; pageNumber < adapter.maxTelemetryPages; pageNumber += 1) {
          const page = await adapter.requestJson({
            operation: 'stream_vitals',
            path: 'telemetry/vitals/query',
            body: {
              device_id: adapter.initializedDeviceId,
              ...(cursor === undefined ? {} : { cursor })
            },
            parseResponse: parseVitalPage
          });
          for (const vital of page.items) yield vital;
          if (page.nextCursor === undefined) return;
          cursor = page.nextCursor;
        }
        throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge telemetry pagination limit exceeded');
      }
    });
  }

  async executeSafetyCheck(area: string): Promise<SafetyReport> {
    assertString(area, 'area', 256);
    return this.sendCommandPayload('execute_safety_check', { area }, undefined, parseSafetyReport);
  }

  async playSoothingAudio(audioId: string, volume: number): Promise<CommandResult> {
    assertString(audioId, 'audioId', 128, IDENTIFIER_PATTERN);
    if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
      throw invalidRequest('volume is invalid');
    }
    return this.sendCommand('play_soothing_audio', { audio_id: audioId, volume });
  }

  async startTwoWayVoiceCall(contactId: string): Promise<CallStatus> {
    assertString(contactId, 'contactId', 128, IDENTIFIER_PATTERN);
    return this.sendCommandPayload('start_two_way_voice_call', { contact_id: contactId }, undefined, parseCallStatus);
  }

  async getBatteryStatus(): Promise<BatteryInfo> {
    this.requireInitialized();
    return this.requestJson({
      operation: 'get_battery_status',
      path: 'telemetry/battery/query',
      body: { device_id: this.initializedDeviceId },
      parseResponse: parseBatteryInfo
    });
  }

  async getDeviceStatus(): Promise<DeviceStatus> {
    this.requireInitialized();
    return this.requestJson({
      operation: 'get_device_status',
      path: 'telemetry/status/query',
      body: { device_id: this.initializedDeviceId },
      parseResponse: parseDeviceStatus
    });
  }

  async getTelemetrySnapshot(): Promise<RobotTelemetrySnapshot> {
    this.requireInitialized();
    return this.requestJson({
      operation: 'get_telemetry_snapshot',
      path: 'telemetry/snapshot/query',
      body: { device_id: this.initializedDeviceId },
      parseResponse: parseTelemetrySnapshot
    });
  }

  async emergencyStop(): Promise<CommandResult> {
    return this.sendCommand('emergency_stop', {});
  }

  async activateAlarm(): Promise<CommandResult> {
    return this.sendCommand('activate_alarm', {});
  }

  async setConfig(config: RobotConfig): Promise<CommandResult> {
    if (!isObject(config?.values) || Object.keys(config.values).length > 100) {
      throw invalidRequest('config is invalid');
    }
    return this.sendCommand('set_config', { values: config.values }, config.requestId);
  }

  async deliverSignedAction(
    action: SignedRobotAction,
    operationOptions: RobotAdapterOperationOptions = {}
  ): Promise<SignedActionDeliveryResult> {
    this.requireInitialized();
    if (!isObject(action)
      || !isObject(action.envelope)
      || action.algorithm !== 'Ed25519'
      || action.envelope.version !== 2
      || action.envelope.device_type !== 'home_robot'
      || action.envelope.contract_version !== 'vl-robot-action/2'
      || action.envelope.adapter_id !== this.adapterId
      || !IDENTIFIER_PATTERN.test(String(action.envelope.device_id ?? ''))
      || !IDENTIFIER_PATTERN.test(String(action.envelope.manufacturer_device_id ?? ''))
      || action.envelope.manufacturer_device_id !== this.initializedDeviceId
      || !Number.isSafeInteger(action.envelope.binding_epoch)
      || action.envelope.binding_epoch <= 0
      || !ACTION_ID_PATTERN.test(String(action.envelope.id ?? ''))
      || !Number.isSafeInteger(action.envelope.issued_at)
      || !Number.isSafeInteger(action.envelope.expires_at)
      || action.envelope.expires_at <= action.envelope.issued_at
      || typeof action.envelope.action !== 'string'
      || action.envelope.action.length < 1
      || action.envelope.action.length > 128
      || !isObject(action.envelope.parameters)
      || typeof action.payload !== 'string'
      || action.payload.length < 1
      || action.payload.length > 64 * 1024
      || !BASE64URL_PATTERN.test(action.payload)
      || typeof action.signature !== 'string'
      || action.signature.length < 40
      || action.signature.length > 512
      || !BASE64URL_PATTERN.test(action.signature)) {
      throw invalidRequest('Signed robot action is invalid or targets another device');
    }
    if (action.envelope.expires_at <= this.wallClockNow()) {
      throw new RobotAdapterError('ADAPTER_ACTION_EXPIRED', 'Signed robot action has expired');
    }
    return this.requestJson({
      operation: 'deliver_signed_action',
      path: 'signed-actions',
      idempotencyKey: action.envelope.id,
      // Intentionally preserve the exact signed object. Do not reconstruct the
      // envelope or translate its action into a vendor command here.
      body: action as unknown as Readonly<Record<string, unknown>>,
      expiresAt: action.envelope.expires_at,
      signal: operationOptions.signal,
      parseResponse: (result, statusCode) => {
        const actionId = requiredString(result.action_id, 128);
        const state = requiredString(result.state, 32);
        if (actionId !== action.envelope.id
          || !SIGNED_ACTION_STATES.has(state)
          || typeof result.ok !== 'boolean'
          || ![200, 202].includes(statusCode)
          || (statusCode === 202 && (state !== 'accepted' || result.ok !== true))
          // ActionGateway treats a synchronous acknowledgement as delivered,
          // so a 200 receipt must prove successful completion. Rejections
          // belong on the authenticated negative-ACK path.
          || (statusCode === 200 && (state !== 'completed' || result.ok !== true))) {
          throw new RobotAdapterError('ADAPTER_RESPONSE_INVALID', 'Robot bridge receipt is invalid');
        }
        const acknowledged = statusCode === 200;
        return Object.freeze({
          status: acknowledged ? 'acknowledged' : 'accepted',
          statusCode,
          acknowledged
        }) as SignedActionDeliveryResult;
      }
    });
  }

  private async sendCommand(
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
    idempotencyKey?: string
  ): Promise<CommandResult> {
    return this.sendCommandPayload(operation, parameters, idempotencyKey, parseCommandResult);
  }

  private async sendCommandPayload<T = JsonObject>(
    operation: string,
    parameters: Readonly<Record<string, unknown>>,
    idempotencyKey?: string,
    parseResponse: (payload: JsonObject, statusCode: number) => T = (payload) => payload as T
  ): Promise<T> {
    this.requireInitialized();
    if (!this.allowProvisionalUnsignedCommands) {
      throw new RobotAdapterError(
        'ADAPTER_REQUEST_REJECTED',
        'Unsigned direct robot commands are disabled; use a signed robot action'
      );
    }
    return this.requestJson({
      operation,
      path: 'commands',
      idempotencyKey,
      body: {
        schema_version: 'veryloving.robot-bridge.v1',
        device_id: this.initializedDeviceId,
        command: this.translateOperation(operation),
        parameters
      },
      parseResponse
    });
  }

  private requireInitialized(): void {
    if (this.initializedDeviceId === undefined) {
      throw new RobotAdapterError('ADAPTER_NOT_INITIALIZED', 'Robot adapter is not initialized');
    }
  }

  private buildUrl(path: string): string {
    return new URL(`${this.contractPrefix.replace(/^\/+|\/+$/g, '')}/${path.replace(/^\/+/, '')}`, this.baseUrl).toString();
  }

  private serializeBody(body: Readonly<Record<string, unknown>>): string {
    let serialized: string;
    try {
      serialized = JSON.stringify(body);
    } catch (error) {
      throw invalidRequest(error instanceof Error ? 'Request payload is not serializable' : 'Request payload is invalid');
    }
    if (new TextEncoder().encode(serialized).byteLength > this.maxRequestBytes) {
      throw invalidRequest('Request payload exceeds the configured limit');
    }
    return serialized;
  }

  private createIdempotencyKey(candidate?: string): string {
    const key = candidate ?? this.idGenerator();
    assertString(key, 'idempotencyKey', 128, IDENTIFIER_PATTERN);
    return key;
  }

  private async requestJson<T>(options: RequestOptions<T>): Promise<T> {
    throwIfCancelled(options.signal);
    if (!options.allowUninitialized) this.requireInitialized();
    const body = this.serializeBody(options.body);
    const idempotencyKey = this.createIdempotencyKey(options.idempotencyKey);
    const url = this.buildUrl(options.path);

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      if (options.expiresAt !== undefined && options.expiresAt <= this.wallClockNow()) {
        throw new RobotAdapterError('ADAPTER_ACTION_EXPIRED', 'Signed robot action has expired', {
          attempts: Math.max(0, attempt - 1)
        });
      }
      throwIfCancelled(options.signal);
      if (this.onAttempt) {
        const attemptHook = Promise.resolve().then(() => (
          this.onAttempt?.(options.operation, attempt, options.signal)
        ));
        await awaitWithCancellation(attemptHook, options.signal);
      }
      // The awaited hook can represent queue admission, a circuit breaker, or
      // a rate limiter. Never transmit a safety action that expired while it
      // was waiting at that boundary.
      if (options.expiresAt !== undefined && options.expiresAt <= this.wallClockNow()) {
        throw new RobotAdapterError('ADAPTER_ACTION_EXPIRED', 'Signed robot action has expired', {
          attempts: Math.max(0, attempt - 1)
        });
      }
      const startedAt = this.now();
      let response: BridgeResponse | undefined;
      let failure: RobotAdapterError | undefined;
      try {
        const successful = await this.fetchWithTimeout(url, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
            'X-Veryloving-Adapter-Protocol': 'veryloving.robot-bridge.v1',
            ...(this.sessionToken === undefined ? {} : { 'X-Veryloving-Session': this.sessionToken })
          },
          body,
          signal: undefined
        }, async (candidate, signal) => {
          response = candidate;
          if (candidate.status === 401 || candidate.status === 403) {
            await this.cancelResponseBody(candidate);
            throw new RobotAdapterError('ADAPTER_AUTH_FAILED', 'Robot bridge authentication failed', {
              statusCode: candidate.status,
              attempts: attempt
            });
          }
          if (!candidate.ok) {
            await this.cancelResponseBody(candidate);
            const retryable = RETRYABLE_STATUSES.has(candidate.status);
            throw new RobotAdapterError(
              retryable ? 'ADAPTER_UNAVAILABLE' : 'ADAPTER_REQUEST_REJECTED',
              retryable ? 'Robot bridge is temporarily unavailable' : 'Robot bridge rejected the request',
              { retryable, statusCode: candidate.status, attempts: attempt }
            );
          }
          return {
            responsePayload: await readBoundedJsonObject(candidate, this.maxResponseBytes, signal),
            statusCode: candidate.status
          };
        }, options.signal);
        const payload = options.parseResponse(successful.responsePayload, successful.statusCode);
        this.report('success', options.operation, attempt, startedAt, successful.statusCode);
        return payload;
      } catch (error) {
        failure = error instanceof RobotAdapterError
          ? error
          : new RobotAdapterError('ADAPTER_NETWORK_FAILED', 'Robot bridge network request failed', {
            retryable: true,
            attempts: attempt,
            cause: error
          });
      }

      const canRetry = failure.retryable && attempt < this.maxAttempts;
      this.report(canRetry ? 'retry' : 'failure', options.operation, attempt, startedAt, response?.status, failure.code);
      if (!canRetry) {
        if (failure.attempts === undefined) {
          throw new RobotAdapterError(failure.code, failure.message, {
            retryable: failure.retryable,
            statusCode: failure.statusCode,
            attempts: attempt,
            cause: failure
          });
        }
        throw failure;
      }
      await awaitWithCancellation(
        this.sleep(this.retryDelay(attempt, response), options.signal),
        options.signal
      );
    }

    throw new RobotAdapterError('ADAPTER_UNAVAILABLE', 'Robot bridge is temporarily unavailable');
  }

  private async fetchWithTimeout<T>(
    url: string,
    init: BridgeRequestInit,
    consume: (response: BridgeResponse, signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal
  ): Promise<T> {
    throwIfCancelled(externalSignal);
    const controller = new AbortController();
    let timedOut = false;
    let externallyCancelled = false;
    let response: BridgeResponse | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let rejectCancellation: ((error: RobotAdapterError) => void) | undefined;
    const cancel = (): void => {
      externallyCancelled = true;
      controller.abort();
      if (response) void this.cancelResponseBody(response);
      rejectCancellation?.(cancelledError());
    };
    externalSignal?.addEventListener('abort', cancel, { once: true });
    const request = (async () => {
      response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (externallyCancelled) {
        await this.cancelResponseBody(response);
        throw cancelledError();
      }
      if (timedOut) {
        await this.cancelResponseBody(response);
        throw new RobotAdapterError('ADAPTER_TIMEOUT', 'Robot bridge request timed out', { retryable: true });
      }
      return consume(response, controller.signal);
    })();
    // Some injected/vendor fetch implementations ignore AbortSignal. If such a
    // request or response body eventually resolves after our timeout, cancel
    // its body so it cannot retain an Undici connection or grow memory
    // unnoticed. The timeout remains armed through schema parsing, not merely
    // until HTTP headers arrive.
    void request.then(() => {
      if (timedOut && response) void this.cancelResponseBody(response);
    }, () => undefined);
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        if (response) void this.cancelResponseBody(response);
        reject(new RobotAdapterError('ADAPTER_TIMEOUT', 'Robot bridge request timed out', { retryable: true }));
      }, this.timeoutMs);
    });
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
      if (externalSignal?.aborted) cancel();
    });
    try {
      return await Promise.race([
        request,
        timeout,
        cancellation
      ]);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      externalSignal?.removeEventListener('abort', cancel);
    }
  }

  private async cancelResponseBody(response: BridgeResponse): Promise<void> {
    try {
      await response.body?.getReader().cancel?.();
    } catch {
      // Error responses are intentionally not parsed or logged.
    }
  }

  private retryDelay(attempt: number, response?: BridgeResponse): number {
    const retryAfterRaw = response?.headers?.get?.('retry-after');
    if (retryAfterRaw && /^\d{1,5}$/.test(retryAfterRaw)) {
      return Math.min(Number(retryAfterRaw) * 1_000, this.retryMaxDelayMs);
    }
    const exponential = Math.min(this.retryBaseDelayMs * (2 ** (attempt - 1)), this.retryMaxDelayMs);
    const random = Math.max(0, Math.min(1, this.random()));
    return Math.round(exponential * (0.8 + (random * 0.4)));
  }

  private report(
    outcome: AdapterMetric['outcome'],
    operation: string,
    attempt: number,
    startedAt: number,
    statusCode?: number,
    errorCode?: string
  ): void {
    const latencyMs = Math.max(0, Math.round(this.now() - startedAt));
    const metric: AdapterMetric = Object.freeze({
      // Metrics receive a stable pseudonymous reference, never an IP, serial,
      // account-bound device identifier, or caller-provided adapter label.
      adapterId: createSafeAdapterReference(this.adapterId),
      vendor: this.vendor,
      operation,
      attempt,
      latencyMs,
      outcome,
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(errorCode === undefined ? {} : { errorCode })
    });
    try {
      this.onMetric?.(metric);
    } catch {
      // Observability must never affect a safety-related command.
    }
    this.logger.write(
      outcome === 'success' ? 'info' : outcome === 'retry' ? 'warn' : 'error',
      `robot_adapter.request.${outcome}`,
      metric
    );
  }
}
