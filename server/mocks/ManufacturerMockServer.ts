/**
 * Development-only manufacturer simulator.
 *
 * This server exposes the small, vendor-neutral API requested for manual
 * partner testing and the provisional Veryloving bridge paths consumed by the
 * current Yongyida/Jiangzhi adapters. It is deliberately excluded from the
 * production TypeScript build and Docker image.
 */

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
  type KeyObject
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import { RobotEdgeAI } from '../src/edge/RobotEdgeAI';
import { WearableEdgeAI } from '../src/edge/WearableEdgeAI';

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_LATENCY_MIN_MS = 50;
const DEFAULT_LATENCY_MAX_MS = 200;
const DEFAULT_FAILURE_RATE = 0.05;
const DEFAULT_TELEMETRY_INTERVAL_MS = 1_000;
const DEFAULT_MAX_COMMAND_RECORDS = 10_000;
const DEFAULT_MAX_IDEMPOTENCY_RECORDS = 10_000;
const DEFAULT_MAX_QUEUED_COMMANDS_PER_DEVICE = 100;
const DEFAULT_MAX_QUEUE_KEYS = 1_000;
const DEFAULT_MAX_QUEUED_COMMANDS_TOTAL = 5_000;
const DEFAULT_MAX_CONNECTIONS = 100;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 200;
const DEFAULT_MAX_TELEMETRY_STREAMS = 25;
const DEFAULT_SIGNED_ACTION_FUTURE_SKEW_MS = 60_000;
const DEFAULT_FALL_EVENT_RATE = 0.001;
const DEFAULT_STRESS_EVENT_RATE = 0.01;
const DEFAULT_MEDICATION_REMINDER_EVERY_TICKS = 3_600;
const DEFAULT_MAX_SIMULATED_DEVICES = 100;
const DEFAULT_ASYNC_ACK_DELAY_MS = 25;
const DEFAULT_ASYNC_ACK_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_ASYNC_ACK_REQUEST_BYTES = 4 * 1024;
const DEFAULT_MAX_ASYNC_ACK_RESPONSE_BYTES = 4 * 1024;
const MAX_SIMULATION_EVENTS = 10;
const MAX_SCENARIO_EXECUTIONS = 10;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAMERA_SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCENARIO_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/;
const SCENARIO_STATUSES: readonly ManufacturerScenarioStatus[] = Object.freeze([
  'started', 'completed', 'fallback', 'failed', 'cancelled'
]);
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const BRIDGE_PROTOCOL = 'veryloving.robot-bridge.v1';
const BRIDGE_PREFIXES = Object.freeze({
  yongyida: '/v1/veryloving/yongyida-cloud',
  jiangzhi: '/v1/veryloving/jiangzhi-edge'
});
const BRIDGE_ADAPTER_IDS = Object.freeze({
  yongyida: 'yongyida-cloud',
  jiangzhi: 'jiangzhi-edge'
});

type ManufacturerVendor = keyof typeof BRIDGE_PREFIXES;
type JsonObject = Record<string, unknown>;

interface AsyncAcknowledgement {
  readonly actionId: string;
  readonly adapterId: string;
  readonly bindingEpoch: number;
  readonly cameraReady?: boolean;
  readonly cameraSessionRef?: string;
}

export type ManufacturerSimulationDeviceType = 'wearable' | 'home_robot';
export type ManufacturerSimulationEventType =
  | 'fall_detected'
  | 'stress_spike'
  | 'medication_reminder'
  | 'device_offline'
  | 'device_online'
  | 'scenario_execution';
export type ManufacturerScenarioStatus = 'started' | 'completed' | 'fallback' | 'failed' | 'cancelled';

export interface ManufacturerSimulationEvent {
  readonly eventId: string;
  readonly eventType: ManufacturerSimulationEventType;
  readonly deviceType: ManufacturerSimulationDeviceType | 'both';
  /** One-way references only. Raw device identifiers are never retained. */
  readonly deviceReferences: readonly string[];
  readonly occurredAt: number;
  readonly synthetic: true;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly scenarioId?: string;
  readonly scenarioStatus?: ManufacturerScenarioStatus;
}

export interface ManufacturerSimulationDeviceState {
  readonly deviceReference: string;
  readonly deviceType: ManufacturerSimulationDeviceType;
  readonly online: boolean;
  readonly batteryPercent: number;
  readonly status: string;
  readonly observedAt: number;
}

export interface ManufacturerScenarioExecutionRecord {
  readonly executionReference: string;
  readonly scenarioId: string;
  readonly status: ManufacturerScenarioStatus;
  readonly deviceReferences: readonly string[];
  readonly observedAt: number;
  readonly synthetic: true;
}

export interface RecordScenarioExecutionInput {
  readonly scenarioId: string;
  readonly status: ManufacturerScenarioStatus;
  readonly wearableDeviceId?: string;
  readonly robotDeviceId?: string;
}

export interface ManufacturerSimulationDashboard {
  readonly contractVersion: 'vl-manufacturer-simulation-dashboard/1';
  readonly synthetic: true;
  readonly generatedAt: number;
  readonly devices: readonly ManufacturerSimulationDeviceState[];
  readonly scenarioExecutions: readonly ManufacturerScenarioExecutionRecord[];
  readonly lastEvents: readonly ManufacturerSimulationEvent[];
}

export interface ManufacturerMockLogEntry {
  readonly event: 'manufacturer_mock.request' | 'manufacturer_mock.ack_callback';
  readonly requestId: string;
  readonly method: string;
  readonly route: string;
  readonly statusCode: number;
  readonly latencyMs: number;
  readonly deviceReference?: string;
}

export interface ManufacturerMockCommandRecord {
  readonly sequence: number;
  readonly deviceId: string;
  readonly command: string;
  readonly startedAt: number;
  readonly completedAt: number;
}

export interface ManufacturerMockServerOptions {
  readonly port?: number;
  readonly host?: '127.0.0.1' | 'localhost' | '::1';
  readonly latencyMinMs?: number;
  readonly latencyMaxMs?: number;
  readonly failureRate?: number;
  readonly telemetryIntervalMs?: number;
  readonly maxRequestBytes?: number;
  readonly requestTimeoutMs?: number;
  readonly maxCommandRecords?: number;
  readonly maxIdempotencyRecords?: number;
  readonly maxQueuedCommandsPerDevice?: number;
  readonly maxQueueKeys?: number;
  readonly maxQueuedCommandsTotal?: number;
  readonly maxConnections?: number;
  readonly maxConcurrentRequests?: number;
  readonly maxTelemetryStreams?: number;
  readonly signedActionFutureSkewMs?: number;
  /** Per emitted wearable/robot frame. Deterministic when seed/random is supplied. */
  readonly fallEventRate?: number;
  /** Per emitted wearable frame. Deterministic when seed/random is supplied. */
  readonly stressEventRate?: number;
  /** Robot telemetry ticks between reminders. Set to 0 to disable. */
  readonly medicationReminderEveryTicks?: number;
  readonly maxSimulatedDevices?: number;
  /** Ed25519 SPKI PEM/DER or a base64url-encoded 32-byte raw public key. */
  readonly signedActionPublicKey?: string | Buffer | KeyObject;
  /**
   * Development callback endpoint used to exercise the real asynchronous ACK
   * contract. Only the loopback CLM ACK route is accepted.
   */
  readonly asyncAckCallbackUrl?: string;
  /** Per-adapter callback credentials. Values are never included in logs. */
  readonly asyncAckCallbackCredentials?: Readonly<Record<string, string>>;
  readonly asyncAckDelayMs?: number;
  readonly asyncAckTimeoutMs?: number;
  readonly maxAsyncAckRequestBytes?: number;
  readonly maxAsyncAckResponseBytes?: number;
  /** Placeholder accepted only by this development simulator. */
  readonly apiKey?: string;
  /** Placeholder bearer returned by /api/v1/authenticate. */
  readonly accessToken?: string;
  readonly sessionToken?: string;
  readonly seed?: number;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly log?: (entry: ManufacturerMockLogEntry) => void;
  readonly environment?: string;
}

export interface ManufacturerMockAddress {
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
}

export interface ManufacturerMockResourceSnapshot {
  readonly connections: number;
  readonly activeRequests: number;
  readonly telemetryStreams: number;
  readonly queueKeys: number;
  readonly queuedCommands: number;
}

class MockRequestError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = 'MockRequestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  const selected = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return selected;
}

function boundedRate(value: number | undefined): number {
  const selected = value === undefined ? DEFAULT_FAILURE_RATE : value;
  if (typeof selected !== 'number' || !Number.isFinite(selected) || selected < 0 || selected > 1) {
    throw new TypeError('Mock manufacturer failure rate is invalid');
  }
  return selected;
}

function boundedProbability(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (typeof selected !== 'number' || !Number.isFinite(selected) || selected < 0 || selected > 1) {
    throw new TypeError(`${label} is invalid`);
  }
  return selected;
}

function createSeededRandom(initialSeed: number): () => number {
  let state = initialSeed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function safeReference(value: string): string {
  return `device_${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function requiredIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new MockRequestError(400, `${field.toUpperCase()}_INVALID`);
  }
  return value;
}

function requiredCommand(value: unknown): string {
  if (typeof value !== 'string' || !COMMAND_PATTERN.test(value)) {
    throw new MockRequestError(400, 'COMMAND_INVALID');
  }
  return value;
}

function cameraAcknowledgement(command: string, parameters: unknown): JsonObject {
  if (command.toLowerCase() !== 'share_camera_view') return {};
  if (!isObject(parameters)
    || Object.keys(parameters).length !== 1
    || typeof parameters.session_id !== 'string'
    || !CAMERA_SESSION_PATTERN.test(parameters.session_id)) {
    throw new MockRequestError(400, 'CAMERA_SESSION_INVALID');
  }
  return {
    camera_ready: true,
    camera_session_ref: parameters.session_id
  };
}

function writeJson(response: ServerResponse, statusCode: number, payload: JsonObject): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character] as string);
}

function writeDashboardHtml(
  response: ServerResponse,
  dashboard: ManufacturerSimulationDashboard
): void {
  if (response.destroyed || response.writableEnded) return;
  const snapshot = escapeHtml(JSON.stringify(dashboard, null, 2));
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="2">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Veryloving dual-device simulator</title></head>
<body><main><h1>Veryloving dual-device simulator</h1>
<p>Local synthetic data only. Refreshes every two seconds.</p>
<h2>Device states, scenario logs, and last 10 events</h2><pre>${snapshot}</pre>
</main></body></html>`;
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Content-Type': 'text/html; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  response.end(body);
}

function hasOnlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function parseBridgePath(pathname: string): { vendor: ManufacturerVendor; endpoint: string } | undefined {
  for (const [vendor, prefix] of Object.entries(BRIDGE_PREFIXES) as Array<[ManufacturerVendor, string]>) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return { vendor, endpoint: pathname.slice(prefix.length).replace(/^\/+/, '') };
    }
  }
  return undefined;
}

function parseDevicePath(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes('/')) return undefined;
  try {
    return requiredIdentifier(decodeURIComponent(encoded), 'device_id');
  } catch (error) {
    if (error instanceof MockRequestError) throw error;
    throw new MockRequestError(400, 'DEVICE_ID_INVALID');
  }
}

function normalizeSecret(value: string | undefined, fallback: string, label: string): string {
  const selected = value ?? fallback;
  if (typeof selected !== 'string' || selected.length < 8 || selected.length > 4096) {
    throw new TypeError(`${label} is invalid`);
  }
  return selected;
}

function normalizeSigningPublicKey(value: string | Buffer | KeyObject | undefined): KeyObject | undefined {
  if (value === undefined) return undefined;
  try {
    let key: KeyObject;
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
      key = value.type === 'private' ? createPublicKey(value) : value;
    } else if (typeof value === 'string' && !value.includes('BEGIN PUBLIC KEY')) {
      const raw = Buffer.from(value, 'base64url');
      if (raw.byteLength !== 32 || raw.toString('base64url') !== value) throw new Error('invalid raw key');
      key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    } else if (Buffer.isBuffer(value)) {
      try {
        key = createPublicKey(value);
      } catch {
        key = createPublicKey({ key: value, format: 'der', type: 'spki' });
      }
    } else {
      key = createPublicKey(value.replace(/\\n/g, '\n'));
    }
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong key type');
    return key;
  } catch {
    throw new TypeError('Mock manufacturer signed-action public key must be Ed25519');
  }
}

function normalizeAsyncAckCallbackUrl(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Mock manufacturer ACK callback URL is invalid');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)
    || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.pathname !== '/v1/manufacturer/robot/ack'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new TypeError('Mock manufacturer ACK callback must be the loopback CLM ACK URL');
  }
  return parsed.toString();
}

function normalizeAsyncAckCredentials(
  value: Readonly<Record<string, string>> | undefined,
  outboundSecrets: readonly string[]
): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (!isObject(value)) throw new TypeError('Mock manufacturer ACK callback credentials are invalid');
  const supportedAdapterIds = new Set<string>(Object.values(BRIDGE_ADAPTER_IDS));
  const credentials = new Map<string, string>();
  const seen = new Set<string>();
  for (const [adapterId, credential] of Object.entries(value)) {
    if (!supportedAdapterIds.has(adapterId)
      || typeof credential !== 'string'
      || credential.length < 8
      || credential.length > 4096
      || seen.has(credential)
      || outboundSecrets.includes(credential)) {
      throw new TypeError('Mock manufacturer ACK callback credentials are invalid');
    }
    seen.add(credential);
    credentials.set(adapterId, credential);
  }
  return credentials;
}

/**
 * The simulator is intentionally loopback-only and cannot be constructed in
 * production. Tests may use port 0 to request an ephemeral loopback port.
 */
export class ManufacturerMockServer {
  private readonly configuredPort: number;
  private readonly host: '127.0.0.1' | 'localhost' | '::1';
  private readonly latencyMinMs: number;
  private readonly latencyMaxMs: number;
  private readonly failureRate: number;
  private readonly telemetryIntervalMs: number;
  private readonly maxRequestBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly maxCommandRecords: number;
  private readonly maxIdempotencyRecords: number;
  private readonly maxQueuedCommandsPerDevice: number;
  private readonly maxQueueKeys: number;
  private readonly maxQueuedCommandsTotal: number;
  private readonly maxConnections: number;
  private readonly maxConcurrentRequests: number;
  private readonly maxTelemetryStreams: number;
  private readonly signedActionFutureSkewMs: number;
  private readonly fallEventRate: number;
  private readonly stressEventRate: number;
  private readonly medicationReminderEveryTicks: number;
  private readonly maxSimulatedDevices: number;
  private readonly signedActionPublicKey?: KeyObject;
  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly sessionToken: string;
  private readonly asyncAckCallbackUrl?: string;
  private readonly asyncAckCallbackCredentials: ReadonlyMap<string, string>;
  private readonly asyncAckDelayMs: number;
  private readonly asyncAckTimeoutMs: number;
  private readonly maxAsyncAckRequestBytes: number;
  private readonly maxAsyncAckResponseBytes: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly logSink: (entry: ManufacturerMockLogEntry) => void;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly telemetryIntervals = new Set<NodeJS.Timeout>();
  private readonly pendingDelays = new Map<NodeJS.Timeout, () => void>();
  private readonly pendingAsyncAckTimers = new Set<NodeJS.Timeout>();
  private readonly pendingAsyncAcks = new Set<Promise<void>>();
  private readonly asyncAckControllers = new Set<AbortController>();
  private readonly queueTails = new Map<string, Promise<void>>();
  private readonly queueDepths = new Map<string, number>();
  private readonly commands: ManufacturerMockCommandRecord[] = [];
  private readonly idempotency = new Map<string, { readonly fingerprint: string; readonly payload: JsonObject }>();
  private readonly simulatedDeviceStates = new Map<string, ManufacturerSimulationDeviceState>();
  private readonly simulationTicks = new Map<string, number>();
  private readonly simulationEvents: ManufacturerSimulationEvent[] = [];
  private readonly scenarioExecutions: ManufacturerScenarioExecutionRecord[] = [];
  private requestSequence = 0;
  private callbackSequence = 0;
  private commandSequence = 0;
  private simulationEventSequence = 0;
  private scenarioExecutionSequence = 0;
  private activeRequests = 0;
  private activeTelemetryStreams = 0;
  private queuedCommandsTotal = 0;
  private startedAddress?: ManufacturerMockAddress;
  private startingPromise?: Promise<ManufacturerMockAddress>;
  private stoppingPromise?: Promise<void>;

  constructor(options: ManufacturerMockServerOptions = {}) {
    const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
    if (environment === 'production') {
      throw new Error('Manufacturer mock server is disabled in production');
    }
    if (!['development', 'test'].includes(environment)) {
      throw new Error('Manufacturer mock server requires NODE_ENV=development or NODE_ENV=test');
    }

    this.configuredPort = boundedInteger(options.port, DEFAULT_PORT, 0, 65_535, 'Mock manufacturer port');
    this.host = options.host ?? DEFAULT_HOST;
    if (!['127.0.0.1', 'localhost', '::1'].includes(this.host)) {
      throw new TypeError('Mock manufacturer host must be loopback');
    }
    this.latencyMinMs = boundedInteger(
      options.latencyMinMs,
      DEFAULT_LATENCY_MIN_MS,
      0,
      60_000,
      'Mock manufacturer minimum latency'
    );
    this.latencyMaxMs = boundedInteger(
      options.latencyMaxMs,
      DEFAULT_LATENCY_MAX_MS,
      0,
      60_000,
      'Mock manufacturer maximum latency'
    );
    if (this.latencyMaxMs < this.latencyMinMs) {
      throw new TypeError('Mock manufacturer maximum latency must not be lower than minimum latency');
    }
    this.failureRate = options.failureRate === undefined && environment === 'test'
      ? 0
      : boundedRate(options.failureRate);
    this.telemetryIntervalMs = boundedInteger(
      options.telemetryIntervalMs,
      DEFAULT_TELEMETRY_INTERVAL_MS,
      10,
      60_000,
      'Mock manufacturer telemetry interval'
    );
    this.maxRequestBytes = boundedInteger(
      options.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      128,
      1024 * 1024,
      'Mock manufacturer request limit'
    );
    this.requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      100,
      120_000,
      'Mock manufacturer request timeout'
    );
    this.maxCommandRecords = boundedInteger(
      options.maxCommandRecords,
      DEFAULT_MAX_COMMAND_RECORDS,
      1,
      100_000,
      'Mock manufacturer command history limit'
    );
    this.maxIdempotencyRecords = boundedInteger(
      options.maxIdempotencyRecords,
      DEFAULT_MAX_IDEMPOTENCY_RECORDS,
      1,
      100_000,
      'Mock manufacturer idempotency limit'
    );
    this.maxQueuedCommandsPerDevice = boundedInteger(
      options.maxQueuedCommandsPerDevice,
      DEFAULT_MAX_QUEUED_COMMANDS_PER_DEVICE,
      1,
      10_000,
      'Mock manufacturer per-device queue limit'
    );
    this.maxQueueKeys = boundedInteger(
      options.maxQueueKeys,
      DEFAULT_MAX_QUEUE_KEYS,
      1,
      100_000,
      'Mock manufacturer queue-key limit'
    );
    this.maxQueuedCommandsTotal = boundedInteger(
      options.maxQueuedCommandsTotal,
      DEFAULT_MAX_QUEUED_COMMANDS_TOTAL,
      1,
      100_000,
      'Mock manufacturer global queue limit'
    );
    this.maxConnections = boundedInteger(
      options.maxConnections,
      DEFAULT_MAX_CONNECTIONS,
      1,
      10_000,
      'Mock manufacturer connection limit'
    );
    this.maxConcurrentRequests = boundedInteger(
      options.maxConcurrentRequests,
      DEFAULT_MAX_CONCURRENT_REQUESTS,
      1,
      10_000,
      'Mock manufacturer concurrent-request limit'
    );
    this.maxTelemetryStreams = boundedInteger(
      options.maxTelemetryStreams,
      DEFAULT_MAX_TELEMETRY_STREAMS,
      1,
      10_000,
      'Mock manufacturer telemetry-stream limit'
    );
    this.signedActionFutureSkewMs = boundedInteger(
      options.signedActionFutureSkewMs,
      DEFAULT_SIGNED_ACTION_FUTURE_SKEW_MS,
      0,
      5 * 60_000,
      'Mock manufacturer signed-action future-skew limit'
    );
    this.fallEventRate = boundedProbability(
      options.fallEventRate,
      DEFAULT_FALL_EVENT_RATE,
      'Mock manufacturer fall-event rate'
    );
    this.stressEventRate = boundedProbability(
      options.stressEventRate,
      DEFAULT_STRESS_EVENT_RATE,
      'Mock manufacturer stress-event rate'
    );
    this.medicationReminderEveryTicks = boundedInteger(
      options.medicationReminderEveryTicks,
      DEFAULT_MEDICATION_REMINDER_EVERY_TICKS,
      0,
      1_000_000,
      'Mock manufacturer medication-reminder tick interval'
    );
    this.maxSimulatedDevices = boundedInteger(
      options.maxSimulatedDevices,
      DEFAULT_MAX_SIMULATED_DEVICES,
      1,
      1_000,
      'Mock manufacturer simulated-device limit'
    );
    this.signedActionPublicKey = normalizeSigningPublicKey(options.signedActionPublicKey);
    this.apiKey = normalizeSecret(options.apiKey, 'mock-server-only-api-key', 'Mock manufacturer API key');
    this.accessToken = normalizeSecret(options.accessToken, 'mock-development-access-token', 'Mock manufacturer access token');
    this.sessionToken = normalizeSecret(options.sessionToken, 'mock-development-session-token', 'Mock bridge session token');
    this.asyncAckCallbackUrl = normalizeAsyncAckCallbackUrl(options.asyncAckCallbackUrl);
    this.asyncAckCallbackCredentials = normalizeAsyncAckCredentials(
      options.asyncAckCallbackCredentials,
      [this.apiKey, this.accessToken, this.sessionToken]
    );
    if (Boolean(this.asyncAckCallbackUrl) !== (this.asyncAckCallbackCredentials.size > 0)) {
      throw new TypeError('Mock manufacturer ACK callback URL and credentials must be configured together');
    }
    this.asyncAckDelayMs = boundedInteger(
      options.asyncAckDelayMs,
      DEFAULT_ASYNC_ACK_DELAY_MS,
      1,
      60_000,
      'Mock manufacturer ACK callback delay'
    );
    this.asyncAckTimeoutMs = boundedInteger(
      options.asyncAckTimeoutMs,
      DEFAULT_ASYNC_ACK_TIMEOUT_MS,
      100,
      120_000,
      'Mock manufacturer ACK callback timeout'
    );
    this.maxAsyncAckRequestBytes = boundedInteger(
      options.maxAsyncAckRequestBytes,
      DEFAULT_MAX_ASYNC_ACK_REQUEST_BYTES,
      512,
      64 * 1024,
      'Mock manufacturer ACK request limit'
    );
    this.maxAsyncAckResponseBytes = boundedInteger(
      options.maxAsyncAckResponseBytes,
      DEFAULT_MAX_ASYNC_ACK_RESPONSE_BYTES,
      0,
      64 * 1024,
      'Mock manufacturer ACK response limit'
    );
    this.random = options.random ?? createSeededRandom(options.seed ?? 0x564c3032);
    this.now = options.now ?? Date.now;
    this.logSink = options.log ?? ((entry) => process.stdout.write(`${JSON.stringify(entry)}\n`));

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    const transportTimeoutMs = Math.min(120_000, this.requestTimeoutMs + 1_000);
    this.server.maxConnections = this.maxConnections;
    // readJson enforces the configured body deadline and emits a structured
    // 408. Node's transport deadline is a slightly later hard backstop.
    this.server.requestTimeout = transportTimeoutMs;
    this.server.headersTimeout = this.requestTimeoutMs;
    this.server.keepAliveTimeout = Math.min(this.requestTimeoutMs, 5_000);
    this.server.setTimeout(transportTimeoutMs, (socket) => socket.destroy());
    this.server.on('connection', (socket) => {
      if (this.sockets.size >= this.maxConnections) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
  }

  get address(): ManufacturerMockAddress | undefined {
    return this.startedAddress;
  }

  getCommandRecords(): readonly ManufacturerMockCommandRecord[] {
    return this.commands.map((entry) => Object.freeze({ ...entry }));
  }

  getResourceSnapshot(): ManufacturerMockResourceSnapshot {
    return Object.freeze({
      connections: this.sockets.size,
      activeRequests: this.activeRequests,
      telemetryStreams: this.activeTelemetryStreams,
      queueKeys: this.queueDepths.size,
      queuedCommands: this.queuedCommandsTotal
    });
  }

  /** Redacted, bounded snapshot used by the local dashboard and integration tests. */
  getSimulationDashboard(): ManufacturerSimulationDashboard {
    return Object.freeze({
      contractVersion: 'vl-manufacturer-simulation-dashboard/1',
      synthetic: true,
      generatedAt: this.simulationNow(),
      devices: Object.freeze(Array.from(this.simulatedDeviceStates.values(), (state) => {
        return Object.freeze({ ...state });
      })),
      scenarioExecutions: Object.freeze(this.scenarioExecutions.map((entry) => {
        return Object.freeze({ ...entry, deviceReferences: Object.freeze([...entry.deviceReferences]) });
      })),
      lastEvents: Object.freeze(this.simulationEvents.map((event) => {
        return Object.freeze({ ...event, deviceReferences: Object.freeze([...event.deviceReferences]) });
      }))
    });
  }

  /**
   * Add a redacted scenario lifecycle entry without routing it through HTTP.
   * Raw device IDs are one-way hashed before storage and never reach logs.
   */
  recordScenarioExecution(input: RecordScenarioExecutionInput): ManufacturerScenarioExecutionRecord {
    if (!input || typeof input !== 'object'
      || typeof input.scenarioId !== 'string'
      || !SCENARIO_PATTERN.test(input.scenarioId)
      || !SCENARIO_STATUSES.includes(input.status)
      || (input.wearableDeviceId !== undefined && !IDENTIFIER_PATTERN.test(input.wearableDeviceId))
      || (input.robotDeviceId !== undefined && !IDENTIFIER_PATTERN.test(input.robotDeviceId))) {
      throw new TypeError('Scenario execution record is invalid');
    }
    const deviceReferences = Object.freeze(Array.from(new Set([
      input.wearableDeviceId ? safeReference(input.wearableDeviceId) : undefined,
      input.robotDeviceId ? safeReference(input.robotDeviceId) : undefined
    ].filter((value): value is string => value !== undefined))));
    const observedAt = this.simulationNow();
    const record = Object.freeze({
      executionReference: `scenario_${++this.scenarioExecutionSequence}`,
      scenarioId: input.scenarioId,
      status: input.status,
      deviceReferences,
      observedAt,
      synthetic: true as const
    });
    this.scenarioExecutions.push(record);
    this.trimToLimit(this.scenarioExecutions, MAX_SCENARIO_EXECUTIONS);
    this.pushSimulationEvent({
      eventType: 'scenario_execution',
      deviceType: 'both',
      deviceReferences,
      severity: input.status === 'failed' || input.status === 'fallback' ? 'warning' : 'info',
      scenarioId: input.scenarioId,
      scenarioStatus: input.status,
      occurredAt: observedAt
    });
    return Object.freeze({ ...record, deviceReferences: Object.freeze([...record.deviceReferences]) });
  }

  async start(): Promise<ManufacturerMockAddress> {
    if (this.stoppingPromise) throw new Error('Manufacturer mock server is stopping');
    if (this.startedAddress) return this.startedAddress;
    if (this.startingPromise) return this.startingPromise;
    this.startingPromise = (async () => {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          this.server.off('listening', onListening);
          reject(error);
        };
        const onListening = (): void => {
          this.server.off('error', onError);
          resolve();
        };
        this.server.once('error', onError);
        this.server.once('listening', onListening);
        this.server.listen(this.configuredPort, this.host);
      });
      const address = this.server.address();
      if (!address || typeof address === 'string') throw new Error('Manufacturer mock server address is unavailable');
      const port = (address as AddressInfo).port;
      const urlHost = this.host === '::1' ? '[::1]' : this.host;
      this.startedAddress = Object.freeze({ host: this.host, port, baseUrl: `http://${urlHost}:${port}/` });
      return this.startedAddress;
    })().finally(() => { this.startingPromise = undefined; });
    return this.startingPromise;
  }

  stop(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise;
    const pendingStart = this.startingPromise;
    this.stoppingPromise = (async () => {
      if (pendingStart) {
        try { await pendingStart; } catch { return; }
      }
      if (!this.server.listening) return;
      for (const interval of this.telemetryIntervals) clearInterval(interval);
      this.telemetryIntervals.clear();
      for (const [timeout, release] of this.pendingDelays) {
        clearTimeout(timeout);
        release();
      }
      this.pendingDelays.clear();
      for (const timeout of this.pendingAsyncAckTimers) clearTimeout(timeout);
      this.pendingAsyncAckTimers.clear();
      for (const controller of this.asyncAckControllers) controller.abort();
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
        this.server.closeAllConnections?.();
        for (const socket of this.sockets) socket.destroy();
      });
      await Promise.allSettled([...this.pendingAsyncAcks]);
    })().finally(() => {
      this.startedAddress = undefined;
      this.stoppingPromise = undefined;
      this.queueTails.clear();
      this.queueDepths.clear();
      this.simulationTicks.clear();
      this.simulatedDeviceStates.clear();
      this.simulationEvents.length = 0;
      this.scenarioExecutions.length = 0;
      this.queuedCommandsTotal = 0;
      this.activeTelemetryStreams = 0;
      this.pendingAsyncAcks.clear();
      this.asyncAckControllers.clear();
    });
    return this.stoppingPromise;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAt = this.now();
    const requestId = `mock-request-${++this.requestSequence}`;
    let route = 'unknown';
    let deviceId: string | undefined;
    let admitted = false;
    try {
      if (this.activeRequests >= this.maxConcurrentRequests) {
        request.resume();
        throw new MockRequestError(503, 'REQUEST_CAPACITY_EXCEEDED');
      }
      this.activeRequests += 1;
      admitted = true;
      if (!request.url || request.url.length > 2_048) throw new MockRequestError(414, 'URL_TOO_LONG');
      const url = new URL(request.url, 'http://manufacturer-mock.local');
      if (url.search || url.hash) throw new MockRequestError(400, 'QUERY_NOT_ALLOWED');
      const statusDevice = parseDevicePath(url.pathname, '/api/v1/status/');
      const telemetryDevice = parseDevicePath(url.pathname, '/api/v1/telemetry/');
      const wearableTelemetryDevice = parseDevicePath(url.pathname, '/api/v1/wearable/telemetry/');
      const robotTelemetryDevice = parseDevicePath(url.pathname, '/api/v1/robot/telemetry/');

      if (request.method === 'GET' && url.pathname === '/dashboard') {
        route = '/dashboard';
        writeDashboardHtml(response, this.getSimulationDashboard());
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/simulation/dashboard') {
        route = '/api/v1/simulation/dashboard';
        this.requireBearer(request, this.accessToken);
        writeJson(response, 200, { ...this.getSimulationDashboard() });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/simulation/events') {
        route = '/api/v1/simulation/events';
        this.requireBearer(request, this.accessToken);
        const body = await this.readJson(request);
        deviceId = requiredIdentifier(body.device_id, 'device_id');
        await this.simulateTransport();
        const event = this.injectSimulationEvent(body, deviceId);
        writeJson(response, 201, { accepted: true, event });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/simulation/scenarios') {
        route = '/api/v1/simulation/scenarios';
        this.requireBearer(request, this.accessToken);
        const body = await this.readJson(request);
        const input = this.parseScenarioExecutionRequest(body);
        await this.simulateTransport();
        const scenario = this.recordScenarioExecution(input);
        writeJson(response, 201, { accepted: true, scenario });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/authenticate') {
        route = '/api/v1/authenticate';
        this.requireBearer(request, this.apiKey);
        const body = await this.readJson(request);
        deviceId = requiredIdentifier(body.device_id, 'device_id');
        await this.simulateTransport();
        writeJson(response, 200, {
          access_token: this.accessToken,
          token_type: 'Bearer',
          expires_in: 3600
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/command') {
        route = '/api/v1/command';
        this.requireBearer(request, this.accessToken);
        const body = await this.readJson(request);
        deviceId = requiredIdentifier(body.device_id, 'device_id');
        const command = requiredCommand(body.command);
        if (body.parameters !== undefined && !isObject(body.parameters)) {
          throw new MockRequestError(400, 'COMMAND_PARAMETERS_INVALID');
        }
        const idempotencyKey = this.readIdempotencyKey(request, body.idempotency_key);
        await this.enqueueDevice(deviceId, async () => {
          const commandStartedAt = this.now();
          await this.simulateTransport();
          const payload = this.commandResponse(
            `generic:${deviceId as string}`,
            deviceId as string,
            command,
            body.parameters ?? {},
            idempotencyKey,
            commandStartedAt
          );
          writeJson(response, 202, payload);
        });
        return;
      }

      if (request.method === 'GET' && statusDevice !== undefined) {
        route = '/api/v1/status/{deviceId}';
        deviceId = statusDevice;
        this.requireBearer(request, this.accessToken);
        await this.simulateTransport();
        writeJson(response, 200, this.genericStatus(deviceId));
        return;
      }

      if (request.method === 'GET' && telemetryDevice !== undefined) {
        route = '/api/v1/telemetry/{deviceId}';
        deviceId = telemetryDevice;
        this.requireBearer(request, this.accessToken);
        await this.simulateTransport();
        this.startTelemetryStream(request, response, deviceId);
        return;
      }

      if (request.method === 'GET' && wearableTelemetryDevice !== undefined) {
        route = '/api/v1/wearable/telemetry/{deviceId}';
        deviceId = wearableTelemetryDevice;
        this.requireBearer(request, this.accessToken);
        await this.simulateTransport();
        this.startTelemetryStream(
          request,
          response,
          deviceId,
          () => this.wearableTelemetry(deviceId as string),
          'wearable.telemetry'
        );
        return;
      }

      if (request.method === 'GET' && robotTelemetryDevice !== undefined) {
        route = '/api/v1/robot/telemetry/{deviceId}';
        deviceId = robotTelemetryDevice;
        this.requireBearer(request, this.accessToken);
        await this.simulateTransport();
        this.startTelemetryStream(
          request,
          response,
          deviceId,
          () => this.robotTelemetry(deviceId as string),
          'robot.telemetry'
        );
        return;
      }

      const bridge = parseBridgePath(url.pathname);
      if (request.method === 'POST' && bridge) {
        route = `/v1/veryloving/${bridge.vendor === 'yongyida' ? 'yongyida-cloud' : 'jiangzhi-edge'}/{operation}`;
        const body = await this.readJson(request);
        deviceId = typeof body.device_id === 'string'
          ? body.device_id
          : isObject(body.envelope) && typeof body.envelope.manufacturer_device_id === 'string'
            ? body.envelope.manufacturer_device_id
            : undefined;
        await this.handleBridgeRequest(request, response, bridge.vendor, bridge.endpoint, body);
        return;
      }

      throw new MockRequestError(404, 'NOT_FOUND');
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        if (error instanceof MockRequestError) {
          if (error.code === 'REQUEST_TIMEOUT') {
            response.setHeader('Connection', 'close');
            const socket = request.socket;
            response.once('finish', () => socket.destroy());
          }
          writeJson(response, error.statusCode, { error: error.code });
        }
        else writeJson(response, 500, { error: 'MOCK_SERVER_ERROR' });
      }
    } finally {
      if (admitted) this.activeRequests -= 1;
      const elapsed = Math.max(0, Math.round(this.now() - startedAt));
      const entry = Object.freeze({
        event: 'manufacturer_mock.request' as const,
        requestId,
        method: /^[A-Z]{3,8}$/.test(request.method ?? '') ? request.method as string : 'UNKNOWN',
        route,
        statusCode: response.statusCode,
        latencyMs: Number.isSafeInteger(elapsed) ? elapsed : 0,
        ...(deviceId && IDENTIFIER_PATTERN.test(deviceId) ? { deviceReference: safeReference(deviceId) } : {})
      });
      try { this.logSink(entry); } catch {}
    }
  }

  private async handleBridgeRequest(
    request: IncomingMessage,
    response: ServerResponse,
    vendor: ManufacturerVendor,
    endpoint: string,
    body: JsonObject
  ): Promise<void> {
    this.requireBearer(request, this.apiKey);
    if (endpoint === 'session') {
      if (body.schema_version !== BRIDGE_PROTOCOL) throw new MockRequestError(400, 'SESSION_INVALID');
      requiredIdentifier(body.device_id, 'device_id');
      await this.simulateTransport();
      writeJson(response, 200, { authenticated: true, session_token: this.sessionToken });
      return;
    }
    if (request.headers['x-veryloving-session'] !== this.sessionToken) {
      throw new MockRequestError(401, 'SESSION_UNAUTHORIZED');
    }

    if (endpoint === 'commands') {
      if (body.schema_version !== BRIDGE_PROTOCOL || !isObject(body.parameters)) {
        throw new MockRequestError(400, 'COMMAND_INVALID');
      }
      const deviceId = requiredIdentifier(body.device_id, 'device_id');
      const command = requiredCommand(body.command);
      const idempotencyKey = this.readIdempotencyKey(request);
      await this.enqueueDevice(`${vendor}:${deviceId}`, async () => {
        const commandStartedAt = this.now();
        await this.simulateTransport();
        const generic = this.commandResponse(
          `bridge:${vendor}:${deviceId}`,
          deviceId,
          command,
          body.parameters,
          idempotencyKey,
          commandStartedAt
        );
        const commandId = String(generic.command_id);
        if (/SAFETY_CHECK|safety\.check/.test(command)) {
          writeJson(response, 200, { command_id: commandId, accepted: true, findings: [] });
        } else if (/TWO_WAY_VOICE_CALL|two_way_call/.test(command)) {
          writeJson(response, 200, { command_id: commandId, state: 'ringing' });
        } else {
          writeJson(response, 200, generic);
        }
      });
      return;
    }

    if (endpoint === 'signed-actions') {
      const { envelope, deviceId, actionId, fingerprint } = this.verifySignedAction(
        body,
        BRIDGE_ADAPTER_IDS[vendor]
      );
      if (request.headers['idempotency-key'] !== actionId) {
        throw new MockRequestError(409, 'IDEMPOTENCY_CONFLICT');
      }
      await this.enqueueDevice(`${vendor}:${deviceId}`, async () => {
        const startedAt = this.now();
        await this.simulateTransport();
        const idempotencyScope = `signed:${vendor}:${deviceId}\u0000${actionId}`;
        const adapterId = BRIDGE_ADAPTER_IDS[vendor];
        const camera = cameraAcknowledgement(String(envelope.action), envelope.parameters);
        const acknowledgement = Object.freeze({
          actionId,
          adapterId,
          bindingEpoch: Number(envelope.binding_epoch),
          ...(camera.camera_ready === true && typeof camera.camera_session_ref === 'string'
            ? { cameraReady: true, cameraSessionRef: camera.camera_session_ref }
            : {})
        });
        const previous = this.idempotency.get(idempotencyScope);
        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            throw new MockRequestError(409, 'IDEMPOTENCY_CONFLICT');
          }
          this.writeAcceptedSignedAction(response, previous.payload, acknowledgement);
          return;
        }

        const payload = Object.freeze({
          state: 'accepted',
          ok: true,
          action_id: actionId,
          ...camera
        });
        this.recordCommand(deviceId, String(envelope.action), startedAt);
        this.rememberIdempotency(idempotencyScope, fingerprint, payload);
        this.writeAcceptedSignedAction(response, payload, acknowledgement);
      });
      return;
    }

    const deviceId = requiredIdentifier(body.device_id, 'device_id');
    await this.simulateTransport();
    if (endpoint === 'telemetry/status/query') {
      writeJson(response, 200, this.bridgeStatus(deviceId, vendor));
      return;
    }
    if (endpoint === 'telemetry/battery/query') {
      writeJson(response, 200, this.bridgeBattery());
      return;
    }
    if (endpoint === 'telemetry/vitals/query') {
      writeJson(response, 200, { items: this.bridgeVitals(), next_cursor: null });
      return;
    }
    if (endpoint === 'telemetry/snapshot/query') {
      writeJson(response, 200, this.bridgeSnapshot(deviceId, vendor));
      return;
    }
    throw new MockRequestError(404, 'NOT_FOUND');
  }

  private requireBearer(request: IncomingMessage, expected: string): void {
    if (request.headers.authorization !== `Bearer ${expected}`) {
      throw new MockRequestError(401, 'UNAUTHORIZED');
    }
  }

  private readIdempotencyKey(request: IncomingMessage, bodyValue?: unknown): string {
    const headerValue = request.headers['idempotency-key'];
    if (typeof headerValue === 'string'
      && typeof bodyValue === 'string'
      && headerValue !== bodyValue) {
      throw new MockRequestError(409, 'IDEMPOTENCY_CONFLICT');
    }
    const candidate = typeof headerValue === 'string' ? headerValue : bodyValue;
    if (typeof candidate !== 'string' || !IDEMPOTENCY_PATTERN.test(candidate)) {
      throw new MockRequestError(400, 'IDEMPOTENCY_KEY_INVALID');
    }
    return candidate;
  }

  private verifySignedAction(body: JsonObject, expectedAdapterId: string): {
    readonly envelope: JsonObject;
    readonly deviceId: string;
    readonly actionId: string;
    readonly fingerprint: string;
  } {
    if (!this.signedActionPublicKey) {
      throw new MockRequestError(503, 'SIGNING_KEY_NOT_CONFIGURED');
    }
    const envelope = isObject(body.envelope) ? body.envelope : undefined;
    if (!envelope
      || body.algorithm !== 'Ed25519'
      || typeof body.payload !== 'string'
      || body.payload.length < 1
      || body.payload.length > 64 * 1024
      || !BASE64URL_PATTERN.test(body.payload)
      || typeof body.signature !== 'string'
      || body.signature.length < 40
      || body.signature.length > 512
      || !BASE64URL_PATTERN.test(body.signature)) {
      throw new MockRequestError(400, 'SIGNED_ACTION_INVALID');
    }

    let signedEnvelope: unknown;
    try {
      signedEnvelope = JSON.parse(Buffer.from(body.payload, 'base64url').toString('utf8'));
    } catch {
      throw new MockRequestError(400, 'SIGNED_ACTION_INVALID');
    }
    if (!isObject(signedEnvelope)
      || !isDeepStrictEqual(signedEnvelope, envelope)
      || !verifySignature(
        null,
        Buffer.from(body.payload, 'ascii'),
        this.signedActionPublicKey,
        Buffer.from(body.signature, 'base64url')
      )) {
      throw new MockRequestError(401, 'SIGNED_ACTION_UNVERIFIED');
    }

    const deviceId = requiredIdentifier(envelope.manufacturer_device_id, 'device_id');
    const actionId = typeof envelope.id === 'string' && ACTION_ID_PATTERN.test(envelope.id)
      ? envelope.id
      : undefined;
    if (!actionId
      || envelope.version !== 2
      || envelope.contract_version !== 'vl-robot-action/2'
      || envelope.device_type !== 'home_robot'
      || !IDENTIFIER_PATTERN.test(String(envelope.device_id ?? ''))
      || envelope.adapter_id !== expectedAdapterId
      || !Number.isSafeInteger(envelope.binding_epoch)
      || Number(envelope.binding_epoch) <= 0
      || !COMMAND_PATTERN.test(String(envelope.action ?? ''))
      || !isObject(envelope.parameters)
      || !Number.isSafeInteger(envelope.issued_at)
      || !Number.isSafeInteger(envelope.expires_at)
      || Number(envelope.expires_at) <= Number(envelope.issued_at)) {
      throw new MockRequestError(400, 'SIGNED_ACTION_INVALID');
    }
    const currentTime = this.now();
    if (Number(envelope.issued_at) > currentTime + this.signedActionFutureSkewMs) {
      throw new MockRequestError(400, 'SIGNED_ACTION_INVALID');
    }
    if (Number(envelope.expires_at) <= currentTime) {
      throw new MockRequestError(410, 'SIGNED_ACTION_EXPIRED');
    }
    return Object.freeze({
      envelope,
      deviceId,
      actionId,
      fingerprint: createHash('sha256').update(JSON.stringify(body)).digest('base64url')
    });
  }

  private writeAcceptedSignedAction(
    response: ServerResponse,
    payload: JsonObject,
    acknowledgement: AsyncAcknowledgement
  ): void {
    if (this.asyncAckCallbackUrl && this.asyncAckCallbackCredentials.has(acknowledgement.adapterId)) {
      // The callback represents work completed after transport acceptance. Arm
      // it only once the 202 has been flushed so tests exercise the same race
      // ordering as a real manufacturer gateway.
      response.once('finish', () => this.scheduleAsyncAcknowledgement(acknowledgement));
    }
    writeJson(response, 202, payload);
  }

  private scheduleAsyncAcknowledgement(acknowledgement: AsyncAcknowledgement): void {
    if (this.stoppingPromise || !this.asyncAckCallbackUrl) return;
    const credential = this.asyncAckCallbackCredentials.get(acknowledgement.adapterId);
    if (!credential) return;
    const timer = setTimeout(() => {
      this.pendingAsyncAckTimers.delete(timer);
      if (this.stoppingPromise) return;
      const pending = this.postAsyncAcknowledgement(acknowledgement, credential)
        .catch(() => undefined)
        .finally(() => this.pendingAsyncAcks.delete(pending));
      this.pendingAsyncAcks.add(pending);
    }, this.asyncAckDelayMs);
    timer.unref?.();
    this.pendingAsyncAckTimers.add(timer);
  }

  private async readBoundedCallbackResponse(response: Response): Promise<void> {
    const advertisedLength = response.headers.get('content-length');
    if (advertisedLength && /^\d{1,12}$/.test(advertisedLength)
      && Number(advertisedLength) > this.maxAsyncAckResponseBytes) {
      try { await response.body?.cancel(); } catch {}
      throw new Error('ACK_CALLBACK_RESPONSE_TOO_LARGE');
    }
    if (!response.body) return;
    const reader = response.body.getReader();
    let total = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > this.maxAsyncAckResponseBytes) {
          await reader.cancel();
          throw new Error('ACK_CALLBACK_RESPONSE_TOO_LARGE');
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  private async postAsyncAcknowledgement(
    acknowledgement: AsyncAcknowledgement,
    credential: string
  ): Promise<void> {
    const callbackUrl = this.asyncAckCallbackUrl;
    if (!callbackUrl) return;
    const requestId = `mock-callback-${++this.callbackSequence}`;
    const startedAt = this.now();
    let statusCode = 0;
    const body = JSON.stringify({
      action_id: acknowledgement.actionId,
      ok: true,
      binding_epoch: acknowledgement.bindingEpoch,
      ...(acknowledgement.cameraReady === true && acknowledgement.cameraSessionRef
        ? {
          camera_ready: true,
          camera_session_ref: acknowledgement.cameraSessionRef
        }
        : {})
    });
    if (Buffer.byteLength(body) > this.maxAsyncAckRequestBytes) {
      throw new Error('ACK_CALLBACK_REQUEST_TOO_LARGE');
    }

    const controller = new AbortController();
    this.asyncAckControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), this.asyncAckTimeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(callbackUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Robot-Adapter-Id': acknowledgement.adapterId,
          'X-Robot-Callback-Key': credential
        },
        body,
        signal: controller.signal
      });
      statusCode = response.status;
      await this.readBoundedCallbackResponse(response);
      if (response.status !== 204) throw new Error('ACK_CALLBACK_REJECTED');
    } finally {
      clearTimeout(timeout);
      this.asyncAckControllers.delete(controller);
      const elapsed = Math.max(0, Math.round(this.now() - startedAt));
      try {
        this.logSink(Object.freeze({
          event: 'manufacturer_mock.ack_callback',
          requestId,
          method: 'POST',
          route: '/v1/manufacturer/robot/ack',
          statusCode,
          latencyMs: Number.isSafeInteger(elapsed) ? elapsed : 0
        }));
      } catch {}
    }
  }

  private readJson(request: IncomingMessage): Promise<JsonObject> {
    const advertisedLength = request.headers['content-length'];
    if (typeof advertisedLength === 'string'
      && /^\d{1,12}$/.test(advertisedLength)
      && Number(advertisedLength) > this.maxRequestBytes) {
      request.resume();
      throw new MockRequestError(413, 'REQUEST_TOO_LARGE');
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let settled = false;
      const timeout = setTimeout(() => {
        request.resume();
        finish(reject, new MockRequestError(408, 'REQUEST_TIMEOUT'));
      }, this.requestTimeoutMs);
      const finish = <T>(callback: (value: T) => void, value: T): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        callback(value);
      };
      request.on('data', (chunk: Buffer | string) => {
        if (settled) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += bytes.byteLength;
        if (total > this.maxRequestBytes) {
          chunks.length = 0;
          finish(reject, new MockRequestError(413, 'REQUEST_TOO_LARGE'));
          request.resume();
          return;
        }
        chunks.push(bytes);
      });
      request.once('end', () => {
        if (settled) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
        } catch {
          finish(reject, new MockRequestError(400, 'INVALID_JSON'));
          return;
        }
        if (!isObject(parsed)) {
          finish(reject, new MockRequestError(400, 'INVALID_JSON_OBJECT'));
          return;
        }
        finish(resolve, parsed);
      });
      request.once('aborted', () => finish(reject, new MockRequestError(400, 'REQUEST_ABORTED')));
      request.once('error', () => finish(reject, new MockRequestError(400, 'REQUEST_ERROR')));
    });
  }

  private delay(milliseconds: number): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = (): void => {
        this.pendingDelays.delete(timeout);
        resolve();
      };
      const timeout = setTimeout(finish, milliseconds);
      this.pendingDelays.set(timeout, finish);
    });
  }

  private async simulateTransport(): Promise<void> {
    const span = this.latencyMaxMs - this.latencyMinMs;
    const latency = this.latencyMinMs + Math.floor(this.nextSimulationRandom() * (span + 1));
    await this.delay(latency);
    if (this.nextSimulationRandom() < this.failureRate) {
      throw new MockRequestError(503, 'SIMULATED_FAILURE');
    }
  }

  private enqueueDevice<T>(deviceId: string, operation: () => Promise<T>): Promise<T> {
    const depth = this.queueDepths.get(deviceId) ?? 0;
    if (depth >= this.maxQueuedCommandsPerDevice) {
      throw new MockRequestError(429, 'COMMAND_QUEUE_FULL');
    }
    if (depth === 0 && this.queueDepths.size >= this.maxQueueKeys) {
      throw new MockRequestError(429, 'COMMAND_QUEUE_KEYS_FULL');
    }
    if (this.queuedCommandsTotal >= this.maxQueuedCommandsTotal) {
      throw new MockRequestError(429, 'COMMAND_QUEUE_CAPACITY_EXCEEDED');
    }
    this.queueDepths.set(deviceId, depth + 1);
    this.queuedCommandsTotal += 1;
    const previous = this.queueTails.get(deviceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation).finally(() => {
      this.queuedCommandsTotal = Math.max(0, this.queuedCommandsTotal - 1);
      const remaining = (this.queueDepths.get(deviceId) ?? 1) - 1;
      if (remaining > 0) this.queueDepths.set(deviceId, remaining);
      else this.queueDepths.delete(deviceId);
    });
    const tail = current.then(() => undefined, () => undefined);
    this.queueTails.set(deviceId, tail);
    void tail.finally(() => {
      if (this.queueTails.get(deviceId) === tail) this.queueTails.delete(deviceId);
    });
    return current;
  }

  private recordCommand(deviceId: string, command: string, startedAt: number): number {
    const sequence = ++this.commandSequence;
    const completedAt = this.now();
    this.commands.push(Object.freeze({ sequence, deviceId, command, startedAt, completedAt }));
    if (this.commands.length > this.maxCommandRecords) {
      this.commands.splice(0, this.commands.length - this.maxCommandRecords);
    }
    return sequence;
  }

  private rememberIdempotency(scope: string, fingerprint: string, payload: JsonObject): void {
    this.idempotency.set(scope, Object.freeze({
      fingerprint,
      payload: Object.freeze({ ...payload })
    }));
    if (this.idempotency.size > this.maxIdempotencyRecords) {
      const oldest = this.idempotency.keys().next().value as string | undefined;
      if (oldest !== undefined) this.idempotency.delete(oldest);
    }
  }

  private commandResponse(
    scope: string,
    deviceId: string,
    command: string,
    parameters: unknown,
    idempotencyKey: string,
    startedAt: number
  ): JsonObject {
    // Validate camera sessions before recording the command. A malformed
    // request must not look like an executed side effect in the simulator.
    const acknowledgement = cameraAcknowledgement(command, parameters);
    const idempotencyScope = `${scope}\u0000${idempotencyKey}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ command, parameters }))
      .digest('base64url');
    const previous = this.idempotency.get(idempotencyScope);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new MockRequestError(409, 'IDEMPOTENCY_CONFLICT');
      return { ...previous.payload, duplicate: true };
    }
    const sequence = this.recordCommand(deviceId, command, startedAt);
    const completedAt = this.now();
    const emergencyStop = /EMERGENCY_STOP|emergency_stop/.test(command);
    const payload: JsonObject = {
      success: true,
      command_id: `mock-command-${sequence}`,
      state: emergencyStop ? 'completed' : 'accepted',
      accepted_at: new Date(completedAt).toISOString(),
      duplicate: false,
      ...acknowledgement
    };
    this.rememberIdempotency(idempotencyScope, fingerprint, payload);
    return payload;
  }

  private bridgeStatus(_deviceId: string, vendor: ManufacturerVendor): JsonObject {
    return {
      online: true,
      state: 'online',
      observed_at: new Date(this.now()).toISOString(),
      firmware_version: vendor === 'yongyida' ? 'mock-y120-1.0.0' : 'mock-jzkh-1.0.0'
    };
  }

  private bridgeBattery(): JsonObject {
    return { percentage: 78, charging: false, observed_at: new Date(this.now()).toISOString() };
  }

  private bridgeVitals(): JsonObject[] {
    const observedAt = new Date(this.now()).toISOString();
    return [
      { kind: 'heart_rate', value: 72, unit: 'bpm', observed_at: observedAt, quality: 'good' },
      { kind: 'oxygen_saturation', value: 98, unit: '%', observed_at: observedAt, quality: 'good' }
    ];
  }

  private bridgeSnapshot(deviceId: string, vendor: ManufacturerVendor): JsonObject {
    const capturedAt = this.now();
    return {
      status: this.bridgeStatus(deviceId, vendor),
      battery: this.bridgeBattery(),
      vitals: this.bridgeVitals(),
      location: { longitude: 103.8519, latitude: 1.2902, captured_at: capturedAt },
      indoor_position: {
        map_id: 'mock-home', floor_id: 'floor-1', room_id: 'living-room',
        x_m: 2.5, y_m: 3.25, confidence: 0.95, captured_at: capturedAt
      }
    };
  }

  private genericStatus(deviceId: string): JsonObject {
    return {
      device_id: deviceId,
      online: true,
      state: 'online',
      battery_percentage: 78,
      observed_at: new Date(this.now()).toISOString()
    };
  }

  private genericTelemetry(deviceId: string): JsonObject {
    return {
      device_id: deviceId,
      observed_at: new Date(this.now()).toISOString(),
      battery_percentage: 78,
      heart_rate_bpm: 72,
      oxygen_saturation_percent: 98,
      fall_detected: false,
      synthetic: true
    };
  }

  private simulationNow(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('Mock manufacturer clock is invalid');
    }
    return value;
  }

  private nextSimulationRandom(): number {
    const value = this.random();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new TypeError('Mock manufacturer random source is invalid');
    }
    return value;
  }

  private trimToLimit<T>(items: T[], maximum: number): void {
    if (items.length > maximum) items.splice(0, items.length - maximum);
  }

  private pushSimulationEvent(input: {
    readonly eventType: ManufacturerSimulationEventType;
    readonly deviceType: ManufacturerSimulationDeviceType | 'both';
    readonly deviceReferences: readonly string[];
    readonly severity: 'info' | 'warning' | 'critical';
    readonly occurredAt: number;
    readonly scenarioId?: string;
    readonly scenarioStatus?: ManufacturerScenarioStatus;
  }): ManufacturerSimulationEvent {
    const event = Object.freeze({
      eventId: `simulation_event_${++this.simulationEventSequence}`,
      eventType: input.eventType,
      deviceType: input.deviceType,
      deviceReferences: Object.freeze([...input.deviceReferences].slice(0, 2)),
      occurredAt: input.occurredAt,
      synthetic: true as const,
      severity: input.severity,
      ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
      ...(input.scenarioStatus ? { scenarioStatus: input.scenarioStatus } : {})
    });
    this.simulationEvents.push(event);
    this.trimToLimit(this.simulationEvents, MAX_SIMULATION_EVENTS);
    return Object.freeze({ ...event, deviceReferences: Object.freeze([...event.deviceReferences]) });
  }

  private nextSimulationTick(deviceType: ManufacturerSimulationDeviceType, deviceReference: string): number {
    const key = `${deviceType}:${deviceReference}`;
    const next = (this.simulationTicks.get(key) ?? 0) + 1;
    this.simulationTicks.set(key, next);
    return next;
  }

  private updateSimulatedDeviceState(
    deviceType: ManufacturerSimulationDeviceType,
    deviceReference: string,
    state: Omit<ManufacturerSimulationDeviceState, 'deviceType' | 'deviceReference'>
  ): ManufacturerSimulationDeviceState {
    const key = `${deviceType}:${deviceReference}`;
    if (!this.simulatedDeviceStates.has(key)
      && this.simulatedDeviceStates.size >= this.maxSimulatedDevices) {
      const oldestKey = this.simulatedDeviceStates.keys().next().value as string | undefined;
      if (oldestKey !== undefined) {
        this.simulatedDeviceStates.delete(oldestKey);
        this.simulationTicks.delete(oldestKey);
      }
    }
    const record = Object.freeze({ deviceReference, deviceType, ...state });
    // Refresh insertion order so the least recently observed device is evicted.
    this.simulatedDeviceStates.delete(key);
    this.simulatedDeviceStates.set(key, record);
    return record;
  }

  private injectSimulationEvent(body: JsonObject, rawDeviceId: string): ManufacturerSimulationEvent {
    if (!hasOnlyKeys(body, ['device_id', 'device_type', 'event_type'])) {
      throw new MockRequestError(400, 'SIMULATION_EVENT_INVALID');
    }
    const deviceType = body.device_type;
    const eventType = body.event_type;
    if ((deviceType !== 'wearable' && deviceType !== 'home_robot')
      || !['fall_detected', 'stress_spike', 'medication_reminder', 'device_offline', 'device_online']
        .includes(String(eventType))
      || (eventType === 'stress_spike' && deviceType !== 'wearable')
      || (eventType === 'medication_reminder' && deviceType !== 'home_robot')) {
      throw new MockRequestError(400, 'SIMULATION_EVENT_INVALID');
    }
    const typedEvent = eventType as Exclude<ManufacturerSimulationEventType, 'scenario_execution'>;
    const deviceReference = safeReference(rawDeviceId);
    const occurredAt = this.simulationNow();
    const existing = this.simulatedDeviceStates.get(`${deviceType}:${deviceReference}`);
    const online = typedEvent === 'device_offline' ? false : true;
    const status = typedEvent === 'device_online'
      ? 'idle'
      : typedEvent === 'device_offline'
        ? 'offline'
        : typedEvent;
    this.updateSimulatedDeviceState(deviceType, deviceReference, {
      online,
      batteryPercent: existing?.batteryPercent ?? (deviceType === 'wearable' ? 82 : 78),
      status,
      observedAt: occurredAt
    });
    return this.pushSimulationEvent({
      eventType: typedEvent,
      deviceType,
      deviceReferences: [deviceReference],
      severity: typedEvent === 'fall_detected'
        ? 'critical'
        : typedEvent === 'stress_spike' || typedEvent === 'device_offline'
          ? 'warning'
          : 'info',
      occurredAt
    });
  }

  private parseScenarioExecutionRequest(body: JsonObject): RecordScenarioExecutionInput {
    if (!hasOnlyKeys(body, [
      'scenario_id', 'status', 'wearable_device_id', 'robot_device_id'
    ])
      || typeof body.scenario_id !== 'string'
      || !SCENARIO_PATTERN.test(body.scenario_id)
      || typeof body.status !== 'string'
      || !SCENARIO_STATUSES.includes(body.status as ManufacturerScenarioStatus)
      || (body.wearable_device_id !== undefined
        && (typeof body.wearable_device_id !== 'string'
          || !IDENTIFIER_PATTERN.test(body.wearable_device_id)))
      || (body.robot_device_id !== undefined
        && (typeof body.robot_device_id !== 'string'
          || !IDENTIFIER_PATTERN.test(body.robot_device_id)))) {
      throw new MockRequestError(400, 'SCENARIO_EXECUTION_INVALID');
    }
    return Object.freeze({
      scenarioId: body.scenario_id,
      status: body.status as ManufacturerScenarioStatus,
      ...(typeof body.wearable_device_id === 'string'
        ? { wearableDeviceId: body.wearable_device_id }
        : {}),
      ...(typeof body.robot_device_id === 'string'
        ? { robotDeviceId: body.robot_device_id }
        : {})
    });
  }

  private wearableTelemetry(rawDeviceId: string): JsonObject {
    const deviceReference = safeReference(rawDeviceId);
    const tick = this.nextSimulationTick('wearable', deviceReference);
    const fall = this.nextSimulationRandom() < this.fallEventRate;
    const stress = !fall && this.nextSimulationRandom() < this.stressEventRate;
    const profile = fall ? 'fall' : stress ? 'stressed' : tick % 4 === 0 ? 'walking' : 'resting';
    const batteryPercent = Math.max(15, Math.round((92 - (tick % 770) * 0.1) * 10) / 10);
    const edge = new WearableEdgeAI({
      clockNow: () => this.simulationNow(),
      random: () => this.nextSimulationRandom()
    });
    const frame = edge.generateFrame({
      deviceRef: deviceReference,
      sequence: tick,
      profile,
      batteryLevelPercent: batteryPercent
    });
    const inference = edge.infer(frame);
    const generatedEvents: ManufacturerSimulationEvent[] = [];
    if (fall) {
      generatedEvents.push(this.pushSimulationEvent({
        eventType: 'fall_detected',
        deviceType: 'wearable',
        deviceReferences: [deviceReference],
        severity: 'critical',
        occurredAt: frame.capturedAtMs
      }));
    } else if (stress) {
      generatedEvents.push(this.pushSimulationEvent({
        eventType: 'stress_spike',
        deviceType: 'wearable',
        deviceReferences: [deviceReference],
        severity: 'warning',
        occurredAt: frame.capturedAtMs
      }));
    }
    this.updateSimulatedDeviceState('wearable', deviceReference, {
      online: true,
      batteryPercent,
      status: fall ? 'fall_alert' : stress ? 'stress_alert' : inference.inference.activity,
      observedAt: frame.capturedAtMs
    });
    return {
      contract_version: 'vl-simulation-wearable-telemetry/1',
      device_reference: deviceReference,
      observed_at: frame.capturedAtMs,
      sensor_frame: frame,
      inference,
      location: {
        latitude: 1.2902,
        longitude: 103.8519,
        accuracy_meters: 5,
        synthetic: true
      },
      events: generatedEvents,
      synthetic: true
    };
  }

  private robotTelemetry(rawDeviceId: string): JsonObject {
    const deviceReference = safeReference(rawDeviceId);
    const tick = this.nextSimulationTick('home_robot', deviceReference);
    const fall = this.nextSimulationRandom() < this.fallEventRate;
    const profile = fall ? 'fall' : tick % 3 === 0 ? 'navigating' : 'idle';
    const edge = new RobotEdgeAI({
      clockNow: () => this.simulationNow(),
      random: () => this.nextSimulationRandom()
    });
    const frame = edge.generateFrame({ deviceRef: deviceReference, sequence: tick, profile });
    const inference = edge.infer(frame);
    const generatedEvents: ManufacturerSimulationEvent[] = [];
    if (fall) {
      generatedEvents.push(this.pushSimulationEvent({
        eventType: 'fall_detected',
        deviceType: 'home_robot',
        deviceReferences: [deviceReference],
        severity: 'critical',
        occurredAt: frame.capturedAtMs
      }));
    }
    const medicationDue = this.medicationReminderEveryTicks > 0
      && tick % this.medicationReminderEveryTicks === 0;
    if (medicationDue) {
      generatedEvents.push(this.pushSimulationEvent({
        eventType: 'medication_reminder',
        deviceType: 'home_robot',
        deviceReferences: [deviceReference],
        severity: 'info',
        occurredAt: frame.capturedAtMs
      }));
    }
    this.updateSimulatedDeviceState('home_robot', deviceReference, {
      online: true,
      batteryPercent: 78,
      status: fall ? 'fall_alert' : medicationDue ? 'medication_reminder' : frame.motor.mode,
      observedAt: frame.capturedAtMs
    });
    return {
      contract_version: 'vl-simulation-robot-telemetry/1',
      device_reference: deviceReference,
      observed_at: frame.capturedAtMs,
      feature_frame: frame,
      inference,
      raw_camera_retained: false,
      raw_microphone_retained: false,
      events: generatedEvents,
      synthetic: true
    };
  }

  private startTelemetryStream(
    request: IncomingMessage,
    response: ServerResponse,
    deviceId: string,
    payloadFactory: () => JsonObject = () => this.genericTelemetry(deviceId),
    eventName = 'telemetry'
  ): void {
    if (this.activeTelemetryStreams >= this.maxTelemetryStreams) {
      throw new MockRequestError(429, 'TELEMETRY_STREAM_CAPACITY_EXCEEDED');
    }
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    });
    this.activeTelemetryStreams += 1;
    // The request/header deadline protects stream establishment. Once admitted,
    // the explicitly bounded SSE stream may remain open between telemetry ticks.
    request.socket.setTimeout(0);
    let backpressured = false;
    let cleanedUp = false;
    let interval: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (interval) {
        clearInterval(interval);
        this.telemetryIntervals.delete(interval);
      }
      if (!request.socket.destroyed) {
        request.socket.setTimeout(Math.min(120_000, this.requestTimeoutMs + 1_000));
      }
      this.activeTelemetryStreams = Math.max(0, this.activeTelemetryStreams - 1);
    };
    const send = (): void => {
      if (!response.destroyed && !response.writableEnded) {
        if (backpressured) return;
        let payload: JsonObject;
        try {
          payload = payloadFactory();
        } catch {
          cleanup();
          response.destroy();
          return;
        }
        backpressured = !response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
        if (backpressured) response.once('drain', () => { backpressured = false; });
      }
    };
    send();
    if (!cleanedUp) {
      interval = setInterval(send, this.telemetryIntervalMs);
      interval.unref?.();
      this.telemetryIntervals.add(interval);
    }
    request.once('aborted', cleanup);
    response.once('close', cleanup);
  }
}

export function createManufacturerMockServer(
  options: ManufacturerMockServerOptions = {}
): ManufacturerMockServer {
  return new ManufacturerMockServer(options);
}

function numericEnvironment(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

async function runFromCommandLine(): Promise<void> {
  const asyncAckCallbackCredentials = Object.fromEntries([
    ['yongyida-cloud', process.env.YONGYIDA_CALLBACK_API_KEY],
    ['jiangzhi-edge', process.env.JIANGZHI_CALLBACK_API_KEY]
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
  const simulator = createManufacturerMockServer({
    environment: process.env.NODE_ENV,
    port: numericEnvironment('MOCK_MANUFACTURER_PORT', DEFAULT_PORT),
    latencyMinMs: numericEnvironment('MOCK_MANUFACTURER_LATENCY_MIN_MS', DEFAULT_LATENCY_MIN_MS),
    latencyMaxMs: numericEnvironment('MOCK_MANUFACTURER_LATENCY_MAX_MS', DEFAULT_LATENCY_MAX_MS),
    failureRate: numericEnvironment('MOCK_MANUFACTURER_FAILURE_RATE', DEFAULT_FAILURE_RATE),
    telemetryIntervalMs: numericEnvironment('MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS', DEFAULT_TELEMETRY_INTERVAL_MS),
    fallEventRate: numericEnvironment('MOCK_MANUFACTURER_FALL_EVENT_RATE', DEFAULT_FALL_EVENT_RATE),
    stressEventRate: numericEnvironment('MOCK_MANUFACTURER_STRESS_EVENT_RATE', DEFAULT_STRESS_EVENT_RATE),
    medicationReminderEveryTicks: numericEnvironment(
      'MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS',
      DEFAULT_MEDICATION_REMINDER_EVERY_TICKS
    ),
    maxSimulatedDevices: numericEnvironment(
      'MOCK_MANUFACTURER_MAX_SIMULATED_DEVICES',
      DEFAULT_MAX_SIMULATED_DEVICES
    ),
    maxRequestBytes: numericEnvironment('MOCK_MANUFACTURER_MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES),
    requestTimeoutMs: numericEnvironment('MOCK_MANUFACTURER_REQUEST_TIMEOUT_MS', DEFAULT_REQUEST_TIMEOUT_MS),
    maxQueueKeys: numericEnvironment('MOCK_MANUFACTURER_MAX_QUEUE_KEYS', DEFAULT_MAX_QUEUE_KEYS),
    maxQueuedCommandsTotal: numericEnvironment(
      'MOCK_MANUFACTURER_MAX_QUEUED_COMMANDS_TOTAL',
      DEFAULT_MAX_QUEUED_COMMANDS_TOTAL
    ),
    maxConnections: numericEnvironment('MOCK_MANUFACTURER_MAX_CONNECTIONS', DEFAULT_MAX_CONNECTIONS),
    maxConcurrentRequests: numericEnvironment(
      'MOCK_MANUFACTURER_MAX_CONCURRENT_REQUESTS',
      DEFAULT_MAX_CONCURRENT_REQUESTS
    ),
    maxTelemetryStreams: numericEnvironment(
      'MOCK_MANUFACTURER_MAX_TELEMETRY_STREAMS',
      DEFAULT_MAX_TELEMETRY_STREAMS
    ),
    asyncAckCallbackUrl: process.env.MOCK_MANUFACTURER_ACK_CALLBACK_URL,
    asyncAckCallbackCredentials: Object.keys(asyncAckCallbackCredentials).length
      ? asyncAckCallbackCredentials
      : undefined,
    asyncAckDelayMs: numericEnvironment(
      'MOCK_MANUFACTURER_ACK_DELAY_MS',
      DEFAULT_ASYNC_ACK_DELAY_MS
    ),
    asyncAckTimeoutMs: numericEnvironment(
      'MOCK_MANUFACTURER_ACK_TIMEOUT_MS',
      DEFAULT_ASYNC_ACK_TIMEOUT_MS
    ),
    maxAsyncAckRequestBytes: numericEnvironment(
      'MOCK_MANUFACTURER_ACK_MAX_REQUEST_BYTES',
      DEFAULT_MAX_ASYNC_ACK_REQUEST_BYTES
    ),
    maxAsyncAckResponseBytes: numericEnvironment(
      'MOCK_MANUFACTURER_ACK_MAX_RESPONSE_BYTES',
      DEFAULT_MAX_ASYNC_ACK_RESPONSE_BYTES
    ),
    seed: numericEnvironment('MOCK_MANUFACTURER_SEED', 0x564c3032),
    apiKey: process.env.MOCK_MANUFACTURER_API_KEY,
    signedActionPublicKey: process.env.ACTION_SIGNING_PUBLIC_KEY
  });
  const address = await simulator.start();
  process.stdout.write(`${JSON.stringify({
    event: 'manufacturer_mock.started',
    baseUrl: address.baseUrl,
    latencyRangeMs: [
      numericEnvironment('MOCK_MANUFACTURER_LATENCY_MIN_MS', DEFAULT_LATENCY_MIN_MS),
      numericEnvironment('MOCK_MANUFACTURER_LATENCY_MAX_MS', DEFAULT_LATENCY_MAX_MS)
    ],
    failureRate: numericEnvironment('MOCK_MANUFACTURER_FAILURE_RATE', DEFAULT_FAILURE_RATE)
  })}\n`);
  const shutdown = (): void => { void simulator.stop().then(() => process.exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  void runFromCommandLine().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Manufacturer mock failed'}\n`);
    process.exitCode = 1;
  });
}
