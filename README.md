# VeryLoving Expo App

VeryLoving is an Expo Router safety companion with onboarding, location and Mapbox safety views, NorthStar BLE jewelry, emergency contacts and SOS flows, social features, and Hume EVI voice conversations with local history and offline fallback.

## Development Setup

### Prerequisites

- Node.js 22 or newer
- npm
- Xcode and an iOS simulator for iOS development
- CocoaPods for native development builds
- An Expo development build for Mapbox, BLE, Google Sign-In, and complete audio behavior

Clone and install:

```bash
git clone https://github.com/ch0002ic-cell/Veryloving-draft.git
cd Veryloving-draft
npm install
cp .env.example .env
```

Keep all server secrets out of `.env`. Expo variables beginning with `EXPO_PUBLIC_` are bundled into the app and must only contain public configuration.

Start Metro:

```bash
npx expo start
```

Expo Go provides graceful fallbacks for native-only features. For the native feature set, create and run a development build:

```bash
npx expo prebuild
npx expo run:ios
```

The generated app enables background audio for active safety calls and Bluetooth central mode for NorthStar. Confirm background microphone behavior on a physical device; the iOS simulator cannot validate microphone routing, BLE, echo cancellation, or lock-screen behavior reliably.

This repository intentionally tracks `ios/` and `android/`. After changing `app.json` plugins or native settings, run `npx expo prebuild`, review the native diff, and commit both sides together. Expo Doctor's non-CNG synchronization warning is therefore expected; native configuration is verified explicitly in CI/release checks.

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

The suite covers conversation persistence, offline queue ordering and exponential backoff, manual retry, CLM authentication, OpenAI-compatible SSE, safety prompt injection, upstream timeout fallback, Hume protocol payloads, settings persistence, and user-facing error sanitization.

Validate the production JavaScript bundle:

```bash
npx expo export --platform ios
```

Before release, manually verify on an iOS development build:

1. Start and end an online and offline safety call.
2. Queue a typed message in airplane mode, reconnect, and confirm it sends once.
3. Force a delivery failure and use the message-level Retry control.
4. Preview all four voices and relaunch the app to confirm the selection persists.
5. Start NorthStar scanning, background the app, and confirm scanning stops.
6. Use React DevTools Profiler on the Map tab and confirm location/status updates do not repeatedly commit the memoized native map surface.

## EAS Builds

Set production build variables in EAS, never in committed files:

```bash
eas secret:create --scope project --name RNMAPBOX_MAPS_DOWNLOAD_TOKEN --value <token>
eas secret:create --scope project --name EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN --value <public-token>
eas build --platform ios --profile production
```

Production voice builds must use the authenticated Hume WebSocket proxy or temporary Hume access tokens. Direct Hume API keys are rejected in release builds.

## Privacy And Offline Behavior

- Permission requests show contextual explanations before location, notification, microphone, Bluetooth, or camera prompts.
- Settings > Privacy & data supports JSON export, conversation history, the privacy policy, and deletion of local app data.
- Typed AI companion messages are saved locally and replayed in order when online voice service returns.
- When Hume is unavailable, the safety call offers bundled offline responses and clearly labels unsent messages.
- Development routes and mock services remain gated from production builds.

See [PRIVACY.md](./PRIVACY.md) for the data collection and privacy manifest summary.
