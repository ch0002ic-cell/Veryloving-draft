# VeryLoving – Complete Handoff & Documentation

- Consolidated: 15 July 2026
- Repository evidence baseline: through `d0a9407`
- Audience: Grace, Product, Mobile QA, Engineering, Security, Privacy, Localization, and Release Operations
- Primary iOS acceptance environment: signed TestFlight build on a physical device

This document consolidates the repository's product overview, architecture, UI framework, globalization strategy, privacy model, voice and BLE integrations, setup guidance, deployment boundaries, validation evidence, TestFlight procedures, launch gates, and founding-engineer capability audit. It is intended to give Grace and the wider delivery team one readable handoff from project scope through release decision.

The codebase is a strong source-level TestFlight candidate: the current deterministic suite, lint, Expo Doctor, and iOS/Android production JavaScript exports pass. That evidence does not make the safety product production-ready. The last recorded production configuration remains incomplete, and no signed TestFlight session, physical-device audio/BLE matrix, production-provider run, or end-to-end guardian delivery has been accepted.

The current decision is therefore **NO-GO for production release**. An authorized owner must configure and build the exact reviewed commit, and every applicable P1 gate in this document must receive release-build-specific evidence. No environment values, credentials, internal account identifiers, deployment IDs, private service URLs, phone numbers, or precise locations are reproduced here.

## Table of Contents

1. [Document authority and evidence rules](#1-document-authority-and-evidence-rules)
2. [Executive status](#2-executive-status)
3. [Product scope and feature status](#3-product-scope-and-feature-status)
4. [System architecture](#4-system-architecture)
5. [UI framework and application state](#5-ui-framework-and-application-state)
6. [Globalization and language strategy](#6-globalization-and-language-strategy)
7. [Security, data, and privacy](#7-security-data-and-privacy)
8. [Voice AI and Hume](#8-voice-ai-and-hume)
9. [BLE, native integrations, and device behavior](#9-ble-native-integrations-and-device-behavior)
10. [Environment setup and build profiles](#10-environment-setup-and-build-profiles)
11. [Deployment architecture and external services](#11-deployment-architecture-and-external-services)
12. [TestFlight acceptance checklist](#12-testflight-acceptance-checklist)
13. [Launch gates and ownership](#13-launch-gates-and-ownership)
14. [Operations, compliance, and release decision](#14-operations-compliance-and-release-decision)
15. [Founding engineer requirement mapping](#15-founding-engineer-requirement-mapping)
16. [Validation and operator commands](#16-validation-and-operator-commands)
17. [Recommended next actions](#17-recommended-next-actions)
18. [Consolidation map](#18-consolidation-map)
19. [Reference links](#19-reference-links)

## 1. Document authority and evidence rules

### Status vocabulary

| Status | Meaning |
| --- | --- |
| **PASS — source/automated** | Current tracked implementation and deterministic checks pass. |
| **PASS — simulator/supporting environment** | The named behavior was observed in that environment only. |
| **PARTIAL — EXTERNAL** | The implementation exists, but signed hardware, provider, backend, or production evidence remains open. |
| **BLOCKED — EXTERNAL** | Testing cannot proceed until a named external resource or owner is available. |
| **FAIL** | The stated acceptance contract was exercised and did not pass. |
| **N/A** | Explicitly excluded from the release scope by an identified approver. |

Only an observation from the exact recorded build, profile, device, backend version, and test conditions may close a TestFlight row. Expo Go, a simulator, a JavaScript export, a successful archive, a health endpoint, or another build number can support a result but cannot be substituted for it.

### Canonical source order

When dated evidence or sections differ, use this precedence:

1. [Launch gates and ownership](#13-launch-gates-and-ownership) for the binding release decision.
2. [Executive status](#2-executive-status), [UI framework and application state](#5-ui-framework-and-application-state), and [Globalization and language strategy](#6-globalization-and-language-strategy) for the latest 15 July code, UI, and locale status.
3. [Environment setup and build profiles](#10-environment-setup-and-build-profiles), [Deployment architecture and external services](#11-deployment-architecture-and-external-services), [Voice AI and Hume](#8-voice-ai-and-hume), and [Security, data, and privacy](#7-security-data-and-privacy) for detailed operator contracts.
4. [Executive status and risk summary](#2-executive-status) for the system risk register.
5. [Evidence rules and current status](#1-document-authority-and-evidence-rules) and [Reconciled evidence history](#1-document-authority-and-evidence-rules) as dated runtime and bug-history evidence.

Historical totals such as 74, 118, 163, 215, 241, 313, 339, and 340 tests remain valid only for their recorded snapshots. They do not supersede the current 341-test baseline.

### Reconciled documentation updates

| Older wording | Current consolidated truth |
| --- | --- |
| Phone verification challenge stays only in memory. | A valid challenge is stored as a versioned, expiring SecureStore record on supported signed builds and restored only when it is newer than the signed-out tombstone. |
| Camera and photo-library permissions remain declared. | The inactive image-picker dependency/plugin and unused camera/photo permissions were removed; current tests prevent their reintroduction. |
| Contact editing is absent. | Local/offline editing exists; authenticated remote editing requires the updated backend deployment. |
| PCM, authenticated WebSocket, Dynamo safety APIs, and VL01 GATT are absent. | These paths are implemented and deterministically tested, but their provider, signed-device, production, firmware, and hardware acceptance remains open. |
| 151 entire catalogs were machine-generated. | There are 155 structurally complete catalogs. Six critical blocks pre-existed; 149 `releaseCritical` blocks were machine-generated. Arabic and Hebrew are also review-required, producing 151 `QA`-marked rows in the full-catalog picker. |
| Any successful export is a TestFlight pass. | An export proves bundle generation only; it is not a signed archive, install, provider session, or physical-device result. |

## 2. Executive status

### Latest recorded evidence

| Layer | Result | Qualification |
| --- | --- | --- |
| Deterministic tests | **PASS — 341/341** | No failed or skipped tests in the recorded run. |
| ESLint | **PASS** | Current source passed. |
| Whitespace/diff check | **PASS** | Rechecked against the current documentation changes. |
| Expo Doctor | **PASS — 20/20** | Project-health checks passed. |
| iOS production JavaScript export | **PASS** | Release-optimized bundle generation only. |
| Android production JavaScript export | **PASS** | Release-optimized bundle generation only. |
| iOS simulator supporting run | **PASS for named flows** | Spanish switching/persistence, selected UI flows, honest SOS fallback, Map/Saved Places/share, offline Safety Call, and selected responsive layouts were observed. |
| Isolated backend staging/preview | **PARTIAL — EXTERNAL** | HTTP liveness/fail-closed behavior and a synthetic authenticated Hume handshake were recorded; no production approval is implied. |
| Local production environment validation | **FAIL — recorded 15 July** | 13 checks OK, 2 warnings, and 9 errors: phone auth, custom Hume CLM, safety backend, VL01 readiness, and five approved VL01 UUID requirements were incomplete in the locally readable profile. |
| Signed EAS/TestFlight archive | **BLOCKED — EXTERNAL** | The recorded Expo account lacked project build access. |
| Physical iPhone/iPad acceptance | **BLOCKED — EXTERNAL** | No connected physical iOS device was available for the audited commit. |
| Production safety release | **NO-GO** | P1 security, delivery, hardware, provider, localization, privacy, and operations gates remain. |

The production validator and project-access statements above are audit-time facts, not permanent architecture constraints. Re-run the redacted validator and record current access before building.

### What is currently safe to claim

- The source is stable enough to create the next authorized TestFlight candidates.
- The foundational UI, persistence boundaries, language-switching flow, error semantics, and accessibility foundations are implemented and covered at the deterministic layer.
- The repository contains substantive Hume WebSocket/PCM, OAuth/JWT, DynamoDB, BLE/GATT, privacy, and deployment code.
- The app has not yet passed signed-device, production-provider, production-delivery, or public-release acceptance.

## 3. Product scope and feature status

VeryLoving is an Expo Router personal-safety companion with account onboarding, Mapbox safety/location views, NorthStar/VL01 wearable integration, emergency contacts and SOS flows, Hume EVI voice conversations, local history, and an explicitly labeled offline fallback.

| Product area | Implemented baseline | Current boundary |
| --- | --- | --- |
| Authentication | Apple/Google provider exchange, phone start/verify API, scoped access/refresh JWTs, secure envelope, refresh and protected routes. | Real Apple/Google/Twilio, Keychain lifecycle, durable refresh revocation/reuse detection, provider credential state, and abuse controls require production-like evidence. |
| Onboarding | Ordered, account-bound, resumable state machine with contextual permission explanations. | Native allow/deny/revoke/Settings recovery and upgrade behavior require signed-device testing. |
| Navigation | Public/protected stacks, safe Back/Home fallbacks, allowlisted stable restoration, and native-intent/deep-link sanitization. | Universal/custom-link launch, gestures, process death, and iPad split view require the exact signed build. |
| Safety modes | Home/Guardian/Emergency state and authenticated persistence contracts. | Connected guardian behavior, actual delivery, receipts, and production outage semantics remain incomplete. |
| Map and Saved Places | Mapbox rendering/fallbacks, location state, bounded offline tile cache, Quick Share snapshot, secure Saved Places. | Routes, remote danger/avoidance intelligence, revocable live sharing, recipients, and expiry are not complete production features. |
| Emergency/SOS | Confirmation, contact fallback, recent-location validation, idempotent durable acceptance, honest dialer/result semantics. | `accepted` means stored, not delivered. Guardian/contact/push delivery, receipts, escalation, and emergency dispatch do not yet exist end to end. |
| Voice AI | Hume WebSocket client, PCM path, playback, barge-in cleanup, tools, history, queue, reconnect, and offline text fallback. | Production Hume/CLM, signed audio routes, latency/AEC, background/lock-screen behavior, and load remain open. |
| BLE/NorthStar | Permission/state handling, filtered scan, GATT validation, battery, optional notifications, commands, disconnect, persistence, and reconnect. | Firmware schema, decoded events, command authorization, ownership/secure pairing, DFU/reset policy, and physical hardware remain open. |
| Settings | Language, voice/persona, reminder, contacts, Saved Places, devices, history, privacy/export/delete. | Some settings and resilience stores remain plaintext; remote workflows depend on production services. |
| Globalization | Profile-gated language picker, immediate same-direction update, durable selection, RTL transition, full-catalog QA mode. | Machine-generated safety copy and RTL visual behavior require human/signed-device approval. |
| Friends | Honest empty/planned surface. | No account-backed invite/friend API, consent model, or abuse controls; no fake friend data is shipped. |
| Theme | Intentional light-only design. | Dark mode is not promised or implemented. |

## 4. System architecture

### Mobile provider and routing hierarchy

```text
Outer startup error boundary
└── Safe-area and root audio stream
    └── AuthProvider
        └── AppProvider
            └── I18nProvider
                └── Localized render error boundary
                    └── Protected Expo Router stack
```

- [`AuthContext.js`](./src/context/AuthContext.js) owns the session, refresh lifecycle, phone challenge, signed-out tombstone, and account-bound onboarding.
- [`AppContext.js`](./src/context/AppContext.js) owns normalized settings, contacts, safety/device state, hydration, and serialized mutations.
- [`I18nContext.js`](./src/context/I18nContext.js) resolves locale, publishes translations, persists language, coordinates reminder copy, and controls LTR/RTL reloads.
- [`app/_layout.js`](./app/_layout.js) mounts the provider tree, audio bridge, and protected router.

### Deployment topology

```text
Expo mobile app
  ├── HTTPS auth, phone, safety, privacy, CLM/tools
  │      └── Vercel HTTP Function or reviewed container
  │              ├── DynamoDB
  │              └── Twilio Verify / optional approved model
  │
  └── WSS /api/voice/hume-ws
         └── long-lived Railway/ECS-compatible container
                 └── Hume EVI

Hume EVI ── authenticated HTTPS SSE ──> /chat/completions
```

The HTTP-only Vercel adapter is [`server/api/index.js`](./server/api/index.js). It does not mount the raw Node WebSocket upgrade listener. The long-lived service is [`server/clm-server.cjs`](./server/clm-server.cjs), packaged by [`server/Dockerfile`](./server/Dockerfile); its minimum Railway behavior is described by [`railway.toml`](./railway.toml). A successful `/health` response proves process liveness only.

### Backend route contract

| Route | Authentication | Purpose and boundary |
| --- | --- | --- |
| `GET /health` | None | Liveness only. |
| `POST /chat/completions` | Independent Hume CLM bearer | OpenAI-compatible SSE CLM with safety handling and optional approved upstream. |
| `POST /v1/auth/exchange` | Provider assertion | Verifies Apple/Google identity and issues first-party session tokens. |
| `POST /v1/auth/refresh` | Refresh JWT | Rotates the client-held pair; durable family revocation is still absent. |
| `POST /v1/auth/phone/start` and `/verify` | Signed bounded challenge | Uses Twilio Verify when enabled and configured. |
| Emergency-contact routes | Scoped app JWT | Account-partitioned read/create/update/delete. |
| Safety-session and SOS routes | Scoped app JWT | Idempotent current-state and durable SOS acceptance; no delivery claim. |
| Privacy export/delete routes | Scoped app JWT | Account Dynamo records only; not full vendor orchestration or session revocation. |
| `GET` upgrade `/api/voice/hume-ws` | JWT in first TLS frame with `voice:connect` | Opens Hume only after app authentication. |
| `POST /v1/safety/tips` | Scoped app JWT | Curated safety guidance for tool calls. |

Primary server evidence: [`auth-session.cjs`](./server/auth-session.cjs), [`safety-api.cjs`](./server/safety-api.cjs), [`voice-gateway.cjs`](./server/voice-gateway.cjs), and [`clm-server.cjs`](./server/clm-server.cjs).

## 5. UI framework and application state

### Navigation and lifecycle

- Signed-out, authentication, onboarding, and protected app routes are distinct.
- Hydration is bounded and the router waits for the expected account state.
- Only a versioned, account-bound, allowlisted stable destination is restored. Arbitrary history, authentication internals, onboarding bypasses, SOS modals, and voice-call modals are not restored.
- Direct app/web intents are canonicalized and filtered before file-route resolution.
- Detail screens have visible localized Back controls and safe Home fallback when no native history exists.
- Startup and localized render boundaries prevent an uncaught render failure from becoming an unexplained blank screen.

### Persistence model

| Data | Current persistence contract |
| --- | --- |
| Access/refresh/profile | One validated account-bound SecureStore envelope on supported signed builds. |
| Phone challenge/onboarding | Versioned, expiring/account-bound SecureStore records on supported signed builds. |
| Emergency contacts/Saved Places | Account-bound SecureStore; remote reconciliation where enabled. |
| Settings | Strict versioned schema with serialized persist-before-publish updates. |
| Language | Device-level preference intentionally retained across sign-out/account switches. |
| Navigation | One safe stable destination, not full history. |
| History/queues/location/SOS/device metadata | Serialized, account-bounded local records with cleanup and stale-data checks; still plaintext at rest. |
| Native artifacts | Reminder schedule, temporary voice files, and app-owned Mapbox packs participate in cleanup. |

Expo Go and the iOS Simulator use explicit volatile or unavailable fallbacks for entitlement-dependent SecureStore/notification behavior. A process-memory session does not survive reload and must never be treated as TestFlight persistence evidence.

### Error handling and feedback

- Auth, storage, permission, Mapbox, SOS, BLE, voice, WebSocket, export, and deletion paths use bounded errors or typed outcomes.
- User-visible errors are translated from stable error codes; raw provider/native errors, stack traces, bearer values, internal endpoints, and exception text are not rendered.
- Loading, disabled, empty, success, failure, retry, and live-status states are explicit.
- Failed mutations retain the last valid state and do not present false success.
- A WebSocket send racing closure becomes one durable queued message rather than being silently lost.
- SOS wording distinguishes stored acceptance, opened dialer, connected call, and actual delivery.

### Components, responsiveness, and accessibility

- Shared tokens remain the source for spacing, typography, color, radii, shadows, and semantic feedback.
- Critical controls have labels/roles/state, live feedback is announced, and decorative art is hidden from assistive technology.
- Forms and modal sheets are keyboard/safe-area aware; general tablet content is capped for readability.
- Responsive supporting evidence exists for compact/current iPhone and 11-inch iPad portrait onboarding layouts.
- Physical QA remains required for VoiceOver order, Dynamic Type, hit sizes, Reduce Motion, rotation, landscape, and iPad split view.
- The app intentionally declares a light-only interface. Dark mode must not be marked PASS.
- Store builds exclude development demo authentication and sample danger-zone fixtures.

This UI section is the canonical framework summary; update it whenever the implementation or signed-device evidence changes.

### Consolidated hardening history

The following material defects were reproduced and corrected during the July audit sequence. Older reports remain available in Git history, but the current behavior is summarized here.

| Finding | Corrected behavior |
| --- | --- |
| Authentication/protected-route bypass | Public/protected route classification, provider fail-closed behavior, account-bound onboarding, and completion gates prevent unverified access. |
| Cross-session data recreation | Tracked writers drain before account cleanup; a fail-closed owner boundary prevents old-account data from being republished. |
| False SOS activation | Confirmation and dialer/backend outcomes remain distinct; the UI never treats a local action as emergency delivery. |
| Broken privacy export | Current Expo file/share APIs create a temporary JSON export and remove it in a final cleanup path. |
| Permission double taps and bad onboarding resume | Busy guards, bounded errors, and ordered persisted progress prevent duplicate navigation and unsafe step skipping. |
| Blank/dead-end map states | Missing configuration, denied location, stale fallback, style failure, annotations, and retry are explicit. |
| Unsafe call launch and jewelry return routing | Typed `canOpenURL`/`openURL` outcomes and context-aware navigation replace unchecked calls and hard-coded onboarding returns. |
| Hume protocol/reconnect/microphone races | Wire contracts, terminal close classification, bounded reconnect, generation-safe microphone state, and transport-first teardown are enforced. |
| Overlapping playback and stalled offline retry | Playback is serialized/cancellable, temporary audio is cleaned, and queued retries schedule their next eligible attempt. |
| Locale/state regressions | Settings persist before publication, visible errors store stable keys, selected rows are accessible, and LTR/RTL transitions are generation-safe. |
| BLE capability ambiguity | GATT reads, subscriptions, and writes require explicit native capability flags and fail closed when metadata is missing. |

## 6. Globalization and language strategy

### Catalog policy

| Artifact/profile | Selectable interface catalogs | Purpose |
| --- | --- | --- |
| `production` | English, Spanish, French, Simplified Chinese | Public reviewed release surface. |
| Base `testflight` | Production four plus Arabic and Hebrew | Primary signed QA candidate with RTL review. |
| `testflight-full-catalog` | All 155 catalogs | Separately identified signed structural/layout/search/persistence/RTL audit. |
| Development full-catalog mode | All 155 catalogs when permitted by development metadata and `EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true` | Local/dev-client layout audit. |

The base TestFlight picker has **System default plus six catalogs: seven rows**. The full-catalog picker has **System default plus 155 catalogs: 156 rows**. Results from the two profiles are not interchangeable.

### Registry and translation facts

- The registry represents all 183 assigned ISO 639-1 codes.
- There are 155 JSON catalogs and 28 intentionally unavailable registry entries.
- Every catalog has 353 non-empty keys with placeholder parity: 319 established keys plus 34 `releaseCritical` keys.
- The English, Spanish, French, Simplified Chinese, Arabic, and Hebrew critical blocks pre-existed.
- Codex `gpt-5.6-sol` generated the other 149 critical blocks on 15 July 2026.
- Machine-generation provenance and review progress are stored in [`translation-review.json`](./src/i18n/translation-review.json); runtime availability and general review state are controlled by [`language-registry.js`](./src/i18n/language-registry.js).
- General English per-string overlay fallback is disabled. The selected catalog supplies its own critical block.
- Structural completeness is not translation, cultural, legal, or safety approval.
- The full-catalog picker marks 151 review-required rows `QA`: 149 generated critical blocks plus Arabic and Hebrew.

The 28 registered codes without catalogs are: `an`, `ae`, `bi`, `cu`, `kw`, `cr`, `hz`, `ho`, `io`, `ia`, `ie`, `ik`, `ki`, `kj`, `lu`, `na`, `nv`, `nd`, `ng`, `nn`, `oj`, `pi`, `rm`, `sc`, `vo`, `wa`, `ii`, and `za`. System default resolves these honestly to English.

Traditional Chinese requests such as `zh-Hant`, `zh-TW`, `zh-HK`, and `zh-MO` also resolve to English rather than being mislabeled as the maintained Simplified Chinese catalog.

### Runtime language behavior

- The selected normalized preference is persisted before the context publishes it.
- Same-direction changes update mounted app-owned strings immediately.
- The current row has a visible and accessible selected/checkmark state.
- Enabled Capybear reminder copy is migrated to the target language.
- Crossing LTR/RTL persists the target state, creates a transition generation, completes bounded reminder work, and permits one native process reload.
- Stale transitions cannot overwrite the latest language or create a reload loop.
- System default resolves the current OS preference only when that catalog is available under the active build profile.

The 11 available RTL catalogs are Arabic, Divehi, Persian, Hebrew, Kashmiri, Sorani Kurdish, Pashto, Sindhi, Uyghur, Urdu, and Yiddish. Base TestFlight focuses on Arabic/Hebrew; full-catalog QA can inspect all 11.

Phone numbers are stored and transmitted in canonical E.164 form. Display formatting must not be persisted in place of the canonical value; see [`phone.js`](./src/utils/phone.js) and [`GlobalPhoneInput.js`](./src/components/GlobalPhoneInput.js).

This section is the canonical localization, translation-review, and RTL policy.

### Full-catalog development and signed QA

Run all catalogs in a development client only when development metadata and the public audit flag agree:

```bash
VERYLOVING_BUILD_PROFILE=development \
EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true \
npx expo start --dev-client
```

When native supported locales and permission strings must also be regenerated, use the same variables with a new native prebuild/development build. For signed physical-device layout QA, do not edit source or the local environment to imitate production:

```bash
eas build --platform ios --profile testflight-full-catalog
```

### Adding or approving a locale

1. Copy `src/i18n/locales/en.json` to the target ISO code and translate every value without changing keys or `%{placeholder}` tokens, including native permission copy.
2. Attach the catalog to its entry in [`language-registry.js`](./src/i18n/language-registry.js) with honest availability and `reviewRequired` metadata.
3. Record machine-generation provenance and review status in [`translation-review.json`](./src/i18n/translation-review.json); JSON catalog comments are invalid.
4. Run the full tests. Coverage must fail on a missing, extra, empty, or placeholder-damaged value or catalog/registry drift.
5. Obtain native-speaker review of safety, emergency, consent, authentication, permissions, maps, voice, privacy, and notifications.
6. Clear `reviewRequired` and add the locale to a public profile only after that approval is recorded.

## 7. Security, data, and privacy

### Authentication flow

1. Apple/Google returns a provider identity assertion; Apple includes a nonce.
2. The app sends the assertion over HTTPS to `/v1/auth/exchange`.
3. The backend verifies signature, issuer, audience, expiry, authorized party where applicable, and Apple nonce.
4. The backend issues distinct scoped access and refresh JWTs.
5. The client validates subject/session/profile binding and stores one atomic SecureStore envelope.
6. Refresh is serialized and bounded; transient network errors can retain offline account state, while rejected refresh fails closed.

Phone authentication uses Twilio Verify plus a signed five-minute app challenge. No fixed-code or fabricated production-token fallback exists.

The material open session risk is server-side lifecycle: refresh JWTs remain stateless. Rotating the client-held token does not invalidate an earlier stolen refresh token before expiry. Production needs durable hashed refresh families, single-use rotation, reuse detection, revocation on logout/account disable/deletion, audit events, provider credential-state checks, and distributed abuse controls.

### Hybrid local/cloud data

| Data class | Local handling | Cloud handling |
| --- | --- | --- |
| Session/profile | SecureStore on supported signed builds | Provider verification and first-party token issuance. |
| Contacts/Saved Places | Account-bound SecureStore | Contacts can reconcile with account-partitioned DynamoDB; Saved Places remain local. |
| Current safety/SOS | Account-bound resilience records | Optional authenticated DynamoDB persistence and account export/delete. |
| Settings, navigation, device metadata | Local account-bound schemas | No complete cloud synchronization. |
| Transcripts/history/offline queue | Plaintext AsyncStorage | Hume/CLM receives live conversation content when online; no complete cloud history sync. |
| Cached location/map packs | Bounded local fallback and native cache | Recent coordinates may accompany confirmed SOS; provider tiles follow Mapbox policy. |

Before a different account is published, [`account-data-boundary.js`](./src/services/account-data-boundary.js) purges previous or unowned local/secure/native surfaces and fails closed if required cleanup cannot complete. This provides account isolation; it does not provide OS-protected encryption for plaintext stores.

### Data handled by core features

- Verified account identity, name/email/phone/country/provider metadata.
- Current location, a clearly timestamped stale fallback, and bounded app-owned Mapbox packs.
- 48 kHz mono Int16 microphone PCM, conversational text, emotional/prosody context, and opaque Hume session references during online voice use.
- Emergency contacts, safety mode, recent SOS context, and durable acceptance records.
- Nearby wearable identifier, connection state, and paired-device metadata.
- Local reminder, permission-rationale, history, queue, resilience, and settings records.
- Vendor diagnostics required by bundled native SDKs, subject to release disclosure and retention review.

### Export and deletion

- Export assembles the local account snapshot and, when configured, the authenticated account's Dynamo records.
- Remote unavailability may produce an explicitly partial export with remote status; failure to read required local protected data fails visibly rather than pretending the export is complete.
- The temporary JSON file is deleted after the native share attempt.
- Backend-enabled deletion is remote-first. A remote failure leaves the user signed in and local data intact so the request can be retried safely.
- Successful deletion drains tracked writers, removes local/SecureStore data, and attempts native artifact cleanup.

Current deletion does not revoke the server session, create a durable deletion tombstone, prevent all old-token repopulation, or orchestrate Hume, Apple/Google, Twilio, Mapbox, logs, backups, and external share destinations. Production privacy acceptance must close those boundaries.

### Permissions and disclosure

Active permissions are location, notifications, microphone, and Bluetooth. Each has an app-owned rationale and denial/recovery path. Current source has no active camera/photo picker and no camera/photo permission declaration.

The privacy manifest is generated from [`app.config.js`](./app.config.js). Store submission must reconcile the generated archive, SDK manifests, deployed vendors, public privacy policy, App Store answers, and Play Data Safety disclosures. Source configuration alone is not approval.

### Safety semantics

- `accepted` means a safety/SOS record was stored.
- `dialer_opened` means the operating system accepted the dialer URL.
- Neither means a guardian received an alert, a call connected, or emergency services were dispatched.

See [Security, data, and privacy](#7-security-data-and-privacy), [`privacy.js`](./src/services/privacy.js), [`secure-storage.js`](./src/services/secure-storage.js), and [`safety-api.cjs`](./server/safety-api.cjs).

## 8. Voice AI and Hume

### Implemented voice path

1. The mobile client opens the configured WSS proxy with no token or Hume choice in the URL query.
2. Its first TLS-protected frame contains the app access JWT and bounded config/voice/resume choices.
3. The gateway verifies the token and `voice:connect` scope before opening Hume with the server-only key.
4. The gateway enforces config/voice policy, strips client CLM credentials/overrides, and injects its independent CLM bearer into the first settings frame.
5. The client waits for authenticated gateway setup and Hume `chat_metadata` before entering connected state and starting the microphone.
6. A root-mounted audio bridge requests 48 kHz mono Int16 buffers.
7. The audio service validates the native format and streams headerless PCM with a 256 KiB backpressure boundary.
8. Assistant audio is queued and played serially; interruption/barge-in cancels stale playback.
9. Tool calls are validated, correlated, abortable, and returned as safe `tool_response` messages.
10. Reconnect is bounded; typed messages can enter a durable FIFO queue; an explicitly labeled offline text fallback and local history are available.

Key evidence:

- [`hume-evi.js`](./src/services/websocket/hume-evi.js)
- [`hume-protocol.js`](./src/services/websocket/hume-protocol.js)
- [`audio.js`](./src/services/audio.js)
- [`AudioStreamBridge.js`](./src/components/AudioStreamBridge.js)
- [`useHumeVoiceCall.js`](./src/hooks/useHumeVoiceCall.js)
- [`voice-gateway.cjs`](./server/voice-gateway.cjs)
- [Voice AI and Hume](#8-voice-ai-and-hume)

### Security and production boundary

- Server secrets must never use an `EXPO_PUBLIC_` variable.
- Release builds reject a direct public Hume API key.
- Client resume stays disabled until every resumed chat is bound to the authenticated owner.
- The app JWT in the first frame is still a reusable bearer, not a single-use voice ticket.
- Production requires revocation/replay controls, per-account/IP limits, quotas, ingress/path restrictions, redacted observability, backpressure/load/soak tests, and rollback.
- `/health` does not prove Hume credentials, CLM, WebSocket upgrades, or voice readiness.

### Honest capability statement

Hume provides generated conversational speech, so the repository demonstrates a voice interface and cloud-generated speech output. It has no standalone/local TTS engine and no WebRTC implementation. The four visible profile slugs/previews are personas unless Product configures and approves canonical Hume voice UUIDs; they must not be represented as four proven online acoustic voices.

Signed physical-device acceptance is still required for continuous frame timing, audible two-way output, AEC/feedback, speaker/earpiece/Bluetooth routes, interruptions, network handoff, background/foreground, lock screen, thermal/battery behavior, latency, and repeated cleanup.

## 9. BLE, native integrations, and device behavior

### Implemented VL01 layer

- Contextual Bluetooth rationale and platform permission classification.
- Bluetooth-state checks and explicit powered-off/unsupported/denied outcomes.
- Approved-service-filtered scanning with timeout, retry, and cleanup.
- Bounded connect, service discovery, GATT validation, battery read, conditional notification monitoring, status/event subscriptions, and command writes.
- Disconnect/degradation handling and serialized bounded exponential reconnect.
- Account-bound paired-device metadata without persisting live native objects or battery telemetry.
- Foreground restoration and stale-callback rejection.
- Fail-closed capability validation: missing readable/notifiable/indicatable/writable metadata is rejected.

Evidence: [`ble.js`](./src/services/ble.js), [`vl01-protocol.js`](./src/services/vl01-protocol.js), and [`ble-reliability.test.cjs`](./tests/ble-reliability.test.cjs).

### Remaining wearable work

- Versioned firmware-approved service/characteristic UUID registry.
- Battery encoding and decoded status/event schemas.
- Safety-approved command schema and authorization.
- Device ownership challenge, secure pairing/bonding, reset, transfer, and compromise response.
- Firmware compatibility, DFU/rollback policy, and low-battery behavior.
- Signed-device scanning, connection, reconnect, backgrounding, Bluetooth revoke/restore, process death, two-account isolation, wearable loss/reset, and soak testing.

### Other native boundaries

- Mapbox, SecureStore, notifications, Apple/Google Sign-In, BLE, telephony, and real audio require development or signed builds.
- Expo uses Continuous Native Generation: `ios/` and `android/` are generated/ignored, while native source of truth lives in [`app.config.js`](./app.config.js) and [`plugins/`](./plugins).
- Background audio and Bluetooth-central declarations are configuration, not proof of background behavior.
- No 3D/Spline/Three implementation exists; Reanimated is used for 2D motion.

## 10. Environment setup and build profiles

### Prerequisites

- Node.js 22 or newer and npm.
- EAS CLI 20 or newer for cloud artifacts.
- Xcode, CocoaPods, and an iOS simulator for local native work.
- JDK 17, Android Studio, Android SDK Platform 36, and an API 36 emulator for Android runtime work.
- A development or signed build for native providers, Keychain, Mapbox, BLE, notifications, telephony, and audio.

### Safe local bootstrap

```bash
npm install
npm ci --prefix server
cp .env.example .env
cp server/.env.example server/.env
npm run validate-env
```

- Root `.env` is untracked mobile/build configuration.
- Every `EXPO_PUBLIC_*` value is bundled and must be treated as public.
- `server/.env` is untracked local server configuration and is not loaded automatically.
- Backend/provider/session secrets belong in deployment secret managers.
- `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is a build-only secret and must never use an `EXPO_PUBLIC_` name.
- `EXPO_PUBLIC_HUME_API_KEY` is development-only and must be absent in preview/TestFlight/production.
- Do not place actual values in Git, screenshots, logs, tickets, or this document.

### Configuration groups

| Group | Public/build identifiers or readiness flags | Server-only dependencies |
| --- | --- | --- |
| API/auth | API base URL, Google Web/iOS client IDs, phone readiness flag | Provider allowlists, session signing, phone challenge/subject secrets, Twilio credentials |
| Voice | WSS proxy URL, Hume config/customization/branded-voice IDs, CLM readiness flag | Hume API key, CLM bearer, voice allowlist, session verification, optional upstream key |
| Maps | Public runtime Mapbox token | Build-only Mapbox download token |
| Safety | Safety-backend readiness flag | Dynamo table/region/retention and least-privilege AWS identity |
| Localization | RTL-QA and full-catalog flags plus build-profile metadata | Native-speaker approvals and release policy |
| VL01 | Readiness flag and approved public GATT UUID metadata | Firmware specification, security/ownership policy, hardware evidence |

The configuration groups above and the committed example files are the canonical non-secret reference; actual values remain in approved local or provider-managed environments.

### Mobile and build variable contract

| Variable | Purpose | Release rule |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | HTTPS root for auth, phone, safety, privacy, and app-facing tools. | Required for connected production behavior; must be a reviewed HTTPS domain. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google Web OAuth audience for backend ID-token verification. | Must match server `GOOGLE_TOKEN_AUDIENCES`. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Native iOS OAuth client and callback-scheme source. | Must use bundle `com.veryloving.app` and be trusted when presented as `azp`. |
| `EXPO_PUBLIC_PHONE_AUTH_ENABLED` | Public readiness gate for phone sign-in. | Enable only after deployed Twilio endpoints and abuse controls pass. |
| `EXPO_PUBLIC_HUME_WS_PROXY_URL` | Authenticated long-lived WSS voice endpoint. | Required for live release voice; never point it at the HTTP-only Vercel adapter or include credentials in the URL. |
| `EXPO_PUBLIC_HUME_CONFIG_ID` | Approved Hume EVI configuration UUID. | Required when custom CLM/tools are enabled. |
| `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` | HTTPS root for CLM/tool control calls. | May equal the reviewed API root. |
| `EXPO_PUBLIC_HUME_CLM_ENABLED` | Public custom-voice-stack readiness gate. | Enable only after CLM, gateway, and Hume configuration pass. |
| `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` | Optional approved canonical Hume voice UUID. | Empty retains approved configured/default behavior. |
| `EXPO_PUBLIC_HUME_API_KEY` | Direct development-only compatibility key. | Must be absent from preview, TestFlight, and production. |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public least-privilege `pk.*` native runtime token. | Required for production maps; never substitute a secret `sk.*` token. |
| `EXPO_PUBLIC_ENABLE_OFFLINE_MODE` | Forces the bundled offline companion for fault testing. | Keep `false` for normal release builds. |
| `EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES` | Adds Arabic/Hebrew to the base TestFlight surface. | QA only until native-speaker approval. |
| `EXPO_PUBLIC_SHOW_ALL_LANGUAGES` | Enables the 155-catalog audit when profile policy permits. | `true` only in development or `testflight-full-catalog`. |
| `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED` | Enables connected contacts, safety state, SOS acceptance, and remote privacy operations. | Required for production after backend validation. |
| `EXPO_PUBLIC_VL01_ENABLED` | Enables the approved real-device VL01 contract. | Keep disabled until firmware and physical evidence pass. |
| `EXPO_PUBLIC_VL01_SERVICE_UUID` | Filtered scan and primary-service UUID. | Required with VL01. |
| `EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID` | One-byte battery characteristic UUID. | Required with VL01. |
| `EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID` | Status read/notification UUID. | Required by production diagnostics and firmware approval. |
| `EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID` | Wearable-event notification UUID. | Required by production diagnostics and event approval. |
| `EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID` | Authorized command-write UUID. | Required by production diagnostics plus command/security approval. |
| `EXPO_PUBLIC_ROBOTICS_MOCK_MODE` | Selects the JavaScript/WebSocket robotics transport instead of native BLE. | `true` only for the dedicated robotics QA profile. |
| `EXPO_PUBLIC_ROBOTICS_SIMULATOR_URL` | Build-time simulator WebSocket default. | Use private-LAN `ws://` or a reviewed `wss://` tunnel; QA can override it at runtime. |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | Secret `sk.*` token used while resolving native Mapbox artifacts. | Build secret only; never public or committed. |
| `VERYLOVING_BUILD_PROFILE` | Selects committed development/preview/TestFlight/production policy. | Must match the actual EAS profile. |
| `VERYLOVING_CONFIG_DIAGNOSTICS` | Emits redacted presence/scheme diagnostics. | EAS profiles use it without printing values. |

Apple Sign-In has no root environment variable: the native token uses `com.veryloving.app` as its audience, which the backend accepts through `APPLE_CLIENT_IDS`.

### Server and operator variable contract

| Group | Variable names | Contract |
| --- | --- | --- |
| Runtime | `NODE_ENV`, `PORT` | Node 22 service; container platform normally owns `PORT`. |
| Hume gateway | `HUME_API_KEY`, `HUME_CONFIG_ID`, `HUME_ALLOWED_VOICE_IDS`, `HUME_ALLOW_CLIENT_RESUME`, `HUME_CLM_BEARER_TOKEN` | Server-only; canonical UUIDs; keep resume false until ownership binding exists. |
| App authentication | `AUTH_EXCHANGE_ENABLED`, `SESSION_JWT_SECRET`, `SESSION_JWT_ISSUER`, `SESSION_JWT_AUDIENCE`, `SESSION_JWT_TTL_SECONDS`, `SESSION_REFRESH_TTL_SECONDS` | Independent signing secret, exact issuer/audience, bounded access/refresh lifetimes. |
| Provider verification | `APPLE_CLIENT_IDS`, `GOOGLE_TOKEN_AUDIENCES`, `GOOGLE_AUTHORIZED_PARTIES` | Exact environment-specific allowlists. |
| Phone verification | `PHONE_AUTH_ENABLED`, `PHONE_AUTH_CHALLENGE_SECRET`, `PHONE_AUTH_SUBJECT_SECRET`, `PHONE_AUTH_CHALLENGE_TTL_SECONDS`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Independent secrets; stable subject derivation; Twilio credentials remain server-only. |
| Safety/DynamoDB | `SAFETY_API_ENABLED`, `SAFETY_TABLE_NAME`, `SAFETY_RETENTION_DAYS`, `AWS_REGION` | Table uses string `PK`/`SK` and numeric `expiresAt` TTL metadata. |
| Optional upstream CLM | `CLM_UPSTREAM_URL`, `CLM_UPSTREAM_API_KEY`, `CLM_UPSTREAM_MODEL`, `CLM_UPSTREAM_TIMEOUT_MS` | Configure the URL/key/model together or omit all to use deterministic local responses. |
| Optional verifier fallback | `APP_AUTH_VERIFY_URL` | Not required when all callers use the in-repository app JWT. |
| Hume provisioning operator | `HUME_CLM_URL`, `HUME_TOOL_ID`, `HUME_CUSTOM_VOICE_ID` | Operator-only inputs for versioned Hume resources; never mobile secrets. |

Generate independent high-entropy values for session signing, phone challenge signing, phone subject derivation, and CLM authentication. Never reuse a provider credential or paste generated values into shell arguments, tickets, screenshots, logs, or Git.

### One-time provider setup

1. **Apple/Google:** register bundle/package `com.veryloving.app`, verify the Google Web audience and iOS client, configure Android signing SHA-1 clients, align backend audience/presenter allowlists, and rebuild native iOS after callback-scheme changes.
2. **Mapbox:** create a least-privilege public `pk.*` mobile token and a separate `sk.*` `downloads:read` build token. Store only the latter as a local/EAS build secret.
3. **Hume:** obtain organization access, install the server-only key in the approved secret manager, approve quota/retention/prompt/tool/voice policy, deploy the authenticated CLM/WSS surfaces, then publish versioned config/tool/voice resources.
4. **Twilio/DynamoDB:** configure a Verify service with geo/fraud/rate policy; create the Dynamo table with string `PK`/`SK`, TTL on numeric `expiresAt`, encryption, PITR/backups, alarms, and least-privilege Query/Get/Put/Delete access.
5. **VL01:** obtain a versioned GATT document covering UUIDs, properties, encoding, events, commands, secure ownership/pairing, reset, and firmware compatibility.
6. **APNs/FCM:** provision environment-correct credentials through approved account/EAS workflows and deploy an authenticated token registration/rotation/revocation and delivery service before enabling safety pushes.
7. **EAS/store accounts:** grant the real organization/project roles; do not relink the app or replace its project ID merely to bypass access control.

### Continuous Native Generation and local native work

The `ios/` and `android/` directories are generated, ignored outputs. Change [`app.config.js`](./app.config.js) or [`plugins/`](./plugins), then prebuild again; do not commit edits made only inside generated projects.

```bash
npx expo prebuild --platform ios
npx expo run:ios --device "<simulator-or-device>"
```

Expo Go is a UI/foreground preview only. The simulator uses volatile/unavailable fallbacks for entitlement-sensitive storage and notifications and cannot close Apple/Google provider, Keychain, APNs, telephony, BLE, or audio-route gates.

### Robotics simulator runtime workflow

The simulator is a separate Node.js process. The Expo app does **not** and must not spawn it: mobile/TestFlight JavaScript cannot launch a process on the bench computer, and coupling Metro to the farm would make TestFlight and remote QA impossible.

For local Expo Go or a development client, use two terminals. The explicit
environment flag matters: the normal development environment keeps the real
BLE transport enabled.

```bash
# Terminal A — binds the simulator on all bench-machine interfaces
npm run robotics:sim

# Terminal B — Expo Go on the same LAN
EXPO_PUBLIC_ROBOTICS_MOCK_MODE=true npx expo start --lan

# Or, for an already-installed development client on the same LAN
EXPO_PUBLIC_ROBOTICS_MOCK_MODE=true npx expo start --dev-client --lan
```

Expo Go can exercise the pure JavaScript WebSocket scan/connect/discover/read/write/notification and 20-byte fragmentation paths. It does not validate native BLE permissions, background behavior, native Mapbox, production entitlements, or TestFlight lifecycle behavior. Install/rebuild a development client after native configuration changes with:

```bash
EXPO_PUBLIC_ROBOTICS_MOCK_MODE=true npx expo run:ios --device
```

That rebuild is not required for every Metro restart.

Connection choices:

- iOS Simulator on the same Mac: `ws://127.0.0.1:9090`.
- Physical phone on the same trusted Wi-Fi: `ws://<bench-machine-LAN-IP>:9090`.
- Remote physical phone: a reviewed, access-controlled `wss://` tunnel that forwards to port 9090.

The driver tries the saved QA override first, then the build-time URL, the Expo/Metro host on port 9090, Android emulator host `10.0.2.2`, and finally loopback. It does not scan arbitrary LAN address ranges. Blind subnet scans are slow, trigger local-network privacy prompts, and contact unrelated hosts. `.env.local` can change the default for a new Metro bundle, but an installed TestFlight app cannot read files on the bench machine.

Create the signed simulator artifact with `eas build --platform ios --profile testflight-robotics-sim`; that profile injects mock mode at build time. For the installed build, **do not run `npx expo start`**. Run only `npm run robotics:sim` (or the tunnel), open the installed app, double-tap the build version in Settings, and set the runtime WebSocket URL in Robotics Simulator Dashboard. The URL is validated, stored under `@veryloving/simulator_url`, applied without rebuilding, and contains no credentials.

Android runtime work requires JDK 17 and API 36 tooling:

```bash
npx expo prebuild --platform android
npx expo run:android
```

Validate local public configuration without printing values:

```bash
npm run validate-env
npm run validate-env -- --profile testflight
npm run validate-env -- --profile production
```

### EAS profiles

| Profile | Intended use | Language surface |
| --- | --- | --- |
| `development` | Registered physical-device development client | Development policy |
| `development-simulator` | iOS Simulator development client | Development policy |
| `preview` | Production-like internal stakeholder QA | Reviewed release locales |
| `testflight` | Primary signed iOS acceptance candidate | `en/es/fr/zh/ar/he` |
| `testflight-full-catalog` | Separate signed layout/coverage audit | All 155, with `QA` review indicators |
| `testflight-robotics-sim` | Signed virtual-robot bench QA with WebSocket mock transport | Base TestFlight locales |
| `production` | Store submission candidate after GO | Reviewed `en/es/fr/zh` |

The full-catalog profile is production-like for credentials, transport, entitlements, and validation, but it is not a translation-approval or public-release artifact.

EAS Update/OTA is not configured. No `expo-updates` runtime-version/channel/rollback policy is currently part of the release contract.

## 11. Deployment architecture and external services

### Recorded non-production evidence

As of the dated deployment audit:

- A protected Vercel preview proved the HTTP adapter builds, the catch-all health route works, and missing protected configuration fails closed.
- The Vercel adapter did not expose the repository's raw WebSocket route.
- An isolated Railway staging container proved Docker startup, public TLS/liveness, protected-route failure behavior, WebSocket upgrades, and one synthetic first-party authentication through to Hume `auth_ok`.
- AWS application infrastructure was not provisioned from this repository.
- The recorded EAS operator lacked access to the configured project.

These facts are staging/preview evidence only. Current provider state must be rechecked; operational IDs belong in the private release record and Git history, not this README.

### Environment promotion

| Environment | Permitted data/use | Exit gate |
| --- | --- | --- |
| Development | Test accounts, test numbers, synthetic contacts/location, non-production provider resources. | Deterministic gates plus signed development smoke. |
| Staging/Preview | Isolated provider resources and synthetic data only; no real user or unconsenting guardian data. | Security review, rollback rehearsal, provider/device matrix, observability, and evidence-dependent P1 passes. |
| Production | Production-only secrets/resources, stable domains, approved languages/markets, on-call and alerts. | Explicit GO, immutable commit/build/deployment IDs, compliance approval, staged rollout, and rollback owner. |

Never copy production user data back to development or staging.

### External service ownership

| Dependency | Required before production |
| --- | --- |
| EAS/App Store/Play | Organization access, signing roles, build-number ownership, TestFlight/Play groups, reviewer and rollback permissions. |
| Apple/Google identity | Registered bundle/package/signing clients, exact issuer/audience/presenter policy, provider-state and failure tests. |
| Twilio Verify | Environment-specific service, geo/fraud/rate policy, restricted credentials, distributed API abuse controls, real delivery evidence. |
| Mapbox | Least-privilege public runtime token, build download secret, production map behavior, monitoring, retention/disclosure review. |
| Hume | Organization access, server key, CLM bearer, approved config/tool/voice IDs, quota, retention, outage and rotation policy. |
| DynamoDB/AWS | Table with `PK`/`SK`, TTL on `expiresAt`, encryption, PITR/backups, alarms, least privilege, deletion/retention approval. |
| Railway/ECS-compatible voice host | TLS/WSS upgrades, path restrictions, limits, redacted logs, rollback, load and authentication/replay tests. |
| APNs/FCM | Credentials, authenticated token registry, rotation/revocation, opt-out, delivery/deduplication, tap-routing and invalid-token cleanup. |
| VL01 firmware/hardware | Approved GATT/security contract and representative physical devices. |
| Legal/Privacy/Localization | Vendor terms, store disclosures, emergency claims, safety-copy approval, markets, and public policy reconciliation. |

The repository has no Terraform/CDK/CloudFormation for AWS and no SES adapter. Railway is the documented staging container path; ECS/Fargate is an operator alternative, not a deployed fact.

## 12. TestFlight acceptance checklist

### Test record

- Tester:
- Date/time and timezone:
- Git commit SHA:
- App version and TestFlight build number:
- EAS language profile: `testflight` / `testflight-full-catalog`
- Backend deployment/version identifiers:
- Device model and iOS version:
- Install type: clean / upgrade from build:
- Network conditions:
- Evidence folder or ticket:

Do not mark a row PASS from Expo Go, a simulator, a JavaScript export, a development build, another profile, or another build number.

### Install and identify the candidate

- [ ] The EAS owner built the exact reviewed SHA with the intended profile.
- [ ] The exact archive was uploaded to App Store Connect and assigned to Grace's TestFlight group.
- [ ] QA recorded version, build number, profile, device, backend versions, and clean-install/upgrade state before testing.
- [ ] No profile result is reused for the other language surface.

### Priority language-switcher acceptance

| Check | Expected outcome | Actual outcome | Blocker/owner |
| --- | --- | --- | --- |
| Picker availability | Base TestFlight has 7 rows; full catalog has 156. Full-catalog review-required choices show `QA`. | _QA to fill_ | _QA to fill_ |
| Immediate update | Spanish, French, and Simplified Chinese update mounted app-owned UI immediately. | _QA to fill_ | _QA to fill_ |
| Selected state | The chosen row has a visible checkmark and VoiceOver announces it selected. | _QA to fill_ | _QA to fill_ |
| Cross-screen coverage | Home, Map, Settings, contacts, Saved Places, voice, history, privacy, SOS, and errors use the selected catalog. | _QA to fill_ | _QA to fill_ |
| Persistence | Selection survives force-quit, device reboot, and supported-build upgrade. | _QA to fill_ | _QA to fill_ |
| Arabic/Hebrew RTL | One bounded direction reload, correct mirroring, readable numbers, reminder migration, relaunch persistence, and no loop. | _QA to fill_ | _QA to fill_ |
| Return to LTR | English causes one bounded return reload and persists. | _QA to fill_ | _QA to fill_ |
| System default | With the in-app setting on System default, changing the iOS preferred app/device language selects an available profile catalog or honestly falls back to English. | _QA to fill_ | _QA to fill_ |
| Full-catalog search | German/`de`, Portuguese/`pt`, Russian/`ru`, and Urdu/`ur` search quickly and scroll remains responsive. | _QA to fill_ | _QA to fill_ |
| Full-catalog switching | Representative LTR/RTL choices update, persist, retain `QA`, and render their embedded critical copy without a missing-key or English-overlay diagnostic. | _QA to fill_ | _QA to fill_ |
| Linguistic review | Arabic/Hebrew and every intended public catalog have recorded native-speaker safety approval. | _QA to fill_ | _QA to fill_ |

For unsupported-language fallback, do not look for an unavailable row in the app picker. Leave VeryLoving on System default, set the iOS preferred language to the unavailable code or Traditional Chinese, terminate/relaunch, and verify explicit English fallback.

### Broader UI and safety matrix

| Area | Required test and expected outcome | Actual outcome | Blocker/owner |
| --- | --- | --- | --- |
| Auth and onboarding | Apple, Google, and SMS success/cancel/failure; protected routes; challenge/onboarding restoration; logout and two-account isolation. | _QA to fill_ | _QA to fill_ |
| Navigation/deep links | Every screen is reachable; Back/Close recovers; malformed, foreign, provider, auth-bypass, traversal, and high-risk modal URLs are rejected. | _QA to fill_ | _QA to fill_ |
| Settings/persistence | Language, voice/persona, reminder, contacts, Saved Places, history, navigation, and paired-device metadata survive only their intended lifecycle. | _QA to fill_ | _QA to fill_ |
| Error handling | Airplane mode, timeout, HTTP failure, malformed response, denial, and retry show actionable localized copy with no false success/raw error. | _QA to fill_ | _QA to fill_ |
| Map and safety | Live/cached/unavailable location is honest; Saved Places and share work; SOS never claims delivery without a receipt. | _QA to fill_ | _QA to fill_ |
| Privacy | Export is complete or explicitly partial; remote deletion failure is retryable; successful deletion clears local/remote scope and cannot resurrect cross-account data. | _QA to fill_ | _QA to fill_ |
| Permissions | Rationale, allow, deny, revoke, Settings recovery, and foreground recheck work for location, notifications, microphone, and Bluetooth; no camera/photo prompt appears. | _QA to fill_ | _QA to fill_ |
| Accessibility/layout | Compact/current iPhone and iPad split view; Dynamic Type, VoiceOver, keyboard, rotation, contrast, hit sizes, and light-only policy remain usable. | _QA to fill_ | _QA to fill_ |
| Voice/audio | Live Hume call, microphone, two-way audio, interruption, Bluetooth route, background/lock, reconnect, queue, offline fallback, and repeated cleanup. | _QA to fill_ | _QA to fill_ |
| VL01 | Permission, scan, pair/ownership, battery/status/events, authorized commands, disconnect/reconnect, backgrounding, reset, and account switch. | _QA to fill_ | _QA to fill_ |
| Performance/lifecycle | Repeated calls/pairing/map/history, network changes, lock/unlock, suspension, process death, and rapid navigation show no duplicates, leak, crash, or runaway commits. | _QA to fill_ | _QA to fill_ |
| Observability | TestFlight, device, backend, and provider logs contain no fatal/unhandled event, credential, message/audio text, phone number, or precise location. | _QA to fill_ | _QA to fill_ |

### Required evidence

- [ ] Spanish selected-state screenshot.
- [ ] Spanish Settings immediately after selection.
- [ ] Spanish after force-quit/relaunch.
- [ ] Arabic selected-state screenshot.
- [ ] Same representative screen in LTR and RTL.
- [ ] Short English → Arabic → relaunch → English recording.
- [ ] Full-catalog `QA` picker/trigger evidence for one additional LTR and RTL locale when applicable.
- [ ] Redacted logs for the same build/test window.
- [ ] Clean-install and previous-build upgrade results.
- [ ] Device/OS-labelled permission, audio, BLE, privacy, and lifecycle evidence.
- [ ] Native-speaker review records separate from structural coverage.

### TestFlight exit decision

- [ ] **UI FOUNDATION ACCEPTED FOR THIS TESTFLIGHT BUILD** — every applicable UI row passed and every external blocker has an explicit owner.
- [ ] **NO-GO / NEW BUILD REQUIRED** — a P0/P1 failure or unowned blocker remains.

Approvals:

- QA lead:
- Grace / release coordinator:
- Mobile owner:
- Localization owner:
- Security/Privacy/Safety owner:

This checklist is the canonical signed-device script. Build-specific results and evidence belong in the private release record.

## 13. Launch gates and ownership

Production remains NO-GO until every applicable row has a named person, due date, exact closure evidence, and approval.

| P1 gate | Current state | Required closure | Named owner/due date |
| --- | --- | --- | --- |
| Identity lifecycle | Access/refresh exchange exists; refresh tokens are stateless. | Durable hashed refresh families, reuse detection, revocation, tombstones, provider-state checks, uniform 401 recovery, abuse controls, and incident tests. | _Assign_ |
| Local PII | SecureStore protects sessions/contacts/Saved Places; other sensitive stores are plaintext. | Account-bound OS-protected encryption, explicit key accessibility/migration/rollback, account-switch/process-death and deletion evidence. | _Assign_ |
| Phone auth | Twilio Verify integration exists. | Production service/policy, restricted credentials, distributed throttles, real delivery/expiry/resend tests, and signed-device verification. | _Assign_ |
| Voice gateway | Authenticated WSS and PCM exist at source/staging layers. | Production TLS/ingress, single-use ticket or equivalent replay control, revocation, ownership binding, rate/load/backpressure, observability, rollback, and signed-provider/device audio. | _Assign_ |
| Native audio | PCM format and lifecycle are deterministic. | Physical iOS/Android route, interruption, latency, echo, Bluetooth, background, lock-screen, thermal/battery, and cleanup matrix. | _Assign_ |
| VL01 | Bounded GATT layer exists and fails closed. | Approved firmware schema, decoded events, authorized commands, ownership/secure pairing, hardware, background, reset/DFU and compatibility matrix. | _Assign_ |
| Safety delivery/maps | Contacts, safety state, SOS acceptance, and bounded map fallback exist. | Guardian/contact/push delivery with receipts and outbox/retry; routes/zones; revocable sharing; honest outage behavior. | _Assign_ |
| Privacy lifecycle | Local and Dynamo export/delete exist. | Session revocation/tombstone, vendor/log/backup orchestration, TTL/retention/IAM/encryption proof, support/breach policy, and audit. | _Assign_ |
| Notifications | Local reminder path exists. | APNs/FCM credentials, authenticated token lifecycle, delivery/deduplication/receipts, invalid-token cleanup, tap routing, outage tests. | _Assign_ |
| Localization | Four public locales reviewed; QA catalogs structurally complete. | Native-speaker review for every intended public safety-critical catalog and signed RTL/accessibility layout matrix. | _Assign_ |
| Signed device coverage | Source/simulator evidence exists. | Exact TestFlight build on small/current iPhone and iPad; signed Android emulator/device matrix; clean install and upgrade. | _Assign_ |
| Store/security/operations | Documentation and source controls exist. | Threat model, penetration/security review, privacy/legal reconciliation, dashboards, on-call, rollout/rollback rehearsal, store approval. | _Assign_ |

P2/product decisions that must remain honest:

- Friends is planned/empty until a real consented backend exists.
- Quick Share is a static native snapshot, not a revocable live link.
- Routes and danger/avoidance intelligence are not complete production features.
- Bundled offline conversation content remains primarily English.
- Dark mode, OTA updates, 3D/Spline, WebRTC, and standalone/local TTS are not implemented.

## 14. Operations, compliance, and release decision

### Release control

Create one private release record containing no secrets. Record:

- target version and immutable release SHA;
- iOS/Android build URLs and numbers;
- backend image/deployment and rollback identifiers;
- intended markets and approved languages;
- named release, on-call, incident, security, privacy, safety, localization, and device-QA owners;
- evidence links for every P1 row;
- rollout window, pause thresholds, and rollback owner.

### Required operational evidence

- Dashboards/alerts for auth, refresh, SMS, WebSocket connects/closes, CLM latency/errors, provider quota, push, SOS delivery, and crash-free sessions without logging PII.
- Runbooks for provider outage, bad release, credential rotation, compromised account/wearable, user-safety escalation, and privacy requests.
- Backward-compatible mobile/backend schema changes and rehearsed rollback to the previous mobile/backend version.
- Staged rollout thresholds and one accountable GO/NO-GO decision-maker.
- Support-visible app/backend versions and a redacted diagnostic collection path.

### Compliance and store review

- Reconcile the generated iOS privacy manifest, SDK manifests, public privacy policy, vendor contracts, App Store privacy answers, and Play Data Safety.
- Confirm screenshots and descriptions do not promise automatic emergency dispatch, real-time guardian delivery, hardware behavior, or localized safety support that has not passed.
- Record export compliance, legal/privacy/safety approval, native-speaker approval, reviewer notes, and market availability.

### Final decision record

- [ ] **GO** — every P1 gate is closed with objective evidence and all sign-offs are attached.
- [ ] **NO-GO** — release is paused with owner, due date, and next review recorded.

Current decision: **NO-GO**.

## 15. Founding engineer requirement mapping

| Job requirement | Repository evidence | Honest gap |
| --- | --- | --- |
| Swift 5.9+, SwiftUI, SwiftData | Expo CNG/native configuration and generated iOS boundary only. | No tracked application-authored Swift, SwiftUI, or SwiftData implementation. |
| WebSockets and real-time audio | Hume lifecycle, 48 kHz PCM, playback, interruption, tools, backpressure, reconnect, authenticated gateway. | Signed-device audio, production Hume/load, and native route evidence remain open. |
| React 19 | Expo/React Native application uses React 19. | Demonstrated. |
| Next.js 14+ and TypeScript | Substantive Node HTTP/WSS backend and Vercel adapter. | No Next.js App Router, TypeScript source, or typed full-stack contracts; Node adjacency is not equivalent proof. |
| AWS/Vercel | Vercel HTTP adapter and DynamoDB application repository; Railway/ECS-compatible container. | No SES, IaC, or provisioned production AWS/IAM/TTL/PITR/alarms evidence. |
| OAuth/JWT/security | Provider JWKS verification, Apple nonce, audience/issuer checks, scoped first-party access/refresh JWTs, SecureStore. | Durable refresh reuse detection/revocation, distributed abuse controls, and production security evidence remain open. |
| Hybrid data model | Account boundary, SecureStore, AsyncStorage resilience, Dynamo contacts/safety/privacy. | Several sensitive stores remain plaintext/local-only; vendor-wide lifecycle remains open. |
| BLE wearable | Scan, permissions, GATT, battery, events, commands, disconnect/reconnect, fail-closed capabilities. | Firmware semantics, secure ownership/pairing, and real hardware remain open. |
| 3D/Spline | None. | Good-to-have not evidenced. |
| Voice AI/TTS/WebRTC | Hume conversational generated speech, CLM/tools, mobile voice UI. | No standalone/local TTS or WebRTC. |

Fair assessment: **strong hands-on mobile, voice, security, BLE, and Node architecture evidence; material exact-stack gaps in SwiftUI/SwiftData and Next.js/TypeScript; production proof still gated by security, cloud, delivery, and physical-device work.**

Do not add decorative Swift, Next.js, TypeScript, SES, WebRTC, or Spline scaffolds solely to imply experience. Close a gap only with a meaningful, tested product artifact or separate verifiable work evidence. See [Founding engineer requirement mapping](#15-founding-engineer-requirement-mapping).

## 16. Validation and operator commands

### Source validation

```bash
npm run validate-env
npm run lint
npm test
git diff --check
npx expo-doctor
npx expo export --platform ios
npx expo export --platform android
```

The combined release-oriented source gate is:

```bash
npm run validate
```

Run the production configuration gate separately:

```bash
npm run validate-env -- --profile production
```

### Local backend

```bash
npm ci --prefix server
set -a
source server/.env
set +a
npm run clm:start
```

`server/.env` is ignored and must contain legitimate development credentials only when required by the operator. Never print or paste it.

### Container and cloud deployment boundary

Build and smoke-test the same long-lived Node image used by Railway or an ECS/Fargate-compatible host:

```bash
docker build -f server/Dockerfile -t veryloving-clm:<git-sha> .
docker run --env-file server/.env -p 8787:8787 veryloving-clm:<git-sha>
curl --fail http://localhost:8787/health
```

For Vercel, import `server/` as the project root. Its [`api/index.js`](./server/api/index.js) adapter and [`vercel.json`](./server/vercel.json) expose the ordinary HTTP routes only. Verify `/health`, then authenticated auth, phone, safety/privacy, and CLM behavior against the exact candidate. A healthy route is liveness evidence, not authentication or production-readiness evidence.

The raw `/api/voice/hume-ws` upgrade gateway must run on a reviewed long-lived container host. The committed [`railway.toml`](./railway.toml) selects the Dockerfile and health check, but operators must still configure environment-scoped secrets, TLS/domain, ingress restrictions, WebSocket limits, alerts, source/deployment identifiers, and rollback. Never point `EXPO_PUBLIC_HUME_WS_PROXY_URL` at the HTTP-only Vercel adapter.

Recommended split topology:

- Vercel: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL`, and the Hume CLM HTTPS callback.
- Railway/ECS-compatible container: only the authenticated `wss://<voice-host>/api/voice/hume-ws` gateway plus `/health`.
- Provider consoles/secret managers: every Hume, session, Twilio, AWS, and upstream-model secret.

### Development and signed builds

```bash
npx expo start --dev-client --lan
eas build --platform ios --profile development
eas build --platform all --profile preview
eas build --platform ios --profile testflight
eas build --platform ios --profile testflight-full-catalog
eas build --platform ios --profile production
eas build --platform android --profile production
```

Never create a production artifact immediately after a development build without closing the promotion gates.

### Hume provisioning

Run only from an audited operator environment where the approved secret manager has injected the server-only key:

```bash
npm run hume:provision
npm run hume:voice:generate
```

For a new configuration, inject `HUME_CLM_URL` ending in `/chat/completions` and any approved custom voice ID. For an update, also inject the existing `HUME_TOOL_ID` and `HUME_CONFIG_ID`; the provisioning script publishes a new version instead of silently creating unrelated duplicates. Copy returned public configuration/voice identifiers into the intended EAS environment only after review. Never expose `HUME_API_KEY` or `HUME_CLM_BEARER_TOKEN` to the mobile bundle.

The voice architecture, deployment boundaries, and safe commands in this README are the canonical operator contract; secrets remain in approved secret managers.

## 17. Recommended next actions

1. Create the private release/evidence record and assign a named owner and due date to every P1 row.
2. Add durable refresh-family reuse detection/revocation, deletion tombstones, uniform authenticated-request recovery, and distributed auth/SMS abuse controls.
3. Encrypt and migrate the remaining account-sensitive AsyncStorage data with a tested key, accessibility, backup, rollback, account-switch, and deletion policy.
4. Complete real guardian/push delivery, authenticated receipts, outbox/retry/dead-letter semantics, revocable sharing, and honest operational states.
5. Obtain the approved VL01 firmware/security contract and complete ownership, decoding, authorized commands, and physical hardware tests.
6. Finish isolated staging with production-like Apple/Google/Twilio/Mapbox/Hume/Dynamo/APNs/FCM resources, observability, threat-model approval, and rollback evidence.
7. Grant the authorized EAS owner access, validate the current production profile, and build the exact reviewed TestFlight SHA.
8. Run the priority language script, then the full UI, provider, privacy, safety, audio, BLE, accessibility, performance, clean-install, and upgrade matrices.
9. Obtain native-speaker safety approval for every intended public locale; keep full-catalog artifacts marked as QA until approved.
10. Re-run the full source/config/security/dependency gates, reconcile store/privacy disclosures, record GO/NO-GO, and use a monitored staged rollout only after every P1 closes.

## 18. Consolidation map

This README is the sole Markdown handoff. The former root documents below were merged into the indicated sections and removed after consolidation. Their pre-consolidation text remains available through Git history, while current status and procedures must be maintained here.

| Former document | Content now maintained in README |
| --- | --- |
| `VERYLOVING_COMPLETE_HANDOFF.md` | Entire consolidated README. |
| `LAUNCH_CHECKLIST.md` | [Launch gates and ownership](#13-launch-gates-and-ownership) and [release decision](#14-operations-compliance-and-release-decision). |
| `TESTFLIGHT_UI_CHECKLIST.md` | [TestFlight acceptance checklist](#12-testflight-acceptance-checklist). |
| `TESTFLIGHT_LANGUAGE_SWITCHER.md` | Priority language matrix in [TestFlight acceptance](#12-testflight-acceptance-checklist). |
| `TESTFLIGHT_READINESS_REPORT.md` | [Executive status](#2-executive-status). |
| `GLOBALIZATION.md` | [Globalization and language strategy](#6-globalization-and-language-strategy). |
| `UI_FRAMEWORK_AUDIT.md` | [UI framework and application state](#5-ui-framework-and-application-state). |
| `FOUNDING_ENGINEER_AUDIT.md` | [Founding engineer requirement mapping](#15-founding-engineer-requirement-mapping). |
| `COMPREHENSIVE_FINAL_AUDIT.md` | [Executive status](#2-executive-status), architecture, and launch gates. |
| `FINAL_VALIDATION_REPORT.md` | [Evidence rules](#1-document-authority-and-evidence-rules), status, and TestFlight matrix. |
| `STABILITY_REPORT.md` | Reconciled history in [evidence rules](#1-document-authority-and-evidence-rules) and current feature status. |
| `PRIVACY.md` | [Security, data, and privacy](#7-security-data-and-privacy). |
| `HUME_CUSTOMIZATION.md` | [Voice AI and Hume](#8-voice-ai-and-hume), deployment, and operator commands. |
| `DEPLOYMENT_PLAN.md` | [Deployment architecture](#11-deployment-architecture-and-external-services), ownership, operations, and next actions. |
| `SETUP.md` | [Environment setup and build profiles](#10-environment-setup-and-build-profiles) and validation commands. |

## 19. Reference links

### Primary code evidence

- Navigation/providers: [`app/_layout.js`](./app/_layout.js), [`AuthContext.js`](./src/context/AuthContext.js), [`AppContext.js`](./src/context/AppContext.js), [`I18nContext.js`](./src/context/I18nContext.js)
- Localization: [`LanguageSelector.js`](./src/components/LanguageSelector.js), [`core.js`](./src/i18n/core.js), [`language-registry.js`](./src/i18n/language-registry.js), [`translation-review.json`](./src/i18n/translation-review.json)
- Security/storage: [`auth-session.js`](./src/services/auth-session.js), [`secure-storage.js`](./src/services/secure-storage.js), [`account-data-boundary.js`](./src/services/account-data-boundary.js), [`privacy.js`](./src/services/privacy.js)
- Voice: [`hume-evi.js`](./src/services/websocket/hume-evi.js), [`audio.js`](./src/services/audio.js), [`useHumeVoiceCall.js`](./src/hooks/useHumeVoiceCall.js), [`voice-gateway.cjs`](./server/voice-gateway.cjs)
- Backend: [`clm-server.cjs`](./server/clm-server.cjs), [`auth-session.cjs`](./server/auth-session.cjs), [`safety-api.cjs`](./server/safety-api.cjs), [`server/api/index.js`](./server/api/index.js)
- BLE: [`ble.js`](./src/services/ble.js), [`vl01-protocol.js`](./src/services/vl01-protocol.js)
- Native/build: [`app.config.js`](./app.config.js), [`eas.json`](./eas.json), [`plugins/`](./plugins), [`server/Dockerfile`](./server/Dockerfile), [`railway.toml`](./railway.toml)

### Official provider and platform references

- Hume: [portal](https://app.hume.ai/), [developer portal](https://app.hume.ai/developers), [API key guide](https://dev.hume.ai/docs/introduction/api-key), [EVI configuration guide](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/build-a-configuration)
- Google: [OAuth clients](https://console.cloud.google.com/auth/clients), [credential guide](https://developers.google.com/workspace/guides/create-credentials), [native-app OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app)
- Mapbox: [access tokens](https://console.mapbox.com/account/access-tokens/), [token management](https://docs.mapbox.com/accounts/guides/tokens/)
- Twilio: [Verify documentation](https://www.twilio.com/docs/verify)
- Expo: [EAS environment variables](https://docs.expo.dev/eas/environment-variables/manage/)
- Vercel: [create/import project](https://vercel.com/new), [environment variables](https://vercel.com/docs/environment-variables), [WebSocket support boundary](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)
- AWS DynamoDB: [table setup](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html), [TTL setup](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-how-to.html)
- AWS containers: [ECS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html), [App Runner service creation](https://docs.aws.amazon.com/apprunner/latest/dg/manage-create.html), [App Runner runtime](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html), [App Runner secret references](https://docs.aws.amazon.com/apprunner/latest/dg/env-variable.html)

---

This README is the canonical sanitized handoff, not a substitute for the private release ticket. If a statement conflicts with the current implementation or a later signed-build result, update this README and the release record together.
