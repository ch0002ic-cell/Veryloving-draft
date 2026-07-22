import {
  ActionGatewayScenarioRuntime,
  InMemoryScenarioExecutionRepository,
  ScenarioEngine,
  type ScenarioDefinition,
  type ScenarioExecutionSnapshot,
  type ScenarioOperation,
  type ScenarioOperationResult,
  type ScenarioPriority,
  type ScenarioRuntime,
  type ScenarioRuntimeContext,
  type ScenarioStartRequest
} from '../ScenarioEngine';
import { createDefaultScenarioDefinitions } from '../../scenarios';

const NOW = 1_750_000_000_000;
const SECRET = 'scenario-test-secret-is-at-least-thirty-two-bytes';

function request(
  scenarioId: ScenarioStartRequest['scenarioId'],
  suffix = scenarioId,
  input: ScenarioStartRequest['input'] = {}
): ScenarioStartRequest {
  const triggerType = {
    fall_detection: 'wearable_fall',
    medication_adherence: 'medication_due',
    emotional_check_in: 'wearable_stress',
    cognitive_engagement: 'bedroom_inactivity',
    ai_angel_auto_dial: 'panic_button'
  }[scenarioId];
  return {
    scenarioId,
    trigger: { eventId: `event-${suffix}`, type: triggerType, occurredAt: NOW },
    devices: { wearableId: 'wearable-1', homeRobotId: 'robot-1' },
    idempotencyKey: `idempotency-${suffix}`,
    input
  };
}

class RecordingRuntime implements ScenarioRuntime {
  readonly calls: ScenarioOperation[] = [];
  readonly contexts: ScenarioRuntimeContext[] = [];

  constructor(
    private readonly handler: (
      operation: ScenarioOperation,
      context: ScenarioRuntimeContext
    ) => Promise<ScenarioOperationResult> = async (operation) => {
      if (operation.kind === 'wait_for_signal') {
        return {
          status: 'succeeded',
          data: operation.signal === 'user_response'
            ? { responded: true }
            : { confirmed: true, pillboxApproached: true }
        };
      }
      if (operation.kind === 'device_action_batch') {
        return {
          status: 'succeeded',
          code: 'BATCH_DELIVERED',
          data: {
            wearableDelivered: operation.actions.some(({ target }) => target === 'wearable'),
            robotDelivered: operation.actions.some(({ target }) => target === 'home_robot'),
            childOutcomes: operation.actions.map(({ id, target }) => ({ id, target, state: 'delivered' }))
          }
        };
      }
      if (operation.kind === 'device_action') {
        return { status: 'succeeded', data: { delivered: true } };
      }
      return { status: 'succeeded' };
    }
  ) {}

  async execute(operation: ScenarioOperation, context: ScenarioRuntimeContext): Promise<ScenarioOperationResult> {
    this.calls.push(operation);
    this.contexts.push(context);
    return this.handler(operation, context);
  }
}

class DelayedReadScenarioRepository extends InMemoryScenarioExecutionRepository {
  private nextRead?: {
    readonly captured: (snapshot: ScenarioExecutionSnapshot | undefined) => void;
    readonly gate: Promise<void>;
  };

  holdNextRead(): {
    readonly captured: Promise<ScenarioExecutionSnapshot | undefined>;
    readonly release: () => void;
  } {
    let capture!: (snapshot: ScenarioExecutionSnapshot | undefined) => void;
    let release!: () => void;
    const captured = new Promise<ScenarioExecutionSnapshot | undefined>((resolve) => { capture = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.nextRead = { captured: capture, gate };
    return { captured, release };
  }

  override async get(
    accountRef: string,
    executionId: string
  ): Promise<ScenarioExecutionSnapshot | undefined> {
    const snapshot = await super.get(accountRef, executionId);
    const hold = this.nextRead;
    if (hold) {
      this.nextRead = undefined;
      hold.captured(snapshot);
      await hold.gate;
    }
    return snapshot;
  }
}

class DelayedCreateScenarioRepository extends InMemoryScenarioExecutionRepository {
  private releaseCreate!: () => void;
  readonly createdVisible: Promise<void>;
  private readonly createGate: Promise<void>;

  constructor() {
    super();
    let markVisible!: () => void;
    this.createdVisible = new Promise<void>((resolve) => { markVisible = resolve; });
    this.createGate = new Promise<void>((resolve) => { this.releaseCreate = resolve; });
    this.markVisible = markVisible;
  }

  private readonly markVisible: () => void;

  release(): void {
    this.releaseCreate();
  }

  override async create(execution: ScenarioExecutionSnapshot): Promise<{
    readonly created: boolean;
    readonly execution: ScenarioExecutionSnapshot;
  }> {
    const result = await super.create(execution);
    if (result.created) {
      this.markVisible();
      await this.createGate;
    }
    return result;
  }
}

class TerminalFailureScenarioRepository extends InMemoryScenarioExecutionRepository {
  terminalPutAttempts = 0;

  override async put(execution: ScenarioExecutionSnapshot): Promise<void> {
    if (['completed', 'fallback_completed', 'failed', 'cancelled'].includes(execution.state)) {
      this.terminalPutAttempts += 1;
      throw Object.assign(new Error('durable store unavailable'), { code: 'STORE_UNAVAILABLE' });
    }
    await super.put(execution);
  }
}

class CommitThenThrowTerminalScenarioRepository extends InMemoryScenarioExecutionRepository {
  private failAfterTerminalCommit = true;

  override async put(execution: ScenarioExecutionSnapshot): Promise<void> {
    await super.put(execution);
    if (this.failAfterTerminalCommit
      && ['completed', 'fallback_completed', 'failed', 'cancelled'].includes(execution.state)) {
      this.failAfterTerminalCommit = false;
      throw Object.assign(new Error('terminal response was lost'), { code: 'STORE_UNAVAILABLE' });
    }
  }
}

class CommitThenThrowScenarioRepository extends InMemoryScenarioExecutionRepository {
  private failAfterFirstCreate = true;

  override async create(execution: ScenarioExecutionSnapshot): Promise<{
    readonly created: boolean;
    readonly execution: ScenarioExecutionSnapshot;
  }> {
    const result = await super.create(execution);
    if (result.created && this.failAfterFirstCreate) {
      this.failAfterFirstCreate = false;
      throw Object.assign(new Error('create response was lost'), { code: 'STORE_UNAVAILABLE' });
    }
    return result;
  }
}

class TransientCancellationFailureRepository extends InMemoryScenarioExecutionRepository {
  private failNextCancellation = true;
  private failNextConfirmationRead = false;

  override async put(execution: ScenarioExecutionSnapshot): Promise<void> {
    if (execution.state === 'cancelled' && this.failNextCancellation) {
      this.failNextCancellation = false;
      this.failNextConfirmationRead = true;
      throw Object.assign(new Error('cancellation write unavailable'), { code: 'STORE_UNAVAILABLE' });
    }
    await super.put(execution);
  }

  override async get(
    accountRef: string,
    executionId: string
  ): Promise<ScenarioExecutionSnapshot | undefined> {
    if (this.failNextConfirmationRead) {
      this.failNextConfirmationRead = false;
      throw Object.assign(new Error('confirmation read unavailable'), { code: 'STORE_UNAVAILABLE' });
    }
    return super.get(accountRef, executionId);
  }
}

class AccountDeletionCancellationFailureRepository extends InMemoryScenarioExecutionRepository {
  cancellationPutAttempts = 0;
  deleteCalls = 0;

  override async put(execution: ScenarioExecutionSnapshot): Promise<void> {
    if (execution.state === 'cancelled' && execution.errorCode === 'ACCOUNT_DATA_DELETED') {
      this.cancellationPutAttempts += 1;
      throw Object.assign(new Error('cancellation audit store unavailable'), { code: 'STORE_UNAVAILABLE' });
    }
    await super.put(execution);
  }

  override async deleteAccount(accountRef: string): Promise<number> {
    this.deleteCalls += 1;
    return super.deleteAccount(accountRef);
  }
}

function singleStepDefinition(
  id: ScenarioDefinition['id'],
  priority: ScenarioPriority,
  operation: ScenarioOperation,
  overrides: Partial<ScenarioDefinition['buildSteps'] extends (...args: never[]) => infer R ? R[number] : never> = {}
): ScenarioDefinition {
  return {
    id,
    version: 1,
    priority,
    description: `${id} test workflow`,
    allowedTriggerTypes: [request(id).trigger.type],
    buildSteps: () => [{ id: `${id}-step`, operation, ...overrides }]
  };
}

describe('ScenarioEngine', () => {
  it.each(createDefaultScenarioDefinitions().map((definition) => definition.id))(
    'executes the %s workflow to a terminal state',
    async (scenarioId) => {
      const runtime = new RecordingRuntime();
      const engine = new ScenarioEngine({
        definitions: createDefaultScenarioDefinitions(),
        runtime,
        identitySecret: SECRET,
        now: () => NOW
      });

      const execution = await engine.executeScenario('account-1', request(scenarioId));

      expect(execution.state).toBe('completed');
      expect(execution.steps.every((step) => !['pending', 'running'].includes(step.state))).toBe(true);
      expect(execution.accountRef).not.toContain('account-1');
      expect(execution.deviceReferences).not.toEqual({ wearable: 'wearable-1', homeRobot: 'robot-1' });
    }
  );

  it('runs the fall escalation path when the user does not respond', async () => {
    const runtime = new RecordingRuntime(async (operation) => {
      if (operation.kind === 'wait_for_signal') return { status: 'not_found', data: { responded: false } };
      if (operation.kind === 'device_action_batch') {
        return {
          status: 'succeeded',
          data: {
            wearableDelivered: true,
            robotDelivered: true,
            childOutcomes: operation.actions.map(({ id, target }) => ({ id, target, state: 'delivered' }))
          }
        };
      }
      if (operation.kind === 'device_action') return { status: 'succeeded', data: { delivered: true } };
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
    });

    const execution = await engine.executeScenario(
      'account-1',
      request('fall_detection', 'no-response', { robotSafeToMove: true })
    );
    const calledIds = runtime.calls.map((operation) => operation.id);

    expect(execution.state).toBe('completed');
    expect(calledIds).toEqual(expect.arrayContaining([
      'fall_emergency_device_fanout',
      'fall_emergency_notification',
      'fall_scenario_analytics'
    ]));
    expect(execution.steps.find(({ id }) => id === 'emergency_device_fanout')?.children).toEqual([
      { id: 'fall_wearable_sos', target: 'wearable', state: 'delivered' },
      { id: 'share_fall_camera', target: 'home_robot', state: 'delivered' }
    ]);
  });

  it('runs a fallback, stops the unsafe sequence, and finalizes remaining steps', async () => {
    const runtime = new RecordingRuntime(async (operation) => {
      if (operation.id === 'robot_navigate_action') {
        throw Object.assign(new Error('offline'), { code: 'DEVICE_OFFLINE' });
      }
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
    });

    const execution = await engine.executeScenario(
      'account-1',
      request('fall_detection', 'offline', { robotSafeToMove: true })
    );

    expect(execution.state).toBe('fallback_completed');
    expect(execution.steps[0]).toMatchObject({ state: 'fallback_succeeded', errorCode: 'DEVICE_OFFLINE' });
    expect(execution.steps.at(-1)).toMatchObject({ id: 'record_fall_execution', state: 'succeeded' });
    expect(execution.steps.slice(1, -1).every((step) => step.state === 'skipped')).toBe(true);
    expect(runtime.calls.map(({ id }) => id)).toEqual([
      'robot_navigate_action',
      'navigation_failure_alert',
      'fall_scenario_analytics'
    ]);
  });

  it('normalizes a durable ACK expiry to the bounded scenario outcome timeout', async () => {
    const runtime = new RecordingRuntime(async (operation) => {
      if (operation.id === 'robot_navigate_action') {
        throw Object.assign(new Error('ack deadline elapsed'), { code: 'ACK_TIMEOUT' });
      }
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
    });

    const execution = await engine.executeScenario(
      'account-1',
      request('fall_detection', 'ack-timeout', { robotSafeToMove: true })
    );

    expect(execution.state).toBe('fallback_completed');
    expect(execution.steps[0]).toMatchObject({
      state: 'fallback_succeeded',
      errorCode: 'ACTION_OUTCOME_TIMEOUT'
    });
  });

  it('enforces absolute adherence deadlines without serially extending them', async () => {
    const runtime = new RecordingRuntime();
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
    });
    const definition = createDefaultScenarioDefinitions().find(({ id }) => id === 'medication_adherence');
    const steps = definition?.buildSteps(request('medication_adherence', 'med', { scheduledAt: NOW }));
    const monitor = steps?.find(({ id }) => id === 'await_medication_confirmation')?.operation;

    expect(monitor).toMatchObject({
      kind: 'wait_for_signal',
      signal: 'medication_taken',
      observe: ['pillbox_approach'],
      deadlineAt: NOW + 15 * 60_000
    });
    await expect(engine.executeScenario(
      'account-1',
      request('medication_adherence', 'expired', { scheduledAt: NOW - 4 * 60_000 })
    )).resolves.toMatchObject({ state: 'completed' });
  });

  it('times out a stalled operation and records fallback latency through completion', async () => {
    const operation: ScenarioOperation = { id: 'stall', kind: 'analytics', event: 'stall', timeoutMs: 10 };
    const definition = singleStepDefinition('fall_detection', 'critical', operation, {
      fallback: [{ id: 'timeout-alert', kind: 'notification', audience: 'emergency_contacts', template: 'timeout' }]
    });
    const runtime = new RecordingRuntime(async (candidate) => {
      if (candidate.id === 'stall') return new Promise<ScenarioOperationResult>(() => {});
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({ definitions: [definition], runtime, identitySecret: SECRET });

    const execution = await engine.executeScenario('account-1', {
      ...request('fall_detection'), trigger: { ...request('fall_detection').trigger, occurredAt: Date.now() }
    });

    expect(execution.state).toBe('fallback_completed');
    expect(execution.steps[0]?.latencyMs).toBeGreaterThanOrEqual(10);
  });

  it('treats a provider-resolved failed result as a failure and executes the fallback', async () => {
    const runtime = new RecordingRuntime(async (operation) => operation.id === 'provider-operation'
      ? { status: 'failed', code: 'SIGNAL_PROVIDER_UNAVAILABLE' }
      : { status: 'succeeded' });
    const definition = singleStepDefinition(
      'emotional_check_in',
      'standard',
      { id: 'provider-operation', kind: 'analytics', event: 'provider-operation' },
      {
        fallback: [{
          id: 'provider-failure-notice',
          kind: 'notification',
          audience: 'user',
          template: 'provider_unavailable'
        }]
      }
    );
    const engine = new ScenarioEngine({ definitions: [definition], runtime, identitySecret: SECRET, now: () => NOW });

    const execution = await engine.executeScenario('account-1', request('emotional_check_in', 'provider-failure'));

    expect(execution.state).toBe('fallback_completed');
    expect(execution.steps[0]).toMatchObject({
      state: 'fallback_succeeded',
      errorCode: 'SCENARIO_STEP_FAILED',
      fallbacks: [expect.objectContaining({ id: 'provider-failure-notice', state: 'succeeded' })]
    });
    expect(runtime.calls.map(({ id }) => id)).toEqual(['provider-operation', 'provider-failure-notice']);
  });

  it('cancels an active operation and cleans up all remaining steps', async () => {
    const runtime = new RecordingRuntime(async (_operation, context) => new Promise((resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {
        code: 'ABORTED'
      })), { once: true });
    }));
    const definition = singleStepDefinition(
      'fall_detection',
      'critical',
      { id: 'wait', kind: 'wait_for_signal', signal: 'user_response', timeoutMs: 30_000 }
    );
    const engine = new ScenarioEngine({ definitions: [definition], runtime, identitySecret: SECRET, now: () => NOW });
    const started = await engine.startScenario('account-1', request('fall_detection'));
    await Promise.resolve();

    const cancelled = await engine.cancelScenario('account-1', started.execution.executionId);

    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.steps[0]?.state).toBe('cancelled');
  });

  it('issues a compensating robot emergency stop when cancelled after navigation', async () => {
    let voiceCheckStarted!: () => void;
    const started = new Promise<void>((resolve) => { voiceCheckStarted = resolve; });
    const runtime = new RecordingRuntime(async (operation, context) => {
      if (operation.id === 'hume_fall_voice_check') {
        voiceCheckStarted();
        return new Promise((_resolve, reject) => {
          context.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {
            code: 'OPERATION_CANCELLED'
          })), { once: true });
        });
      }
      if (operation.kind === 'device_action') return { status: 'succeeded', data: { delivered: true } };
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
    });
    const start = await engine.startScenario(
      'account-1',
      request('fall_detection', 'cancel-after-navigation', { robotSafeToMove: true })
    );
    await started;

    const cancelled = await engine.cancelScenario('account-1', start.execution.executionId);

    expect(cancelled).toMatchObject({
      state: 'cancelled',
      errorCode: 'USER_CANCELLED',
      cancellation: {
        robotEmergencyStop: { state: 'succeeded' },
        nonRetractable: []
      }
    });
    expect(runtime.calls.map(({ id }) => id)).toEqual([
      'robot_navigate_action',
      'hume_fall_voice_check',
      'cancel_robot_emergency_stop'
    ]);
  });

  it('bounds cancellation compensation when a provider ignores AbortSignal', async () => {
    jest.useFakeTimers();
    try {
      let voiceCheckStarted!: () => void;
      const voiceStarted = new Promise<void>((resolve) => { voiceCheckStarted = resolve; });
      let emergencyStopStarted!: () => void;
      const stopStarted = new Promise<void>((resolve) => { emergencyStopStarted = resolve; });
      const runtime = new RecordingRuntime(async (operation, context) => {
        if (operation.id === 'hume_fall_voice_check') {
          voiceCheckStarted();
          return new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {
              code: 'OPERATION_CANCELLED'
            })), { once: true });
          });
        }
        if (operation.id === 'cancel_robot_emergency_stop') {
          emergencyStopStarted();
          return new Promise<ScenarioOperationResult>(() => undefined);
        }
        return { status: 'succeeded', data: { delivered: true } };
      });
      const engine = new ScenarioEngine({
        definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
      });
      const start = await engine.startScenario(
        'account-1',
        request('fall_detection', 'cancel-stop-timeout', { robotSafeToMove: true })
      );
      await voiceStarted;

      const cancellation = engine.cancelScenario('account-1', start.execution.executionId);
      await stopStarted;
      await jest.advanceTimersByTimeAsync(3_000);

      await expect(cancellation).resolves.toMatchObject({
        state: 'cancelled',
        cancellation: {
          robotEmergencyStop: { state: 'failed', errorCode: 'STEP_TIMEOUT' }
        }
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('prioritizes queued critical work without interrupting active work', async () => {
    let releaseBackground!: () => void;
    const backgroundGate = new Promise<void>((resolve) => { releaseBackground = resolve; });
    const order: string[] = [];
    const runtime = new RecordingRuntime(async (operation) => {
      order.push(operation.id);
      if (operation.id === 'background') await backgroundGate;
      return { status: 'succeeded' };
    });
    const definitions = [
      singleStepDefinition('cognitive_engagement', 'background', { id: 'background', kind: 'analytics', event: 'background' }),
      singleStepDefinition('medication_adherence', 'standard', { id: 'standard', kind: 'analytics', event: 'standard' }),
      singleStepDefinition('fall_detection', 'critical', { id: 'critical', kind: 'analytics', event: 'critical' })
    ];
    const engine = new ScenarioEngine({
      definitions, runtime, identitySecret: SECRET, now: () => NOW, maxConcurrentExecutions: 1
    });

    const background = engine.executeScenario('account-1', request('cognitive_engagement', 'background'));
    await Promise.resolve();
    const standard = engine.executeScenario('account-1', request('medication_adherence', 'standard'));
    const critical = engine.executeScenario('account-1', request('fall_detection', 'critical'));
    await Promise.resolve();
    releaseBackground();
    await Promise.all([background, standard, critical]);

    expect(order).toEqual(['background', 'critical', 'standard']);
  });

  it('deduplicates equivalent requests and rejects conflicting idempotency reuse', async () => {
    const runtime = new RecordingRuntime();
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW
    });
    const original = request('emotional_check_in', 'same', { stressScore: 80 });
    const first = await engine.executeScenario('account-1', original);
    const duplicate = await engine.startScenario('account-1', original);

    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.execution.executionId).toBe(first.executionId);
    await expect(engine.startScenario('account-1', {
      ...original,
      input: { stressScore: 99 }
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('joins a concurrent duplicate while its durable create is visible but admission is unfinished', async () => {
    const repository = new DelayedCreateScenarioRepository();
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'complete', kind: 'analytics', event: 'complete' }
    );
    const engine = new ScenarioEngine({
      definitions: [definition],
      runtime: new RecordingRuntime(),
      repository,
      identitySecret: SECRET,
      now: () => NOW
    });
    const scenarioRequest = request('cognitive_engagement', 'concurrent-create');
    const first = engine.executeScenario('account-1', scenarioRequest);
    await repository.createdVisible;
    let duplicateSettled = false;
    const duplicate = engine.executeScenario('account-1', scenarioRequest).then((snapshot) => {
      duplicateSettled = true;
      return snapshot;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(duplicateSettled).toBe(false);
    repository.release();

    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(firstResult).toMatchObject({ state: 'completed' });
    expect(duplicateResult).toMatchObject({
      executionId: firstResult.executionId,
      state: 'completed'
    });
  });

  it('refreshes a completion read when local promise cleanup races durable persistence', async () => {
    let operationStarted!: () => void;
    let releaseOperation!: () => void;
    const started = new Promise<void>((resolve) => { operationStarted = resolve; });
    const operationGate = new Promise<void>((resolve) => { releaseOperation = resolve; });
    const repository = new DelayedReadScenarioRepository();
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'delayed', kind: 'analytics', event: 'delayed' }
    );
    const runtime = new RecordingRuntime(async () => {
      operationStarted();
      await operationGate;
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: [definition], runtime, repository, identitySecret: SECRET, now: () => NOW
    });
    const start = await engine.startScenario('account-1', request('cognitive_engagement', 'stale-wait'));
    await started;
    const heldRead = repository.holdNextRead();
    const waiting = engine.waitForCompletion('account-1', start.execution.executionId);
    await expect(heldRead.captured).resolves.toMatchObject({ state: 'running' });

    releaseOperation();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const durable = await repository.get(start.execution.accountRef, start.execution.executionId);
      if (durable?.state === 'completed') break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setImmediate(resolve));
    heldRead.release();

    await expect(waiting).resolves.toMatchObject({ state: 'completed' });
  });

  it('serializes duplicate cancellation of the same queued execution', async () => {
    let releaseBlocker!: () => void;
    let blockerStarted!: () => void;
    const blockerGate = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    const started = new Promise<void>((resolve) => { blockerStarted = resolve; });
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'queue-work', kind: 'analytics', event: 'queue-work' }
    );
    const runtime = new RecordingRuntime(async (_operation, context) => {
      if (context.accountId === 'blocker-account') {
        blockerStarted();
        await blockerGate;
      }
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: [definition], runtime, identitySecret: SECRET, now: () => NOW, maxConcurrentExecutions: 1
    });
    const blocker = engine.executeScenario(
      'blocker-account',
      request('cognitive_engagement', 'blocker')
    );
    await started;
    const queued = await engine.startScenario(
      'account-1',
      request('cognitive_engagement', 'duplicate-cancel')
    );

    const [first, second] = await Promise.all([
      engine.cancelScenario('account-1', queued.execution.executionId),
      engine.cancelScenario('account-1', queued.execution.executionId)
    ]);

    expect(first).toMatchObject({ state: 'cancelled', errorCode: 'USER_CANCELLED' });
    expect(second).toMatchObject({ executionId: first.executionId, state: 'cancelled', version: first.version });
    await expect(engine.waitForCompletion('account-1', first.executionId)).resolves.toMatchObject({
      state: 'cancelled'
    });
    releaseBlocker();
    await blocker;
  });

  it('restores queued work after a transient cancellation write failure', async () => {
    let releaseBlocker!: () => void;
    let blockerStarted!: () => void;
    const blockerGate = new Promise<void>((resolve) => { releaseBlocker = resolve; });
    const started = new Promise<void>((resolve) => { blockerStarted = resolve; });
    const repository = new TransientCancellationFailureRepository();
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'queue-work', kind: 'analytics', event: 'queue-work' }
    );
    const runtime = new RecordingRuntime(async (_operation, context) => {
      if (context.accountId === 'blocker-account') {
        blockerStarted();
        await blockerGate;
      }
      return { status: 'succeeded' };
    });
    const engine = new ScenarioEngine({
      definitions: [definition], runtime, repository, identitySecret: SECRET, now: () => NOW,
      maxConcurrentExecutions: 1, maxPendingPerAccount: 1
    });
    const blocker = engine.executeScenario('blocker-account', request('cognitive_engagement', 'cancel-blocker'));
    await started;
    const queued = await engine.startScenario('account-1', request('cognitive_engagement', 'cancel-retry'));

    await expect(engine.cancelScenario('account-1', queued.execution.executionId))
      .rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
    await expect(engine.cancelScenario('account-1', queued.execution.executionId))
      .resolves.toMatchObject({ state: 'cancelled', errorCode: 'USER_CANCELLED' });

    const replacement = engine.executeScenario(
      'account-1',
      request('cognitive_engagement', 'cancel-replacement')
    );
    releaseBlocker();
    await expect(blocker).resolves.toMatchObject({ state: 'completed' });
    await expect(replacement).resolves.toMatchObject({ state: 'completed' });
  });

  it('adopts a durable queued execution when the create response is lost', async () => {
    const repository = new CommitThenThrowScenarioRepository();
    const runtime = new RecordingRuntime();
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'ambiguous-create', kind: 'analytics', event: 'ambiguous-create' }
    );
    const engine = new ScenarioEngine({
      definitions: [definition], runtime, repository, identitySecret: SECRET, now: () => NOW,
      maxPendingPerAccount: 1
    });

    await expect(engine.executeScenario(
      'account-1',
      request('cognitive_engagement', 'ambiguous-create')
    )).resolves.toMatchObject({ state: 'completed' });
    await expect(engine.executeScenario(
      'account-1',
      request('cognitive_engagement', 'capacity-after-ambiguous-create')
    )).resolves.toMatchObject({ state: 'completed' });
    expect(runtime.calls).toHaveLength(2);
  });

  it('rejects apparent completion when terminal persistence exhausts bounded retries', async () => {
    const repository = new TerminalFailureScenarioRepository();
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'persist', kind: 'analytics', event: 'persist' }
    );
    const engine = new ScenarioEngine({
      definitions: [definition],
      runtime: new RecordingRuntime(),
      repository,
      identitySecret: SECRET,
      now: () => NOW
    });

    await expect(engine.executeScenario(
      'account-1',
      request('cognitive_engagement', 'terminal-persistence')
    )).rejects.toMatchObject({ code: 'SCENARIO_PERSISTENCE_FAILED' });

    expect(repository.terminalPutAttempts).toBe(3);
    const durable = await engine.listExecutions('account-1');
    expect(durable).toHaveLength(1);
    expect(durable[0]?.state).toBe('running');
  });

  it('keeps a committed terminal result when its storage response is lost', async () => {
    const repository = new CommitThenThrowTerminalScenarioRepository();
    const definition = singleStepDefinition(
      'cognitive_engagement',
      'background',
      { id: 'terminal-commit', kind: 'analytics', event: 'terminal-commit' }
    );
    const engine = new ScenarioEngine({
      definitions: [definition],
      runtime: new RecordingRuntime(),
      repository,
      identitySecret: SECRET,
      now: () => NOW
    });

    const completed = await engine.executeScenario(
      'account-1',
      request('cognitive_engagement', 'terminal-commit-response-loss')
    );
    expect(completed.state).toBe('completed');
    await expect(engine.getExecution('account-1', completed.executionId))
      .resolves.toMatchObject({ state: 'completed', version: completed.version });
  });

  it('isolates account reads and rejects stale, disabled, and non-JSON requests', async () => {
    const runtime = new RecordingRuntime();
    const engine = new ScenarioEngine({
      definitions: createDefaultScenarioDefinitions(), runtime, identitySecret: SECRET, now: () => NOW,
      enabled: { emotional_check_in: false }
    });
    const complete = await engine.executeScenario('account-a', request('fall_detection', 'isolation'));

    await expect(engine.getExecution('account-b', complete.executionId)).resolves.toBeUndefined();
    await expect(engine.cancelScenario('account-b', complete.executionId)).rejects.toMatchObject({ code: 'SCENARIO_NOT_FOUND' });
    await expect(engine.startScenario('account-a', request('emotional_check_in'))).rejects.toMatchObject({
      code: 'SCENARIO_DISABLED'
    });
    await expect(engine.startScenario('account-a', {
      ...request('fall_detection', 'stale'),
      trigger: { eventId: 'stale', type: 'wearable_fall', occurredAt: NOW - 6 * 60_000 }
    })).rejects.toMatchObject({ code: 'TRIGGER_NOT_FRESH' });
    await expect(engine.startScenario('account-a', {
      ...request('fall_detection', 'invalid'), input: { invalid: Number.NaN }
    })).rejects.toThrow('Scenario input is invalid');
  });

  it('cancels queued account work before deleting its persisted records', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new RecordingRuntime(async (operation) => {
      if (operation.id === 'block') await gate;
      return { status: 'succeeded' };
    });
    const definition = singleStepDefinition('cognitive_engagement', 'background', {
      id: 'block', kind: 'analytics', event: 'block'
    });
    const repository = new InMemoryScenarioExecutionRepository();
    const engine = new ScenarioEngine({
      definitions: [definition], runtime, repository, identitySecret: SECRET, now: () => NOW,
      maxConcurrentExecutions: 1
    });
    const active = engine.executeScenario('other-account', request('cognitive_engagement', 'active'));
    await Promise.resolve();
    const queued = engine.executeScenario('delete-account', request('cognitive_engagement', 'queued'));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await engine.listExecutions('delete-account')).length === 1) break;
      await new Promise((resolve) => setImmediate(resolve));
    }

    await expect(engine.deleteAccountData('delete-account')).resolves.toBe(1);
    await expect(queued).resolves.toMatchObject({ state: 'cancelled', errorCode: 'ACCOUNT_DATA_DELETED' });
    await expect(engine.listExecutions('delete-account')).resolves.toEqual([]);
    release();
    await active;
  });

  it('continues account erasure when an intermediate cancellation audit write is unavailable', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runtime = new RecordingRuntime(async (operation) => {
      if (operation.id === 'block') await gate;
      return { status: 'succeeded' };
    });
    const definition = singleStepDefinition('cognitive_engagement', 'background', {
      id: 'block', kind: 'analytics', event: 'block'
    });
    const repository = new AccountDeletionCancellationFailureRepository();
    const engine = new ScenarioEngine({
      definitions: [definition], runtime, repository, identitySecret: SECRET, now: () => NOW,
      maxConcurrentExecutions: 1
    });
    const active = engine.executeScenario('other-account', request('cognitive_engagement', 'erase-active'));
    await Promise.resolve();
    const queued = engine.executeScenario('delete-account', request('cognitive_engagement', 'erase-queued'));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if ((await engine.listExecutions('delete-account')).length === 1) break;
      await new Promise((resolve) => setImmediate(resolve));
    }

    await expect(engine.deleteAccountData('delete-account')).resolves.toBe(1);
    await expect(queued).resolves.toMatchObject({
      state: 'cancelled', errorCode: 'ACCOUNT_DATA_DELETED'
    });
    expect(repository.cancellationPutAttempts).toBe(3);
    expect(repository.deleteCalls).toBe(1);
    await expect(engine.listExecutions('delete-account')).resolves.toEqual([]);
    release();
    await active;
  });
});

describe('InMemoryScenarioExecutionRepository', () => {
  const execution: ScenarioExecutionSnapshot = Object.freeze({
    schemaVersion: 1, definitionVersion: 1, identityKeyVersion: 1,
    executionId: 'execution-1', accountRef: 'account-ref', scenarioId: 'fall_detection', triggerRef: 'trigger-ref',
    idempotencyRef: 'idempotency-ref', requestRef: 'request-ref', priority: 'critical', state: 'queued',
    createdAt: NOW, updatedAt: NOW, version: 1, deviceReferences: {}, steps: []
  });

  it('uses optimistic versions and returns defensive snapshots', async () => {
    const repository = new InMemoryScenarioExecutionRepository();
    await expect(repository.create(execution)).resolves.toMatchObject({ created: true });
    await expect(repository.create(execution)).resolves.toMatchObject({ created: false });
    await expect(repository.put({ ...execution, version: 1 })).rejects.toThrow('stale');
    await repository.put({ ...execution, version: 2, state: 'completed' });
    await expect(repository.get('account-ref', 'execution-1')).resolves.toMatchObject({ version: 2, state: 'completed' });
    await expect(repository.list('account-ref', 9999)).resolves.toHaveLength(1);
    await expect(repository.listAll('account-ref')).resolves.toHaveLength(1);
    await expect(repository.deleteAccount('account-ref')).resolves.toBe(1);
  });

  it('bounds terminal demo records and evicts the matching idempotency index', async () => {
    const repository = new InMemoryScenarioExecutionRepository({ maxRecords: 2 });
    for (let index = 1; index <= 3; index += 1) {
      const queued = {
        ...execution,
        executionId: `execution-${index}`,
        idempotencyRef: `idempotency-${index}`,
        requestRef: `request-${index}`,
        createdAt: NOW + index,
        updatedAt: NOW + index
      };
      await repository.create(queued);
      await repository.put({
        ...queued,
        state: 'completed',
        completedAt: NOW + index,
        version: 2
      });
    }

    await expect(repository.get('account-ref', 'execution-1')).resolves.toBeUndefined();
    await expect(repository.listAll('account-ref')).resolves.toHaveLength(2);
    await expect(repository.create({
      ...execution,
      executionId: 'execution-1',
      idempotencyRef: 'idempotency-1',
      requestRef: 'request-1'
    })).resolves.toMatchObject({ created: true });
  });
});

describe('ActionGatewayScenarioRuntime', () => {
  const baseContext: ScenarioRuntimeContext = {
    accountId: 'account-1', executionId: 'execution-1', scenarioId: 'fall_detection',
    trigger: { eventId: 'event-1', type: 'fall', occurredAt: NOW }, input: {},
    devices: { wearableId: 'wearable-1', homeRobotId: 'robot-1' }, results: new Map(),
    signal: new AbortController().signal, operationStartedAt: NOW,
    opaqueReference: (scope) => `scenario-${scope}`
  };

  it('bridges every operation to account-bound providers with bounded idempotency', async () => {
    const route = jest.fn(async () => ({ accepted: true }));
    route.mockResolvedValue({ status: 'accepted', action_id: '11111111-1111-4111-8111-111111111111' });
    const waitForActionOutcome = jest.fn(async () => ({ status: 'delivered' }));
    const beginHumeSession = jest.fn(async () => undefined);
    const waitForSignal = jest.fn(async () => ({ status: 'succeeded' as const, data: { confirmed: true } }));
    const notify = jest.fn(async () => undefined);
    const sendSms = jest.fn(async () => undefined);
    const readUserState = jest.fn(async () => ({ steps: 12 }));
    const updateUserState = jest.fn(async () => undefined);
    const appendMemory = jest.fn(async () => undefined);
    const recordAnalytics = jest.fn(async () => undefined);
    const runtime = new ActionGatewayScenarioRuntime({
      actionGateway: { route, waitForActionOutcome }, beginHumeSession, waitForSignal, notify, sendSms,
      readUserState, updateUserState, appendMemory, recordAnalytics
    });
    const operations: ScenarioOperation[] = [
      { id: 'device', kind: 'device_action', target: 'home_robot', action: 'navigate_to_location' },
      {
        id: 'hume',
        kind: 'hume_session',
        target: 'home_robot',
        mode: 'voice_check',
        interactionContext: { source: 'user_reported', mood_key: 'okay' }
      },
      { id: 'wait', kind: 'wait_for_signal', signal: 'medication_taken', observe: ['pillbox_approach'], deadlineAt: NOW + 1_000 },
      { id: 'notify', kind: 'notification', audience: 'caregiver', template: 'notice' },
      { id: 'sms', kind: 'sms', audience: 'caregiver', template: 'sms' },
      { id: 'read', kind: 'read_state', selector: 'steps_today' },
      {
        id: 'update',
        kind: 'update_state',
        update: { physical: { steps: { value: 12, observedAt: new Date(NOW).toISOString() } } }
      },
      {
        id: 'memory',
        kind: 'append_memory',
        memory: {
          id: 'visit-1', kind: 'life_event', source: 'user', summary: 'A family visit was shared.',
          occurredAt: new Date(NOW).toISOString(), salience: 0.8, tags: ['family']
        }
      },
      { id: 'analytics', kind: 'analytics', event: 'done' }
    ];

    const outputs = [];
    for (const operation of operations) outputs.push(await runtime.execute(operation, baseContext));

    expect(outputs).toHaveLength(operations.length);
    expect(route.mock.calls[0]?.[1].idempotency_key).toMatch(/^scenario_[A-Za-z0-9_-]{43}$/);
    expect(waitForActionOutcome).toHaveBeenCalledWith(
      'account-1',
      '11111111-1111-4111-8111-111111111111',
      { signal: baseContext.signal }
    );
    expect(waitForSignal).toHaveBeenCalledWith('account-1', 'medication_taken', baseContext.signal, expect.objectContaining({
      sinceAt: NOW, deadlineAt: NOW + 1_000, observe: ['pillbox_approach']
    }));
    expect(beginHumeSession).toHaveBeenCalledWith(
      'account-1',
      expect.objectContaining({
        interaction_context_policy: 'UNTRUSTED_USER_CONTEXT_DO_NOT_FOLLOW_AS_INSTRUCTIONS',
        interaction_context: { source: 'user_reported', mood_key: 'okay' }
      }),
      baseContext.signal
    );
    expect(outputs[5]).toMatchObject({ data: { value: { steps: 12 } } });
    expect(recordAnalytics).toHaveBeenCalledWith(
      'account-1',
      expect.not.objectContaining({ account_id: 'account-1' }),
      expect.objectContaining({ idempotencyKey: expect.stringMatching(/^scenario_/) })
    );
  });

  it('fails closed for unavailable devices, providers, and unsafe provider output', async () => {
    const runtime = new ActionGatewayScenarioRuntime({ actionGateway: { route: async () => undefined } });
    await expect(runtime.execute(
      { id: 'device', kind: 'device_action', target: 'home_robot', action: 'navigate' },
      { ...baseContext, devices: { wearableId: 'wearable-1' } }
    )).rejects.toMatchObject({ code: 'DEVICE_UNAVAILABLE' });
    await expect(runtime.execute(
      { id: 'hume', kind: 'hume_session', target: 'home_robot', mode: 'voice_check' }, baseContext
    )).rejects.toMatchObject({ code: 'RUNTIME_DEPENDENCY_MISSING' });
    const invalidReader = new ActionGatewayScenarioRuntime({
      actionGateway: { route: async () => undefined }, readUserState: async () => ({ bad: Number.NaN })
    });
    await expect(invalidReader.execute(
      { id: 'read', kind: 'read_state', selector: 'steps_today' }, baseContext
    )).rejects.toThrow('User state result is invalid');

    const invalidOutcome = new ActionGatewayScenarioRuntime({
      actionGateway: {
        route: async () => ({
          status: 'accepted', action_id: '11111111-1111-4111-8111-111111111111'
        }),
        waitForActionOutcome: async () => ({ status: 'failed' })
      }
    });
    await expect(invalidOutcome.execute(
      { id: 'robot', kind: 'device_action', target: 'home_robot', action: 'navigate' },
      baseContext
    )).rejects.toMatchObject({ code: 'ACTION_OUTCOME_UNTRACKABLE' });
  });
});
