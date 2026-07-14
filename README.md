# VeryLoving Expo App

VeryLoving is an Expo Router safety companion with onboarding, location and Mapbox safety views, NorthStar BLE jewelry, emergency contacts and SOS flows, social features, and Hume EVI voice conversations with local history and offline fallback.

The interface offers 155 structurally complete ISO 639-1 catalogs through a searchable own-script language picker, with automatic RTL layout for eleven right-to-left catalogs. English, Spanish, French, and Simplified Chinese are maintained; the other 151 catalogs are machine-generated starting points that require native-speaker safety-copy review. All 183 assigned codes are represented in the registry, and phone entry covers the full libphonenumber E.164 country set. See [GLOBALIZATION.md](./GLOBALIZATION.md) for translation review status, unavailable provider languages, the phone data contract, and the steps to maintain a catalog.

## Getting Started

### Prerequisites

- Node.js 22 or newer
- npm
- EAS CLI 20 or newer for cloud build profiles
- Xcode and an iOS simulator for iOS development
- CocoaPods for native development builds
- JDK 17, Android Studio, Android SDK Platform 36, and an API 36 emulator for Android development
- An Expo development build for native Mapbox, BLE, provider authentication, notifications, and audio-module access

Clone and install:

```bash
git clone https://github.com/ch0002ic-cell/Veryloving-draft.git
cd Veryloving-draft
npm install
npm ci --prefix server
cp .env.example .env
cp server/.env.example server/.env
```

Keep all server secrets out of `.env`. Expo variables beginning with `EXPO_PUBLIC_` are bundled into the app and must only contain public configuration.

### Environment Setup

The root `.env` configures the mobile bundle and native build; `server/.env` configures the local Node service. Follow [SETUP.md](./SETUP.md) for the purpose, source, default, and feature dependency of every root variable, plus current Mapbox, Google OAuth, Hume, Vercel, Twilio, DynamoDB, VL01, and EAS setup steps.

Validate the local mobile/build environment without printing configured values:

```bash
npm run validate-env
```

Before a release build, validate the same values against the stricter production contract:

```bash
npm run validate-env -- --profile production
```

Missing optional development integrations are warnings; missing or invalid locally readable production requirements make the command fail. EAS secret values cannot be pulled for local validation, so the Mapbox native-download token warns locally and becomes blocking only on the remote EAS builder. The committed templates contain no credentials, and `.env`/`server/.env` stay untracked.

Start Metro for a development build. LAN mode works with both Android devices and iOS simulators:

```bash
npx expo start --dev-client --lan
```

Expo Go is a UI and foreground-flow preview only. VeryLoving does not evaluate the `expo-secure-store` or `expo-notifications` package roots there: secure storage is replaced with a process-memory adapter, while notification operations return unavailable/no-op results. This prevents both packages' entitlement-dependent Keychain paths from running. The same `expo-application` preflight selects memory storage and leaves notifications unloaded on the iOS Simulator; provisioned non-store artifacts without an APNs environment also keep notifications disabled. Properly signed physical development builds and App Store/TestFlight builds retain normal native SecureStore and notification behavior. A memory session does not survive a JavaScript reload or app restart. Notifications on physical devices, Apple/Google Sign-In, Mapbox, BLE, and background audio require a development or signed build; supported artifacts dynamically load the real native modules and fail closed rather than downgrading security. Expo Go results cannot close native launch gates.

For the iOS native feature set on SDK 57, generate the project and select the simulator explicitly:

```bash
npx expo prebuild --platform ios
npx expo run:ios --device "<simulator>" --no-build-cache
```

The generated app declares background-audio and Bluetooth-central capabilities for active safety calls and NorthStar. The `expo-audio` PCM stream, audio-session restoration, background capture, microphone routing, BLE lifecycle, echo cancellation, and lock-screen behavior still require signed physical-device validation; a simulator or successful build cannot prove them.

For command-line Android builds, make sure Gradle can find JDK 17 and your SDK:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
npx expo prebuild --platform android
npx expo run:android
```

Mapbox requires `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` at runtime and `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` while resolving native artifacts. Google Sign-In requires both the web client ID used as the identity-token audience and the native iOS client ID used for the URL scheme. Native Sign in with Apple uses the iOS bundle identifier as its audience, so it does not need a separate mobile environment variable. Apple and Google identity tokens are exchanged at `POST /v1/auth/exchange`; phone sign-in uses `POST /v1/auth/phone/start` and `POST /v1/auth/phone/verify` with Twilio Verify and a signed, five-minute app challenge. Supported native builds store the returned first-party access/rotating refresh JWTs and bound profile as one validated SecureStore envelope, renew before expiry, retry network outages, and fail closed on rejected refresh. Provider identity tokens are not retained. There is no fixed-code or fabricated-token fallback. Server-side refresh-family reuse detection/revocation, deletion tombstones, provider credential-state checks, and distributed auth/SMS abuse controls remain launch gates.

Changing `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` changes the native callback URL scheme. Restarting Metro is insufficient: regenerate the iOS project and install a new development build before testing Google Sign-In. Changes to only `EXPO_PUBLIC_API_BASE_URL` or the web client ID still require a clean Metro restart so the public bundle configuration is refreshed.

This repository uses Expo Continuous Native Generation. The `ios/` and `android/` directories are generated, ignored, and must not be edited or committed. Native settings live in `app.config.js` and the config plugins under `plugins/`; `withPodfile.js` preserves modular headers and the EXAV compatibility hook, `withEntitlements.js` merges push and Apple Sign-In entitlements, `withGradleProperties.js` preserves AndroidX, Jetifier, the new architecture, and a 4 GB Gradle heap, and `withAndroidManifest.js` normalizes BLE declarations while keeping debug overlay permission out of release builds. Generate the iOS project with `npx expo prebuild --platform ios` when native dependencies or configuration change.

Expo Doctor determines the workflow from directories currently present on disk. Run it from the config-only source state for the expected `20/20` result. After local native testing, remove the disposable projects before checking again:

```bash
rm -rf ios android
npx expo-doctor
```

### Environment Variable Reference

Copy the committed templates and fill them locally or in the matching EAS/deployment environment. Do not commit values. The root `.env` is for public mobile configuration and local build inputs; `server/.env` is for the CLM service. Variables beginning with `EXPO_PUBLIC_` are embedded in the app bundle and are never secret.

For provider dashboard links and one-time acquisition steps, use [SETUP.md](./SETUP.md). This section is the compact runtime contract; the launch owner/evidence matrix remains in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).

Mobile/public variables:

| Variable | Purpose | Production guidance |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | HTTPS root of the VeryLoving auth and safety API. | Required; it may be `https://<project>.vercel.app` for the HTTP-only adapter or another gateway routing to the in-repository handler. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Google OAuth client of type **Web application**, used as the identity-token backend audience. | Required for Google Sign-In; this public ID must be accepted by server `GOOGLE_TOKEN_AUDIENCES`. Do not substitute an Android or iOS client ID. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Google OAuth client of type **iOS**, registered for `com.veryloving.app`; its reversed value becomes the callback URL scheme. | Required for iOS Google Sign-In and accepted by server `GOOGLE_AUTHORIZED_PARTIES` when it appears in `azp`. |
| `EXPO_PUBLIC_PHONE_AUTH_ENABLED` | Public readiness gate for the deployed SMS endpoints. | Set `true` only when server `PHONE_AUTH_ENABLED=true`, Twilio Verify is configured, and the deployment health/auth probes pass. |
| `EXPO_PUBLIC_HUME_WS_PROXY_URL` | Authenticated WebSocket endpoint, normally `wss://<voice-domain>/api/voice/hume-ws`. | Required; the app sends its session JWT in the first TLS-protected frame, never in this URL. The HTTP-only Vercel adapter is not this host. |
| `EXPO_PUBLIC_HUME_CONFIG_ID` | Hume EVI configuration ID for the CLM, tool, and branded voice. | Required when CLM customization is enabled; otherwise optional. |
| `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` | Public HTTPS base URL for the deployed CLM/control-plane service. | Required when CLM customization is enabled. |
| `EXPO_PUBLIC_HUME_CLM_ENABLED` | Enables the custom Hume CLM integration when set to `true`. | Set deliberately after the CLM and Hume configuration are verified. |
| `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` | Public identifier of the approved Hume voice. | Optional until a branded voice has been provisioned. |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public Mapbox runtime token used to render maps. | Required; use a restricted public token, never a secret `sk.*` token. |
| `EXPO_PUBLIC_ENABLE_OFFLINE_MODE` | Forces the offline voice path for development and fault testing. | Keep `false` for production. Runtime outages can still offer the offline fallback. |
| `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED` | Enables backend contacts, safety-session persistence, and durable SOS acceptance. | Must be `true` for production; acceptance is not notification delivery. |
| `EXPO_PUBLIC_HUME_API_KEY` | Direct Hume key supported only by development builds. | Development only; it must be absent from production because public variables are bundled. |
| `EXPO_PUBLIC_VL01_ENABLED` | Enables real VL01 discovery and GATT validation. | Enable only after the firmware owner approves the UUIDs and physical-device matrix. |
| `EXPO_PUBLIC_VL01_SERVICE_UUID` | Approved VL01 primary service UUID used for filtered scanning and discovery. | Required whenever VL01 is enabled. |
| `EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID` | Approved one-byte battery percentage characteristic. | Required whenever VL01 is enabled. |
| `EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID` | Readable/notifiable status characteristic. | Raw values can be surfaced; required by production diagnostics and therefore needs firmware/schema approval before a production build. |
| `EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID` | Notifiable event characteristic. | Raw values can be surfaced; required by production diagnostics and therefore needs event-schema approval before a production build. |
| `EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID` | Writable command characteristic. | A bounded raw write exists; required by production diagnostics and therefore needs command authorization/secure-pairing approval before a production build. |

Build-only variables:

| Variable | Purpose | Where it belongs |
| --- | --- | --- |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | Resolves Mapbox native artifacts during prebuild/native builds. | Secret EAS build variable or uncommitted local shell; never an `EXPO_PUBLIC_` variable. |

Backend server variables (use `server/.env.example` as the template):

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Selects development, test, or production server behavior. |
| `PORT` | Local/container HTTP and WebSocket listener port; do not set it for the Vercel captured-server deployment. |
| `HUME_API_KEY` | Server-side Hume credential used by the full-container voice gateway and development session-configure endpoint; not loaded by the Vercel HTTP-only entrypoint. |
| `HUME_CONFIG_ID` | Server-enforced Hume EVI config ID; required by the production voice-gateway container, not by the Vercel HTTP-only entrypoint. |
| `HUME_ALLOWED_VOICE_IDS` | Comma-separated allowlist of client-selectable Hume voice IDs; required by the production voice-gateway container. |
| `HUME_ALLOW_CLIENT_RESUME` | Allows client-supplied Hume chat-group resume IDs; keep `false` until ownership binding is implemented. |
| `HUME_CLM_BEARER_TOKEN` | Shared bearer token required on Hume-to-CLM requests. The Vercel HTTP service may start without it, but `/chat/completions` then fails closed with HTTP `503`; the full production container still requires it at startup. |
| `APP_AUTH_VERIFY_URL` | Optional external verifier fallback for app-facing endpoints; the built-in session JWT is checked first. |
| `AUTH_EXCHANGE_ENABLED` | Enables `POST /v1/auth/exchange`; required for production Apple/Google sign-in. |
| `PHONE_AUTH_ENABLED` | Enables the production Twilio Verify start/check endpoints; required by production startup validation. |
| `SESSION_JWT_SECRET` | At least 32 characters used to sign and verify VeryLoving HS256 session JWTs. |
| `SESSION_JWT_ISSUER` | Exact issuer embedded in and required from session JWTs. |
| `SESSION_JWT_AUDIENCE` | Exact mobile audience embedded in and required from session JWTs. |
| `SESSION_JWT_TTL_SECONDS` | Access lifetime in seconds; defaults to 3600 and is bounded to 300–86400. |
| `SESSION_REFRESH_TTL_SECONDS` | Refresh lifetime in seconds; defaults to 30 days and is bounded to 1–90 days. |
| `APPLE_CLIENT_IDS` | Comma-separated accepted Apple identity-token audiences; native iOS uses `com.veryloving.app`. Required in production. |
| `GOOGLE_TOKEN_AUDIENCES` | Comma-separated accepted Google identity-token `aud` values, normally the Web OAuth client ID. Required in production. |
| `GOOGLE_AUTHORIZED_PARTIES` | Comma-separated trusted native Google presenters accepted from `azp` (iOS/Android OAuth client IDs). Required with Google exchange. |
| `PHONE_AUTH_CHALLENGE_SECRET` | Independent secret of at least 32 characters used to sign short-lived phone challenges. |
| `PHONE_AUTH_SUBJECT_SECRET` | Stable, independent secret used to derive opaque phone-user IDs; preserve it across JWT-key rotations. |
| `PHONE_AUTH_CHALLENGE_TTL_SECONDS` | Phone challenge lifetime, bounded to 60–600 seconds; defaults to 300. |
| `TWILIO_ACCOUNT_SID` | Server-only Twilio account identifier used by Verify. |
| `TWILIO_AUTH_TOKEN` | Server-only Twilio credential; store in the deployment secret manager. |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Verify service configured for SMS policy, geo permissions, and rate limits. |
| `SAFETY_API_ENABLED` | Enables backend emergency contacts, SOS acceptance, and safety sessions. |
| `SAFETY_TABLE_NAME` | DynamoDB table with string partition/sort keys named `PK` and `SK`. |
| `SAFETY_RETENTION_DAYS` | Positive DynamoDB retention horizon used to calculate expiry metadata; defaults to 30 days. |
| `AWS_REGION` | AWS region used by the DynamoDB client. |
| `CLM_UPSTREAM_URL` | Optional OpenAI-compatible upstream chat-completions URL. |
| `CLM_UPSTREAM_API_KEY` | Optional server-side credential for the upstream model. |
| `CLM_UPSTREAM_MODEL` | Optional upstream model identifier. |
| `CLM_UPSTREAM_TIMEOUT_MS` | Positive upstream timeout in milliseconds. |

Provider registration must match the signed application and the backend allowlists:

- In Apple Developer, enable Sign in with Apple for App ID `com.veryloving.app`. Set server `APPLE_CLIENT_IDS=com.veryloving.app` for native iOS tokens. Do not create an `EXPO_PUBLIC_APPLE_CLIENT_ID`; the bundle identifier is public app metadata and is injected into the runtime config automatically.
- In Google Cloud, create a Web application OAuth client for the backend audience and an iOS OAuth client for bundle `com.veryloving.app`. Put their public IDs in the matching mobile variables above, publish or configure the consent screen for the intended test users, and verify that the generated iOS URL scheme is the reversed iOS client ID.
- For Android, create OAuth Android clients for package `com.veryloving.app` and every signing SHA-1 used by local development, EAS, and Play App Signing. Android client IDs are registered with Google rather than bundled as another mobile environment variable. Add trusted native presenter IDs to `GOOGLE_AUTHORIZED_PARTIES` if Google emits them in `azp`.
- Before release, decode representative provider tokens only in an approved diagnostic environment and confirm `aud`/`azp` exactly match the deployed allowlists. Never log or commit the tokens themselves.

Hume provisioning/operator variables (set in an uncommitted operator shell):

| Variable | Purpose |
| --- | --- |
| `HUME_API_KEY` | Authorizes Hume configuration, tool, and voice operations. |
| `HUME_CLM_URL` | Public HTTPS URL ending in `/chat/completions` that Hume calls. |
| `HUME_TOOL_ID` | Optional existing safety-tool ID to update instead of creating a tool. |
| `HUME_CONFIG_ID` | Optional existing EVI configuration ID to update instead of creating one. |
| `HUME_CUSTOM_VOICE_ID` | Optional saved custom voice ID used during provisioning. |
| `HUME_VOICE_NAME` | Optional Hume catalog voice name when no custom voice ID is supplied. |

Build/config diagnostic variables are orchestration inputs, not product secrets:

| Variable | Purpose |
| --- | --- |
| `VERYLOVING_BUILD_PROFILE` | Explicit local profile name (`development`, `preview`, or `production`) used by config validation. |
| `VERYLOVING_CONFIG_DIAGNOSTICS` | Emits a redacted presence/scheme report when set to `1` or `true`; it never prints values. |
| `EAS_BUILD_PROFILE` | EAS-provided profile fallback when `VERYLOVING_BUILD_PROFILE` is unset. |
| `EAS_BUILD` | EAS-provided remote-build marker; enables checks that only make sense on the builder. |
| `CI` | Non-interactive mode; `npm run validate` defaults it to `1` for child commands when unset. |
| `EXPO_NO_TELEMETRY` | Disables Expo telemetry; `npm run validate` sets it for its child commands. |

The exact production ownership and source for every credential is tracked in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md). Never paste a secret into logs, screenshots, committed files, or public Expo configuration.

Keep `HUME_ALLOW_CLIENT_RESUME=false` until resumed chat-group IDs and session-configuration requests are ownership-bound to the authenticated account. Access JWTs have rotating refresh JWTs, but the server does not yet persist refresh-family state for reuse detection/revocation, and an access JWT is not a single-use WebSocket ticket.

## Implemented Architecture And Deployment Boundaries

The repository currently contains:

- an Expo/React Native mobile client using Expo Router and Continuous Native Generation;
- a Node 22 service in `server/`, with a Docker HTTP/WebSocket entrypoint and an HTTP-only Vercel captured-server entrypoint, plus `ws` and AWS SDK DynamoDB clients; and
- deterministic local storage, offline voice responses, and test doubles used by the mobile client.

The deployable Node service implements:

- `GET /health` liveness;
- `POST /v1/auth/exchange` for Apple/Google identity-token verification and access/refresh issuance, plus `POST /v1/auth/refresh` for client-held refresh rotation;
- `GET`/`POST`/`DELETE /v1/emergency-contacts`, current-state `GET`/`POST /v1/safety-sessions`, `POST /v1/sos-events`, `GET /v1/privacy/export`, and `DELETE /v1/privacy/data` backed by DynamoDB when enabled;
- `GET`-upgrade `/api/voice/hume-ws`, which authenticates the first client frame before opening Hume with the server-only key;
- `POST /chat/completions`, `POST /v1/safety/tips`, and `POST /v1/hume/session/configure` for the Hume CLM/control plane.

The Docker entrypoint mounts every route above, including the WebSocket upgrade. The Vercel entrypoint mounts only the ordinary HTTP routes; `/api/voice/hume-ws` remains a separate hosting and launch gate.

`/health` is deliberately liveness-only. It does not prove that provider keys, JWT settings, DynamoDB, Hume credentials, the upstream model, or WebSocket upgrades are ready.

```text
Expo app -- HTTPS auth/safety/tool requests --> Vercel HTTP adapter or container --> DynamoDB
    |
    `-- WSS /api/voice/hume-ws -------------> separately hosted voice gateway ----> Hume EVI

Hume CLM ---------------- POST /chat/completions --> Node service --> optional upstream model
```

The repository now contains provider-token exchange, Twilio Verify phone authentication, first-party access/refresh JWT renewal, first-frame authenticated Hume gateway, and DynamoDB persistence/export/deletion for contacts, current safety state, and SOS acceptance. It does **not** contain refresh-family persistence/reuse detection/session revocation, deletion tombstones that prevent later token-driven repopulation, distributed SMS/auth abuse controls, push delivery, guardian/contact notification delivery or receipts, live/revocable location sharing, routes, remote danger/avoidance intelligence, vendor-wide export/deletion orchestration, or infrastructure-as-code. A `202 accepted` SOS response means only that DynamoDB accepted an idempotent record; it does not mean a guardian or emergency service received an alert. `server/server.cjs` is a Vercel-captured Node HTTP entrypoint rather than a Next.js app; it intentionally omits the raw WebSocket upgrade gateway. AWS deployment resources are not provisioned by the repository.

See [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for the exact endpoint/authentication contract and deployment topology, and [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for release evidence and stop-ship gates.

### Local Backend Server

In a second terminal:

```bash
npm ci --prefix server
cp server/.env.example server/.env
set -a
source server/.env
set +a
npm run clm:start
```

Verify it is running:

```bash
curl http://localhost:8787/health
```

For a Vercel HTTP deployment, import the repository with **Root Directory** set to `server`, configure the server environment, and leave build/output commands at their zero-configuration defaults. Vercel detects `server/server.cjs`, installs `server/package.json`, and exposes the existing auth, phone, safety/privacy, tool, CLM, and health routes. The mobile app may then use `https://<project>.vercel.app` as `EXPO_PUBLIC_API_BASE_URL` after those flows pass production verification.

This Vercel adapter does not expose `/api/voice/hume-ws`. Keep `EXPO_PUBLIC_HUME_WS_PROXY_URL` on a separately deployed, TLS-terminated container host until the raw `http.Server` upgrade gateway is adapted to its eventual platform and passes security, reconnect, backpressure, and load testing.

Hume needs an HTTPS endpoint for CLM traffic. See [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for the Vercel HTTP adapter, local tunneling, Railway, AWS ECS/Fargate (or App Runner for existing customers), server variables, Hume provisioning, and Octave voice setup.

## Testing

Run the complete release-oriented validation from a config-only source state (with generated `ios/` and `android/` directories removed):

```bash
npm run validate
```

The command first runs the redacted development-environment check, then ESLint, the deterministic test suite, Expo Doctor, and iOS/Android production exports in sequence. Both exports go to a unique temporary directory rather than the repository, and that directory is removed whether validation passes or fails. The command stops at the first failed gate and exits non-zero. Production credential readiness remains the separate `npm run validate-env -- --profile production` gate.

The final 13 July 2026 audit run completed with ESLint clean, 163/163 tests, Expo Doctor 20/20, successful iOS/Android production exports, and 0 vulnerabilities from both root and server production dependency audits. The root result includes a narrow `xcode.uuid=11.1.1` override whose resolved tree and CommonJS `v4` compatibility were checked after the lockfile change. See [COMPREHENSIVE_FINAL_AUDIT.md](./COMPREHENSIVE_FINAL_AUDIT.md) for exact bundle evidence and the launch decision; green deterministic gates do not waive production-service or physical-device gates.

The 14 July 2026 auth/Vercel/animation/entitlement follow-up then passed the same validator with ESLint clean, 215/215 tests, Expo Doctor 20/20, a 2,557-module/8.7 MB iOS Hermes export, and a 2,640-module/8.9 MB Android Hermes export. A clean Debug build installed on the iOS 26.5 simulator completed cold launch, onboarding/account transitions, and an isolated active voice-indicator probe without the historical `onAnimatedValueUpdate` warning. A subsequent buffer-clean cold launch produced one intentional notification-skip line and one memory-storage line, with no Dev Launcher `sharedPackageConnection`, notification-registration Keychain, or Auth SecureStore entitlement signature in the timestamped native-log query. This follow-up did not repeat the dependency audits or constitute a signed-device/provider deployment test.

The environment-setup follow-up on 14 July 2026 passed the new redacted development validator, ESLint, 228/228 tests, Expo Doctor 20/20, and the same 2,557-module iOS and 2,640-module Android production exports. The intentionally incomplete local environment has no development validation errors; the production profile remains correctly blocked until the documented API, Hume, Mapbox, safety, and VL01 launch values are supplied.

For a faster development loop, run tests and lint separately:

```bash
npm test
npm run lint
```

The suite covers global E.164 formatting and validation, all 183 ISO language-registry entries, exact key and placeholder parity across 155 selectable catalogs, RTL metadata, locale resolution, Google Sign-In response handling, provider-JWT verification, access/refresh issuance and renewal, local session-expiry/offline behavior, first-frame WebSocket authentication, PCM encoding and lifecycle, Android BLE permission splits, VL01 GATT validation/battery decoding/reconnect backoff, Dynamo safety/privacy validation and idempotency, CNG manifest normalization, conversation persistence, offline queue ordering and exponential backoff, manual retry, CLM authentication, OpenAI-compatible SSE, safety prompt injection, upstream timeout fallback, Hume protocol payloads, settings persistence, and user-facing error sanitization. Automated coverage does not replace signed-device, provider, Hume, DynamoDB, or wearable evidence.

Validate both production JavaScript bundles:

```bash
npx expo export --platform ios
npx expo export --platform android
```

See [FINAL_VALIDATION_REPORT.md](./FINAL_VALIDATION_REPORT.md) for the final simulator/build evidence, per-feature status, external blockers, and console findings used for handoff.

Before release, manually verify on an iOS development build:

1. Start and end an online and offline safety call.
2. Queue a typed message in airplane mode, reconnect, and confirm it sends once.
3. Force a delivery failure and use the message-level Retry control.
4. Preview all four voices and relaunch the app to confirm the selection persists.
5. Start NorthStar scanning, background the app, and confirm scanning stops.
6. Use React DevTools Profiler on the Map tab and confirm location/status updates do not repeatedly commit the memoized native map surface.

Before an Android release, verify on an API 36 emulator and a physical phone:

1. Open phone auth, enter numbers from several regions, and confirm the canonical E.164 value reaches verification.
2. Grant foreground location and confirm Mapbox renders and updates its camera; deny once and confirm Retry remains available.
3. Start NorthStar scanning and confirm the Nearby Devices prompt appears on Android 12+; background the app and confirm scanning stops.
4. Open a safety call with Hume unavailable, confirm the actionable error, activate the offline companion, then use hardware Back and confirm the session disconnects.
5. Verify notification, microphone, and camera rationales before their native prompts.
6. Test BLE discovery, production SMS, Google OAuth, background audio, and lock-screen behavior on physical hardware with release credentials.

## Known Issues / Release Blockers

The July 2026 stability audit fixed critical authentication/route bypasses, false SOS success, cleanup races, privacy export, onboarding permission failures, Mapbox fallback behavior, safe phone launching, and Hume connection/audio lifecycle defects. See [STABILITY_REPORT.md](./STABILITY_REPORT.md) for reproduction details, root causes, fixes, verification evidence, and the full feature matrix.

On 13 July 2026, a post-validation architecture pass added provider-token exchange, a short-lived first-party JWT, first-frame WebSocket authentication, an in-repository Hume gateway, `expo-audio` 48 kHz mono Int16 PCM capture, protocol-gated VL01 GATT battery handling and reconnect backoff, and DynamoDB-backed contacts/safety-session/SOS-acceptance APIs. Those changes have automated coverage but were made after the recorded simulator session and must not be treated as physical-device or production-service evidence.

The app is not yet production-ready. Current launch gates are:

- production hardening of implemented authentication: refresh-family persistence, old-token reuse detection, revocation, deletion tombstones, consistent authenticated-request 401 recovery, provider credential-state checks, and distributed exchange/SMS abuse controls;
- encrypted, per-account settings, locations, queues, and conversation history, plus completion of account isolation/migration for every remaining sensitive store;
- production deployment and security testing of the first-frame authenticated Hume gateway, including ingress rate limits, session revocation, replay resistance, ownership-bound resume/session configuration, quotas, and redacted observability;
- signed-device verification of continuous PCM capture/playback, full duplex, interruptions, echo, Bluetooth routing, background/foreground behavior, lock screen, and repeated cleanup;
- an approved VL01 protocol and hardware evidence for battery semantics, decoded status/events, authorized command schemas, ownership challenge/secure pairing, and background behavior;
- guardian/contact notification delivery and receipts after durable SOS acceptance, push delivery, live/revocable sharing, routes, avoidance zones, deletion tombstones/session revocation, vendor-wide privacy orchestration, and approved retention controls;
- full Android emulator/device QA and signed iOS/Android physical-device testing;
- native-speaker safety-copy review for the 151 machine-generated catalogs.

Do not approve a store release until every P1 item has closure evidence in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md). A successful EAS build, JavaScript export, or CLM health response is necessary but not sufficient.

## EAS Builds

`eas.json` defines four explicit build paths:

| Profile | Purpose | Artifact |
| --- | --- | --- |
| `development` | Expo development client for registered physical devices and Android emulators | Internal distribution |
| `development-simulator` | Development client for the iOS simulator | Simulator `.app` |
| `preview` | Production-like stakeholder QA without developer tools | Internal iOS build and Android APK |
| `production` | Store submission candidate | iOS archive and Android AAB |

Each profile selects its matching EAS environment and enables redacted app-config diagnostics. Production uses EAS remote build versions with `autoIncrement`; initialize existing store build numbers once with `eas build:version:set` before the first production build if remote version state has not already been established.

Configure variables in the EAS project environment, never in committed files. Values beginning with `EXPO_PUBLIC_` are embedded in the app and must be treated as public. Use the EAS dashboard or `eas env:create` with the appropriate `development`, `preview`, or `production` environment and visibility. Keep `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` server/build-only, and verify variable names without printing values:

```bash
eas env:list --environment production --scope project
```

Required production public configuration includes the API base URL, Google web and iOS client IDs, authenticated Hume `wss` endpoint, public Mapbox runtime token, and `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED=true`. Production diagnostics also require custom CLM enabled with customization URL/config ID and VL01 enabled with firmware-approved service, battery, status, event, and command UUIDs. `EXPO_PUBLIC_ENABLE_OFFLINE_MODE` should be false, and `EXPO_PUBLIC_HUME_API_KEY` must be absent.

Run the safe presence/scheme check against a locally pulled production environment. It emits booleans and issue codes, never values:

```bash
VERYLOVING_BUILD_PROFILE=production \
VERYLOVING_CONFIG_DIAGNOSTICS=1 \
npx expo config --type public
```

Build the intended artifacts explicitly:

```bash
eas build --platform ios --profile development-simulator
eas build --platform all --profile preview
eas build --platform ios --profile production
eas build --platform android --profile production
```

The server in this repository implements `/api/voice/hume-ws`. Point the mobile proxy URL at the TLS ingress that forwards WebSocket upgrades to that process. The app sends its VeryLoving session JWT in the first frame, the gateway validates the `voice:connect` scope, and only then does it open Hume with the server-only key. The application JWT is not yet a single-use voice ticket; independent revocation/replay controls and load testing remain required. Direct Hume API keys are rejected in release builds.

`EXPO_PUBLIC_HUME_CONFIG_ID` may be empty only in development when deliberately testing Hume's default EVI configuration. Production diagnostics require custom CLM enabled and a valid configuration from the same Hume account.

EAS Update is not configured (`expo-updates` is not installed and no build channel is defined). Treat these profiles as native build profiles until an OTA update policy, runtime-version strategy, and rollback process are deliberately added and tested.

## Privacy And Offline Behavior

- Permission requests show contextual explanations before location, notification, microphone, Bluetooth, or camera prompts.
- The last valid live location is cached for at most 24 hours. If a later location request fails, the map may use it as a fallback and labels the exact saved time; it is never presented as current location.
- On native Mapbox builds, a successful live fix starts or resumes a bounded Streets map pack around that location (zoom 10–15, 3,000-tile cap). During replacement, the last complete pack remains active until the pending pack reaches 100%; failed native deletions are tracked for the next cleanup. This caches base map tiles only; it does not provide offline routes, live sharing, remote danger-zone updates, or SOS delivery.
- Emergency contacts remain cached locally and, when the safety backend is enabled, are migrated/fetched/created/deleted through the account-authenticated DynamoDB API. Current safety state is idempotently persisted, and SOS can durably reuse an idempotency record with contact IDs and a recent location before opening the dialer. “Accepted” means stored, and “phone dialer opened” means only that the dialer opened; neither confirms notification delivery, call connection, or emergency dispatch.
- Paired-device metadata persists without native BLE objects or stored battery values. When an approved protocol is enabled, connection discovers and validates GATT, bounds connection/read/write operations, reads and conditionally monitors the one-byte battery characteristic, surfaces configured raw status/event values, watches disconnects, provides bounded raw command writes, and retries with serialized exponential backoff. Firmware-specific decoding, command authorization, ownership/secure pairing, and signed physical-device behavior remain unimplemented or unverified.
- Settings > Privacy & data supports JSON export, conversation history, the privacy policy, and deletion. When the safety backend is enabled, export combines the local snapshot with account-scoped DynamoDB contacts/safety/SOS data, and Delete My Data removes DynamoDB user items before clearing local data and credentials.
- Settings sign-out and Delete My Data first drain local settings/contact/device/history/queue/location/SOS/map-cache writes, then attempt to purge cached voice audio and every app-owned native Mapbox pack before sweeping all `veryloving.*` records. Delete My Data additionally removes the SecureStore token, user, and onboarding marker. Ancillary native-cache cleanup cannot block removal of app data or credentials, but an incomplete purge is surfaced to the user and leaves only opaque, non-location retry evidence outside the user-data namespace for a later verified cleanup attempt.
- Typed AI companion messages are saved locally and replayed in order when online voice service returns.
- When Hume is unavailable, the safety call offers bundled offline responses and clearly labels unsent messages.
- Development routes and mock services remain gated from production builds.

Emergency-contact cache PII is now account-bound in SecureStore and migrated away from its legacy AsyncStorage key. Settings, transcripts, locations, resilience records, account-bound wearable metadata, and queues still use plaintext AsyncStorage. Complete OS-protected per-account encryption plus account-switch/process-death coverage remain P1 release gates; account binding and purge reduce cross-session residue but do not replace encryption. Backend-enabled deletion removes DynamoDB items but does not revoke the current session first or create a deletion tombstone, and it does not delete Hume, identity-provider, Mapbox, or share-destination copies.

See [PRIVACY.md](./PRIVACY.md) for the data collection and privacy manifest summary.
