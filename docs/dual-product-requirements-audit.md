# Dual-Product Requirements Verification Audit

Date: 18 July 2026

Branch: feature/dual-product-core

Audited implementation commit: 360b7b11f250459328427f4a2f603d1a4e4687f3

Previous branch head: 9c5ea003ba431fc25d9148b8fae7901d25dcc16e

Products: VL01 BLE wearable and WiFi home companion robot

## Release recommendation

**NO-GO / not ready for production.**

All gaps that could be closed in source have been implemented and deterministically verified. The post-remediation matrix has no partially implemented or unimplemented rows. Production approval is still blocked by 27 physical-device acceptance items and 24 external-provider, manufacturer, compliance, deployment, or tooling items. A source-level pass is not a substitute for those gates.

Statuses are mutually exclusive and describe the last unmet acceptance gate:

- ✅ Fully Implemented — implementation and deterministic evidence exist.
- ⚠️ Partially Implemented — source remains incomplete.
- ❌ Not Implemented — no implementation exists.
- 🔬 Requires Physical Hardware — source exists, but native or hardware acceptance remains.
- 📋 External Dependency — source exists, but a provider, manufacturer, compliance, deployment, or unavailable build-service gate remains.

## Verification results

| Gate | Result | Evidence |
| --- | --- | --- |
| Deterministic suite | PASS | npm test: 465 tests, 465 passed, 0 failed/skipped/cancelled/todo |
| ESLint | PASS | npm run lint -- --no-fix |
| Server syntax | PASS | Node syntax checks for auth, CLM, action, pairing, manufacturer, and safety modules |
| Patch integrity | PASS | git diff --check |
| Expo Doctor | PASS | 20/20 checks passed |
| iOS production JavaScript export | PASS | Final Expo export completed for the audited tree |
| Android production JavaScript export | PASS | Final Expo export completed for the audited tree |
| Development environment validation | PASS | 16 configured/valid checks, 10 optional warnings, 0 errors |
| Local production environment validation | BLOCKED AS DESIGNED | 12 checks OK, 3 warnings, 11 errors; fail-closed flags, action gateway/signing inputs, and approved VL01 UUIDs are not locally provisioned |
| Container build and health smoke | NOT EXECUTED | Docker, Podman, Colima, and OrbStack CLIs are unavailable in the audit environment |

Production exports prove that Metro/Babel can generate release bundles. They do not prove that a production build is correctly provisioned: the redacted production validator must pass before an EAS production build is authorized.

## Remediation applied during this audit

The implementation commit closes the source-owned gaps found during the 101-item walk:

- Added durable, hashed refresh-token families with compare-and-swap rotation, absolute expiry, replay revocation, deletion fencing, and production repository fail-closed checks.
- Added authenticated encrypted local storage with a SecureStore-backed key, account isolation, deletion-time key rotation, and redacted mobile/server logging.
- Hardened per-device priority command queues, STOP bypass, process-death registry rehydration, BLE reconnect/background configuration, robot offline persistence, and independent dual-device execution.
- Hardened one-time robot pairing with used_at/bound_to persistence, possession credentials, 410 replay rejection, serial redaction, manufacturer reset confirmation, and privacy ordering.
- Added signed action routing, durable robot outbox/ACK recovery, bounded retry, user push failure feedback, and account-indexed outbox queries without production scan fallback.
- Added durable SOS delivery accounting, contact push fan-out, medical-profile consent/review UI, fall/Pat-Pat routing, geofencing, and AI Angel help-dial handling.
- Added durable medication scheduling, authenticated escalation acceptance, idempotent retry, signed reminder correlation, manufacturer telemetry acknowledgements, and protected medication management UI.
- Added explicit Mapbox source refresh, distinct device markers, bounded robot paths, telemetry retention policy, My Devices management, and QR pairing protection.
- Restored equal 410-key parity across all 155 catalogs and added protected, localized medical and medication flows.
- Updated compatible Expo SDK 57 patch versions and release documentation.

## A. User Onboarding and Authentication

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| AUTH-001 | Apple Sign-In integration | Both | 📋 External Dependency | src/context/AuthContext.js signInWithApple; server provider-token verifier; live Apple audience/JWKS and credential-state acceptance remain |
| AUTH-002 | Google Sign-In integration | Both | 📋 External Dependency | src/context/AuthContext.js signInWithGoogle; server provider-token verifier; live Google OAuth clients remain |
| AUTH-003 | Phone verification through Twilio | Both | 📋 External Dependency | server/phone-auth.cjs startPhoneVerification/verifyPhoneVerification; app verify-code flow; live Twilio Verify remains |
| AUTH-004 | Secure JWT access/refresh lifecycle | Both | ✅ Fully Implemented | server/auth-session.cjs; server/auth-session-repository.cjs; src/services/auth-session.js; replay/CAS/revocation tests |
| AUTH-005 | Account-bound isolation and logout cleanup | Both | ✅ Fully Implemented | src/services/account-data-boundary.js; src/services/local-user-data.js; settings sign-out; signed-out tombstone tests |
| AUTH-006 | Session persistence across restarts | Both | ✅ Fully Implemented | src/context/AuthContext.js atomic account-bound SecureStore envelope restoration and serialized refresh |
| AUTH-007 | Resumable onboarding state machine | Both | ✅ Fully Implemented | src/services/onboarding-state.js; protected onboarding routing in app/_layout.js |
| AUTH-008 | QR scanning for robot pairing | Home Robot | 🔬 Requires Physical Hardware | app/robot-pairing.js Expo Camera barcode flow and permission recovery |

## B. Wearable Device Management

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| WEAR-001 | BLE permission request and rationale | Wearable | 🔬 Requires Physical Hardware | src/services/ble.js scanForDevices; src/services/permissions.js; src/services/ble-permissions.js |
| WEAR-002 | BLE scan with service filter | Wearable | 🔬 Requires Physical Hardware | src/services/ble.js startDeviceScan with protocol service UUID and VL01 service validation |
| WEAR-003 | BLE connection and service discovery | Wearable | 🔬 Requires Physical Hardware | BLEService.connect, discoverAllServicesAndCharacteristics, validateVL01GATT |
| WEAR-004 | Battery characteristic read and display | Wearable | 🔬 Requires Physical Hardware | decodeVL01Battery; initial characteristic read/monitor; app/device-management.js |
| WEAR-005 | Status characteristic read and notifications | Wearable | 🔬 Requires Physical Hardware | src/services/ble.js initial status read and monitorCharacteristicForService |
| WEAR-006 | Event characteristic subscription | Wearable | 🔬 Requires Physical Hardware | BLE event monitor routed through WearableDevice.onTelemetry and safety event router |
| WEAR-007 | Command write fragmented above 20 bytes | Wearable | 🔬 Requires Physical Hardware | BLEService.writeCommand slices decoded payloads into 20-byte fragments |
| WEAR-008 | Disconnect detection and bounded reconnect | Wearable | 🔬 Requires Physical Hardware | native disconnect listener and reconnectWithBackoff with four bounded attempts |
| WEAR-009 | Background BLE on iOS | Wearable | 🔬 Requires Physical Hardware | app.config.js BLE central background mode and restoration identifier |
| WEAR-010 | Pairing and metadata persistence | Wearable | ✅ Fully Implemented | src/services/paired-device-store.js; src/services/device-entity-store.js |
| WEAR-011 | Multiple wearable support | Wearable | ✅ Fully Implemented | src/services/device-manager/DeviceRegistry.js map and additive device-management UI |
| WEAR-012 | Critical/Standard/Background command priority | Wearable | ✅ Fully Implemented | per-instance queue in src/services/device-manager/BaseDevice.js and queue-order tests |
| WEAR-013 | STOP safety interlock bypasses queue | Wearable | ✅ Fully Implemented | WearableDevice.sendCommand critical bypass and stalled-write tests |

## C. Home Robot Management

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| ROBOT-001 | QR code scan for robot pairing | Home Robot | 🔬 Requires Physical Hardware | app/robot-pairing.js camera permission, QR parsing, authenticated pairing |
| ROBOT-002 | One-time token with used_at/bound_to | Home Robot | ✅ Fully Implemented | server/robot-pairing.cjs transactional consume/bind, 410 replay response, redacted replay tests |
| ROBOT-003 | Manufacturer REST communication | Home Robot | 📋 External Dependency | HomeRobotDevice.request; server/action-gateway.cjs deliverRobot; live manufacturer endpoint remains |
| ROBOT-004 | Exponential bounded webhook retry | Home Robot | ✅ Fully Implemented | action gateway retry/backoff/outbox tests; mobile retry capped at 60 seconds |
| ROBOT-005 | Asynchronous manufacturer ACK | Home Robot | 📋 External Dependency | durable action outbox, acknowledgeRobot, ACK timeout/recovery, manufacturer ACK route; live callback remains |
| ROBOT-006 | Offline detection and UI state | Home Robot | ✅ Fully Implemented | HomeRobotDevice network listener/stale telemetry handling and app/device-management.js status UI |
| ROBOT-007 | Robot queue independent of wearable | Home Robot | ✅ Fully Implemented | per-device BaseDevice queue plus src/services/device-command-queue.js durable robot queue |
| ROBOT-008 | Manufacturer API key remains server-side | Home Robot | ✅ Fully Implemented | MANUFACTURER_API_KEY used only in server manufacturer/action clients; environment contract tests |
| ROBOT-009 | Robot status and telemetry display | Home Robot | 📋 External Dependency | server/manufacturer-client.cjs status client; bounded telemetry polling; device-management UI; live contract remains |
| ROBOT-010 | Factory reset and re-pair flow | Home Robot | 📋 External Dependency | factoryResetHomeRobot, explicit manufacturer completion, credential removal/unbind; live reset/new-QR contract remains |

## D. AI and Voice Orchestration

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| VOICE-001 | Authenticated Hume EVI gateway | Both | 📋 External Dependency | server/voice-gateway.cjs first-frame JWT auth, expiry/scopes/limits; live Hume service remains |
| VOICE-002 | 48 kHz PCM capture/streaming | Both | 🔬 Requires Physical Hardware | Hume session settings declare linear16, 48 kHz, mono; deterministic PCM tests |
| VOICE-003 | Playback with interruption/barge-in | Both | 🔬 Requires Physical Hardware | src/services/websocket/hume-evi.js cancels playback on user speech/interruption; lifecycle tests |
| VOICE-004 | Hume tool-call parsing | Both | ✅ Fully Implemented | useHumeVoiceCall handleToolCall; typed correlation; parallel abort controllers |
| VOICE-005 | Tool routing by device type | Both | ✅ Fully Implemented | server/device-action-tools.cjs schemas; action validation; active account/device lookup |
| VOICE-006 | Signed ROBOT_ACTION verification | Both | 📋 External Dependency | Ed25519 server signing; wearable pinned-key verification and replay store; manufacturer-side verification remains |
| VOICE-007 | Offline text fallback | Both | ✅ Fully Implemented | src/services/websocket/offline-evi.js; useHumeVoiceCall fallback and queue state |
| VOICE-008 | Conversation history and queue persistence | Both | ✅ Fully Implemented | src/services/conversation-history.js; src/services/offline-message-queue.js; encrypted storage |
| VOICE-009 | Voice support across 155 catalogs | Both | 📋 External Dependency | server/voice-locales.cjs allowlist and locale propagation; Hume linguistic acceptance remains |
| VOICE-010 | Persona selection | Both | 📋 External Dependency | src/constants/voiceProfiles.js; server persona map and allowlisted Hume resource IDs |

## E. Safety and Emergency Features

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| SAFE-001 | Pat Pat to Stay Safe gesture | Wearable | 🔬 Requires Physical Hardware | versioned VL01 event decoder and deduplicated safety event router |
| SAFE-002 | 105 dB alarm activation | Wearable | 🔬 Requires Physical Hardware | emit_alarm signed tool/action path; acoustic output must be measured on production hardware |
| SAFE-003 | Excuse Call simulation | Wearable | ✅ Fully Implemented | protected app/excuse-call.js incoming-call presentation and transition |
| SAFE-004 | AI Angel automatic help-dial | Both | 🔬 Requires Physical Hardware | immediate-danger CLM tool, request_help_dial handling, confirmed triggerSOS/native dialer |
| SAFE-005 | GPS tracking and geofencing | Wearable | 🔬 Requires Physical Hardware | balanced location watcher and src/services/geofence-evaluator.js freshness/hysteresis |
| SAFE-006 | Emergency contact CRUD | Both | ✅ Fully Implemented | app contact flows, SecureStore cache, scoped backend CRUD |
| SAFE-007 | SOS activation with confirmation | Both | 🔬 Requires Physical Hardware | app/emergency-sos.js native confirmation, recent-location checks, dialer fallback, durable dispatch |
| SAFE-008 | SOS acceptance differs from delivery | Both | ✅ Fully Implemented | server/safety-api.cjs accepted/delivery state, delivery claims, retries, idempotency tests |
| SAFE-009 | Emergency call with medical history attachment | Both | 📋 External Dependency | app/medical-profile.js; medical profile SecureStore consent/review gate; SOS attachment validation; literal call-channel attachment remains external |
| SAFE-010 | Push delivery to emergency contacts | Both | 📋 External Dependency | server/push-notifications.cjs recipient resolution/fan-out/delivery accounting; live APNs/FCM remains |
| SAFE-011 | Fall detection from wearable and robot | Both | 🔬 Requires Physical Hardware | wearable/robot fall-event normalization and safety routing; sensing algorithms are hardware/manufacturer inputs |
| SAFE-012 | Medication reminder and escalation | Home Robot | 📋 External Dependency | durable medication scheduler, protected management/ACK UI, escalation API, signed reminder correlation, telemetry ACK bridge |
| SAFE-013 | Robot indoor positioning | Home Robot | 📋 External Dependency | bounded indoor-position normalization and device-management display; manufacturer coordinate-frame contract remains |

## F. Mapping and Location

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| MAP-001 | Mapbox with live location | Wearable | 🔬 Requires Physical Hardware | app/(tabs)/map.js MapView/Camera/LocationPuck and live watcher |
| MAP-002 | Saved Places create/delete | Wearable | ✅ Fully Implemented | src/services/saved-place-store.js and map UI |
| MAP-003 | Quick Share location snapshot | Wearable | 🔬 Requires Physical Hardware | timestamped one-time location share flow and native share sheet |
| MAP-004 | Offline tile caching | Wearable | 🔬 Requires Physical Hardware | transactional Mapbox offline-pack lifecycle and cleanup |
| MAP-005 | Distinct robot marker | Home Robot | ✅ Fully Implemented | combined GeoJSON with wearable human marker and robot home/gear marker |
| MAP-006 | Robot telemetry updates Mapbox source | Home Robot | 📋 External Dependency | entity-dependent FeatureCollection rebuild and ShapeSource setNativeProps; live manufacturer stream remains |
| MAP-007 | Robot navigation path rendering | Home Robot | 📋 External Dependency | bounded path normalization and LineLayer source; manufacturer navigation path remains |

## G. Privacy and Data Management

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| PRIV-001 | Account export from local and Dynamo data | Both | 📋 External Dependency | src/services/privacy-export.js; server/privacy-data.cjs; live Dynamo/manufacturer export remains |
| PRIV-002 | Account deletion from local and Dynamo data | Both | 📋 External Dependency | fenced ordered remote deletion, session revocation, local purge/key rotation; live repositories/vendor erasure remain |
| PRIV-003 | SecureStore for sensitive records | Both | ✅ Fully Implemented | sessions, contacts, medical profile, pairing credentials; encrypted local-store key in SecureStore |
| PRIV-004 | Cross-account data isolation | Both | ✅ Fully Implemented | ensureAccountDataOwner, account-bound records, deletion marker, logout cleanup |
| PRIV-005 | Encryption for AsyncStorage data | Both | ✅ Fully Implemented | src/services/encrypted-storage.js authenticated secretbox envelopes and key rotation |
| PRIV-006 | Redacted PII-safe logging | Both | ✅ Fully Implemented | src/utils/logger.js and server/redacted-logger.cjs with token/serial/PII tests |
| PRIV-007 | iOS privacy manifest and Android Data Safety | Both | 📋 External Dependency | app.config.js privacy manifest and Android backup restrictions; Play Console declaration remains |
| PRIV-008 | Robot telemetry retention policy | Home Robot | 📋 External Dependency | src/services/robot-telemetry-policy.js 24-hour/latest-location-only local policy; manufacturer DPA/retention remains |

## H. Globalization and Localization

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| LANG-001 | Four public languages en/es/fr/zh | Both | ✅ Fully Implemented | reviewed public catalogs and public-catalog tests |
| LANG-002 | 155 structural language catalogs | Both | ✅ Fully Implemented | 155 equal-key catalogs with 410 keys and registry parity tests |
| LANG-003 | System language detection | Both | ✅ Fully Implemented | I18nContext resolveLanguage and Expo useLocales integration |
| LANG-004 | LTR/RTL transition support | Both | 🔬 Requires Physical Hardware | RTL metadata, native direction coordinator, guarded reload, deterministic tests |
| LANG-005 | Native-speaker safety review | Both | 📋 External Dependency | review metadata explicitly leaves machine catalogs in QA state |
| LANG-006 | Critical safety copy in all catalogs | Both | ✅ Fully Implemented | complete releaseCritical schema/provenance across all 155 catalogs |

## I. UI and Accessibility

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| UI-001 | Protected/public route classification | Both | ✅ Fully Implemented | protected route allowlist and Expo Router Stack.Protected in app/_layout.js |
| UI-002 | Safe Back/Home fallback | Both | ✅ Fully Implemented | shared Header and modal canGoBack/tab replacement behavior |
| UI-003 | Localized error handling | Both | ✅ Fully Implemented | localized error boundary, stable error-code mapping, FeedbackBanner |
| UI-004 | Loading/disabled/empty/success/failure states | Both | ✅ Fully Implemented | shared state components and critical-screen state coverage |
| UI-005 | VoiceOver labels and roles | Both | ✅ Fully Implemented | critical control semantics and static accessibility tests |
| UI-006 | Dynamic Type support | Both | ✅ Fully Implemented | font scaling remains enabled; shared controls/layouts avoid fixed text clipping |
| UI-007 | Keyboard and safe-area awareness | Both | ✅ Fully Implemented | SafeAreaView, KeyboardAvoidingView, automatic keyboard insets |
| UI-008 | Light-only interface | Both | ✅ Fully Implemented | app config and root navigation force documented light theme |
| UI-009 | My Devices dual-product screen | Both | ✅ Fully Implemented | settings entry and app/device-management.js |
| UI-010 | Device naming and status | Both | ✅ Fully Implemented | rename persistence and online/offline/telemetry presentation for both types |

## J. Performance and Lifecycle

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| PERF-001 | Process-death registry recovery | Both | ✅ Fully Implemented | DeviceRegistry.rehydrateRegistry called before protected navigation render |
| PERF-002 | Timer/subscription cleanup | Both | ✅ Fully Implemented | device dispose, robot polling/network cleanup, voice/audio/effect lifecycle tests |
| PERF-003 | Background audio and BLE | Wearable | 🔬 Requires Physical Hardware | native modes and lifecycle source exist; release background/lock soak remains |
| PERF-004 | Command latency below 250 ms p95 | Both | 🔬 Requires Physical Hardware | independent queues prevent cross-device blocking; instrumented SLA measurement remains |
| PERF-005 | Battery optimization | Both | 🔬 Requires Physical Hardware | balanced GPS, bounded polling/retry, no background location; energy profiling remains |
| PERF-006 | Cold start below 3 seconds | Both | 🔬 Requires Physical Hardware | bounded splash/hydration gate; release-device p95 measurement remains |

## K. Deployment and Build

| ID | Description | Product | Status | Evidence reference |
| --- | --- | --- | --- | --- |
| BUILD-001 | EAS development profile | Both | ✅ Fully Implemented | eas.json development and simulator profiles |
| BUILD-002 | EAS preview profile | Both | ✅ Fully Implemented | eas.json internal preview profile |
| BUILD-003 | EAS TestFlight profile | Both | ✅ Fully Implemented | eas.json store-distributed TestFlight profile |
| BUILD-004 | EAS production profile | Both | ✅ Fully Implemented | eas.json production profile and fail-closed app config |
| BUILD-005 | iOS production JavaScript export | Both | ✅ Fully Implemented | final audited-tree Expo iOS export passed |
| BUILD-006 | Android production JavaScript export | Both | ✅ Fully Implemented | final audited-tree Expo Android export passed |
| BUILD-007 | Expo Doctor 20/20 | Both | ✅ Fully Implemented | final npx expo-doctor: 20/20 |
| BUILD-008 | Environment variable validation | Both | ✅ Fully Implemented | scripts/validate-env.cjs and production-aware diagnostics; secrets are not printed |
| BUILD-009 | Container build and health check | Both | 📋 External Dependency | server/Dockerfile, non-root runtime, /health and Railway health configuration exist; no container CLI was available to execute the candidate |
| BUILD-010 | Backend deployment to Vercel and Railway/ECS | Both | 📋 External Dependency | Vercel HTTP adapter and Railway/ECS-compatible long-lived gateway exist; actual production deployment/operations remain |

## Summary

| Category | Total Requirements | Fully Implemented | Partially Implemented | Not Implemented | Requires Physical Hardware | External Dependency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Auth | 8 | 4 | 0 | 0 | 1 | 3 |
| Wearable | 13 | 4 | 0 | 0 | 9 | 0 |
| Robot | 10 | 5 | 0 | 0 | 1 | 4 |
| Voice | 10 | 4 | 0 | 0 | 2 | 4 |
| Safety | 13 | 3 | 0 | 0 | 6 | 4 |
| Map | 7 | 2 | 0 | 0 | 3 | 2 |
| Privacy | 8 | 4 | 0 | 0 | 0 | 4 |
| Lang | 6 | 4 | 0 | 0 | 1 | 1 |
| UI | 10 | 10 | 0 | 0 | 0 | 0 |
| Perf | 6 | 2 | 0 | 0 | 4 | 0 |
| Build | 10 | 8 | 0 | 0 | 0 | 2 |
| **TOTAL** | **101** | **50** | **0** | **0** | **27** | **24** |

## Required physical acceptance

The following 27 rows cannot be promoted to fully implemented without the named evidence.

| Requirements | Required test | Acceptance criteria |
| --- | --- | --- |
| AUTH-008, ROBOT-001 | Signed iOS and Android QR pairing | Permission allow/deny/revoke/Settings recovery works; genuine manufacturer QR binds User A; replay as User B returns 410; no serial/token appears in logs |
| WEAR-001 through WEAR-003 | Real VL01 permission, scan, connection, discovery | Rationale precedes native prompt; deny/recover works; only approved service is shown; production firmware exposes the exact approved GATT contract |
| WEAR-004 through WEAR-007 | Real VL01 characteristic and command matrix | Battery agrees with a reference reading; status/events update once; payloads above 20 bytes arrive in ordered 20-byte fragments; malformed data fails closed |
| WEAR-008, WEAR-009 | BLE disconnect/background/process-death soak | Four attempts are bounded; no reconnect storm; lock/background/foreground and OS restoration recover paired state without duplicate subscriptions |
| VOICE-002, VOICE-003 | Physical audio route matrix | Captured stream is 48 kHz mono linear PCM; speaker, wired, and Bluetooth routes work; barge-in stops playback promptly; interruptions recover without leaked audio |
| SAFE-001, SAFE-011 | Gesture/fall hardware validation | Firmware Pat-Pat event meets the agreed false-positive/false-negative thresholds; wearable IMU and robot-camera fall events are authenticated, deduplicated, and reach the correct account |
| SAFE-002 | Certified alarm measurement | Production wearable reaches at least 105 dB at the manufacturer-specified distance and duration without unsafe thermal/battery behavior |
| SAFE-004, SAFE-007 | Native dial/SOS acceptance | Confirmation/cancel paths are honest; dialer opens only after consent; denial/unavailable paths show localized failure; accepted never claims delivered without receipt |
| SAFE-005, MAP-001 | GPS/geofence field matrix | Live/stale/unavailable states are honest; geofence hysteresis prevents flapping; accuracy/freshness meet the release policy indoors and outdoors |
| MAP-003 | Native share targets | Snapshot includes timestamp/freshness, no unintended history, cancel is not reported as success, and supported share targets receive the intended payload |
| MAP-004 | Airplane-mode offline map | Approved region downloads transactionally, renders offline, respects limits, and is removed on account cleanup/deletion |
| LANG-004 | Signed LTR/RTL transition | English-to-Arabic/Hebrew and back reload exactly once, restore the safe route, preserve critical layouts, and pass VoiceOver/TalkBack |
| PERF-003 | Background audio/BLE soak | Approved background behaviors survive lock/interruption for the policy duration with no runaway reconnect, timer, or audio session |
| PERF-004 | Instrumented dual-command load | Wearable and robot command admission-to-dispatch p95 is below 250 ms under simultaneous load; a stalled BLE write does not delay robot dispatch |
| PERF-005 | Energy profiling | Minimum-supported devices remain within the product battery budget for idle, BLE, map, voice, retry, and mixed scenarios |
| PERF-006 | Release cold-start measurement | At least 20 clean production launches per minimum-supported platform/device produce a p95 interactive time below 3 seconds |

## External acceptance and deployment blockers

The following 24 rows require evidence outside this repository.

| Requirements | External owner/evidence needed |
| --- | --- |
| AUTH-001, AUTH-002 | Production Apple/Google clients, audiences, redirect/nonce configuration, provider credential-state behavior, and real-account success/cancel/revocation evidence |
| AUTH-003 | Restricted Twilio Verify service, regional delivery/expiry/resend/abuse-control evidence, and operational monitoring |
| ROBOT-003, ROBOT-005, ROBOT-009, ROBOT-010 | Manufacturer production REST endpoint, API-key rotation, robot-side Ed25519 verification, async ACK callback, authenticated telemetry, reset completion, new pairing QR, rate/SLA/rollback contract |
| VOICE-001, VOICE-006, VOICE-009, VOICE-010 | Production Hume endpoint/resources, authenticated gateway deployment, robot signature verification, locale/persona resource acceptance, quotas and outage behavior |
| SAFE-009 | Emergency-provider channel that can carry a consented medical profile if literal call attachment is required; otherwise product/legal must narrow the claim |
| SAFE-010 | APNs/FCM/Expo credentials, account-bound recipient tokens, invalid-token cleanup, delivery receipts, retry/outage evidence |
| SAFE-012 | Manufacturer reminder delivery and signed reminder_id echo contract, live caregiver push identity/delivery, escalation operations |
| SAFE-013 | Manufacturer indoor coordinate-frame/schema, freshness/accuracy SLA, privacy/retention agreement |
| MAP-006, MAP-007 | Live manufacturer telemetry/navigation stream with bounded authenticated payloads, coordinate agreement, path freshness and disconnect behavior |
| PRIV-001, PRIV-002 | Production Dynamo repositories and manufacturer export/erasure endpoints, deletion SLAs, audit records, backup/log expiration and legal verification |
| PRIV-007 | App Store privacy answers and Google Play Data Safety declaration reconciled against the final binary and deployed vendors |
| PRIV-008 | Manufacturer telemetry retention/deletion DPA and production enforcement evidence |
| LANG-005 | Native-speaker and safety/legal review for every catalog intended for public exposure |
| BUILD-009 | A container-capable CI/host must build the exact audited commit, run it as non-root, hit /health, exercise shutdown, and retain image digest/SBOM/vulnerability evidence |
| BUILD-010 | Authorized Vercel and Railway/ECS deployments with secrets, TLS/ingress, Dynamo indexes/TTL/IAM/PITR, health/readiness, logs/alerts, rollback rehearsal and immutable source-to-deployment identifiers |

## Production configuration blockers observed

The local production validator failed closed on 11 required items:

- Four production feature gates are not enabled: phone auth, custom Hume CLM, durable safety backend, and approved VL01 protocol.
- The action gateway URL is absent.
- The wearable action-signing public key is absent.
- The approved VL01 service, battery, status, event, and command UUIDs are absent.

No secret values are included in this report. These inputs must be provisioned in the authorized EAS/backend environments and the validator must report zero errors before a production candidate is built.

## Final decision

The branch is **source-complete for the audited specification**, with 50 rows fully closed in deterministic/source evidence and no remaining source-owned partial or missing implementation. It is **not ready for production** until every applicable physical and external row above is accepted against the exact reviewed commit and deployment. The highest-priority blockers are real VL01 validation, manufacturer end-to-end contracts, production identity/Hume/push resources, production environment provisioning, signed-device safety/audio/performance tests, privacy/compliance approvals, and deployed backend/container evidence.
