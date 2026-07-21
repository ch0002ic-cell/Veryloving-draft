import { createHash, createHmac } from 'node:crypto';
import type { MemoryInput } from '../memory/MemoryNet';
import type { UserStateUpdate } from '../models/UserState';

export type ScenarioId =
  | 'fall_detection'
  | 'medication_adherence'
  | 'emotional_check_in'
  | 'cognitive_engagement'
  | 'ai_angel_auto_dial';

export type ScenarioPriority = 'critical' | 'standard' | 'background';
export type ScenarioExecutionState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'fallback_completed'
  | 'failed'
  | 'cancelled';
export type ScenarioStepState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'fallback_succeeded'
  | 'cancelled'
  | 'skipped';

export type ScenarioJson =
  | string
  | number
  | boolean
  | null
  | readonly ScenarioJson[]
  | { readonly [key: string]: ScenarioJson };

export interface ScenarioTrigger {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: number;
  /** Ephemeral input. It is never persisted in execution records. */
  readonly data?: Readonly<Record<string, ScenarioJson>>;
}

export interface ScenarioDeviceTargets {
  readonly wearableId?: string;
  readonly homeRobotId?: string;
}

export interface ScenarioStartRequest {
  readonly scenarioId: ScenarioId;
  readonly trigger: ScenarioTrigger;
  readonly devices: ScenarioDeviceTargets;
  /** Stable caller identity reused after network response loss. */
  readonly idempotencyKey: string;
  /** Ephemeral workflow input. It is never persisted in execution records. */
  readonly input?: Readonly<Record<string, ScenarioJson>>;
}

interface BaseOperation {
  readonly id: string;
  readonly timeoutMs?: number;
  /** Optional shared provider dedupe scope for semantically identical fallbacks. */
  readonly idempotencyScope?: string;
}

export interface DeviceActionOperation extends BaseOperation {
  readonly kind: 'device_action';
  readonly target: 'wearable' | 'home_robot';
  readonly action: string;
  readonly parameters?: Readonly<Record<string, ScenarioJson>>;
  /** Server-secret-scoped camera session inserted as parameters.session_id. */
  readonly cameraSessionScope?: string;
}

export interface HumeSessionOperation extends BaseOperation {
  readonly kind: 'hume_session';
  readonly target: 'wearable' | 'home_robot';
  readonly mode: 'voice_check' | 'calming' | 'cognitive_game' | 'emergency_call';
}

export interface WaitForSignalOperation extends BaseOperation {
  readonly kind: 'wait_for_signal';
  readonly signal: 'user_response' | 'pillbox_approach' | 'medication_taken' | 'caregiver_ack';
  /** Additional signals collected by the provider without serially extending the deadline. */
  readonly observe?: readonly WaitForSignalOperation['signal'][];
  /** Absolute wall-clock deadline used to preserve safety escalation windows. */
  readonly deadlineAt?: number;
  /** Late phases must not consume a signal already used by an earlier phase. */
  readonly replayFrom?: 'trigger' | 'operation_start';
}

export interface DeviceActionBatchOperation extends BaseOperation {
  readonly kind: 'device_action_batch';
  readonly actions: readonly DeviceActionOperation[];
}

export interface NotificationOperation extends BaseOperation {
  readonly kind: 'notification';
  readonly audience: 'user' | 'caregiver' | 'emergency_contacts';
  readonly template: string;
  readonly includeLocation?: boolean;
  readonly includeCameraLink?: boolean;
  /** Opaque, server-resolved media session reference; never a public URL. */
  readonly cameraSessionScope?: string;
}

export interface SmsOperation extends BaseOperation {
  readonly kind: 'sms';
  readonly audience: 'caregiver' | 'emergency_contacts';
  readonly template: string;
  readonly includeLocation?: boolean;
}

export interface ReadStateOperation extends BaseOperation {
  readonly kind: 'read_state';
  readonly selector: 'steps_today' | 'last_location' | 'medication_adherence' | 'stress_trend';
}

export interface UpdateStateOperation extends BaseOperation {
  readonly kind: 'update_state';
  readonly update: UserStateUpdate | ((context: ScenarioConditionContext) => UserStateUpdate);
}

export interface AppendMemoryOperation extends BaseOperation {
  readonly kind: 'append_memory';
  readonly memory: MemoryInput | ((context: ScenarioConditionContext) => MemoryInput);
}

export interface AnalyticsOperation extends BaseOperation {
  readonly kind: 'analytics';
  readonly event: string;
}

export type ScenarioOperation =
  | DeviceActionOperation
  | DeviceActionBatchOperation
  | HumeSessionOperation
  | WaitForSignalOperation
  | NotificationOperation
  | SmsOperation
  | ReadStateOperation
  | UpdateStateOperation
  | AppendMemoryOperation
  | AnalyticsOperation;

export interface ScenarioOperationResult {
  readonly status: 'succeeded' | 'declined' | 'not_found' | 'failed';
  readonly code?: string;
  /** Ephemeral output available to later conditions, never persisted. */
  readonly data?: Readonly<Record<string, ScenarioJson>>;
}

export interface ScenarioConditionContext {
  readonly trigger: ScenarioTrigger;
  readonly input: Readonly<Record<string, ScenarioJson>>;
  readonly results: ReadonlyMap<string, ScenarioOperationResult>;
}

export interface ScenarioStepDefinition {
  readonly id: string;
  readonly operation: ScenarioOperation;
  readonly when?: (context: ScenarioConditionContext) => boolean;
  readonly fallback?: readonly ScenarioOperation[];
  readonly continueOnFailure?: boolean;
  readonly stopAfterFallback?: boolean;
  readonly stopAfterSuccess?: boolean;
  /** Runs after a terminal workflow branch for privacy-safe execution audit. */
  readonly alwaysRun?: boolean;
}

export interface ScenarioDefinition {
  readonly id: ScenarioId;
  readonly version: number;
  readonly priority: ScenarioPriority;
  readonly description: string;
  readonly allowedTriggerTypes: readonly string[];
  readonly buildSteps: (request: ScenarioStartRequest) => readonly ScenarioStepDefinition[];
}

export interface ScenarioStepSnapshot {
  readonly id: string;
  readonly operation: ScenarioOperation['kind'];
  readonly target?: 'wearable' | 'home_robot';
  readonly action?: string;
  readonly state: ScenarioStepState;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly latencyMs?: number;
  readonly errorCode?: string;
  readonly outcomeCode?: string;
  readonly fallbacks?: readonly Readonly<{
    id: string;
    operation: ScenarioOperation['kind'];
    state: 'succeeded' | 'failed';
    startedAt: number;
    completedAt: number;
    latencyMs: number;
    errorCode?: string;
    outcomeCode?: string;
  }>[];
  readonly children?: readonly Readonly<{
    id: string;
    target: 'wearable' | 'home_robot';
    state: 'delivered' | 'failed';
    errorCode?: string;
  }>[];
}

export interface ScenarioExecutionSnapshot {
  readonly schemaVersion: 1;
  readonly definitionVersion: number;
  readonly identityKeyVersion: number;
  readonly executionId: string;
  readonly accountRef: string;
  readonly scenarioId: ScenarioId;
  readonly triggerRef: string;
  readonly idempotencyRef: string;
  /** HMAC of the normalized request, used to reject idempotency-key payload conflicts. */
  readonly requestRef: string;
  readonly priority: ScenarioPriority;
  readonly state: ScenarioExecutionState;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly completedAt?: number;
  readonly version: number;
  readonly deviceReferences: Readonly<{
    wearable?: string;
    homeRobot?: string;
  }>;
  readonly steps: readonly ScenarioStepSnapshot[];
  readonly cancellation?: Readonly<{
    readonly requestedAt: number;
    readonly robotEmergencyStop?: Readonly<{
      readonly state: 'succeeded' | 'failed' | 'not_required';
      readonly completedAt: number;
      readonly errorCode?: string;
    }>;
    /** Already-delivered actions that cannot honestly be retracted. */
    readonly nonRetractable: readonly string[];
  }>;
  readonly errorCode?: string;
}

export interface ScenarioStartResult {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly execution: ScenarioExecutionSnapshot;
}

export interface ScenarioExecutionRepository {
  create(execution: ScenarioExecutionSnapshot): Promise<{
    readonly created: boolean;
    readonly execution: ScenarioExecutionSnapshot;
  }>;
  put(execution: ScenarioExecutionSnapshot): Promise<void>;
  get(accountRef: string, executionId: string): Promise<ScenarioExecutionSnapshot | undefined>;
  list(accountRef: string, limit?: number): Promise<readonly ScenarioExecutionSnapshot[]>;
  /** Exhaustive account export/recovery scan; production implementations paginate internally. */
  listAll(accountRef: string): Promise<readonly ScenarioExecutionSnapshot[]>;
  deleteAccount(accountRef: string): Promise<number>;
}

function cloneSnapshot(value: ScenarioExecutionSnapshot): ScenarioExecutionSnapshot {
  return Object.freeze({
    ...value,
    deviceReferences: Object.freeze({ ...value.deviceReferences }),
    ...(value.cancellation ? {
      cancellation: Object.freeze({
        ...value.cancellation,
        ...(value.cancellation.robotEmergencyStop
          ? { robotEmergencyStop: Object.freeze({ ...value.cancellation.robotEmergencyStop }) }
          : {}),
        nonRetractable: Object.freeze([...value.cancellation.nonRetractable])
      })
    } : {}),
    steps: Object.freeze(value.steps.map((step) => Object.freeze({
      ...step,
      ...(step.fallbacks
        ? { fallbacks: Object.freeze(step.fallbacks.map((fallback) => Object.freeze({ ...fallback }))) }
        : {}),
      ...(step.children
        ? { children: Object.freeze(step.children.map((child) => Object.freeze({ ...child }))) }
        : {})
    })))
  });
}

/** Test/development repository. Production supplies a durable implementation. */
export class InMemoryScenarioExecutionRepository implements ScenarioExecutionRepository {
  private readonly records = new Map<string, ScenarioExecutionSnapshot>();
  private readonly idempotency = new Map<string, string>();
  private readonly maxRecords: number;

  constructor(options: Readonly<{ maxRecords?: number }> = {}) {
    this.maxRecords = boundedInteger(options.maxRecords, 10_000, 1, 100_000, 'Scenario record capacity');
  }

  private key(accountRef: string, executionId: string): string {
    return `${accountRef}\u0000${executionId}`;
  }

  async create(execution: ScenarioExecutionSnapshot): Promise<{
    readonly created: boolean;
    readonly execution: ScenarioExecutionSnapshot;
  }> {
    const idempotencyKey = `${execution.accountRef}\u0000${execution.idempotencyRef}`;
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) {
      const existing = this.records.get(this.key(execution.accountRef, existingId));
      if (!existing) throw new Error('Scenario idempotency index is inconsistent');
      return Object.freeze({ created: false, execution: cloneSnapshot(existing) });
    }
    const stored = cloneSnapshot(execution);
    this.records.set(this.key(execution.accountRef, execution.executionId), stored);
    this.idempotency.set(idempotencyKey, execution.executionId);
    return Object.freeze({ created: true, execution: cloneSnapshot(stored) });
  }

  async put(execution: ScenarioExecutionSnapshot): Promise<void> {
    const key = this.key(execution.accountRef, execution.executionId);
    const previous = this.records.get(key);
    if (!previous) throw new Error('Scenario execution does not exist');
    if (execution.version <= previous.version) throw new Error('Scenario execution version is stale');
    this.records.set(key, cloneSnapshot(execution));
    if (terminal(execution.state)) this.evictOldestTerminalRecords();
  }

  async get(accountRef: string, executionId: string): Promise<ScenarioExecutionSnapshot | undefined> {
    const value = this.records.get(this.key(accountRef, executionId));
    return value ? cloneSnapshot(value) : undefined;
  }

  async list(accountRef: string, limit = 100): Promise<readonly ScenarioExecutionSnapshot[]> {
    const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
    return [...this.records.values()]
      .filter((entry) => entry.accountRef === accountRef)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, bounded)
      .map(cloneSnapshot);
  }

  async listAll(accountRef: string): Promise<readonly ScenarioExecutionSnapshot[]> {
    return [...this.records.values()]
      .filter((entry) => entry.accountRef === accountRef)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(cloneSnapshot);
  }

  async deleteAccount(accountRef: string): Promise<number> {
    let deleted = 0;
    for (const [key, value] of this.records) {
      if (value.accountRef !== accountRef) continue;
      this.records.delete(key);
      this.idempotency.delete(`${accountRef}\u0000${value.idempotencyRef}`);
      deleted += 1;
    }
    return deleted;
  }

  private evictOldestTerminalRecords(): void {
    if (this.records.size <= this.maxRecords) return;
    const candidates = [...this.records.entries()]
      .filter(([, execution]) => terminal(execution.state))
      .sort(([, left], [, right]) => (
        (left.completedAt ?? left.updatedAt) - (right.completedAt ?? right.updatedAt)
        || left.createdAt - right.createdAt
      ));
    for (const [key, execution] of candidates) {
      if (this.records.size <= this.maxRecords) break;
      this.records.delete(key);
      this.idempotency.delete(`${execution.accountRef}\u0000${execution.idempotencyRef}`);
    }
  }
}

export interface ScenarioRuntimeContext {
  readonly accountId: string;
  readonly executionId: string;
  readonly scenarioId: ScenarioId;
  readonly trigger: ScenarioTrigger;
  readonly input: Readonly<Record<string, ScenarioJson>>;
  readonly devices: ScenarioDeviceTargets;
  readonly results: ReadonlyMap<string, ScenarioOperationResult>;
  readonly signal: AbortSignal;
  readonly operationStartedAt: number;
  readonly opaqueReference: (scope: string) => string;
}

export interface ScenarioRuntime {
  execute(operation: ScenarioOperation, context: ScenarioRuntimeContext): Promise<ScenarioOperationResult>;
}

interface ActionGatewayLike {
  route(
    accountId: string,
    action: Readonly<Record<string, unknown>>,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<unknown>;
  waitForActionOutcome?: (
    accountId: string,
    actionId: string,
    options: Readonly<{ signal: AbortSignal }>
  ) => Promise<unknown>;
}

export interface ActionGatewayScenarioRuntimeDependencies {
  readonly actionGateway: ActionGatewayLike;
  readonly beginHumeSession?: (
    accountId: string,
    request: Readonly<Record<string, unknown>>,
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly waitForSignal?: (
    accountId: string,
    signalType: WaitForSignalOperation['signal'],
    signal: AbortSignal,
    options: Readonly<{
      executionId: string;
      operationId: string;
      sinceAt: number;
      deadlineAt?: number;
      observe: readonly WaitForSignalOperation['signal'][];
    }>
  ) => Promise<ScenarioOperationResult>;
  readonly notify?: (
    accountId: string,
    request: Readonly<Record<string, unknown>>,
    options: Readonly<{ idempotencyKey: string; signal: AbortSignal }>
  ) => Promise<unknown>;
  readonly sendSms?: (
    accountId: string,
    request: Readonly<Record<string, unknown>>,
    options: Readonly<{ idempotencyKey: string; signal: AbortSignal }>
  ) => Promise<unknown>;
  readonly readUserState?: (
    accountId: string,
    selector: ReadStateOperation['selector'],
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly updateUserState?: (
    accountId: string,
    update: UserStateUpdate,
    idempotencyKey: string,
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly appendMemory?: (
    accountId: string,
    memory: MemoryInput,
    idempotencyKey: string,
    signal: AbortSignal
  ) => Promise<unknown>;
  readonly recordAnalytics?: (
    accountId: string,
    event: Readonly<Record<string, unknown>>,
    options: Readonly<{ idempotencyKey: string; signal: AbortSignal }>
  ) => Promise<unknown>;
}

function requireDependency<T>(value: T | undefined, name: string): T {
  if (!value) throw Object.assign(new Error(`${name} is not configured`), { code: 'RUNTIME_DEPENDENCY_MISSING' });
  return value;
}

/** Bridges scenario operations to the existing durable ActionGateway and server-owned providers. */
export class ActionGatewayScenarioRuntime implements ScenarioRuntime {
  constructor(private readonly dependencies: ActionGatewayScenarioRuntimeDependencies) {}

  async execute(
    operation: ScenarioOperation,
    context: ScenarioRuntimeContext
  ): Promise<ScenarioOperationResult> {
    const idempotencyKey = `scenario_${createHash('sha256')
      .update(`${context.executionId}\u0000${operation.idempotencyScope ?? operation.id}`)
      .digest('base64url')}`;
    if (operation.kind === 'device_action_batch') {
      if (operation.actions.length < 2 || operation.actions.length > 5) {
        throw Object.assign(new Error('Device action batch is invalid'), { code: 'BATCH_INVALID' });
      }
      const settled = await Promise.allSettled(operation.actions.map((action) => this.execute(action, context)));
      const delivered = settled.map((entry) => entry.status === 'fulfilled'
        && entry.value.status === 'succeeded'
        && entry.value.data?.delivered === true);
      return Object.freeze({
        status: 'succeeded',
        code: delivered.every(Boolean)
          ? 'BATCH_DELIVERED'
          : delivered.some(Boolean)
            ? 'BATCH_PARTIAL'
            : 'BATCH_FAILED',
        data: {
          deliveredCount: delivered.filter(Boolean).length,
          failedCount: delivered.filter((value) => !value).length,
          wearableDelivered: operation.actions.some((action, index) => (
            action.target === 'wearable' && delivered[index] === true
          )),
          robotDelivered: operation.actions.some((action, index) => (
            action.target === 'home_robot' && delivered[index] === true
          )),
          childOutcomes: operation.actions.map((action, index) => ({
            id: action.id,
            target: action.target,
            state: delivered[index] ? 'delivered' : 'failed',
            ...(settled[index]?.status === 'rejected'
              ? { errorCode: safeErrorCode((settled[index] as PromiseRejectedResult).reason) }
              : {})
          }))
        }
      });
    }
    if (operation.kind === 'device_action') {
      const deviceId = operation.target === 'wearable'
        ? context.devices.wearableId
        : context.devices.homeRobotId;
      if (!deviceId) throw Object.assign(new Error('Scenario target device is unavailable'), { code: 'DEVICE_UNAVAILABLE' });
      const cameraSessionRef = operation.cameraSessionScope
        ? context.opaqueReference(operation.cameraSessionScope)
        : undefined;
      let result = await this.dependencies.actionGateway.route(context.accountId, {
        device_type: operation.target,
        device_id: deviceId,
        action: operation.action,
        parameters: {
          ...(operation.parameters ?? {}),
          ...(cameraSessionRef ? { session_id: cameraSessionRef } : {})
        },
        idempotency_key: idempotencyKey
      }, { signal: context.signal });
      if (operation.target === 'home_robot') {
        const accepted = result && typeof result === 'object'
          ? result as Readonly<{ status?: unknown; action_id?: unknown }>
          : undefined;
        if (accepted?.status !== 'delivered') {
          if (accepted?.status !== 'accepted' || typeof accepted.action_id !== 'string') {
            throw Object.assign(new Error('Robot action did not return a trackable outcome'), {
              code: 'ACTION_OUTCOME_UNTRACKABLE'
            });
          }
          const waitForOutcome = this.dependencies.actionGateway.waitForActionOutcome;
          if (typeof waitForOutcome !== 'function') {
            throw Object.assign(new Error('Robot action outcome tracking is unavailable'), {
              code: 'ACTION_OUTCOME_TRACKING_UNAVAILABLE'
            });
          }
          result = await waitForOutcome.call(this.dependencies.actionGateway, context.accountId, accepted.action_id, {
            signal: context.signal
          });
        }
        const delivered = result && typeof result === 'object'
          ? result as Readonly<{ status?: unknown }>
          : undefined;
        if (delivered?.status !== 'delivered') {
          throw Object.assign(new Error('Robot action did not return a delivered outcome'), {
            code: 'ACTION_OUTCOME_UNTRACKABLE'
          });
        }
      }
      if (operation.action === 'share_camera_view') {
        if (!cameraSessionRef) throw Object.assign(new Error('Camera session scope is missing'), {
          code: 'CAMERA_SESSION_NOT_READY'
        });
        const outcome = result && typeof result === 'object'
          ? result as Readonly<{ camera_ready?: unknown; camera_session_ref?: unknown }>
          : undefined;
        if (outcome?.camera_ready !== true || outcome.camera_session_ref !== cameraSessionRef) {
          throw Object.assign(new Error('Camera session did not become ready'), {
            code: 'CAMERA_SESSION_NOT_READY'
          });
        }
      }
      return Object.freeze({
        status: 'succeeded',
        data: {
          delivered: true,
          ...(cameraSessionRef ? { cameraReady: true, cameraSessionRef } : {})
        }
      });
    }
    if (operation.kind === 'hume_session') {
      const targetDeviceId = operation.target === 'wearable'
        ? context.devices.wearableId
        : context.devices.homeRobotId;
      if (!targetDeviceId) throw Object.assign(new Error('Hume target device is unavailable'), { code: 'DEVICE_UNAVAILABLE' });
      await requireDependency(this.dependencies.beginHumeSession, 'Hume session provider')(
        context.accountId,
        {
          mode: operation.mode,
          target_device_type: operation.target,
          target_device_id: targetDeviceId,
          scenario_id: context.scenarioId,
          execution_id: context.executionId,
          idempotency_key: idempotencyKey
        },
        context.signal
      );
      return Object.freeze({ status: 'succeeded' });
    }
    if (operation.kind === 'wait_for_signal') {
      return requireDependency(this.dependencies.waitForSignal, 'Scenario signal provider')(
        context.accountId,
        operation.signal,
        context.signal,
        Object.freeze({
          executionId: context.executionId,
          operationId: operation.id,
          sinceAt: operation.replayFrom === 'operation_start'
            ? context.operationStartedAt
            : context.trigger.occurredAt,
          ...(operation.deadlineAt === undefined ? {} : { deadlineAt: operation.deadlineAt }),
          observe: Object.freeze([...(operation.observe ?? [])])
        })
      );
    }
    if (operation.kind === 'notification') {
      await requireDependency(this.dependencies.notify, 'Notification provider')(context.accountId, {
        audience: operation.audience,
        template: operation.template,
        include_location: operation.includeLocation === true,
        include_camera_link: operation.includeCameraLink === true,
        ...(operation.cameraSessionScope
          ? { camera_session_ref: context.opaqueReference(operation.cameraSessionScope) }
          : {}),
        scenario_id: context.scenarioId,
        execution_id: context.executionId,
        idempotency_key: idempotencyKey
      }, { idempotencyKey, signal: context.signal });
      return Object.freeze({ status: 'succeeded' });
    }
    if (operation.kind === 'sms') {
      await requireDependency(this.dependencies.sendSms, 'SMS provider')(context.accountId, {
        audience: operation.audience,
        template: operation.template,
        include_location: operation.includeLocation === true,
        scenario_id: context.scenarioId,
        execution_id: context.executionId,
        idempotency_key: idempotencyKey
      }, { idempotencyKey, signal: context.signal });
      return Object.freeze({ status: 'succeeded' });
    }
    if (operation.kind === 'read_state') {
      const value = await requireDependency(this.dependencies.readUserState, 'User state reader')(
        context.accountId,
        operation.selector,
        context.signal
      );
      const data: Readonly<Record<string, ScenarioJson>> = value === undefined
        ? Object.freeze({ valuePresent: false })
        : Object.freeze({ valuePresent: true, value: validateJsonValue(value, 'User state result') });
      return Object.freeze({
        status: value === undefined ? 'not_found' : 'succeeded',
        data
      });
    }
    if (operation.kind === 'update_state') {
      const conditionContext: ScenarioConditionContext = {
        trigger: context.trigger,
        input: context.input,
        results: context.results
      };
      const update = typeof operation.update === 'function'
        ? operation.update(conditionContext)
        : operation.update;
      await requireDependency(this.dependencies.updateUserState, 'User state writer')(
        context.accountId,
        update,
        idempotencyKey,
        context.signal
      );
      return Object.freeze({ status: 'succeeded' });
    }
    if (operation.kind === 'append_memory') {
      const conditionContext: ScenarioConditionContext = {
        trigger: context.trigger,
        input: context.input,
        results: context.results
      };
      const memory = typeof operation.memory === 'function'
        ? operation.memory(conditionContext)
        : operation.memory;
      await requireDependency(this.dependencies.appendMemory, 'Memory writer')(
        context.accountId,
        memory,
        idempotencyKey,
        context.signal
      );
      return Object.freeze({ status: 'succeeded' });
    }
    await requireDependency(this.dependencies.recordAnalytics, 'Analytics provider')(
      context.accountId,
      {
        event: operation.event,
        scenario_id: context.scenarioId,
        execution_id: context.executionId,
        idempotency_key: idempotencyKey
      },
      { idempotencyKey, signal: context.signal }
    );
    return Object.freeze({ status: 'succeeded' });
  }
}

interface RuntimeExecution {
  readonly accountId: string;
  readonly accountRef: string;
  readonly request: ScenarioStartRequest;
  readonly definition: ScenarioDefinition;
  readonly steps: readonly ScenarioStepDefinition[];
  readonly controller: AbortController;
  cancelRequestedAt?: number;
  cancellationReason?: 'user' | 'account_deletion';
  snapshot: ScenarioExecutionSnapshot;
  resolve: (value: ScenarioExecutionSnapshot) => void;
  reject: (reason: unknown) => void;
  readonly completion: Promise<ScenarioExecutionSnapshot>;
}

export interface ScenarioEngineOptions {
  readonly definitions: readonly ScenarioDefinition[];
  readonly runtime: ScenarioRuntime;
  readonly repository?: ScenarioExecutionRepository;
  readonly identitySecret: string | Buffer;
  readonly identityKeyVersion?: number;
  readonly now?: () => number;
  readonly maxConcurrentExecutions?: number;
  readonly maxPendingExecutions?: number;
  readonly maxPendingPerAccount?: number;
  /** Dedicated life-safety lane; it is not consumed by wellness waits. */
  readonly criticalReservedSlots?: number;
  readonly maxCriticalPendingExecutions?: number;
  readonly maxCriticalPendingPerAccount?: number;
  readonly maxTriggerAgeMs?: number;
  readonly triggerFutureSkewMs?: number;
  readonly defaultStepTimeoutMs?: number;
  readonly enabled?: Partial<Record<ScenarioId, boolean>>;
  readonly onRecoveryRequired?: (
    accountId: string,
    execution: ScenarioExecutionSnapshot
  ) => Promise<void>;
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
// Authentication subjects may be provider-qualified (for example,
// `apple:user-id`) or email-shaped. Keep the account grammar aligned with the
// auth/session layer without weakening the smaller grammar used for commands,
// steps, devices, and idempotency keys.
const ACCOUNT_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const PRIORITY_ORDER: Readonly<Record<ScenarioPriority, number>> = Object.freeze({
  critical: 0,
  standard: 1,
  background: 2
});

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < min || selected > max) throw new TypeError(`${label} is invalid`);
  return selected;
}

function opaqueReference(value: string, secret: string | Buffer): string {
  return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 32);
}

function deterministicExecutionId(identity: string): string {
  const hex = Buffer.from(identity, 'base64url').subarray(0, 16).toString('hex').padEnd(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function safeErrorCode(error: unknown): string {
  const candidate = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code ?? '')
    : error instanceof Error ? error.name : 'SCENARIO_STEP_FAILED';
  const transportCode = candidate.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  // The durable ACK expiry and a caller's bounded outcome wait can complete in
  // either order. They are the same scenario-level condition and must not make
  // fallback records or analytics depend on event-loop timing.
  const normalized = transportCode === 'ACK_TIMEOUT' || transportCode === 'ACTION_OUTCOME_READ_TIMEOUT'
    ? 'ACTION_OUTCOME_TIMEOUT'
    : transportCode;
  const allowed = new Set([
    'ACCOUNT_DATA_DELETED', 'ACCOUNT_FENCED', 'ACTION_OUTCOME_TIMEOUT',
    'ACTION_OUTCOME_TRACKING_UNAVAILABLE', 'ACTION_OUTCOME_UNTRACKABLE',
    'ACTION_WAIT_CANCELLED', 'BATCH_INVALID', 'BINDING_FENCED',
    'CAMERA_SESSION_NOT_READY', 'DELIVERY_FAILED', 'DEVICE_OFFLINE',
    'DEVICE_UNAVAILABLE', 'MANUFACTURER_REJECTED', 'OPERATION_CANCELLED',
    'ROBOT_COMMAND_FAILED', 'ROBOT_COMMAND_REJECTED', 'RUNTIME_DEPENDENCY_MISSING',
    'SIMULATED_DEVICE_FAILURE', 'STEP_TIMEOUT', 'USER_CANCELLED',
    'WEARABLE_ACK_TIMEOUT', 'WEARABLE_COMMAND_REJECTED', 'WEARABLE_SESSION_CLOSED'
  ]);
  return allowed.has(normalized) ? normalized : 'SCENARIO_STEP_FAILED';
}

function safeOutcomeCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const allowed = new Set([
    'BATCH_DELIVERED', 'BATCH_PARTIAL', 'BATCH_FAILED',
    'CONFIRMED', 'DECLINED', 'NOT_FOUND', 'NO_RESPONSE', 'SIGNAL_RECEIVED'
  ]);
  return allowed.has(normalized) ? normalized : 'PROVIDER_OUTCOME';
}

function validateJsonValue(
  value: unknown,
  label: string,
  depth = 0,
  seen = new WeakSet<object>()
): ScenarioJson {
  if (depth > 12) throw new TypeError(`${label} is invalid`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} is invalid`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${label} is invalid`);
  if (seen.has(value)) throw new TypeError(`${label} is invalid`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 256) throw new TypeError(`${label} is invalid`);
    const result = Object.freeze(value.map((entry) => validateJsonValue(entry, label, depth + 1, seen)));
    seen.delete(value);
    return result;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} is invalid`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) throw new TypeError(`${label} is invalid`);
  const result: Record<string, ScenarioJson> = {};
  for (const [key, entry] of entries) {
    if (key.length === 0 || key.length > 128 || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      throw new TypeError(`${label} is invalid`);
    }
    result[key] = validateJsonValue(entry, label, depth + 1, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function validateJsonRecord(value: Readonly<Record<string, ScenarioJson>> | undefined, label: string): Readonly<Record<string, ScenarioJson>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is invalid`);
  const normalized = validateJsonValue(value, label);
  if (normalized === null || Array.isArray(normalized) || typeof normalized !== 'object') {
    throw new TypeError(`${label} is invalid`);
  }
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized) > 16 * 1024) throw new TypeError(`${label} is too large`);
  return normalized as Readonly<Record<string, ScenarioJson>>;
}

function canonicalJson(value: ScenarioJson): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as { readonly [key: string]: ScenarioJson };
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(record[key] as ScenarioJson)}`
  )).join(',')}}`;
}

function targetReference(value: string | undefined, secret: string | Buffer): string | undefined {
  if (value === undefined) return undefined;
  if (!IDENTIFIER_PATTERN.test(value)) throw new TypeError('Scenario device identifier is invalid');
  return opaqueReference(value, secret);
}

function terminal(state: ScenarioExecutionState): boolean {
  return ['completed', 'fallback_completed', 'failed', 'cancelled'].includes(state);
}

function validateOperationDefinition(operation: ScenarioOperation): void {
  if (!IDENTIFIER_PATTERN.test(operation.id)
    || (operation.idempotencyScope !== undefined && !IDENTIFIER_PATTERN.test(operation.idempotencyScope))
    || ('cameraSessionScope' in operation
      && operation.cameraSessionScope !== undefined
      && !IDENTIFIER_PATTERN.test(operation.cameraSessionScope))) {
    throw new TypeError('Scenario operation identifier is invalid');
  }
  if (operation.kind === 'device_action'
    && operation.action === 'share_camera_view'
    && !operation.cameraSessionScope) {
    throw new TypeError('Camera action requires an opaque session scope');
  }
  if (operation.kind === 'notification'
    && operation.includeCameraLink === true
    && !operation.cameraSessionScope) {
    throw new TypeError('Camera notification requires an opaque session scope');
  }
  if (operation.kind === 'device_action_batch') {
    if (operation.actions.length < 2 || operation.actions.length > 5) {
      throw new TypeError('Scenario device batch size is invalid');
    }
    const ids = new Set<string>();
    for (const action of operation.actions) {
      validateOperationDefinition(action);
      if (ids.has(action.id)) throw new TypeError('Scenario batch operation is duplicated');
      ids.add(action.id);
    }
  }
}

export class ScenarioEngine {
  private readonly definitions = new Map<ScenarioId, ScenarioDefinition>();
  private readonly enabled = new Map<ScenarioId, boolean>();
  private readonly repository: ScenarioExecutionRepository;
  private readonly now: () => number;
  private readonly maxConcurrentExecutions: number;
  private readonly maxPendingExecutions: number;
  private readonly maxPendingPerAccount: number;
  private readonly criticalReservedSlots: number;
  private readonly maxCriticalPendingExecutions: number;
  private readonly maxCriticalPendingPerAccount: number;
  private readonly maxTriggerAgeMs: number;
  private readonly triggerFutureSkewMs: number;
  private readonly defaultStepTimeoutMs: number;
  private readonly identityKeyVersion: number;
  private readonly pending: RuntimeExecution[] = [];
  private readonly active = new Map<string, RuntimeExecution>();
  private readonly completions = new Map<string, Promise<ScenarioExecutionSnapshot>>();
  private activeCount = 0;
  private activeCriticalCount = 0;
  private scheduledCount = 0;
  private scheduledCriticalCount = 0;
  private readonly scheduledByAccount = new Map<string, number>();
  private readonly scheduledCriticalByAccount = new Map<string, number>();
  private readonly fencedAccounts = new Set<string>();
  private readonly schedulingByAccount = new Map<string, Set<symbol>>();
  private readonly schedulingWaiters = new Map<string, Set<() => void>>();
  private readonly executionSchedulingTails = new Map<string, Promise<void>>();
  private readonly cancellations = new Map<string, Promise<ScenarioExecutionSnapshot>>();

  constructor(private readonly options: ScenarioEngineOptions) {
    const secretLength = Buffer.isBuffer(options.identitySecret)
      ? options.identitySecret.byteLength
      : Buffer.byteLength(options.identitySecret ?? '');
    if (secretLength < 32) throw new TypeError('Scenario identity secret must contain at least 32 bytes');
    if (!Array.isArray(options.definitions) || options.definitions.length === 0) {
      throw new TypeError('Scenario definitions are required');
    }
    if (typeof options.runtime?.execute !== 'function') {
      throw new TypeError('Scenario runtime is required');
    }
    if (options.repository && ['create', 'put', 'get', 'list', 'listAll', 'deleteAccount']
      .some((method) => typeof (options.repository as unknown as Record<string, unknown>)[method] !== 'function')) {
      throw new TypeError('Scenario repository contract is incomplete');
    }
    for (const definition of options.definitions) {
      const scenarioId: ScenarioId = definition.id;
      if (this.definitions.has(scenarioId)) throw new TypeError('Scenario definition is duplicated');
      if (!Number.isSafeInteger(definition.version) || definition.version < 1 || definition.version > 1_000_000) {
        throw new TypeError('Scenario definition version is invalid');
      }
      if (!Array.isArray(definition.allowedTriggerTypes)
        || definition.allowedTriggerTypes.length < 1
        || definition.allowedTriggerTypes.length > 16
        || new Set(definition.allowedTriggerTypes).size !== definition.allowedTriggerTypes.length
        || definition.allowedTriggerTypes.some((type: string) => !IDENTIFIER_PATTERN.test(type))) {
        throw new TypeError('Scenario trigger allowlist is invalid');
      }
      this.definitions.set(scenarioId, definition);
      this.enabled.set(scenarioId, options.enabled?.[scenarioId] !== false);
    }
    this.repository = options.repository ?? new InMemoryScenarioExecutionRepository();
    this.now = options.now ?? Date.now;
    this.maxConcurrentExecutions = boundedInteger(options.maxConcurrentExecutions, 8, 1, 100, 'Scenario concurrency');
    this.maxPendingExecutions = boundedInteger(options.maxPendingExecutions, 1_000, 1, 100_000, 'Scenario pending capacity');
    this.maxPendingPerAccount = boundedInteger(options.maxPendingPerAccount, 50, 1, 1_000, 'Account scenario capacity');
    if (this.maxPendingPerAccount > this.maxPendingExecutions) throw new TypeError('Account scenario capacity exceeds global capacity');
    this.criticalReservedSlots = boundedInteger(options.criticalReservedSlots, 1, 1, 16, 'Critical scenario slots');
    this.maxCriticalPendingExecutions = boundedInteger(
      options.maxCriticalPendingExecutions,
      32,
      1,
      1_000,
      'Critical pending capacity'
    );
    this.maxCriticalPendingPerAccount = boundedInteger(
      options.maxCriticalPendingPerAccount,
      4,
      1,
      100,
      'Account critical capacity'
    );
    this.maxTriggerAgeMs = boundedInteger(options.maxTriggerAgeMs, 5 * 60_000, 1_000, 24 * 60 * 60_000, 'Trigger age');
    this.triggerFutureSkewMs = boundedInteger(options.triggerFutureSkewMs, 60_000, 0, 5 * 60_000, 'Trigger skew');
    this.defaultStepTimeoutMs = boundedInteger(options.defaultStepTimeoutMs, 30_000, 10, 30 * 60_000, 'Step timeout');
    this.identityKeyVersion = boundedInteger(options.identityKeyVersion, 1, 1, 1_000_000, 'Identity key version');
  }

  setEnabled(scenarioId: ScenarioId, enabled: boolean): void {
    if (!this.definitions.has(scenarioId)) throw new TypeError('Scenario is unknown');
    this.enabled.set(scenarioId, enabled === true);
  }

  listDefinitions(): readonly Readonly<Pick<ScenarioDefinition, 'id' | 'priority' | 'description'>>[] {
    return [...this.definitions.values()].map((definition) => Object.freeze({
      id: definition.id,
      priority: definition.priority,
      description: definition.description
    }));
  }

  async startScenario(accountId: string, rawRequest: ScenarioStartRequest): Promise<ScenarioStartResult> {
    const { result } = await this.schedule(accountId, rawRequest);
    return result;
  }

  async executeScenario(accountId: string, request: ScenarioStartRequest): Promise<ScenarioExecutionSnapshot> {
    const scheduled = await this.schedule(accountId, request);
    if (!scheduled.completion) return scheduled.result.execution;
    return scheduled.completion;
  }

  async waitForCompletion(accountId: string, executionId: string): Promise<ScenarioExecutionSnapshot> {
    const accountRef = this.accountRef(accountId);
    const existing = await this.repository.get(accountRef, executionId);
    if (!existing) throw Object.assign(new Error('Scenario execution was not found'), { code: 'SCENARIO_NOT_FOUND' });
    if (terminal(existing.state)) return existing;
    const completion = this.completions.get(executionId);
    if (completion) return completion;
    // Persistence completes before the local promise is removed. Refresh once
    // if that removal raced the first read so callers do not observe stale
    // `running` state after the durable execution is already terminal.
    return await this.repository.get(accountRef, executionId) ?? existing;
  }

  async getExecution(accountId: string, executionId: string): Promise<ScenarioExecutionSnapshot | undefined> {
    return this.repository.get(this.accountRef(accountId), executionId);
  }

  async listExecutions(accountId: string, limit?: number): Promise<readonly ScenarioExecutionSnapshot[]> {
    return this.repository.list(this.accountRef(accountId), limit);
  }

  async exportExecutions(accountId: string): Promise<readonly ScenarioExecutionSnapshot[]> {
    return this.repository.listAll(this.accountRef(accountId));
  }

  /**
   * Fail-closed restart reconciliation. Ephemeral health/location inputs are
   * intentionally not persisted, so unsafe blind step resumption is forbidden.
   * The deployment callback must issue the appropriate account-bound fallback
   * before a nonterminal critical execution is finalized.
   */
  async reconcileAccountAfterRestart(accountId: string): Promise<readonly ScenarioExecutionSnapshot[]> {
    const accountRef = this.accountRef(accountId);
    const maintenanceToken = this.beginScheduling(accountRef);
    try {
      const records = await this.repository.listAll(accountRef);
      const reconciled: ScenarioExecutionSnapshot[] = [];
      for (const record of records.filter((entry) => !terminal(entry.state))) {
        if (this.active.has(record.executionId)
          || this.pending.some((runtime) => runtime.snapshot.executionId === record.executionId)) continue;
        if (record.priority === 'critical' && !this.options.onRecoveryRequired) {
          throw Object.assign(new Error('Critical scenario recovery handler is not configured'), {
            code: 'RECOVERY_HANDLER_MISSING'
          });
        }
        this.assertAccountOpen(accountRef);
        if (this.options.onRecoveryRequired) await this.options.onRecoveryRequired(accountId, record);
        this.assertAccountOpen(accountRef);
        const completedAt = this.now();
        const failed = this.nextSnapshot(record, {
          state: 'failed',
          completedAt,
          errorCode: 'PROCESS_RESTARTED',
          steps: record.steps.map((step) => (
            step.state === 'pending' || step.state === 'running'
              ? { ...step, state: 'skipped' as const, completedAt }
              : step
          ))
        });
        await this.repository.put(failed);
        reconciled.push(failed);
      }
      return Object.freeze(reconciled);
    } finally {
      this.endScheduling(accountRef, maintenanceToken);
    }
  }

  async cancelScenario(accountId: string, executionId: string): Promise<ScenarioExecutionSnapshot> {
    const accountRef = this.accountRef(accountId);
    this.assertAccountOpen(accountRef);
    if (!IDENTIFIER_PATTERN.test(executionId)) throw new TypeError('Scenario execution identifier is invalid');
    const cancellationKey = `${accountRef}\u0000${executionId}`;
    const inFlight = this.cancellations.get(cancellationKey);
    if (inFlight) return inFlight;
    const cancellation = this.cancelScenarioTracked(accountRef, executionId);
    this.cancellations.set(cancellationKey, cancellation);
    try {
      return await cancellation;
    } finally {
      if (this.cancellations.get(cancellationKey) === cancellation) {
        this.cancellations.delete(cancellationKey);
      }
    }
  }

  private async cancelScenarioTracked(
    accountRef: string,
    executionId: string
  ): Promise<ScenarioExecutionSnapshot> {
    const existing = await this.repository.get(accountRef, executionId);
    if (!existing) throw Object.assign(new Error('Scenario execution was not found'), { code: 'SCENARIO_NOT_FOUND' });
    if (terminal(existing.state)) return existing;

    const queuedIndex = this.pending.findIndex((entry) => entry.snapshot.executionId === executionId);
    const queued = queuedIndex >= 0 ? this.pending.splice(queuedIndex, 1)[0] : undefined;
    const active = this.active.get(executionId);
    if (active) {
      active.cancelRequestedAt = this.now();
      active.cancellationReason = 'user';
      active.controller.abort();
      return active.completion;
    }
    const cancelled = this.nextSnapshot(existing, {
      state: 'cancelled',
      completedAt: this.now(),
      errorCode: 'USER_CANCELLED',
      cancellation: Object.freeze({
        requestedAt: this.now(),
        robotEmergencyStop: Object.freeze({ state: 'not_required', completedAt: this.now() }),
        nonRetractable: Object.freeze([])
      }),
      steps: existing.steps.map((step) => step.state === 'pending' || step.state === 'running'
        ? { ...step, state: 'cancelled' as const, completedAt: this.now() }
        : step)
    });
    let outcome = cancelled;
    try {
      await this.repository.put(cancelled);
    } catch (error) {
      // An active run can finish after the first repository read but before
      // its local runtime is observed. Converge on that durable terminal state
      // rather than surfacing an optimistic-version error.
      let latest: ScenarioExecutionSnapshot | undefined;
      try {
        latest = await this.repository.get(accountRef, executionId);
      } catch {}
      if (!latest || !terminal(latest.state)) {
        if (queued) {
          queued.snapshot = latest ?? queued.snapshot;
          this.enqueueRuntime(queued);
          // Account deletion fences new work and waits for this cancellation.
          // Leave the restored runtime queued for the deletion path to remove.
          if (!this.fencedAccounts.has(accountRef)) this.drain();
        }
        throw error;
      }
      outcome = latest;
    }
    if (queued) {
      queued.controller.abort();
      queued.snapshot = outcome;
      queued.resolve(outcome);
      this.completions.delete(executionId);
      this.releaseCapacity(queued.accountRef, queued.definition.priority);
    }
    return outcome;
  }

  async deleteAccountData(accountId: string): Promise<number> {
    const accountRef = this.accountRef(accountId);
    // Fence before observing queues. A schedule already awaiting persistence
    // must finish (and be included below) before erasure can return.
    this.fencedAccounts.add(accountRef);
    await this.waitForScheduling(accountRef);
    const cancellationPrefix = `${accountRef}\u0000`;
    const cancellations = [...this.cancellations.entries()]
      .filter(([key]) => key.startsWith(cancellationPrefix))
      .map(([, cancellation]) => cancellation);
    await Promise.allSettled(cancellations);
    const pendingForAccount = this.pending.filter((runtime) => runtime.accountRef === accountRef);
    for (const runtime of pendingForAccount) {
      const index = this.pending.indexOf(runtime);
      if (index >= 0) this.pending.splice(index, 1);
      runtime.controller.abort();
      runtime.cancellationReason = 'account_deletion';
      const completedAt = this.now();
      const cancelled = this.nextSnapshot(runtime.snapshot, {
        state: 'cancelled',
        completedAt,
        errorCode: 'ACCOUNT_DATA_DELETED',
        steps: runtime.snapshot.steps.map((step) => step.state === 'pending' || step.state === 'running'
          ? { ...step, state: 'cancelled' as const, completedAt }
          : step)
      });
      runtime.snapshot = cancelled;
      try {
        await this.persistTerminalSnapshot(cancelled);
      } catch {
        // The account-wide erase below is authoritative. A transient audit
        // state write must never prevent deletion or strand this removed queue
        // entry and its reserved capacity.
      }
      runtime.resolve(cancelled);
      this.completions.delete(runtime.snapshot.executionId);
      this.releaseCapacity(runtime.accountRef, runtime.definition.priority);
    }
    const activeForAccount = [...this.active.values()].filter((runtime) => runtime.accountRef === accountRef);
    for (const runtime of activeForAccount) {
      runtime.cancellationReason = 'account_deletion';
      runtime.controller.abort();
    }
    await Promise.allSettled(activeForAccount.map((runtime) => runtime.completion));
    return this.repository.deleteAccount(accountRef);
  }

  private accountRef(accountId: string): string {
    if (!ACCOUNT_IDENTIFIER_PATTERN.test(accountId)) throw new TypeError('Scenario account identifier is invalid');
    return opaqueReference(accountId, this.options.identitySecret);
  }

  private normalizeRequest(raw: ScenarioStartRequest): ScenarioStartRequest {
    const definition = this.definitions.get(raw?.scenarioId);
    if (!definition) throw Object.assign(new Error('Scenario is unknown'), { code: 'SCENARIO_UNKNOWN' });
    if (!IDENTIFIER_PATTERN.test(raw.trigger?.eventId ?? '') || !IDENTIFIER_PATTERN.test(raw.trigger?.type ?? '')) {
      throw new TypeError('Scenario trigger is invalid');
    }
    if (!IDENTIFIER_PATTERN.test(raw.idempotencyKey ?? '')) throw new TypeError('Scenario idempotency key is invalid');
    if (!Number.isSafeInteger(raw.trigger.occurredAt)) throw new TypeError('Scenario trigger time is invalid');
    return Object.freeze({
      scenarioId: raw.scenarioId,
      idempotencyKey: raw.idempotencyKey,
      devices: Object.freeze({ ...raw.devices }),
      trigger: Object.freeze({
        eventId: raw.trigger.eventId,
        type: raw.trigger.type,
        occurredAt: raw.trigger.occurredAt,
        data: validateJsonRecord(raw.trigger.data, 'Scenario trigger data')
      }),
      input: validateJsonRecord(raw.input, 'Scenario input')
    });
  }

  private assertAdmissionAllowed(definition: ScenarioDefinition, request: ScenarioStartRequest): void {
    if (this.enabled.get(request.scenarioId) !== true) {
      throw Object.assign(new Error('Scenario is disabled'), { code: 'SCENARIO_DISABLED' });
    }
    if (!definition.allowedTriggerTypes.includes(request.trigger.type)) {
      throw Object.assign(new Error('Scenario trigger type is not allowed'), { code: 'TRIGGER_NOT_ALLOWED' });
    }
    const currentTime = this.now();
    if (request.trigger.occurredAt > currentTime + this.triggerFutureSkewMs
      || currentTime - request.trigger.occurredAt > this.maxTriggerAgeMs) {
      throw Object.assign(new Error('Scenario trigger is stale or in the future'), { code: 'TRIGGER_NOT_FRESH' });
    }
  }

  private async schedule(accountId: string, rawRequest: ScenarioStartRequest): Promise<{
    readonly result: ScenarioStartResult;
    readonly completion?: Promise<ScenarioExecutionSnapshot>;
  }> {
    const accountRef = this.accountRef(accountId);
    const schedulingToken = this.beginScheduling(accountRef);
    try {
      return await this.scheduleTracked(accountId, accountRef, rawRequest);
    } finally {
      this.endScheduling(accountRef, schedulingToken);
    }
  }

  private async scheduleTracked(
    accountId: string,
    accountRef: string,
    rawRequest: ScenarioStartRequest
  ): Promise<{
    readonly result: ScenarioStartResult;
    readonly completion?: Promise<ScenarioExecutionSnapshot>;
  }> {
    const request = this.normalizeRequest(rawRequest);
    const definition = this.definitions.get(request.scenarioId) as ScenarioDefinition;
    const idempotencyRef = opaqueReference(`${request.scenarioId}:${request.idempotencyKey}`, this.options.identitySecret);
    const requestRef = opaqueReference(canonicalJson(validateJsonValue({
      scenarioId: request.scenarioId,
      trigger: request.trigger,
      devices: request.devices,
      input: request.input ?? Object.freeze({})
    }, 'Scenario request')), this.options.identitySecret);
    const executionIdentity = createHmac('sha256', this.options.identitySecret)
      .update(`${accountRef}:${idempotencyRef}`)
      .digest('base64url');
    const executionId = deterministicExecutionId(executionIdentity);
    const steps = Object.freeze(definition.buildSteps(request).map((step) => Object.freeze({ ...step })));
    if (steps.length === 0 || steps.length > 50) throw new TypeError('Scenario step count is invalid');
    const stepIds = new Set<string>();
    for (const step of steps) {
      if (!IDENTIFIER_PATTERN.test(step.id) || stepIds.has(step.id)) throw new TypeError('Scenario step identifier is invalid');
      stepIds.add(step.id);
      validateOperationDefinition(step.operation);
      for (const fallback of step.fallback ?? []) validateOperationDefinition(fallback);
    }
    const createdAt = this.now();
    const initial: ScenarioExecutionSnapshot = cloneSnapshot({
      schemaVersion: 1,
      definitionVersion: definition.version,
      identityKeyVersion: this.identityKeyVersion,
      executionId,
      accountRef,
      scenarioId: request.scenarioId,
      triggerRef: opaqueReference(request.trigger.eventId, this.options.identitySecret),
      idempotencyRef,
      requestRef,
      priority: definition.priority,
      state: 'queued',
      createdAt,
      updatedAt: createdAt,
      version: 1,
      deviceReferences: Object.freeze({
        ...(request.devices.wearableId
          ? { wearable: targetReference(request.devices.wearableId, this.options.identitySecret) }
          : {}),
        ...(request.devices.homeRobotId
          ? { homeRobot: targetReference(request.devices.homeRobotId, this.options.identitySecret) }
          : {})
      }),
      steps: Object.freeze(steps.map((step) => Object.freeze({
        id: step.id,
        operation: step.operation.kind,
        ...(step.operation.kind === 'device_action' || step.operation.kind === 'hume_session'
          ? { target: step.operation.target }
          : {}),
        ...(step.operation.kind === 'device_action' ? { action: step.operation.action } : {}),
        state: 'pending' as const
      })))
    });
    const releaseExecutionScheduling = await this.acquireExecutionScheduling(executionId);
    try {
      const preexisting = await this.repository.get(accountRef, executionId);
      this.assertAccountOpen(accountRef);
      if (preexisting) {
        if (preexisting.requestRef !== requestRef) {
          throw Object.assign(new Error('Scenario idempotency key was reused with a different request'), {
            code: 'IDEMPOTENCY_CONFLICT'
          });
        }
        return Object.freeze({
          result: Object.freeze({ accepted: true, duplicate: true, execution: preexisting }),
          completion: this.completions.get(preexisting.executionId)
        });
      }
      this.assertAdmissionAllowed(definition, request);
      this.reserveCapacity(accountRef, definition.priority);
      let inserted: Awaited<ReturnType<ScenarioExecutionRepository['create']>>;
      try {
        inserted = await this.repository.create(initial);
      } catch (error) {
        // A remote store may commit a conditional create and then lose the
        // response. Re-read the exact identity before releasing capacity so a
        // durably queued execution is never orphaned until process restart.
        let durable: ScenarioExecutionSnapshot | undefined;
        for (let attempt = 0; attempt < 3 && !durable; attempt += 1) {
          try {
            durable = await this.repository.get(accountRef, executionId);
          } catch {}
          if (!durable) await Promise.resolve();
        }
        if (!durable) {
          this.releaseCapacity(accountRef, definition.priority);
          throw error;
        }
        if (durable.requestRef !== requestRef) {
          this.releaseCapacity(accountRef, definition.priority);
          throw Object.assign(new Error('Scenario idempotency key was reused with a different request'), {
            code: 'IDEMPOTENCY_CONFLICT'
          });
        }
        if (durable.state !== 'queued') {
          this.releaseCapacity(accountRef, definition.priority);
          return Object.freeze({
            result: Object.freeze({ accepted: true, duplicate: true, execution: durable }),
            completion: this.completions.get(durable.executionId)
          });
        }
        inserted = Object.freeze({ created: true, execution: durable });
      }
      try {
        this.assertAccountOpen(accountRef);
      } catch (error) {
        this.releaseCapacity(accountRef, definition.priority);
        throw error;
      }
      if (!inserted.created) {
        this.releaseCapacity(accountRef, definition.priority);
        if (inserted.execution.requestRef !== requestRef) {
          throw Object.assign(new Error('Scenario idempotency key was reused with a different request'), {
            code: 'IDEMPOTENCY_CONFLICT'
          });
        }
        return Object.freeze({
          result: Object.freeze({ accepted: true, duplicate: true, execution: inserted.execution }),
          completion: this.completions.get(inserted.execution.executionId)
        });
      }

      let resolveCompletion!: (value: ScenarioExecutionSnapshot) => void;
      let rejectCompletion!: (reason: unknown) => void;
      const completion = new Promise<ScenarioExecutionSnapshot>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      // startScenario callers receive only the accepted snapshot. Attach a
      // rejection observer so a later durable persistence outage is never an
      // unhandled process rejection; execute/wait callers still receive the
      // rejection from the original promise.
      void completion.catch(() => {});
      const runtime: RuntimeExecution = {
        accountId,
        accountRef,
        request,
        definition,
        steps,
        controller: new AbortController(),
        snapshot: inserted.execution,
        resolve: resolveCompletion,
        reject: rejectCompletion,
        completion
      };
      this.enqueueRuntime(runtime);
      this.completions.set(executionId, completion);
      this.drain();
      return Object.freeze({
        result: Object.freeze({ accepted: true, duplicate: false, execution: inserted.execution }),
        completion
      });
    } finally {
      releaseExecutionScheduling();
    }
  }

  private enqueueRuntime(runtime: RuntimeExecution): void {
    if (this.pending.includes(runtime)) return;
    this.pending.push(runtime);
    this.pending.sort((left, right) => (
      PRIORITY_ORDER[left.definition.priority] - PRIORITY_ORDER[right.definition.priority]
      || left.snapshot.createdAt - right.snapshot.createdAt
    ));
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const criticalIndex = this.pending.findIndex((candidate) => candidate.definition.priority === 'critical');
      const canUseReservedCriticalLane = criticalIndex >= 0
        && this.activeCriticalCount < this.criticalReservedSlots;
      const canUseGeneralLane = this.activeCount < this.maxConcurrentExecutions;
      if (!canUseGeneralLane && !canUseReservedCriticalLane) break;
      const selectedIndex = canUseReservedCriticalLane ? criticalIndex : 0;
      const runtime = this.pending.splice(selectedIndex, 1)[0];
      if (!runtime) break;
      this.activeCount += 1;
      if (runtime.definition.priority === 'critical') this.activeCriticalCount += 1;
      this.active.set(runtime.snapshot.executionId, runtime);
      void this.run(runtime).then(
        (snapshot) => runtime.resolve(snapshot),
        async (error) => {
          if ((error as { readonly code?: unknown } | null)?.code === 'SCENARIO_PERSISTENCE_FAILED') {
            // A terminal business outcome may already have committed even when
            // its storage response was lost. Never overwrite that ambiguity
            // with a different `failed` outcome.
            runtime.reject(error);
            return;
          }
          const completedAt = this.now();
          const cancelled = runtime.controller.signal.aborted;
          const abortCode = runtime.cancellationReason === 'account_deletion'
            ? 'ACCOUNT_DATA_DELETED'
            : 'USER_CANCELLED';
          const failed = this.nextSnapshot(runtime.snapshot, {
            state: cancelled ? 'cancelled' : 'failed',
            completedAt,
            errorCode: cancelled ? abortCode : safeErrorCode(error),
            steps: runtime.snapshot.steps.map((step) => (
              step.state === 'pending' || step.state === 'running'
                ? { ...step, state: cancelled ? 'cancelled' as const : 'skipped' as const, completedAt }
                : step
            ))
          });
          runtime.snapshot = failed;
          try {
            await this.persistTerminalSnapshot(failed);
            runtime.resolve(failed);
          } catch (persistenceError) {
            runtime.reject(Object.assign(new Error('Scenario terminal state could not be persisted'), {
              code: 'SCENARIO_PERSISTENCE_FAILED',
              cause: persistenceError
            }));
          }
        }
      ).finally(() => {
        this.activeCount = Math.max(0, this.activeCount - 1);
        if (runtime.definition.priority === 'critical') {
          this.activeCriticalCount = Math.max(0, this.activeCriticalCount - 1);
        }
        this.active.delete(runtime.snapshot.executionId);
        this.completions.delete(runtime.snapshot.executionId);
        this.releaseCapacity(runtime.accountRef, runtime.definition.priority);
        this.drain();
      });
    }
  }

  private async run(runtime: RuntimeExecution): Promise<ScenarioExecutionSnapshot> {
    if (runtime.controller.signal.aborted) return runtime.snapshot;
    runtime.snapshot = this.nextSnapshot(runtime.snapshot, { state: 'running' });
    await this.repository.put(runtime.snapshot);
    const results = new Map<string, ScenarioOperationResult>();
    let usedFallback = false;
    let degraded = false;
    let failed = false;
    let errorCode: string | undefined;
    let haltNormalSteps = false;

    for (let index = 0; index < runtime.steps.length; index += 1) {
      const step = runtime.steps[index] as ScenarioStepDefinition;
      if (runtime.controller.signal.aborted) break;
      if (haltNormalSteps && step.alwaysRun !== true) {
        runtime.snapshot = this.withStep(runtime.snapshot, index, { state: 'skipped', completedAt: this.now() });
        await this.repository.put(runtime.snapshot);
        continue;
      }
      const conditionContext: ScenarioConditionContext = {
        trigger: runtime.request.trigger,
        input: runtime.request.input ?? Object.freeze({}),
        results
      };
      if (step.when && step.when(conditionContext) !== true) {
        runtime.snapshot = this.withStep(runtime.snapshot, index, { state: 'skipped', completedAt: this.now() });
        await this.repository.put(runtime.snapshot);
        continue;
      }

      const startedAt = this.now();
      runtime.snapshot = this.withStep(runtime.snapshot, index, { state: 'running', startedAt });
      await this.repository.put(runtime.snapshot);
      try {
        const result = await this.executeWithTimeout(step.operation, runtime, results);
        if (result.status === 'failed') {
          throw Object.assign(new Error('Scenario provider reported a failed operation'), {
            code: result.code ?? 'SCENARIO_STEP_FAILED',
            operationResult: result
          });
        }
        results.set(step.id, result);
        const completedAt = this.now();
        runtime.snapshot = this.withStep(runtime.snapshot, index, {
          state: 'succeeded',
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          ...(result.code ? { outcomeCode: safeOutcomeCode(result.code) } : {}),
          ...(step.operation.kind === 'device_action_batch'
            && Array.isArray(result.data?.childOutcomes)
            ? {
              children: Object.freeze(result.data.childOutcomes.flatMap((candidate) => {
                if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
                const child = candidate as Readonly<Record<string, ScenarioJson>>;
                if (typeof child.id !== 'string'
                  || !IDENTIFIER_PATTERN.test(child.id)
                  || !['wearable', 'home_robot'].includes(String(child.target))
                  || !['delivered', 'failed'].includes(String(child.state))) return [];
                return [Object.freeze({
                  id: child.id,
                  target: child.target as 'wearable' | 'home_robot',
                  state: child.state as 'delivered' | 'failed',
                  ...(typeof child.errorCode === 'string'
                    ? { errorCode: safeErrorCode({ code: child.errorCode }) }
                    : {})
                })];
              }))
            }
            : {})
        });
        await this.repository.put(runtime.snapshot);
        if (result.code === 'BATCH_PARTIAL' || result.code === 'BATCH_FAILED') degraded = true;
        if (step.stopAfterSuccess && result.status === 'succeeded') haltNormalSteps = true;
      } catch (error) {
        const code = runtime.controller.signal.aborted
          ? runtime.cancellationReason === 'account_deletion' ? 'ACCOUNT_DATA_DELETED' : 'USER_CANCELLED'
          : safeErrorCode(error);
        if (runtime.controller.signal.aborted) {
          const completedAt = this.now();
          runtime.snapshot = this.withStep(runtime.snapshot, index, {
            state: 'cancelled', completedAt, latencyMs: Math.max(0, completedAt - startedAt), errorCode: code
          });
          await this.repository.put(runtime.snapshot);
          break;
        }

        let fallbackSucceeded = false;
        const fallbackSnapshots: Array<NonNullable<ScenarioStepSnapshot['fallbacks']>[number]> = [];
        if (step.fallback?.length) {
          try {
            for (const fallback of step.fallback) {
              const fallbackStartedAt = this.now();
              try {
                const fallbackResult = await this.executeWithTimeout(fallback, runtime, results);
                if (fallbackResult.status === 'failed') {
                  throw Object.assign(new Error('Scenario provider reported a failed fallback'), {
                    code: fallbackResult.code ?? 'SCENARIO_STEP_FAILED'
                  });
                }
                const fallbackCompletedAt = this.now();
                fallbackSnapshots.push(Object.freeze({
                  id: fallback.id,
                  operation: fallback.kind,
                  state: 'succeeded',
                  startedAt: fallbackStartedAt,
                  completedAt: fallbackCompletedAt,
                  latencyMs: Math.max(0, fallbackCompletedAt - fallbackStartedAt),
                  ...(fallbackResult.code ? { outcomeCode: safeOutcomeCode(fallbackResult.code) } : {})
                }));
              } catch (fallbackError) {
                const fallbackCompletedAt = this.now();
                fallbackSnapshots.push(Object.freeze({
                  id: fallback.id,
                  operation: fallback.kind,
                  state: 'failed',
                  startedAt: fallbackStartedAt,
                  completedAt: fallbackCompletedAt,
                  latencyMs: Math.max(0, fallbackCompletedAt - fallbackStartedAt),
                  errorCode: safeErrorCode(fallbackError)
                }));
                throw fallbackError;
              }
            }
            fallbackSucceeded = true;
            usedFallback = true;
          } catch (fallbackError) {
            errorCode = safeErrorCode(fallbackError);
          }
        }
        const completedAt = this.now();
        runtime.snapshot = this.withStep(runtime.snapshot, index, {
          state: fallbackSucceeded ? 'fallback_succeeded' : 'failed',
          completedAt,
          latencyMs: Math.max(0, completedAt - startedAt),
          errorCode: fallbackSucceeded ? code : (errorCode ?? code),
          ...(fallbackSnapshots.length ? { fallbacks: Object.freeze(fallbackSnapshots) } : {})
        });
        results.set(step.id, Object.freeze({
          // A successful compensating action does not make the primary
          // operation successful. Downstream clinical conditions must be able
          // to distinguish delivery from fallback handling.
          status: 'failed',
          code: fallbackSucceeded ? 'FALLBACK_SUCCEEDED' : (errorCode ?? code),
          data: Object.freeze({ fallbackExecuted: fallbackSucceeded })
        }));
        await this.repository.put(runtime.snapshot);
        if (step.stopAfterFallback && fallbackSucceeded) {
          haltNormalSteps = true;
          continue;
        }
        if (!fallbackSucceeded && !step.continueOnFailure) {
          failed = true;
          errorCode = errorCode ?? code;
          haltNormalSteps = true;
          continue;
        }
        if (!fallbackSucceeded && step.continueOnFailure) degraded = true;
      }
    }

    const cancelled = runtime.controller.signal.aborted;
    const cancellation = cancelled && runtime.cancellationReason === 'user'
      ? await this.compensateCancellation(runtime, results)
      : undefined;
    const completedAt = this.now();
    const abortCode = runtime.cancellationReason === 'account_deletion'
      ? 'ACCOUNT_DATA_DELETED'
      : 'USER_CANCELLED';
    runtime.snapshot = this.nextSnapshot(runtime.snapshot, {
      state: cancelled
        ? 'cancelled'
        : failed
          ? 'failed'
          : usedFallback || degraded
            ? 'fallback_completed'
            : 'completed',
      completedAt,
      steps: runtime.snapshot.steps.map((step) => (
        step.state === 'pending' || step.state === 'running'
          ? { ...step, state: cancelled ? 'cancelled' as const : 'skipped' as const, completedAt }
          : step
      )),
      ...(cancellation ? { cancellation } : {}),
      ...(cancelled ? { errorCode: abortCode } : failed && errorCode ? { errorCode } : {})
    });
    try {
      await this.persistTerminalSnapshot(runtime.snapshot);
    } catch (cause) {
      throw Object.assign(new Error('Scenario terminal state could not be persisted'), {
        code: 'SCENARIO_PERSISTENCE_FAILED',
        cause
      });
    }
    return runtime.snapshot;
  }

  private async compensateCancellation(
    runtime: RuntimeExecution,
    results: ReadonlyMap<string, ScenarioOperationResult>
  ): Promise<NonNullable<ScenarioExecutionSnapshot['cancellation']>> {
    const nonRetractable = new Set<string>();
    let robotMotionMayBeActive = false;
    runtime.steps.forEach((definition, index) => {
      const snapshot = runtime.snapshot.steps[index];
      if (!snapshot) return;
      const completed = snapshot.state === 'succeeded' || snapshot.state === 'fallback_succeeded';
      const operation = definition.operation;
      if (operation.kind === 'device_action') {
        if (operation.target === 'home_robot' && operation.action === 'navigate_to_location'
          && (completed || snapshot.state === 'cancelled')) robotMotionMayBeActive = true;
        if (completed && ['trigger_sos', 'start_two_way_call', 'share_camera_view', 'play_soothing_audio']
          .includes(operation.action)) nonRetractable.add(`device_action:${operation.action}`);
      } else if (operation.kind === 'device_action_batch' && snapshot.children) {
        for (const child of snapshot.children.filter(({ state }) => state === 'delivered')) {
          const action = operation.actions.find(({ id }) => id === child.id);
          if (action && ['trigger_sos', 'start_two_way_call', 'share_camera_view', 'play_soothing_audio']
            .includes(action.action)) nonRetractable.add(`device_action:${action.action}`);
        }
      } else if (completed && operation.kind === 'notification') {
        nonRetractable.add(`notification:${operation.template}`);
      } else if (completed && operation.kind === 'sms') {
        nonRetractable.add(`sms:${operation.template}`);
      }
    });

    const requestedAt = runtime.cancelRequestedAt ?? this.now();
    if (!robotMotionMayBeActive || !runtime.request.devices.homeRobotId) {
      return Object.freeze({
        requestedAt,
        robotEmergencyStop: Object.freeze({ state: 'not_required', completedAt: this.now() }),
        nonRetractable: Object.freeze([...nonRetractable].sort())
      });
    }

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error('Robot emergency stop timed out'), { code: 'STEP_TIMEOUT' }));
      }, 3_000);
    });
    let stopResult: NonNullable<ScenarioExecutionSnapshot['cancellation']>['robotEmergencyStop'];
    try {
      const result = await Promise.race([
        this.options.runtime.execute({
          id: 'cancel_robot_emergency_stop',
          idempotencyScope: 'cancel-robot-emergency-stop',
          kind: 'device_action',
          target: 'home_robot',
          action: 'emergency_stop',
          parameters: {},
          timeoutMs: 3_000
        }, {
          accountId: runtime.accountId,
          executionId: runtime.snapshot.executionId,
          scenarioId: runtime.request.scenarioId,
          trigger: runtime.request.trigger,
          input: runtime.request.input ?? Object.freeze({}),
          devices: runtime.request.devices,
          results,
          signal: controller.signal,
          operationStartedAt: requestedAt,
          opaqueReference: (scope: string) => `scenario_${opaqueReference(
            `${runtime.snapshot.accountRef}:${runtime.snapshot.executionId}:${scope}`,
            this.options.identitySecret
          )}`
        }),
        timeoutPromise
      ]);
      if (result.status !== 'succeeded') {
        throw Object.assign(new Error('Robot emergency stop did not succeed'), {
          code: result.code ?? 'SCENARIO_STEP_FAILED'
        });
      }
      stopResult = Object.freeze({ state: 'succeeded', completedAt: this.now() });
    } catch (error) {
      stopResult = Object.freeze({
        state: 'failed',
        completedAt: this.now(),
        errorCode: controller.signal.aborted ? 'STEP_TIMEOUT' : safeErrorCode(error)
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    return Object.freeze({
      requestedAt,
      robotEmergencyStop: stopResult,
      nonRetractable: Object.freeze([...nonRetractable].sort())
    });
  }

  private async executeWithTimeout(
    operation: ScenarioOperation,
    runtime: RuntimeExecution,
    results: ReadonlyMap<string, ScenarioOperationResult>
  ): Promise<ScenarioOperationResult> {
    const operationStartedAt = this.now();
    let timeoutMs = boundedInteger(
      operation.timeoutMs,
      this.defaultStepTimeoutMs,
      10,
      30 * 60_000,
      'Scenario operation timeout'
    );
    if (operation.kind === 'wait_for_signal' && operation.deadlineAt !== undefined) {
      if (!Number.isSafeInteger(operation.deadlineAt) || operation.deadlineAt <= 0) {
        throw new TypeError('Scenario signal deadline is invalid');
      }
      const remainingMs = operation.deadlineAt - this.now();
      if (remainingMs <= 0) {
        throw Object.assign(new Error('Scenario signal deadline elapsed'), { code: 'STEP_TIMEOUT' });
      }
      timeoutMs = Math.min(timeoutMs, remainingMs);
    }
    const controller = new AbortController();
    let rejectCancellation: ((error: Error) => void) | undefined;
    const abort = (): void => {
      controller.abort();
      rejectCancellation?.(Object.assign(new Error('Scenario operation was cancelled'), { code: 'USER_CANCELLED' }));
    };
    runtime.controller.signal.addEventListener('abort', abort, { once: true });
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error('Scenario operation timed out'), { code: 'STEP_TIMEOUT' }));
      }, timeoutMs);
    });
    const cancellationPromise = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
      if (runtime.controller.signal.aborted) {
        abort();
      }
    });
    try {
      return await Promise.race([
        this.options.runtime.execute(operation, {
          accountId: runtime.accountId,
          executionId: runtime.snapshot.executionId,
          scenarioId: runtime.request.scenarioId,
          trigger: runtime.request.trigger,
          input: runtime.request.input ?? Object.freeze({}),
          devices: runtime.request.devices,
          results,
          signal: controller.signal,
          operationStartedAt,
          opaqueReference: (scope: string) => {
            if (!IDENTIFIER_PATTERN.test(scope)) throw new TypeError('Scenario reference scope is invalid');
            return `scenario_${opaqueReference(
              `${runtime.snapshot.accountRef}:${runtime.snapshot.executionId}:${scope}`,
              this.options.identitySecret
            )}`;
          }
        }),
        timeoutPromise,
        cancellationPromise
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      rejectCancellation = undefined;
      runtime.controller.signal.removeEventListener('abort', abort);
    }
  }

  private withStep(
    snapshot: ScenarioExecutionSnapshot,
    index: number,
    update: Partial<ScenarioStepSnapshot>
  ): ScenarioExecutionSnapshot {
    const steps = snapshot.steps.map((step, stepIndex) => stepIndex === index ? Object.freeze({ ...step, ...update }) : step);
    return this.nextSnapshot(snapshot, { steps });
  }

  private async persistTerminalSnapshot(snapshot: ScenarioExecutionSnapshot): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.repository.put(snapshot);
        return;
      } catch (error) {
        lastError = error;
        // A transport can fail after the conditional write committed. Verify
        // the exact durable version/state before retrying the same mutation.
        try {
          const durable = await this.repository.get(snapshot.accountRef, snapshot.executionId);
          if (durable
            && durable.version === snapshot.version
            && durable.state === snapshot.state
            && terminal(durable.state)) return;
        } catch {}
        await Promise.resolve();
      }
    }
    throw lastError;
  }

  private nextSnapshot(
    snapshot: ScenarioExecutionSnapshot,
    update: Partial<ScenarioExecutionSnapshot>
  ): ScenarioExecutionSnapshot {
    return cloneSnapshot({
      ...snapshot,
      ...update,
      updatedAt: this.now(),
      version: snapshot.version + 1
    });
  }

  private reserveCapacity(accountRef: string, priority: ScenarioPriority): void {
    const accountCount = this.scheduledByAccount.get(accountRef) ?? 0;
    const accountCriticalCount = this.scheduledCriticalByAccount.get(accountRef) ?? 0;
    const isCritical = priority === 'critical';
    const normalScheduled = this.scheduledCount - this.scheduledCriticalCount;
    const normalForAccount = accountCount - accountCriticalCount;
    const atCapacity = isCritical
      ? this.scheduledCriticalCount >= this.maxCriticalPendingExecutions
        || accountCriticalCount >= this.maxCriticalPendingPerAccount
      : normalScheduled >= this.maxPendingExecutions
        || normalForAccount >= this.maxPendingPerAccount;
    if (atCapacity) {
      throw Object.assign(new Error('Scenario capacity is full'), {
        code: 'SCENARIO_CAPACITY_EXCEEDED',
        statusCode: 429
      });
    }
    this.scheduledCount += 1;
    this.scheduledByAccount.set(accountRef, accountCount + 1);
    if (isCritical) {
      this.scheduledCriticalCount += 1;
      this.scheduledCriticalByAccount.set(accountRef, accountCriticalCount + 1);
    }
  }

  private releaseCapacity(accountRef: string, priority: ScenarioPriority): void {
    const accountCount = this.scheduledByAccount.get(accountRef) ?? 0;
    if (accountCount <= 1) this.scheduledByAccount.delete(accountRef);
    else this.scheduledByAccount.set(accountRef, accountCount - 1);
    if (accountCount > 0) this.scheduledCount = Math.max(0, this.scheduledCount - 1);
    if (priority === 'critical') {
      const accountCriticalCount = this.scheduledCriticalByAccount.get(accountRef) ?? 0;
      if (accountCriticalCount <= 1) this.scheduledCriticalByAccount.delete(accountRef);
      else this.scheduledCriticalByAccount.set(accountRef, accountCriticalCount - 1);
      if (accountCriticalCount > 0) {
        this.scheduledCriticalCount = Math.max(0, this.scheduledCriticalCount - 1);
      }
    }
  }

  private assertAccountOpen(accountRef: string): void {
    if (this.fencedAccounts.has(accountRef)) {
      throw Object.assign(new Error('Scenario account data has been deleted'), {
        code: 'ACCOUNT_DATA_DELETED',
        statusCode: 409
      });
    }
  }

  private beginScheduling(accountRef: string): symbol {
    this.assertAccountOpen(accountRef);
    const token = Symbol('scenario-schedule');
    const inFlight = this.schedulingByAccount.get(accountRef) ?? new Set<symbol>();
    inFlight.add(token);
    this.schedulingByAccount.set(accountRef, inFlight);
    return token;
  }

  private async acquireExecutionScheduling(executionId: string): Promise<() => void> {
    const previous = this.executionSchedulingTails.get(executionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.executionSchedulingTails.set(executionId, current);
    await previous;
    return () => {
      release();
      if (this.executionSchedulingTails.get(executionId) === current) {
        this.executionSchedulingTails.delete(executionId);
      }
    };
  }

  private endScheduling(accountRef: string, token: symbol): void {
    const inFlight = this.schedulingByAccount.get(accountRef);
    inFlight?.delete(token);
    if (inFlight && inFlight.size > 0) return;
    this.schedulingByAccount.delete(accountRef);
    const waiters = this.schedulingWaiters.get(accountRef);
    this.schedulingWaiters.delete(accountRef);
    for (const resolve of waiters ?? []) resolve();
  }

  private waitForScheduling(accountRef: string): Promise<void> {
    if ((this.schedulingByAccount.get(accountRef)?.size ?? 0) === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = this.schedulingWaiters.get(accountRef) ?? new Set<() => void>();
      waiters.add(resolve);
      this.schedulingWaiters.set(accountRef, waiters);
    });
  }
}
