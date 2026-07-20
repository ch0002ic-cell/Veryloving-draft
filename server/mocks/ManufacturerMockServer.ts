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
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
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

export interface ManufacturerMockLogEntry {
  readonly event: 'manufacturer_mock.request';
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
  /** Ed25519 SPKI PEM/DER or a base64url-encoded 32-byte raw public key. */
  readonly signedActionPublicKey?: string | Buffer | KeyObject;
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
  private readonly signedActionPublicKey?: KeyObject;
  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly sessionToken: string;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly logSink: (entry: ManufacturerMockLogEntry) => void;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly telemetryIntervals = new Set<NodeJS.Timeout>();
  private readonly pendingDelays = new Map<NodeJS.Timeout, () => void>();
  private readonly queueTails = new Map<string, Promise<void>>();
  private readonly queueDepths = new Map<string, number>();
  private readonly commands: ManufacturerMockCommandRecord[] = [];
  private readonly idempotency = new Map<string, { readonly fingerprint: string; readonly payload: JsonObject }>();
  private requestSequence = 0;
  private commandSequence = 0;
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
    this.signedActionPublicKey = normalizeSigningPublicKey(options.signedActionPublicKey);
    this.apiKey = normalizeSecret(options.apiKey, 'mock-server-only-api-key', 'Mock manufacturer API key');
    this.accessToken = normalizeSecret(options.accessToken, 'mock-development-access-token', 'Mock manufacturer access token');
    this.sessionToken = normalizeSecret(options.sessionToken, 'mock-development-session-token', 'Mock bridge session token');
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
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
        this.server.closeAllConnections?.();
        for (const socket of this.sockets) socket.destroy();
      });
    })().finally(() => {
      this.startedAddress = undefined;
      this.stoppingPromise = undefined;
      this.queueTails.clear();
      this.queueDepths.clear();
      this.queuedCommandsTotal = 0;
      this.activeTelemetryStreams = 0;
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
        const previous = this.idempotency.get(idempotencyScope);
        if (previous) {
          if (previous.fingerprint !== fingerprint) {
            throw new MockRequestError(409, 'IDEMPOTENCY_CONFLICT');
          }
          writeJson(response, 202, previous.payload);
          return;
        }

        const payload = Object.freeze({ state: 'accepted', ok: true, action_id: actionId });
        this.recordCommand(deviceId, String(envelope.action), startedAt);
        this.rememberIdempotency(idempotencyScope, fingerprint, payload);
        writeJson(response, 202, payload);
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
    const latency = this.latencyMinMs + Math.floor(this.random() * (span + 1));
    await this.delay(latency);
    if (this.random() < this.failureRate) throw new MockRequestError(503, 'SIMULATED_FAILURE');
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
      duplicate: false
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

  private startTelemetryStream(
    request: IncomingMessage,
    response: ServerResponse,
    deviceId: string
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
    const send = (): void => {
      if (!response.destroyed && !response.writableEnded) {
        if (backpressured) return;
        backpressured = !response.write(
          `event: telemetry\ndata: ${JSON.stringify(this.genericTelemetry(deviceId))}\n\n`
        );
        if (backpressured) response.once('drain', () => { backpressured = false; });
      }
    };
    send();
    const interval = setInterval(send, this.telemetryIntervalMs);
    interval.unref?.();
    this.telemetryIntervals.add(interval);
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(interval);
      this.telemetryIntervals.delete(interval);
      this.activeTelemetryStreams = Math.max(0, this.activeTelemetryStreams - 1);
    };
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
  const simulator = createManufacturerMockServer({
    environment: process.env.NODE_ENV,
    port: numericEnvironment('MOCK_MANUFACTURER_PORT', DEFAULT_PORT),
    latencyMinMs: numericEnvironment('MOCK_MANUFACTURER_LATENCY_MIN_MS', DEFAULT_LATENCY_MIN_MS),
    latencyMaxMs: numericEnvironment('MOCK_MANUFACTURER_LATENCY_MAX_MS', DEFAULT_LATENCY_MAX_MS),
    failureRate: numericEnvironment('MOCK_MANUFACTURER_FAILURE_RATE', DEFAULT_FAILURE_RATE),
    telemetryIntervalMs: numericEnvironment('MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS', DEFAULT_TELEMETRY_INTERVAL_MS),
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
