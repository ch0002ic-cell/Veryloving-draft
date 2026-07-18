# Robot Adapter Integration Guide

Last reviewed: 18 July 2026

This guide covers the Veryloving Product 2 prototype for Yongyida and Jiangzhi. The runnable endpoints are test/Veryloving bridge contracts. They are not official manufacturer endpoints and must not be pointed at guessed vendor URLs.

Read [robot-hal-architecture.md](./robot-hal-architecture.md) for trust boundaries and [hardware-partner-research.md](./hardware-partner-research.md) before enabling a vendor.

## 1. What is implemented

The repository contains:

- a vendor-neutral TypeScript interface in [`server/src/adapters/RobotAdapter.ts`](../server/src/adapters/RobotAdapter.ts);
- hardened REST bridge transport in [`server/src/adapters/RestRobotAdapter.ts`](../server/src/adapters/RestRobotAdapter.ts);
- provisional [`YongyidaAdapter`](../server/src/adapters/YongyidaAdapter.ts) and [`JiangzhiAdapter`](../server/src/adapters/JiangzhiAdapter.ts);
- an explicit per-instance factory and registry in [`AdapterFactory.ts`](../server/src/adapters/AdapterFactory.ts);
- a CommonJS runtime bridge in [`server/robot-adapter-runtime.cjs`](../server/robot-adapter-runtime.cjs) that loads compiled adapters into the existing gateway;
- mixed-vendor routing, signed actions, per-device queues, durable outbox recovery, and asynchronous ACK handling in [`server/action-gateway.cjs`](../server/action-gateway.cjs);
- QR ownership binding, one-time claim enforcement, and same-account interrupted-pairing recovery in [`server/robot-pairing.cjs`](../server/robot-pairing.cjs);
- an account-authorized, bounded telemetry snapshot path for status, battery, vitals, location, navigation path, indoor position, safety events, and medication acknowledgements;
- a test-only strict manufacturer bridge in [`tests/integration/manufacturer-mock-server.js`](../tests/integration/manufacturer-mock-server.js).

The final translation from the provisional bridge to a real Yongyida API or Jiangzhi SDK/HAL is not implemented because neither vendor has supplied a verified partner contract. Real hardware behavior, vendor latency, and medical data are unvalidated.

## 2. Prerequisites

- Node.js 22, matching `server/package.json`.
- npm with the committed lockfile.
- A DynamoDB table using string `PK` and `SK`, TTL, the action-outbox GSI, and the factory-reset recovery GSI described in the main README.
- An Ed25519 action-signing key pair held by the long-lived gateway.
- Separate server-only bridge and callback credentials for every enabled adapter.
- For production, HTTPS bridge and pairing-verification endpoints; HTTP is test/development only.
- A supported long-lived container host for the voice/action gateway. The HTTP-only Vercel function is not an action-delivery host.

Install from the repository root:

```bash
npm ci
```

Build the adapters before starting the backend:

```bash
npm run build:adapters
```

Compiled output is generated under `server/dist/adapters`. It is a build artifact and should be rebuilt from source, not hand-edited.

## 3. Server environment

Copy `server/.env.example` to an uncommitted runtime secret file or, preferably, set these in the deployment secret manager. Never put real values in `.env.example` or in an `EXPO_PUBLIC_*` variable.

### 3.1 Shared action and persistence settings

| Variable | Required use |
| --- | --- |
| `ACTION_SIGNING_PRIVATE_KEY` | Ed25519 PKCS8 private key, PEM or base64url DER; server only |
| `ACTION_SIGNING_PUBLIC_KEY` | Matching raw 32-byte Ed25519 public key in base64url |
| `DEVICE_TABLE_NAME` | Robot binding, outbox, push, and related account data table |
| `ACTION_OUTBOX_USER_INDEX_NAME` | GSI for restart recovery; partition `user_index_pk`, sort `user_index_sk` |
| `ROBOT_RESET_RECOVERY_INDEX_NAME` | GSI for reset recovery; partition `resetRecoveryPk` (String), sort `resetRecoveryAt` (Number) |
| `ROBOT_PAIRING_TOKEN_SECRET` | Independent HMAC secret, at least 32 characters, used to derive an account/scope/claim-bound possession token that can be reissued after an interrupted pairing response |
| `ACTION_GATEWAY_SINGLE_REPLICA` | Must be `true` for the current production gateway; acknowledges that per-device delivery ownership is process-local until distributed leases are implemented |
| `ROBOT_ACK_TIMEOUT_MS` | Maximum wait after a bridge returns 202; default 30000 |
| `ACTION_REQUEST_TIMEOUT_MS` | Shared legacy manufacturer/status/reset timeout; default 5000 |

Follow the main server environment documentation for authentication, Hume, push tokens, AWS region, and the wearable command mapping.

### 3.2 Yongyida bridge adapter

| Variable | Meaning |
| --- | --- |
| `YONGYIDA_ADAPTER_ENABLED` | `true` to register the adapter |
| `YONGYIDA_ADAPTER_ID` | Immutable deployment ID; default `yongyida-cloud` |
| `YONGYIDA_BRIDGE_URL` | HTTPS base URL of the Veryloving-owned Yongyida cloud bridge |
| `YONGYIDA_BRIDGE_API_KEY` | Server-to-bridge bearer credential |
| `YONGYIDA_CALLBACK_API_KEY` | Independent credential used by this adapter's ACK callback |
| `YONGYIDA_PAIRING_VERIFY_URL` | HTTPS endpoint that validates one-time Yongyida QR claims |
| `YONGYIDA_RESET_URL` | HTTPS endpoint that synchronously confirms reset and user-data erasure |
| `YONGYIDA_PRIVACY_EXPORT_URL` | HTTPS endpoint for Yongyida-bound account export |
| `YONGYIDA_PRIVACY_DELETE_URL` | HTTPS endpoint that synchronously confirms Yongyida-bound erasure |

### 3.3 Jiangzhi edge adapter

| Variable | Meaning |
| --- | --- |
| `JIANGZHI_ADAPTER_ENABLED` | `true` to register the adapter |
| `JIANGZHI_ADAPTER_ID` | Immutable deployment ID; default `jiangzhi-edge` |
| `JIANGZHI_BRIDGE_URL` | HTTPS-reachable Veryloving Android edge-bridge base URL or managed relay URL |
| `JIANGZHI_BRIDGE_API_KEY` | Server-to-edge bearer credential |
| `JIANGZHI_CALLBACK_API_KEY` | Independent credential used by this adapter's ACK callback |
| `JIANGZHI_PAIRING_VERIFY_URL` | HTTPS endpoint that validates one-time Jiangzhi QR claims |
| `JIANGZHI_RESET_URL` | HTTPS endpoint that synchronously confirms reset and user-data erasure |
| `JIANGZHI_PRIVACY_EXPORT_URL` | HTTPS endpoint for Jiangzhi-bound account export |
| `JIANGZHI_PRIVACY_DELETE_URL` | HTTPS endpoint that synchronously confirms Jiangzhi-bound erasure |

### 3.4 Shared adapter transport bounds

| Variable | Default | Constraint |
| --- | --- | --- |
| `ROBOT_ADAPTER_TIMEOUT_MS` | `5000` | Bounded adapter request timeout |
| `ROBOT_ADAPTER_MAX_ATTEMPTS` | `3` | Adapter accepts 1–5 attempts |
| `ROBOT_ADAPTER_RETRY_BASE_MS` | `100` | Initial exponential backoff |
| `ROBOT_ADAPTER_RETRY_MAX_MS` | `2000` | Maximum backoff |
| `ROBOT_ADAPTER_ALLOW_INSECURE_HTTP` | `false` | Test/development only; ignored in production |

Production adapter and callback keys are required by the runtime validator to be at least 32 characters. Every callback secret must differ from every outbound and callback secret across the enabled registry; startup fails closed on any collision. Length is only a minimum validation—use independently generated high-entropy secrets and rotate them through the secret manager.

### 3.5 Reset and privacy endpoints

Bindings created before the adapter rollout (`manufacturer-default`) continue to use the shared legacy control-plane variables:

```text
MANUFACTURER_RESET_URL
MANUFACTURER_PRIVACY_EXPORT_URL
MANUFACTURER_PRIVACY_DELETE_URL
MANUFACTURER_API_KEY
```

Modern bindings never use those shared endpoints. They route reset/export/deletion through the matching adapter's URLs and API key. If any adapter-specific handler is absent, the operation fails closed and the local binding/data is retained. Do not point a shared legacy URL/key directly at one vendor and assume modern bindings are covered.

### 3.6 Example with both adapters

The following contains placeholders only:

```dotenv
YONGYIDA_ADAPTER_ENABLED=true
YONGYIDA_ADAPTER_ID=yongyida-cloud
YONGYIDA_BRIDGE_URL=https://yongyida-bridge.example.invalid/
YONGYIDA_BRIDGE_API_KEY=<secret-manager-reference>
YONGYIDA_CALLBACK_API_KEY=<independent-secret-manager-reference>
YONGYIDA_PAIRING_VERIFY_URL=https://yongyida-bridge.example.invalid/v1/pairing/verify
YONGYIDA_RESET_URL=https://yongyida-bridge.example.invalid/v1/reset
YONGYIDA_PRIVACY_EXPORT_URL=https://yongyida-bridge.example.invalid/v1/privacy/export
YONGYIDA_PRIVACY_DELETE_URL=https://yongyida-bridge.example.invalid/v1/privacy/delete

JIANGZHI_ADAPTER_ENABLED=true
JIANGZHI_ADAPTER_ID=jiangzhi-edge
JIANGZHI_BRIDGE_URL=https://jiangzhi-edge-relay.example.invalid/
JIANGZHI_BRIDGE_API_KEY=<secret-manager-reference>
JIANGZHI_CALLBACK_API_KEY=<independent-secret-manager-reference>
JIANGZHI_PAIRING_VERIFY_URL=https://jiangzhi-edge-relay.example.invalid/v1/pairing/verify
JIANGZHI_RESET_URL=https://jiangzhi-edge-relay.example.invalid/v1/reset
JIANGZHI_PRIVACY_EXPORT_URL=https://jiangzhi-edge-relay.example.invalid/v1/privacy/export
JIANGZHI_PRIVACY_DELETE_URL=https://jiangzhi-edge-relay.example.invalid/v1/privacy/delete

ROBOT_ADAPTER_TIMEOUT_MS=5000
ROBOT_ADAPTER_MAX_ATTEMPTS=3
ROBOT_ADAPTER_RETRY_BASE_MS=100
ROBOT_ADAPTER_RETRY_MAX_MS=2000
ROBOT_ADAPTER_ALLOW_INSECURE_HTTP=false
ROBOT_PAIRING_TOKEN_SECRET=<independent-secret-manager-reference>
ACTION_GATEWAY_SINGLE_REPLICA=true
```

`.invalid` is intentional; replace it only with a controlled bridge that implements the documented provisional contract or a reviewed successor.

## 4. Starting the gateway

Validate and build from the repository root:

```bash
npm run validate-env
npm run typecheck:adapters
npm run build:adapters
```

Then start the long-lived service with its environment injected:

```bash
set -a
source server/.env
set +a
npm run clm:start
```

Node does not automatically load `server/.env` for this command. The shell snippet above is for a local, ignored secret file; deployment environments should inject the same values from their secret manager.

Check `GET /health` for process liveness. A healthy response does not prove Hume authentication, DynamoDB permissions, adapter credentials, vendor connectivity, signed-action verification, or physical robot execution.

The production Dockerfile builds TypeScript in a builder stage and copies only compiled adapter output and runtime dependencies into the non-root image. Run the same image and configuration through staging before production.

## 5. Selecting and pairing a manufacturer

There is no global `ROBOT_TYPE`. Vendor selection happens per robot during pairing and is persisted as `adapter_id` in the account binding.

Current default deployment IDs are:

```text
Yongyida -> yongyida-cloud
Jiangzhi -> jiangzhi-edge
```

The mobile pairing screen sends only the selected vendor and the opaque QR code. It never chooses a deployment adapter ID:

```http
POST /v1/devices/home-robots/pair
Authorization: Bearer <Veryloving session JWT>
Content-Type: application/json

{
  "robot_vendor": "jiangzhi",
  "qr_code": "<opaque manufacturer QR payload>"
}
```

The server then:

1. resolves that vendor to exactly one enabled, allowlisted server-side adapter configuration;
2. hashes the adapter-scoped QR claim and derives a stable possession token from that hash, the authenticated account, the adapter scope, and `ROBOT_PAIRING_TOKEN_SECRET`;
3. checks DynamoDB first for a completed binding owned by the same account, allowing an app that lost the first HTTP response to recover the same robot ID and possession token without asking the manufacturer to consume the QR again;
4. rejects a claim already bound to another account with HTTP 410 before contacting the manufacturer;
5. for a new claim, derives a stable secret-bound verification ID and calls that adapter's configured pairing-verification URL with `X-Veryloving-Pairing-Contract: veryloving.robot-pairing-verify.v1`, that ID as `Idempotency-Key`, and the exact body `{ contract_version: "vl-robot-pairing-verify/1", pairing_code }`;
6. requires the bridge to replay the same receipt for that ID after response loss and to return the matching `claim_id`, one-time/unexpired result, hardware serial, and opaque manufacturer device ID;
7. transactionally checks the account is not deleting/deleted while recording `used_at`, `bound_to`, the hashed serial, opaque manufacturer device ID, adapter ID, and hashed possession token;
8. returns the private Veryloving robot ID and possession credential.

The HMAC derivations are response-loss recovery mechanisms, not permission to reuse a QR for another account or adapter scope. The provisional manufacturer bridge must consume a one-time claim once, persist the correlated receipt before responding, replay it for the identical verification ID, and reject a different ID with HTTP 410. Rotate `ROBOT_PAIRING_TOKEN_SECRET` only through a migration/runbook that accounts for active robot possession credentials and verification receipts; an uncoordinated rotation makes those credentials or ambiguous pairing retries unrecoverable.

The app stores the possession credential in account-scoped protected storage and does not put it in the device descriptor, AsyncStorage entity list, map feature, or logs. Pairing logs use one-way claim/serial references and a hashed `robotReference`; they do not emit the returned logical robot ID, raw QR, hardware serial, manufacturer device ID, account ID, or possession token.

Custom deployment adapter IDs therefore do not require a mobile release. If a deployment ever enables multiple configurations for the same vendor, pairing fails closed until an authenticated server-owned adapter catalog or another unambiguous selection rule is implemented.

Pair one robot from each manufacturer to operate a mixed fleet. The registry and ActionGateway choose the adapter from each stored binding; enabling both environment blocks does not send one action to both vendors.

The TypeScript interface retains vendor-neutral direct command methods for adapter conformance and isolated prototypes, but their unsigned `/commands` transport is disabled by default. Production orchestration must call only `deliverSignedAction`; `allowProvisionalUnsignedCommands` is test/prototype-only and must never be enabled on a deployed gateway.

## 6. Command flow and bridge contract

Mobile actions use:

```http
POST /v1/device-actions
Authorization: Bearer <Veryloving session JWT>
X-Device-Pairing-Token: <account-bound robot possession token>
Idempotency-Key: <stable caller ID>
Content-Type: application/json

{
  "device_type": "home_robot",
  "device_id": "<private Veryloving robot ID>",
  "action": "check_medication",
  "parameters": {
    "medication_id": "<opaque medication ID>"
  },
  "idempotency_key": "<same stable caller ID>"
}
```

The server ignores any client attempt to supply a manufacturer device, adapter identity, or binding generation. It resolves all three from DynamoDB, signs `vl-robot-action/2` with a positive `binding_epoch`, durably queues it, and returns HTTP 202 with the action ID. Bindings created before the epoch migration fail closed until they are explicitly migrated; the server never guesses a generation for an old record.

The adapter initializes its bridge session and calls one of these Veryloving-owned prefixes:

```text
Yongyida: /v1/veryloving/yongyida-cloud
Jiangzhi: /v1/veryloving/jiangzhi-edge
```

Bridge operations are `POST` requests to `session`, `commands`, `signed-actions`, and telemetry query paths. See the architecture document for request bounds and signature verification requirements.

The `signed-actions` receipt is also strict. HTTP 202 must return the same `action_id` with `state: "accepted"` and `ok: true`. HTTP 200 must return the same ID with `state: "completed"` and `ok: true`. A rejection uses a non-2xx response before acceptance or a later authenticated negative ACK. The adapter rejects an empty, unrelated, failed, or contradictory 2xx receipt.

## 7. Asynchronous ACK callback

When signed delivery returns HTTP 202, the action remains `pending_ack`. The corresponding bridge posts its later outcome to:

```http
POST /v1/manufacturer/robot/ack
X-Robot-Adapter-Id: jiangzhi-edge
X-Robot-Callback-Key: <that adapter's callback key>
Content-Type: application/json

{
  "action_id": "<signed action UUID>",
  "binding_epoch": 7,
  "ok": true
}
```

A rejection may include a bounded `error_code`. The gateway authenticates the callback against the named adapter and requires the callback generation to match the pending action. It will not accept another adapter or an older/newer binding epoch. A successful HTTP response from the callback is still not a substitute for the bridge's durable exactly-once execution ledger.

## 7.1 Factory reset contract

`DELETE /v1/devices/home-robots/<robot-id>` starts or resumes a durable reset saga. The caller supplies its session JWT and `X-Device-Pairing-Token`. Before any manufacturer call, the backend changes the binding lifecycle from `active`, durably fails queued work for that exact binding epoch, and waits for bounded in-flight requests. The reset worker uses one stable `reset_id` across retries and process restarts.

The selected bridge receives exactly:

```http
POST <adapter reset URL>
Idempotency-Key: <stable reset UUID>
X-Veryloving-Reset-Contract: veryloving.robot-reset.v1
Content-Type: application/json

{
  "contract_version": "vl-robot-reset/1",
  "reset_id": "<stable reset UUID>",
  "robot_id": "<server-resolved manufacturer ID>",
  "binding_epoch": 7,
  "erase_user_data": true
}
```

Only HTTP 200 with matching `reset_id`/`binding_epoch` and `{ "state": "completed", "erased": true, "fenced": true }` proves completion. HTTP 202/204, a mismatched generation, or partial/malformed JSON fails closed. After that proof, DynamoDB atomically writes the reset receipt and leaves a data-minimized unbound epoch high-water tombstone. Re-pairing the same physical serial receives epoch 8, so delayed epoch-7 work remains invalid. The bridge must durably deduplicate `reset_id` and reject signed actions at or below every reset epoch; this downstream behavior remains a vendor conformance gate.

Outbox/ACK state is durable and an authenticated callback can complete its adapter-bound transition on a fresh gateway replica. The live per-device queue and ordering barrier are process-local, however. Keep exactly one long-lived delivery replica and set `ACTION_GATEWAY_SINGLE_REPLICA=true` in production until distributed per-device leases are implemented; do not run active-active action delivery merely because durable ACK recovery is cross-replica capable.

Account deletion first persists its account fence, drains delivery, and performs vendor erasure. The requesting session remains available for an interrupted retry until `finalizeAccountDeletion` atomically deletes the terminal session set and changes the account marker to `deleted`. Pairing carries the same account marker as a Dynamo transaction condition, so a slow verification cannot create a binding after deletion wins.

If no valid callback arrives before `ROBOT_ACK_TIMEOUT_MS`, the outbox marks the action failed and the app user receives: “Robot command failed. Please check your robot's network connection.”

## 8. Telemetry

The app fetches account-authorized telemetry using its JWT and robot possession token:

```http
GET /v1/devices/<private-robot-id>/telemetry
Authorization: Bearer <Veryloving session JWT>
X-Device-Pairing-Token: <account-bound robot possession token>
```

The server resolves the adapter and manufacturer device from the account binding and calls the provisional bridge's `telemetry/snapshot/query` operation. The implemented snapshot can return:

- authoritative status (`online`, `hardware_status`, `reported_at`, optional `firmware_version`);
- battery percentage/charging state and up to 100 vital observations;
- one timestamped location, one timestamped path with up to 500 navigation
  points, and one bounded indoor position;
- up to 20 safety events and 20 medication acknowledgements.

The adapter and runtime reject malformed or oversized shapes. A stale, future, or invalid authoritative status—or a status with no Boolean `online` field—suppresses the sensor/event snapshot and reports offline/unknown. Battery, vitals, location, navigation path, indoor position, safety events, and medication acknowledgements also have their own freshness checks; stale/future optional samples are omitted. The provisional bridge contract requires Unix-millisecond `captured_at` values on location, the complete navigation path, and indoor position. Timestamp-less spatial fields fail closed even when status is fresh. `HomeRobotDevice` applies its own independent timeout across credentials, fetch, and response consumption (even when abort is ignored), refuses redirects, accepts only object JSON from bounded UTF-8 text, cancels stalled/non-success bodies when possible, updates bounded location/path/battery state, marks network failures offline, and retries locally queued commands when connectivity returns.

This is an authenticated polling path against the **provisional Veryloving bridge contract**. It is not evidence that either manufacturer emits these fields, that a callback/event-ingestion pipeline is deployed, that medical values are clinically valid, or that vendor retention/consent obligations are satisfied. A real vendor mapping, provenance/quality contract, event authentication/replay design, privacy review, and exact-hardware conformance remain production blockers.

Do not expose raw camera frames, medical records, serials, or vendor response bodies through the status endpoint. Add new telemetry only through a versioned, bounded normalizer and update retention/privacy review at the same time.

## 9. Jiangzhi Edge Bridge deployment

The TypeScript `JiangzhiAdapter` expects an HTTP service; it does not execute ADB commands. A production Android edge bridge must:

- run as a signed, managed APK/service on the frozen production Android image;
- authenticate the server/relay, verify Ed25519 actions, expiry, adapter/device target, and idempotency before local execution;
- use a supported Jiangzhi SDK/HAL behind a narrow module boundary;
- persist replay claims and ACKs across Android process death and power loss;
- implement local safety interlocks and offline emergency behavior;
- expose only normalized, consented telemetry;
- support key rotation, signed OTA, rollback, factory reset, bounded logs/storage, and health reporting.

ADB is permitted only for isolated lab provisioning and diagnosis. Disable production network ADB. Do not use shell commands or UI automation as the runtime control plane.

No public JZKH1.0 or Jiangzhi robot-control SDK was found. Obtain the exact AAR/JAR/AIDL/Binder/serial/BLE contract and license before replacing edge stubs.

## 10. Yongyida bridge deployment

The TypeScript `YongyidaAdapter` expects a Veryloving cloud bridge. That bridge must:

- authenticate Veryloving and the partner cloud independently;
- verify signed actions before translating them;
- map provisional `VL_*` operations to documented vendor commands;
- preserve the Veryloving action ID through vendor idempotency and callbacks;
- normalize status, battery, telemetry, errors, and timestamps;
- shield the core gateway from vendor credential rotation and API versions;
- provide deterministic sandbox behavior and production monitoring.

Do not use `https://api.yongyida.com` or any other guessed hostname. Public Yongyida material does not provide a callable endpoint or authentication method.

## 11. Tests

Run the full deterministic suite from the repository root:

```bash
npm test
```

The command builds adapter TypeScript, runs the core `node:test` suite, runs adapter Jest tests with coverage gates, and runs the test-only manufacturer bridge integration flow.

`npm run validate` is the development/source release gate. It does not run or waive the separate production environment gate:

```bash
npm run validate-env -- --profile production
```

The recorded local production-profile result on 18 July 2026 was intentionally fail-closed: 12 checks OK, 3 warnings, and 11 errors because production action/signing inputs, feature gates, and approved VL01 UUIDs were not provisioned. Re-run it with the candidate deployment environment and retain only redacted results.

Useful focused commands are:

```bash
npm run typecheck:adapters
npm run test:adapters
npm run test:integration:adapters
npm run test:soak:adapters
npm run test:core
npm run lint
```

The Jest configuration enforces 90% global statements, branches, functions, and lines for executable adapter implementation files. Do not describe the target as met unless the current command exits zero and prints coverage at or above each threshold.

The mock server refuses to load unless `NODE_ENV=test`. It must remain under `tests/integration`; do not package or deploy it with the server. Its deterministic controls cover:

- both vendor prefixes and sessions;
- signature and envelope verification;
- expiry and adapter/device targeting;
- stable idempotency and conflict rejection;
- 202 versus synchronous ACK behavior;
- the bounded provisional telemetry snapshot, including status, battery, vitals, location/path, indoor position, safety events, medication acknowledgements, and stale/future suppression;
- authentication failure, HTTP 500, timeout, malformed JSON, and oversized payloads.

These tests prove Veryloving contract behavior only. They do not exercise Hume's hosted service, a manufacturer sandbox, a real Android image, a real robot, or medical instruments.

## 12. Fault-testing checklist

Run these against the test bridge first, then an approved vendor sandbox, then production-representative hardware:

| Scenario | Expected result |
| --- | --- |
| 401/403 bridge response | One attempt; `ADAPTER_AUTH_FAILED`; no credential retry |
| Retryable 500/503/429 | Bounded exponential retry with unchanged idempotency key |
| Fetch ignores `AbortSignal` | Adapter still reaches its own bounded timeout |
| Mobile relay fetch ignores abort or body stalls | `HomeRobotDevice` reaches `ROBOT_NETWORK_TIMEOUT`, cancels the body where possible, retains durable commands, and does not mark hardware online |
| Malformed or oversized response | Typed failure; no inferred status and no blind retry |
| Duplicate signed action | Same receipt/outcome; one recorded physical execution |
| Same action ID with different body | HTTP 409 idempotency conflict |
| Expired or wrong-target action | Rejected before physical dispatch |
| One vendor stalls | Other adapter/device proceeds independently |
| Gateway process dies after enqueue | Unexpired outbox action recovers once after restart |
| Process dies after physical execution before ACK | Receiver replay ledger prevents a second physical effect |
| HTTP 202 with no callback | ACK timeout, failed outbox state, user push notification |
| Stale/invalid telemetry | Robot shown offline/unknown |
| App loses internet | Robot marked offline; bounded commands remain account-scoped; wearable BLE remains independent |

Do not simulate a 24-hour or 72-hour soak by extrapolating a short test. Record exact duration, build SHA, hardware SKU/serial hash, firmware, network profile, sampling interval, memory/socket/timer/storage curves, command count, and failure count.

The committed soak harness defaults to 60 seconds and accepts a bounded duration up to 24 hours. For a 24-hour software-transport run:

```bash
ROBOT_SOAK_DURATION_MS=86400000 npm run test:soak:adapters
```

This harness uses an in-process test transport. It checks heap and active-handle growth but does not replace a 72-hour exact-hardware/vendor-network soak.

## 13. Adding a real vendor mapping

When partner artifacts arrive:

1. Archive the versioned API/SDK/HAL and license in the approved internal artifact system.
2. Freeze the exact model, BOM, OS/firmware, and compatibility range.
3. Write a bridge conformance table for every HAL method, including unsupported methods.
4. Implement translation inside the Yongyida cloud bridge or Jiangzhi edge HAL module, not in Hume prompts or mobile screens.
5. Preserve account-resolved identity, signed payload, expiry, idempotency, and ACK semantics.
6. Add fixture-based contract tests for every vendor response/error and a sandbox integration suite.
7. Add key rotation, rate-limit, outage, rollback, reset, privacy export/delete, and version-deprecation tests.
8. Run real hardware safety, latency, process-death, network-split, power-loss, and soak acceptance.
9. Keep the adapter disabled until security, privacy, safety, regulatory, and commercial gates sign off.

## 14. Troubleshooting

| Symptom/code | Check |
| --- | --- |
| `Robot adapter build is missing` | Run `npm run build:adapters`; confirm `server/dist/adapters` exists in the runtime image |
| `ROBOT_ADAPTER_NOT_CONFIGURED` | Stored `adapter_id` does not match an enabled immutable deployment ID |
| `ROBOT_ADAPTER_BINDING_MISMATCH` | Signed adapter/manufacturer target does not match runtime selection; do not rewrite the envelope |
| `ADAPTER_AUTH_FAILED` | Bridge bearer/session key, endpoint trust, clock/key rotation; never log the secret |
| `ADAPTER_TIMEOUT` / unavailable | Bridge connectivity and bounded retry metrics; do not increase limits before finding the failure |
| `ADAPTER_RESPONSE_INVALID` | Bridge schema, timestamps, signed receipt/action ID, or malformed JSON |
| Pairing HTTP 410 | Claim is expired, conflicts with an existing binding, or belongs to another account. A response-loss retry by the original account should resume rather than return 410; investigate that path before requesting a new code |
| Pairing requests manufacturer selection | Mobile `robot_vendor` is missing/unsupported, or the server cannot resolve that vendor to exactly one enabled adapter |
| Robot stays `pending_ack` | Bridge returned 202 but did not call the authenticated ACK route before deadline |
| Robot appears offline | Verify bridge status timestamp, account binding, possession token, network, and exact adapter ID |
| Reset does not unbind | Manufacturer reset did not synchronously confirm user-data erasure; the binding is intentionally retained |

## 15. Production readiness checklist

- [ ] Vendor documentation and credentials are received under a reviewed agreement.
- [ ] Exact production SKU/BOM/OS/firmware and support lifecycle are frozen.
- [ ] Real vendor mappings replace only the bridge internals; provisional names are not presented as vendor facts.
- [ ] Every enabled adapter has independent bridge and callback credentials and a rotation drill.
- [ ] Bridge verifies signature, exact payload/envelope agreement, expiry, target, and durable idempotency.
- [ ] Pairing QR is manufacturer-issued, one-time, expiring, and replay-tested across accounts.
- [ ] Same-account pairing response loss/process death recovers the existing binding and possession credential; pairing-secret rotation/recovery is rehearsed.
- [ ] Reset and privacy operations work correctly for each vendor in a mixed fleet.
- [ ] Offline/local emergency behavior and physical interlocks are validated.
- [ ] Medical instrument identity, units, quality, calibration, consent, retention, and regulatory position are approved.
- [ ] p50/p95/p99 acceptance and execution latency are measured on real hardware.
- [ ] Process death, power loss, network split, duplicate, delayed ACK, key rotation, OTA, rollback, and factory reset pass.
- [ ] Minimum 72-hour hardware/bridge soak passes with bounded resource growth.
- [ ] `npm test`, lint, typecheck, build/export, container health, and deployment probes pass on the release SHA.

Until every applicable item is evidenced, keep the vendor adapter disabled in production.
