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
  randomBytes,
  timingSafeEqual,
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
const DEFAULT_MAX_DASHBOARD_STREAMS = 10;
const DEFAULT_MAIN_SERVER_URL = 'http://127.0.0.1:8787/';
const DEFAULT_MAIN_SERVER_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_MAIN_SERVER_RESPONSE_BYTES = 64 * 1024;
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
const DASHBOARD_COOKIE_NAME = 'vl_mock_dashboard_session';
const DASHBOARD_COOKIE_MAX_AGE_SECONDS = 60 * 60;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CAMERA_SESSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCENARIO_PATTERN = /^[a-z][a-z0-9_:-]{0,63}$/;
const SCENARIO_STATUSES: readonly ManufacturerScenarioStatus[] = Object.freeze([
  'started', 'completed', 'fallback', 'failed', 'cancelled'
]);
const DASHBOARD_SCENARIO_IDS = Object.freeze([
  'fall-detection',
  'medication-adherence',
  'emotional-check-in',
  'cognitive-engagement',
  'ai-angel-auto-dial'
] as const);
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
  readonly maxDashboardStreams?: number;
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
  /** Loopback-only Veryloving server used by the development dashboard proxy. */
  readonly mainServerUrl?: string;
  readonly mainServerTimeoutMs?: number;
  readonly maxMainServerResponseBytes?: number;
  /** Fixed account accepted by the local dashboard and its main-server proxy. */
  readonly dashboardUserId?: string;
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
  readonly dashboardStreams: number;
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

function writeDashboardHtml(
  response: ServerResponse,
  dashboardSessionToken: string,
  dashboardUserId: string
): void {
  if (response.destroyed || response.writableEnded) return;
  const nonce = randomBytes(18).toString('base64url');
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Veryloving Care Orchestration Lab</title>
<style nonce="${nonce}">
:root{--ink:#17213b;--muted:#667085;--panel:#fff;--line:#e6eaf0;--pink:#ed5377;--pink2:#ff7897;--blue:#4568dc;--green:#18a66a;--amber:#e78b12;--red:#d84b4b;--shadow:0 10px 30px rgba(25,36,66,.08)}
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:var(--ink);font:15px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font:inherit}
.hero{background:linear-gradient(120deg,#17213b,#35446d);color:#fff;padding:28px max(22px,calc((100vw - 1180px)/2));box-shadow:0 4px 20px rgba(15,23,42,.2)}
.brand{display:flex;align-items:center;gap:14px}.heart{display:grid;place-items:center;width:44px;height:44px;border-radius:14px;background:linear-gradient(145deg,var(--pink2),var(--pink));font-size:23px;box-shadow:0 8px 20px rgba(237,83,119,.35)}h1{font-size:25px;margin:0}.subtitle{margin:3px 0 0;color:#ced6ed}.live{margin-left:auto;display:flex;align-items:center;gap:7px;padding:7px 11px;border:1px solid rgba(255,255,255,.2);border-radius:999px;font-size:12px}.dot{width:8px;height:8px;border-radius:50%;background:#f8b84e}.dot.connected{background:#55db92;box-shadow:0 0 0 4px rgba(85,219,146,.12)}
main{max-width:1180px;margin:0 auto;padding:24px 22px 50px}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:-9px}.metric,.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}.metric{padding:17px}.metric-label{color:var(--muted);font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.05em}.metric-value{font-size:25px;font-weight:750;margin-top:4px}
.panel{margin-top:18px;padding:20px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:16px}h2{font-size:18px;margin:0}.hint{color:var(--muted);font-size:13px;margin:3px 0 0}.scenario-buttons{display:grid;grid-template-columns:repeat(5,minmax(150px,1fr));gap:10px}.scenario-button{min-height:80px;text-align:left;border:1px solid #e1e6ef;background:#fafbfe;border-radius:13px;padding:13px;color:var(--ink);cursor:pointer;transition:.15s ease}.scenario-button:hover{transform:translateY(-1px);border-color:#bdc8df;box-shadow:0 6px 16px rgba(33,49,86,.08)}.scenario-button:focus-visible{outline:3px solid rgba(69,104,220,.3);outline-offset:2px}.scenario-button:disabled{cursor:wait;opacity:.55;transform:none}.scenario-icon{font-size:21px;display:block;margin-bottom:5px}.scenario-name{font-size:13px;font-weight:700;display:block}.scenario-priority{color:var(--muted);font-size:11px}.result{display:none;margin-top:12px;padding:10px 12px;border-radius:10px;background:#eaf8f1;color:#126a47;font-size:13px}.result.visible{display:block}.result.error{background:#fff0f0;color:#a33333}
.device-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.device{border:1px solid var(--line);border-radius:14px;padding:16px;background:#fff}.device-top{display:flex;align-items:center;gap:11px}.device-icon{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#eef2ff;font-size:22px}.device-title{font-weight:700}.reference{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}.status{margin-left:auto;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#edf9f3;color:#128557}.status.offline{background:#f2f3f5;color:#68707e}.device-state{margin:14px 0 9px;display:flex;justify-content:space-between;color:var(--muted);font-size:12px}.battery{display:block;width:100%;height:7px;border:0;border-radius:99px;overflow:hidden;background:#edf0f5;appearance:none}.battery::-webkit-progress-bar{background:#edf0f5}.battery::-webkit-progress-value{background:linear-gradient(90deg,var(--green),#50cf94)}.battery::-moz-progress-bar{background:linear-gradient(90deg,var(--green),#50cf94)}.battery.low::-webkit-progress-value{background:linear-gradient(90deg,var(--red),#ee7c6f)}.battery.low::-moz-progress-bar{background:linear-gradient(90deg,var(--red),#ee7c6f)}.last-seen{margin-top:9px;color:var(--muted);font-size:11px}
.empty{border:1px dashed #ced5e1;border-radius:12px;padding:24px;text-align:center;color:var(--muted)}.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;min-width:720px}th,td{text-align:left;padding:11px 13px;border-bottom:1px solid var(--line);font-size:12px}th{background:#f8f9fc;color:#667085;font-size:11px;text-transform:uppercase;letter-spacing:.04em}tbody tr:last-child td{border-bottom:0}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#e9efff;color:#3155ba;font-weight:700}.badge.completed{background:#eaf8f1;color:#14794f}.badge.failed,.badge.fallback{background:#fff1e5;color:#9a520e}.source{font-weight:650;color:#4a5b88}.events{display:grid;gap:8px}.event{display:grid;grid-template-columns:10px minmax(150px,1fr) auto;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding:9px 2px}.event:last-child{border-bottom:0}.severity{width:8px;height:8px;border-radius:50%;background:var(--blue)}.severity.warning{background:var(--amber)}.severity.critical{background:var(--red)}.event-title{font-weight:650;font-size:13px}.event-meta,.event-time{color:var(--muted);font-size:11px}.footer{text-align:center;color:var(--muted);font-size:11px;margin-top:20px}
@media(max-width:900px){.metrics{grid-template-columns:repeat(2,1fr)}.scenario-buttons{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.hero{padding:22px}.live{display:none}main{padding:18px 14px 36px}.metrics{grid-template-columns:1fr 1fr}.scenario-buttons{grid-template-columns:1fr}.panel{padding:16px}.metric-value{font-size:21px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
</style></head>
<body><header class="hero"><div class="brand"><div class="heart" aria-hidden="true">♥</div><div><h1>Care Orchestration Lab</h1><p class="subtitle">Wearable + home robot simulation</p></div><div class="live"><span id="stream-dot" class="dot"></span><span id="stream-status">Connecting</span></div></div></header>
<main>
<section class="metrics" aria-label="Simulation summary"><article class="metric"><div class="metric-label">Devices online</div><div id="online-count" class="metric-value">0 / 0</div></article><article class="metric"><div class="metric-label">Active scenarios</div><div id="active-count" class="metric-value">0</div></article><article class="metric"><div class="metric-label">Recent events</div><div id="event-count" class="metric-value">0</div></article><article class="metric"><div class="metric-label">Last update</div><div id="updated-at" class="metric-value">—</div></article></section>
<section class="panel"><div class="panel-head"><div><h2>Launch a care scenario</h2><p class="hint">Development-only controls execute against the local AI-native server.</p></div></div><div class="scenario-buttons" id="scenario-buttons">
<button class="scenario-button" data-scenario="fall-detection"><span class="scenario-icon" aria-hidden="true">⚠️</span><span class="scenario-name">Fall response</span><span class="scenario-priority">Critical</span></button>
<button class="scenario-button" data-scenario="medication-adherence"><span class="scenario-icon" aria-hidden="true">💊</span><span class="scenario-name">Medication reminder</span><span class="scenario-priority">Standard</span></button>
<button class="scenario-button" data-scenario="emotional-check-in"><span class="scenario-icon" aria-hidden="true">💗</span><span class="scenario-name">Emotional check-in</span><span class="scenario-priority">Standard</span></button>
<button class="scenario-button" data-scenario="cognitive-engagement"><span class="scenario-icon" aria-hidden="true">🧠</span><span class="scenario-name">Cognitive engagement</span><span class="scenario-priority">Background</span></button>
<button class="scenario-button" data-scenario="ai-angel-auto-dial"><span class="scenario-icon" aria-hidden="true">📞</span><span class="scenario-name">AI Angel auto-dial</span><span class="scenario-priority">Critical</span></button>
</div><div id="trigger-result" class="result" role="status" aria-live="polite"></div></section>
<section class="panel"><div class="panel-head"><div><h2>Connected devices</h2><p class="hint">Redacted references and live synthetic telemetry.</p></div></div><div id="devices" class="device-grid"><div class="empty">Waiting for device telemetry…</div></div></section>
<section class="panel"><div class="panel-head"><div><h2>Scenario executions</h2><p class="hint">AI-native executions and simulator lifecycle events.</p></div></div><div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Source</th><th>Status</th><th>Execution</th><th>Devices</th><th>Observed</th></tr></thead><tbody id="scenario-rows"><tr><td colspan="6">No scenario executions yet.</td></tr></tbody></table></div></section>
<section class="panel"><div class="panel-head"><div><h2>Recent events</h2><p class="hint">The latest ten safety, wellness, and lifecycle events.</p></div></div><div id="events" class="events"><div class="empty">Waiting for events…</div></div></section>
<p class="footer">Local synthetic data only · Raw media, device identifiers, and credentials are never displayed</p>
</main>
<script nonce="${nonce}">
'use strict';
(function(){
  var dashboardUserId=${JSON.stringify(dashboardUserId)};
  var snapshot={devices:[],scenarioExecutions:[],lastEvents:[],generatedAt:0};
  var realExecutions=[];
  var clickSequence=0;
  var refreshTimer;
  var refreshPromise=null;
  var names={'fall-detection':'Fall response','fall_detection':'Fall response','medication-adherence':'Medication adherence','medication_adherence':'Medication adherence','emotional-check-in':'Emotional check-in','emotional_check_in':'Emotional check-in','cognitive-engagement':'Cognitive engagement','cognitive_engagement':'Cognitive engagement','ai-angel-auto-dial':'AI Angel auto-dial','ai_angel_auto_dial':'AI Angel auto-dial'};
  function el(tag,className,text){var node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node}
  function time(value){var date=new Date(Number(value));return Number.isFinite(date.getTime())?date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}
  function label(value){return names[value]||String(value||'Unknown').replace(/[_-]+/g,' ')}
  function shortRef(value){var text=String(value||'—');return text.length>20?text.slice(0,10)+'…'+text.slice(-6):text}
  function normalizeExecutions(payload){var body=payload&&payload.response?payload.response:payload;var list=body&&(body.executions||body.items||body.started);return Array.isArray(list)?list:[]}
  function renderDevices(){var root=document.getElementById('devices');root.replaceChildren();var devices=Array.isArray(snapshot.devices)?snapshot.devices:[];if(!devices.length){root.append(el('div','empty','Waiting for device telemetry…'));return}devices.forEach(function(device){var card=el('article','device');var top=el('div','device-top');top.append(el('div','device-icon',device.deviceType==='wearable'?'⌚':'🤖'));var title=el('div');title.append(el('div','device-title',device.deviceType==='wearable'?'Safety wearable':'Home companion robot'));title.append(el('div','reference',shortRef(device.deviceReference)));top.append(title);top.append(el('span','status'+(device.online?'':' offline'),device.online?'Online':'Offline'));card.append(top);var state=el('div','device-state');state.append(el('span','',label(device.status)));state.append(el('span','',String(device.batteryPercent)+'% battery'));card.append(state);var battery=el('progress','battery'+(Number(device.batteryPercent)<20?' low':''));battery.max=100;battery.value=Math.max(0,Math.min(100,Number(device.batteryPercent)||0));battery.setAttribute('aria-label','Battery '+String(device.batteryPercent)+' percent');card.append(battery);card.append(el('div','last-seen','Last seen '+time(device.observedAt)));root.append(card)})}
  function executionRecord(item,source){var scenario=item.scenarioId||item.scenario_id;var execution=item.executionId||item.execution_id||item.executionReference||item.id;var status=item.status||item.state||'started';var observed=item.updatedAt||item.updated_at||item.observedAt||item.observed_at||item.startedAt||item.started_at||item.createdAt||item.created_at||Date.now();var refs=item.deviceReferences||item.device_references||[];if(!Array.isArray(refs)&&refs&&typeof refs==='object')refs=Object.values(refs).filter(function(value){return typeof value==='string'});return {scenario:scenario,execution:execution,status:status,observed:observed,refs:Array.isArray(refs)?refs:[],source:source}}
  function renderScenarios(){var root=document.getElementById('scenario-rows');root.replaceChildren();var synthetic=(Array.isArray(snapshot.scenarioExecutions)?snapshot.scenarioExecutions:[]).map(function(x){return executionRecord(x,'Simulator')});var real=realExecutions.map(function(x){return executionRecord(x,'AI-native')});var rows=real.concat(synthetic).sort(function(a,b){return Number(b.observed)-Number(a.observed)}).slice(0,30);if(!rows.length){var tr=el('tr');var td=el('td','','No scenario executions yet.');td.colSpan=6;tr.append(td);root.append(tr);return}rows.forEach(function(item){var tr=el('tr');tr.append(el('td','',label(item.scenario)));tr.append(el('td','source',item.source));var statusCell=el('td');statusCell.append(el('span','badge '+String(item.status),String(item.status)));tr.append(statusCell);tr.append(el('td','reference',shortRef(item.execution)));tr.append(el('td','reference',item.refs.length?item.refs.map(shortRef).join(', '):'—'));tr.append(el('td','',time(item.observed)));root.append(tr)})}
  function renderEvents(){var root=document.getElementById('events');root.replaceChildren();var events=Array.isArray(snapshot.lastEvents)?snapshot.lastEvents.slice().reverse():[];if(!events.length){root.append(el('div','empty','Waiting for events…'));return}events.forEach(function(item){var row=el('article','event');row.append(el('span','severity '+String(item.severity||'info')));var detail=el('div');detail.append(el('div','event-title',label(item.eventType)));detail.append(el('div','event-meta',[item.deviceType,label(item.scenarioId),item.scenarioStatus].filter(Boolean).join(' · ')));row.append(detail);row.append(el('time','event-time',time(item.occurredAt)));root.append(row)})}
  function renderMetrics(){var devices=Array.isArray(snapshot.devices)?snapshot.devices:[];document.getElementById('online-count').textContent=devices.filter(function(x){return x.online}).length+' / '+devices.length;var all=realExecutions.concat(Array.isArray(snapshot.scenarioExecutions)?snapshot.scenarioExecutions:[]);document.getElementById('active-count').textContent=String(all.filter(function(x){return ['started','queued','running'].includes(x.status||x.state)}).length);document.getElementById('event-count').textContent=String(Array.isArray(snapshot.lastEvents)?snapshot.lastEvents.length:0);document.getElementById('updated-at').textContent=time(snapshot.generatedAt)}
  function render(){renderDevices();renderScenarios();renderEvents();renderMetrics()}
  function connection(connected){document.getElementById('stream-dot').className='dot'+(connected?' connected':'');document.getElementById('stream-status').textContent=connected?'Live':'Reconnecting'}
  async function post(path,body,idempotencyKey){var controller=new AbortController();var timer=setTimeout(function(){controller.abort()},8000);try{var headers={'Content-Type':'application/json','Accept':'application/json'};if(idempotencyKey)headers['Idempotency-Key']=idempotencyKey;var response=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'error',headers:headers,body:JSON.stringify(body),signal:controller.signal});var text=await response.text();if(text.length>65536)throw new Error('RESPONSE_TOO_LARGE');var payload;try{payload=text?JSON.parse(text):{}}catch(_error){payload={error:'INVALID_RESPONSE'}}if(!response.ok){throw new Error(String(payload.error||'REQUEST_FAILED'))}return payload}finally{clearTimeout(timer)}}
  function requestKey(scenario){if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return 'dashboard-'+globalThis.crypto.randomUUID();clickSequence+=1;return 'dashboard-'+scenario+'-'+Date.now()+'-'+clickSequence}
  function refreshReal(){if(refreshPromise)return refreshPromise;refreshPromise=(async function(){try{var payload=await post('/api/v1/simulation/executions',{userId:dashboardUserId});realExecutions=normalizeExecutions(payload);renderScenarios();renderMetrics()}catch(_error){realExecutions=[];renderScenarios();renderMetrics()}finally{refreshPromise=null}})();return refreshPromise}
  async function refreshAfterMutation(){var joined=refreshPromise!==null;await refreshReal();if(joined)await refreshReal()}
  document.getElementById('scenario-buttons').addEventListener('click',async function(event){var button=event.target.closest('button[data-scenario]');if(!button)return;var result=document.getElementById('trigger-result');var idempotencyKey=requestKey(button.dataset.scenario);button.disabled=true;result.className='result visible';result.textContent='Starting '+label(button.dataset.scenario)+'…';try{var payload=await post('/api/v1/simulation/trigger',{scenarioId:button.dataset.scenario,userId:dashboardUserId,deviceId:'wearable-1',robotDeviceId:'home-robot-1',occurredAt:Date.now()},idempotencyKey);var upstream=payload.response||payload;result.textContent='Started '+label(button.dataset.scenario)+(upstream.executionId?' · '+shortRef(upstream.executionId):'');await refreshAfterMutation()}catch(error){result.className='result visible error';result.textContent='Could not start scenario: '+String(error.message||'REQUEST_FAILED')}finally{button.disabled=false}});
  var stream=new EventSource('/api/v1/simulation/dashboard/events',{withCredentials:true});stream.addEventListener('dashboard',function(event){try{snapshot=JSON.parse(event.data);render();connection(true)}catch(_error){connection(false)}});stream.onopen=function(){connection(true)};stream.onerror=function(){connection(false)};
  refreshReal();refreshTimer=setInterval(refreshReal,3000);window.addEventListener('beforeunload',function(){clearInterval(refreshTimer);stream.close()},{once:true});
}());
</script></body></html>`;
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'Content-Security-Policy': `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'`,
    'Content-Type': 'text/html; charset=utf-8',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'Set-Cookie': `${DASHBOARD_COOKIE_NAME}=${dashboardSessionToken}; HttpOnly; SameSite=Strict; Path=/api/v1/simulation; Max-Age=${DASHBOARD_COOKIE_MAX_AGE_SECONDS}`,
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

function normalizeLoopbackMainServerUrl(value: string | undefined): URL {
  let parsed: URL;
  try {
    parsed = new URL(value ?? DEFAULT_MAIN_SERVER_URL);
  } catch {
    throw new TypeError('Mock dashboard main-server URL is invalid');
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)
    || !['http:', 'https:'].includes(parsed.protocol)
    || parsed.pathname !== '/'
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new TypeError('Mock dashboard main-server URL must be credential-free and loopback-only');
  }
  return parsed;
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
  private readonly maxDashboardStreams: number;
  private readonly signedActionFutureSkewMs: number;
  private readonly fallEventRate: number;
  private readonly stressEventRate: number;
  private readonly medicationReminderEveryTicks: number;
  private readonly maxSimulatedDevices: number;
  private readonly signedActionPublicKey?: KeyObject;
  private readonly apiKey: string;
  private readonly accessToken: string;
  private readonly sessionToken: string;
  private readonly dashboardSessionToken: string;
  private readonly mainServerUrl: URL;
  private readonly mainServerTimeoutMs: number;
  private readonly maxMainServerResponseBytes: number;
  private readonly dashboardUserId: string;
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
  private readonly dashboardStreams = new Set<ServerResponse>();
  private readonly pendingRequests = new Set<Promise<void>>();
  private readonly pendingMainServerRequests = new Set<Promise<unknown>>();
  private readonly mainServerControllers = new Set<AbortController>();
  private readonly mainServerTimeouts = new Set<NodeJS.Timeout>();
  private readonly pendingDelays = new Map<NodeJS.Timeout, () => void>();
  private readonly pendingAsyncAckTimers = new Set<NodeJS.Timeout>();
  private readonly pendingAsyncAcks = new Set<Promise<void>>();
  private readonly asyncAckControllers = new Set<AbortController>();
  private readonly asyncAckTimeouts = new Set<NodeJS.Timeout>();
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
  private lifecycleGeneration = 0;
  private activeRequests = 0;
  private activeTelemetryStreams = 0;
  private queuedCommandsTotal = 0;
  private startedAddress?: ManufacturerMockAddress;
  private startingPromise?: Promise<ManufacturerMockAddress>;
  private stoppingPromise?: Promise<void>;
  private simulationHeartbeat?: NodeJS.Timeout;
  private dashboardHeartbeat?: NodeJS.Timeout;
  private dashboardBroadcastImmediate?: NodeJS.Immediate;

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
    this.maxDashboardStreams = boundedInteger(
      options.maxDashboardStreams,
      DEFAULT_MAX_DASHBOARD_STREAMS,
      1,
      100,
      'Mock manufacturer dashboard-stream limit'
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
    // Ephemeral per process: the dashboard cookie must not be derivable from
    // the intentionally public development defaults used by this simulator.
    this.dashboardSessionToken = randomBytes(32).toString('base64url');
    this.mainServerUrl = normalizeLoopbackMainServerUrl(options.mainServerUrl);
    this.mainServerTimeoutMs = boundedInteger(
      options.mainServerTimeoutMs,
      DEFAULT_MAIN_SERVER_TIMEOUT_MS,
      100,
      120_000,
      'Mock dashboard main-server timeout'
    );
    this.maxMainServerResponseBytes = boundedInteger(
      options.maxMainServerResponseBytes,
      DEFAULT_MAX_MAIN_SERVER_RESPONSE_BYTES,
      128,
      1024 * 1024,
      'Mock dashboard main-server response limit'
    );
    this.dashboardUserId = options.dashboardUserId ?? 'test-user-1';
    if (!IDENTIFIER_PATTERN.test(this.dashboardUserId)) {
      throw new TypeError('Mock dashboard user identifier is invalid');
    }
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
      const pending = this.handleRequest(request, response);
      this.pendingRequests.add(pending);
      void pending.then(
        () => this.pendingRequests.delete(pending),
        () => this.pendingRequests.delete(pending)
      );
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
      dashboardStreams: this.dashboardStreams.size,
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
      this.refreshDefaultSimulationDevices();
      this.simulationHeartbeat = setInterval(
        () => this.refreshDefaultSimulationDevices(),
        Math.max(100, this.telemetryIntervalMs)
      );
      this.simulationHeartbeat.unref?.();
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
      if (this.simulationHeartbeat) clearInterval(this.simulationHeartbeat);
      this.simulationHeartbeat = undefined;
      for (const interval of this.telemetryIntervals) clearInterval(interval);
      this.telemetryIntervals.clear();
      if (this.dashboardHeartbeat) clearInterval(this.dashboardHeartbeat);
      this.dashboardHeartbeat = undefined;
      if (this.dashboardBroadcastImmediate) clearImmediate(this.dashboardBroadcastImmediate);
      this.dashboardBroadcastImmediate = undefined;
      for (const response of this.dashboardStreams) response.destroy();
      this.dashboardStreams.clear();
      for (const controller of this.mainServerControllers) controller.abort();
      for (const timeout of this.mainServerTimeouts) clearTimeout(timeout);
      this.mainServerTimeouts.clear();
      for (const [timeout, release] of this.pendingDelays) {
        clearTimeout(timeout);
        release();
      }
      this.pendingDelays.clear();
      for (const timeout of this.pendingAsyncAckTimers) clearTimeout(timeout);
      this.pendingAsyncAckTimers.clear();
      for (const controller of this.asyncAckControllers) controller.abort();
      for (const timeout of this.asyncAckTimeouts) clearTimeout(timeout);
      this.asyncAckTimeouts.clear();
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
        this.server.closeAllConnections?.();
        for (const socket of this.sockets) socket.destroy();
      });
      let drainTimeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.allSettled([
            ...this.pendingRequests,
            ...this.pendingMainServerRequests,
            ...this.pendingAsyncAcks
          ]),
          new Promise<void>((resolve) => {
            drainTimeout = setTimeout(resolve, Math.min(2_000, this.asyncAckTimeoutMs));
          })
        ]);
      } finally {
        if (drainTimeout) clearTimeout(drainTimeout);
      }
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
      this.activeRequests = 0;
      this.activeTelemetryStreams = 0;
      this.pendingAsyncAcks.clear();
      this.pendingRequests.clear();
      this.pendingMainServerRequests.clear();
      this.asyncAckControllers.clear();
      this.mainServerControllers.clear();
      this.lifecycleGeneration += 1;
    });
    return this.stoppingPromise;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestGeneration = this.lifecycleGeneration;
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
      if (request.method === 'POST') this.requireJsonContentType(request);
      const statusDevice = parseDevicePath(url.pathname, '/api/v1/status/');
      const telemetryDevice = parseDevicePath(url.pathname, '/api/v1/telemetry/');
      const wearableTelemetryDevice = parseDevicePath(url.pathname, '/api/v1/wearable/telemetry/');
      const robotTelemetryDevice = parseDevicePath(url.pathname, '/api/v1/robot/telemetry/');

      if (request.method === 'GET' && url.pathname === '/dashboard') {
        route = '/dashboard';
        writeDashboardHtml(response, this.dashboardSessionToken, this.dashboardUserId);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/simulation/dashboard') {
        route = '/api/v1/simulation/dashboard';
        this.requireDashboardAccess(request);
        writeJson(response, 200, { ...this.getSimulationDashboard() });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/simulation/dashboard/events') {
        route = '/api/v1/simulation/dashboard/events';
        this.requireDashboardAccess(request);
        this.startDashboardStream(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/simulation/trigger') {
        route = '/api/v1/simulation/trigger';
        this.requireDashboardMutationAccess(request);
        const body = await this.readJson(request);
        const scenario = this.parseDashboardScenarioRequest(body);
        const idempotencyKey = this.readOptionalIdempotencyKey(request);
        const upstream = await this.requestMainServer('/v1/scenarios', {
          method: 'POST',
          body: scenario,
          idempotencyKey
        });
        writeJson(response, upstream.statusCode, {
          upstreamStatus: upstream.statusCode,
          response: upstream.payload
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/simulation/executions') {
        route = '/api/v1/simulation/executions';
        this.requireDashboardMutationAccess(request);
        const body = await this.readJson(request);
        const userId = this.parseDashboardExecutionsRequest(body);
        const pathname = `/v1/scenarios/executions?userId=${encodeURIComponent(userId)}`;
        const upstream = await this.requestMainServer(pathname, { method: 'GET' });
        writeJson(response, upstream.statusCode, {
          upstreamStatus: upstream.statusCode,
          response: upstream.payload
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/simulation/events') {
        route = '/api/v1/simulation/events';
        this.requireBearer(request, this.accessToken);
        const body = await this.readJson(request);
        deviceId = requiredIdentifier(body.device_id, 'device_id');
        const idempotencyKey = this.readOptionalIdempotencyKey(request);
        await this.simulateTransport();
        const replay = idempotencyKey
          ? this.replayMutation(`simulation-event\0${idempotencyKey}`, body)
          : undefined;
        if (replay) {
          writeJson(response, 201, replay);
          return;
        }
        const event = this.injectSimulationEvent(body, deviceId);
        const payload = { accepted: true, event };
        if (idempotencyKey) {
          this.rememberMutation(`simulation-event\0${idempotencyKey}`, body, payload);
        }
        writeJson(response, 201, payload);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/simulation/scenarios') {
        route = '/api/v1/simulation/scenarios';
        this.requireBearer(request, this.accessToken);
        const body = await this.readJson(request);
        const input = this.parseScenarioExecutionRequest(body);
        const idempotencyKey = this.readOptionalIdempotencyKey(request);
        await this.simulateTransport();
        const replay = idempotencyKey
          ? this.replayMutation(`simulation-scenario\0${idempotencyKey}`, body)
          : undefined;
        if (replay) {
          writeJson(response, 201, replay);
          return;
        }
        const scenario = this.recordScenarioExecution(input);
        const payload = { accepted: true, scenario };
        if (idempotencyKey) {
          this.rememberMutation(`simulation-scenario\0${idempotencyKey}`, body, payload);
        }
        writeJson(response, 201, payload);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/v1/authenticate') {
        route = '/api/v1/authenticate';
        this.requireBearer(request, this.apiKey);
        const body = await this.readJson(request);
        if (!hasOnlyKeys(body, ['device_id']) || Object.keys(body).length !== 1) {
          throw new MockRequestError(400, 'AUTHENTICATION_REQUEST_INVALID');
        }
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
        if (!hasOnlyKeys(body, ['device_id', 'command', 'parameters', 'idempotency_key'])
          || !Object.hasOwn(body, 'device_id')
          || !Object.hasOwn(body, 'command')) {
          throw new MockRequestError(400, 'COMMAND_INVALID');
        }
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
      if (admitted && requestGeneration === this.lifecycleGeneration) {
        this.activeRequests = Math.max(0, this.activeRequests - 1);
      }
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
      const pairingToken = body.pairing_token;
      if (!hasOnlyKeys(body, ['schema_version', 'device_id', 'pairing_token'])
        || !Object.hasOwn(body, 'schema_version')
        || !Object.hasOwn(body, 'device_id')
        || body.schema_version !== BRIDGE_PROTOCOL
        || (pairingToken !== undefined
          && (typeof pairingToken !== 'string'
            || pairingToken.length < 1
            || pairingToken.length > 4_096))) {
        throw new MockRequestError(400, 'SESSION_INVALID');
      }
      requiredIdentifier(body.device_id, 'device_id');
      await this.simulateTransport();
      writeJson(response, 200, { authenticated: true, session_token: this.sessionToken });
      return;
    }
    if (request.headers['x-veryloving-session'] !== this.sessionToken) {
      throw new MockRequestError(401, 'SESSION_UNAUTHORIZED');
    }

    if (endpoint === 'commands') {
      if (!hasOnlyKeys(body, ['schema_version', 'device_id', 'command', 'parameters'])
        || Object.keys(body).length !== 4
        || body.schema_version !== BRIDGE_PROTOCOL
        || !isObject(body.parameters)) {
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

  private requireJsonContentType(request: IncomingMessage): void {
    const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
      throw new MockRequestError(415, 'CONTENT_TYPE_INVALID');
    }
  }

  private hasDashboardCookie(request: IncomingMessage): boolean {
    const header = request.headers.cookie;
    if (typeof header !== 'string' || header.length > 4_096) return false;
    const prefix = `${DASHBOARD_COOKIE_NAME}=`;
    const value = header.split(';', 32)
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(prefix))
      ?.slice(prefix.length);
    if (!value || !BASE64URL_PATTERN.test(value)) return false;
    const actual = Buffer.from(value);
    const expected = Buffer.from(this.dashboardSessionToken);
    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  }

  private requireDashboardAccess(request: IncomingMessage): void {
    if (request.headers.authorization === `Bearer ${this.accessToken}`) return;
    if (!this.hasDashboardCookie(request)) throw new MockRequestError(401, 'UNAUTHORIZED');
  }

  private requireDashboardMutationAccess(request: IncomingMessage): void {
    if (request.headers.authorization === `Bearer ${this.accessToken}`) return;
    if (!this.hasDashboardCookie(request)) throw new MockRequestError(401, 'UNAUTHORIZED');
    const expectedOrigin = this.startedAddress?.baseUrl.replace(/\/$/, '');
    const fetchSite = request.headers['sec-fetch-site'];
    if (!expectedOrigin
      || request.headers.origin !== expectedOrigin
      || (fetchSite !== undefined && fetchSite !== 'same-origin')) {
      throw new MockRequestError(403, 'DASHBOARD_ORIGIN_REJECTED');
    }
  }

  private parseDashboardScenarioRequest(body: JsonObject): JsonObject {
    if (!hasOnlyKeys(body, ['scenarioId', 'userId', 'deviceId', 'robotDeviceId', 'occurredAt'])
      || Object.keys(body).length !== 5
      || typeof body.scenarioId !== 'string'
      || !(DASHBOARD_SCENARIO_IDS as readonly string[]).includes(body.scenarioId)
      || typeof body.userId !== 'string'
      || !IDENTIFIER_PATTERN.test(body.userId)
      || typeof body.deviceId !== 'string'
      || !IDENTIFIER_PATTERN.test(body.deviceId)
      || typeof body.robotDeviceId !== 'string'
      || !IDENTIFIER_PATTERN.test(body.robotDeviceId)
      || !Number.isSafeInteger(body.occurredAt)
      || Math.abs(Number(body.occurredAt) - this.simulationNow()) > 5 * 60_000) {
      throw new MockRequestError(400, 'DASHBOARD_SCENARIO_INVALID');
    }
    if (body.userId !== this.dashboardUserId) {
      throw new MockRequestError(403, 'DASHBOARD_ACCOUNT_REJECTED');
    }
    return Object.freeze({
      scenarioId: body.scenarioId,
      userId: body.userId,
      deviceId: body.deviceId,
      robotDeviceId: body.robotDeviceId,
      occurredAt: body.occurredAt
    });
  }

  private parseDashboardExecutionsRequest(body: JsonObject): string {
    if (!hasOnlyKeys(body, ['userId'])
      || Object.keys(body).length !== 1
      || typeof body.userId !== 'string'
      || !IDENTIFIER_PATTERN.test(body.userId)) {
      throw new MockRequestError(400, 'DASHBOARD_EXECUTIONS_INVALID');
    }
    if (body.userId !== this.dashboardUserId) {
      throw new MockRequestError(403, 'DASHBOARD_ACCOUNT_REJECTED');
    }
    return body.userId;
  }

  private async readMainServerJson(response: Response, signal?: AbortSignal): Promise<JsonObject> {
    const advertised = response.headers.get('content-length');
    if (advertised && /^\d{1,12}$/.test(advertised)
      && Number(advertised) > this.maxMainServerResponseBytes) {
      try { await response.body?.cancel(); } catch {}
      throw new MockRequestError(502, 'MAIN_SERVER_RESPONSE_TOO_LARGE');
    }
    if (!response.body) return {};
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    const cancelOnAbort = (): void => { void Promise.resolve(reader.cancel()).catch(() => undefined); };
    const abortFailure = signal
      ? new Promise<never>((_resolve, reject) => {
        const rejectAbort = (): void => reject(new MockRequestError(504, 'MAIN_SERVER_TIMEOUT'));
        if (signal.aborted) rejectAbort();
        else signal.addEventListener('abort', rejectAbort, { once: true });
      })
      : undefined;
    if (signal?.aborted) cancelOnAbort();
    else signal?.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      while (true) {
        const read = reader.read();
        void read.catch(() => undefined);
        const chunk = abortFailure ? await Promise.race([read, abortFailure]) : await read;
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > this.maxMainServerResponseBytes) {
          await reader.cancel();
          throw new MockRequestError(502, 'MAIN_SERVER_RESPONSE_TOO_LARGE');
        }
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
      try { reader.releaseLock(); } catch {}
    }
    let parsed: unknown;
    try {
      parsed = total === 0 ? {} : JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    } catch {
      throw new MockRequestError(502, 'MAIN_SERVER_RESPONSE_INVALID');
    }
    if (!isObject(parsed)) throw new MockRequestError(502, 'MAIN_SERVER_RESPONSE_INVALID');
    return parsed;
  }

  private async requestMainServer(
    pathname: string,
    input: {
      readonly method: 'GET' | 'POST';
      readonly body?: JsonObject;
      readonly idempotencyKey?: string;
    }
  ): Promise<{ readonly statusCode: number; readonly payload: JsonObject }> {
    const controller = new AbortController();
    this.mainServerControllers.add(controller);
    let response: Response | undefined;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    const timeoutError = (): MockRequestError => new MockRequestError(504, 'MAIN_SERVER_TIMEOUT');
    const operation = (async (): Promise<{ readonly statusCode: number; readonly payload: JsonObject }> => {
      try {
        response = await fetch(new URL(pathname, this.mainServerUrl), {
          method: input.method,
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            ...(input.body ? { 'Content-Type': 'application/json' } : {}),
            ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {})
          },
          ...(input.body ? { body: JSON.stringify(input.body) } : {}),
          signal: controller.signal
        });
      } catch {
        throw timedOut || controller.signal.aborted
          ? timeoutError()
          : new MockRequestError(502, 'MAIN_SERVER_UNAVAILABLE');
      }
      if (!response) throw new MockRequestError(502, 'MAIN_SERVER_UNAVAILABLE');
      const mainResponse = response;
      if (timedOut) {
        try { await mainResponse.body?.cancel(); } catch {}
        throw timeoutError();
      }
      const mediaType = (String(mainResponse.headers.get('content-type') ?? '')
        .split(';', 1)[0] ?? '')
        .trim()
        .toLowerCase();
      if (mediaType !== 'application/json') {
        try { await mainResponse.body?.cancel(); } catch {}
        throw new MockRequestError(502, 'MAIN_SERVER_RESPONSE_INVALID');
      }
      let payload: JsonObject;
      try {
        payload = await this.readMainServerJson(mainResponse, controller.signal);
      } catch (error) {
        if (timedOut || controller.signal.aborted) throw timeoutError();
        if (error instanceof MockRequestError) throw error;
        throw new MockRequestError(502, 'MAIN_SERVER_RESPONSE_INVALID');
      }
      if (timedOut) throw timeoutError();
      if (!mainResponse.ok) {
        throw new MockRequestError(
          mainResponse.status >= 500 ? 502 : mainResponse.status,
          'MAIN_SERVER_REJECTED'
        );
      }
      return Object.freeze({ statusCode: mainResponse.status, payload });
    })();
    this.pendingMainServerRequests.add(operation);
    void operation.then(
      () => this.pendingMainServerRequests.delete(operation),
      () => this.pendingMainServerRequests.delete(operation)
    );
    void operation.catch(() => undefined);
    let rejectAborted: ((error: MockRequestError) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    const onAbort = (): void => rejectAborted?.(timeoutError());
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        void Promise.resolve(response?.body?.cancel()).catch(() => undefined);
        reject(timeoutError());
      }, this.mainServerTimeoutMs);
      this.mainServerTimeouts.add(timeout);
    });
    try {
      return await Promise.race([operation, deadline, aborted]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      if (timeout) {
        clearTimeout(timeout);
        this.mainServerTimeouts.delete(timeout);
      }
      this.mainServerControllers.delete(controller);
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

  private readOptionalIdempotencyKey(request: IncomingMessage): string | undefined {
    const candidate = request.headers['idempotency-key'];
    if (candidate === undefined) return undefined;
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
    if (!hasOnlyKeys(body, ['envelope', 'payload', 'signature', 'algorithm'])
      || Object.keys(body).length !== 4
      || !envelope
      || !hasOnlyKeys(envelope, [
        'version', 'id', 'issued_at', 'expires_at', 'action', 'device_type',
        'device_id', 'manufacturer_device_id', 'binding_epoch', 'adapter_id',
        'contract_version', 'parameters'
      ])
      || Object.keys(envelope).length !== 12
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

  private async readBoundedCallbackResponse(response: Response, signal?: AbortSignal): Promise<void> {
    const advertisedLength = response.headers.get('content-length');
    if (advertisedLength && /^\d{1,12}$/.test(advertisedLength)
      && Number(advertisedLength) > this.maxAsyncAckResponseBytes) {
      try { await response.body?.cancel(); } catch {}
      throw new Error('ACK_CALLBACK_RESPONSE_TOO_LARGE');
    }
    if (!response.body) return;
    const reader = response.body.getReader();
    let total = 0;
    const cancelOnAbort = (): void => { void Promise.resolve(reader.cancel()).catch(() => undefined); };
    const abortFailure = signal
      ? new Promise<never>((_resolve, reject) => {
        const rejectAbort = (): void => reject(new Error('ACK_CALLBACK_TIMEOUT'));
        if (signal.aborted) rejectAbort();
        else signal.addEventListener('abort', rejectAbort, { once: true });
      })
      : undefined;
    if (signal?.aborted) cancelOnAbort();
    else signal?.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      while (true) {
        const read = reader.read();
        void read.catch(() => undefined);
        const chunk = abortFailure ? await Promise.race([read, abortFailure]) : await read;
        if (chunk.done) break;
        total += chunk.value.byteLength;
        if (total > this.maxAsyncAckResponseBytes) {
          await reader.cancel();
          throw new Error('ACK_CALLBACK_RESPONSE_TOO_LARGE');
        }
      }
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
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
    let response: Response | undefined;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    const operation = (async (): Promise<void> => {
      response = await fetch(callbackUrl, {
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
      if (timedOut) {
        try { await response.body?.cancel(); } catch {}
        throw new Error('ACK_CALLBACK_TIMEOUT');
      }
      statusCode = response.status;
      await this.readBoundedCallbackResponse(response, controller.signal);
      if (timedOut) throw new Error('ACK_CALLBACK_TIMEOUT');
      if (response.status !== 204) throw new Error('ACK_CALLBACK_REJECTED');
    })();
    void operation.catch(() => undefined);
    let rejectAborted: ((error: Error) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    const onAbort = (): void => rejectAborted?.(new Error('ACK_CALLBACK_TIMEOUT'));
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener('abort', onAbort, { once: true });
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        void Promise.resolve(response?.body?.cancel()).catch(() => undefined);
        reject(new Error('ACK_CALLBACK_TIMEOUT'));
      }, this.asyncAckTimeoutMs);
      this.asyncAckTimeouts.add(timeout);
    });
    try {
      await Promise.race([operation, deadline, aborted]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      if (timeout) {
        clearTimeout(timeout);
        this.asyncAckTimeouts.delete(timeout);
      }
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

  private mutationFingerprint(body: JsonObject): string {
    return createHash('sha256').update(JSON.stringify(body)).digest('base64url');
  }

  private replayMutation(scope: string, body: JsonObject): JsonObject | undefined {
    const previous = this.idempotency.get(scope);
    if (!previous) return undefined;
    if (previous.fingerprint !== this.mutationFingerprint(body)) {
      throw new MockRequestError(409, 'IDEMPOTENCY_CONFLICT');
    }
    return { ...previous.payload };
  }

  private rememberMutation(scope: string, body: JsonObject, payload: JsonObject): void {
    this.rememberIdempotency(scope, this.mutationFingerprint(body), payload);
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
    this.scheduleDashboardBroadcast();
    return Object.freeze({ ...event, deviceReferences: Object.freeze([...event.deviceReferences]) });
  }

  private nextSimulationTick(deviceType: ManufacturerSimulationDeviceType, deviceReference: string): number {
    const key = `${deviceType}:${deviceReference}`;
    const next = (this.simulationTicks.get(key) ?? 0) + 1;
    this.simulationTicks.set(key, next);
    return next;
  }

  private refreshDefaultSimulationDevices(): void {
    if (this.stoppingPromise) return;
    const observedAt = this.simulationNow();
    const wearableReference = safeReference('wearable-1');
    const wearableTick = this.nextSimulationTick('wearable', wearableReference);
    this.updateSimulatedDeviceState('wearable', wearableReference, {
      online: true,
      batteryPercent: Math.max(15, Math.round((92 - (wearableTick % 770) * 0.1) * 10) / 10),
      status: wearableTick % 4 === 0 ? 'walking' : 'resting',
      observedAt
    });
    const robotReference = safeReference('home-robot-1');
    const robotTick = this.nextSimulationTick('home_robot', robotReference);
    this.updateSimulatedDeviceState('home_robot', robotReference, {
      online: true,
      batteryPercent: 78,
      status: robotTick % 3 === 0 ? 'navigating' : 'idle',
      observedAt
    });
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
    this.scheduleDashboardBroadcast();
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

  private scheduleDashboardBroadcast(): void {
    if (this.dashboardStreams.size === 0 || this.dashboardBroadcastImmediate) return;
    this.dashboardBroadcastImmediate = setImmediate(() => {
      this.dashboardBroadcastImmediate = undefined;
      if (this.stoppingPromise) return;
      let frame: string;
      try {
        frame = `event: dashboard\ndata: ${JSON.stringify(this.getSimulationDashboard())}\n\n`;
      } catch {
        for (const response of this.dashboardStreams) response.destroy();
        return;
      }
      for (const response of [...this.dashboardStreams]) {
        if (response.destroyed || response.writableEnded) {
          this.dashboardStreams.delete(response);
          continue;
        }
        try {
          // A slow dashboard must never create an unbounded socket buffer.
          if (!response.write(frame)) response.destroy();
        } catch {
          response.destroy();
        }
      }
    });
    this.dashboardBroadcastImmediate.unref?.();
  }

  private startDashboardStream(request: IncomingMessage, response: ServerResponse): void {
    if (this.dashboardStreams.size >= this.maxDashboardStreams) {
      throw new MockRequestError(429, 'DASHBOARD_STREAM_CAPACITY_EXCEEDED');
    }
    response.writeHead(200, {
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff'
    });
    request.socket.setTimeout(0);
    this.dashboardStreams.add(response);
    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.dashboardStreams.delete(response);
      if (!request.socket.destroyed) {
        request.socket.setTimeout(Math.min(120_000, this.requestTimeoutMs + 1_000));
      }
      if (this.dashboardStreams.size === 0 && this.dashboardHeartbeat) {
        clearInterval(this.dashboardHeartbeat);
        this.dashboardHeartbeat = undefined;
      }
    };
    request.once('aborted', cleanup);
    response.once('close', cleanup);
    response.once('error', cleanup);
    try {
      const frame = `event: dashboard\ndata: ${JSON.stringify(this.getSimulationDashboard())}\n\n`;
      if (!response.write(frame)) {
        response.destroy();
        return;
      }
    } catch {
      response.destroy();
      return;
    }
    if (!this.dashboardHeartbeat) {
      this.dashboardHeartbeat = setInterval(() => {
        for (const stream of [...this.dashboardStreams]) {
          if (stream.destroyed || stream.writableEnded) {
            this.dashboardStreams.delete(stream);
            continue;
          }
          try {
            if (!stream.write(': keepalive\n\n')) stream.destroy();
          } catch {
            stream.destroy();
          }
        }
      }, Math.min(15_000, Math.max(1_000, this.requestTimeoutMs)));
      this.dashboardHeartbeat.unref?.();
    }
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
    const onDrain = (): void => { backpressured = false; };
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      response.removeListener('drain', onDrain);
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
        try {
          backpressured = !response.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
          if (backpressured) response.once('drain', onDrain);
        } catch {
          cleanup();
          response.destroy();
        }
      }
    };
    request.once('aborted', cleanup);
    response.once('close', cleanup);
    response.once('error', cleanup);
    if (request.aborted || response.destroyed || response.writableEnded) {
      cleanup();
      return;
    }
    send();
    if (!cleanedUp && !request.aborted && !response.destroyed && !response.writableEnded) {
      interval = setInterval(send, this.telemetryIntervalMs);
      interval.unref?.();
      this.telemetryIntervals.add(interval);
    }
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
    maxDashboardStreams: numericEnvironment(
      'MOCK_MANUFACTURER_MAX_DASHBOARD_STREAMS',
      DEFAULT_MAX_DASHBOARD_STREAMS
    ),
    mainServerUrl: process.env.MOCK_MAIN_SERVER_URL,
    dashboardUserId: process.env.AI_NATIVE_DEMO_USER_ID,
    mainServerTimeoutMs: numericEnvironment(
      'MOCK_MAIN_SERVER_TIMEOUT_MS',
      DEFAULT_MAIN_SERVER_TIMEOUT_MS
    ),
    maxMainServerResponseBytes: numericEnvironment(
      'MOCK_MAIN_SERVER_MAX_RESPONSE_BYTES',
      DEFAULT_MAX_MAIN_SERVER_RESPONSE_BYTES
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
  let stopPromise: Promise<void> | undefined;
  const shutdown = (): void => {
    if (stopPromise) return;
    stopPromise = simulator.stop().catch(() => {
      process.stderr.write('Manufacturer mock shutdown failed\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  void runFromCommandLine().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Manufacturer mock failed'}\n`);
    process.exitCode = 1;
  });
}
