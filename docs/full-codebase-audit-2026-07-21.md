# Full Codebase Audit — Product 1 and Product 2

Audit date: 21 July 2026

Branch: `features/dual-product-draft`

Audited baseline: `ff3b33d`

Audited implementation commit: `3cf50c8`

Audit disposition: **SOURCE + MOCK READY; NO-GO FOR PRODUCTION RELEASE**

## Executive disposition

The mobile application, backend, dual-vendor hardware abstraction layer, AI-native orchestration, and manufacturer simulator have received a repository-wide failure-mode audit. The audit records 74 findings: 66 source defects fixed and verified, one source/documentation boundary already passing, three internal production gates, and three hardware/vendor/deployment blockers. The corrected defects include account-boundary races, replay windows, permanently stranded safety deliveries, unbounded provider responses, incomplete cancellation, stale asynchronous mobile updates, queue-order violations, and simulator idempotency/shutdown defects. Regression coverage was added for the corrected paths.

The audited implementation commit is suitable for mock-backed demonstrations and the next manufacturer-integration phase. It is **not approved for production safety use**. Production remains a no-go until the exact vendor contracts and devices, physical BLE/robot testing, production identity/communications credentials, durable multi-process AI-native composition, provider delivery evidence, operational drills, and clinical/regulatory claims are independently accepted.

The external-dependency register contains 13 gates. The Yongyida and Jiangzhi NDAs are confirmed complete (**2/13 PASS**); the other **11/13 remain BLOCKED — EXTERNAL**. The next action is for Grace to send the technical-package request in [`ask-templates.md`](./ask-templates.md) to both manufacturers.

## Status language

| Status | Meaning |
| --- | --- |
| **FIXED — verified** | A source correction, focused regression evidence, and the aggregate verification gates exist for audited implementation commit `3cf50c8`. |
| **PASS — automated** | The named command passed against the immutable candidate recorded in this report. |
| **PASS — mock only** | Behavior was exercised against in-memory/test repositories or the manufacturer simulator; it is not hardware/provider evidence. |
| **BLOCKED — EXTERNAL** | No source-only action can close the gate; a vendor, credential owner, hardware unit, provider, clinical owner, or release operator must act. |
| **OPEN — INTERNAL** | Repository or operational work remains and is not dependent on an external party. |

## Methodology and scope

The audit combined:

- diff and call-path review of the HTTP server, WebSocket voice gateway, authentication/session repository, phone verification, safety/push services, manufacturer clients, robot pairing/reset/privacy flows, graceful shutdown, and environment composition;
- strict TypeScript review of both robot adapters, the adapter runtime, AI-native runtime, Scenario Engine, Edge Scenario Router, state/memory repositories, scenarios, and manufacturer simulator;
- mobile lifecycle review of authentication, account switching, AsyncStorage/SecureStore recovery, BLE/GATT, device queues, telemetry, Mapbox source updates, Hume voice/audio, notifications, emergency contacts, safety events, privacy, and localization-sensitive feedback;
- adversarial review for process death, duplicate/replayed requests, response loss, delayed promises, ignored abort signals, malformed/oversized responses, offline recovery, cross-account state, concurrent commands, and shutdown with active work;
- deterministic unit/integration tests, type checking, lint, environment validation, Expo Doctor, production JavaScript exports, dependency audit, and a local mock-backed smoke flow.

This is a source audit, not a penetration test, clinical validation, radio/firmware assessment, provider certification, load certification, or physical-device acceptance campaign.

## Detailed findings and fixes

Line references identify the audited candidate location or the named function when edits may shift exact line numbers.

### Backend, identity, safety, and integrations

| ID | Severity | Evidence | Root cause / failure mode | Resolution | Status and regression evidence |
| --- | --- | --- | --- | --- | --- |
| BCK-001 | High | `server/clm-server.cjs:609` `readJson`; `server/bounded-response.cjs` | Request and upstream bodies could be materialized without one consistent byte/deadline contract. A slow or oversized peer could retain memory/handles. | Added bounded streaming readers, content-length preflight, abort-aware deadlines, reader cancellation, and normalized safe errors. | **FIXED — verified**; `server/bounded-response.test.cjs`, `server/clm-server.test.cjs`. |
| BCK-002 | High | `server/clm-server.cjs:644` `readBoundedResponseJson`; `server/auth-session.cjs:12`; `server/phone-auth.cjs:266` | JWKS, identity verifier, model, Hume, and Twilio calls had inconsistent response caps or did not settle promptly when a provider ignored abort. | Added per-provider response ceilings, explicit deadlines, cancellation races, and late-rejection observers. | **FIXED — verified**; `server/auth-session.test.cjs`, `server/phone-auth.test.cjs`, `server/clm-server.test.cjs`. |
| BCK-003 | Medium | `server/clm-server.cjs:805-902` SSE relay | Cancelling `response.body` while a reader held its lock was invalid and could leave an upstream stream alive after the client left. | The relay now owns/cancels the reader, bounds individual/buffered SSE events, and races reads with disconnect. | **FIXED — verified**; `server/clm-server.test.cjs`. |
| BCK-004 | Critical | `server/auth-session-repository.cjs:createOrUpdateAccount`, `rotateRefreshSession` | Separate account/session writes allowed delete-versus-login and delete-versus-refresh races to recreate or authenticate a deleted account. | Account state and session mutations now use transactional account guards and fail closed on unavailable fences. | **FIXED — verified**; `server/auth-session-repository.test.cjs`. |
| BCK-005 | High | `server/auth-session-repository.cjs:rotateRefreshSession` | A concurrent refresh conflict could be misclassified as token replay and revoke a valid family. | Rotation distinguishes the idempotent/concurrent winner from genuine reuse while preserving replay-family revocation. | **FIXED — verified**; repository and `server/auth-session.test.cjs`. |
| BCK-006 | High | `server/auth-session-repository.cjs:122` `deleteAllSessionKeys` | Session deletion was not safely resumable across pagination/batch failures, risking residual valid sessions after account deletion. | Added complete pagination, bounded batch retries, deletion-state fencing, and restart-safe cleanup. | **FIXED — verified**; `server/auth-session-repository.test.cjs`. |
| BCK-007 | Medium | `server/auth-session-repository.cjs:384-397` | An account with excessive session records could create an unbounded privacy export. | Export now enforces a 10,000-record ceiling and fails explicitly above it. | **FIXED — verified**; `server/auth-session-repository.test.cjs`. |
| BCK-008 | Critical | `server/auth-session.cjs`; `server/clm-server.cjs:583-586` | Some paths could continue when durable account-availability state was missing, undermining deletion/account isolation. | Protected mutations and AI-native ingress require a valid subject and a successful account-availability fence. | **FIXED — verified**; `server/clm-server.test.cjs`, `server/auth-session.test.cjs`. |
| BCK-009 | Critical | `server/phone-auth.cjs:352` `consumePhoneVerificationChallenge` | A signed phone verification challenge remained replayable, including concurrent verification attempts. | Verification now consumes a versioned, expiring challenge JTI before minting a session; duplicate use returns `410`. DynamoDB is required in production; development uses a bounded in-memory store. | **FIXED — verified**; `server/phone-auth.test.cjs`, `server/auth-session-repository.test.cjs`. |
| BCK-010 | High | `server/push-notifications.cjs:createDynamoPushRepository`; `src/services/notifications.js` | A device push token could remain registered to the previous account after logout/account switching, leaking notifications across accounts. Network loss during logout made access-token-only unregistration unreliable. | Registration is account guarded and returns a high-entropy, server-hashed capability receipt. Mobile persists only the receipt, retries receipt-based unregister at startup/foreground/logout, and authenticated unregister remains available. | **FIXED — verified**; `server/push-notifications.test.cjs`, `tests/push-token-lifecycle.test.cjs`. |
| BCK-011 | High | `server/push-notifications.cjs:8-11,547-633` | Token cardinality, payload size, provider response size, and provider completion were not uniformly bounded. | Added per-account/token and batch limits, notification/response byte caps, provider timeout/abort races, invalid-token cleanup, and bounded receipt endpoint admission. | **FIXED — verified**; `server/push-notifications.test.cjs`. |
| BCK-012 | Critical | `server/safety-api.cjs:179` repository mutations | Safety/contact records could be created or changed concurrently with account deletion without an atomic account fence. | Safety, medical, contact, SOS, and medication mutations use account-guarded transactions and fail closed. | **FIXED — verified**; `server/safety-repository.test.cjs`, safety suites. |
| BCK-013 | High | `server/safety-api.cjs:295-336,863` | Safety privacy export/delete could be incomplete, unbounded, or leave batch remnants after throttling. | Added paginated bounded export, export-byte limit, retrying batch deletion, and explicit over-limit failure. | **FIXED — verified**; `server/safety-repository.test.cjs`, `server/safety-medical.test.cjs`. |
| BCK-014 | High | `server/safety-api.cjs:30` `validateContactInput`; contact repository | Concurrent emergency-contact creates could exceed the intended account limit or produce inconsistent phone ownership. | Added normalized validation, account-guarded count/update transactions, conflict handling, and deterministic capacity enforcement. | **FIXED — verified**; `server/safety-repository.test.cjs`, `tests/emergency-contact-edit.test.cjs`. |
| BCK-015 | Critical | `server/safety-api.cjs:359-447` delivery claim | A process crash after a one-time delivery claim permanently stranded a life-safety notification. A transient provider failure could never retry. | Claims are 60-second UUID leases with a maximum of five attempts. Completion is token-conditioned; expired pending/failed work can be reclaimed without allowing two valid owners. | **FIXED — verified**; safety repository/delivery regressions. |
| BCK-016 | High | `server/safety-api.cjs:935-1070` | Duplicate SOS/medication submissions did not consistently distinguish an identical retry from idempotency-key reuse with changed content. | Existing records are compared against canonical request content; matching retries return the stored acceptance and mismatches return `409`. | **FIXED — verified**; `tests/safety-api.test.cjs`, `server/safety-medical.test.cjs`. |
| BCK-017 | High | `server/manufacturer-client.cjs:65-109` and request clients | Manufacturer pairing/status/reset/privacy calls could accept oversized/malformed bodies or outlive their request timeout. | Added bounded streaming reads, deadline races, body cancellation, strict object/status validation, and stable privacy idempotency keys. | **FIXED — verified**; `server/manufacturer-integration.test.cjs`, pairing/reset/privacy tests. |
| BCK-018 | High | `server/manufacturer-client.cjs` response parsers | A vendor `202`, `206`, rejected, or cancelled response could be collapsed into a false final success. | Parsers preserve provisional/final status and reject non-contract states; async work remains pending until a durable final ACK. | **FIXED — verified**; manufacturer and adapter tests. |
| BCK-019 | High | `server/robot-pairing.cjs`; `server/robot-reset.cjs` | Pairing/reset failure logs and errors could expose stable hardware identity, and response-loss paths could break same-account recovery. | Hardware references are hashed/redacted; binding generations fence stale work; one-time pairing supports only same-account interrupted-response recovery. | **FIXED — verified**; `tests/robot-pairing-credentials.test.cjs`, `server/robot-reset.test.cjs`. |
| BCK-020 | High | `server/action-gateway.cjs` delivery and callbacks | Caller abort was not propagated through every adapter step; callback/status response bodies were not always drained; a stale binding could complete after reset/re-pair. | Propagated `AbortSignal`, added per-stage deadlines/body cleanup, and enforced device/binding/adapter generation at dispatch and ACK completion. | **FIXED — verified**; `server/action-gateway.test.cjs`, `server/robot-adapter-runtime.test.cjs`. |
| BCK-021 | High | `server/voice-gateway.cjs:400-662` | Voice WebSockets lacked comprehensive control-message admission and backpressure limits; slow clients/upstreams could grow buffered state or monopolize work. | Added max payload/buffered bytes, authentication/session timers, four in-flight controls, 30 controls/minute, safe socket-state sends, and bounded AI context. | **FIXED — verified**; `server/voice-gateway.test.cjs`. |
| BCK-022 | Medium | `server/graceful-shutdown.cjs:3-71`; `server/server.cjs` | Invalid listen ports and non-settling cleanup operations could prevent predictable startup/shutdown. | Added strict port parsing, one-shot shutdown, bounded cleanup/drain, socket/server close coordination, and nonzero timeout outcome. | **FIXED — verified**; `server/graceful-shutdown.test.cjs`, environment tests. |
| BCK-023 | High | `server/environment-schema.cjs:14`; `scripts/validate-env.cjs` | Numeric environment values accepted overflow, partial strings, or unsafe ranges, producing surprising runtime behavior. | Centralized safe-integer/range validation and mirrored it in startup and validation tooling. | **FIXED — verified**; `server/environment-schema.test.cjs`, `tests/validate-env.test.cjs`. |
| BCK-024 | Medium | `server/clm-server.cjs:163` `validateServerURL` | Distributed production endpoints could contain query/fragment components, enabling configuration confusion and accidental secret propagation. | Production URLs require HTTPS and reject credentials, query strings, and fragments; local loopback is limited to development. | **FIXED — verified**; server/env/config tests. |

### HAL and vendor adapters

| ID | Severity | Evidence | Root cause / failure mode | Resolution | Status and regression evidence |
| --- | --- | --- | --- | --- | --- |
| ADP-001 | High | `server/src/adapters/RestRobotAdapter.ts:273` `readBoundedJsonObject` | A response without a streaming reader could be materialized without a trustworthy declared size. | Non-stream fallback now requires a valid `Content-Length`; streaming responses are counted and cancelled at the byte ceiling. | **FIXED — verified**; `adapter-branches.test.ts`. |
| ADP-002 | High | `RestRobotAdapter.ts:304-334,1164-1221` | Cancellation did not interrupt retry waits, initialization, request parsing, or delivery outcome polling consistently. | `AbortSignal` now crosses the runtime/factory/adapter boundary, interrupts fetch and retry sleep, cancels response readers, and maps to `ADAPTER_CANCELLED`. | **FIXED — verified**; adapter branch and runtime tests. |
| ADP-003 | High | `RestRobotAdapter.ts:359-630` | Shape-only vendor responses could contain excessive arrays, invalid numbers, stale timestamps, or ambiguous status values. | Added strict command/status/safety/call/battery/telemetry parsers and explicit caps for vitals, paths, safety events, and medication ACKs. | **FIXED — verified**; adapter unit/coverage suites. |
| ADP-004 | Medium | `RestRobotAdapter.ts:1046-1090` | Generated/replayed commands were not uniformly bound to a validated idempotency key. | Each command uses a constrained caller key or cryptographically generated key and forwards it as `Idempotency-Key`. | **FIXED — verified**; adapter tests. |
| ADP-005 | High | `server/robot-adapter-runtime.cjs` | Late adapter initialization/delivery could mutate runtime state after the caller was cancelled or the binding changed. | Runtime checks abort and immutable binding generation before and after async boundaries. | **FIXED — verified**; `server/robot-adapter-runtime.test.cjs`. |
| ADP-006 | External | `YongyidaAdapter.ts`, `JiangzhiAdapter.ts`; manufacturer requirements | Current transport contracts are provisional and tested only against mocks; vendor authentication, commands, telemetry, and firmware behavior are not documented/verified. | No honest source-only fix exists. Keep adapters behind configuration gates and complete conformance against each signed package/sandbox/unit. | **BLOCKED — EXTERNAL**; EXT-003 through EXT-009. |

### AI-native orchestration and scenarios

| ID | Severity | Evidence | Root cause / failure mode | Resolution | Status and regression evidence |
| --- | --- | --- | --- | --- | --- |
| AI-001 | Critical | `server/src/orchestration/ScenarioEngine.ts` cancellation path | Cancelling after robot navigation could leave a moving robot because cleanup inherited the already-aborted scenario signal. | Compensation uses an independent bounded signal and issues `emergencyStop` when navigation may have started. | **FIXED — verified**; `ScenarioEngine.test.ts` cancellation regressions. |
| AI-002 | High | `ScenarioEngine.ts` action-step outcome | A queued/accepted action could be recorded as delivered before the durable ACK outcome. | Step completion now waits for the action outcome and records delivered/rejected/timed-out state accurately. | **FIXED — verified**; scenario engine tests. |
| AI-003 | Medium | `ScenarioEngine.ts` telemetry/persistence callbacks | An analytics or persistence callback rejection could escape and destabilize scenario completion. | Auxiliary callbacks are observed, bounded, and isolated from the authoritative scenario transition. | **FIXED — verified**; scenario engine tests. |
| AI-004 | Critical | `server/src/orchestration/AINativeRuntime.ts:59-116` | Account deletion or caller cancellation could hang forever when an injected repository/provider ignored its signal, and late completion could write deleted-account data. | Lifecycle operations race an account-scoped abort fence and caller signal, observe late rejections, and reject before/after provider completion. | **FIXED — verified**; `AINativeRuntime.test.ts`. |
| AI-005 | High | `EdgeScenarioRouter.ts:479-612` | A simultaneous negative/cancel observation could suppress a positive fall event, losing the life-safety scenario. | Critical positive fall evidence wins the same observation window; cancellation cannot erase an already-admitted critical transition. | **FIXED — verified**; `EdgeScenarioRouter.test.ts`. |
| AI-006 | High | `EdgeScenarioRouter.ts:489,589,775-810` | Wearable and robot sources with the same opaque reference shared a deduplication namespace and could cancel/suppress one another. | Episode source identity now includes the device type (`wearable:` / `home_robot:`) before stable hashing. | **FIXED — verified**; edge router tests. |
| AI-007 | High | `EdgeScenarioRouter.ts:848-889` | Edge replay/freshness state could collide across accounts/contracts or accept stale/unbound observations. | Source keys bind account, contract, type, and source reference; schema, sequence, timestamp, binding, and freshness are validated before routing. | **FIXED — verified**; edge router tests. |
| AI-008 | Medium | `ScenarioEngine.ts` idempotency/cancellation transitions | Parallel starts/cancels could race repository transitions or repeat device actions. | Durable idempotency claims, terminal-state checks, execution-scoped cancellation, and ordered transitions guard each scenario. | **FIXED — verified**; scenario concurrency/cancellation tests. |
| AI-009 | High | `server/ai-native-demo.cjs:825-858` | Demo `POST /v1/scenarios` lacked caller idempotency; retries/double-clicks could create duplicate cross-device workflows. | Added validated `Idempotency-Key`, request fingerprint conflict (`409`), shared in-flight/result promise, and bounded 500-entry request ledger. | **FIXED — verified**; `server/ai-native-demo.test.cjs`. |
| AI-010 | High | `server/ai-native-demo.cjs` scenario admission/mirroring | Best-effort dashboard event writes occurred before durable scenario admission and were tied to response-close abort; a client disconnect could suppress a valid fall or show a rejected workflow. | Durable route/admission is authoritative; deterministic best-effort mirror events run afterward with independent lifecycle and stable keys. | **FIXED — verified**; demo and mock tests. |
| AI-011 | Production gate | `server/server.cjs`; AI-native demo composition | The demo runtime deliberately uses in-memory repositories and a loopback mock client. It cannot provide cross-replica durability, production encryption-key operations, or provider delivery. | Keep production AI-native flags disabled until durable repositories, key management, action providers, distributed admission, observability, backup/restore, and deletion verification are injected. | **OPEN — INTERNAL / production deployment gate**; mock operation may pass, production may not use demo composition. |

### Manufacturer simulator and dashboard

| ID | Severity | Evidence | Root cause / failure mode | Resolution | Status and regression evidence |
| --- | --- | --- | --- | --- | --- |
| SIM-001 | High | `server/mocks/ManufacturerMockServer.ts` mutation routes | Retried command/event/scenario mutations were not uniformly idempotent and could duplicate logs, queue work, or telemetry effects. | Added bounded fingerprinted idempotency ledgers; identical retries reuse the result and mismatched reuse returns `409`. | **FIXED — verified**; simulator tests. |
| SIM-002 | High | mock proxy and ACK client | Proxy/ACK readers and timeout handles could remain active during shutdown if a peer ignored abort. | All outbound reads are byte/deadline bounded, tracked as pending operations, abort-raced, drained for a bounded grace period, then detached safely. | **FIXED — verified**; simulator shutdown tests. |
| SIM-003 | Medium | mock telemetry/event stores | Synthetic event and execution arrays could grow indefinitely during a long demo/soak. | Device snapshots, last events, execution logs, idempotency records, and dashboard clients use explicit caps/eviction. | **FIXED — verified**; simulator bounded-storage tests. |
| SIM-004 | Medium | dashboard SSE endpoints | Disconnected/slow SSE clients could retain listeners or accumulate writes without backpressure handling. | Connections are limited/tracked, heartbeat and close cleanup are explicit, and snapshots remain bounded; failed writes remove the client. | **FIXED — verified**; simulator dashboard/SSE tests. |
| SIM-005 | Medium | dashboard trigger JavaScript and main-server bridge | Repeated button clicks had no stable retry identity and dashboard/main response parsing trusted loosely shaped data. | Each click generates an idempotency key, validates payload/response, renders safe text, and refreshes executions from the authenticated loopback bridge. | **FIXED — verified**; simulator/dashboard tests and the completed five-scenario smoke flow. |
| SIM-006 | Low | `ManufacturerMockServer.ts` lifecycle | Telemetry and scheduled-event timers could survive stop/restart or be registered twice. | Start/stop owns each timer, stream, request, and listener; stop is idempotent and clears all handles. | **FIXED — verified**; lifecycle tests. |
| SIM-007 | Scope boundary | simulator banner/contracts | Simulator output could be mistaken for vendor, medical, hardware, or production latency evidence. | UI/API contracts label generated data `synthetic`; documentation explicitly limits evidence to development/mock behavior. | **PASS — source documentation**, not production evidence. |

### Mobile application, BLE, voice, and account lifecycle

| ID | Severity | Evidence | Root cause / failure mode | Resolution | Status and regression evidence |
| --- | --- | --- | --- | --- | --- |
| MOB-001 | Critical | `src/context/AuthContext.js:95,145-410,773` | An older asynchronous session persist could clear the signed-out tombstone after logout. Process death in that window could restore the stale account. | Session generations fence every post-await write; logout writes the tombstone first, invalidates persistence, and preserves/rewrites it when a stale generation is detected. | **FIXED — verified**; `tests/auth-hardening.test.cjs`, persistence/account-boundary tests. |
| MOB-002 | High | `AuthContext.js`; `src/services/account-data-boundary.js` | Development demo activation could replace a real authenticated session, and account switching could expose stale local state. | Demo activation rejects an active real session; account-owner fencing clears sensitive caches before publishing the next account. | **FIXED — verified**; auth/account boundary tests. |
| MOB-003 | High | `src/context/AppContext.js:109-230` | Rehydration timeouts could spawn repeated uncancellable AsyncStorage/SecureStore operations on foreground/retry, retaining closures and publishing stale account data. | Hydration is account/generation fenced, single-flight, bounded, and guarded against repeatedly launching work behind a timed-out operation. Map/device state does not render as ready before the authoritative hydration settles. | **FIXED — verified**; `tests/persistence.test.cjs`, `tests/device-manager.test.cjs`. |
| MOB-004 | High | `src/services/device-manager/HomeRobotDevice.js:177-205,321-491` | Late REST/telemetry completions could mark a disconnected/replaced robot online or retry commands under the wrong lifecycle. | Lifecycle/network generations are checked before and after every async boundary; external calls are bounded and cancellation-safe; offline is explicit. | **FIXED — verified**; device-manager tests. |
| MOB-005 | High | `HomeRobotDevice.js:467`; `BaseDevice.js:60-100` | Reconnect could resume a newer queued command before re-inserting an older durable failed command, violating per-device FIFO. | The failed durable item is restored at the queue head before normal draining resumes. Every device owns an independent bounded queue/generation. | **FIXED — verified**; queue/offline/reconnect tests. |
| MOB-006 | High | `src/services/device-manager/WearableDevice.js:12-35` | Repeated telemetry subscriptions could overwrite the underlying BLE callback; one unsubscribe could disable other consumers. | Wearable telemetry uses a shared bridge with listener reference counting and removes the BLE handler only after the final subscriber leaves. | **FIXED — verified**; device-manager tests. |
| MOB-007 | High | `src/services/ble.js:225-240,385-430,663-682` | Native connect/cancel promises could settle late or never settle, poisoning in-flight maps and disconnecting a replacement connection. | Connect/disconnect operations are serialized and generation fenced; native cancellation is time bounded; in-flight maps are evicted independently of native settlement. | **FIXED — verified**; `tests/ble-reliability.test.cjs`. |
| MOB-008 | Medium | `src/services/ble.js` scan/primary listener paths | Concurrent scans and Bluetooth-state listeners could duplicate native work; a consumer exception could break primary BLE handling. | Scan requests coalesce, cancellation is idempotent, and primary/event listeners are isolated from one another. | **FIXED — verified**; BLE reliability tests. |
| MOB-009 | Medium | `app/(tabs)/map.js:38-48,136-175` | Hydrated device arrays could change while Mapbox retained a stale native ShapeSource; watchers could survive unmount. | Feature collections are rebuilt from both device arrays and explicitly pushed with `setNativeProps`; location/registry watchers clean up on dependency change and unmount. | **FIXED — verified**; location/device tests. |
| MOB-010 | High | `src/utils/bounded-http.js`; auth/Hume/safety clients | Mobile network calls could parse oversized bodies, wait indefinitely, or leave unread response streams. | Shared bounded HTTP helpers enforce timeout, content-length/stream byte caps, cancellation, and normalized abort errors across clients. | **FIXED — verified**; auth/safety/Hume client tests. |
| MOB-011 | High | `src/hooks/useHumeVoiceCall.js:225-443` | A stale async connect/fallback completion could attach handlers or publish state after a newer session/disconnect. | Connection generations fence setup, handler binding, fallback, tool actions, and post-await UI updates. | **FIXED — verified**; `tests/hume-evi-lifecycle.test.cjs`, `tests/hume-tools.test.cjs`. |
| MOB-012 | High | `src/services/websocket/hume-evi.js:23,182,419,790-865` | Voice input/output queues, socket buffering, transcripts, and playback segments could grow without strict limits; stale microphone callbacks could send after stop. | Added audio/message/text/echo caps, socket buffered-byte guard, segment validation, microphone generations, and deterministic cleanup/reconnect behavior. | **FIXED — verified**; Hume lifecycle/session/audio tests. |
| MOB-013 | High | `src/services/audio.js:17-38,167-316` | Playback admission occurred after an asynchronous native file write. Many pending writes could retain unbounded base64, and cleanup could hang forever on a non-settling native promise. | Segment/byte slots are reserved before native I/O; queue and byte totals are capped; cleanup is deadline bounded; generations delete late files and release admission exactly once. | **FIXED — verified**; `tests/audio-service.test.cjs`. |
| MOB-014 | High | `src/services/safety-events.js:108-182` | A wearable/robot event burst could fan out duplicate critical workflows and grow dedupe/incident state. | Events are schema/freshness/source validated, deduplicated with a 256-entry cap, and coalesced into bounded concurrent incidents/cooldowns. | **FIXED — verified**; safety foundation/API tests. |
| MOB-015 | Critical | `src/services/emergency-contact-store.js:21-75` | An in-flight Account A contact load could repopulate the module cache after switching to Account B. | Cache ownership changes synchronously; generations fence late loads/persists, and account-boundary clearing activates the next owner before state publication. | **FIXED — verified**; `tests/emergency-contact-edit.test.cjs`, local-user-data tests. |
| MOB-016 | High | `src/services/notifications.js:19-151`; `AuthContext.js:433-445,773` | Offline logout had no durable way to remove a server push registration once its access token was discarded. | A non-PII capability receipt is stored securely and retried serially on foreground/startup/logout; registrations never store the prior account's access token locally. | **FIXED — verified**; push lifecycle tests. |
| MOB-017 | Medium | `src/utils/logger.js`; WebSocket/error paths | Arbitrary error/context objects could log stable identifiers, action parameters, or injected newlines. | Structured logging redacts sensitive keys and identifiers, sanitizes control characters, and bounds message/context size. | **FIXED — verified**; logger and quality tests. |
| MOB-018 | Medium | `app.config.js`; permission/config tests | Build profiles could unintentionally retain broad permissions or inconsistent privacy declarations. | Distributed profiles enforce HTTPS endpoints, camera remains scoped to robot QR pairing, inactive photo-library access is absent, and iOS privacy manifest access types are declared. | **FIXED — verified**; `tests/config-plugins.test.cjs`. |
| MOB-019 | External | BLE/GATT, audio, permissions, background lifecycle | Mocks cannot validate radio timing, VL01 firmware fragmentation/notifications, iOS process death/background modes, acoustic echo/barge-in, battery drain, or native permission recovery. | Execute the signed physical-device matrix against the exact VL01 firmware and production-profile build. | **BLOCKED — EXTERNAL**; hardware, Apple access, and release-build evidence required. |

### Build, deployment, and operational findings

| ID | Severity | Evidence | Root cause / failure mode | Resolution | Status and regression evidence |
| --- | --- | --- | --- | --- | --- |
| BLD-001 | High | `app.config.js`; build-profile tests | Preview/distributed builds could inherit local endpoints or permissive fallbacks. | Preview and production are treated as distributed; required endpoints are HTTPS and local production rejects invalid/missing values. | **FIXED — verified**; config tests and environment validation. |
| BLD-002 | Medium | `package.json`, `eslint.config.js`, `scripts/validate.cjs` | `expo-doctor` floated to an unreviewed latest version and some CJS scripts were outside lint scope. | Doctor is pinned to `1.20.1`; scripts are linted; the aggregate validation command includes deterministic configuration checks. | **FIXED — verified**; ESLint and Expo Doctor 20/20 passed. |
| BLD-003 | Medium | root/server lockfiles | A normal online `npm audit` was not available in the isolated audit environment. An offline audit can miss advisories absent from the local cache. | Both lockfiles were checked with `npm audit --offline`; production release must repeat an authenticated live-registry audit/SBOM scan and triage the immutable artifact. | **OPEN — INTERNAL release gate**; see dependency qualification below. |
| BLD-004 | Low | server container image and `eas.json` CLI constraint | The Node base image tag and EAS CLI semver range are mutable, reducing build reproducibility. No verified digest/exact supported EAS release was available during this source-only audit. | Record a reviewed Node image digest and exact EAS CLI version in the release change after artifact verification; do not invent a digest. | **OPEN — INTERNAL supply-chain gate**. |
| BLD-005 | External | production deployment | No source test proves cloud IAM, secret rotation, DNS/TLS, WAF/rate limiting, multi-AZ recovery, backups, alarms, or provider callbacks in the target account. | Run deployment, restore, key-rotation, abuse, incident, and rollback acceptance against the exact immutable candidate. | **BLOCKED — EXTERNAL** for accounts/credentials; operational approval also required. |

## Verification record

All source and configuration checks below ran against the exact content committed as audited implementation `3cf50c8`. The later documentation-only commit does not alter executable behavior. Mock/export evidence remains deliberately narrower than physical, provider, signed-build, or production evidence.

| Gate | Command / evidence | Candidate result |
| --- | --- | --- |
| Audited implementation | `git rev-parse HEAD` after executable commits | `3cf50c8` |
| Working tree | `git status --short` after executable commits | **PASS — only this report, README, and previously requested dashboard documentation remained for the documentation commit** |
| Diff hygiene | `git diff --check` before commits | **PASS** |
| Full deterministic suite | `npm test` | **PASS — 917/917** |
| Core/mobile/server JavaScript | full-suite subgroup | **PASS — 705/705** |
| TypeScript adapters/simulator | adapter/simulator subgroup | **PASS — 44/44**; 98.55% statements/lines, 91.20% branches, 97.26% functions |
| Manufacturer integration | integration subgroup | **PASS — 8/8** |
| AI-native | AI-native subgroup | **PASS — 160/160**; 97.62% statements/lines, 86.86% branches, 98.57% functions |
| Adapter soak | `npm run test:soak:adapters` | **PASS — 60 seconds, 4,611,721 commands, 0.019 ms sampled p95 admission, 449,320-byte heap growth, zero leaked handles** |
| ESLint | `npm run lint` | **PASS — no warnings/errors** |
| Adapter TypeScript | `npm run typecheck:adapters` | **PASS** |
| AI-native TypeScript | `npm run typecheck:ai-native` | **PASS** |
| Mock TypeScript | `npm run typecheck:manufacturer-mock` | **PASS** |
| Server builds | `npm --prefix server run build` | **PASS — adapters and AI-native** |
| Lockfile/install consistency | root and server `npm ci --dry-run --offline` | **PASS** |
| Mobile environment | `npm run validate-env` / development profile | **PASS — 0 errors; missing development-only optional settings remain warnings** |
| Server environment | `npm run validate-env:server` / server dry run | **PASS — 24 server checks, 0 warnings, 0 errors** |
| Expo Doctor | `npm run doctor` | **PASS — 20/20** |
| iOS production JS export | `npx expo export --platform ios` with production-safe public placeholders | **PASS — 2,610 modules; 9.7 MB Hermes bundle** |
| Android production JS export | `npx expo export --platform android` with production-safe public placeholders | **PASS — 2,693 modules; 9.9 MB Hermes bundle** |
| Root dependency audit | `npm audit --offline` | **PASS — 0 cached advisories**; live registry audit still required. |
| Server dependency audit | `npm --prefix server audit --offline` | **PASS — 0 cached advisories**; live registry audit still required. |
| Container image build | `docker` / compatible local engine | **NOT RUN — no Docker, Podman, or Colima executable was installed; source Dockerfile reviewed, image build remains a release gate** |
| Mock/main-server startup | isolated ports `3101`/`8887`, mock credentials | **PASS — all builds passed, main health `200`, dashboard `200`, and `[AI-Native] System injected` logged** |
| Scenario trigger | all five `POST /v1/scenarios` workflows | **PASS — five `202` responses and five terminal `completed` executions** |
| Idempotent replay/conflict | same key/body, then same key/changed body | **PASS — replay reused the execution ID; changed fingerprint returned `409 IDEMPOTENCY_CONFLICT`** |
| Execution feed/dashboard | executions endpoint + dashboard/SSE | **PASS — six completed executions after proxy trigger, two live devices, bounded records/events, and a valid SSE frame** |
| Graceful shutdown | terminate both locally started processes and inspect open handles | **PASS — both exited `0`; main logged graceful completion** |

## Dependency-audit qualification

The root and server offline audits reported zero vulnerabilities using the advisory metadata already present in the local npm cache. That is useful deterministic evidence, but it is not equivalent to a current registry-backed audit on 21 July 2026. A live audit was attempted but workspace security policy rejected sending the private dependency graph to the external npm registry; no workaround was used. Before any release candidate is promoted, Release Engineering must:

1. run live `npm audit` for both lockfiles in an approved environment;
2. generate and archive an SBOM for the immutable mobile and server artifacts;
3. scan the built container and native artifacts, not only the source lockfiles;
4. record accepted exceptions with owner, expiry, exposure analysis, and compensating controls.

No dependency was added merely to address this audit.

## Remaining internal gates

| Gate | Owner | Required evidence | Status |
| --- | --- | --- | --- |
| Production AI-native composition | Backend/Platform/Security | Durable encrypted repositories, KMS/key rotation, multi-process admission/leases, provider injection, backup/restore, deletion verification | **OPEN — INTERNAL** |
| Supply-chain reproducibility | Release Engineering | Reviewed immutable Node image digest, exact EAS CLI, live advisory/SBOM/container scans | **OPEN — INTERNAL** |
| Production operations | Platform/SRE/Security | WAF/rate limits, dashboards/alerts, on-call, recovery and rollback drills, capacity/load/soak evidence | **OPEN — INTERNAL**, partly credential-dependent |
| Safety delivery policy | Product/Safety/Privacy | Provider delivery/receipt semantics, escalation policy, human factors, consent, false-positive/negative acceptance | **OPEN — INTERNAL**, provider/hardware evidence required |

## Remaining external gates

The authoritative row-level detail, owner, unblocking action, and effort is in [`external-dependencies-dashboard.md`](./external-dependencies-dashboard.md).

| External group | Status | What closes it |
| --- | --- | --- |
| Yongyida mutual NDA | **PASS — 1/13** | Grace confirms signed; agreement stays outside source control. |
| Jiangzhi mutual NDA | **PASS — 1/13** | Grace confirms signed; agreement stays outside source control. |
| Yongyida technical package and sandbox | **BLOCKED — EXTERNAL** | Versioned API/SDK/auth/telemetry/ACK/reset/privacy package plus isolated credentials. |
| Jiangzhi source, Android HAL/BSP/OTA, and medical package | **BLOCKED — EXTERNAL** | Licensed repository and exact platform/sensor/certification artifacts. |
| Exact Y120 and Jiangzhi engineering units | **BLOCKED — EXTERNAL** | Received, inventoried units with frozen firmware/BOM and scoped peripherals. |
| Apple/APNs and Google/FCM production access | **BLOCKED — EXTERNAL** | Least-privilege production accounts/secrets and physical delivery evidence. |
| Twilio production SMS/voice | **BLOCKED — EXTERNAL** | Approved identities, credentials, callbacks, compliance, and target-market delivery tests. |
| Hume enterprise EVI | **BLOCKED — EXTERNAL** | Enterprise key/terms/quotas plus production load, reconnect, and revocation evidence. |

Quick count: **13 total; 2 PASS; 11 BLOCKED — EXTERNAL**. The next milestone is for Grace to send both manufacturers the technical-package request now that the NDAs are complete.

## Required physical and external acceptance

At minimum, the exact reviewed build must pass:

- VL01 BLE permission deny/retry, filtered scan, ownership/pairing, GATT discovery, fragmented writes, notification bursts, disconnect/reconnect, process death, iOS background/lock behavior, firmware reset/update, 24-hour soak, latency, and battery measurements;
- robot command/ACK/idempotency/binding-epoch/reset/privacy flows against each real vendor sandbox and exact hardware, including Wi-Fi loss, reboot, clock skew, stale ACK, vendor outage, navigation emergency stop, camera/microphone permissions, and 24-hour telemetry soak;
- production APNs/FCM, Twilio, Hume, Apple/Google identity, account deletion/export, key rotation/revocation, and guardian delivery/receipt paths;
- safety, privacy, accessibility, localization/native-speaker, clinical/medical-claim, and regulatory review appropriate to every target market.

Acceptance criteria must record build SHA/profile, app and firmware versions, device/BOM, backend deployment, provider tenant, test account, network conditions, timestamps, expected/actual result, reviewer, and retained evidence. A simulator or Expo JavaScript export cannot substitute for these results.

## Final recommendation

**GO** for mock-backed demonstration, continued internal development, and manufacturer technical-package/conformance work on audited implementation `3cf50c8`.

**NO-GO** for production release, emergency-care reliance, medical claims, unattended robot motion, or public deployment. The remaining constraints are substantive external and operational gates—not missing confidence language. Production approval requires the physical/vendor/provider/durable-operation evidence listed above and an explicit release decision by Engineering, Security, Privacy, Safety/Clinical, and Operations owners.
