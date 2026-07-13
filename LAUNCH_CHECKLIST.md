# VeryLoving Launch Checklist

This is the release decision record for signed iOS and Android builds. It complements [STABILITY_REPORT.md](./STABILITY_REPORT.md), which contains the July 2026 runtime audit and evidence.

VeryLoving is **not production-ready while any P1 stop-ship item below remains open**. A successful JavaScript export, EAS build, or `/health` response does not waive a safety, security, backend, hardware, or physical-device gate.

Expo Go is limited to UI and foreground-flow previews. VeryLoving skips its notification integration there—including local scheduling—to avoid SDK 57's entitlement-dependent push-registration Keychain read. Notifications, Google Sign-In, production Apple identity exchange, Mapbox, BLE, and background audio require development or signed builds. Apple Authentication can open in Expo Go, but its Expo Go-scoped identity is not production validation. SecureStore remains primary in every runtime; only an actual Expo Go failure activates volatile process-memory fallback. Development and signed builds fail closed instead of downgrading secure storage. Expo Go evidence cannot close any native launch gate.

## Release Candidate

- [ ] Release owner:
- [ ] Incident/on-call owner:
- [ ] Target app version:
- [ ] Git commit SHA:
- [ ] iOS EAS build URL and build number:
- [ ] Android EAS build URL and version code:
- [ ] Backend deployment/version identifiers:
- [ ] Test evidence folder or ticket:
- [ ] Planned release and rollback window:

## Launch External Ownership Matrix

Grace is the release coordinator: every external gate needs a named individual and due date in her release ticket. Team labels below are the minimum accountable functions, not substitutes for a named owner.

| External item | What is needed | Responsible | How to test |
| --- | --- | --- | --- |
| Hume credentials and EVI configuration | Production Hume account, server-only API key, CLM bearer, published tool/config IDs, branded voice ID, quotas, and retention approval. | Voice platform owner + Security | Provision a new and updated config; verify authenticated CLM SSE, tool correlation, control-plane `204`, quota/error handling, and redacted logs. |
| Hume WebSocket production deployment | The in-repository first-frame authenticated `wss` gateway deployed behind TLS with token revocation/replay controls, rate limits, upgrade/idle-timeout policy, ownership-bound resume, quotas, and log redaction. | Backend/API owner + Security | Connect with valid, expired, replayed, wrong-audience, and revoked sessions; inspect proxy/ingress/tracing logs; run reconnect, backpressure, and load tests. |
| Native Hume PCM validation | The implemented `expo-audio` 48 kHz mono Int16 stream proven to emit continuous frames and release audio resources correctly. | iOS/Android audio owner | Physical iOS/Android tests for two-way audio, frame timing, interruption, echo, Bluetooth routing, background/foreground, lock screen, and repeated start/stop. |
| Production auth and SMS | Deploy the implemented Apple/Google verification and access/rotating-refresh renewal; add refresh-family persistence/reuse detection/revocation, uniform 401 recovery, phone challenge/verify, abuse controls, and delivery receipts. | Identity/backend owner + SMS vendor owner | Apple, Google, and phone tests for success, cancel, expiry, old-refresh reuse, resend, throttling, revocation, 401 recovery, logout, deletion, and account switching. |
| Physical iOS and VL01 | Signed iOS build, approved VL01 UUID/schema, battery semantics, decoded status/events, authorized command schemas, ownership/secure pairing, and background policy. | iOS owner + BLE/firmware owner + Device QA | Exercise the implemented timed GATT discovery/read/write, conditional battery monitor, raw status/event channels, serialized reconnect, plus Bluetooth off/on, battery changes, foreground/background, wearable reset, and two-account ownership. |
| Android runtime | API 36 emulator plus signed physical-device coverage, release credentials, permission and background behavior. | Android owner + Mobile QA | Exercise auth, notification, microphone, location, telephony, BLE, voice, deep links, Back navigation, backgrounding, process death, and Play internal build upgrade. |
| APNs and FCM | Production push credentials, token registration/rotation/revocation, authenticated delivery service, payload contract, observability, and user consent handling. | Mobile platform owner + Backend/notifications owner | Signed iOS/Android tests for first registration, token refresh, opt-out, foreground/background/terminated delivery, tap routing, invalid token cleanup, outage, and duplicate suppression. |
| Mapbox, safety delivery, and data lifecycle | Deploy the implemented account-bound contact migration/synchronization, idempotent Dynamo safety state, and Dynamo export/deletion; add notification delivery/receipts, routes/avoidance, revocable live sharing, deletion tombstones/session revocation/vendor orchestration, retention, and failure semantics. | Maps/backend owner + Safety product owner | Online/offline and account-switch tests; expired share link; permission denial; stale location; backend timeout; durable duplicate SOS/session retry; delivery receipt and deletion audit; no false activation copy. |
| App Store and Play submission | Store accounts/roles, signing, privacy/data-safety answers, screenshots/copy, export compliance, reviewer notes, staged rollout, monitoring, and rollback approval. | Grace (release coordinator) + Legal/Privacy + Product | Upload production archives to TestFlight/Play internal, pass automated checks, complete reviewer flows on clean accounts, reconcile disclosures, and rehearse staged rollout pause/rollback. |

## P1 Stop-Ship Gates

| Gate | Current state | Evidence required to close |
| --- | --- | --- |
| Backend-issued application sessions | Partial — provider exchange plus access/refresh JWT renewal implemented, not production-validated | Deploy exact allowlists/signing keys; add refresh-family persistence, reuse detection/revocation, deletion tombstones, provider credential-state checks, uniform 401 recovery, and signed-provider evidence. |
| Per-account encrypted PII storage | Partial — contact cache moved to account-bound SecureStore; wearable metadata account-bound | Encrypt/account-bind settings, transcripts, locations, queues, and remaining resilience records; versioned migration and account-mismatch/process-death tests. |
| Production SMS | Open | Signed challenge/verify API, abuse controls, provider delivery receipts, expiry/retry tests, and real-device verification. |
| Hume voice proxy | Partial — first-frame authenticated gateway implemented, not deployed | Production TLS/upgrade evidence, rate limits, revocation/replay resistance or a single-use ticket, ownership-bound resume/configuration, redacted logs, load and end-to-end tests. |
| Native PCM capture | Partial — 48 kHz mono Int16 code path and deterministic tests implemented | Physical iOS/Android evidence for continuous streaming, playback, interruption/echo/Bluetooth/background/lock-screen behavior and cleanup. |
| VL01 GATT | Partial — normalized UUIDs, timed discovery/read/write, battery read/conditional monitor, raw status/events, disconnect handling, and serialized backoff implemented | Approved UUID/schema and battery encoding; decoded status/events, authorized commands, secure pairing/ownership, and physical-wearable tests. |
| Safety/map backend | Partial — account-bound contacts, current-state/idempotent sessions, durable retry-safe SOS acceptance, Dynamo export/deletion, and local migration serialization implemented | Real guardian/contact delivery and receipts, push, live sharing, routes, avoidance zones, deletion tombstones/session revocation/vendor orchestration, and production failure semantics. |
| Android runtime matrix | Open | Full API 36 emulator plus physical-device results with a signed, production-like build. |
| Signed physical-device matrix | Open | iOS and Android results for auth, telephony, notifications, audio routing, backgrounding, lock screen, location, BLE, and privacy flows. |

## Source And Deterministic Quality Gates

- [ ] Working tree contains only reviewed release changes.
- [ ] `npm ci` succeeds from a clean checkout using the release Node version.
- [ ] `npm test` passes with no skipped or focused tests.
- [ ] `npm run lint` passes.
- [ ] `git diff --check` passes.
- [ ] Generated `ios/` and `android/` projects are absent before Doctor runs.
- [ ] `npx expo-doctor` reports 20/20.
- [ ] `npx expo export --platform ios` succeeds.
- [ ] `npx expo export --platform android` succeeds.
- [ ] Dependency and secret scans have no unaccepted critical findings.
- [ ] Native evidence identifies the development, preview, TestFlight, or Play internal build used; Expo Go screenshots or logs are preview evidence only.
- [ ] The release commit and dependency lockfile are archived with the evidence.

## Build Configuration And EAS

### Mobile And Native-Build Environment

| Variable | Description / production value | Visibility | Source / owner |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | HTTPS root of the production VeryLoving API gateway. | Public; bundled | Deployed API domain — Backend/API owner; set by Release Engineering. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | OAuth web client ID used to mint Google identity tokens for backend exchange. | Public; bundled | Google Cloud OAuth configuration — Identity owner. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Native iOS OAuth client ID used for the callback URL scheme. | Public; bundled | Google Cloud iOS OAuth configuration — Identity owner. |
| `EXPO_PUBLIC_HUME_WS_PROXY_URL` | Production `wss` endpoint for the in-repository `/api/voice/hume-ws` gateway; no credentials in the URL. | Public endpoint; bundled | Voice gateway deployment — Voice backend owner. |
| `EXPO_PUBLIC_HUME_CONFIG_ID` | Published Hume EVI config ID; required when custom CLM is enabled. | Public identifier; bundled | Hume provisioning output — Voice platform owner. |
| `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` | HTTPS root serving authenticated safety-tips and session-configure endpoints. | Public endpoint; bundled | CLM/API gateway deployment — Backend/API owner. |
| `EXPO_PUBLIC_HUME_CLM_ENABLED` | `true` only after the CLM/control-plane contract passes production tests; otherwise `false`. | Public flag; bundled | Release decision — Voice platform owner + Release manager. |
| `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` | Approved Hume custom voice ID, or empty to use configured/default voice behavior. | Public identifier; bundled | Hume voice provisioning — Voice/brand owner. |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Least-privilege public `pk.` runtime token restricted as Mapbox supports. Never use `sk.`. | Public; bundled | Mapbox account — Maps owner. |
| `EXPO_PUBLIC_ENABLE_OFFLINE_MODE` | Normally `false`; `true` forces bundled offline companion behavior. | Public flag; bundled | Release configuration — Mobile owner. |
| `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED` | Must be `true` for production contacts, safety-session persistence, and durable SOS acceptance. | Public flag; bundled | Backend readiness decision — Safety/backend owner. |
| `EXPO_PUBLIC_ENABLE_MOCK_PHONE_AUTH` | Must be `false` in production. | Public flag; bundled | Release configuration — Identity owner. |
| `EXPO_PUBLIC_HUME_API_KEY` | Must be absent in production; direct API keys are development-only and rejected by release code. | Prohibited | Hume account — Security/Voice owner verifies absence. |
| `EXPO_PUBLIC_VL01_ENABLED` | Enables the approved real-device VL01 protocol. | Public flag; bundled | BLE/firmware release approval. |
| `EXPO_PUBLIC_VL01_SERVICE_UUID` | Approved primary service UUID used for filtered scanning/GATT discovery. | Public protocol metadata; bundled | Firmware specification — BLE owner. |
| `EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID` | Approved one-byte battery characteristic. | Public protocol metadata; bundled | Firmware specification — BLE owner. |
| `EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID` | Status channel; properties are validated and raw values surfaced, but firmware decoding is not implemented. Required by production diagnostics. | Public protocol metadata; bundled | Firmware specification — BLE owner. |
| `EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID` | Event channel; properties are validated and raw notifications surfaced, but event semantics/actions are not implemented. Required by production diagnostics. | Public protocol metadata; bundled | Firmware specification — BLE owner. |
| `EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID` | Command channel; a bounded raw write exists, but schemas/authorization require approval. Required by production diagnostics. | Public protocol metadata; bundled | Firmware specification — BLE/Security owner. |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | Native dependency download credential where required by the iOS/native build. Never copied into `extra`. | EAS secret/build-only | Mapbox secret token — Maps owner; stored by Release Engineering. |
| `VERYLOVING_BUILD_PROFILE` | `development`, `preview`, or `production`; committed by profile in `eas.json`. | Non-secret build metadata | Mobile/Release Engineering. |
| `VERYLOVING_CONFIG_DIAGNOSTICS` | `1` in EAS profiles to emit redacted booleans and issue codes. | Non-secret build metadata | Mobile/Release Engineering. |
| `EAS_BUILD_PROFILE` | EAS-supplied profile name used only as a diagnostic fallback when `VERYLOVING_BUILD_PROFILE` is absent. Do not set it manually. | Platform build metadata | Expo EAS — consumed by Mobile/Release Engineering. |
| `EAS_BUILD` | EAS-supplied remote-build marker; makes diagnostics require the build-only Mapbox download token. Do not set it manually. | Platform build metadata | Expo EAS — consumed by Mobile/Release Engineering. |
| `NODE_ENV` | Tooling-supplied JavaScript mode. Production bundles normally set `production`; it is not a substitute for an EAS build profile. | Platform build metadata | Expo/Metro — consumed by Mobile Engineering. |

### Node CLM Runtime Environment

| Variable | Description / production value | Visibility | Source / owner |
| --- | --- | --- | --- |
| `NODE_ENV` | Must be `production`; disables development-token authentication. | Plain server config | Hosting platform — Backend/DevOps owner. |
| `PORT` | HTTP and WebSocket listener port injected by Railway/App Runner or set to `8787` for the container. Do not override App Runner's reserved `PORT`. | Plain platform config | Hosting platform — DevOps owner. |
| `HUME_API_KEY` | Hume server credential used by the voice gateway and control-plane requests. | Server secret | Hume account — Voice platform owner. |
| `HUME_CONFIG_ID` | Server-enforced EVI configuration ID; rejects conflicting client choices. | Plain identifier | Approved Hume config — Voice platform owner. |
| `HUME_ALLOWED_VOICE_IDS` | Comma-separated allowlist of approved client-selectable voices; required by production startup validation. | Plain identifiers | Voice approval — Voice platform/brand owner. |
| `HUME_ALLOW_CLIENT_RESUME` | Keep `false` until chat-group ownership is enforced. | Plain security flag | Security + Voice backend owner. |
| `HUME_CLM_BEARER_TOKEN` | At least 32 random bytes shared only with the Hume CLM configuration. | Server secret | Generated in secret manager — Security/Voice backend owner. |
| `APP_AUTH_VERIFY_URL` | Optional external verifier fallback for HTTP endpoints; built-in session JWT verification runs first. | Plain endpoint config | Identity/backend owner. |
| `DEV_APP_TOKEN` | Must be absent in production. | Prohibited | Backend/DevOps verifies absence. |
| `AUTH_EXCHANGE_ENABLED` | Must be `true` to enable Apple/Google exchange. | Plain feature flag | Identity/backend owner. |
| `SESSION_JWT_SECRET` | Independent secret of at least 32 characters used for HS256 session signing/verification. | Server secret | Generated/rotated in secret manager — Security owner. |
| `SESSION_JWT_ISSUER` | Exact issuer; defaults to `https://api.veryloving.ai`. | Plain security config | Identity/backend owner. |
| `SESSION_JWT_AUDIENCE` | Exact mobile audience; defaults to `veryloving-mobile`. | Plain security config | Identity/backend owner. |
| `SESSION_JWT_TTL_SECONDS` | Access-token lifetime; defaults to 3600 seconds and is bounded to 300–86400. | Plain security config | Security/Identity owner. |
| `SESSION_REFRESH_TTL_SECONDS` | Refresh-token lifetime; defaults to 30 days and is bounded to 1–90 days. | Plain security config | Security/Identity owner. |
| `APPLE_CLIENT_IDS` | Comma-separated accepted Apple identity-token audiences. | Plain public identifiers | Apple developer configuration — Identity owner. |
| `GOOGLE_CLIENT_IDS` | Comma-separated accepted Google audiences/authorized parties. | Plain public identifiers | Google Cloud OAuth configuration — Identity owner. |
| `SAFETY_API_ENABLED` | Must be `true` to enable contacts, SOS acceptance, and safety sessions. | Plain feature flag | Safety/backend owner. |
| `SAFETY_TABLE_NAME` | DynamoDB table with string `PK` and `SK` keys. | Plain resource name | AWS deployment — Backend/DevOps owner. |
| `SAFETY_RETENTION_DAYS` | Positive retention horizon used for DynamoDB expiry metadata; production value requires Privacy approval. | Plain policy config | Privacy/Safety/backend owners. |
| `AWS_REGION` | Region for the safety-table DynamoDB client. | Plain platform config | AWS deployment — Backend/DevOps owner. |
| `CLM_UPSTREAM_URL` | Optional OpenAI-compatible HTTPS completion endpoint; set with key and model as a group. | Plain endpoint config | Approved model provider — AI/backend owner. |
| `CLM_UPSTREAM_API_KEY` | Optional upstream provider credential. | Server secret | Model provider secret — AI/backend owner. |
| `CLM_UPSTREAM_MODEL` | Optional approved upstream model identifier. | Plain server config | Model deployment — AI/safety owner. |
| `CLM_UPSTREAM_TIMEOUT_MS` | Positive timeout; defaults to `25000`. | Plain server config | Backend/SRE owner. |

### Hume Provisioning Operator Environment

These values are used by the provisioning/voice-design commands, not bundled into the app. Run them from an audited operator environment; only the CLM runtime's `HUME_API_KEY` is also a long-lived server variable.

| Variable | Description / production value | Visibility | Source / owner |
| --- | --- | --- | --- |
| `HUME_API_KEY` | Hume management credential used by provisioning and voice-design commands. | Operator/server secret | Hume account — Voice platform owner. |
| `HUME_CLM_URL` | Public HTTPS CLM URL ending in `/chat/completions`. | Public deployment endpoint | Deployed CLM service — Voice backend owner. |
| `HUME_TOOL_ID` | Existing Hume tool ID when publishing a new version; omit for initial creation. | Operator identifier | Prior provisioning output — Voice platform owner. |
| `HUME_CONFIG_ID` | Existing Hume EVI config ID when publishing a new version; omit for initial creation. | Operator identifier | Prior provisioning output — Voice platform owner. |
| `HUME_CUSTOM_VOICE_ID` | Approved saved custom voice ID. Takes precedence over `HUME_VOICE_NAME`. | Operator identifier | Hume voice-design output — Voice/brand owner. |
| `HUME_VOICE_NAME` | Approved stock Hume voice name when no custom voice ID is used; defaults to `Serene Assistant`. | Operator configuration | Voice/brand approval — Voice platform owner. |

- [ ] EAS project owner, project ID, bundle ID, and Android package match the intended store applications.
- [ ] `eas env:list --environment production --scope project` shows the expected production variable names without copying values into the release record.
- [ ] Every `EXPO_PUBLIC_` value is safe to expose in the binary; no Hume, Mapbox download, provider, signing, or backend secret uses that prefix.
- [ ] `EXPO_PUBLIC_API_BASE_URL` points to the production HTTPS API gateway.
- [ ] `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is the production OAuth web client ID.
- [ ] `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` is the production iOS OAuth client ID and generated callback scheme is verified.
- [ ] `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` is a public runtime token, not an `sk.` token.
- [ ] `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` is available to the remote native builder and is not bundled into app `extra` values.
- [ ] `EXPO_PUBLIC_HUME_WS_PROXY_URL` points to the deployed `/api/voice/hume-ws` gateway and contains no token or credential query.
- [ ] `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL`, config ID, and branded voice ID match the deployed Hume account.
- [ ] `EXPO_PUBLIC_HUME_CLM_ENABLED=true` only after the control-plane and authenticated tool endpoints pass production checks.
- [ ] `EXPO_PUBLIC_ENABLE_MOCK_PHONE_AUTH=false` and `EXPO_PUBLIC_ENABLE_OFFLINE_MODE=false` unless an approved release decision says otherwise.
- [ ] `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED=true`; server exchange/safety flags and protected endpoint probes pass.
- [ ] Production has CLM and VL01 enabled; all service/battery/status/event/command UUIDs are firmware-approved and their schemas, authorization, and user-facing behavior are reviewed.
- [ ] `EXPO_PUBLIC_HUME_API_KEY` is absent from production.

Run the redacted config diagnostic against a locally pulled production environment:

```bash
VERYLOVING_BUILD_PROFILE=production \
VERYLOVING_CONFIG_DIAGNOSTICS=1 \
npx expo config --type public
```

- [ ] `missingRequired` and `invalid` are empty.
- [ ] Every warning is understood and approved. The local Mapbox download-token warning is expected when an EAS secret is not readable locally; confirm the token on the remote build log without printing it.
- [ ] Remote EAS build logs contain the redacted `[VeryLoving config]` record and no secret values.
- [ ] Remote build-number state is initialized once with `eas build:version:set` if this EAS project has not used remote versioning before.

Build profiles:

```bash
eas build --platform ios --profile development-simulator
eas build --platform ios --profile development
eas build --platform all --profile preview
eas build --platform ios --profile production
eas build --platform android --profile production
```

- [ ] `development` is installed on registered physical devices; `development-simulator` is used only for the iOS simulator.
- [ ] `preview` produces an internally installable Android APK and iOS ad hoc build.
- [ ] `production` produces an App Store archive and Play Store AAB with auto-incremented remote build versions.
- [ ] Store submission remains a separate, explicitly approved action.

## Backend Deployment

The deployable backend is the Node HTTP/WebSocket service in `server/`. It implements Apple/Google exchange, access/refresh JWT renewal, the authenticated Hume gateway, CLM/control-plane endpoints, and DynamoDB safety/privacy endpoints. It is not a Next.js/Vercel or SES application, does not provision AWS infrastructure, and does not implement refresh-family revocation/reuse detection, SMS, push or guardian delivery, delivery receipts, complete map routes/sharing, deletion tombstones, or vendor privacy orchestration.

- [ ] `npm ci --prefix server` succeeds and `server/package-lock.json` is archived with the release.
- [ ] Deploy `server/Dockerfile` with `NODE_ENV=production`, platform-managed `PORT`, and HTTP plus WebSocket upgrade routing.
- [ ] Configure independent `HUME_API_KEY`, `HUME_CLM_BEARER_TOKEN`, and `SESSION_JWT_SECRET` server secrets; `DEV_APP_TOKEN` is absent.
- [ ] Set `AUTH_EXCHANGE_ENABLED=true`, exact provider allowlists, issuer/audience/access+refresh TTLs, `SAFETY_API_ENABLED=true`, safety table/region/retention, and approved Hume config/voice policy. Keep client resume disabled until ownership enforcement exists.
- [ ] Provision the DynamoDB table with string `PK`/`SK`, TTL on numeric `expiresAt`, encryption, point-in-time recovery/backups, alarms, approved retention/deletion, and least-privilege Query/Get/Put/Delete task permissions.
- [ ] Configure all three upstream model values together, or leave all three unset to use deterministic local responses.
- [ ] TLS certificates, HTTP body and WebSocket frame/connection limits, upgrade forwarding, idle timeouts, endpoint-specific rate limits, and log redaction are verified at the ingress/service boundary.
- [ ] Backend logs contain no message text, raw session IDs, provider tokens, Hume tokens, query credentials, or precise location.

Liveness check:

```bash
curl --fail --silent --show-error https://<clm-domain>/health
```

- [ ] Response is exactly a successful CLM liveness result. This endpoint does not prove Hume credentials, app authentication, or upstream readiness.
- [ ] `POST /chat/completions` rejects a missing/incorrect CLM bearer and streams a valid authenticated response.
- [ ] `POST /v1/auth/exchange` accepts valid Apple/Google assertions and rejects invalid signature, issuer, audience/authorized party, expiry, nonce, and provider-key outage cases.
- [ ] `POST /v1/auth/refresh` rotates the client-held token and rejects malformed/expired/wrong-audience tokens; production refresh-family reuse detection/revocation is independently proven.
- [ ] `GET`/`POST`/`DELETE /v1/emergency-contacts`, `POST /v1/sos-events`, and `POST /v1/safety-sessions` reject invalid sessions and pass account-isolation/idempotency/failure tests against the production table.
- [ ] `GET /v1/privacy/export` returns only the authenticated account's Dynamo records and `DELETE /v1/privacy/data` deletes them; session revocation/tombstone and backup/vendor deletion evidence is tracked separately.
- [ ] `/api/voice/hume-ws` rejects absent/invalid/expired/wrong-scope first frames, never accepts a bearer query, enforces config/voice policy and backpressure, and passes production Hume tests.
- [ ] `POST /v1/safety/tips` rejects missing/expired app authentication and returns the expected schema for a valid app session.
- [ ] `POST /v1/hume/session/configure` rejects invalid auth/chat IDs and returns `204` only after the Hume control-plane request succeeds.
- [ ] Production refresh-family state/SMS, push/guardian delivery, and map/share services pass their own health, security, load, and rollback checks.
- [ ] The ingress routes HTTP API/CLM traffic and WebSocket voice upgrades to the correct server paths.

## Core Runtime Matrix

Test first install, upgrade, relaunch, foreground/background, airplane mode, denied permissions, expired credentials, and service timeouts.

### Authentication And Privacy

- [ ] Apple Sign-In succeeds, cancels safely, and handles revoked credential state.
- [ ] Google Sign-In succeeds, cancels safely, and handles expired/revoked sessions.
- [ ] Phone challenge, six-digit verification, resend, expiry, throttling, and logout work against production SMS.
- [ ] Incomplete onboarding resumes at the first permission step; completed onboarding is account-bound.
- [ ] Deep links cannot bypass authentication or onboarding.
- [ ] Session refresh succeeds; failed refresh clears secure/local state and returns to auth without a loop.
- [ ] Switching accounts cannot expose the prior account's contacts, settings, queue, or transcript history.
- [ ] JSON export opens the native share sheet and removes its temporary file.
- [ ] Local and DynamoDB deletion complete, are auditable, revoke the session/create a deletion tombstone, and cannot be repopulated by an in-flight or still-authenticated writer; applicable vendor copies are handled.

### Safety, Map, And Emergency

- [ ] Home, Guardian, and Emergency state transitions persist through the production backend.
- [ ] Map tiles, user location, danger/avoidance zones, routes, and retry states work with production Mapbox configuration.
- [ ] Quick Share sends a revocable live link with explicit recipients and expiry.
- [ ] SOS never claims activation until the defined external delivery acknowledgement occurs.
- [ ] Dialer fallback, missing contacts, cancellation, no-telephony devices, and backend outages have honest user-facing states.
- [ ] Remote push registration, refresh, revocation, delivery, and tap routing work in signed builds.

### Voice And BLE

- [ ] New and resumed Hume calls connect through the production proxy without long-lived bearer credentials in URLs or logs.
- [ ] CLM setup, tool calls, assistant audio ordering, interruption, reconnect caps, and terminal-close behavior pass.
- [ ] Native PCM capture sends the declared format continuously and releases microphone/audio resources on every exit.
- [ ] Offline fallback and queued typed messages are clearly labeled and replay exactly once after reconnect.
- [ ] Voice artifacts, transcript history, and offline queues obey export/deletion/retention policy.
- [ ] VL01 scan, pair, ownership, battery, disconnect, reconnect, foreground/background, Bluetooth-off, and low-battery states pass with physical hardware.

### Global UI

- [ ] Emergency, consent, permission, privacy, and auth copy has native-speaker approval for every launch language.
- [ ] RTL, dynamic type, screen reader, keyboard, rotation policy, small devices, and tablets pass the supported-device matrix.
- [ ] No missing keys, placeholder text, overlap, invisible controls, or untranslated provider/system error reaches the release build.

## Security, Privacy, And Store Compliance

- [ ] Threat model covers auth exchange, WebSocket tickets, CLM/tool calls, local PII, BLE ownership, live location, SOS, and account deletion.
- [ ] Server-side JWT verification checks signature, issuer, audience, nonce where applicable, expiry, revocation, and replay protection.
- [ ] Access/refresh tokens use documented rotation, secure storage, revocation, and breach response.
- [ ] Privacy policy, in-app disclosures, App Store privacy answers, Play Data Safety, and the iOS privacy manifest match actual production behavior and vendors.
- [ ] Hume, Mapbox, SMS, push, hosting, and upstream-model retention/deletion terms are approved.
- [ ] Export/deletion requests cover both local and server/vendor data where required.
- [ ] Store screenshots and descriptions do not promise automatic emergency dispatch or hardware behavior that has not been verified.
- [ ] Legal, security, privacy, and safety owners approve the release evidence.

## Operations And Release Decision

- [ ] Dashboards and alerts cover auth failure, WebSocket connects/closes, CLM latency/errors, SMS, push, SOS delivery, and mobile crash-free sessions without logging PII.
- [ ] On-call runbooks include provider outage, bad release, credential rotation, user safety escalation, privacy request, and compromised wearable/account procedures.
- [ ] Mobile rollback and backend rollback have been rehearsed; schema changes are backward compatible with the prior mobile version.
- [ ] Staged rollout percentages, pause thresholds, and a single accountable release decision-maker are recorded.
- [ ] Support can identify the app/backend version and collect redacted diagnostics.
- [ ] Final go/no-go review confirms every P1 gate is closed with linked evidence.

Decision:

- [ ] **GO** — all stop-ship gates closed and sign-offs attached.
- [ ] **NO-GO** — release paused; owner and next review date recorded.

## Handoff to Grace

Grace is the release coordinator, not the default implementer for unresolved engineering work. Before scheduling a store release, she must replace every role below with a named individual, due date, and evidence link. Every item remains open unless its evidence is attached to the release ticket; verbal confirmation is not closure.

| External item | Accountable owner | Evidence Grace must collect |
| --- | --- | --- |
| Production deployment of Apple/Google exchange plus session/SMS completion | Identity/backend owner + SMS vendor owner | Exact allowlists/signing-key deployment, provider validation, access/refresh renewal, refresh-family reuse detection/revocation, real SMS, abuse controls, expiry/replay tests, deletion, logout, and account-switch results. |
| Encrypted, account-bound local PII | Mobile security owner + iOS/Android owners | Key-management design, migration and rollback results, account-mismatch isolation tests, deletion tests, and Security approval. |
| Hume production account, EVI configuration, quotas, and retention | Voice platform owner + Security/Privacy | Approved config/tool/voice IDs, quota and outage tests, credential-rotation evidence, and signed retention/deletion review. |
| Production deployment of the authenticated Hume gateway | Voice backend owner + Security | Deployed in-repository `wss` path, invalid/expired/wrong-scope/replay/revocation results, rate limits, ownership-bound resume/configuration, load/backpressure tests, and redacted ingress logs. |
| Physical validation of the implemented PCM path | iOS/Android audio owners + Device QA | Physical-device recordings and logs for 48 kHz mono Int16 frame timing, two-way playback, interruptions, echo, Bluetooth routing, background/foreground, lock screen, and repeated start/stop. |
| VL01 protocol completion and physical wearable validation | BLE/firmware owner + Mobile BLE owner + Device QA | Approved GATT specification/battery encoding, decoded status/events, authorized commands, secure pairing/ownership isolation, wearable reset, and signed hardware matrix. |
| Safety/map delivery, lifecycle, and privacy completion | Maps/backend owner + Safety product owner | Online/offline/timeout/stale-location/durable duplicate-SOS tests, real delivery receipts, route/zone/share-expiry, deletion tombstones/session revocation/vendor orchestration, retention, and rollback evidence. |
| APNs/FCM credentials and push delivery service | Mobile platform owner + Notifications backend owner | Registration and token-rotation tests plus foreground, background, terminated, opt-out, invalid-token, duplicate, and tap-routing results on signed builds. |
| Signed iOS physical-device matrix | iOS owner + Mobile QA | TestFlight evidence for auth, telephony, permissions, location, audio routing, backgrounding, lock screen, BLE, privacy export/deletion, and upgrade/relaunch. |
| Android API 36 and signed physical-device matrix | Android owner + Mobile QA | Emulator and Play internal-track evidence for permissions, Back navigation, process death, deep links, auth, telephony, voice, BLE, location, push, privacy, and upgrade. |
| Store privacy, safety, legal, localization, and submission review | Grace + Legal/Privacy + Safety product + Localization owner | Reconciled privacy/data-safety answers, vendor terms, reviewer notes, accurate emergency claims, native-speaker review of safety copy, screenshots, export compliance, and approvals. |
| Production observability, on-call, incident response, staged rollout, and rollback | SRE/on-call owner + Grace | Redacted dashboards and alerts, named on-call, outage/credential/privacy/safety runbooks, rollout pause thresholds, and rehearsed mobile/backend rollback. |

Grace's final handoff record:

- [ ] A named person and due date are recorded for every row; team labels alone are not accepted.
- [ ] Production environment values are provisioned through EAS and server secret managers, never pasted into the ticket or repository.
- [ ] The release commit, EAS build URLs, backend versions, test evidence, privacy approvals, and rollback identifiers are linked above.
- [ ] Every P1 stop-ship gate has objective closure evidence; otherwise the decision remains **NO-GO**.
- [ ] Grace records the final decision, staged-rollout window, accountable on-call person, and next review date.
