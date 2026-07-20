import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import {
  InMemoryCiphertextRepository,
  UserStateModel,
  type UserStateUpdate
} from '../../src/models/UserState';
import { MemoryNet, type MemoryInput } from '../../src/memory/MemoryNet';
import {
  ActionGatewayScenarioRuntime,
  ScenarioEngine,
  type ScenarioExecutionSnapshot,
  type ScenarioOperationResult,
  type WaitForSignalOperation
} from '../../src/orchestration/ScenarioEngine';
import { EdgeScenarioRouter, type EdgeRoutingResult } from '../../src/orchestration/EdgeScenarioRouter';
import {
  WearableEdgeAI,
  createWearableSeededRandom,
  type WearableInferenceEnvelope
} from '../../src/edge/WearableEdgeAI';
import {
  RobotEdgeAI,
  createRobotSeededRandom,
  type RobotEdgeFeatureFrame,
  type RobotEdgeInferenceEnvelope
} from '../../src/edge/RobotEdgeAI';
import { createDefaultScenarioDefinitions } from '../../src/scenarios';

// This is intentionally a local CommonJS import. ActionGateway remains a CJS
// production module while the AI-native layer is compiled independently.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ActionGateway } = require('../../action-gateway.cjs') as {
  readonly ActionGateway: new (options: Record<string, unknown>) => {
    registerSession(accountId: string, channel: unknown, devices: readonly Record<string, unknown>[]): () => void;
    route(
      accountId: string,
      action: Readonly<Record<string, unknown>>,
      options?: Readonly<{ signal?: AbortSignal }>
    ): Promise<unknown>;
    acknowledgeWearable(
      accountId: string,
      channel: unknown,
      acknowledgement: Readonly<Record<string, unknown>>
    ): boolean;
    acknowledgeRobot(
      actionId: string,
      acknowledgement: Readonly<{
        ok: boolean;
        error_code?: string;
        camera_ready?: boolean;
        camera_session_ref?: string;
      }>,
      binding: Readonly<{ adapterId: string; bindingEpoch: number }>
    ): Promise<boolean>;
    waitForActionOutcome(
      accountId: string,
      actionId: string,
      options?: Readonly<{ timeoutMs?: number; signal?: AbortSignal }>
    ): Promise<unknown>;
    waitForDeliveries(): Promise<void>;
  };
};

const NOW = 1_750_000_000_000;
const ACCOUNT_ID = 'account-elder-1';
const OTHER_ACCOUNT_ID = 'account-elder-2';
const WEARABLE_ID = 'wearable-1';
const WEARABLE_SOURCE_REF = 'wearable-edge-1';
const ROBOT_ID = 'robot-1';
const ROBOT_SOURCE_REF = 'robot-edge-1';
const SCENARIO_SECRET = 'scenario-integration-secret-with-at-least-32-bytes';
const ENCRYPTION_KEY = new Uint8Array(Buffer.alloc(32, 0x5a));
const WEARABLE_COMMAND_PAYLOADS = Object.freeze({
  deploy_barrier: 'AQ==', emit_alarm: 'Ag==', trigger_sos: 'Aw==', stop: 'BA=='
});

type SignalType = WaitForSignalOperation['signal'];

interface RecordedEvent {
  readonly kind: 'device' | 'hume' | 'signal' | 'notification' | 'sms' | 'state' | 'memory' | 'analytics';
  readonly name: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

interface SignalReply extends ScenarioOperationResult {}

interface HarnessOptions {
  readonly robotOnline?: boolean;
  readonly signalReplies?: Partial<Record<SignalType, readonly SignalReply[]>>;
  readonly blockedSignals?: readonly SignalType[];
  readonly blockHume?: boolean;
  readonly useSystemClock?: boolean;
  readonly failActions?: readonly string[];
  readonly manufacturerStatus?: 200 | 202;
  readonly manufacturerAck?: 'ack' | 'nack' | 'timeout';
  readonly robotAckTimeoutMs?: number;
}

interface SignedManufacturerRequest {
  readonly payload: string;
  readonly signature: string;
  readonly envelope: Readonly<Record<string, unknown>>;
}

function expectFastDispatch(startedAt: number): void {
  // These are in-process simulations with no artificial delay. The generous
  // boundary detects accidental serial waits while remaining stable on CI.
  expect(performance.now() - startedAt).toBeLessThan(500);
}

function scenarioEvents(events: readonly RecordedEvent[]): readonly string[] {
  return events.map(({ kind, name }) => `${kind}:${name}`);
}

function abortableNever(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = (): void => reject(Object.assign(new Error('cancelled'), { code: 'ABORTED' }));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener('abort', rejectAbort, { once: true });
  });
}

async function createHarness(options: HarnessOptions = {}) {
  let logicalNow = NOW;
  const now = options.useSystemClock ? () => Date.now() : () => logicalNow;
  const isoNow = (): string => new Date(now()).toISOString();
  const repository = new InMemoryCiphertextRepository();
  const userState = new UserStateModel({ repository, encryptionKey: ENCRYPTION_KEY, clock: () => new Date(now()) });
  const memoryNet = new MemoryNet({ repository, encryptionKey: ENCRYPTION_KEY, clock: () => new Date(now()) });
  const events: RecordedEvent[] = [];
  const manufacturerRequests: SignedManufacturerRequest[] = [];
  const actionOutcomes: string[] = [];
  let concurrentDeviceRoutes = 0;
  let maxConcurrentDeviceRoutes = 0;
  const signingKey = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const publicKey = createPublicKey(signingKey);

  await userState.updateState(ACCOUNT_ID, {
    physical: {
      heartRateBpm: { value: 68, observedAt: isoNow() },
      hrvMs: { value: 52, observedAt: isoNow() },
      steps: { value: 120, observedAt: isoNow() }
    },
    context: {
      location: { context: 'home', latitude: 1.3521, longitude: 103.8198, observedAt: isoNow() },
      timeOfDay: 'morning'
    },
    devices: [
      {
        deviceId: WEARABLE_ID, type: 'wearable', batteryPercent: 81,
        connectivity: 'online', lastKnownState: 'monitoring', observedAt: isoNow()
      },
      {
        deviceId: ROBOT_ID, type: 'home_robot', batteryPercent: 74,
        connectivity: options.robotOnline === false ? 'offline' : 'online',
        lastKnownState: 'docked', observedAt: isoNow()
      }
    ]
  }, { idempotencyKey: 'integration_seed_state_001' });

  await memoryNet.storeMemory(ACCOUNT_ID, {
    id: 'preference-classical-morning', kind: 'preference', source: 'user',
    category: 'music', value: 'classical music', preferredTimeOfDay: 'morning'
  }, { idempotencyKey: 'integration_seed_memory_001' });
  await memoryNet.storeMemory(ACCOUNT_ID, {
    id: 'life-event-granddaughter-visit', kind: 'life_event', source: 'user',
    summary: 'Granddaughter visited yesterday', occurredAt: isoNow(), salience: 0.9,
    tags: ['family', 'visit']
  }, { idempotencyKey: 'integration_seed_memory_002' });

  let gateway!: InstanceType<typeof ActionGateway>;
  const wearableChannel = {
    readyState: 1,
    send(message: string): void {
      const signed = JSON.parse(message) as { readonly envelope: { readonly id: string } };
      gateway.acknowledgeWearable(ACCOUNT_ID, wearableChannel, {
        action_id: signed.envelope.id,
        ok: true
      });
    }
  };
  gateway = new ActionGateway({
    signingPrivateKey: signingKey,
    wearableCommandPayloads: WEARABLE_COMMAND_PAYLOADS,
    manufacturerWebhookURL: 'https://manufacturer.invalid/mock-only',
    manufacturerApiKey: 'mock-only-not-a-real-credential',
    retries: 1,
    retryDelayMs: 0,
    requestTimeoutMs: 100,
    wearableAckTimeoutMs: 100,
    robotAckTimeoutMs: options.robotAckTimeoutMs ?? 100,
    sleep: async () => undefined,
    now,
    logger: { error: () => undefined, warn: () => undefined, info: () => undefined },
    resolveRobotBinding: async () => ({
      active: true,
      state: 'active',
      manufacturerDeviceId: 'manufacturer-robot-opaque-1',
      adapterId: 'manufacturer-mock',
      bindingEpoch: 7
    }),
    isRobotBindingActive: async () => true,
    fetchImpl: async (_url: string, request: { readonly body: string }) => {
      const signed = JSON.parse(request.body) as SignedManufacturerRequest;
      manufacturerRequests.push(signed);
      const cameraSessionRef = signed.envelope.action === 'share_camera_view'
        ? (signed.envelope.parameters as Readonly<Record<string, unknown>> | undefined)?.session_id
        : undefined;
      // Camera transport acceptance is not proof that a view exists. Exercise
      // the authenticated async-ready ACK even in the otherwise synchronous harness.
      const status = options.manufacturerStatus ?? (cameraSessionRef ? 202 : 200);
      if (status === 202 && options.manufacturerAck !== 'timeout') {
        setTimeout(() => {
          void gateway.acknowledgeRobot(
            String(signed.envelope.id),
            options.manufacturerAck === 'nack'
              ? { ok: false, error_code: 'MANUFACTURER_REJECTED' }
              : {
                ok: true,
                ...(typeof cameraSessionRef === 'string'
                  ? { camera_ready: true, camera_session_ref: cameraSessionRef }
                  : {})
              },
            { adapterId: 'manufacturer-mock', bindingEpoch: 7 }
          );
        }, 1);
      }
      return { ok: status === 200, status };
    }
  });
  gateway.registerSession(ACCOUNT_ID, wearableChannel, [
    { device_id: WEARABLE_ID, device_type: 'wearable', online: true },
    { device_id: ROBOT_ID, device_type: 'home_robot', online: options.robotOnline !== false }
  ]);

  const queuedSignalReplies = new Map<SignalType, SignalReply[]>(
    Object.entries(options.signalReplies ?? {}).map(([signalType, replies]) => (
      [signalType as SignalType, [...(replies ?? [])]]
    ))
  );
  let resolveSignalStarted!: (signalType: SignalType) => void;
  const signalStarted = new Promise<SignalType>((resolve) => { resolveSignalStarted = resolve; });
  let signalled = false;

  const runtime = new ActionGatewayScenarioRuntime({
    actionGateway: {
      route: async (accountId, action, routeOptions) => {
        events.push({
          kind: 'device',
          name: `${String(action.device_type)}:${String(action.action)}`,
          details: { deviceId: String(action.device_id) }
        });
        concurrentDeviceRoutes += 1;
        maxConcurrentDeviceRoutes = Math.max(maxConcurrentDeviceRoutes, concurrentDeviceRoutes);
        try {
          if (options.failActions?.includes(`${String(action.device_type)}:${String(action.action)}`)) {
            await Promise.resolve();
            throw Object.assign(new Error('Simulated target failure'), { code: 'SIMULATED_DEVICE_FAILURE' });
          }
          return await gateway.route(accountId, action, routeOptions);
        } finally {
          concurrentDeviceRoutes -= 1;
        }
      },
      waitForActionOutcome: async (accountId, actionId, outcomeOptions) => {
        try {
          const outcome = await gateway.waitForActionOutcome(accountId, actionId, outcomeOptions);
          actionOutcomes.push('delivered');
          return outcome;
        } catch (error) {
          const rawCode = String((error as { readonly code?: unknown }).code ?? 'ACTION_FAILED');
          actionOutcomes.push(
            rawCode === 'ACK_TIMEOUT' || rawCode === 'ACTION_OUTCOME_READ_TIMEOUT'
              ? 'ACTION_OUTCOME_TIMEOUT'
              : rawCode
          );
          throw error;
        }
      }
    },
    beginHumeSession: async (accountId, request, signal) => {
      const recalled = await memoryNet.recall(accountId, { query: 'classical morning', limit: 5 });
      events.push({
        kind: 'hume', name: String(request.mode),
        details: { recalledMemoryIds: recalled.map(({ memory }) => memory.id) }
      });
      if (options.blockHume) return abortableNever(signal);
      return undefined;
    },
    waitForSignal: async (_accountId, signalType, signal) => {
      events.push({ kind: 'signal', name: signalType });
      if (!signalled) {
        signalled = true;
        resolveSignalStarted(signalType);
      }
      if (options.blockedSignals?.includes(signalType)) return abortableNever(signal);
      const queued = queuedSignalReplies.get(signalType);
      const response = queued?.shift();
      if (response) return response;
      return signalType === 'user_response'
        ? { status: 'succeeded', data: { responded: true } }
        : { status: 'succeeded', data: { confirmed: true } };
    },
    notify: async (_accountId, request) => {
      events.push({ kind: 'notification', name: String(request.template), details: request });
    },
    sendSms: async (_accountId, request) => {
      events.push({ kind: 'sms', name: String(request.template), details: request });
    },
    readUserState: async (accountId, selector) => {
      const state = await userState.getCurrentState(accountId);
      if (!state) return undefined;
      if (selector === 'steps_today') return state.physical.steps?.value;
      if (selector === 'last_location') return state.context.location;
      if (selector === 'medication_adherence') return state.cognitive.medicationAdherence;
      return userState.queryTrends(accountId, {
        metric: 'stress_score',
        from: new Date(now() - 30 * 86_400_000).toISOString(),
        to: new Date(now()).toISOString(),
        limit: 30
      });
    },
    updateUserState: async (accountId, update, idempotencyKey) => {
      events.push({ kind: 'state', name: 'updated' });
      return userState.updateState(accountId, update as UserStateUpdate, { idempotencyKey });
    },
    appendMemory: async (accountId, memory, idempotencyKey) => {
      const input = memory as MemoryInput;
      events.push({
        kind: 'memory',
        name: input.kind === 'health_trend' ? input.metric : input.kind
      });
      return memoryNet.storeMemory(accountId, input, { idempotencyKey });
    },
    recordAnalytics: async (_accountId, event) => {
      events.push({ kind: 'analytics', name: String(event.event) });
    }
  });
  const engine = new ScenarioEngine({
    definitions: createDefaultScenarioDefinitions(),
    runtime,
    identitySecret: SCENARIO_SECRET,
    now,
    defaultStepTimeoutMs: 100
  });
  const router = new EdgeScenarioRouter({ scenarioEngine: engine, now });
  const wearableEdge = new WearableEdgeAI({ clockNow: now, random: createWearableSeededRandom(41) });
  const robotEdge = new RobotEdgeAI({ clockNow: now, random: createRobotSeededRandom(73) });

  async function primeRobotSafety(sequence = 0): Promise<void> {
    const idle = robotEdge.infer(robotEdge.generateFrame({
      deviceRef: ROBOT_SOURCE_REF,
      sequence,
      profile: 'idle'
    }));
    await router.ingestRobotInference(ACCOUNT_ID, idle, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
  }

  async function complete(routing: EdgeRoutingResult): Promise<ScenarioExecutionSnapshot> {
    const execution = routing.started[0]?.execution;
    if (!execution) throw new Error('Expected the edge event to start a scenario');
    const completed = await engine.waitForCompletion(ACCOUNT_ID, execution.executionId);
    await gateway.waitForDeliveries();
    return completed;
  }

  return {
    repository,
    userState,
    memoryNet,
    events,
    manufacturerRequests,
    actionOutcomes,
    publicKey,
    gateway,
    engine,
    router,
    wearableEdge,
    robotEdge,
    primeRobotSafety,
    signalStarted,
    complete,
    get maxConcurrentDeviceRoutes(): number { return maxConcurrentDeviceRoutes; },
    advance(ms: number): void { logicalNow += ms; }
  };
}

describe('AI-native cross-device scenarios', () => {
  it('routes wearable fall inference through the robot voice check and escalates, under 500 ms', async () => {
    const harness = await createHarness({
      signalReplies: { user_response: [{ status: 'not_found', data: { responded: false } }] }
    });
    await harness.primeRobotSafety();
    const frame = harness.wearableEdge.generateFrame({
      deviceRef: WEARABLE_SOURCE_REF, sequence: 1, profile: 'fall'
    });
    const inferred = harness.wearableEdge.infer(frame);
    const serialized = harness.wearableEdge.serializeOutbound(inferred);
    const cloudEnvelope = JSON.parse(serialized) as WearableInferenceEnvelope;
    const startedAt = performance.now();
    const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, cloudEnvelope, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    }, { locationRef: 'home-bedroom', contactId: 'primary-caregiver' });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(inferred.inference).toMatchObject({ fallDetected: true, activity: 'fall' });
    expect(serialized).not.toContain('accelerometer');
    expect(routing.started[0]).toMatchObject({ duplicate: false });
    expect(completed.state).toBe('completed');
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:navigate_to_location',
      'hume:voice_check',
      'signal:user_response',
      'device:home_robot:start_two_way_call',
      'device:wearable:trigger_sos',
      'device:home_robot:share_camera_view',
      'notification:fall_no_response',
      'analytics:fall_scenario_completed'
    ]);
    expect(harness.maxConcurrentDeviceRoutes).toBeGreaterThanOrEqual(2);
    expect(harness.manufacturerRequests).toHaveLength(3);
    for (const signed of harness.manufacturerRequests) {
      expect(verify(
        null,
        Buffer.from(signed.payload, 'ascii'),
        harness.publicKey,
        Buffer.from(signed.signature, 'base64url')
      )).toBe(true);
    }

    const deviceCallsBeforeReplay = harness.events.filter(({ kind }) => kind === 'device').length;
    const coalescedReplay = await harness.router.ingestWearableInference(ACCOUNT_ID, cloudEnvelope, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    }, { locationRef: 'home-bedroom', contactId: 'primary-caregiver' });
    expect(coalescedReplay).toEqual(routing);
    expect(harness.events.filter(({ kind }) => kind === 'device')).toHaveLength(deviceCallsBeforeReplay);
  });

  it('executes medication reminder, caregiver push, and SMS fallback with a persisted adherence outcome', async () => {
    const notConfirmed = { status: 'not_found' as const, data: { confirmed: false } };
    const harness = await createHarness({
      signalReplies: { medication_taken: [notConfirmed, notConfirmed] }
    });
    const startedAt = performance.now();
    const routing = await harness.router.ingestContextEvent(ACCOUNT_ID, {
      eventId: 'medication-event-1', type: 'medication_due', occurredAt: NOW,
      data: { medicationId: 'morning-dose', scheduledAt: NOW }
    }, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('completed');
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:medication_reminder',
      'signal:medication_taken',
      'notification:medication_not_confirmed',
      'signal:medication_taken',
      'sms:medication_escalation',
      'state:updated',
      'memory:medication_adherence',
      'analytics:medication_adherence_completed'
    ]);
    const current = await harness.userState.getCurrentState(ACCOUNT_ID);
    expect(current?.cognitive.medicationAdherence).toMatchObject({ scheduled: 1, taken: 0, missed: 1, rate: 0 });
    const trends = await harness.memoryNet.getTrendSummaries(ACCOUNT_ID, {
      metric: 'medication_adherence'
    });
    expect(trends).toHaveLength(1);
  });

  it('turns wearable stress into a memory-aware Hume check-in and persists the stress trend', async () => {
    const harness = await createHarness();
    const frame = harness.wearableEdge.generateFrame({
      deviceRef: WEARABLE_SOURCE_REF, sequence: 2, profile: 'stressed'
    });
    const inference = harness.wearableEdge.infer(frame);
    const startedAt = performance.now();
    const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, inference, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(inference.inference.stressScore).toBeGreaterThanOrEqual(70);
    expect(completed.scenarioId).toBe('emotional_check_in');
    expect(completed.state).toBe('completed');
    expect(scenarioEvents(harness.events)).toEqual([
      'hume:calming',
      'signal:user_response',
      'device:home_robot:play_soothing_audio',
      'state:updated',
      'memory:stress_score',
      'analytics:emotional_checkin_completed'
    ]);
    expect(harness.events.find(({ kind }) => kind === 'hume')?.details).toEqual({
      recalledMemoryIds: ['preference-classical-morning']
    });
    const trends = await harness.userState.queryTrends(ACCOUNT_ID, {
      metric: 'stress_score',
      from: new Date(NOW - 1).toISOString(),
      to: new Date(NOW + 1).toISOString()
    });
    expect(trends.at(-1)?.value).toBe(inference.inference.stressScore);
  });

  it('uses robot inactivity plus wearable steps for cognitive engagement and records the response pattern', async () => {
    const harness = await createHarness();
    const startedAt = performance.now();
    const routing = await harness.router.ingestContextEvent(ACCOUNT_ID, {
      eventId: 'bedroom-inactivity-1', type: 'bedroom_inactivity', occurredAt: NOW,
      data: { stepsToday: 120 }
    }, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('completed');
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:cognitive_engagement',
      'hume:cognitive_game',
      'signal:user_response',
      'memory:cognitive_engagement',
      'analytics:cognitive_engagement_completed'
    ]);
    const recalled = await harness.memoryNet.recall(ACCOUNT_ID, {
      query: 'cognitive engagement observation'
    });
    expect(recalled[0]?.memory.kind).toBe('health_trend');
  });

  it('routes offline robot help inference into wearable SOS, room camera context, and Hume emergency audio', async () => {
    const harness = await createHarness();
    const frame = harness.robotEdge.generateFrame({
      deviceRef: ROBOT_SOURCE_REF, sequence: 3, profile: 'help_request'
    });
    const inference = harness.robotEdge.infer(frame);
    const serialized = harness.robotEdge.serializeOutbound(inference);
    const cloudEnvelope = JSON.parse(serialized) as RobotEdgeInferenceEnvelope;
    const startedAt = performance.now();
    const routing = await harness.router.ingestRobotInference(ACCOUNT_ID, cloudEnvelope, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    }, { locationRef: 'home-living-room', contactId: 'primary-caregiver' });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(cloudEnvelope.inference.voice).toMatchObject({ intent: 'request_help', processedOffline: true });
    expect(serialized).not.toMatch(/cameraFrame|rawAudio|transcript|voiceprint|faceEmbedding/i);
    expect(cloudEnvelope.model.rawMediaRetained).toBe(false);
    expect(completed.state).toBe('completed');
    expect(scenarioEvents(harness.events)).toEqual([
      'device:wearable:trigger_sos',
      'device:home_robot:share_camera_view',
      'device:home_robot:start_two_way_call',
      'hume:emergency_call',
      'notification:ai_angel_emergency_active',
      'analytics:ai_angel_auto_dial_completed'
    ]);
    expect(harness.maxConcurrentDeviceRoutes).toBeGreaterThanOrEqual(2);
  });

  it('keeps the wearable fall alarm live when the parallel robot camera action fails', async () => {
    const harness = await createHarness({
      failActions: ['home_robot:share_camera_view'],
      signalReplies: { user_response: [{ status: 'not_found', data: { responded: false } }] }
    });
    await harness.primeRobotSafety();
    const fall = harness.wearableEdge.infer(harness.wearableEdge.generateFrame({
      deviceRef: WEARABLE_SOURCE_REF, sequence: 31, profile: 'fall'
    }));
    const startedAt = performance.now();
    const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, fall, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('fallback_completed');
    expect(harness.maxConcurrentDeviceRoutes).toBeGreaterThanOrEqual(2);
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:navigate_to_location',
      'hume:voice_check',
      'signal:user_response',
      'device:home_robot:start_two_way_call',
      'device:wearable:trigger_sos',
      'device:home_robot:share_camera_view',
      'sms:fall_no_response',
      'notification:fall_no_response',
      'analytics:fall_scenario_completed'
    ]);
    const notification = harness.events.find(({ kind }) => kind === 'notification');
    expect(notification?.details).toMatchObject({ include_camera_link: false });
  });

  it('uses AI Angel SMS and no-camera alert when only the wearable fanout succeeds', async () => {
    const harness = await createHarness({ failActions: ['home_robot:share_camera_view'] });
    const help = harness.robotEdge.infer(harness.robotEdge.generateFrame({
      deviceRef: ROBOT_SOURCE_REF, sequence: 32, profile: 'help_request'
    }));
    const startedAt = performance.now();
    const routing = await harness.router.ingestRobotInference(ACCOUNT_ID, help, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('fallback_completed');
    expect(harness.maxConcurrentDeviceRoutes).toBeGreaterThanOrEqual(2);
    expect(scenarioEvents(harness.events)).toEqual([
      'device:wearable:trigger_sos',
      'device:home_robot:share_camera_view',
      'sms:ai_angel_wifi_unavailable',
      'device:home_robot:start_two_way_call',
      'hume:emergency_call',
      'notification:ai_angel_emergency_active',
      'analytics:ai_angel_auto_dial_completed'
    ]);
    const notification = harness.events.find(({ kind }) => kind === 'notification');
    expect(notification?.details).toMatchObject({ include_camera_link: false });
  });

  it('falls back immediately when the robot is offline and never starts a misleading voice check', async () => {
    const harness = await createHarness({ robotOnline: false });
    await harness.primeRobotSafety();
    const inference = harness.wearableEdge.infer(harness.wearableEdge.generateFrame({
      deviceRef: WEARABLE_SOURCE_REF, sequence: 4, profile: 'fall'
    }));
    const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, inference, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);

    expect(completed.state).toBe('fallback_completed');
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:navigate_to_location',
      'notification:fall_robot_unavailable',
      'analytics:fall_scenario_completed'
    ]);
    expect(harness.manufacturerRequests).toHaveLength(0);
  });

  it('applies a deterministic Hume timeout fallback without waiting in real time', async () => {
    jest.useFakeTimers({ now: NOW });
    try {
      const harness = await createHarness({ blockHume: true, useSystemClock: true });
      const inference = harness.wearableEdge.infer(harness.wearableEdge.generateFrame({
        deviceRef: WEARABLE_SOURCE_REF, sequence: 5, profile: 'stressed'
      }));
      const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, inference, {
        targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
        wearableSourceRef: WEARABLE_SOURCE_REF,
        homeRobotSourceRef: ROBOT_SOURCE_REF
      });
      const completion = harness.complete(routing);

      await jest.advanceTimersByTimeAsync(5_001);
      await expect(completion).resolves.toMatchObject({ state: 'fallback_completed' });
      expect(scenarioEvents(harness.events)).toEqual([
        'hume:calming',
        'notification:emotional_checkin_later',
        'state:updated',
        'memory:stress_score',
        'analytics:emotional_checkin_completed'
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('requires authenticated confirmation before a robot cancel intent can stop a critical workflow', async () => {
    const harness = await createHarness({ blockedSignals: ['user_response'] });
    await harness.primeRobotSafety();
    const fall = harness.wearableEdge.infer(harness.wearableEdge.generateFrame({
      deviceRef: WEARABLE_SOURCE_REF, sequence: 6, profile: 'fall'
    }));
    const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, fall, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    await harness.signalStarted;

    const idleFrame = harness.robotEdge.generateFrame({
      deviceRef: ROBOT_SOURCE_REF, sequence: 7, profile: 'idle'
    });
    const cancelFrame: RobotEdgeFeatureFrame = {
      ...idleFrame,
      audio: { ...idleFrame.audio, voiceActivity: true, keyword: 'stop' }
    };
    const cancelInference = harness.robotEdge.infer(cancelFrame);
    expect(cancelInference.inference.voice.intent).toBe('cancel');
    const cancellationRequest = await harness.router.ingestRobotInference(ACCOUNT_ID, cancelInference, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const executionId = routing.started[0]!.execution.executionId;
    const beforeConfirmation = await harness.engine.getExecution(ACCOUNT_ID, executionId);

    expect(cancellationRequest).toMatchObject({ started: [], cancellationRequested: true });
    expect(beforeConfirmation?.state).toBe('running');
    await expect(harness.router.confirmCancellation(OTHER_ACCOUNT_ID, executionId, {
      confirmed: true,
      source: 'authenticated_user',
      occurredAt: NOW
    })).rejects.toThrow();

    const confirmed = await harness.router.confirmCancellation(ACCOUNT_ID, executionId, {
      confirmed: true,
      source: 'authenticated_user',
      occurredAt: NOW
    });
    const completed = await harness.engine.getExecution(ACCOUNT_ID, executionId);

    expect(confirmed.executionId).toBe(executionId);
    expect(completed?.state).toBe('cancelled');
    expect(harness.events.some(({ kind }) => kind === 'notification')).toBe(false);
  });
});

describe('manufacturer asynchronous action outcomes', () => {
  async function runFallWithOutcome(
    manufacturerAck: 'ack' | 'nack' | 'timeout',
    robotAckTimeoutMs = 100
  ) {
    const harness = await createHarness({
      manufacturerStatus: 202,
      manufacturerAck,
      robotAckTimeoutMs
    });
    await harness.primeRobotSafety();
    const fall = harness.wearableEdge.infer(harness.wearableEdge.generateFrame({
      deviceRef: WEARABLE_SOURCE_REF, sequence: 80, profile: 'fall'
    }));
    const startedAt = performance.now();
    const routing = await harness.router.ingestWearableInference(ACCOUNT_ID, fall, {
      targets: { wearableId: WEARABLE_ID, homeRobotId: ROBOT_ID },
      wearableSourceRef: WEARABLE_SOURCE_REF,
      homeRobotSourceRef: ROBOT_SOURCE_REF
    });
    const completed = await harness.complete(routing);
    return { harness, completed, startedAt };
  }

  it('waits for authenticated 202 ACKs before advancing the safety workflow', async () => {
    const { harness, completed, startedAt } = await runFallWithOutcome('ack');

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('completed');
    // A callback may win the race before route() returns, in which case the
    // terminal delivery is returned directly instead of via waitForActionOutcome().
    expect(harness.actionOutcomes).toEqual(expect.arrayContaining(['delivered']));
    expect(harness.manufacturerRequests).toHaveLength(1);
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:navigate_to_location',
      'hume:voice_check',
      'signal:user_response',
      'analytics:fall_scenario_completed'
    ]);
  });

  it('turns an authenticated 202 NACK into the immediate fall safety fallback', async () => {
    const { harness, completed, startedAt } = await runFallWithOutcome('nack');

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('fallback_completed');
    expect(completed.steps[0]).toMatchObject({ errorCode: 'MANUFACTURER_REJECTED' });
    expect(harness.actionOutcomes).toEqual(['MANUFACTURER_REJECTED']);
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:navigate_to_location',
      'notification:fall_robot_unavailable',
      'analytics:fall_scenario_completed'
    ]);
  });

  it('turns a missing 202 callback into a bounded outcome timeout and the same fallback', async () => {
    const { harness, completed, startedAt } = await runFallWithOutcome('timeout', 25);

    expectFastDispatch(startedAt);
    expect(completed.state).toBe('fallback_completed');
    expect(completed.steps[0]).toMatchObject({ errorCode: 'ACTION_OUTCOME_TIMEOUT' });
    expect(harness.actionOutcomes).toEqual(['ACTION_OUTCOME_TIMEOUT']);
    expect(scenarioEvents(harness.events)).toEqual([
      'device:home_robot:navigate_to_location',
      'notification:fall_robot_unavailable',
      'analytics:fall_scenario_completed'
    ]);
  });
});

describe('encrypted state and memory lifecycle across AI conversations', () => {
  it('queries state trends, recalls summaries, exports data, and honors scoped deletion', async () => {
    const harness = await createHarness();
    harness.advance(86_400_000);
    const observedAt = new Date(NOW + 86_400_000).toISOString();
    await harness.userState.updateState(ACCOUNT_ID, {
      physical: { heartRateBpm: { value: 72, observedAt } }
    }, { idempotencyKey: 'integration_trend_update_001' });
    const trend = await harness.userState.queryTrends(ACCOUNT_ID, {
      metric: 'heart_rate_bpm',
      from: new Date(NOW - 1).toISOString(),
      to: new Date(NOW + 86_400_001).toISOString()
    });
    expect(trend.map(({ value }) => value)).toEqual([68, 72]);

    const recalled = await harness.memoryNet.recall(ACCOUNT_ID, {
      query: 'granddaughter visited', limit: 5
    });
    expect(recalled.map(({ memory }) => memory.id)).toEqual(['life-event-granddaughter-visit']);
    const stateExport = await harness.userState.exportData(ACCOUNT_ID);
    const memoryExport = await harness.memoryNet.exportData(ACCOUNT_ID);
    expect(stateExport.history).toHaveLength(2);
    expect(memoryExport.memories).toHaveLength(2);
    expect(await harness.userState.getCurrentState(OTHER_ACCOUNT_ID)).toBeNull();
    expect(await harness.memoryNet.listMemories(OTHER_ACCOUNT_ID)).toEqual([]);

    const encryptedAtRest = JSON.stringify(harness.repository.inspectCiphertext());
    expect(encryptedAtRest).not.toContain(ACCOUNT_ID);
    expect(encryptedAtRest).not.toContain('Granddaughter');
    expect(encryptedAtRest).not.toContain('classical music');

    await expect(harness.memoryNet.deleteMemory(ACCOUNT_ID, 'life-event-granddaughter-visit')).resolves.toBe(true);
    await expect(harness.memoryNet.recall(ACCOUNT_ID, { query: 'granddaughter' })).resolves.toEqual([]);
    await expect(harness.memoryNet.deleteAllData(ACCOUNT_ID)).resolves.toBe(true);
    await expect(harness.userState.deleteAllData(ACCOUNT_ID)).resolves.toBe(true);
    await expect(harness.memoryNet.exportData(ACCOUNT_ID)).resolves.toMatchObject({ memories: [] });
    await expect(harness.userState.getCurrentState(ACCOUNT_ID)).resolves.toBeNull();
  });
});
