# Founding Engineer Capability Audit

- Audit date: 15 July 2026
- Repository baseline: `556928a` (`main`)
- Scope: tracked application and server source, generated local iOS output, deterministic tests, and the deployment evidence already recorded in this repository

## Executive conclusion

VeryLoving is strong evidence of hands-on React Native product engineering, real-time Hume voice architecture, Node backend work, OAuth/JWT security design, hybrid local/cloud safety data, and BLE integration. The code is materially more than a UI prototype.

It is **not**, by itself, evidence that every literal must-have in the job description has been met. In particular:

- there is no tracked application-authored SwiftUI or SwiftData implementation;
- there is no Next.js application or TypeScript source;
- AWS DynamoDB integration exists, but AWS infrastructure and SES do not;
- Hume WebSocket audio is substantially implemented and tested, but signed-device audio behavior and production service behavior are not yet proven;
- BLE logic is substantial, but the approved firmware contract, secure ownership/pairing, and physical wearable evidence are external;
- no 3D/Spline implementation and no WebRTC transport are present.

Therefore, the repository demonstrates **strong adjacent fit with several exact-stack gaps**. If the hiring rubric treats SwiftUI/SwiftData and Next.js/TypeScript as literal gates, this repository alone does not clear those gates. Those skills need either a meaningful implementation or separate, verifiable work evidence; a token scaffold would not be credible.

## How to read the status

| Status | Meaning |
| --- | --- |
| **Demonstrated** | Tracked implementation and relevant deterministic tests exist. |
| **Implemented; external validation open** | The architecture exists, but production services, signed hardware, or load evidence are still required. |
| **Partial / adjacent** | Related engineering is demonstrated, but the named technology or full production contract is not. |
| **Not evidenced** | No substantive repository implementation was found. |

This is a repository-evidence audit, not an assessment of experience that may exist in another private repository or a candidate's employment history. Generated dependencies, CocoaPods source, and ignored build output are not counted as application-authored evidence.

## Requirement summary

| Job requirement | Status | Repository evidence | Honest qualification |
| --- | --- | --- | --- |
| Swift 5.9+ | **Not evidenced** | Local generated `ios/VeryLoving/AppDelegate.swift` | `ios/` is ignored and contains the standard Expo/RN bootstrap, not tracked product logic. |
| SwiftUI | **Not evidenced** | None | The UI is React Native/Expo Router. |
| SwiftData | **Not evidenced** | None | Persistence uses SecureStore, AsyncStorage, and a backend DynamoDB repository. |
| WebSockets / Hume | **Demonstrated** | [`hume-evi.js`](./src/services/websocket/hume-evi.js#L121-L267), [`voice-gateway.cjs`](./server/voice-gateway.cjs#L108-L220) | Strong protocol/lifecycle evidence; production and signed-device validation remain open. |
| Real-time audio | **Implemented; external validation open** | [`AudioStreamBridge.js`](./src/components/AudioStreamBridge.js#L5-L17), [`audio.js`](./src/services/audio.js#L38-L244) | PCM capture/playback exists; real routes, interruptions, AEC, latency, and repeated-call behavior need device evidence. |
| React 19 | **Demonstrated** | [`package.json`](./package.json#L22-L60) | React `19.2.3` drives the Expo/React Native app. |
| Next.js 14+ App Router | **Not evidenced** | None | The backend is a Node HTTP service and Vercel Function adapter, not Next.js. |
| TypeScript | **Not evidenced** | None | No tracked `.ts`/`.tsx`, `tsconfig.json`, or TypeScript dependency exists. |
| Vercel | **Partial / adjacent** | [`server/api/index.js`](./server/api/index.js#L1-L53), [`server/vercel.json`](./server/vercel.json#L1-L14) | A tested HTTP Function adapter exists; it is not a Next.js app and intentionally excludes raw WebSocket upgrades. |
| AWS DynamoDB | **Implemented; external validation open** | [`server/safety-api.cjs`](./server/safety-api.cjs#L44-L217) | Repository and contracts exist; infrastructure/IAM/TTL/PITR/production evidence do not. |
| AWS SES | **Not evidenced** | None | Twilio Verify SMS exists; email delivery does not. |
| REST / OAuth / JWT | **Demonstrated, with a critical lifecycle gap** | [`AuthContext.js`](./src/context/AuthContext.js#L595-L742), [`auth-session.cjs`](./server/auth-session.cjs#L21-L244) | Provider verification and scoped first-party tokens exist; durable refresh-family revocation/reuse detection does not. |
| Hybrid local/cloud data | **Partial / adjacent** | [`account-data-boundary.js`](./src/services/account-data-boundary.js#L52-L151), [`AppContext.js`](./src/context/AppContext.js#L125-L193), [`safety-api.cjs`](./server/safety-api.cjs#L230-L363) | Contacts/safety data reconcile with cloud; several stores remain local-only and some remain plaintext. |
| Sensitive PII protection | **Partial / adjacent** | [`secure-storage.js`](./src/services/secure-storage.js#L47-L162), [`emergency-contact-store.js`](./src/services/emergency-contact-store.js#L11-L48), [`saved-place-store.js`](./src/services/saved-place-store.js#L36-L107) | Sessions, contacts, and places use SecureStore on signed devices; history/queues/settings/device metadata use AsyncStorage. |
| BLE wearable integration | **Implemented; external validation open** | [`ble.js`](./src/services/ble.js#L128-L586), [`vl01-protocol.js`](./src/services/vl01-protocol.js#L26-L97) | Scanning/GATT/reconnect logic is substantial; firmware schemas, secure pairing, and hardware evidence are missing. |
| 3D / Spline | **Not evidenced** | None | Reanimated is used for 2D motion, not 3D. |
| Voice AI / generated speech | **Demonstrated** | [`hume-evi.js`](./src/services/websocket/hume-evi.js#L332-L416), [`useHumeVoiceCall.js`](./src/hooks/useHumeVoiceCall.js#L242-L396) | Hume EVI supplies conversational audio and tools; there is no standalone local TTS engine. |
| WebRTC | **Not evidenced** | None | The implemented transport is WebSocket. |

## 1. Native iOS mastery

### Swift, SwiftUI, and SwiftData

The tracked repository contains no `.swift` files. The local `ios/` directory is excluded by [`.gitignore`](./.gitignore#L1-L7), and `git ls-files ios` returns no files. The generated `ios/VeryLoving/AppDelegate.swift` subclasses `ExpoAppDelegate`, starts the React Native factory, and forwards linking. This shows the native boundary produced by Expo prebuild, but it is not evidence of application-authored Swift 5.9+, SwiftUI, or SwiftData work.

The tracked native source of truth is Expo configuration. It declares iOS identity, tablet support, Apple Sign-In and permission/privacy metadata in [`app.config.js`](./app.config.js#L236-L400), and configures background audio plus the BLE central role in [`app.config.js`](./app.config.js#L430-L482). These are useful mobile-platform decisions, but they do not satisfy the named SwiftUI/SwiftData requirement.

**Assessment:** native iOS product integration is demonstrated through Expo, CocoaPods, entitlements, permissions, audio, BLE and TestFlight-oriented configuration. Native SwiftUI/SwiftData mastery is not demonstrated by this repository.

### WebSocket voice transport

The client Hume service provides a genuine lifecycle rather than a thin socket call:

- proxy-first authentication and production rejection of a public direct Hume key: [`hume-evi.js`](./src/services/websocket/hume-evi.js#L121-L219);
- a 48 kHz mono Linear16 session contract: [`hume-protocol.js`](./src/services/websocket/hume-protocol.js#L59-L68);
- readiness gating on `chat_metadata`, safe user/assistant/audio handling, barge-in cancellation, and correlated tool responses: [`hume-evi.js`](./src/services/websocket/hume-evi.js#L269-L416);
- bounded reconnect classification and exponential delay: [`hume-protocol.js`](./src/services/websocket/hume-protocol.js#L92-L137) and [`hume-evi.js`](./src/services/websocket/hume-evi.js#L460-L519);
- generation-safe microphone start/stop, a 256 KiB send backpressure threshold, and transport-first cleanup: [`hume-evi.js`](./src/services/websocket/hume-evi.js#L521-L678).

The container gateway keeps Hume credentials server-side, authenticates the first frame with a scoped app JWT, strips production client prompt/tool overrides, enforces payload/backpressure bounds, and expires the voice session with the JWT: [`voice-gateway.cjs`](./server/voice-gateway.cjs#L17-L96) and [`voice-gateway.cjs`](./server/voice-gateway.cjs#L108-L220).

### Real-time audio pipeline

[`AudioStreamBridge.js`](./src/components/AudioStreamBridge.js#L5-L17) requests 48 kHz, mono, Int16 buffers from `expo-audio`; it is mounted once at the application root in [`app/_layout.js`](./app/_layout.js#L82-L105). [`audio.js`](./src/services/audio.js#L38-L66) verifies the native stream format and encodes headerless PCM16 without modifying the bytes. [`pcm.js`](./src/utils/pcm.js#L1-L24) rejects incomplete 16-bit samples.

The same service requests microphone permission, establishes full-duplex recording/playback mode, serializes base64 WAV playback, bounds each playback segment with a timeout, deletes temporary files, and clears queued audio on interruption: [`audio.js`](./src/services/audio.js#L68-L244).

Deterministic lifecycle tests cover exact PCM bytes, microphone races, disconnect cleanup, socket backpressure, text-send races and reconnect caps in [`pcm-audio.test.cjs`](./tests/pcm-audio.test.cjs#L7-L16) and [`hume-evi-lifecycle.test.cjs`](./tests/hume-evi-lifecycle.test.cjs#L41-L262). The audio service is mocked in the Hume lifecycle test, so those tests do not prove native capture or playback.

**Production qualification:** the architecture is credible, but “production-ready real-time iOS audio” cannot be claimed until a signed build proves microphone conversion, audible Hume round trips, AEC/feedback behavior, earpiece/speaker/Bluetooth routes, phone/Siri/media-service interruptions, lock/background/foreground recovery, latency, thermal/battery behavior and repeated-call cleanup. The local generated ExpoAudio implementation observed during this audit uses a fixed 100 ms capture buffer, and no application-level interruption restart signal is evident. Because that implementation is generated and ignored, treat it as an integration constraint to validate rather than application-authored native evidence. These are device-test and, potentially, native-module work items.

## 2. Modern full-stack expertise

### React and backend integration

The mobile application uses React `19.2.3`, React Native `0.86.0`, Expo `57.0.4`, and Expo Router in [`package.json`](./package.json#L22-L60). It integrates HTTPS auth/safety APIs and authenticated WSS voice rather than operating as a standalone mock client.

The backend in [`server/clm-server.cjs`](./server/clm-server.cjs#L1-L84) is native Node HTTP/CommonJS, not Express. It implements:

- strict production configuration validation and fail-closed dependencies: [`clm-server.cjs`](./server/clm-server.cjs#L87-L160);
- bounded JSON input and no-store responses: [`clm-server.cjs`](./server/clm-server.cjs#L163-L217);
- OpenAI-compatible streaming CLM responses, an authoritative safety prompt, tool calls, upstream timeouts, and local fallback: [`clm-server.cjs`](./server/clm-server.cjs#L219-L384);
- Apple/Google exchange, phone verification and access/refresh issuance: [`clm-server.cjs`](./server/clm-server.cjs#L414-L508) and [`clm-server.cjs`](./server/clm-server.cjs#L596-L640);
- authenticated contacts, safety state, SOS acceptance, privacy export/deletion and safety tools: [`clm-server.cjs`](./server/clm-server.cjs#L642-L678);
- an attached long-lived Hume WebSocket gateway for container deployments: [`clm-server.cjs`](./server/clm-server.cjs#L728-L736).

This is meaningful full-stack backend evidence. It demonstrates HTTP contracts, streaming, provider integration, security boundaries, persistence and deployment adaptation. It is **adjacent to, not equivalent proof of, Next.js App Router or TypeScript production experience**. Framework routing, React Server Components, server/client boundaries, Next middleware/caching, typed route contracts and TypeScript compilation are not present.

### Vercel and container deployment

[`server/api/index.js`](./server/api/index.js#L1-L53) adapts the existing handler to one Vercel Node Function and validates the internal catch-all rewrite. [`server/vercel.json`](./server/vercel.json#L1-L14) applies a 60-second maximum duration. The adapter is intentionally HTTP-only; raw WebSocket upgrades run through the long-lived server in [`server/Dockerfile`](./server/Dockerfile#L1-L16) with the Railway health/restart configuration in [`railway.toml`](./railway.toml#L1-L10).

The recorded deployment evidence in [`DEPLOYMENT_PLAN.md`](./DEPLOYMENT_PLAN.md#L5-L29) distinguishes a protected Vercel preview from a Railway staging Hume handshake and explicitly says neither is approved production evidence. That is sound engineering judgment.

### AWS

The DynamoDB document repository uses account partition keys, consistent reads, conditional creation, optimistic contact versioning, idempotent SOS records, paginated export, and batched deletion retries: [`safety-api.cjs`](./server/safety-api.cjs#L44-L217). API routes enforce JWT scopes, contact ownership, fresh timestamps, recent locations and retention metadata: [`safety-api.cjs`](./server/safety-api.cjs#L220-L363).

However, there is no repository-owned Terraform/CDK/CloudFormation/SAM configuration; no table, TTL, PITR, IAM, alarms or production AWS resources are provisioned. [`DEPLOYMENT_PLAN.md`](./DEPLOYMENT_PLAN.md#L18-L27) records AWS as an undeployed alternative. There is also no SES SDK dependency or delivery adapter. Twilio Verify SMS in [`phone-auth.cjs`](./server/phone-auth.cjs#L247-L303) is the implemented messaging-provider evidence.

**Assessment:** Node backend and Vercel/container adaptation are demonstrated. React 19 is demonstrated. Next.js, TypeScript and SES are not. DynamoDB application code is demonstrated; production AWS operations remain unproven.

## 3. Security and architecture

### OAuth and first-party sessions

The mobile flows do not treat Apple/Google identity tokens as application sessions. Apple uses a cryptographic nonce and both providers exchange their identity token with the backend: [`AuthContext.js`](./src/context/AuthContext.js#L595-L660). Phone verification likewise uses backend start/verify endpoints and stores its short-lived challenge outside route parameters: [`AuthContext.js`](./src/context/AuthContext.js#L692-L742).

The client requires HTTPS outside development, applies a ten-second abort, validates returned access/refresh token structure, binds both tokens to the same subject/session, and rejects mismatched expiry metadata: [`auth-session.js`](./src/services/auth-session.js#L7-L115). It stores one atomic, account-bound access/refresh/profile envelope through SecureStore and serializes refresh mutations in [`AuthContext.js`](./src/context/AuthContext.js#L170-L271) and [`AuthContext.js`](./src/context/AuthContext.js#L455-L512).

The backend verifies provider RS256 signatures using Apple/Google JWKS, checks issuer/audience/Google authorized party, expiry and Apple nonce, and bounds key-refresh behavior: [`auth-session.cjs`](./server/auth-session.cjs#L21-L128). It creates distinct, scoped, expiring access and refresh JWTs and verifies their HMAC signatures, issuer, audience, time bounds and token type: [`auth-session.cjs`](./server/auth-session.cjs#L130-L229).

The important gap is server-side session lifecycle. Refresh tokens are stateless signed JWTs. Refresh returns a new token but does not persist a refresh family, invalidate the old token, detect reuse, revoke on logout/account disable, or leave an account-deletion tombstone: [`clm-server.cjs`](./server/clm-server.cjs#L491-L508). An old stolen refresh JWT can therefore remain usable until its bounded expiry.

### Hybrid local/cloud model and PII

The account boundary is thoughtful. Before a different account is published, [`account-data-boundary.js`](./src/services/account-data-boundary.js#L52-L151) purges VeryLoving local stores, secure contacts/places and cached artifacts, preserves only device language, and fails closed if the required sweep cannot complete. The behavior is regression-tested in [`account-data-boundary.test.cjs`](./tests/account-data-boundary.test.cjs#L29-L170).

On signed devices, sessions, emergency contacts and saved places use the SecureStore abstraction: [`secure-storage.js`](./src/services/secure-storage.js#L47-L162), [`emergency-contact-store.js`](./src/services/emergency-contact-store.js#L11-L48), and [`saved-place-store.js`](./src/services/saved-place-store.js#L36-L107). Expo Go and iOS Simulator deliberately use volatile memory because they do not provide the app's signed Keychain entitlement; that is an honest development-only limitation, not release persistence.

Contacts are hydrated from an account-bound secure cache and reconciled with the backend without blocking offline safety UI: [`AppContext.js`](./src/context/AppContext.js#L125-L193). The privacy path exports local plus available remote data, removes its temporary file, deletes remote data before credentials, and writes a local sign-out tombstone to prevent residual Keychain restoration: [`privacy.js`](./src/services/privacy.js#L55-L139) and [`privacy.js`](./src/services/privacy.js#L141-L236).

The hybrid model is incomplete:

- conversation text and Hume chat metadata are stored in plaintext AsyncStorage: [`conversation-history.js`](./src/services/conversation-history.js#L1-L128);
- the offline message queue is also plaintext AsyncStorage: [`offline-message-queue.js`](./src/services/offline-message-queue.js#L1-L117);
- settings, location resilience records and paired-device metadata are local AsyncStorage records;
- cloud synchronization covers contacts and current safety/SOS records, not settings, history, queued messages, saved places or paired devices;
- SecureStore calls do not specify an explicit signed-build accessibility/migration policy such as device-only unlock behavior;
- backend deletion covers this DynamoDB partition, not Hume/Twilio/provider/log/backup orchestration;
- there is no durable refresh revocation or distributed auth/SMS abuse store.

Diagnostic logging recursively redacts bearer values and credential-shaped fields in [`logger.js`](./src/utils/logger.js#L1-L53), but encryption and retention controls are still required for the plaintext stores above.

**Assessment:** this is good evidence of security-aware architecture, not a finished security program. Before handling production safety PII, add encrypted account-bound storage for transcripts/queues/location-related records, explicit Keychain accessibility policy, durable refresh-family state/revocation, abuse controls, deletion tombstones/vendor orchestration, and production threat-model/penetration evidence.

## 4. BLE and 3D

### BLE wearable implementation

[`ble.js`](./src/services/ble.js#L128-L329) provides native-manager restoration, contextual permission gating, Bluetooth-state checks, service-filtered scanning, timeouts, retry and deterministic cleanup. Connection performs bounded connect/discovery/GATT validation, battery read, conditional notifications, status/event subscriptions and disconnect degradation handling: [`ble.js`](./src/services/ble.js#L341-L499). Command writes are decoded and bounded to 512 bytes, and reconnect uses bounded exponential attempts: [`ble.js`](./src/services/ble.js#L506-L586).

[`AppContext.js`](./src/context/AppContext.js#L224-L342) account-binds device events, persists disconnect/degraded state, handles restored sessions, schedules foreground reconnect, and rejects stale reconnect completion. [`paired-device-store.js`](./src/services/paired-device-store.js#L25-L84) strips ephemeral battery state and prevents another account from hydrating the remembered identifier.

This audit fixed one fail-open protocol edge: [`validateVL01GATT`](./src/services/vl01-protocol.js#L71-L97) now requires explicit readable/notifiable-or-indicatable/writable capability flags instead of accepting missing native metadata. [`ble-reliability.test.cjs`](./tests/ble-reliability.test.cjs#L321-L384) now covers those missing-capability failures.

Remaining BLE gaps are material: approved UUIDs and payload schemas are absent; status/events remain raw base64; command authorization and event semantics are not implemented; there is no device authentication, ownership challenge or secure pairing/bonding contract; reconnect does not rerun the Android permission rationale if permission was revoked; and no physical VL01/background/firmware matrix has passed. These require the signed firmware contract and representative hardware, not guessed code.

### 3D

No Spline, Three.js, React Three Fiber, Skia/GL 3D scene, model asset, 3D screen, or 3D test was found. `react-native-reanimated` drives small 2D feedback animations such as [`VoiceActivityIndicator.js`](./src/components/VoiceActivityIndicator.js#L1-L36); it is not 3D evidence.

Because 3D is listed as “good to have,” this is an honest portfolio gap rather than a product defect. Add 3D only when it serves a real wearable/product visualization need, with performance and accessibility fallbacks. A decorative dependency would not demonstrate useful 3D engineering.

## 5. Voice AI

The repository's strongest job-description alignment is voice:

- real-time PCM input and Hume `audio_input` frames;
- assistant `audio_output` playback with barge-in cancellation;
- user/assistant transcripts and prosody payloads;
- Hume tool calls with abort/correlation and safe error responses;
- durable text queueing, conversation history, offline text fallback and retry in [`useHumeVoiceCall.js`](./src/hooks/useHumeVoiceCall.js#L43-L396);
- a custom CLM streaming endpoint with an authoritative safety prompt and deterministic local danger fallback;
- an authenticated server-owned Hume gateway that removes mobile secrets and production prompt overrides.

Hume EVI provides the generated conversational speech, so this is valid voice-interface and cloud speech-output evidence. It is not a standalone TTS implementation. [`offline-evi.js`](./src/services/websocket/offline-evi.js#L20-L69) is text-only; bundled audio assets are voice previews, not offline TTS.

No WebRTC package, signaling, ICE/TURN, peer connection or media-track implementation exists. WebSocket was a reasonable choice for Hume EVI's protocol and the current mobile architecture, but it should be described as that trade-off—not as WebRTC experience.

The selected product voice profiles are persona slugs/previews unless a canonical Hume voice UUID is configured; [`hume-voice.js`](./src/utils/hume-voice.js#L1-L10) deliberately rejects non-UUID overrides. Product/Voice approval and real Hume UUIDs are required before claiming that each marketed voice maps to a distinct online voice.

## 6. Gap analysis and recommended remedies

| Priority | Gap | Why it matters | Credible remedy |
| --- | --- | --- | --- |
| Hiring evidence | SwiftUI/SwiftData absent | Two literal native-iOS must-haves are not demonstrated. | Produce a meaningful tracked Swift 5.9+ artifact: preferably an app-relevant native audio/BLE diagnostics module or a separate SwiftUI/SwiftData prototype with tests. Do not add an unused sample screen to the shipping app. |
| Hiring evidence | Next.js/TypeScript absent | Node work does not prove App Router or typed full-stack delivery. | Build a real Next.js 14+ App Router TypeScript operations surface or migrate an appropriate HTTP boundary with shared typed contracts and integration tests. Keep the WSS gateway on a compatible long-lived runtime. |
| P1 security | Stateless refresh rotation | Stolen old refresh tokens remain replayable until expiry. | Persist hashed refresh families and rotation state; detect reuse; revoke on logout, account disable and deletion; add short-lived single-use voice tickets and distributed abuse controls. |
| P1 PII | Transcripts/queues/location records are plaintext | These can contain highly sensitive safety data. | Use an account-bound encrypted database/key hierarchy, explicit Keychain accessibility, bounded records/bytes, schema migration, backup policy and deletion verification. |
| P1 safety backend | SOS is accepted, not delivered | A DynamoDB `202` is not proof a guardian received an alert. | Add a durable outbox/state machine, SES/SMS/push adapters as product-approved, retries/DLQ/idempotency, authenticated receipts and honest UI states. |
| P1 cloud | AWS resources/IaC/observability absent | Application code alone does not prove operable production AWS. | Add CDK/Terraform, table TTL/PITR/encryption/IAM, secret management, queues, alarms, dashboards, readiness, backup/restore and rollback evidence. |
| P1 voice | Signed-device and production evidence absent | Audio routes, interruptions, latency and live gateway behavior can differ materially from tests. | Run the exact TestFlight build through the physical-device/audio-route matrix, live Hume/CLM, load/soak, session replay/revocation and observability checks. Add native interruption/restart support if the matrix exposes the current risk. |
| P1 BLE | Secure firmware contract and device proof absent | Raw GATT connectivity is not authenticated wearable ownership. | Obtain approved schemas and hardware; implement ownership/pairing, decoded events, authorized commands, reset/DFU policy, permission recovery and signed hardware tests. |
| Good-to-have | WebRTC absent | The named optional transport is not demonstrated. | Add only for a defined peer-media use case; include signaling, TURN, lifecycle, network handoff and call-quality tests. |
| Good-to-have | 3D absent | Optional portfolio breadth is not shown. | Build an accessible, measured product visualization only if it adds user value; otherwise use separate portfolio evidence. |

### Why the major gaps were not “fixed” in this audit

Adding empty Swift, Next.js, TypeScript, SES, WebRTC or Spline scaffolds would create misleading evidence and more attack/maintenance surface without completing a product contract. The remaining gaps require architecture decisions, provider resources, security review, firmware input or physical-device validation. They are documented here as explicit work packages.

The bounded GATT capability validation defect was fixed because it was a real, low-risk fail-closed improvement to an existing production path.

## 7. Evidence-based fit statement for Grace

Grace can safely conclude from this repository that the engineer has built and hardened:

- a React 19 Expo/React Native mobile application with protected routing, persistence, internationalization and native integrations;
- a non-trivial Hume WebSocket voice client and authenticated relay, including real-time PCM, playback, interruption, tools, retry and offline behavior;
- a Node backend with streaming CLM behavior, OAuth-provider verification, first-party scoped JWTs, phone verification and DynamoDB safety/privacy contracts;
- account-isolated local/cloud data boundaries, Keychain-backed critical records, privacy export/deletion and fail-closed configuration;
- substantial BLE scanning, GATT validation, monitoring, commands, restoration and reconnect logic.

Grace should **not** infer from this repository alone that the engineer has shipped SwiftUI/SwiftData, Next.js App Router/TypeScript, SES, WebRTC or 3D/Spline, nor that the safety system has passed production security, signed-device audio, real wearable, guardian delivery or AWS operations acceptance.

The fairest overall assessment is: **strong hands-on mobile/voice/security/BLE and Node architecture evidence; material exact-stack gaps in native SwiftUI/SwiftData and Next.js/TypeScript; production proof still gated by security, cloud and physical-device work.**

## Verification record

The audit began from a clean `main` at `556928a`. The only runtime change made by this audit is the fail-closed VL01 capability validation described above, with regression assertions added to the existing BLE reliability test.

The final local validation on 15 July 2026 produced:

- development configuration validation: **16 checks passed, 8 documented warnings, 0 errors**;
- ESLint: **passed**;
- deterministic test suite: **341/341 passed**;
- Expo Doctor: **20/20 passed**;
- iOS production JavaScript export: **passed**;
- Android production JavaScript export: **passed**.

The eight environment warnings identify optional or externally provisioned development capabilities; they do not weaken the 20/20 Expo project-health result. Deterministic tests and source/export validation do not replace signed TestFlight, live providers, production AWS, physical audio or VL01 evidence. None of those external conditions was claimed as verified in this audit.
