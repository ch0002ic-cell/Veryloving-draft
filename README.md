# VeryLoving Expo App

VeryLoving is an Expo Router safety companion with onboarding, location and Mapbox safety views, NorthStar BLE jewelry, emergency contacts and SOS flows, social features, and Hume EVI voice conversations with local history and offline fallback.

The interface offers 155 structurally complete ISO 639-1 catalogs through a searchable own-script language picker, with automatic RTL layout for eleven right-to-left catalogs. English, Spanish, French, and Simplified Chinese are maintained; the other 151 catalogs are machine-generated starting points that require native-speaker safety-copy review. All 183 assigned codes are represented in the registry, and phone entry covers the full libphonenumber E.164 country set. See [GLOBALIZATION.md](./GLOBALIZATION.md) for translation review status, unavailable provider languages, the phone data contract, and the steps to maintain a catalog.

## Development Setup

### Prerequisites

- Node.js 22 or newer
- npm
- EAS CLI 20 or newer for cloud build profiles
- Xcode and an iOS simulator for iOS development
- CocoaPods for native development builds
- JDK 17, Android Studio, Android SDK Platform 36, and an API 36 emulator for Android development
- An Expo development build for native Mapbox, BLE, Google Sign-In, and audio-module access

Clone and install:

```bash
git clone https://github.com/ch0002ic-cell/Veryloving-draft.git
cd Veryloving-draft
npm install
cp .env.example .env
```

Keep all server secrets out of `.env`. Expo variables beginning with `EXPO_PUBLIC_` are bundled into the app and must only contain public configuration.

Start Metro for a development build. LAN mode works with both Android devices and iOS simulators:

```bash
npx expo start --dev-client --lan
```

Expo Go provides graceful fallbacks for native-only features. For the native feature set, create and run a development build:

```bash
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

The generated app enables background audio for active safety calls and Bluetooth central mode for NorthStar. Confirm background microphone behavior on physical devices; simulators cannot validate microphone routing, BLE hardware, echo cancellation, or lock-screen behavior reliably.

For command-line Android builds, make sure Gradle can find JDK 17 and your SDK:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
npx expo prebuild --clean --platform android
npx expo run:android
```

Mapbox requires `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` at runtime and `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` while resolving native artifacts. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the public OAuth web client ID used to issue Google identity tokens. The local phone adapter exercises E.164 validation and verification navigation only when `EXPO_PUBLIC_ENABLE_MOCK_PHONE_AUTH=true` in development/test; it is fail-closed in production. Production SMS delivery and provider-token exchange still require backend/OAuth infrastructure.

This repository uses Expo Continuous Native Generation. The `ios/` and `android/` directories are generated, ignored, and must not be edited or committed. Native settings live in `app.config.js` and the config plugins under `plugins/`; `withPodfile.js` preserves modular headers and the EXAV compatibility hook, `withEntitlements.js` merges push and Apple Sign-In entitlements, `withGradleProperties.js` preserves AndroidX, Jetifier, the new architecture, and a 4 GB Gradle heap, and `withAndroidManifest.js` normalizes BLE declarations while keeping debug overlay permission out of release builds. Run `npx expo prebuild --clean` whenever you need fresh native projects.

Expo Doctor determines the workflow from directories currently present on disk. Run it from the config-only source state for the expected `20/20` result. After local native testing, remove the disposable projects before checking again:

```bash
rm -rf ios android
npx expo-doctor
```

## Implemented Architecture And Deployment Boundaries

The repository currently contains:

- an Expo/React Native mobile client using Expo Router and Continuous Native Generation;
- a dependency-free Node 22 HTTP CLM/control-plane service in `server/`, with a dedicated Dockerfile; and
- deterministic local storage, offline voice responses, and test doubles used by the mobile client.

The deployable Node service exposes `GET /health`, `POST /chat/completions`, `POST /v1/safety/tips`, and `POST /v1/hume/session/configure`. `/health` is implemented and tested, but it is a liveness endpoint only; it does not prove that Hume credentials, the app-token verifier, or an optional upstream model are ready.

```text
Expo app -- HTTPS --> external production auth/API gateway -- HTTP --> Node CLM service in this repo
    |
    `------ WSS ----> external authenticated Hume proxy -----------> Hume EVI

Hume CLM -------------------------------- POST /chat/completions --> Node CLM service
```

The auth/session exchange, refresh-token service, production SMS, Hume WebSocket proxy, push delivery, database, live guardian/SOS state, and map/location-sharing backend are not implemented here. This is not a Next.js, Vercel, AWS, DynamoDB, or SES codebase, and deploying `server/Dockerfile` must not be represented as deploying those missing services.

See [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for the exact endpoint/authentication contract and deployment topology, and [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for release evidence and stop-ship gates.

### Local CLM Server

In a second terminal:

```bash
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

Hume needs an HTTPS endpoint for CLM traffic. See [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for local tunneling, Railway, AWS ECS/Fargate (or App Runner for existing customers), server variables, Hume provisioning, and Octave voice setup.

## Testing

Run the complete deterministic test suite and lint checks:

```bash
npm test
npm run lint
```

The suite covers global E.164 formatting and validation, all 183 ISO language-registry entries, exact key and placeholder parity across 155 selectable catalogs, RTL metadata, locale resolution, Google Sign-In response handling, Android BLE permission splits, CNG manifest normalization, conversation persistence, offline queue ordering and exponential backoff, manual retry, CLM authentication, OpenAI-compatible SSE, safety prompt injection, upstream timeout fallback, Hume protocol payloads, settings persistence, and user-facing error sanitization.

Validate both production JavaScript bundles:

```bash
npx expo export --platform ios
npx expo export --platform android
```

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

The app is not yet production-ready. Current launch gates are:

- backend-issued access/refresh tokens with provider JWT validation and removal of bearer credentials from WebSocket URLs;
- encrypted, per-account contacts, settings, queues, and conversation history;
- a production SMS backend and signed Apple/Google OAuth verification;
- an authenticated Hume WebSocket proxy plus native 48 kHz mono PCM streaming on real devices;
- approved VL01 GATT battery reads/notifications and hardware ownership validation; pairing metadata and one reconnect attempt are persisted, but battery remains explicitly unknown until the real characteristic is implemented;
- backend-backed SOS/guardian state, remote push delivery, live location sharing, routes, and avoidance zones;
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

Required production public configuration includes the API base URL, Google web client ID, authenticated Hume `wss` proxy URL, and public Mapbox runtime token. When CLM is enabled, also set the Hume customization URL and valid config ID. `EXPO_PUBLIC_ENABLE_MOCK_PHONE_AUTH` and `EXPO_PUBLIC_ENABLE_OFFLINE_MODE` should be false, and `EXPO_PUBLIC_HUME_API_KEY` must be absent.

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

The current production mobile path requires the external authenticated Hume WebSocket proxy. A backend-issued temporary Hume token would require an additional mobile token-exchange integration that is not present today. The CLM container in this repository is not the proxy, and direct Hume API keys are rejected in release builds.

`EXPO_PUBLIC_HUME_CONFIG_ID` is optional. Leave it empty to use Hume's default EVI configuration; set it to a valid configuration from the same Hume account to enable the custom CLM, tools, and branded voice.

EAS Update is not configured (`expo-updates` is not installed and no build channel is defined). Treat these profiles as native build profiles until an OTA update policy, runtime-version strategy, and rollback process are deliberately added and tested.

## Privacy And Offline Behavior

- Permission requests show contextual explanations before location, notification, microphone, Bluetooth, or camera prompts.
- The last valid live location is cached for at most 24 hours. If a later location request fails, the map may use it as a fallback and labels the exact saved time; it is never presented as current location.
- On native Mapbox builds, a successful live fix starts or resumes a bounded Streets map pack around that location (zoom 10–15, 3,000-tile cap). During replacement, the last complete pack remains active until the pending pack reaches 100%; failed native deletions are tracked for the next cleanup. This caches base map tiles only; it does not provide offline routes, live sharing, remote danger-zone updates, or SOS delivery.
- Emergency contacts persist locally. The SOS screen persists only the latest local outcome and timestamp, without duplicating contact PII. “Phone dialer opened” does not confirm that a call connected or that an emergency service, contact, or backend received an alert.
- Paired-device metadata persists without native BLE objects or battery values. Relaunch performs at most one reconnect attempt for a remembered real device, explicit disconnect remains disconnected, and simulated devices are development-only. Battery stays unknown until the approved VL01 characteristic is implemented and verified on hardware.
- Settings > Privacy & data supports JSON export, conversation history, the privacy policy, and deletion of local app data. Export includes the current `veryloving.*` snapshot, including contacts and the local resilience records.
- Settings sign-out and Delete My Data first drain local settings/contact/device/history/queue/location/SOS/map-cache writes, then attempt to purge cached voice audio and every app-owned native Mapbox pack before sweeping all `veryloving.*` records. Delete My Data additionally removes the SecureStore token, user, and onboarding marker. Ancillary native-cache cleanup cannot block removal of app data or credentials, but an incomplete purge is surfaced to the user and leaves only opaque, non-location retry evidence outside the user-data namespace for a later verified cleanup attempt.
- Typed AI companion messages are saved locally and replayed in order when online voice service returns.
- When Hume is unavailable, the safety call offers bundled offline responses and clearly labels unsent messages.
- Development routes and mock services remain gated from production builds.

Contacts, settings, transcripts, resilience records, and queues are still account-unscoped plaintext AsyncStorage. OS-protected, per-account encryption plus migration/account-switch tests remains a P1 release gate; the purge behavior above reduces cross-session residue but does not replace encryption.

See [PRIVACY.md](./PRIVACY.md) for the data collection and privacy manifest summary.
