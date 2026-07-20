# AI-Native Troubleshooting Guide

Status: development prototype — simulated devices and inference only

Last reviewed: 20 July 2026

## 1. Start with the assurance boundary

The local environment proves software orchestration against synthetic sensor, camera, voice, and transport events. It cannot prove real fall detection, autonomous navigation, medication ingestion, emotion accuracy, call/SMS delivery, clinical suitability, target-hardware latency, or battery impact.

Before debugging a production-style flow, identify which layer owns the failure:

1. simulated edge observation;
2. account-bound state or memory write;
3. scenario trigger and execution;
4. Action Gateway validation/signing/outbox;
5. wearable BLE or robot adapter transport;
6. asynchronous acknowledgement or fallback provider.

Keep diagnostic output privacy-safe. Never print authentication headers, keys, tokens, hardware serials, account IDs, phone numbers, medication details, health values, coordinates, raw conversations, camera frames, microphone audio, signed payloads, or action parameters. Use execution IDs, scenario IDs, step names, status codes, bounded error codes, latency, and one-way references.

## 2. Baseline checks

From the repository root:

```bash
npm run validate-env
npm run typecheck:adapters
npm run typecheck:manufacturer-mock
npm run typecheck:ai-native
npm run test:ai-native
npm test
```

For the full mobile/build gate:

```bash
npm run validate
```

Start the development simulator with deterministic happy-path behavior:

```bash
NODE_ENV=development \
MOCK_MANUFACTURER_FAILURE_RATE=0 \
MOCK_MANUFACTURER_FALL_EVENT_RATE=0 \
MOCK_MANUFACTURER_STRESS_EVENT_RATE=0 \
MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS=0 \
npm run mock:manufacturer
```

Open `http://127.0.0.1:3001/dashboard` for the local HTML dashboard. Machine-readable state is available at `GET /api/v1/simulation/dashboard`. These routes, the event injector, and both telemetry streams are development/test-only and must never be exposed as production services.

## 3. Common startup and configuration failures

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Simulator refuses to start | `NODE_ENV=production`, a non-loopback bind, invalid limits, or an occupied port | Use `development` or `test`, bind to `127.0.0.1`, validate numeric bounds, and select an unused `MOCK_MANUFACTURER_PORT` |
| `MOCK_MANUFACTURER_URL` rejected | URL is non-loopback, has a path/query/fragment/credentials, or is enabled in production | Use an origin such as `http://127.0.0.1:3001/` only in development/test |
| Adapter runtime reports missing build | TypeScript adapter output is absent | Run `npm run build:adapters` before starting the gateway |
| Signing-key error on signed-action mock route | Mock server lacks the matching Ed25519 public key | Configure the test public key that matches the Action Gateway test private key; never copy production keys into local files |
| Both adapters do not start | One is disabled or callback/outbound secrets collide | Enable each adapter separately and use distinct simulator-only callback placeholders; production credentials remain external |
| Hume voice flow is unavailable | Hume API/config/persona credentials are not provisioned | Exercise scenario event injection locally; Hume production behavior remains **BLOCKED — EXTERNAL** |
| Server rejects `AI_NATIVE_ENABLED` at startup | Durable system, durable data lifecycle, a required trust hook, or the temporary topology gate is absent | Inject `createAINativeSystem(...)`, keep `AI_NATIVE_DATA_LIFECYCLE_ENABLED=true`, provide `resolveEdgeDeviceBinding`, `authenticateRobotEdgeIngress`, `resolveScenarioDevices`, and `authenticateScenarioIngress`; set `AI_NATIVE_SINGLE_REPLICA=true` only for an intentionally single-replica deployment |
| Voice works but has no remembered context | Context read exceeded 1.5 seconds, failed validation, or was over 16 KiB | Inspect only the safe `AI_NATIVE_VOICE_CONTEXT_UNAVAILABLE` code; fix repository latency/shape and never log the omitted context |

Do not weaken production guards to make a local demo work. In particular, do not allow a remote mock URL, reuse a vendor credential as a mock key, disable action signature verification, or expose simulator routes on a public interface.

## 4. Scenario does not trigger

Check in order:

1. The scenario ID is one of `fall_detection`, `medication_adherence`, `emotional_check_in`, `cognitive_engagement`, or `ai_angel_auto_dial`.
2. The scenario is enabled in the engine configuration.
3. The authenticated controller supplied the correct `EdgeDeviceBinding`, including the expected telemetry source reference.
4. The edge/context event contract and bounded payload match the router method.
5. The event timestamp is inside the router and engine freshness windows.
6. Fall/stress thresholds are satisfied and the scenario is not merely a no-op inference.
7. The idempotency key has not already completed the same logical execution.

`EDGE_SOURCE_MISMATCH` means an envelope source does not equal the authenticated binding; do not bypass it by copying the envelope's value into the binding. `EDGE_EVENT_STALE` means the clock or event pipeline is outside the configured window. `EDGE_EVENT_INVALID` means shape, bounds, account/target identity, or policy configuration failed validation.

Use the correct ingress boundary: an app JWT may relay wearable inference, robot inference requires adapter/device callback authentication, and scheduled medication/occupancy events require the dedicated scheduler credential. Do not reuse one credential class for another route. `POST /v1/scenarios` intentionally accepts only the server-mapped AI Angel request and rejects client-selected devices or generic scenario triggers.

For local event injection, use `POST /api/v1/simulation/events` with the documented bounded simulator event shape, then let the trusted integration-test/demo driver map it to `ScenarioEngine.startScenario`. The injector alone does not start a workflow. The endpoint should reject malformed, oversized, unsupported, or unauthenticated input. It must not accept arbitrary commands, URLs, account selection, phone numbers, or manufacturer device identities.

If a duplicate produces no new actions, inspect the original execution: idempotent replay should return or join it. If the same key is reused with a different scenario or trigger payload, rejection is correct and prevents an accidental or malicious collision.

## 5. Scenario is stuck or out of order

| Observation | Diagnosis | Corrective action |
| --- | --- | --- |
| Execution remains active at one step | A dependency never resolved or timeout clock did not advance | Confirm every injected action returns/throws; in tests advance the controlled clock; keep timeouts bounded |
| Robot delay blocks unrelated wearable action | Shared global queue or awaited unrelated work | Preserve per-device queues and dispatch independent device branches concurrently where the workflow permits |
| Fallback runs twice | Side-effect child key is unstable or timeout and late success both won | Use stable child idempotency keys and an atomic terminal transition; ignore a late result after the fallback wins |
| Robot timeout sometimes has a different code | Durable ACK expiry raced the bounded outcome wait | Both are normalized to `ACTION_OUTCOME_TIMEOUT`; if another code appears, verify the current Scenario Engine build and Action Gateway outcome contract |
| Steps appear in the wrong sequence | Workflow definition does not express a dependency | Make the dependency explicit; do not rely on promise creation order or log timestamps alone |
| Critical work waits behind analytics | Priority scheduler or device queue did not honor priority | Confirm Critical > Standard > Background selection while preserving same-device safety ordering |
| Cancellation reports success but a call/message still happens | The side effect was already accepted externally or bytes may have left the process | Treat `ACTION_CANCELLED_NON_RETRACTABLE` or `nonRetractable: true` as unknown/possibly sent, expose that state to the UI, and preserve any late authenticated acknowledgement in the production audit schema |
| A duplicate stays `queued`/`running` after server restart | Durable snapshot survived but account reconciliation has not run | Do not start a second execution; invoke `reconcileAccountAfterRestart` under the deployment's single-owner policy and configure an idempotent Critical recovery provider |

The router reports a local robot `cancel` intent as `cancellationRequested` only. A trusted controller must correlate a specific execution and obtain an authenticated-user or authorized-caregiver confirmation before calling `confirmCancellation`. If a Critical execution stopped without that path, treat it as a safety defect; review speaker/liveness and non-cancellable-side-effect policy before hardware release.

An HTTP `202`, adapter `accepted`, or queue completion is not evidence of physical execution. Wait for the authenticated acknowledgement required by the workflow or take the documented fallback.

The engine deliberately does not resume ephemeral workflow input after process death. Its reconciliation API fails orphans closed and requires `onRecoveryRequired` before closing Critical work. Production still needs account enumeration, an explicit recovery-owner lease, provider idempotency, and deterministic crash tests.

## 6. The five scenario-specific checks

### 6.1 Fall response

- Confirm the wearable event includes the expected impact/inactivity classification and a fresh event ID.
- Confirm last location is an authorized state snapshot, not untrusted model text.
- If robot navigation fails or the robot is offline, emergency-contact fallback should begin without waiting for the voice-check timer.
- If no user response arrives, advance the configured 30-second policy timer in the test clock and verify exactly one escalation.
- If camera context is attached, verify the authenticated outcome reported `camera_ready: true` with the exact server-derived `camera_session_ref`; a generic command ACK is insufficient.
- A synthetic success does not validate physical detection, arrival, obstacle avoidance, camera coverage, or contact delivery.

### 6.2 Medication adherence

- Ensure the trigger comes from a trusted schedule and has an opaque reminder/medication identifier.
- Associate movement confirmation with the same reminder; generic steps or room movement do not prove medication ingestion.
- Advance the configurable 15-minute window in tests rather than sleeping.
- Verify push fallback precedes SMS and that both are idempotent.
- Do not log medication names, dosage, instructions, or notification bodies.

### 6.3 Emotional check-in

- Check HRV/stress sample freshness, threshold, confidence, and cooldown.
- Confirm only an explicit observer result with `responded: false` schedules the unanswered path; a timeout/provider failure must remain infrastructure failure rather than inferred silence.
- If Hume is unavailable, the implemented workflow requests the bounded `emotional_checkin_later` notification fallback; it does not fabricate a local Hume conversation.
- Treat stress/emotion outputs as wellness estimates, never diagnoses.

### 6.4 Cognitive engagement

- Validate the trusted scheduler's morning/inactivity policy and device clock/time zone. The current robot edge envelope does not report occupancy.
- Query wearable activity state after the scheduler trigger; accept only a current UTC-day step total and reject stale or regressing samples.
- Record a bounded engagement outcome only after an explicit response/no-response observation, not video or a raw conversation; observer failure should emit availability analytics.
- One missed response must not be labeled cognitive decline.

### 6.5 AI Angel auto-dial

- Confirm panic/fall/voice trigger authenticity and critical priority.
- Keep camera link creation, call initiation, and SMS as separately observable actions.
- Never build a camera link from a trigger/device ID or uncorrelated callback; the provider must resolve the opaque account/execution-scoped session only after matching readiness metadata.
- If Wi-Fi/robot delivery fails, the SMS fallback should use only the permitted location snapshot.
- The simulator does not call a person, send an SMS, or produce a real video stream. Twilio, APNs/FCM, Hume, camera authorization, and delivery verification remain external.

## 7. User State failures

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| State is absent after update | Wrong account context, validation rejection, or a non-persistent test repository | Confirm authenticated account scope, inspect the bounded error code, and use the intended repository |
| Trend query returns no samples | Time window excludes observations or field path is unsupported | Use explicit UTC bounds, check observation timestamps, and request an allowlisted trend field |
| Cross-account read succeeds | Critical authorization or encryption-context defect | Stop testing and treat as a release blocker; ensure the keyed opaque storage key is derived from the authenticated account and AES-GCM AAD binds domain, storage key, revision, and applicable key version |
| Decryption/authentication fails | Wrong key/version, corrupted ciphertext, or copied record | Fail closed; never return partial plaintext. Restore the approved key through the deployment keyring/recovery process or remove corrupted test data |
| Export omits records | Export implementation does not cover every state/history kind | Add the missing kind and a round-trip test before release |
| Delete returns but data remains | Only a cache was cleared or an external deletion is pending | Verify repository records, indexes, scenario analytics, outbox, memory, and vendor deletion workflow separately |

If a concurrent update or scenario start recreates data after deletion, the account lifecycle fence is missing or was checked too late. Transition the authenticated account to `deleting` before starting any delete and reject every new write until the complete privacy workflow finishes; do not try to solve this with a best-effort scan alone.

Encryption is not a substitute for authorization. The server must derive the account from the authenticated session; callers must not supply an arbitrary account and receive data merely because they know its identifier.

## 8. Memory Net failures

- Empty recall may be correct when no bounded record matches the requested kind, time range, or query terms.
- Unexpected recall ranking usually indicates missing source/confidence/timestamp metadata or a nondeterministic tie-breaker.
- A memory that resembles an instruction must remain quoted/untrusted context. It cannot override system policy, tool schemas, consent, device binding, or emergency rules.
- If raw transcript, audio, image, location, or health payload appears in memory, delete the test record and fix the summarization boundary.
- Specific deletion should remove only the requested account-owned memory. All-memory deletion should leave another account unchanged.
- Export must be user-readable, versioned, bounded, and free of ciphertext implementation details or secrets.

## 9. Edge simulation failures

### Wearable

Check units, sample interval, monotonic timestamps, deterministic seed, accelerometer magnitude, PPG/heart-rate bounds, temperature bounds, and output confidence. Repeated positive frames may repeat the classifier result, but `EdgeScenarioRouter` must coalesce them into one account-level fall episode until sources clear or cool down. A stress spike should use the documented HRV relationship but must remain labeled synthetic and non-clinical.

### Robot

Check camera-feature bounds, microphone-feature format, expression/fall labels, motor safety, sequence number, and deterministic seed. Occupancy and camera-ready are not robot edge outputs: the former is scheduler policy and the latter is a correlated manufacturer ACK. Raw simulated camera/microphone data should not be logged. If an offline result is expected, verify it queues or emits an explicit offline status instead of silently pretending cloud delivery succeeded.

If an edge envelope triggers correctly but no current-state projection appears, confirm the composed router has a `TelemetryStateIngestor`, check the bounded `TELEMETRY_STATE_PERSIST_FAILED` health signal, and verify that the durable store can meet the 100 ms default `telemetryPersistenceTimeoutMs`. State projection is best-effort on this path: do not duplicate a life-safety scenario merely because persistence timed out. A robot `safeToMove` value is also short-lived; check `robotSafetyMaxAgeMs` and the observation timestamp before treating skipped navigation as a defect.

### Hardware performance claims

Node.js elapsed time is not Cortex-M, Android NPU/GPU, or end-to-end hardware latency. Do not close the `<100 ms` wearable inference or battery `<10% per day` requirements with simulator measurements. Profile the signed release model on final hardware under representative sensor/radio/thermal conditions.

## 10. Simulator dashboard and streams

Development/test-only surfaces:

```text
GET  /dashboard
GET  /api/v1/simulation/dashboard
POST /api/v1/simulation/events
GET  /api/v1/wearable/telemetry/{deviceId}
GET  /api/v1/robot/telemetry/{deviceId}
```

If an SSE stream connects but emits nothing:

- confirm the bearer/API contract expected by the simulator;
- confirm the requested logical device identifier is valid;
- confirm the telemetry interval and connection/stream limits;
- inspect the JSON dashboard for online state;
- ensure the client consumes SSE records and has not paused indefinitely under backpressure.

If the dashboard is stale, fetch the JSON route directly. The HTML view is a projection, not a system of record. Restarting the simulator intentionally resets its in-memory development state.

## 11. Latency and performance tuning

The integration target for automated simulated scenarios is event-to-final-software-action under 500 ms where the workflow has no intentional human wait. Measure at least:

- trigger validation;
- state read/write;
- queue wait per device;
- adapter request and retry;
- scenario step/fallback transition;
- total elapsed time using a monotonic clock.

Do not include a 30-second response window or 15-minute medication window in the immediate-dispatch latency assertion; test timer policy separately with a fake clock. Report p50, p95, and p99 over a meaningful sample size. A single fast local run is not a production SLA.

For memory/soak diagnosis, monitor active timers, SSE clients, sockets, per-device queues, idempotency records, scenario executions, retained history, and heap after forced quiescence. Every subscription, timer, abort handler, and socket must be released during shutdown.

## 12. Escalation criteria

Stop and treat the issue as a release blocker if any test shows:

- cross-account state, memory, device, or scenario access;
- plaintext health/context/memory at rest or sensitive values in logs;
- unsigned, expired, replayed, cross-adapter, or old-binding actions being accepted;
- duplicate emergency/contact side effects for one idempotency key;
- Critical work silently dropped or falsely reported as delivered;
- simulator endpoints reachable in production mode;
- a claim of physical, clinical, Hume, provider, or manufacturer behavior supported only by a mock.

See [ai-native-integration-guide.md](./ai-native-integration-guide.md) for architecture and [api-reference-ai-native.md](./api-reference-ai-native.md) for method-level contracts.
