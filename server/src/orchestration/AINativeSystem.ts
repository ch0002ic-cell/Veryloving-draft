import type {
  AccountDataKeyring,
  CiphertextRepository
} from '../models/UserState';
import { UserStateModel } from '../models/UserState';
import {
  MemoryNet,
  type MemoryEntry,
  type MemoryInput,
  type MemoryListQuery,
  type MemoryMutationOptions
} from '../memory/MemoryNet';
import { createDefaultScenarioDefinitions } from '../scenarios';
import {
  AINativeAccountLifecycle,
  buildAINativeHumeContext,
  createAINativeScenarioRuntime,
  type AINativeRuntimeProviders,
  type ActionGatewayLike
} from './AINativeRuntime';
import { EdgeScenarioRouter, type EdgeScenarioRouterOptions } from './EdgeScenarioRouter';
import {
  ScenarioEngine,
  type ScenarioEngineOptions,
  type ScenarioExecutionRepository
} from './ScenarioEngine';
import { TelemetryStateIngestor } from './TelemetryStateIngestor';

export interface AINativeExternalPrivacyProvider {
  exportUserData(accountId: string, signal: AbortSignal): Promise<unknown>;
  deleteUserData(accountId: string): Promise<void>;
}

export interface AINativeSystemOptions extends Omit<
  AINativeRuntimeProviders,
  'userState' | 'memoryNet' | 'accountLifecycle'
> {
  readonly actionGateway: ActionGatewayLike;
  readonly ciphertextRepository: CiphertextRepository;
  readonly scenarioRepository: ScenarioExecutionRepository;
  readonly encryptionKey?: Uint8Array;
  readonly encryptionKeyring?: AccountDataKeyring;
  readonly scenarioIdentitySecret: string | Buffer;
  readonly externalPrivacyProvider: AINativeExternalPrivacyProvider;
  readonly scenario?: Readonly<Pick<
    ScenarioEngineOptions,
    | 'now'
    | 'maxConcurrentExecutions'
    | 'maxPendingExecutions'
    | 'maxPendingPerAccount'
    | 'criticalReservedSlots'
    | 'maxCriticalPendingExecutions'
    | 'maxCriticalPendingPerAccount'
    | 'maxTriggerAgeMs'
    | 'triggerFutureSkewMs'
    | 'defaultStepTimeoutMs'
    | 'identityKeyVersion'
    | 'enabled'
    | 'onRecoveryRequired'
  >>;
  readonly edge?: Omit<EdgeScenarioRouterOptions, 'scenarioEngine' | 'telemetryStateIngestor'>;
}

export interface AINativeSystem {
  readonly userState: UserStateModel;
  readonly memoryNet: MemoryNet;
  readonly accountLifecycle: AINativeAccountLifecycle;
  readonly scenarioEngine: ScenarioEngine;
  readonly edgeScenarioRouter: EdgeScenarioRouter;
  readonly getVoiceContext: (accountId: string, signal?: AbortSignal) => Promise<Readonly<Record<string, unknown>>>;
  readonly memory: Readonly<{
    store(
      accountId: string,
      memory: MemoryInput,
      options: MemoryMutationOptions & Readonly<{ idempotencyKey: string }>
    ): Promise<MemoryEntry>;
    list(
      accountId: string,
      query?: MemoryListQuery,
      signal?: AbortSignal
    ): Promise<readonly MemoryEntry[]>;
    delete(accountId: string, memoryId: string, signal?: AbortSignal): Promise<boolean>;
    deleteAll(accountId: string, signal?: AbortSignal): Promise<boolean>;
  }>;
  readonly privacyRepository: Readonly<{
    exportUserData(accountId: string): Promise<unknown>;
    deleteUserData(accountId: string): Promise<unknown>;
  }>;
}

/** Production composition root. Durable repositories and provider erasure are mandatory. */
export function createAINativeSystem(options: AINativeSystemOptions): AINativeSystem {
  const requiredFunctions: readonly [unknown, string][] = [
    [options?.actionGateway?.route, 'actionGateway.route'],
    [options?.actionGateway?.waitForActionOutcome, 'actionGateway.waitForActionOutcome'],
    [options?.actionGateway?.fenceUserActions, 'actionGateway.fenceUserActions'],
    [options?.ciphertextRepository?.get, 'ciphertextRepository.get'],
    [options?.ciphertextRepository?.compareAndSet, 'ciphertextRepository.compareAndSet'],
    [options?.scenarioRepository?.create, 'scenarioRepository.create'],
    [options?.scenarioRepository?.put, 'scenarioRepository.put'],
    [options?.scenarioRepository?.get, 'scenarioRepository.get'],
    [options?.scenarioRepository?.list, 'scenarioRepository.list'],
    [options?.scenarioRepository?.listAll, 'scenarioRepository.listAll'],
    [options?.scenarioRepository?.deleteAccount, 'scenarioRepository.deleteAccount'],
    [options?.beginHumeSession, 'beginHumeSession'],
    [options?.authorizeHumeContext, 'authorizeHumeContext'],
    [options?.waitForSignal, 'waitForSignal'],
    [options?.notify, 'notify'],
    [options?.sendSms, 'sendSms'],
    [options?.recordAnalytics, 'recordAnalytics']
  ];
  if (!options?.scenarioRepository
    || !options.ciphertextRepository
    || typeof options.externalPrivacyProvider?.exportUserData !== 'function'
    || typeof options.externalPrivacyProvider?.deleteUserData !== 'function'
    || requiredFunctions.some(([candidate]) => typeof candidate !== 'function')) {
    throw new TypeError('AI-native durable repositories and external privacy provider are required');
  }
  const userState = new UserStateModel({
    repository: options.ciphertextRepository,
    encryptionKey: options.encryptionKey,
    encryptionKeyring: options.encryptionKeyring
  });
  const memoryNet = new MemoryNet({
    repository: options.ciphertextRepository,
    encryptionKey: options.encryptionKey,
    encryptionKeyring: options.encryptionKeyring
  });
  const accountLifecycle = new AINativeAccountLifecycle();
  const scenarioPolicy = options.scenario ?? {};
  const allowedScenarioKeys = new Set([
    'now', 'maxConcurrentExecutions', 'maxPendingExecutions', 'maxPendingPerAccount',
    'criticalReservedSlots', 'maxCriticalPendingExecutions', 'maxCriticalPendingPerAccount',
    'maxTriggerAgeMs', 'triggerFutureSkewMs', 'defaultStepTimeoutMs', 'identityKeyVersion', 'enabled',
    'onRecoveryRequired'
  ]);
  if (Object.keys(scenarioPolicy).some((key) => !allowedScenarioKeys.has(key))) {
    throw new TypeError('AI-native scenario policy contains an unsupported override');
  }
  const edgePolicy = options.edge ?? {};
  const allowedEdgeKeys = new Set([
    'now', 'maxTelemetryAgeMs', 'maxFutureSkewMs', 'fallConfidenceThreshold',
    'stressThreshold', 'helpConfidenceThreshold', 'fallEpisodeCooldownMs',
    'stressEpisodeCooldownMs', 'helpEpisodeCooldownMs', 'episodeSourceStaleMs',
    'maxEpisodeKeys', 'telemetryPersistenceTimeoutMs', 'robotSafetyMaxAgeMs',
    'onTelemetryPersistenceFailure'
  ]);
  if (Object.keys(edgePolicy).some((key) => !allowedEdgeKeys.has(key))) {
    throw new TypeError('AI-native edge policy contains an unsupported override');
  }
  const runtime = createAINativeScenarioRuntime({
    actionGateway: options.actionGateway,
    userState,
    memoryNet,
    accountLifecycle,
    beginHumeSession: options.beginHumeSession,
    authorizeHumeContext: options.authorizeHumeContext,
    waitForSignal: options.waitForSignal,
    notify: options.notify,
    sendSms: options.sendSms,
    recordAnalytics: options.recordAnalytics,
    now: scenarioPolicy.now
  });
  const scenarioEngine = new ScenarioEngine({
    ...scenarioPolicy,
    definitions: createDefaultScenarioDefinitions(),
    runtime,
    repository: options.scenarioRepository,
    identitySecret: options.scenarioIdentitySecret
  });
  const telemetryStateIngestor = new TelemetryStateIngestor(userState);
  const edgeScenarioRouter = new EdgeScenarioRouter({
    ...edgePolicy,
    scenarioEngine,
    telemetryStateIngestor
  });
  const privacyRepository = Object.freeze({
    exportUserData: (accountId: string) => accountLifecycle.run(accountId, undefined, async (signal) => {
      const [state, memories, scenarios, providers] = await Promise.all([
        userState.exportData(accountId),
        memoryNet.exportData(accountId),
        scenarioEngine.exportExecutions(accountId),
        options.externalPrivacyProvider.exportUserData(accountId, signal)
      ]);
      return Object.freeze({ state, memories, scenarios, providers });
    }),
    deleteUserData: (accountId: string) => accountLifecycle.deleteAccountData(accountId, {
      actionGateway: options.actionGateway,
      scenarioEngine,
      userState,
      memoryNet,
      deleteExternalProviderData: (targetAccountId) => (
        options.externalPrivacyProvider.deleteUserData(targetAccountId)
      )
    })
  });
  const memory = Object.freeze({
    store: (
      accountId: string,
      entry: MemoryInput,
      mutationOptions: MemoryMutationOptions & Readonly<{ idempotencyKey: string }>
    ) => accountLifecycle.run(accountId, mutationOptions.signal, (signal) => (
      memoryNet.storeMemory(accountId, entry, { ...mutationOptions, signal })
    )),
    list: (accountId: string, query: MemoryListQuery = {}, signal?: AbortSignal) => (
      accountLifecycle.run(accountId, signal, () => memoryNet.listMemories(accountId, query))
    ),
    delete: (accountId: string, memoryId: string, signal?: AbortSignal) => (
      accountLifecycle.run(accountId, signal, () => memoryNet.deleteMemory(accountId, memoryId))
    ),
    deleteAll: (accountId: string, signal?: AbortSignal) => (
      accountLifecycle.run(accountId, signal, (operationSignal) => (
        memoryNet.clearAllMemories(accountId, { signal: operationSignal })
      ))
    )
  });
  return Object.freeze({
    userState,
    memoryNet,
    accountLifecycle,
    scenarioEngine,
    edgeScenarioRouter,
    getVoiceContext: (accountId: string, signal?: AbortSignal) => accountLifecycle.run(
      accountId,
      signal,
      async (operationSignal) => (await buildAINativeHumeContext(
        accountId,
        userState,
        memoryNet,
        options.authorizeHumeContext,
        'general_voice',
        operationSignal
      )) ?? Object.freeze({})
    ),
    memory,
    privacyRepository
  });
}
