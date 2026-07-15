# VeryLoving Comprehensive Final Audit

Audit date: 14 July 2026
Decision: **NO-GO for store release until the P1 gates in `LAUNCH_CHECKLIST.md` have objective closure evidence**

## 15 July 2026 UI Framework Hardening Addendum

The repository has completed a separate whole-app UI foundation pass documented in [UI_FRAMEWORK_AUDIT.md](./UI_FRAMEWORK_AUDIT.md). The deterministic suite is now 313/313 with ESLint clean, Expo Doctor 20/20, and passing iOS/Android exports. The pass adds bounded process restoration for auth, phone verification and onboarding; protected/allowlisted account-bound navigation plus direct system-link sanitization; fail-closed cross-account cleanup; functional daily reminders and Saved Places; emergency-contact editing with conflict recovery; partial privacy export plus remote-first deletion; stale/idempotent SOS hardening; WebSocket send-race recovery; release/TestFlight locale gating and bounded RTL/reminder transition ordering; critical runtime localization; accessibility semantics; and narrower native permissions. The dedicated TestFlight profile is now the primary iOS QA artifact and adds Arabic/Hebrew only for signed RTL review.

This addendum does not change the launch decision. No signed TestFlight device session was produced by source validation, and the remaining P1 delivery, encryption, session revocation/tombstone, BLE firmware, audio-route/background, native-speaker, production-service, Android, and operational gates still require objective evidence. The validation counts below are the recorded 14 July snapshot and are intentionally retained as dated evidence rather than rewritten.

## Executive Summary

The final audit found and addressed material architectural gaps rather than treating successful static checks as proof of production behavior. The repository now contains an implemented/requested 48 kHz mono Int16 microphone-frame path, server-verified Apple/Google exchange, Twilio Verify phone authentication, short-lived VeryLoving access/refresh JWTs stored as one account-bound atomic envelope, first-frame authenticated WebSocket gateway, protocol-gated VL01 GATT battery lifecycle, DynamoDB-backed contacts/safety-session/SOS-acceptance APIs, and an HTTP-only Vercel adapter. The earlier runtime reports are preserved as historical evidence; none of these post-validation additions is retroactively claimed as signed-device or production-service validation.

The codebase is substantially stronger and suitable for production-candidate integration testing, but it does not yet have a clean bill of health for launch. Remaining stop-ship work includes production credentials and deployment, persistent refresh-family revocation/reuse detection and privacy tombstones, encrypted account-bound local PII, actual SOS/guardian delivery and receipts, completed VL01 ownership/command protocol, signed-device audio/BLE tests, production SMS/APNs/FCM, Android runtime QA, and store/privacy/localization approval.

## Audit Scope And Evidence Boundaries

Reviewed areas:

- Expo Router screens, route protection, auth/onboarding state, error boundaries, async handling, RTL and translation structure;
- Hume protocol, first-frame gateway authentication, PCM capture/playback lifecycle, reconnect, tools, history, and offline queue;
- BLE scanning, permission/state errors, GATT discovery, battery handling, disconnect/reconnect, persistence, and device removal;
- emergency contacts, safety modes, SOS semantics, phone fallback, location caching, Mapbox offline behavior, and privacy cleanup;
- Node HTTP/WebSocket server, provider JWT verification, session tokens, CLM/tool endpoints, DynamoDB repository, validation, logging, and deployability;
- Expo/EAS configuration, config plugins, native permissions, environment injection, dependency templates, tests, exports, and handoff documents.

The earlier simulator run did not have production Apple, Google, Hume, Mapbox, SMS, push, AWS, or VL01 resources and had no Android emulator or signed physical device. Automated tests verify deterministic contracts and failure handling; they do not prove native microphone routing, Hume interoperability, BLE firmware semantics, emergency delivery, provider account setup, or background behavior.

## Final Validation Gates

| Gate | Result |
| --- | --- |
| `npm run lint` | **PASS** — ESLint clean |
| `npm test` | **PASS** — 215/215 passed; 0 failed, cancelled, or skipped |
| `git diff --check` | **PASS** |
| `npx expo-doctor` | **PASS** — 20/20 |
| iOS production export | **PASS** — 2,557 modules; 8.7 MB Hermes bundle |
| Android production export | **PASS** — 2,640 modules; 8.9 MB Hermes bundle |
| `npm run validate` | **PASS** — exit 0; temporary export directories removed |
| iOS animation regression | **PASS** — clean Debug build installed on the iOS 26.5 simulator; cold launch, onboarding/account transitions, and an active `VoiceActivityIndicator` probe produced no `onAnimatedValueUpdate` warning |
| iOS entitlement-warning regression | **PASS** — buffer-clean cold launch emitted one intentional notification-skip line and one memory-storage line; timestamped native logs contained none of the Dev Launcher `sharedPackageConnection`, notification-registration Keychain, or Auth SecureStore signatures |
| Static secret/debug scan | **PASS** — no embedded credential pattern; no `debugger`, `TODO`, `FIXME`, or `HACK`; direct console use limited to CLI/server/config diagnostics and logger transport |
| Transport/config scan | **PASS** — production HTTPS/WSS and no credential-query constraints confirmed |
| Server dependency audit | **PASS** — `npm audit --prefix server --omit=dev` reported 0 vulnerabilities |
| Root production dependency audit | **PASS** — `npm audit --omit=dev` reported 0 vulnerabilities after the narrow `xcode.uuid=11.1.1` override; `npm ls` and a direct CommonJS `uuid.v4()` compatibility check passed |

These are source/deterministic gates for the final audited working tree. Archive the validator output, release SHA, lockfiles, EAS build URLs, backend image digest, dependency-risk record, and signed-device evidence in the release ticket.

## Implemented Architectural Corrections

### Voice PCM And Audio Lifecycle

- `AudioStreamBridge` mounts `expo-audio` capture at the app root and requests 48 kHz, mono, Int16 buffers.
- The audio service requires permission, validates native sample rate/channels, converts headerless PCM bytes to base64, restores full-duplex audio mode after stream start, and releases the stream/audio mode on failure or stop.
- Hume sends bounded chunked input with backpressure protection; received audio remains serialized with cancellation, timeout, and temporary-file cleanup.
- Tests cover PCM encoding, format rejection, stream lifecycle, and Hume microphone wiring.

This is an implemented code path, not physical evidence. Native AEC/noise suppression/automatic gain control, frame cadence, interruptions, Bluetooth routes, background recording, lock screen, and repeated-call cleanup remain P1 device gates.

### Provider Exchange, Sessions, And WebSocket Authentication

- Apple/Google identity assertions are exchanged at `POST /v1/auth/exchange`; the mobile app no longer uses a provider assertion as its application session.
- Server verification covers RS256 signature through official JWKS, issuer, accepted audience, expiry, future issue time, Google authorized party, and Apple nonce when supplied.
- The server issues scoped access and distinct refresh JWTs with bounded lifetimes. The app validates account/session/profile binding, stores the token pair and profile as one versioned SecureStore envelope, renews before expiry/on cold start/foreground, rotates the client-held refresh token, preserves offline account state only for transient network errors, and uses a non-sensitive signed-out tombstone so residual Keychain cleanup cannot restore a logged-out account.
- Proxy URLs contain no bearer token. `/api/voice/hume-ws` requires an authenticate-first message, checks `voice:connect`, applies server Hume config/voice policy, and only then opens Hume with the server-only API key.

Production still requires approved signing-key rotation, persistent refresh-family state, old-token reuse detection, revocation/deletion tombstones, replay and abuse controls, provider credential-state checks, consistent authenticated-request 401 retry, and endpoint/connection rate limits. Current refresh JWTs are stateless and replayable until expiry, and an access JWT must not be described as a single-use WebSocket ticket. Client chat resume and session configuration need authenticated ownership binding before resume is enabled.

### BLE GATT And Lifecycle

- Production BLE fails closed without an explicitly enabled, syntactically valid VL01 service and battery characteristic.
- Real scanning filters the approved service; connection discovers/validates GATT; battery reads are decoded without a fabricated value; supported battery notifications update state; configured raw status/events are surfaced; bounded raw command writes are available; and degradation/disconnect subscriptions clean up the session.
- Reconnect uses bounded exponential backoff and lifecycle generation/serialization; discovery, read, and write operations are bounded so a device cannot hang pairing indefinitely.
- UUID normalization accepts vendor and Bluetooth 16/32/128-bit forms, and base64 decoding is safe on Hermes/native runtimes.

The firmware owner must still approve the UUIDs, battery encoding, status/event decoding, command schemas/authorization, secure pairing, and ownership challenge. Physical foreground/background, reset, low-battery, concurrent connection, two-account, upgrade, and wearable-loss tests remain P1.

### Safety Backend And Honest SOS Semantics

- Authenticated endpoints support account-partitioned emergency-contact listing/creation/deletion, idempotent current safety-mode state, durable idempotent SOS acceptance, account-scoped DynamoDB export, and batch deletion.
- Contact migration/hydration is serialized and cache-first so an empty or delayed server result does not silently erase valid local fallback data; account ownership is enforced in repository keys.
- SOS retries reuse durable idempotency state, phone fallback is coordinated, and local pending deletions are handled without falsely claiming remote completion.
- Fresh location, contact, E.164, mode, timestamp, and idempotency inputs are validated and bounded before persistence.

An SOS `202 accepted` response means the record was persisted. It does not prove a guardian, contact, emergency service, push provider, or phone call received anything. A production outbox/delivery worker, provider receipts, escalation policy, observability, deletion tombstone/session revocation, vendor privacy orchestration, retention controls, and rehearsed failure semantics remain P1.

## Remaining Findings

| Priority | Finding | Required closure |
| --- | --- | --- |
| P1 | Emergency-contact cache PII is now account-bound in SecureStore, but settings, locations, transcripts, queues, resilience records, and account-bound wearable metadata remain plaintext in AsyncStorage. | OS-protected per-account encryption, versioned migration, mismatch purge/fail-closed behavior, account-switch/process-death tests, and Security approval. |
| P1 | Access/refresh renewal and client rotation are implemented, but refresh JWTs are stateless: an old token remains valid until expiry. Revocation, privacy/account-deletion tombstones, compromised-session response, and uniform request-level 401 retry are incomplete. | Identity threat model, signing-key rotation, persistent refresh families/reuse detection, revocation tests, deletion semantics, audit events, and incident runbook. |
| P1 | The Hume gateway uses the short-lived application JWT in its first frame and lacks production ingress/rate-limit/load evidence; chat ownership is not yet proven for resume/configuration. | TLS deployment, replay/revocation or narrower ticket, ownership binding, rate limits, quotas, backpressure/load tests, and redacted observability. |
| P1 | PCM is code-complete only at the deterministic layer; native AEC/NS/AGC and background/route behavior are unverified. | Signed iOS/Android recordings and logs across interruptions, Bluetooth, speaker/earpiece, background, lock screen, network loss, and repeated calls. |
| P1 | VL01 exposes protocol-gated raw status/events and bounded writes, but their semantics/authorization, ownership challenge, and secure pairing are not implemented from an approved firmware contract. | Signed protocol, decoding/command policy, security review, two-account isolation, and complete physical-device matrix. |
| P1 | Durable SOS acceptance is not emergency delivery. Push/contact delivery, receipts, escalation, idempotent outbox processing, and operational response are absent. | Delivery service, provider receipts, retry/dead-letter semantics, dashboards/alerts, safety copy approval, and outage exercises. |
| P1 | Backend-enabled export/deletion covers account DynamoDB records, but deletion does not first revoke the session or create a tombstone and does not orchestrate Hume, identity-provider, Mapbox, backup/log, or share-destination data. | Session revocation, tombstone/repopulation protection, retention/backup proof, vendor orchestration, and privacy audit. |
| P1 | Deployment credentials/policy for the implemented Twilio Verify phone flow, APNs/FCM, real provider credentials, Mapbox routes/live sharing, and remote danger/avoidance intelligence remain external. | Deployed services, distributed abuse controls, signed-device tests, monitoring, rollback, and named owners. |
| P1 | Android runtime, signed physical-device, accessibility/responsive, and native-speaker safety-copy matrices are incomplete. | Objective evidence for every matrix in `LAUNCH_CHECKLIST.md`. |
| Resolved 15 July | Camera/photo permissions were declared although the client had no active picker/capture flow. | Removed the unused Expo Image Picker dependency/plugin and iOS/Android camera/photo declarations; config regression tests prevent reintroduction. |
| P2 | EAS Update is not configured and the backend repository has no infrastructure-as-code or deployment pipeline. | Deliberate OTA/runtime-version/rollback policy and reproducible backend infrastructure if required by release operations. |

## Configuration And Deployment Assessment

- `eas.json` contains explicit development, iOS simulator, preview, TestFlight, and production profiles. TestFlight extends the store profile, enables only the Arabic/Hebrew RTL QA gate, and uses remote auto-incremented versions.
- The root package override lifts only `xcode`'s vulnerable legacy UUID dependency to `uuid@11.1.1`; the resolved tree, CommonJS `v4` call used by `xcode`, and both root/server production audits were verified after the lockfile change.
- `app.config.js` redacts diagnostics and enforces HTTPS/WSS schemes, no credential queries, public-not-secret Mapbox runtime token, both Google client IDs, API/voice endpoints, production safety enablement, custom CLM enablement/configuration, and a complete VL01 service/battery/status/event/command registry. Production config resolution fails closed when these are absent or malformed; external approval and runtime evidence are still required.
- Server production startup fails closed unless provider and phone auth plus safety are enabled, provider allowlists, Twilio Verify settings, independent phone/session secrets, Hume API/config/CLM credentials and a voice allowlist are present, the safety table exists in configuration, and client resume remains disabled.
- `server/api/index.js` is the Vercel HTTP-only adapter for health, auth/phone, safety/privacy, and CLM routes. `server/server.cjs` is a standalone HTTP-only listener, while `server/clm-server.cjs` is the long-lived container HTTP/WebSocket entrypoint. Vercel deliberately excludes the raw WebSocket upgrade gateway, which remains separately deployed and validated as a `wss://` service.
- Mobile public variables, server secrets/configuration, operator-only Hume variables, and build-only Mapbox credentials are separated in the templates and documented in `README.md` and `LAUNCH_CHECKLIST.md`.
- The Node container now has runtime dependencies and handles HTTP plus WebSocket upgrades. A clean setup must run `npm ci --prefix server` or build `server/Dockerfile`.
- DynamoDB needs a table with string `PK`/`SK`, encryption, backups, alarms, retention/deletion controls, and a task role limited to Query/Get/Put/Delete on that table.
- `/health` is liveness only. Release readiness requires authenticated auth/safety/CLM probes, a WSS first-frame/Hume test, DynamoDB evidence, and operational dashboards.

## Documentation Consistency

The 13 July simulator reports remain historical. `README.md`, `HUME_CUSTOMIZATION.md`, `LAUNCH_CHECKLIST.md`, and `PRIVACY.md` describe the current architecture and explicitly distinguish implementation from deployment/device evidence. `STABILITY_REPORT.md` and `FINAL_VALIDATION_REPORT.md` contain dated post-validation sections rather than rewriting earlier observations. The 14 July release validator is deterministic source/export evidence; the separate iOS 26.5 animation regression run is narrow simulator evidence and does not replace an authenticated Safety Call or physical-device session.

## Job-Requirement Alignment

- **Native iOS / real-time audio:** CNG entitlements and privacy manifests, CocoaPods/native builds, SecureStore, permission lifecycle, `expo-audio` PCM capture/playback, interruption/error cleanup, and explicit signed-device boundaries.
- **Full stack:** provider-token verification, session JWTs, HTTP/WebSocket gateway, OpenAI-compatible CLM, Hume control plane/tools, DynamoDB persistence, container deployment, health/security contracts, and AWS/Railway runbooks.
- **Security and architecture:** fail-closed provider/route/config handling, no app bearer in WS URLs, scoped session tokens, input limits, account-partitioned safety records, secret separation, log redaction, honest SOS semantics, and explicit remaining privacy/session risks.
- **BLE:** protocol-gated GATT discovery, characteristic validation, battery read/monitoring, disconnect cleanup, reconnect backoff, persistence isolation, and refusal to invent unapproved firmware behavior.
- **Voice AI:** authenticated Hume gateway, PCM streaming, CLM configuration, tool correlation, bounded reconnect/backpressure, offline fallback, FIFO retry, history, and user-safe errors.

## Handoff Decision

This is a strong production-candidate codebase, not a releasable safety product yet. Grace should keep the decision at **NO-GO** until every P1 gate has a named owner, due date, release-SHA-specific evidence, and approval. A green test suite, Expo Doctor, JavaScript export, EAS build, `/health`, Dynamo write, or simulator screenshot is necessary evidence for its layer but cannot waive external delivery, privacy, hardware, or signed-device gates.
