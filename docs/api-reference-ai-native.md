# AI-Native API Reference

Status: development prototype — local TypeScript APIs and simulated device endpoints

Last reviewed: 20 July 2026

## 1. Contract boundary

These are Veryloving-owned contracts. They are not Yongyida, Jiangzhi, Hume, clinical-device, emergency-provider, or hardware compatibility promises. Edge outputs and simulator telemetry are synthetic and non-clinical. Production use requires authenticated HTTP/service wrappers, durable repositories, secret-manager keys, approved vendor/provider contracts, and physical validation.

The APIs below are TypeScript domain APIs exercised by deterministic tests. `createAINativeSystem` provides a fail-closed composition factory, and `clm-server.cjs` mounts authenticated controllers when that durable system is injected. The command-line server does not manufacture production repositories, keys, or provider clients; those remain deployment dependencies. No endpoint should be inferred from a method signature unless it is explicitly listed in this reference.

The TypeScript classes accept an `accountId` because they are domain services. A public controller must derive that value from the verified server session. Never accept an arbitrary account ID from a request body, Hume tool arguments, edge payload, or manufacturer callback.

These domain classes do not replace the account lifecycle coordinator. Before export/deletion, the coordinator must mark the account `deleting` and reject every new state, memory, scenario, outbox, and device mutation until deletion reaches its terminal state. This prevents a concurrent compare-and-set or scenario start from recreating records after a delete scan.

Source modules:

```text
server/src/models/UserState.ts
server/src/memory/MemoryNet.ts
server/src/orchestration/ScenarioEngine.ts
server/src/orchestration/EdgeScenarioRouter.ts
server/src/orchestration/TelemetryStateIngestor.ts
server/src/orchestration/AINativeRuntime.ts
server/src/orchestration/AINativeSystem.ts
server/src/scenarios/
server/src/edge/WearableEdgeAI.ts
server/src/edge/RobotEdgeAI.ts
server/mocks/ManufacturerMockServer.ts
```

## 2. User State Model

### 2.1 Construction

```ts
const model = new UserStateModel({
  repository,             // CiphertextRepository
  encryptionKey,          // exactly 32 bytes from a server secret manager
  clock,                  // optional () => Date
  maxHistory,             // optional, default 512; valid 2..10,000
  maxIdempotencyRecords,  // optional, default 256; valid 1..2,000
  maxWriteRetries         // optional, default 32; valid 1..100
});
```

`InMemoryCiphertextRepository` is a test/development implementation. It retains only ciphertext but is not durable across process death and is not a production database. `DynamoCiphertextRepository` is the bundled durable implementation; it expects an AWS SDK v3 document client and a string-keyed `PK`/`SK` table, and it stores only opaque HMAC-derived keys plus bounded ciphertext records. A production `CiphertextRepository` must provide atomic compare-and-set semantics:

```ts
interface CiphertextRepository {
  get(storageKey: string): Promise<CiphertextRecord | null>;
  compareAndSet(
    storageKey: string,
    expectedRevision: number | null,
    next: CiphertextRecord | null
  ): Promise<boolean>;
}
```

`AccountDataCipher` derives an opaque HMAC storage key and an independent per-record key from the 32-byte master key. Records use AES-256-GCM with a 12-byte random IV and authenticated additional data containing domain, opaque storage key, and revision. `accountId` is not used as a plaintext repository key.

### 2.2 State schema

`UserStateSnapshot` has:

| Section | Fields |
| --- | --- |
| Metadata | `schemaVersion`, monotonic `revision`, `recordedAt` |
| `physical` | heart rate, HRV, steps, sleep, activity, temperature observations |
| `cognitive` | medication-adherence counts/rate, memory-assessment score, weekly engagement |
| `emotional` | mood, stress score, valence/arousal tone |
| `context` | home/away context, optional coordinates, time of day, social count, environment |
| `devices` | up to 16 wearable/home-robot records with battery, connectivity, last state, timestamp |

Observations carry their own ISO timestamp. Inputs use strict allowlists and bounded values. Examples include heart rate 20–260 bpm, HRV 0–500 ms, stress 0–100, coordinates within geographic bounds, and battery 0–100. Consult [UserState.ts](../server/src/models/UserState.ts) for the complete source-of-truth validation bounds.

`UserStateUpdate` is a partial patch by section. A property set to `null` removes that property. Supplying `devices` atomically replaces the device array.

### 2.3 Methods

| Method | Result | Semantics |
| --- | --- | --- |
| `getCurrentState(accountId)` | `UserStateSnapshot \| null` | Returns the latest immutable state for one account |
| `updateState(accountId, update, options?)` | `UserStateSnapshot` | Validates, merges, increments revision, encrypts, and conditionally persists |
| `queryTrends(accountId, query)` | `readonly TrendPoint[]` | Returns bounded, chronological observations in an inclusive UTC range |
| `exportData(accountId)` | `UserStateExport` | Returns current state and retained history for that account |
| `deleteAllData(accountId)` | `boolean` | Deletes the account's state aggregate; `false` means no record existed |

`UserStateUpdateOptions` supports:

- `idempotencyKey`: 16–128 characters from `[A-Za-z0-9_-]`. Reuse with the same update returns the original snapshot; reuse with different content fails.
- `expectedRevision`: optimistic concurrency precondition; zero represents no current state.
- `signal`: optional `AbortSignal`; cancellation is checked before and during bounded compare-and-set retries.

Trend metrics are:

```text
heart_rate_bpm
hrv_ms
steps
sleep_minutes
activity_minutes
temperature_celsius
medication_adherence_rate
memory_assessment_score
cognitive_engagement_per_week
stress_score
emotional_valence
social_interactions_today
```

`TrendQuery.limit` defaults to 1,000 and is bounded to 1–10,000. Repeated unchanged observation values/timestamps are deduplicated across state revisions.

### 2.4 Errors

| Class | Code | Meaning |
| --- | --- | --- |
| `AccountDataValidationError` | `ACCOUNT_DATA_VALIDATION` | Unsupported shape, field, identifier, timestamp, range, option, or idempotency conflict |
| `AccountDataConflictError` | `ACCOUNT_DATA_CONFLICT` | Revision precondition or bounded compare-and-set retry failure |
| `AccountDataIntegrityError` | `ACCOUNT_DATA_INTEGRITY` | Ciphertext, tag, key version, key, or authenticated metadata did not verify |

Integrity failures are fail-closed. Do not return partial plaintext or silently replace the record.
An aborted update throws an `AbortError` with code `OPERATION_CANCELLED`; callers must not convert it into a successful write.

## 3. Memory Net

Memory Net stores intentionally selected summaries for personalization and trend recall. It does not accept raw conversations, camera frames, microphone audio, voiceprints, face embeddings, provider prompts, or unrestricted health payloads.

### 3.1 Construction

```ts
const memory = new MemoryNet({
  repository,             // CiphertextRepository
  encryptionKey,          // exactly 32 bytes from a server secret manager
  clock,                  // optional () => Date
  maxMemories,            // optional, default 2,000; valid 1..100,000
  maxIdempotencyRecords,  // optional, default 256; valid 1..2,000
  maxWriteRetries,        // optional, default 32; valid 1..100
  recencyHalfLifeDays     // optional, default 30; valid 1..3,650
});
```

Memory Net reuses `CiphertextRepository` and `AccountDataCipher`. Its opaque index uses the separate `memory-net` domain, so it does not share a storage key or derived data key with User State. `InMemoryCiphertextRepository` remains test/development-only and is not process-durable.

### 3.2 Memory kinds

| Kind | Required content | Purpose |
| --- | --- | --- |
| `conversation_summary` | summary, occurrence time, up to 24 topics, optional emotional tone | Key interaction summary without raw transcript |
| `health_trend` | metric, weekly/monthly range, direction, summary | Bounded longitudinal summary |
| `life_event` | summary, occurrence time, salience 0–1, up to 24 tags | User-shared notable event |
| `preference` | category, value, optional preferred time of day | Personalization preference |

Every input also has an allowlisted `source` (`user`, `wearable`, `home_robot`, or `system`) and a bounded caller-owned `id`. Summaries are limited to 2,000 characters; a preference value is limited to 512. Stored entries add `createdAt`, `updatedAt`, and `recordRevision`.

`RelationshipMetadata` stores `interactingSince`, `interactionCount`, a 0–100 user-controlled `trustLevel`, optional `lastInteractionAt`, update time, and revision. Trust level is a personalization signal only; it must never grant authorization, skip consent, or weaken a safety rule.

### 3.3 Methods

| Method | Result | Semantics |
| --- | --- | --- |
| `storeMemory(accountId, input, options?)` | `MemoryEntry` | Creates or replaces one bounded memory by ID |
| `listMemories(accountId, query?)` | `readonly MemoryEntry[]` | Returns a kind-filtered page for that account |
| `recall(accountId, query?)` | `readonly RecalledMemory[]` | Filters and deterministically ranks by term overlap, recency, and life-event salience |
| `getTrendSummaries(accountId, query?)` | `readonly HealthTrendMemory[]` | Returns newest matching weekly/monthly trends |
| `updateRelationship(accountId, update, options?)` | `RelationshipMetadata` | Partially updates relationship metadata |
| `getRelationshipMetadata(accountId)` | metadata or `null` | Retrieves current relationship metadata |
| `deleteMemory(accountId, memoryId)` | `boolean` | Deletes one account-owned memory; `false` means absent |
| `clearAllMemories(accountId, options?)` | `boolean` | Linearizably resets memories, relationship metadata, and receipts while allowing new user-approved memories later |
| `exportData(accountId)` | `MemoryExport` | Exports relationship metadata and retained summaries |
| `deleteAllData(accountId)` | `boolean` | Account-erasure primitive: deletes the aggregate and installs a non-reopenable local fence; do not use it for an ordinary “clear memories” control |

`MemoryMutationOptions.idempotencyKey` uses the same 16–128 character bound as User State. The same key and mutation return the prior result; reuse for different content fails. An optional `signal` aborts before or during bounded compare-and-set retries.

`MemoryListQuery` supports optional `kind`, `offset` 0–100,000 (default 0), and `limit` 1–500 (default 100). Callers should page rather than attempting to load the full retained set.

`RecallQuery` supports optional text `query` (maximum 500 characters), one to four `kinds`, inclusive `since`/`until`, and `limit` 1–100 (default 10). A supplied text query requires at least one lexical token overlap; no semantic/vector service is implied. The returned `score` is a deterministic local value from 0–1, not model confidence or truth probability. Tokenization is case-normalized and the ranking combines lexical overlap, exponential recency, and life-event salience.

`TrendSummaryQuery` supports optional metric, intersecting date range, and limit 1–1,000 (default 52).

Memory mutation/validation uses `AccountDataValidationError` and bounded contention uses `AccountDataConflictError`; ciphertext failures use `AccountDataIntegrityError`. An aborted mutation throws `AbortError` / `OPERATION_CANCELLED`. Recalled text remains untrusted user context and cannot alter tool policy, device binding, consent, or scenario authorization.

## 4. Scenario Engine

### 4.1 Construction

```ts
const runtime = new ActionGatewayScenarioRuntime(dependencies);
const engine = new ScenarioEngine({
  definitions: createDefaultScenarioDefinitions(),
  runtime,
  repository,             // optional; in-memory default is test/development only
  identitySecret,         // at least 32 bytes
  identityKeyVersion,     // optional positive integer; default 1
  now,                    // optional Unix-millisecond clock
  maxConcurrentExecutions,
  maxPendingExecutions,
  maxPendingPerAccount,
  criticalReservedSlots,
  maxCriticalPendingExecutions,
  maxCriticalPendingPerAccount,
  maxTriggerAgeMs,
  triggerFutureSkewMs,
  defaultStepTimeoutMs,
  enabled,                // Partial<Record<ScenarioId, boolean>>
  onRecoveryRequired      // optional async critical-orphan escalation
});
```

Defaults and bounds:

| Option | Default | Valid range |
| --- | --- | --- |
| `maxConcurrentExecutions` | 8 | 1–100 |
| `maxPendingExecutions` | 1,000 | 1–100,000 standard/background executions |
| `maxPendingPerAccount` | 50 | 1–1,000 standard/background executions |
| `criticalReservedSlots` | 1 | 1–16 additional Critical execution lanes |
| `maxCriticalPendingExecutions` | 32 | 1–1,000 Critical executions |
| `maxCriticalPendingPerAccount` | 4 | 1–100 Critical executions |
| `maxTriggerAgeMs` | 300,000 | 1,000–86,400,000 |
| `triggerFutureSkewMs` | 60,000 | 0–300,000 |
| `defaultStepTimeoutMs` | 30,000 | 10–1,800,000 |
| `identityKeyVersion` | 1 | 1–1,000,000 |

The identity secret produces HMAC-derived account, trigger, idempotency, and device references. Scenario snapshots do not contain the plaintext account ID, event ID, idempotency key, device IDs, trigger data, workflow input, action parameters, health values, location, or conversation text.

`InMemoryScenarioExecutionRepository` is development/test-only and loses executions at process death. `DynamoScenarioExecutionRepository` supplies the durable account-partitioned contract with transactional admission, deletion fencing, stale-version protection, bounded listing/export/deletion, and an `ALL`-projected `GSI1PK`/`GSI1SK` created-at index. Trigger/input payloads are intentionally not persisted, so the engine never blindly resumes an orphan. `reconcileAccountAfterRestart` shares the account maintenance fence with scheduling/deletion, invokes `onRecoveryRequired` before failing a Critical orphan, and rejects without that provider. A deployment still needs account enumeration, one recovery lease owner, idempotent escalation, and crash testing; durable storage alone does not provide distributed execution ownership.

### 4.2 Scenario identifiers

| ID | Definition version | Allowed trigger types | Priority | Purpose |
| --- | ---: | --- | --- | --- |
| `fall_detection` | 1 | `wearable_fall`, `robot_fall` | Critical | Robot navigation/check followed by emergency fallback |
| `medication_adherence` | 1 | `medication_due` | Standard | Robot reminder, wearable confirmation, push/SMS escalation |
| `emotional_check_in` | 1 | `wearable_stress` | Standard | Calming check-in and bounded emotional summary |
| `cognitive_engagement` | 1 | `bedroom_inactivity` | Background | Activity check and allowlisted engagement prompt |
| `ai_angel_auto_dial` | 1 | `panic_button`, `voice_emergency`, `robot_help_request` | Critical | Wearable emergency path, robot context, and SMS fallback |

The priorities above are the default workflow policy; [the scenario definitions](../server/src/scenarios/) are the source of truth.

### 4.3 Start request

```ts
interface ScenarioStartRequest {
  scenarioId: ScenarioId;
  trigger: {
    eventId: string;
    type: string;
    occurredAt: number;
    data?: Readonly<Record<string, ScenarioJson>>;
  };
  devices: {
    wearableId?: string;
    homeRobotId?: string;
  };
  idempotencyKey: string;
  input?: Readonly<Record<string, ScenarioJson>>;
}
```

Identifiers are bounded. Trigger `data` and workflow `input` are each bounded to 16 KiB of JSON and remain ephemeral. The trigger must be within the configured freshness/skew window and its type must appear in that scenario definition's allowlist; otherwise the engine rejects it with `TRIGGER_NOT_ALLOWED`.

### 4.4 Methods

| Method | Result | Semantics |
| --- | --- | --- |
| `setEnabled(scenarioId, enabled)` | `void` | Enables/disables a known definition for new starts |
| `listDefinitions()` | ID/priority/description list | Returns safe definition metadata, not executable closures |
| `startScenario(accountId, request)` | `ScenarioStartResult` | Validates and queues; returns immediately with `duplicate` status |
| `executeScenario(accountId, request)` | `ScenarioExecutionSnapshot` | Starts/joins and waits for terminal completion |
| `waitForCompletion(accountId, executionId)` | snapshot | Waits for an in-process execution or returns stored terminal/current state |
| `reconcileAccountAfterRestart(accountId)` | reconciled snapshots | Fails orphaned work closed; Critical records require recovery-provider escalation first |
| `getExecution(accountId, executionId)` | snapshot or `undefined` | Account-scoped lookup |
| `listExecutions(accountId, limit?)` | snapshots | Newest-first; the provided repository owns and must enforce pagination/bounds (the included in-memory repository accepts 1–500) |
| `exportExecutions(accountId)` | all snapshots | Exhaustive account export; the durable repository must paginate internally |
| `cancelScenario(accountId, executionId)` | snapshot | Cancels queued/running work where possible; terminal executions remain terminal |
| `deleteAccountData(accountId)` | deleted count | Aborts account work and removes its scenario records |

Stable scenario error codes include `SCENARIO_UNKNOWN`, `SCENARIO_DISABLED`, `SCENARIO_NOT_FOUND`, `SCENARIO_CAPACITY_EXCEEDED` (HTTP-style status 429), `TRIGGER_NOT_ALLOWED`, `TRIGGER_NOT_FRESH`, `IDEMPOTENCY_CONFLICT`, `ACCOUNT_DATA_DELETED`, `RECOVERY_HANDLER_MISSING`, `DEVICE_UNAVAILABLE`, `ACTION_OUTCOME_UNTRACKABLE`, `ACTION_OUTCOME_TRACKING_UNAVAILABLE`, `RUNTIME_DEPENDENCY_MISSING`, `STEP_TIMEOUT`, and `USER_CANCELLED`. Validation `TypeError` messages remain generic and must not be reflected with raw request data.

Execution states: `queued`, `running`, `completed`, `fallback_completed`, `failed`, `cancelled`.

Step states: `pending`, `running`, `succeeded`, `failed`, `fallback_succeeded`, `cancelled`, `skipped`.

Each step snapshot stores only bounded operation metadata, timestamps, latency, outcome/error code, and—when used—per-fallback operation results. It does not persist the ephemeral trigger/input/result payloads or action parameters.

`fallback_succeeded` means the compensating operation ran; it does not retroactively make the primary delivery successful. Downstream conditions receive a failed primary result with `FALLBACK_SUCCEEDED` and `fallbackExecuted: true`, preventing a notification fallback from being mistaken for a robot/device success.

Every persisted execution records `schemaVersion: 1`, the scenario `definitionVersion`, and an `identityKeyVersion`, giving repository migrations an explicit discriminator rather than a guess. The engine accepts one active identity secret and does not itself provide a historical keyring or re-key job; those are separate production requirements. A production repository must reject unknown schema versions and stale writes.

Cancellation cannot retract a side effect already accepted by an external transport. The cancellation snapshot records `requestedAt`, a bounded `robotEmergencyStop` compensation outcome when navigation may be active, and sorted `nonRetractable` side-effect labels. Callers must display this distinction and must not translate `cancelled` into “every physical effect stopped.”

### 4.5 Operations and runtime

Scenario definitions may use only these operation kinds:

| Kind | Role |
| --- | --- |
| `device_action` | Routes an allowlisted wearable or robot action through Action Gateway; optional `cameraSessionScope` injects a server-derived `session_id` |
| `device_action_batch` | Dispatches a bounded group of independent device actions concurrently through Action Gateway |
| `hume_session` | Starts `voice_check`, `calming`, `cognitive_game`, or `emergency_call` through an injected provider |
| `wait_for_signal` | Awaits user response, pillbox approach, medication taken, or caregiver acknowledgement |
| `notification` | Requests an injected user/caregiver/emergency-contact notification template |
| `sms` | Requests an injected caregiver/emergency-contact SMS template |
| `read_state` | Reads steps, last location, medication adherence, or stress trend |
| `update_state` | Applies a strict `UserStateUpdate`, static or derived from prior bounded step results |
| `append_memory` | Stores a strict `MemoryInput`, static or derived from prior bounded step results |
| `analytics` | Records a bounded scenario event |

Each step may gate execution with `when`, define compensating `fallback` operations, continue after an unhandled failure with `continueOnFailure`, or terminate the remaining sequence explicitly with `stopAfterFallback` / `stopAfterSuccess`. Branch termination finalizes still-pending steps as `skipped`; use it for immediate safety escalation when further robot interaction would be misleading.

`ActionGatewayScenarioRuntime` converts these operations into injected, server-owned dependencies. It creates stable child idempotency keys as `scenario_<43-character base64url SHA-256 digest>` (52 characters total), which satisfies the Action Gateway, User State, and Memory Net key allowlists without exposing an execution or operation identifier. Missing optional providers fail with `RUNTIME_DEPENDENCY_MISSING`; the Scenario Engine then applies the configured fallback/failure policy.

For `share_camera_view`, `cameraSessionScope` is converted through the runtime's server-secret `opaqueReference` function using the account reference, execution ID, and scope. Delivery counts as camera-ready only when the authenticated action outcome returns both `camera_ready: true` and the exact expected `camera_session_ref`. A notification with `includeCameraLink` uses the same opaque scope; workflow conditions select the camera-link branch only after that correlation. The reference is not itself a public URL, and raw trigger IDs are never used as media-session tokens.

A `wait_for_signal` operation may include `observe` signals collected by the provider, an absolute `deadlineAt`, and `replayFrom: 'operation_start'` when a later phase must not consume a signal already used by an earlier phase. The engine caps its timeout at the remaining deadline. Medication adherence uses one schedule-relative deadline while observing pillbox approach, so sequential waits cannot silently turn a 15-minute policy into 30 minutes. Emotional/cognitive workflows interpret no response only from an explicit result with `data.responded === false` (status `succeeded` or intentional `not_found`); timeout/provider failure remains infrastructure failure. `idempotencyScope` may deliberately deduplicate semantically identical provider fallbacks reached through different branches.

The Action Gateway remains responsible for validating action/device combinations, resolving active bindings, signing envelopes, per-device queues, durable outbox/ACK handling, replay protection, and binding-epoch fencing.

### 4.6 Action Gateway extensions

The existing `ActionGateway` exposes server-side coordination methods:

| Method | Result | Semantics |
| --- | --- | --- |
| `routeMany(userId, actions, { mode?, signal? })` | settled result per input | Validates 1–10 idempotent actions, then dispatches in `parallel` (default) or `sequential` mode with linked cancellation |
| `startScenario(userId, request)` | `ScenarioStartResult` | Delegates to the configured Scenario Engine |
| `cancelScenario(userId, executionId)` | execution snapshot | Account-scoped cancellation delegate |
| `getScenarioExecution(userId, executionId)` | snapshot or `undefined` | Account-scoped status delegate |

Every `routeMany` child requires an idempotency key. A duplicate child identity in one batch is rejected. Runtime failures are returned as privacy-safe settled entries so one offline device does not erase another device's result. If no Scenario Engine is injected, scenario methods fail with `SCENARIO_ENGINE_UNAVAILABLE`; they do not silently fall back to unrestricted action routing.

`route(userId, action, { signal? })` checks cancellation before validation, device/binding/status resolution, durable enqueue, each queued transport attempt, and acknowledgement waiting. A pre-dispatch robot abort persists `ACTION_CANCELLED`; cancellation after transport invocation or HTTP 202 persists `ACTION_CANCELLED_NON_RETRACTABLE`. Wearable cancellation after WebSocket send rejects with `ACTION_CANCELLED` plus `nonRetractable: true`. These outcomes mean local waiting stopped; they are never evidence that hardware stopped or ignored the command. The current terminal record wins over a late vendor ACK, so retaining that late acknowledgement as separate audit evidence remains a production outbox-schema requirement.

### 4.7 Concrete AI-native runtime

`createAINativeScenarioRuntime(providers)` in [AINativeRuntime.ts](../server/src/orchestration/AINativeRuntime.ts) creates an `ActionGatewayScenarioRuntime` backed by concrete `UserStateModel` and `MemoryNet` instances. Providers supply:

```text
actionGateway
userState
memoryNet
accountLifecycle   // required AINativeAccountLifecycle shared with privacy coordination
beginHumeSession
authorizeHumeContext
waitForSignal
notify
sendSms
recordAnalytics
```

Provider contracts are server-side and account-scoped:

| Provider | Contract |
| --- | --- |
| `actionGateway.route` | Routes one validated action using the scenario's abort signal and stable child idempotency key |
| `beginHumeSession` | `(accountId, boundedRequest, AbortSignal) => Promise<unknown>` |
| `authorizeHumeContext` | Durable consent check `(accountId, "scenario_voice" | "general_voice", AbortSignal) => Promise<boolean>`; only exact `true` permits state/memory disclosure |
| `waitForSignal` | `(accountId, signalType, AbortSignal, { executionId, operationId, sinceAt, deadlineAt?, observe }) => Promise<ScenarioOperationResult>` |
| `notify` / `sendSms` | `(accountId, allowlistedRequest, { idempotencyKey, signal })`; provider acceptance is not proof of delivery |
| `recordAnalytics` | `(accountId, boundedEvent, { idempotencyKey, signal })`; event data does not repeat the plaintext account ID |

User State reads receive the operation abort signal. State updates and Memory Net appends receive the stable child idempotency key plus that signal; the concrete wrapper passes the key into each encrypted store and fails closed on an invalid update or memory shape.

The Hume wrapper reads current state, up to five recalled summaries, and relationship metadata. It sends a bounded projection: selected physical/cognitive/emotional/context values; summarized memories; relationship count/trust/time; device type/connectivity/battery; and opaque scenario/execution routing metadata. It explicitly removes `target_device_id` and omits precise coordinates, raw transcripts, audio, video, and unrestricted store records. These minimization rules do not replace consent or Hume's production data-processing review.

State selectors map to current steps, location, medication-adherence, or stress observations. Scenario update/memory operations are translated to the strict User State and Memory Net contracts before persistence; invalid shapes fail closed.

### 4.8 Account lifecycle and privacy fencing

`AINativeAccountLifecycle` exposes:

| Method | Result | Semantics |
| --- | --- | --- |
| `run(accountId, parentSignal, operation)` | operation result | Rejects fenced accounts, links cancellation, and tracks/drains in-flight account work |
| `deleteAccountData(accountId, dependencies)` | `{ scenarioExecutionsDeleted, userStateDeleted, memoriesDeleted, externalProviderDataDeleted: true }` | Fences Action Gateway and Scenario Engine, drains active work, then deletes encrypted aggregates and external provider/analytics data |

Deletion dependencies are the same `actionGateway`, `scenarioEngine`, `userState`, and `memoryNet` instances used by the runtime, plus mandatory `deleteExternalProviderData(accountId)`. That idempotent callback erases scenario analytics and provider-owned Hume/signal records. `actionGateway.fenceUserActions` is mandatory; deletion fails closed with `ACCOUNT_FENCE_UNAVAILABLE` if the durable action fence is missing. The method returns `externalProviderDataDeleted: true` only after the callback resolves. A fenced lifecycle is intentionally not reopened.

The runtime requires `accountLifecycle`; use the same instance in the privacy coordinator. Providers must honor abort signals and make side effects and deletion retries idempotent.

### 4.9 AI-native system composition

`createAINativeSystem(options)` in [AINativeSystem.ts](../server/src/orchestration/AINativeSystem.ts) is the supported composition boundary for the AI-native domain. It rejects missing repository capabilities or external privacy methods and returns one frozen object; the factory cannot prove that an implementation is process-durable, so production deployment validation must supply and test durable implementations:

```ts
interface AINativeSystem {
  userState: UserStateModel;
  memoryNet: MemoryNet;
  accountLifecycle: AINativeAccountLifecycle;
  scenarioEngine: ScenarioEngine;
  edgeScenarioRouter: EdgeScenarioRouter;
  getVoiceContext(accountId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  memory: {
    store(accountId: string, input: MemoryInput, options: MemoryMutationOptions & { idempotencyKey: string }): Promise<MemoryEntry>;
    list(accountId: string, query?: MemoryListQuery, signal?: AbortSignal): Promise<readonly MemoryEntry[]>;
    delete(accountId: string, memoryId: string, signal?: AbortSignal): Promise<boolean>;
    deleteAll(accountId: string, signal?: AbortSignal): Promise<boolean>;
  };
  privacyRepository: {
    exportUserData(accountId: string): Promise<unknown>;
    deleteUserData(accountId: string): Promise<unknown>;
  };
}
```

Required options are the Action Gateway (including outcome waiting and account fencing), ciphertext and scenario repositories, either a legacy 32-byte encryption key or a versioned encryption keyring, scenario identity secret, Hume consent/session, signal, notification, SMS, and analytics providers, plus `externalPrivacyProvider` with both `exportUserData(accountId, signal)` and `deleteUserData(accountId)`. Every required method is checked when the factory is constructed. The export provider must honor its `AbortSignal`; deletion can then fence and drain a concurrent export. Optional bounded Scenario Engine and Edge Scenario Router policy values are accepted under `scenario` and `edge`; runtime objects containing unsupported override keys are rejected so policy cannot replace the factory's repositories, runtime, engine, or telemetry ingestor.

The factory registers all five default scenario definitions, creates the shared deletion lifecycle, and wires telemetry ingestion into edge routing. Its privacy export joins encrypted state, summary memory, every scenario snapshot through `listAll`, and provider-owned export data. Its deletion path uses the shared fence and does not report `externalProviderDataDeleted: true` until the provider erasure resolves.

This is a domain composition API, not a credential or database factory. `clm-server.cjs` consumes an injected instance for its authenticated controllers. Callers must not represent the path as deployed until durable implementations, startup recovery ownership, credentials, ingress authentication, and environment-specific validation are present.

### 4.10 Edge Scenario Router

`EdgeScenarioRouter` is a post-authentication domain router. Construct it with a Scenario Engine and optional policy:

| Option | Default | Valid range |
| --- | --- | --- |
| `maxTelemetryAgeMs` | 30,000 | 1,000–300,000 |
| `maxFutureSkewMs` | 2,000 | 0–60,000 |
| `fallConfidenceThreshold` | 0.8 | 0–1 |
| `stressThreshold` | 70 | 0–100 |
| `helpConfidenceThreshold` | 0.75 | 0–1 |
| `fallEpisodeCooldownMs` | 5,000 | 1,000–300,000 |
| `stressEpisodeCooldownMs` | 900,000 | 10,000–86,400,000 |
| `helpEpisodeCooldownMs` | 30,000 | 1,000–1,800,000 |
| `episodeSourceStaleMs` | `max(30,000, maxTelemetryAgeMs)` | 1,000–3,600,000 |
| `maxEpisodeKeys` | 1,000 | 10–100,000 |
| `telemetryPersistenceTimeoutMs` | 100 | 10–5,000 |
| `robotSafetyMaxAgeMs` | 5,000 | 500–30,000 |

`telemetryStateIngestor` is the optional encrypted-state sink used before scenario routing. Persistence is bounded by `telemetryPersistenceTimeoutMs`; an error or timeout is reported through `onTelemetryPersistenceFailure('TELEMETRY_STATE_PERSIST_FAILED')` without making a life-safety trigger wait indefinitely. `robotSafetyMaxAgeMs` bounds how long a positive robot `safeToMove` observation may authorize the fall workflow's navigation branch.

Methods:

| Method | Mapping |
| --- | --- |
| `ingestWearableInference(accountId, envelope, binding, context?)` | High-confidence fall → `fall_detection`; threshold stress → `emotional_check_in` |
| `ingestRobotInference(accountId, envelope, binding, context?)` | High-confidence vision fall → `fall_detection`; help intent → `ai_angel_auto_dial`; local `cancel` intent → `cancellationRequested` only |
| `ingestContextEvent(accountId, event, binding)` | Medication due → `medication_adherence`; bedroom inactivity → `cognitive_engagement`; panic/voice emergency → `ai_angel_auto_dial` |
| `confirmCancellation(accountId, executionId, confirmation)` | Cancels that non-terminal execution only after an authenticated-user or authorized-caregiver confirmation |

`EdgeDeviceBinding` contains command targets and separately authenticated wearable/robot source references. The router rejects a source mismatch, malformed envelope/model metadata, stale/future observation, mutated same-sequence frame, or lower sequence before starting a scenario. Accepted frames for one source execute in sequence; failed exact frames may retry without lowering the high-water mark. It creates deterministic edge/context event and idempotency identifiers, coalesces continuous fall/stress/help episodes across sources, shares an in-flight episode start, rolls back admission after a transient start failure, applies bounded cooldowns, and expires a positive source after transport loss. Robot fall context carries `safeToMove`; a wearable fall authorizes navigation only from fresh authenticated robot safety telemetry. `EdgeRoutingResult.started` contains accepted scenario starts and may report `cancellationRequested`.

A bound robot's probabilistic local `cancel` intent never cancels an execution by itself. A trusted controller must correlate the request to a specific execution and obtain an authenticated user or authorized-caregiver confirmation before invoking `confirmCancellation`. Physical deployment still requires approved speaker/liveness and non-cancellable-side-effect rules.

The confirmation object is exactly `{ confirmed: true, source: 'authenticated_user' | 'authorized_caregiver', occurredAt }`. Its timestamp must pass the same freshness policy, and the referenced execution must exist in that account and remain non-terminal.

Errors are `EdgeScenarioRouterError` with `EDGE_EVENT_INVALID`, `EDGE_EVENT_STALE`, or `EDGE_SOURCE_MISMATCH`; messages omit raw telemetry and identity. Transport authentication and account binding retrieval happen before this API and must not be inferred from a matching source string alone.

## 5. Wearable Edge AI simulator

### 5.1 Construction and methods

```ts
const edge = new WearableEdgeAI({
  clockNow,       // optional () => Unix milliseconds
  random,         // optional deterministic generator
  staleAfterMs,   // optional, default 30,000
  maxFutureSkewMs // optional, default 2,000
});

const frame = edge.generateFrame({
  deviceRef: 'simulated-wearable',
  sequence: 1,
  profile: 'fall',
  batteryLevelPercent: 82
});
const envelope = edge.infer(frame);
const json = edge.serializeOutbound(envelope);
```

Profiles: `resting`, `walking`, `running`, `fall`, `stressed`.

`WearableSensorFrame` uses contract `vl-wearable-sensors/1` and contains a 32-sample synthetic accelerometer window, heart rate, HRV RMSSD, signal quality, skin temperature, and battery estimate. `WearableInferenceEnvelope` uses `vl-wearable-inference/1` and returns:

- `fallDetected` and `fallConfidence`;
- `stressScore` from 0–100;
- activity `resting`, `walking`, `running`, or `fall`;
- engineering-only estimated energy and daily additional drain.

The model metadata always declares `deterministic-simulation` and `clinicallyValidated: false`. The estimates do not close the target-hardware `<100 ms` or `<10% additional drain/day` acceptance gates.

`serializeOutbound` validates the envelope and rebuilds JSON from an explicit allowlist. Extra properties attached by an untyped caller—including raw sensor samples or unrelated private data—are not relayed.

`createWearableSeededRandom(seed)` supplies deterministic non-cryptographic randomness. Never use it for identifiers, keys, tokens, signatures, or security decisions.

### 5.2 Provisional firmware contract

`WEARABLE_EDGE_CONTRACT` specifies a Veryloving-owned boundary:

- input/output versions listed above;
- CBOR on firmware and structurally equivalent JSON in simulation;
- `uint16 length + uint32 sequence + payload + CRC32` framing;
- BLE GATT notification from firmware with mobile-to-cloud relay;
- maximum 4,096-byte frame;
- accelerometer in g, PPG heart rate in bpm, HRV RMSSD in ms, temperature in °C, UTC epoch-ms timestamps;
- proposed ARM Cortex-M4F/M33, 80 MHz, 256 KiB RAM, 1 MiB flash, int8 TFLM/equivalent target.

The production candidate recorded in the contract is an int8 1D depthwise-separable CNN with three temporal blocks, input tensor `[1, 128, 5]` (accelerometer x/y/z, normalized PPG, temperature delta), and separate fall-probability, stress-regression, and activity-softmax heads, capped at 120,000 parameters. This is a design candidate—not a trained artifact or validated model.

Manufacturer UUIDs, calibration, electrical behavior, processor resources, model accuracy, actual inference time, and battery measurements remain **BLOCKED — EXTERNAL**.

Errors are `WearableEdgeAIError` with `EDGE_INPUT_INVALID` or `EDGE_INPUT_STALE`. Error messages deliberately omit device/sensor values.

## 6. Robot Edge AI simulator

### 6.1 Construction and methods

```ts
const edge = new RobotEdgeAI({
  clockNow,
  random,
  staleAfterMs,   // optional, default 5,000
  maxFutureSkewMs // optional, default 1,000
});

const frame = edge.generateFrame({
  deviceRef: 'simulated-home-robot',
  sequence: 1,
  profile: 'help_request'
});
const envelope = edge.infer(frame);
const json = edge.serializeOutbound(envelope);
```

Profiles: `idle`, `navigating`, `fall`, `distressed`, `help_request`, `happy`.

`RobotEdgeFeatureFrame` (`vl-robot-edge-features/1`) contains bounded derived vision, acoustic/prosody, and motor features. It contains no bitmap, raw audio, transcript, voiceprint, or facial embedding. `RobotEdgeInferenceEnvelope` (`vl-robot-edge-inference/1`) returns:

- vision fall classification/confidence and a coarse facial-expression label;
- local voice intent/emotion/confidence with `processedOffline: true` for the simulator;
- motor state and `safeToMove` heuristic;
- metadata declaring deterministic simulation, no clinical validation, and no raw-media retention.

`serializeOutbound` validates the envelope and emits only the allowlisted inference fields; appended media, transcript, biometric, or private properties are stripped.

`createRobotSeededRandom(seed)` is deterministic and non-cryptographic. Errors are `RobotEdgeAIError` with `EDGE_INPUT_INVALID` or `EDGE_INPUT_STALE` and privacy-safe text.

### 6.2 Provisional hardware contract

`ROBOT_EDGE_CONTRACT` proposes:

- camera capture as RGB/NV12, at least 720p/15 fps, with features leaving the camera process;
- microphone capture as signed 16-bit little-endian mono PCM at 16 kHz, with derived features leaving the audio process;
- versioned CBOR over UART/USB CDC, COBS framing, sequence/timestamp/CRC, provisional 921,600 baud, and 16,384-byte maximum frames;
- manufacturer-approved fail-safe emergency-stop GPIO and optional inference-ready GPIO;
- 64-bit four-core ARM, at least 2-TOPS NPU/equivalent GPU, 4 GiB RAM, and 16 GiB available storage as proposed minimums.

Candidate production models are quantized pose features plus a temporal 1D CNN for fall detection, a quantized MobileNetV3-Small expression classifier with no embedding retention, and small-footprint keyword/intent plus prosody classifiers for offline voice. They are architecture candidates only.

Connector, voltage, GPIO polarity, serial speed, camera/microphone implementation, motor-controller safety, model/runtime compatibility, thermal behavior, and measured latency remain **BLOCKED — EXTERNAL**.

## 7. Authenticated server transport API

These controllers are mounted by [clm-server.cjs](../server/clm-server.cjs) only when an injected AI-native system and the required trust hooks are available. `accountId`, command device IDs, source bindings, fall-navigation safety, and cancellation identity are derived server-side; none may be supplied as arbitrary client fields.

| Route | Authentication | Exact purpose |
| --- | --- | --- |
| `POST /v1/scenarios` | First-party app JWT | Starts only `ai_angel_auto_dial`; body is exactly `{ scenario_id, request_id, occurred_at }` and device targets are resolved server-side |
| `GET /v1/scenarios/{executionId}` | First-party app JWT | Returns that account's execution snapshot or 404 |
| `POST /v1/scenarios/{executionId}/cancel` | First-party app JWT | Requires exactly `{ confirmed: true, occurred_at }`; the server supplies authenticated-user cancellation identity |
| `POST /v1/edge/wearable/inference` | First-party app JWT | Accepts exactly `{ envelope, context? }`; `resolveEdgeDeviceBinding` must bind the relayed wearable source to the account |
| `POST /v1/edge/robot/inference` | Robot callback headers | Requires `X-Robot-Adapter-Id` plus `X-Robot-Callback-Key`, no bearer token, and an `authenticateRobotEdgeIngress` result bound to the envelope source |
| `POST /v1/scenarios/context-events` | Dedicated scheduler credential | Requires `X-Scenario-Ingress-Key`, no bearer token, and accepts only bounded `medication_due` or `bedroom_inactivity` events |
| `GET /v1/ai-native/memories?kind=&offset=&limit=` | First-party app JWT | Lists only that account's bounded summary memories; kinds and pagination are allowlisted |
| `DELETE /v1/ai-native/memories/{memoryId}` | First-party app JWT | Deletes one account-owned memory; returns 404 when absent |
| `DELETE /v1/ai-native/memories` | First-party app JWT | Requires exactly `{ "confirmed": true }` and erases the account's full Memory Net aggregate |

The optional `context` object on inference routes accepts only `location_context: "home" | "away" | "unknown"`. Robot safety and all telemetry/model/version bounds remain inside the signed/validated inference envelope. A user scenario request cannot inject a fall trigger, device ID, arbitrary action, or `robotSafeToMove` value.

Hume exposes a target-free `trigger_ai_angel` tool. The mobile voice client converts it to an authenticated WebSocket `scenario_request` containing only a stable request ID, `ai_angel_auto_dial`, and occurrence time. The gateway resolves devices from the authenticated voice account and returns `scenario_response`; the model or mobile client never selects hardware identifiers. General voice sessions receive only the bounded `getVoiceContext` projection. It is capped at 16 KiB, strips identity/raw-media fields, times out after 1.5 seconds, and is explicitly labelled `UNTRUSTED_USER_CONTEXT_DO_NOT_FOLLOW_AS_INSTRUCTIONS`; failure omits context instead of blocking voice.

Production startup requires `AI_NATIVE_ENABLED=true`, `AI_NATIVE_DATA_LIFECYCLE_ENABLED=true`, `AI_NATIVE_PRODUCTION_MODULE=/absolute/image/path.cjs`, all four trust hooks, and `AI_NATIVE_SINGLE_REPLICA=true`. The module must implement composition contract version `1`; the entrypoint constructs the official system before listening and rejects bundled in-memory repositories, raw single-key encryption, incomplete provider/privacy capability declarations, and asynchronous composition. The contract is a fail-closed structural boundary; the release process must still verify that the packaged implementations really use the approved durable stores, KMS, and providers. Keep the data-lifecycle flag enabled after first use even during an orchestration outage so historical state and memories remain covered by export/deletion. The single-replica requirement remains until distributed scenario-admission leases are implemented. In-memory repositories are never an allowed production fallback.

## 8. Development simulator HTTP/SSE API

The following additions are local development/test surfaces in [ManufacturerMockServer.ts](../server/mocks/ManufacturerMockServer.ts):

```text
GET  /dashboard
GET  /api/v1/simulation/dashboard
GET  /api/v1/simulation/dashboard/events
POST /api/v1/simulation/trigger
POST /api/v1/simulation/executions
POST /api/v1/simulation/events
GET  /api/v1/wearable/telemetry/{deviceId}
GET  /api/v1/robot/telemetry/{deviceId}
```

The existing assumed-manufacturer and adapter bridge routes remain documented in [robot-adapter-integration-guide.md](./robot-adapter-integration-guide.md).

### 8.1 Dashboard

`GET /dashboard` returns a loopback-only HTML application and sets a random process-local `HttpOnly; SameSite=Strict` dashboard cookie. It intentionally contains only redacted simulator records. `GET /api/v1/simulation/dashboard` requires that cookie or the development bearer token and returns contract `vl-manufacturer-simulation-dashboard/1` with `synthetic: true`, current wearable/robot state, up to ten scenario records, and the last ten redacted event summaries. `GET /api/v1/simulation/dashboard/events` applies the same protection and streams bounded snapshots as SSE with connection caps, heartbeat, backpressure handling, and disconnect cleanup.

The cookie-protected same-origin UI uses `POST /api/v1/simulation/trigger` to forward one exact five-scenario request to the configured loopback main server. `POST /api/v1/simulation/executions` accepts only the fixed `{ "userId": "<AI_NATIVE_DEMO_USER_ID>" }` account (default `test-user-1`) and reads its bounded main-server execution list. Both mutation routes additionally require an exact same-origin `Origin` (and, when supplied, `Sec-Fetch-Site`) header; bearer access remains available to automated local tests. Upstream destinations are fixed, loopback-only, credential-free, timed, and response-size bounded.

When the in-memory AI-native demo is enabled, its loopback wrapper accepts the five camel-case aliases at `POST /v1/scenarios` and exposes `GET /v1/scenarios/executions?userId=test-user-1`. The configured demo user is fixed by `AI_NATIVE_DEMO_USER_ID`; this does not create a caller-selectable production account API. Requests and returned snapshots are strictly validated, bounded, redacted, and unavailable in production. See [demo-dashboard.md](./demo-dashboard.md) for the exact local shapes.

The in-process `recordScenarioExecution({ scenarioId, status, wearableDeviceId?, robotDeviceId? })` helper accepts status `started`, `completed`, `fallback`, `failed`, or `cancelled`. It one-way hashes device IDs before retaining the bounded record.

### 8.2 Event injection

`POST /api/v1/simulation/events` requires the development bearer token and exactly this shape:

```json
{
  "device_id": "simulated-wearable",
  "device_type": "wearable",
  "event_type": "fall_detected"
}
```

Allowlisted events are `fall_detected`, `stress_spike`, `medication_reminder`, `device_offline`, and `device_online`. `stress_spike` is wearable-only; `medication_reminder` is home-robot-only. A successful injection returns HTTP 201 with `accepted: true` and a synthetic event containing only a one-way device reference. Request size, identifiers, exact keys, and combinations are bounded. The route must not be generalized into arbitrary command execution or enabled in production.

Injection does not automatically start a scenario. Integration tests or a trusted local demo driver must authenticate/bind the event and call `ScenarioEngine.startScenario`; a production ingestion controller is a separate security boundary.

### 8.3 Telemetry streams

- `GET /api/v1/wearable/telemetry/{deviceId}` emits SSE event `wearable.telemetry` using contract `vl-simulation-wearable-telemetry/1`: the bounded synthetic sensor frame, inference envelope, battery, fictional location, and generated event summaries.
- `GET /api/v1/robot/telemetry/{deviceId}` emits SSE event `robot.telemetry` using contract `vl-simulation-robot-telemetry/1`: bounded derived feature/inference envelopes, motor state, and generated event summaries. It explicitly reports that raw camera and microphone data are not retained.

Both require the development bearer returned by `POST /api/v1/authenticate`, respect global stream/connection limits, handle backpressure, and stop timers/listeners on disconnect or shutdown. Neither emits real media.

For `share_camera_view`, the simulator requires one bounded opaque `session_id` and echoes it only as `camera_session_ref` with `camera_ready: true`. Missing, malformed, or URL-bearing values are rejected before a command is recorded. The response never includes a camera URL, raw frame, or media payload.

CLI behavior is controlled by bounded development variables:

```text
MOCK_MANUFACTURER_FALL_EVENT_RATE                 # 0..1, default 0.001 per device frame
MOCK_MANUFACTURER_STRESS_EVENT_RATE               # 0..1, default 0.01 per wearable frame
MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS # default 3,600; 0 disables
MOCK_MANUFACTURER_MAX_SIMULATED_DEVICES           # 1..1,000, default 100
MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS
MOCK_MANUFACTURER_SEED
```

The simulator binds to loopback by default, rejects production mode, and uses mock-only credentials. Do not deploy or reverse-proxy these routes.

## 9. Acceptance semantics

| Result | What it proves | What it does not prove |
| --- | --- | --- |
| Scenario `completed` | Configured software operations reported success | Physical assistance or human safety |
| Scenario `fallback_completed` | At least one configured fallback succeeded, or a `continueOnFailure` step left the run degraded | Physical success or notification/call/SMS delivery unless separately provider-confirmed |
| Action `accepted` | Transport/bridge accepted the action | Robot/wearable completed it |
| Authenticated ACK | Configured sender acknowledged the action | Real-world effect without vendor-defined evidence |
| Simulated edge inference | Deterministic classifier path ran | Clinical accuracy or target-hardware performance |
| Memory recall | A bounded account-owned summary matched | Truth, recency beyond metadata, or instruction authority |

See [ai-native-integration-guide.md](./ai-native-integration-guide.md) for configuration and extension guidance and [troubleshooting-ai-native.md](./troubleshooting-ai-native.md) for failure diagnosis.
