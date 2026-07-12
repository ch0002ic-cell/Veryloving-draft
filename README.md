# VeryLoving Expo App

VeryLoving is an Expo Router safety companion with onboarding, location and Mapbox safety views, NorthStar BLE jewelry, emergency contacts and SOS flows, social features, and Hume EVI voice conversations with local history and offline fallback.

The interface offers 155 complete ISO 639-1 catalogs through a searchable own-script language picker, with automatic RTL layout for eleven right-to-left catalogs. All 183 assigned codes are represented in the registry, and phone entry covers the full libphonenumber E.164 country set. See [GLOBALIZATION.md](./GLOBALIZATION.md) for translation review status, unavailable provider languages, the phone data contract, and the steps to maintain a catalog.

## Development Setup

### Prerequisites

- Node.js 22 or newer
- npm
- Xcode and an iOS simulator for iOS development
- CocoaPods for native development builds
- JDK 17, Android Studio, Android SDK Platform 36, and an API 36 emulator for Android development
- An Expo development build for Mapbox, BLE, Google Sign-In, and complete audio behavior

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

Mapbox requires `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` at runtime and `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` while resolving native artifacts. Set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` to the public OAuth web client ID used to issue Google identity tokens. The current local phone adapter exercises E.164 validation and verification navigation; production SMS delivery and Google Sign-In still require their backend/OAuth credentials.

This repository uses Expo Continuous Native Generation. The `ios/` and `android/` directories are generated, ignored, and must not be edited or committed. Native settings live in `app.config.js` and the config plugins under `plugins/`; `withPodfile.js` preserves modular headers and the EXAV compatibility hook, `withEntitlements.js` merges push and Apple Sign-In entitlements, `withGradleProperties.js` preserves AndroidX, Jetifier, the new architecture, and a 4 GB Gradle heap, and `withAndroidManifest.js` normalizes BLE declarations while keeping debug overlay permission out of release builds. Run `npx expo prebuild --clean` whenever you need fresh native projects.

Expo Doctor determines the workflow from directories currently present on disk. Run it from the config-only source state for the expected `20/20` result. After local native testing, remove the disposable projects before checking again:

```bash
rm -rf ios android
npx expo-doctor
```

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

Hume needs an HTTPS endpoint for CLM traffic. See [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for local tunneling, Railway deployment, server variables, Hume provisioning, and Octave voice setup.

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

## EAS Builds

Set production build variables in EAS, never in committed files:

```bash
eas secret:create --scope project --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN --value <token>
eas secret:create --scope project --name EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN --value <public-token>
eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <oauth-client-id>
eas build --platform ios --profile production
eas build --platform android --profile production
```

Production voice builds must use the authenticated Hume WebSocket proxy or temporary Hume access tokens. Direct Hume API keys are rejected in release builds.

`EXPO_PUBLIC_HUME_CONFIG_ID` is optional. Leave it empty to use Hume's default EVI configuration; set it to a valid configuration from the same Hume account to enable the custom CLM, tools, and branded voice.

## Privacy And Offline Behavior

- Permission requests show contextual explanations before location, notification, microphone, Bluetooth, or camera prompts.
- Settings > Privacy & data supports JSON export, conversation history, the privacy policy, and deletion of local app data.
- Typed AI companion messages are saved locally and replayed in order when online voice service returns.
- When Hume is unavailable, the safety call offers bundled offline responses and clearly labels unsent messages.
- Development routes and mock services remain gated from production builds.

See [PRIVACY.md](./PRIVACY.md) for the data collection and privacy manifest summary.
