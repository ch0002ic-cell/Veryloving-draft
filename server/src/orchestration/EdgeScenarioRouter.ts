import { createHash } from 'node:crypto';
import type { RobotEdgeInferenceEnvelope } from '../edge/RobotEdgeAI';
import type { WearableInferenceEnvelope } from '../edge/WearableEdgeAI';
import type {
  ScenarioDeviceTargets,
  ScenarioJson,
  ScenarioStartResult,
  ScenarioTrigger
} from './ScenarioEngine';

interface ScenarioEngineLike {
  startScenario(
    accountId: string,
    request: Readonly<{
      scenarioId: 'fall_detection' | 'emotional_check_in' | 'ai_angel_auto_dial' | 'medication_adherence' | 'cognitive_engagement';
      trigger: ScenarioTrigger;
      devices: ScenarioDeviceTargets;
      idempotencyKey: string;
      input?: Readonly<Record<string, ScenarioJson>>;
    }>
  ): Promise<ScenarioStartResult>;
  listExecutions(accountId: string, limit?: number): Promise<readonly Readonly<{
    executionId: string;
    priority: 'critical' | 'standard' | 'background';
    state: string;
  }>[] >;
  getExecution(accountId: string, executionId: string): Promise<Readonly<{
    executionId: string;
    state: string;
  }> | undefined>;
  cancelScenario(accountId: string, executionId: string): Promise<Readonly<{ executionId: string }>>;
}

export interface EdgeDeviceBinding {
  readonly targets: ScenarioDeviceTargets;
  /** Authenticated telemetry identity; may differ from the command target ID. */
  readonly wearableSourceRef?: string;
  /** Authenticated telemetry identity; may differ from the command target ID. */
  readonly homeRobotSourceRef?: string;
}

export interface EdgeScenarioContext {
  readonly locationRef?: string;
  readonly contactId?: string;
  readonly locationContext?: 'home' | 'away' | 'unknown';
}

interface TelemetryStateIngestorLike {
  ingestWearable(
    accountId: string,
    deviceId: string,
    envelope: WearableInferenceEnvelope,
    context: Readonly<{ locationContext?: 'home' | 'away' | 'unknown' }>,
    signal?: AbortSignal
  ): Promise<void>;
  ingestRobot(
    accountId: string,
    deviceId: string,
    envelope: RobotEdgeInferenceEnvelope,
    context: Readonly<{ locationContext?: 'home' | 'away' | 'unknown' }>,
    signal?: AbortSignal
  ): Promise<void>;
}

export interface EdgeRoutingResult {
  readonly started: readonly ScenarioStartResult[];
  readonly cancellationRequested?: true;
}

export type ContextScenarioEventType =
  | 'medication_due'
  | 'bedroom_inactivity'
  | 'panic_button'
  | 'voice_emergency';

export interface ContextScenarioEvent {
  readonly eventId: string;
  readonly type: ContextScenarioEventType;
  readonly occurredAt: number;
  readonly data?: Readonly<Record<string, ScenarioJson>>;
}

export interface EdgeScenarioRouterOptions {
  readonly scenarioEngine: ScenarioEngineLike;
  readonly now?: () => number;
  readonly maxTelemetryAgeMs?: number;
  readonly maxFutureSkewMs?: number;
  readonly fallConfidenceThreshold?: number;
  readonly stressThreshold?: number;
  readonly helpConfidenceThreshold?: number;
  readonly fallEpisodeCooldownMs?: number;
  readonly stressEpisodeCooldownMs?: number;
  readonly helpEpisodeCooldownMs?: number;
  /** A missing negative frame eventually closes an episode after transport loss. */
  readonly episodeSourceStaleMs?: number;
  readonly maxEpisodeKeys?: number;
  readonly telemetryStateIngestor?: TelemetryStateIngestorLike;
  readonly telemetryPersistenceTimeoutMs?: number;
  readonly robotSafetyMaxAgeMs?: number;
  readonly onTelemetryPersistenceFailure?: (code: 'TELEMETRY_STATE_PERSIST_FAILED') => void;
}

export type EdgeScenarioRouterErrorCode =
  | 'EDGE_EVENT_INVALID'
  | 'EDGE_EVENT_STALE'
  | 'EDGE_SOURCE_MISMATCH';

export class EdgeScenarioRouterError extends Error {
  readonly code: EdgeScenarioRouterErrorCode;

  constructor(code: EdgeScenarioRouterErrorCode) {
    super(code === 'EDGE_EVENT_STALE'
      ? 'Edge event is outside the accepted time window'
      : code === 'EDGE_SOURCE_MISMATCH'
        ? 'Edge event source does not match the authenticated binding'
        : 'Edge event failed validation');
    this.name = 'EdgeScenarioRouterError';
    this.code = code;
  }
}

const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ACCOUNT_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const TERMINAL_STATES = new Set(['completed', 'fallback_completed', 'failed', 'cancelled']);

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  // JSON objects created in another VM/worker have a different Object.prototype
  // identity. Accept that single-root shape, while rejecting class instances
  // and objects with application-controlled prototype chains.
  if (prototype !== null && (Object.getPrototypeOf(prototype) !== null
    || Object.prototype.toString.call(value) !== '[object Object]'
    || typeof Object.getOwnPropertyDescriptor(prototype, 'hasOwnProperty')?.value !== 'function')) {
    return false;
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== expectedKeys.length || ownKeys.some((key) => typeof key !== 'string')) return false;
  const expected = new Set(expectedKeys);
  return ownKeys.every((key) => {
    if (typeof key !== 'string' || !expected.has(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable === true && 'value' in descriptor;
  });
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function integerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function canonicalWearableEnvelope(value: unknown): WearableInferenceEnvelope {
  if (!isExactPlainRecord(value, [
    'contractVersion', 'sourceDeviceRef', 'sequence', 'observedAtMs', 'emittedAtMs',
    'model', 'inference', 'telemetry', 'batteryEstimate'
  ])
    || !isExactPlainRecord(value.model, ['name', 'version', 'mode', 'clinicallyValidated'])
    || !isExactPlainRecord(value.inference, [
      'fallDetected', 'fallConfidence', 'stressScore', 'activity'
    ])
    || !isExactPlainRecord(value.telemetry, [
      'heartRateBpm', 'hrvRmssdMs', 'skinTemperatureC', 'batteryPercent', 'stepsToday'
    ])
    || !isExactPlainRecord(value.batteryEstimate, [
      'estimatedAdditionalDrainPercentPerDay', 'estimatedEnergyMilliJoulesPerInference'
    ])) {
    throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
  }
  const model = value.model;
  const inference = value.inference;
  const telemetry = value.telemetry;
  const batteryEstimate = value.batteryEstimate;
  if (value.contractVersion !== 'vl-wearable-inference/1'
    || typeof value.sourceDeviceRef !== 'string' || !SAFE_IDENTIFIER.test(value.sourceDeviceRef)
    || !integerBetween(value.sequence, 0, Number.MAX_SAFE_INTEGER)
    || !integerBetween(value.observedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || !integerBetween(value.emittedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || model.name !== 'wearable-edge-sim'
    || model.version !== '1.0.0'
    || model.mode !== 'deterministic-simulation'
    || model.clinicallyValidated !== false
    || typeof inference.fallDetected !== 'boolean'
    || !finiteBetween(inference.fallConfidence, 0, 1)
    || !finiteBetween(inference.stressScore, 0, 100)
    || typeof inference.activity !== 'string'
    || !['resting', 'walking', 'running', 'fall'].includes(inference.activity)
    || !finiteBetween(telemetry.heartRateBpm, 25, 240)
    || !finiteBetween(telemetry.hrvRmssdMs, 1, 300)
    || !finiteBetween(telemetry.skinTemperatureC, 25, 45)
    || !finiteBetween(telemetry.batteryPercent, 0, 100)
    || !integerBetween(telemetry.stepsToday, 0, 1_000_000)
    || !finiteBetween(batteryEstimate.estimatedAdditionalDrainPercentPerDay, 0, 10)
    || !finiteBetween(batteryEstimate.estimatedEnergyMilliJoulesPerInference, 0, 100)) {
    throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
  }
  return Object.freeze({
    contractVersion: 'vl-wearable-inference/1',
    sourceDeviceRef: value.sourceDeviceRef,
    sequence: value.sequence,
    observedAtMs: value.observedAtMs,
    emittedAtMs: value.emittedAtMs,
    model: Object.freeze({
      name: 'wearable-edge-sim',
      version: '1.0.0',
      mode: 'deterministic-simulation',
      clinicallyValidated: false
    }),
    inference: Object.freeze({
      fallDetected: inference.fallDetected,
      fallConfidence: inference.fallConfidence,
      stressScore: inference.stressScore,
      activity: inference.activity as WearableInferenceEnvelope['inference']['activity']
    }),
    telemetry: Object.freeze({
      heartRateBpm: telemetry.heartRateBpm,
      hrvRmssdMs: telemetry.hrvRmssdMs,
      skinTemperatureC: telemetry.skinTemperatureC,
      batteryPercent: telemetry.batteryPercent,
      stepsToday: telemetry.stepsToday
    }),
    batteryEstimate: Object.freeze({
      estimatedAdditionalDrainPercentPerDay:
        batteryEstimate.estimatedAdditionalDrainPercentPerDay,
      estimatedEnergyMilliJoulesPerInference:
        batteryEstimate.estimatedEnergyMilliJoulesPerInference
    })
  });
}

function canonicalRobotEnvelope(value: unknown): RobotEdgeInferenceEnvelope {
  if (!isExactPlainRecord(value, [
    'contractVersion', 'sourceDeviceRef', 'sequence', 'observedAtMs', 'emittedAtMs', 'model', 'inference'
  ])
    || !isExactPlainRecord(value.model, [
      'name', 'version', 'mode', 'clinicallyValidated', 'rawMediaRetained'
    ])
    || !isExactPlainRecord(value.inference, ['vision', 'voice', 'motor'])
    || !isExactPlainRecord(value.inference.vision, [
      'fallDetected', 'fallConfidence', 'facialExpression', 'expressionConfidence'
    ])
    || !isExactPlainRecord(value.inference.voice, [
      'intent', 'emotion', 'confidence', 'processedOffline'
    ])
    || !isExactPlainRecord(value.inference.motor, ['state', 'safeToMove'])) {
    throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
  }
  const model = value.model;
  const inference = value.inference;
  const vision = inference.vision as Record<string, unknown>;
  const voice = inference.voice as Record<string, unknown>;
  const motor = inference.motor as Record<string, unknown>;
  if (value.contractVersion !== 'vl-robot-edge-inference/1'
    || typeof value.sourceDeviceRef !== 'string' || !SAFE_IDENTIFIER.test(value.sourceDeviceRef)
    || !integerBetween(value.sequence, 0, Number.MAX_SAFE_INTEGER)
    || !integerBetween(value.observedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || !integerBetween(value.emittedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || model.name !== 'robot-edge-sim'
    || model.version !== '1.0.0'
    || model.mode !== 'deterministic-simulation'
    || model.clinicallyValidated !== false
    || model.rawMediaRetained !== false
    || typeof vision.fallDetected !== 'boolean'
    || !finiteBetween(vision.fallConfidence, 0, 1)
    || typeof vision.facialExpression !== 'string'
    || !['not_observed', 'calm', 'positive', 'neutral', 'sad', 'distressed']
      .includes(vision.facialExpression)
    || !finiteBetween(vision.expressionConfidence, 0, 1)
    || typeof voice.intent !== 'string'
    || !['none', 'greeting', 'request_help', 'cancel', 'report_discomfort'].includes(voice.intent)
    || typeof voice.emotion !== 'string'
    || !['not_observed', 'calm', 'positive', 'neutral', 'distressed'].includes(voice.emotion)
    || !finiteBetween(voice.confidence, 0, 1)
    || voice.processedOffline !== true
    || typeof motor.state !== 'string'
    || !['idle', 'navigating', 'docked', 'stopped'].includes(motor.state)
    || typeof motor.safeToMove !== 'boolean') {
    throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
  }
  return Object.freeze({
    contractVersion: 'vl-robot-edge-inference/1',
    sourceDeviceRef: value.sourceDeviceRef,
    sequence: value.sequence,
    observedAtMs: value.observedAtMs,
    emittedAtMs: value.emittedAtMs,
    model: Object.freeze({
      name: 'robot-edge-sim',
      version: '1.0.0',
      mode: 'deterministic-simulation',
      clinicallyValidated: false,
      rawMediaRetained: false
    }),
    inference: Object.freeze({
      vision: Object.freeze({
        fallDetected: vision.fallDetected,
        fallConfidence: vision.fallConfidence,
        facialExpression:
          vision.facialExpression as RobotEdgeInferenceEnvelope['inference']['vision']['facialExpression'],
        expressionConfidence: vision.expressionConfidence
      }),
      voice: Object.freeze({
        intent: voice.intent as RobotEdgeInferenceEnvelope['inference']['voice']['intent'],
        emotion: voice.emotion as RobotEdgeInferenceEnvelope['inference']['voice']['emotion'],
        confidence: voice.confidence,
        processedOffline: true
      }),
      motor: Object.freeze({
        state: motor.state as RobotEdgeInferenceEnvelope['inference']['motor']['state'],
        safeToMove: motor.safeToMove
      })
    })
  });
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
  }
  return candidate;
}

function boundedScore(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > 100) {
    throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
  }
  return candidate;
}

function safeInputIdentifier(value: unknown, fallback: string, maximum = 96): string {
  return typeof value === 'string' && value.length <= maximum && SAFE_IDENTIFIER.test(value)
    ? value
    : fallback;
}

function stableIdentifier(parts: readonly (string | number)[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url');
}

/**
 * Authenticated cloud ingress for edge inference. Raw sensor/media payloads are
 * deliberately outside this boundary; only versioned, bounded inference results
 * are accepted. Transport authentication and device binding happen before this class.
 */
export class EdgeScenarioRouter {
  private readonly now: () => number;
  private readonly maxTelemetryAgeMs: number;
  private readonly maxFutureSkewMs: number;
  private readonly fallConfidenceThreshold: number;
  private readonly stressThreshold: number;
  private readonly helpConfidenceThreshold: number;
  private readonly fallEpisodeCooldownMs: number;
  private readonly stressEpisodeCooldownMs: number;
  private readonly helpEpisodeCooldownMs: number;
  private readonly episodeSourceStaleMs: number;
  private readonly maxEpisodeKeys: number;
  private readonly telemetryPersistenceTimeoutMs: number;
  private readonly robotSafetyMaxAgeMs: number;
  private readonly episodes = new Map<string, {
    positiveSources: Map<string, number>;
    lastTriggeredAt: number;
    triggeredForEpisode: boolean;
  }>();
  private readonly sourceRoutes = new Map<string, {
    sequence: number;
    observedAt: number;
    fingerprint: string;
    result: Promise<EdgeRoutingResult>;
    settled: boolean;
    failed: boolean;
  }>();
  private readonly episodeStarts = new Map<string, Promise<ScenarioStartResult>>();
  private readonly robotSafety = new Map<string, { safeToMove: boolean; observedAt: number }>();

  constructor(private readonly options: EdgeScenarioRouterOptions) {
    this.now = options.now ?? Date.now;
    this.maxTelemetryAgeMs = boundedInteger(options.maxTelemetryAgeMs, 30_000, 1_000, 5 * 60_000);
    this.maxFutureSkewMs = boundedInteger(options.maxFutureSkewMs, 2_000, 0, 60_000);
    const fallThreshold = options.fallConfidenceThreshold ?? 0.8;
    if (!Number.isFinite(fallThreshold) || fallThreshold < 0 || fallThreshold > 1) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    this.fallConfidenceThreshold = fallThreshold;
    this.stressThreshold = boundedScore(options.stressThreshold, 70);
    const helpConfidence = options.helpConfidenceThreshold ?? 0.75;
    if (!Number.isFinite(helpConfidence) || helpConfidence < 0 || helpConfidence > 1) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    this.helpConfidenceThreshold = helpConfidence;
    this.fallEpisodeCooldownMs = boundedInteger(options.fallEpisodeCooldownMs, 5_000, 1_000, 5 * 60_000);
    this.stressEpisodeCooldownMs = boundedInteger(options.stressEpisodeCooldownMs, 15 * 60_000, 10_000, 24 * 60 * 60_000);
    this.helpEpisodeCooldownMs = boundedInteger(options.helpEpisodeCooldownMs, 30_000, 1_000, 30 * 60_000);
    this.episodeSourceStaleMs = boundedInteger(
      options.episodeSourceStaleMs,
      Math.max(30_000, this.maxTelemetryAgeMs),
      1_000,
      60 * 60_000
    );
    this.maxEpisodeKeys = boundedInteger(options.maxEpisodeKeys, 1_000, 10, 100_000);
    this.telemetryPersistenceTimeoutMs = boundedInteger(
      options.telemetryPersistenceTimeoutMs,
      100,
      10,
      5_000
    );
    this.robotSafetyMaxAgeMs = boundedInteger(options.robotSafetyMaxAgeMs, 5_000, 500, 30_000);
  }

  async ingestWearableInference(
    accountId: string,
    envelope: WearableInferenceEnvelope,
    binding: EdgeDeviceBinding,
    context: EdgeScenarioContext = {}
  ): Promise<EdgeRoutingResult> {
    this.validateAccountAndTargets(accountId, binding.targets);
    this.validateContext(context);
    let canonicalEnvelope: WearableInferenceEnvelope;
    try {
      canonicalEnvelope = canonicalWearableEnvelope(envelope);
    } catch {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    this.validateFreshness(canonicalEnvelope.observedAtMs);
    if (canonicalEnvelope.emittedAtMs < canonicalEnvelope.observedAtMs
      || canonicalEnvelope.emittedAtMs - canonicalEnvelope.observedAtMs > this.maxTelemetryAgeMs
      || canonicalEnvelope.emittedAtMs > this.now() + this.maxFutureSkewMs) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    if (!binding.wearableSourceRef || canonicalEnvelope.sourceDeviceRef !== binding.wearableSourceRef) {
      throw new EdgeScenarioRouterError('EDGE_SOURCE_MISMATCH');
    }
    return this.routeSourceEvent(
      accountId,
      canonicalEnvelope.sourceDeviceRef,
      canonicalEnvelope.sequence,
      canonicalEnvelope,
      () => (
        this.routeWearableValidated(accountId, canonicalEnvelope, binding, context)
      )
    );
  }

  private async routeWearableValidated(
    accountId: string,
    envelope: WearableInferenceEnvelope,
    binding: EdgeDeviceBinding,
    context: EdgeScenarioContext
  ): Promise<EdgeRoutingResult> {
    if (binding.targets.wearableId) {
      await this.persistTelemetry((signal) => this.options.telemetryStateIngestor?.ingestWearable(
        accountId,
        binding.targets.wearableId as string,
        envelope,
        { ...(context.locationContext ? { locationContext: context.locationContext } : {}) },
        signal
      ));
    }
    const commonInput = this.contextInput(context);
    const isFall = envelope.inference.fallDetected
      && envelope.inference.fallConfidence >= this.fallConfidenceThreshold;
    if (isFall) {
      const started = await this.startEpisode(
        accountId,
        'fall_detection',
        'wearable_fall',
        envelope.observedAtMs,
        envelope.sourceDeviceRef,
        `wearable:${envelope.sourceDeviceRef}`,
        envelope.sequence,
        binding.targets,
        {
          ...commonInput,
          robotSafeToMove: this.hasFreshRobotSafety(accountId, binding.targets.homeRobotId)
        },
        this.fallEpisodeCooldownMs
      );
      if (started) {
        return Object.freeze({ started: Object.freeze([started]) });
      }
      return Object.freeze({ started: Object.freeze([]) });
    }
    if (!isFall) this.shouldStartEpisode(
      accountId, 'fall_detection', `wearable:${envelope.sourceDeviceRef}`,
      false, envelope.observedAtMs, this.fallEpisodeCooldownMs
    );
    const isStressed = envelope.inference.stressScore >= this.stressThreshold;
    if (isStressed) {
      const started = await this.startEpisode(
        accountId,
        'emotional_check_in',
        'wearable_stress',
        envelope.observedAtMs,
        envelope.sourceDeviceRef,
        `wearable:${envelope.sourceDeviceRef}`,
        envelope.sequence,
        binding.targets,
        { ...commonInput, stressScore: envelope.inference.stressScore },
        this.stressEpisodeCooldownMs
      );
      if (started) return Object.freeze({ started: Object.freeze([started]) });
    }
    if (!isStressed) this.shouldStartEpisode(
      accountId, 'emotional_check_in', `wearable:${envelope.sourceDeviceRef}`,
      false, envelope.observedAtMs, this.stressEpisodeCooldownMs
    );
    return Object.freeze({ started: Object.freeze([]) });
  }

  async ingestRobotInference(
    accountId: string,
    envelope: RobotEdgeInferenceEnvelope,
    binding: EdgeDeviceBinding,
    context: EdgeScenarioContext = {}
  ): Promise<EdgeRoutingResult> {
    this.validateAccountAndTargets(accountId, binding.targets);
    this.validateContext(context);
    let canonicalEnvelope: RobotEdgeInferenceEnvelope;
    try {
      canonicalEnvelope = canonicalRobotEnvelope(envelope);
    } catch {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    this.validateFreshness(canonicalEnvelope.observedAtMs);
    if (canonicalEnvelope.emittedAtMs < canonicalEnvelope.observedAtMs
      || canonicalEnvelope.emittedAtMs - canonicalEnvelope.observedAtMs > this.maxTelemetryAgeMs
      || canonicalEnvelope.emittedAtMs > this.now() + this.maxFutureSkewMs) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    if (!binding.homeRobotSourceRef || canonicalEnvelope.sourceDeviceRef !== binding.homeRobotSourceRef) {
      throw new EdgeScenarioRouterError('EDGE_SOURCE_MISMATCH');
    }
    return this.routeSourceEvent(
      accountId,
      canonicalEnvelope.sourceDeviceRef,
      canonicalEnvelope.sequence,
      canonicalEnvelope,
      () => this.routeRobotValidated(accountId, canonicalEnvelope, binding, context)
    );
  }

  private async routeRobotValidated(
    accountId: string,
    envelope: RobotEdgeInferenceEnvelope,
    binding: EdgeDeviceBinding,
    context: EdgeScenarioContext
  ): Promise<EdgeRoutingResult> {
    if (binding.targets.homeRobotId) {
      this.rememberRobotSafety(
        accountId,
        binding.targets.homeRobotId,
        envelope.inference.motor.safeToMove,
        envelope.observedAtMs
      );
    }
    if (binding.targets.homeRobotId) {
      await this.persistTelemetry((signal) => this.options.telemetryStateIngestor?.ingestRobot(
        accountId,
        binding.targets.homeRobotId as string,
        envelope,
        { ...(context.locationContext ? { locationContext: context.locationContext } : {}) },
        signal
      ));
    }
    const commonInput = this.contextInput(context);
    const isFall = envelope.inference.vision.fallDetected
      && envelope.inference.vision.fallConfidence >= this.fallConfidenceThreshold;
    if (isFall) {
      const started = await this.startEpisode(
        accountId, 'fall_detection', 'robot_fall', envelope.observedAtMs,
        envelope.sourceDeviceRef,
        `home_robot:${envelope.sourceDeviceRef}`,
        envelope.sequence,
        binding.targets,
        { ...commonInput, robotSafeToMove: envelope.inference.motor.safeToMove },
        this.fallEpisodeCooldownMs
      );
      if (started) {
        return Object.freeze({ started: Object.freeze([started]) });
      }
      return Object.freeze({ started: Object.freeze([]) });
    }
    if (!isFall) this.shouldStartEpisode(
      accountId, 'fall_detection', `home_robot:${envelope.sourceDeviceRef}`,
      false, envelope.observedAtMs, this.fallEpisodeCooldownMs
    );
    if (envelope.inference.voice.intent === 'cancel') {
      // Local speech inference is not sufficient authority to suppress a
      // life-safety flow. A simultaneous authenticated fall always wins; only
      // a non-fall frame can request later app/caregiver confirmation.
      return Object.freeze({ started: Object.freeze([]), cancellationRequested: true });
    }
    if (envelope.inference.voice.intent === 'request_help'
      && envelope.inference.voice.confidence >= this.helpConfidenceThreshold) {
      const started = await this.startEpisode(
        accountId, 'ai_angel_auto_dial', 'robot_help_request', envelope.observedAtMs,
        envelope.sourceDeviceRef, `home_robot:${envelope.sourceDeviceRef}`,
        envelope.sequence, binding.targets, commonInput,
        this.helpEpisodeCooldownMs
      );
      if (started) {
        return Object.freeze({ started: Object.freeze([started]) });
      }
      return Object.freeze({ started: Object.freeze([]) });
    }
    this.shouldStartEpisode(
      accountId,
      'ai_angel_auto_dial',
      `home_robot:${envelope.sourceDeviceRef}`,
      false,
      envelope.observedAtMs,
      this.helpEpisodeCooldownMs
    );
    return Object.freeze({ started: Object.freeze([]) });
  }

  async ingestContextEvent(
    accountId: string,
    event: ContextScenarioEvent,
    binding: EdgeDeviceBinding
  ): Promise<EdgeRoutingResult> {
    this.validateAccountAndTargets(accountId, binding.targets);
    if (!event || !SAFE_IDENTIFIER.test(event.eventId ?? '') || !Number.isSafeInteger(event.occurredAt)) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    this.validateFreshness(event.occurredAt);
    const mapping = {
      medication_due: 'medication_adherence',
      bedroom_inactivity: 'cognitive_engagement',
      panic_button: 'ai_angel_auto_dial',
      voice_emergency: 'ai_angel_auto_dial'
    } as const;
    const scenarioId = mapping[event.type];
    if (!scenarioId) throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    const digest = stableIdentifier(['context', event.type, event.eventId]);
    const started = await this.options.scenarioEngine.startScenario(accountId, {
      scenarioId,
      trigger: {
        eventId: `context-${digest}`,
        type: event.type,
        occurredAt: event.occurredAt,
        data: {}
      },
      devices: binding.targets,
      idempotencyKey: `context-${digest}`,
      input: event.data ?? {}
    });
    return Object.freeze({ started: Object.freeze([started]) });
  }

  private async start(
    accountId: string,
    scenarioId: 'fall_detection' | 'emotional_check_in' | 'ai_angel_auto_dial',
    triggerType: string,
    occurredAt: number,
    sourceRef: string,
    sequence: number,
    devices: ScenarioDeviceTargets,
    input: Readonly<Record<string, ScenarioJson>>
  ): Promise<ScenarioStartResult> {
    const digest = stableIdentifier([scenarioId, triggerType, sourceRef, sequence]);
    return this.options.scenarioEngine.startScenario(accountId, {
      scenarioId,
      trigger: { eventId: `edge-${digest}`, type: triggerType, occurredAt, data: {} },
      devices,
      idempotencyKey: `edge-${digest}`,
      input
    });
  }

  private async startEpisode(
    accountId: string,
    scenarioId: 'fall_detection' | 'emotional_check_in' | 'ai_angel_auto_dial',
    triggerType: string,
    occurredAt: number,
    sourceRef: string,
    episodeSourceRef: string,
    sequence: number,
    devices: ScenarioDeviceTargets,
    input: Readonly<Record<string, ScenarioJson>>,
    cooldownMs: number
  ): Promise<ScenarioStartResult | undefined> {
    const episodeKey = stableIdentifier(['episode', accountId, scenarioId]);
    const previous = this.episodes.get(episodeKey);
    const before = previous
      ? {
        positiveSources: new Map(previous.positiveSources),
        lastTriggeredAt: previous.lastTriggeredAt,
        triggeredForEpisode: previous.triggeredForEpisode
      }
      : undefined;
    const admitted = this.shouldStartEpisode(
      accountId, scenarioId, episodeSourceRef, true, occurredAt, cooldownMs
    );
    // Every continuing positive source must be registered even while another
    // source owns admission. Otherwise a later negative from the first source
    // can incorrectly close the shared episode and allow a duplicate workflow.
    const inFlight = this.episodeStarts.get(episodeKey);
    if (inFlight) return inFlight;
    if (!admitted) {
      return undefined;
    }
    const startPromise = this.start(
        accountId, scenarioId, triggerType, occurredAt, sourceRef, sequence, devices, input
      );
    this.episodeStarts.set(episodeKey, startPromise);
    try {
      return await startPromise;
    } catch (error) {
      // Admission/storage failures are not a completed episode. Roll back only
      // the admission marker/cooldown while retaining concurrent positive and
      // negative source observations made during the in-flight request.
      const current = this.episodes.get(episodeKey);
      if (current) {
        this.episodes.delete(episodeKey);
        this.episodes.set(episodeKey, {
          positiveSources: new Map(current.positiveSources),
          lastTriggeredAt: before?.lastTriggeredAt ?? occurredAt - cooldownMs,
          // This invocation acquired admission, so any earlier active marker
          // was already closed/stale. A failed durable start must always make
          // the retained positive sources eligible for a transport retry.
          triggeredForEpisode: false
        });
      }
      throw error;
    } finally {
      if (this.episodeStarts.get(episodeKey) === startPromise) this.episodeStarts.delete(episodeKey);
    }
  }

  async confirmCancellation(
    accountId: string,
    executionId: string,
    confirmation: Readonly<{
      confirmed: true;
      source: 'authenticated_user' | 'authorized_caregiver';
      occurredAt: number;
    }>
  ): Promise<Readonly<{ executionId: string }>> {
    this.validateAccountAndTargets(accountId, {});
    if (!SAFE_IDENTIFIER.test(executionId ?? '')
      || confirmation?.confirmed !== true
      || !['authenticated_user', 'authorized_caregiver'].includes(confirmation.source)
      || !Number.isSafeInteger(confirmation.occurredAt)) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    this.validateFreshness(confirmation.occurredAt);
    const execution = await this.options.scenarioEngine.getExecution(accountId, executionId);
    if (!execution || TERMINAL_STATES.has(execution.state)) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    return this.options.scenarioEngine.cancelScenario(accountId, executionId);
  }

  private contextInput(context: EdgeScenarioContext): Readonly<Record<string, ScenarioJson>> {
    return Object.freeze({
      locationRef: safeInputIdentifier(context.locationRef, 'last-known-location'),
      contactId: safeInputIdentifier(context.contactId, 'primary-emergency-contact')
    });
  }

  private shouldStartEpisode(
    accountId: string,
    scenarioId: 'fall_detection' | 'emotional_check_in' | 'ai_angel_auto_dial',
    sourceRef: string,
    positive: boolean,
    observedAt: number,
    cooldownMs: number
  ): boolean {
    const key = stableIdentifier(['episode', accountId, scenarioId]);
    const sourceKey = stableIdentifier(['source', sourceRef]);
    const previous = this.episodes.get(key);
    if (previous) {
      for (const [candidate, lastSeenAt] of previous.positiveSources) {
        if (observedAt - lastSeenAt >= this.episodeSourceStaleMs) {
          previous.positiveSources.delete(candidate);
        }
      }
      if (previous.positiveSources.size === 0) previous.triggeredForEpisode = false;
    }
    if (!positive) {
      if (previous?.positiveSources.has(sourceKey)) {
        const positiveSources = new Map(previous.positiveSources);
        positiveSources.delete(sourceKey);
        this.episodes.delete(key);
        this.episodes.set(key, {
          ...previous,
          positiveSources,
          triggeredForEpisode: positiveSources.size > 0 && previous.triggeredForEpisode
        });
      }
      return false;
    }
    const withinCooldown = previous !== undefined && observedAt - previous.lastTriggeredAt < cooldownMs;
    if (previous && previous.positiveSources.size > 0) {
      previous.positiveSources.set(sourceKey, observedAt);
      if (previous.triggeredForEpisode || withinCooldown) return false;
      previous.triggeredForEpisode = true;
      previous.lastTriggeredAt = observedAt;
      return true;
    }
    this.episodes.delete(key);
    this.episodes.set(key, {
      positiveSources: new Map([[sourceKey, observedAt]]),
      lastTriggeredAt: withinCooldown ? previous.lastTriggeredAt : observedAt,
      triggeredForEpisode: !withinCooldown
    });
    while (this.episodes.size > this.maxEpisodeKeys) this.episodes.delete(this.episodes.keys().next().value as string);
    return !withinCooldown;
  }

  private validateFreshness(observedAtMs: number): void {
    const now = this.now();
    if (!Number.isSafeInteger(now) || now < 0
      || observedAtMs < now - this.maxTelemetryAgeMs
      || observedAtMs > now + this.maxFutureSkewMs) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_STALE');
    }
  }

  private validateAccountAndTargets(accountId: string, targets: ScenarioDeviceTargets): void {
    if (!ACCOUNT_IDENTIFIER.test(accountId ?? '')
      || !targets || (targets.wearableId !== undefined && !SAFE_IDENTIFIER.test(targets.wearableId))
      || (targets.homeRobotId !== undefined && !SAFE_IDENTIFIER.test(targets.homeRobotId))) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
  }

  private validateContext(context: EdgeScenarioContext): void {
    if (!context || (context.locationContext !== undefined
      && !['home', 'away', 'unknown'].includes(context.locationContext))) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
  }

  private routeSourceEvent(
    accountId: string,
    sourceRef: string,
    sequence: number,
    envelope: WearableInferenceEnvelope | RobotEdgeInferenceEnvelope,
    operation: () => Promise<EdgeRoutingResult>
  ): Promise<EdgeRoutingResult> {
    const key = stableIdentifier(['edge-source', accountId, envelope.contractVersion, sourceRef]);
    const fingerprint = stableIdentifier(['edge-envelope', JSON.stringify(envelope)]);
    const previous = this.sourceRoutes.get(key);
    if (previous && sequence < previous.sequence) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    if (previous && sequence > previous.sequence && envelope.observedAtMs < previous.observedAt) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    if (previous && sequence === previous.sequence && !previous.failed) {
      if (previous.fingerprint !== fingerprint) throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
      return previous.result;
    }
    if (previous && sequence === previous.sequence && previous.fingerprint !== fingerprint) {
      throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
    }
    if (!previous && this.sourceRoutes.size >= this.maxEpisodeKeys) {
      const settledKey = [...this.sourceRoutes].find(([, entry]) => entry.settled)?.[0];
      if (!settledKey) throw new EdgeScenarioRouterError('EDGE_EVENT_INVALID');
      this.sourceRoutes.delete(settledKey);
    }
    // Serialize a source's accepted sequence so late persistence from an older
    // frame cannot overwrite newer telemetry or reopen a closed episode.
    const result = previous
      ? previous.result.catch(() => undefined).then(operation)
      : Promise.resolve().then(operation);
    const entry = {
      sequence,
      observedAt: envelope.observedAtMs,
      fingerprint,
      result,
      settled: false,
      failed: false
    };
    this.sourceRoutes.delete(key);
    this.sourceRoutes.set(key, entry);
    result.then(
      () => { entry.settled = true; },
      () => { entry.settled = true; entry.failed = true; }
    );
    return result;
  }

  private robotSafetyKey(accountId: string, robotId: string): string {
    return stableIdentifier(['robot-safety', accountId, robotId]);
  }

  private rememberRobotSafety(accountId: string, robotId: string, safeToMove: boolean, at: number): void {
    const key = this.robotSafetyKey(accountId, robotId);
    const previous = this.robotSafety.get(key);
    if (!previous || at >= previous.observedAt) {
      this.robotSafety.delete(key);
      this.robotSafety.set(key, { safeToMove, observedAt: at });
    }
    while (this.robotSafety.size > this.maxEpisodeKeys) {
      this.robotSafety.delete(this.robotSafety.keys().next().value as string);
    }
  }

  private hasFreshRobotSafety(accountId: string, robotId: string | undefined): boolean {
    if (!robotId) return false;
    const state = this.robotSafety.get(this.robotSafetyKey(accountId, robotId));
    return state?.safeToMove === true
      && this.now() - state.observedAt >= 0
      && this.now() - state.observedAt <= this.robotSafetyMaxAgeMs;
  }

  private async persistTelemetry(operation: (signal: AbortSignal) => Promise<void> | undefined): Promise<void> {
    if (!this.options.telemetryStateIngestor) return;
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(Object.assign(new Error('Telemetry persistence timed out'), {
            code: 'TELEMETRY_STATE_PERSIST_FAILED'
          }));
        }, this.telemetryPersistenceTimeoutMs);
      });
      await Promise.race([operation(controller.signal), timeoutPromise]);
    } catch {
      try {
        this.options.onTelemetryPersistenceFailure?.('TELEMETRY_STATE_PERSIST_FAILED');
      } catch {
        // Observability is best effort. A broken metric/log callback must not
        // suppress an otherwise authenticated life-safety inference.
      }
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
