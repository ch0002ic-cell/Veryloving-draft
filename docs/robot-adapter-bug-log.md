# Robot Adapter Bug and Fix Log

Last reviewed: 18 July 2026
Format: GitHub-issue compatible local record

## Verification note

These entries record failure modes discovered and hardened during the Product 2 prototype. “Fixed” means the working tree contains a direct fix and a focused regression test. It does not mean a GitHub issue was opened, a vendor sandbox was contacted, or real hardware was validated.

Release status must be based on commands run against the final commit, not this document. No 24-hour/72-hour soak, physical Yongyida/Jiangzhi test, Android production-image test, medical-instrument validation, or physical safety/fall/emergency-stop validation is claimed here.

## Summary

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| ROBOT-BUG-001 | Critical | Fixed in code | Global vendor selection could not support a mixed fleet |
| ROBOT-BUG-002 | Critical | Fixed in code | One adapter callback could acknowledge another adapter's action |
| ROBOT-BUG-003 | Critical | Fixed in code | HTTP 202 or an unrelated receipt could be mistaken for delivery |
| ROBOT-BUG-004 | Critical | Fixed in code | Retry could duplicate a physical command |
| ROBOT-BUG-005 | High | Fixed in code | One stalled device could block unrelated device commands |
| ROBOT-BUG-006 | Critical | Fixed in code | Gateway restart could lose or replay robot work incorrectly |
| ROBOT-BUG-007 | High | Fixed in code | A fetch implementation ignoring abort could hang indefinitely |
| ROBOT-BUG-008 | High | Fixed in code | Malformed or oversized bridge data was not a safe status source |
| ROBOT-BUG-009 | High | Fixed in code | Concurrent initialization could cross-bind or poison an adapter |
| ROBOT-BUG-010 | Critical | Fixed in code | Replayed QR claims could threaten account ownership |
| ROBOT-BUG-011 | High | Fixed in code | Relay health or stale telemetry could create a ghost-online robot |
| ROBOT-BUG-012 | High | Fixed in code | Offline commands could be lost or misbound during recovery |
| ROBOT-BUG-013 | Critical | Fixed in code | Adapter logs could disclose identity, health context, or secrets |
| ROBOT-BUG-014 | Critical | Fixed in code | Async reset/privacy receipt could cause false data-erasure success |
| ROBOT-BUG-015 | High | Fixed in code | A stalled HTTP response body could outlive the adapter timeout |
| ROBOT-BUG-016 | Critical | Fixed in code | Reset/privacy could cross vendor boundaries in a mixed fleet |
| ROBOT-BUG-017 | High | Fixed in code | Losing a successful pairing response could permanently brick a one-time QR |
| ROBOT-BUG-018 | Critical | Fixed in code | An ACK arriving before the pending transition could strand a device queue |
| ROBOT-BUG-019 | High | Fixed in code | Schema-invalid success responses were reported as successful metrics |
| ROBOT-BUG-020 | High | Fixed in code | Fresh status could smuggle stale or future optional telemetry into the app |
| ROBOT-BUG-021 | High | Fixed in code | Mixed-vendor telemetry stopped at basic status instead of an account snapshot |
| ROBOT-BUG-022 | High | Fixed in code | Legacy manufacturer calls could hang when abort was ignored or a body stalled |
| ROBOT-BUG-023 | High | Fixed in code | Mobile robot requests could outlive their timeout or parse unbounded response helpers |
| ROBOT-BUG-024 | Critical | Fixed in code | A delayed action could survive reset and execute after re-pairing |
| ROBOT-BUG-025 | Critical | Fixed in code | Partial multi-vendor privacy deletion could repeat or omit erasure after process death |
| ROBOT-BUG-026 | Critical | Fixed in code | Account deletion could race an already-started robot delivery |
| ROBOT-BUG-027 | High | Fixed in code | Reusing one semantic idempotency key for different commands could return false success |
| ROBOT-BUG-028 | Critical | Fixed in code | Slow pairing could bind a robot after account deletion completed |
| ROBOT-BUG-029 | High | Fixed in code | Process death could delete every recovery session before account deletion finalized |
| ROBOT-BUG-030 | High | Fixed in code | Failed or not-yet-due resets had no recurring recovery trigger |
| ROBOT-BUG-031 | High | Fixed in code | GSI propagation lag could hide an outbox row from privacy deletion |
| ROBOT-BUG-032 | Medium | Fixed in code | A stale reset attempt could demote a newer lease in the same process |
| ROBOT-BUG-033 | High | Fixed in code | Concurrent protected-store mutations could lose or resurrect robot credentials |
| ROBOT-BUG-034 | High | Fixed in code | Telemetry without `online` could retain a ghost-online robot |
| ROBOT-BUG-035 | High | Fixed in code | Unsigned direct HAL methods could bypass binding-epoch reset fencing |
| ROBOT-BUG-036 | High | Fixed in code | Pairing/reset requests could forward credentials across an HTTP redirect |
| ROBOT-BUG-037 | High | Fixed in code | Manufacturer-side QR consumption plus response loss could brick a valid claim |
| ROBOT-BUG-038 | Medium | Fixed in code | Non-success robot response bodies were not cancelled |
| ROBOT-BUG-039 | Medium | Fixed in code | Timestamp-less indoor position could be presented as current |
| ROBOT-BUG-040 | Medium | Fixed in code | Callback and outbound adapter credentials could be configured identically |
| ROBOT-BUG-041 | Medium | Fixed in code | Mobile pairing/reset parsing had no hard body-consumption bound |

---

## ROBOT-BUG-001 — Global vendor selection could not support a mixed fleet

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** adapter construction, pairing binding, action routing

### Description

A process-global `ROBOT_TYPE` design can instantiate only one vendor for the entire backend. Switching it reroutes every robot and cannot represent one user's Yongyida robot alongside another user's Jiangzhi robot. It also makes a deployment-level setting, rather than an account-authorized binding, decide the physical target.

### Steps to reproduce the failure mode

1. Configure the process for Yongyida.
2. Pair or address a Jiangzhi robot in the same process.
3. Attempt simultaneous commands to both devices.
4. Observe that a global switch cannot select two vendor transports safely.

### Expected behavior

Each logical robot resolves to one immutable `adapter_id`; both vendors can run concurrently and independently.

### Actual behavior before fix

One global vendor choice would serialize the entire fleet through one implementation or require unsafe runtime mutation.

### Implemented fix

- [`AdapterFactory.ts`](../server/src/adapters/AdapterFactory.ts) requires a vendor per adapter instance.
- `RobotAdapterRegistry` is keyed by immutable adapter ID and rejects duplicate IDs.
- [`robot-adapter-runtime.cjs`](../server/robot-adapter-runtime.cjs) loads both environment configurations concurrently.
- QR pairing persists `adapterId` with the account/device binding; ActionGateway resolves it server-side before signing.

### Regression evidence

- `factory registry supports simultaneous vendors without cross-adapter blocking`
- `environment configuration supports both vendors without a global robot type`
- `routes a signed action to its immutable adapter and reports physical attempts`

**Screenshots/logs:** Not applicable; deterministic tests use fake endpoints and redacted output.

---

## ROBOT-BUG-002 — One adapter callback could acknowledge another adapter's action

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** manufacturer ACK route, pending ACK state

### Description

Authenticating all callbacks with one shared manufacturer key, or accepting an action ID without its adapter identity, lets a compromised vendor/bridge try to acknowledge a pending action owned by another adapter. A guessed or disclosed action ID could then create a false delivered state.

### Steps to reproduce the failure mode

1. Create a pending Yongyida action.
2. Submit its action ID using Jiangzhi callback credentials.
3. Without adapter binding, the gateway can look up the ID and accept the ACK.

### Expected behavior

The callback credential, header `X-Robot-Adapter-Id`, and stored pending adapter must all match.

### Actual behavior before fix

The legacy callback contract authenticated only a shared manufacturer key and did not pass adapter identity into the ACK transition.

### Implemented fix

- Each runtime configuration has an independent `callbackApiKey`.
- `POST /v1/manufacturer/robot/ack` authenticates `X-Robot-Adapter-Id` and `X-Robot-Callback-Key` in constant time.
- `ActionGateway.acknowledgeRobot` rejects an adapter that does not match the pending action.
- The legacy shared-key path is available only when no adapter runtime is configured.

### Regression evidence

- `callback credentials are isolated by adapter`
- `a vendor callback cannot acknowledge another adapter's pending action`
- CLM route tests for adapter-bound ACK authentication

**Screenshots/logs:** No sensitive headers are captured in the report.

---

## ROBOT-BUG-003 — HTTP 202 or an unrelated receipt could be mistaken for delivery

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** bridge receipt parsing, action outbox, expiry

### Description

HTTP 202 means the bridge accepted work asynchronously. Treating it as physical completion can show a medication reminder or safety action as delivered before the robot executes it. Likewise, accepting any successful JSON or a receipt for a different action permits state confusion. Retrying after the signed expiry also violates the authorization window.

### Steps to reproduce the failure mode

1. Return HTTP 202 from `signed-actions` and never send a callback.
2. Alternatively return HTTP 200/202 with a different `action_id` or inconsistent state.
3. Delay a retry until after `expires_at`.

### Expected behavior

202 enters `pending_ack`; a valid receipt must correlate to the signed action; no attempt occurs after expiry; missing/negative ACK becomes failed and alerts the user.

### Actual behavior before fix

A status-only success path could not prove receipt correlation or execution, and expiry could be checked too far from an actual transport attempt.

### Implemented fix

- `RestRobotAdapter.deliverSignedAction` requires bounded JSON containing the same `action_id`, a consistent state/`ok` pair, and only supported 200/202 semantics.
- It checks `expires_at` before initial delivery and immediately before every retry attempt.
- ActionGateway stores `pending_ack`, its deadline, and authenticated callback result in the durable outbox.
- ACK timeout and negative ACK mark failed and trigger the user warning path.

### Regression evidence

- `signed-action receipts and freshness fail closed`
- `robot action is durably enqueued before acceptance and transitions through asynchronous ACK`
- `missing manufacturer ACK expires durable state and pushes the user warning`
- test bridge rejects expired signed actions with 410

**Screenshots/logs:** Sanitized error codes only; no signed payload is logged.

---

## ROBOT-BUG-004 — Retry could duplicate a physical command

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** idempotency, retry, bridge execution ledger

### Description

A network split after the robot acts but before the response reaches Veryloving is ambiguous. If each retry generates a new key, the bridge may execute the action twice. Reusing an ID with different content is also unsafe.

### Steps to reproduce the failure mode

1. Send an action and let the receiving bridge perform it.
2. Drop the response before the sender sees it.
3. Retry the command with a new key, or reuse the old key with modified parameters.

### Expected behavior

Every retry carries the same action ID and exact signed body. The receiving bridge durably claims that ID before effect, returns the prior receipt for an exact duplicate, and rejects a conflicting body.

### Actual behavior before fix

Naive request-scoped ID generation cannot distinguish a retry from a new physical command.

### Implemented fix

- ActionGateway derives a deterministic action UUID from user, device, action, and caller idempotency key.
- The durable outbox rejects duplicate enqueue and returns the existing accepted identity.
- Adapter retries create the transport idempotency key once outside the retry loop.
- Signed actions use `envelope.id` as the bridge `Idempotency-Key` and are forwarded without reconstruction.
- The integration bridge stores an ID/body digest, returns duplicate receipts for an exact replay, and returns 409 for a conflicting body.

### Regression evidence

- `retryable responses use bounded retry and preserve the idempotency key`
- `stable mobile idempotency keys do not redeliver a durably accepted command`
- `both provisional bridges ... execute each signed action once`
- `signature, expiry, adapter binding, request bounds, and idempotency conflicts fail closed`

**Screenshots/logs:** Execution counts are asserted in memory; no device identity is printed.

---

## ROBOT-BUG-005 — One stalled device could block unrelated device commands

**Severity:** High
**Status:** Fixed in code
**Affected components:** command queues, mixed-device concurrency

### Description

A single global promise chain or queue creates head-of-line blocking. A busy BLE wearable or unreachable Yongyida bridge could prevent a Jiangzhi medication command from starting.

### Steps to reproduce the failure mode

1. Start a wearable/Yongyida command whose transport never resolves.
2. Immediately start a command for a different robot.
3. With a global queue, the second command waits behind the first.

### Expected behavior

Ordering is per physical device. Different devices and vendors progress independently while the same robot stays ordered through its asynchronous ACK.

### Actual behavior before fix

A shared queue design couples unrelated safety domains and violates latency isolation.

### Implemented fix

- Mobile `BaseDevice` owns its command queue.
- ActionGateway queue keys include authenticated user and logical device ID.
- Queue depth is bounded per device and globally.
- A pending ACK retains only that robot's barrier.

### Regression evidence

- `per-device queues isolate a stalled BLE wearable from robot HTTP delivery`
- `factory registry supports simultaneous vendors without cross-adapter blocking`
- `separate device delivery queues start independently`
- `same-device commands preserve execution order until the prior asynchronous ACK`

**Screenshots/logs:** Timing/order is asserted with controlled promises.

---

## ROBOT-BUG-006 — Gateway restart could lose or replay robot work incorrectly

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** durable outbox, recovery, expiry

### Description

In-memory queues disappear on process death. A command accepted to the app but not durably recorded is lost. Blindly replaying every stored item after restart can execute expired work or repeat a physical action whose ACK was lost.

### Steps to reproduce the failure mode

1. Accept an action, then terminate the process before delivery or ACK.
2. Restart the gateway.
3. Observe loss with an in-memory queue, or unsafe replay without state/expiry/idempotency checks.

### Expected behavior

The gateway responds accepted only after durable enqueue. Restart recovery validates each record, resumes unexpired queued/delivering items, restores ACK deadlines, and fails expired items without delivery.

### Actual behavior before fix

An in-memory-only path cannot uphold accepted-work durability across restart.

### Implemented fix

- DynamoDB outbox transitions through queued, delivering, pending ACK, delivered, and failed.
- Enqueue precedes HTTP 202 to the caller.
- Recovery uses the configured user-index GSI, validates signed identity/target/state, enforces expiry, and reinstalls per-device barriers.
- A transient recovery failure resets the recovery guard so a later request can retry recovery.

### Regression evidence

- `outbox failure prevents false 202 acceptance and a bounded device queue returns 429`
- `process restart recovers a durably queued robot command before accepting new work`
- `process restart fails an expired durable robot action without redelivery`
- `transient outbox recovery failure is retried instead of poisoning robot routing`

**Screenshots/logs:** Outbox transitions use synthetic IDs in tests.

---

## ROBOT-BUG-007 — A fetch implementation ignoring abort could hang indefinitely

**Severity:** High
**Status:** Fixed in code
**Affected components:** REST timeout, retry, resource cleanup

### Description

`AbortController.abort()` is advisory. A custom or vendor fetch wrapper may ignore the signal. Awaiting that promise directly defeats the configured timeout, blocks its device queue, and can retain sockets/bodies.

### Steps to reproduce the failure mode

1. Inject a fetch implementation that returns a never-settling promise and ignores `signal`.
2. Send a safety command.
3. An abort-only timeout never releases the request path.

### Expected behavior

The adapter rejects with a typed timeout after the configured bound, retries only up to the configured maximum, and cancels a late response body where possible.

### Actual behavior before fix

Abort-only code can remain pending forever.

### Implemented fix

- `fetchWithTimeout` races the transport promise against an independent timeout rejection.
- It still aborts the controller and cancels a response body that resolves after timeout.
- Retry count and backoff are bounded; metrics record each attempt without raw errors.

### Regression evidence

- `a fetch implementation that ignores AbortSignal still times out with bounded retries`
- integration mock fault control aborts a delayed response deterministically

**Screenshots/logs:** Typed `ADAPTER_TIMEOUT` is asserted; raw exception text is excluded.

---

## ROBOT-BUG-008 — Malformed or oversized bridge data was not a safe status source

**Severity:** High
**Status:** Fixed in code
**Affected components:** response parser, telemetry, memory bounds

### Description

Calling unbounded `response.json()` or trusting loosely shaped objects permits memory growth, parser crashes, false online state, invalid coordinates, or untrusted vendor fields reaching safety/UI code.

### Steps to reproduce the failure mode

1. Return truncated JSON, a top-level array, an over-limit body, invalid timestamps, or out-of-range fields.
2. Observe whether the adapter retries, crashes, or displays data as live.

### Expected behavior

Read only a configured maximum, require a JSON object and strict operation schema, reject invalid data without blind retry, and expose only allowlisted fields.

### Actual behavior before fix

Generic JSON parsing does not constrain memory or establish telemetry trust.

### Implemented fix

- Adapter reads stream/array-buffer/text bodies with byte limits and cancels over-limit streams.
- Every result parser checks bounded strings, enums, arrays, numbers, units, and timestamps.
- Manufacturer and mobile telemetry normalizers cap paths/events and remove unknown fields such as camera URLs.
- Missing/invalid timestamps become offline/unknown.

### Regression evidence

- `malformed and oversized responses fail closed without retries`
- `manufacturer status bounds navigation paths ...`
- `manufacturer telemetry without a trustworthy timestamp fails closed`
- `home robot keeps the relay online but rejects malformed gateway JSON`
- `home robot never treats telemetry without a valid vendor timestamp as fresh`

**Screenshots/logs:** Malformed bodies are synthetic and are not emitted to logs.

---

## ROBOT-BUG-009 — Concurrent initialization could cross-bind or poison an adapter

**Severity:** High
**Status:** Fixed in code
**Affected components:** adapter lifecycle, one-time credentials

### Description

Two simultaneous `initialize()` calls can create duplicate sessions or bind one adapter instance to two robots. Caching a rejected initialization promise can also prevent recovery after a transient failure, while retaining a one-time pairing token in instance state creates an unnecessary secret lifetime.

### Steps to reproduce the failure mode

1. Call `initialize()` twice concurrently with identical credentials.
2. Repeat with different device IDs or pairing claims.
3. Make the first bridge initialization fail, then retry.

### Expected behavior

Identical calls share one in-flight operation; conflicting calls fail closed; a failed attempt clears in-flight state; a successful adapter never rebinds to another device; pairing claim is not retained.

### Actual behavior before fix

Uncoordinated initialization permits races, duplicate sessions, or a permanently poisoned adapter.

### Implemented fix

- Initialization uses a single-flight promise keyed by device and claim.
- A conflicting key throws `ADAPTER_INITIALIZATION_CONFLICT`.
- `finally` clears temporary promise/key state after success or failure.
- Only the bound device ID and optional bridge session token remain after success.

### Regression evidence

- `initialization is single-flight and resets after failure`
- `different initialization credentials cannot join an in-flight claim`

**Screenshots/logs:** Pairing claims are not logged or included in assertions after initialization.

---

## ROBOT-BUG-010 — Replayed QR claims could threaten account ownership

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** QR verification, DynamoDB binding, account isolation

### Description

If a QR code is treated as a reusable device identifier or replay state exists only in memory, User B can replay User A's code after process restart. A check-then-write sequence also races two users.

### Steps to reproduce the failure mode

1. User A presents a valid manufacturer QR and completes pairing.
2. User B presents the exact same QR later or concurrently.
3. Without one transactional claim, both may obtain ownership.

### Expected behavior

The first valid use atomically records `used_at` and `bound_to`. Another account always receives HTTP 410. The original account may safely resume only the already-completed binding after a lost response; logs contain only one-way claim/serial references.

### Actual behavior before fix

Reusable or non-durable QR handling cannot enforce exclusive ownership across users/processes.

### Implemented fix

- The manufacturer verifier must assert one-time and expiry properties.
- Backend hashes the QR and serial, then performs one DynamoDB transaction for claim consumption, owner record, and account binding.
- Conditional failure is read consistently and normalized to `ROBOT_PAIRING_REPLAY`/HTTP 410.
- A dedicated server HMAC derives a stable account/scope/claim-bound possession token; only its hash is stored. This lets the original account recover after response loss without reopening cross-account reuse.
- `resumeBinding` rotates only the original account binding's token hash and rejects a different account before manufacturer verification.
- Adapter ID is captured in the same binding.

### Regression evidence

- `a consumed QR claim persists used_at/bound_to and rejects cross-account replay with 410`
- `Dynamo pairing recovery rotates only the original account binding token`
- `expired manufacturer claims fail before DynamoDB mutation`
- `robot pairing credential verification is account-bound and timing-safe`
- `manufacturer pairing preserves replay semantics ...`

**Screenshots/logs:** Replay log assertions use redacted serial references; raw QR and serial are absent.

---

## ROBOT-BUG-011 — Relay health or stale telemetry could create a ghost-online robot

**Severity:** High
**Status:** Fixed in code
**Affected components:** `HomeRobotDevice`, manufacturer telemetry, UI status

### Description

The Veryloving relay can be healthy while a physical robot is offline. Likewise, an old telemetry sample can persist across app restart or network loss and keep the map/status UI apparently live.

### Steps to reproduce the failure mode

1. Make `/health` return OK while the vendor status route is missing, stale, or invalid.
2. Rehydrate a previously online robot and disconnect the manufacturer path.
3. Observe whether relay health or old coordinates set `online=true`.

### Expected behavior

Relay and hardware health are separate. Only fresh, bounded, timestamped vendor telemetry can mark hardware online; stale/invalid status becomes offline/unknown without crashing.

### Actual behavior before fix

Conflating connectivity layers or accepting untimestamped telemetry creates a ghost marker and misleading care status.

### Implemented fix

- `HomeRobotDevice.connect()` marks only `relayOnline` from `/health` and fetches telemetry separately.
- Telemetry requires a valid vendor timestamp, rejects clock skew/staleness and older samples, and is single-flight.
- Polling suspends offline and timers/controllers are cleaned up on disconnect/disposal.
- Server normalization bounds location/path/events and requires `reported_at`.

### Regression evidence

- `generic relay health never labels manufacturer hardware online`
- `home robot polls telemetry, validates navigation paths, and cleans up the lifecycle timer`
- `home robot telemetry is single-flight, rejects older samples, and suspends polling offline`
- `manufacturer telemetry without a trustworthy timestamp fails closed`

**Screenshots/logs:** UI behavior is represented by deterministic state assertions; physical map validation remains required.

---

## ROBOT-BUG-012 — Offline commands could be lost or misbound during recovery

**Severity:** High
**Status:** Fixed in code
**Affected components:** mobile durable queue, network recovery, identity binding

### Description

When the phone is offline, a robot command may fail before it reaches the server. Keeping it only in memory loses it on app process death. A retry that trusts stored command identity can also target a different device or duplicate an already delivered entry.

### Steps to reproduce the failure mode

1. Queue a home-robot action and make the network request fail.
2. Restart or reconnect the app.
3. Load duplicate durable records or mutate device fields in the stored command.

### Expected behavior

The command remains in an account-scoped bounded store, retries with a stable ID when connectivity returns, overwrites untrusted identity with the bound device/type, and acknowledges/removes exactly one durable record after server acceptance.

### Actual behavior before fix

Memory-only or unbound retries risk loss, duplication, cross-account leakage, or wrong-device delivery.

### Implemented fix

- `HomeRobotDevice` stores account-bound commands before relay delivery and uses a per-device queue.
- Retry uses a stable idempotency key and authoritative `this.deviceId`/`home_robot` fields.
- Durable scans deduplicate records and the queue fails closed when full instead of evicting older safety work.
- Network failure marks the robot offline and schedules bounded recovery even if no new network event arrives.
- App/account disposal aborts requests and cancels queued/timed work.

### Regression evidence

- `robot network failure marks it offline and retains its durable command`
- `robot durable scan deduplicates delivery and binds identity with a stable idempotency key`
- `a full durable command queue fails closed instead of evicting an older command`
- `robot relay failures schedule bounded recovery even without another network event`
- `upserting a replacement disposes the old device and cancels its queued work`

**Screenshots/logs:** Test descriptors assert that pairing tokens and serials never enter persisted device snapshots.

---

## ROBOT-BUG-013 — Adapter logs could disclose identity, health context, or secrets

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** structured logs, metrics, error handling

### Description

Logging raw URLs, request/response bodies, exceptions, API keys, adapter labels, IP addresses, hardware serials, medication names, or user identifiers creates a privacy and credential leak. Conversely, a logger exception must not fail an emergency action.

### Steps to reproduce the failure mode

1. Make a network client throw an error containing a key, IP, serial, email, and medication name.
2. Pass an unsafe adapter label or logging field.
3. Make the configured log/metric sink itself throw.

### Expected behavior

Only allowlisted event, pseudonymous adapter reference, vendor, operation, attempt, latency, status, outcome, and error code reach observability. Sink failure is isolated from command behavior.

### Actual behavior before fix

Conventional exception/body logging leaks sensitive context, and an unguarded sink can turn monitoring failure into safety-command failure.

### Implemented fix

- [`StructuredAdapterLogger.ts`](../server/src/adapters/StructuredAdapterLogger.ts) creates events from a strict allowlist.
- Adapter IDs become short SHA-256 references; unsafe fields become redacted/unknown.
- Raw exceptions and error responses are neither parsed for logs nor forwarded.
- Logging and metric callbacks are wrapped so their errors cannot fail or retry a command.
- Server pairing hashes internal robot IDs into short `robotReference` values and uses one-way claim/serial references; raw QR, serial, manufacturer ID, account ID, and logical robot ID are not logged.

### Regression evidence

- `structured logs are allowlisted and never contain payloads, keys, URLs, IPs or PII`
- `a broken observability sink cannot fail or retry a safety command`
- redacted logger and QR replay tests, including assertions that pairing info logs do not contain the returned robot ID

**Screenshots/logs:** The tests explicitly assert forbidden strings are absent.

---

## ROBOT-BUG-014 — Async reset/privacy receipt could cause false data-erasure success

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** factory reset, account deletion, manufacturer privacy

### Description

HTTP 202 says erase/reset work was accepted, not completed. If Veryloving unbinds the robot or reports account deletion immediately, user data may remain on the robot/vendor while the app has discarded the ownership credential needed to retry. A crash between remote reset and local unbinding creates the opposite ambiguity: blindly issuing a new reset or losing the completion checkpoint can strand the binding.

### Steps to reproduce the failure mode

1. Make the manufacturer reset or deletion endpoint return 202.
2. Attempt factory reset or account deletion.
3. A naive 2xx check removes local/account state despite no erasure proof.

### Expected behavior

Factory reset must use one stable reset identity and binding generation. The bridge must return HTTP 200 with an exact correlated completion proving that the same reset and epoch were both erased and fenced. A durable state machine must recover safely after any process boundary and unbind only after that proof. Manufacturer privacy deletion must separately require synchronous completion and retain resumable per-adapter checkpoints.

### Actual behavior before fix

Broad `response.ok` handling conflates receipt with completed data erasure.

### Implemented fix

- Factory reset uses the provisional `veryloving.robot-reset.v1` bridge contract. It sends `X-Veryloving-Reset-Contract: veryloving.robot-reset.v1`, `Idempotency-Key: <reset_id>`, and the exact body `{ contract_version: "vl-robot-reset/1", reset_id, robot_id, binding_epoch, erase_user_data: true }`.
- Reset accepts only HTTP 200 with the correlated body `{ reset_id, binding_epoch, state: "completed", erased: true, fenced: true }`. HTTP 202/204, empty or oversized bodies, and missing, malformed, or mismatched fields fail closed.
- DynamoDB persists `reset_pending`, a leased `reset_in_progress`, and `reset_remote_complete`. The gateway fences and drains the exact binding epoch before transport; retries reuse the same `reset_id`; startup recovery resumes eligible checkpoints; final unbinding and its idempotent receipt commit only after remote completion.
- Privacy deletion separately accepts only HTTP 204 or HTTP 200 with `completed: true`, and uses a durable per-adapter checkpoint. Local/account credentials remain available until all configured processors have completed.
- The app removes its protected pairing credential only after the backend reset completes.

### Regression evidence

- `manufacturer privacy does not treat an asynchronous deletion receipt as erasure`
- `manufacturer reset and privacy deletion require explicit synchronous completion`
- `manufacturer pairing preserves replay semantics and reset rejects an async receipt`
- `manufacturer reset rejects empty, malformed, or uncorrelated completion responses`
- `factory reset retries a stable downstream idempotency key after failure and restart`
- `recovery finalizes a remote-complete checkpoint without issuing a second physical reset`
- `factory reset unbind atomically removes only the authenticated user and matching owner`

**Screenshots/logs:** No manufacturer data or account identity is written to this report. The reset v1 contract is a Veryloving provisional bridge contract validated against the test-only manufacturer bridge; no Yongyida or Jiangzhi endpoint or physical reset was validated.

---

## ROBOT-BUG-015 — A stalled HTTP response body could outlive the adapter timeout

**Severity:** High
**Status:** Fixed in code
**Affected components:** adapter HTTP timeout, response parsing, retry bounds

### Description

The original attempt timer raced the bridge's `fetch()` promise only until HTTP
headers arrived. A peer could return status 200 and then stop transmitting the
JSON body. Because body parsing happened after that timer was cleared, the
command could hang indefinitely and retain a network body/reader.

### Steps to reproduce the failure mode

1. Return HTTP 200 and a readable response stream from the bridge.
2. Never resolve the stream reader's first `read()` operation.
3. Observe that a headers-only timeout no longer governs schema parsing.

### Expected behavior

One attempt deadline covers connection, headers, bounded body consumption, UTF-8
decoding, and JSON parsing. On expiry, abort/cancel the response and enter only
the configured bounded retry path.

### Actual behavior before fix

The fetch deadline was cleared as soon as the response object existed, leaving a
partial or malicious response body outside the adapter's time bound.

### Implemented fix

- `fetchWithTimeout` now owns the complete fetch-and-consume callback.
- Its `AbortController` and timer remain active until bounded response parsing
  completes.
- Timeout aborts the request and attempts to cancel any available response body.
- Late resolutions are observed and cancelled without generating unhandled
  rejections or changing command state.

### Regression evidence

- `a fetch implementation that ignores AbortSignal still times out with bounded retries`
  now covers both a fetch that never resolves and a 200 response whose body
  reader never resolves.

**Screenshots/logs:** Not applicable; the regression uses a deterministic
in-memory response reader.

## ROBOT-BUG-016 — Reset/privacy could cross vendor boundaries in a mixed fleet

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** account robot lookup, factory reset, manufacturer privacy export/deletion

### Description

Command, pairing, and status routing used the immutable `adapter_id`, but reset
and privacy still reduced every binding to a manufacturer device ID and sent all
IDs through one legacy URL/key. In a mixed account this could route a Jiangzhi
identifier to a Yongyida handler (or the reverse), disclose identifiers across
processors, and report incomplete erasure.

### Implemented fix

- Dynamo lookups retain `{ adapterId, manufacturerDeviceId }` for lifecycle work.
- Modern reset routes only through `RobotAdapterRuntime.resetRobot(adapterId, …)`;
  no legacy fallback is permitted.
- Manufacturer privacy groups exact device IDs by adapter and invokes each
  adapter's export/deletion handler separately.
- Historical `manufacturer-default` bindings retain the legacy client.
- Missing modern handlers fail with HTTP 503 before unbinding or local deletion.
- Production configuration requires reset/export/delete URLs for every enabled
  adapter.

### Regression evidence

- `reset and privacy use only the selected adapter endpoints and credential`
- `modern lifecycle operations fail closed when their adapter handler is absent`
- `mixed-fleet privacy groups identifiers by adapter and never crosses handlers`
- CLM reset tests cover modern routing, legacy compatibility, and no fallback.

---

## ROBOT-BUG-017 — Losing a successful pairing response could permanently brick a one-time QR

**Severity:** High
**Status:** Fixed in code
**Affected components:** pairing token issuance, Dynamo pairing recovery, app process/network failure

### Description

The manufacturer QR is deliberately one-time. If DynamoDB committed the binding
but the app died or lost the HTTP response before storing the possession token,
a random return-once token could not be reconstructed. Rescanning would hit the
consumed claim and leave the legitimate owner unable to operate or reset the
robot.

### Implemented fix

- `ROBOT_PAIRING_TOKEN_SECRET` is an independent server HMAC key.
- The token is derived from a versioned domain separator, authenticated account,
  immutable adapter scope, and hashed QR claim; DynamoDB stores only its hash.
- `resumeBinding` runs before manufacturer verification. It reissues the same
  logical robot/token only to the already-bound account and rotates that
  binding's token hash.
- A different account still receives HTTP 410 and a redacted replay log before
  the manufacturer endpoint is called.

### Regression evidence

- `a consumed QR claim persists used_at/bound_to and rejects cross-account replay with 410`
- `Dynamo pairing recovery rotates only the original account binding token`
- production configuration requires `ROBOT_PAIRING_TOKEN_SECRET` when robot
  pairing is configured.

---

## ROBOT-BUG-018 — An ACK arriving before the pending transition could strand a device queue

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** asynchronous ACK race, Dynamo outbox, per-device queue barrier

### Description

A very fast authenticated callback can mark an outbox item delivered while the
original bridge request is still returning HTTP 202. If the sender then blindly
tries to write `pending_ack`, the conditional transition fails while its
in-memory queue barrier remains installed. Later commands for the same robot wait
until an unnecessary ACK timeout even though DynamoDB is already terminal.

### Implemented fix

- `markPendingAck` returns the current durable record when its conditional update
  loses the race.
- The delivery path recognizes `delivered` or `failed` as terminal, clears local
  ACK/queue state immediately, and never overwrites the callback result.
- Dynamo and in-memory regression fixtures cover the same transition ordering.

### Regression evidence

- `an ACK racing a 202 response cannot strand the same-device queue`
- `Dynamo pending-ACK transition observes an already-terminal callback race`

---

## ROBOT-BUG-019 — Schema-invalid success responses were reported as successful metrics

**Severity:** High
**Status:** Fixed in code
**Affected components:** adapter response parsing, metrics, operational alerting

### Description

The REST adapter originally recorded request success after bounded JSON parsing
but before operation-specific schema validation. A 200 response with 101 vitals,
an invalid receipt, or another semantically unusable body therefore emitted a
success metric immediately before the public method threw an error. That could
hide a broken safety bridge from alerts and SLA reporting.

### Implemented fix

- Each request supplies its typed `parseResponse` callback to the transport.
- Bounded body consumption, JSON decoding, and operation schema validation all
  complete inside the same timed attempt before success is recorded.
- Schema failures emit a single sanitized failure metric and remain
  non-retryable.

### Regression evidence

- `malformed and oversized responses fail closed without retries` asserts that
  an over-limit telemetry snapshot records `ADAPTER_RESPONSE_INVALID` with a
  failure outcome.

---

## ROBOT-BUG-020 — Fresh status could smuggle stale or future optional telemetry into the app

**Severity:** High
**Status:** Fixed in code
**Affected components:** telemetry freshness, vitals, location/navigation, indoor position, safety events, medication ACKs

### Description

The snapshot's authoritative status could be fresh while optional observations
carried old or future timestamps. Trusting the whole snapshot from status alone
could display an obsolete battery/vital, surface an old fall as new, or accept a
future event timestamp.

### Implemented fix

- Stale/future authoritative status suppresses the entire sensor/event snapshot.
- Location and the complete navigation path carry separate required
  vendor-attested capture times; stale, future, or timestamp-less spatial data
  is suppressed independently.
- Battery, vitals, indoor position, and safety events receive independent
  freshness checks.
- Medication acknowledgements reject future timestamps and samples older than
  30 days.
- Invalid optional samples are omitted; they do not make fresh status appear
  offline or become UI truth.

### Regression evidence

- `normalizes status for the existing mobile telemetry contract` covers stale
  and future authoritative status plus stale/future optional-field suppression.

---

## ROBOT-BUG-021 — Mixed-vendor telemetry stopped at basic status instead of an account snapshot

**Severity:** High
**Status:** Fixed in code
**Affected components:** HAL, adapter runtime, authenticated telemetry route, mobile robot state

### Description

The first mixed-vendor runtime queried only basic status even though mobile and
legacy normalizers expected location/path and the HAL exposed separate
battery/vital primitives. As a result, a newly paired Yongyida/Jiangzhi binding
could be online but could not populate the Product 2 map or normalized care
telemetry through its account-authorized route.

### Implemented fix

- `RobotAdapter.getTelemetrySnapshot()` and the provisional
  `telemetry/snapshot/query` bridge operation carry one strict bounded snapshot.
- Runtime normalization exposes status, battery, up to 100 vitals, location, up
  to 500 navigation points, indoor position, up to 20 safety events, and up to
  20 medication acknowledgements.
- The CLM route resolves adapter/manufacturer identity from the authenticated
  binding, and `HomeRobotDevice` updates bounded location/path/battery state.

### Regression evidence

- adapter unit tests validate and bound the full snapshot schema;
- `mixed-vendor pairing, telemetry, and callbacks stay adapter-bound`;
- the test-only manufacturer bridge exercises `telemetry/snapshot/query` for
  both provisional vendor prefixes.

**Boundary:** This proves the Veryloving provisional contract, not manufacturer
data availability, medical validity, event delivery, or physical hardware.

---

## ROBOT-BUG-022 — Legacy manufacturer calls could hang when abort was ignored or a body stalled

**Severity:** High
**Status:** Fixed in code
**Affected components:** legacy pairing, status, reset, privacy HTTP clients

### Description

The TypeScript adapters had an independent timeout race, but historical
`manufacturer-default` clients relied on `AbortSignal` and ordinary body reads.
An injected fetch that ignored abort, or a peer that sent headers then stalled
its body, could block pairing, status, factory reset, or privacy deletion beyond
the configured deadline.

### Implemented fix

- The shared legacy request helper races fetch plus bounded response consumption
  against a typed `MANUFACTURER_TIMEOUT` deadline.
- Expiry aborts the request and cancels the active body reader when possible.
- Pairing, status, reset, privacy export, and privacy deletion all use that
  helper; deletion still requires strict synchronous completion.

### Regression evidence

- `manufacturer requests time out when fetch ignores AbortSignal`
- `manufacturer timeout cancels a response stream whose body read stalls`

---

## ROBOT-BUG-023 — Mobile robot requests could outlive their timeout or parse unbounded response helpers

**Severity:** High
**Status:** Fixed in code
**Affected components:** `HomeRobotDevice`, mobile relay timeout, response-body bounds

### Description

The server-side transports were bounded, but the mobile home-robot client still
depended on abort cooperation and a response's convenience parser. A fetch
implementation that ignored `AbortSignal`, or a peer that returned headers and
then stalled `text()`, could hold the mobile per-device queue indefinitely.
Accepting a `json()`-only response also bypassed the client's explicit UTF-8 byte
limit.

### Implemented fix

- `HomeRobotDevice.request()` races fetch plus body consumption against an
  independent 1–120,000 ms timeout.
- Timeout aborts the controller, cancels a received body where possible, and
  emits `ROBOT_NETWORK_TIMEOUT` even if fetch ignores abort.
- Only bounded text is accepted: declared and measured UTF-8 size are capped at
  1 MiB before strict object-only JSON parsing. A `json()`-only/unbounded shape
  fails closed.
- Network failure retains the durable command and hardware remains offline;
  relay response state is tracked separately.

### Regression evidence

- `home robot request timeout survives fetch implementations that ignore AbortSignal`
- `home robot timeout covers a stalled response body and cancels it`
- `home robot rejects unsafe timeout configuration`

## ROBOT-BUG-024 — A delayed action could survive reset and execute after re-pairing

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** signed action contract, binding lifecycle, reset fence, bridge replay gate

### Description

An action can pass authorization, then wait in an outbox, retry loop, socket, or
bridge while its robot is reset. If the same physical serial is paired again
without a binding generation, that still-valid delayed action can execute under
the new ownership lifecycle.

### Steps to reproduce the failure mode

1. Sign and delay an action for a currently active robot.
2. Reset, unbind, and re-pair the same physical serial.
3. Deliver the old action after the new binding is active.

### Expected behavior

Reset permanently revokes its exact binding generation. Re-pairing advances a
monotonic generation, and neither Veryloving recovery nor the bridge accepts an
action from the revoked or superseded generation.

### Actual behavior before fix

Device, account, adapter, signature, and expiry checks alone did not distinguish
the old binding from a later binding of the same hardware.

### Implemented fix

- New pairings atomically allocate `bindingEpoch = bindingEpochHighWater + 1`;
  bindings without a valid epoch fail closed with
  `ROBOT_BINDING_MIGRATION_REQUIRED`.
- `vl-robot-action/2` signs `binding_epoch`; deterministic action identity,
  durable outbox records, ACKs, and per-device queue keys all carry that epoch.
- Authorization is checked immediately before every attempt. Reset durably
  fences queued work for the exact epoch and drains a request that was already
  on the wire before remote erasure starts.
- Reset v1 requires the bridge to persist its revoked-through epoch. The
  test-only bridge also tracks the newest accepted generation and rejects an
  older delayed action after observing a newer one.

### Regression evidence

- `robot idempotency identity is scoped to the binding epoch while wearable v1 stays stable`
- `process restart fails a stale binding generation as BINDING_FENCED without redelivery`
- `correlated reset completion fences every action from the revoked binding epoch`
- `bridge rejects a delayed action after observing a newer binding generation`

**External boundary:** This validates Veryloving and the test-only bridge. A
production manufacturer bridge must durably enforce action v2 generation checks
and reset v1 revocation; no vendor endpoint or physical robot was validated.

---

## ROBOT-BUG-025 — Partial multi-vendor privacy deletion could repeat or omit erasure after process death

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** manufacturer privacy coordinator, DynamoDB checkpoint, idempotency

### Description

In a mixed fleet, one processor may finish erasure before another fails. A
process can also die after a vendor erased data but before Veryloving recorded
completion. An in-memory loop can then omit the remaining processor or repeat a
physical erasure with a new identity.

### Steps to reproduce the failure mode

1. Complete deletion at adapter A and fail adapter B.
2. Alternatively, terminate the process after A succeeds but before its local
   checkpoint commit.
3. Retry account deletion in a new process.

### Expected behavior

Completed adapters are skipped, incomplete adapters resume, and an ambiguous
post-success retry uses the exact same downstream idempotency key. A changed
target plan must conflict instead of silently changing an in-progress erasure.

### Actual behavior before fix

Only request-local progress existed; it could not distinguish completed,
incomplete, and response-loss states across a restart.

### Implemented fix

- DynamoDB stores an opaque account checkpoint with a stable operation ID, plan
  fingerprint, adapter list, completed-adapter list, and lifecycle state. It
  stores neither account ID nor robot IDs in the checkpoint record.
- Each adapter receives a stable operation-and-adapter-scoped
  `Idempotency-Key`. Recovery skips committed adapters and reuses that key when
  vendor success preceded a failed checkpoint write.
- A changed in-progress plan fails with a conflict, and account-local deletion
  remains fail-fast until every configured manufacturer processor completes.

### Regression evidence

- `durable vendor checkpoints skip completed adapter after later vendor failure`
- `crash after vendor success safely replays the same adapter idempotency key`
- `manufacturer deletion client forwards only a validated stable idempotency header`
- `Dynamo checkpoint uses an opaque account key and persists no robot identifiers`

**External boundary:** Exactly-once physical erasure still requires each real
manufacturer endpoint to durably honor the supplied idempotency key. That vendor
behavior was simulated, not validated.

---

## ROBOT-BUG-026 — Account deletion could race an already-started robot delivery

**Severity:** Critical
**Status:** Fixed in code
**Affected components:** account deletion fence, action outbox, in-flight delivery, recovery

### Description

An action can pass its account check just before deletion begins. If privacy
erasure proceeds while that request remains in flight, a late command can act on
the robot after account data was erased or recreate state that the deletion was
supposed to remove.

### Steps to reproduce the failure mode

1. Hold a manufacturer action after its final authorization check.
2. Begin account deletion and erase manufacturer data.
3. Release the held action after erasure.

### Expected behavior

Account deletion first persists its authentication fence, durably fails queued
robot work, and drains all bounded in-flight deliveries for that account.
Manufacturer erasure starts only after the fence completes. Any fence failure
must stop deletion.

### Actual behavior before fix

Deleting data repositories sequentially did not coordinate with robot outbox or
transport state.

### Implemented fix

- The privacy coordinator calls `beginAccountDeletion`, then
  `ActionGateway.fenceUserActions`, before deleting any account dataset.
- The action fence marks queued/pending outbox records `ACCOUNT_FENCED`, cancels
  pending ACK barriers, and waits for already-started bounded transports.
- Route and process-recovery paths consult the durable account-deletion state;
  a fence persistence/drain failure fails deletion closed.

### Regression evidence

- `account fence durably fails queued work and drains an in-flight request before returning`
- `account deletion guard fences durable recovery as ACCOUNT_FENCED without redelivery`
- `privacy deletion fences the account before mutation and marks completion last`
- `privacy deletion stops before manufacturer erasure when the action fence cannot drain`

**Screenshots/logs:** Tests use synthetic identities and controlled promises;
no real manufacturer delivery or account erasure was run.

---

## ROBOT-BUG-027 — Reusing one semantic idempotency key for different commands could return false success

**Severity:** High
**Status:** Fixed in code
**Affected components:** deterministic action identity, durable outbox, bridge execution ledger

### Description

A caller retrying the same command should receive its original accepted result.
But if the caller reuses that key with different parameters or target semantics,
a deterministic action ID alone can make the second request look like a harmless
duplicate and return success for work that was never requested originally.

### Steps to reproduce the failure mode

1. Send a medication action with idempotency key K and parameters A.
2. Send the same logical action and key K with parameters B, a different binding
   epoch, adapter target, or contract.
3. Observe whether the second request is accepted as the first request's retry.

### Expected behavior

An exact semantic duplicate returns the existing accepted action. Any mismatch
in user, device, action, parameters, immutable adapter target, binding epoch, or
contract returns HTTP 409 and never reaches the bridge.

### Actual behavior before fix

Action-ID equality did not by itself prove whole-request equality.

### Implemented fix

- ActionGateway persists a canonical request fingerprint covering the complete
  server-resolved request, including parameters, adapter/manufacturer target,
  binding epoch, contract, and idempotency key.
- Duplicate enqueue returns the prior action only when identity and fingerprint
  match; otherwise it fails with `ROBOT_IDEMPOTENCY_CONFLICT`/409.
- Robot deterministic IDs are binding-epoch scoped, and the bridge independently
  rejects reuse of an action ID with a different signed-body digest.

### Regression evidence

- `stable mobile idempotency keys do not redeliver a durably accepted command`
- `reuse of an idempotency key with different parameters fails with 409`
- `signature, expiry, adapter binding, request bounds, and idempotency conflicts fail closed`

**Screenshots/logs:** Fingerprints/digests are compared in tests; command
parameters and credentials are not emitted to logs.

---

## ROBOT-BUG-028 — Slow pairing could bind a robot after account deletion completed

**Severity:** Critical
**Status:** Fixed in code

**Description / reproduction:** Start an authenticated pairing request, hold the
manufacturer verifier, complete account deletion while no robot is yet bound,
then release verification. Authentication before the wait was insufficient: the
old transaction could create owner/account robot rows for a deleted account.

**Direct fix:** `consumeAndBind` now performs a cross-table DynamoDB
`ConditionCheck` on `ACCOUNT#STATE` in the same transaction as QR consumption,
ownership, and user binding. A transaction losing to deletion re-reads the state
strongly and returns 423/410. Regression: `pairing transaction loses atomically
to account deletion after slow manufacturer verification`.

## ROBOT-BUG-029 — Process death could strand account deletion without a credential

**Severity:** High
**Status:** Fixed in code

**Description / reproduction:** Kill the process after session rows were deleted
but before the account marker changed from `deleting` to `deleted`. The only
credential able to resume deletion was gone.

**Direct fix:** `finalizeAccountDeletion` preserves the canonical requesting
session while deleting excess rows, then transactionally deletes the final
bounded session set and flips the account marker. The privacy endpoint passes
the authenticated session ID, and a crash-before-terminal-commit test proves the
same credential can resume before final revocation.

## ROBOT-BUG-030 — Reset retries had no recurring recovery trigger

**Severity:** High
**Status:** Fixed in code

**Description / reproduction:** Fail a reset, or start while its retry time is in
the future or beyond the first 25 GSI results. A single startup recovery pass
left the binding fenced indefinitely.

**Direct fix:** the reset coordinator now owns an unref'd recurring recovery
worker, repeatedly drains due checkpoints, and applies the persisted exponential
retry schedule. Tests cover future-due work and more records than one pass limit.

## ROBOT-BUG-031 — GSI lag could hide an action from privacy deletion

**Severity:** High
**Status:** Fixed in code

**Description / reproduction:** Commit an outbox item to the base table and begin
deletion before the user GSI contains it. GSI-only fencing/deletion could return
success while retaining the action envelope.

**Direct fix:** mutation paths use strongly consistent, paginated base-table
scans with bounded repeat/absence verification. Export retains the GSI for
performance. Regression: `privacy mutation sees a newly committed action even
when the user GSI has not propagated`.

## ROBOT-BUG-032 — Reset lease identity was not an attempt generation

**Severity:** Medium
**Status:** Fixed in code

**Description / reproduction:** Let attempt A exceed its lease, let attempt B in
the same process reclaim it, then return A's late failure. A static process owner
could satisfy the old failure CAS and demote B.

**Direct fix:** every claim receives a new cryptographic token; failure recording
conditions on that exact token. The stale attempt can no longer mutate the new
generation.

## ROBOT-BUG-033 — Concurrent robot-credential mutations lost updates

**Severity:** High
**Status:** Fixed in code

**Description / reproduction:** Run two `saveRobotPairingCredential` operations,
or save concurrently with logout/reset cleanup. Unsynchronized read/modify/write
could drop one robot or resurrect data after clear.

**Direct fix:** save/remove/clear are serialized; loads await the mutation queue;
user writes join the shared privacy drain and cleanup waits for prior mutations.
Tests cover simultaneous saves and clear-versus-save ordering.

## ROBOT-BUG-034 — Malformed telemetry retained a ghost-online robot

**Severity:** High
**Status:** Fixed in code

**Description / reproduction:** Establish `online: true`, then return a fresh
object containing only `reported_at`. The old status stayed online and its error
was cleared.

**Direct fix:** authoritative telemetry requires a Boolean `online`; a missing or
invalid value fails the device offline/unknown, clears navigation/indoor state,
and retains a typed schema error.

## ROBOT-BUG-035 — Unsigned direct HAL methods could bypass reset generation fencing

**Severity:** High (latent interface defect)
**Status:** Fixed in code

**Description / reproduction:** After revoking a binding epoch, call a direct HAL
side-effect method rather than `deliverSignedAction`. Its provisional `/commands`
contract carried no signed binding generation.

**Direct fix:** unsigned direct side effects are disabled by default and throw
`ADAPTER_REQUEST_REJECTED`; only unit/prototype configurations can explicitly set
`allowProvisionalUnsignedCommands`. Production orchestration exposes only signed
v2 action delivery.

## ROBOT-BUG-036 — Redirects could forward pairing/reset credentials

**Severity:** High
**Status:** Fixed in code

**Description / reproduction:** Return HTTP 307/308 from the backend safety API
during pair/reset. Default fetch redirect behavior can resend the QR body or
`X-Device-Pairing-Token` to another origin.

**Direct fix:** the shared authenticated mobile request uses `redirect: "error"`;
tests assert the pair/reset request options. Robot and server manufacturer
transports retain the same policy.

## ROBOT-BUG-037 — Manufacturer response loss could brick a consumed QR

**Severity:** High
**Status:** Fixed in the provisional contract; real-vendor support required

**Description / reproduction:** Let the manufacturer consume a one-time QR, then
drop the response before Veryloving learns the device identity. A blind retry may
receive HTTP 410 forever.

**Direct fix:** verification uses a secret-derived stable `Idempotency-Key` and
`veryloving.robot-pairing-verify.v1`; the bridge persists and replays the matching
`claim_id` receipt, while another identity receives 410. The test bridge now
models consumption and deliberate response loss. A real vendor/edge bridge must
durably implement this contract before activation.

## ROBOT-BUG-038 — Non-success bodies leaked robot HTTP resources

**Severity:** Medium
**Status:** Fixed in code

**Description / reproduction:** Repeatedly return HTTP 500 with a readable body.
The mobile robot client threw before cancelling/consuming it, potentially
exhausting native connection resources.

**Direct fix:** non-success bodies are cancelled exactly once before the error is
released. A focused test counts cancellation.

## ROBOT-BUG-039 — Indoor position lacked an independent timestamp gate

**Severity:** Medium
**Status:** Fixed in code

**Description / reproduction:** Send a fresh status with a room/map value but no
indoor `captured_at`. The old normalizers could present an arbitrarily old room
as current.

**Direct fix:** TypeScript HAL, mixed-vendor runtime, legacy client, bridge
fixture, and mobile normalizer all require a positive, freshness-bounded indoor
timestamp.

## ROBOT-BUG-040 — Callback credentials could equal outbound credentials

**Severity:** Medium
**Status:** Fixed in code

**Description / reproduction:** Configure an adapter's callback key equal to its
vendor-facing bridge key. Compromise of one trust direction then authenticated
the other.

**Direct fix:** runtime construction rejects every callback key that equals any
outbound or callback key across the adapter registry. Focused configuration
tests cover same-adapter and cross-adapter collisions.

## ROBOT-BUG-041 — Mobile pairing/reset body consumption was unbounded

**Severity:** Medium
**Status:** Fixed in code

**Description / reproduction:** Return a stalled or oversized response from the
authenticated backend. `response.json()` could outlive the abort path or consume
unbounded data.

**Direct fix:** the mobile safety transport owns a hard deadline across fetch and
body consumption, streams/cancels at 1 MiB where available, validates UTF-8/JSON,
and fails with typed errors. Tests cover ignored abort, stalled reads, oversize,
and cancellation. Synthetic test inputs contain no real credentials or PII.

## Candidate verification record

The following checks were freshly run after the fixes in this log on the 18 July
2026 delivery candidate. No generated export or coverage directory is retained
in the repository. The delivery report binds this working-tree evidence to the
final commit SHA; mock and synthetic results remain explicitly non-hardware
evidence.

| Check | Command/evidence | Result |
| --- | --- | --- |
| Consolidated development/source gate | `npm run validate` | PASS on 18 July 2026; includes development-profile environment validation, lint, tests, Expo Doctor, and both platform exports; it does not run or waive the production-profile gate |
| Local production environment gate | `npm run validate-env -- --profile production` | FAIL closed as expected on 18 July 2026: 12 checks OK, 3 warnings, and 11 errors because required production action/signing inputs, feature gates, and approved VL01 UUIDs were not provisioned |
| Adapter typecheck | `npm run typecheck:adapters` (also part of adapter build) | PASS |
| Adapter unit/coverage | `npm run test:adapters` | PASS: 23/23; 99.32% statements/lines, 91.93% branches, 98.48% functions |
| Test bridge integration | `npm run test:integration:adapters` | PASS: 7/7 |
| Existing and new full suite | `npm test` | PASS: 535 core tests, 23 adapter tests, and 7 bridge integration tests (565 total) |
| Lint/static checks | `npm run lint`, adapter typecheck, and `git diff --check` | PASS |
| Expo Doctor | `npx expo-doctor` through `npm run validate` | PASS: 20/20 |
| iOS/Android exports | `npx expo export --platform ios` and `--platform android` through `npm run validate` | PASS: both Metro/Hermes production JavaScript exports |
| Root and server production dependency audit | `npm audit --omit=dev` in both package roots | PASS: zero known production dependency vulnerabilities reported at audit time |
| Server dependency/build stage | `npm ci --ignore-scripts && npm run build` from `server/` | PASS |
| Short synthetic transport soak | `ROBOT_SOAK_DURATION_MS=2000 npm run test:soak:adapters` | PASS: 2,000 ms, 148,523 in-memory commands, sampled p95 acceptance 0.013 ms, 1,317,336-byte heap delta, and no active-handle growth; not a vendor, hardware, or long-duration result |
| Container build/health | release image digest and health probe | _Not run: no Docker-compatible CLI was installed in the audit environment_ |
| Vendor sandbox | vendor evidence ID | _Not run_ |
| Real hardware | exact SKU/BOM/firmware report | _Not run_ |
| 72-hour soak | signed test report | _Not run_ |

Do not replace “Not run” with an inference from unit tests. The final delivery
report must record the exact post-fix commands and immutable commit separately.
