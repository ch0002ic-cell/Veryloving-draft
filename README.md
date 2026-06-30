# Veryloving iOS

The companion app for Veryloving's "Wearable Guardian" smart jewelry: BLE
pairing, one-touch SOS, an empathic AI companion, and subscription-gated
features — built on the foundation of the `emo_ios` Hume EVI prototype.

> **Status:** Phase-1 foundation. The architecture, auth, and BLE-pairing modules
> are implemented and runnable end-to-end against mock services. SOS, contacts,
> the AI companion port, push, and subscriptions are scaffolded as clearly
> labelled placeholders (see [Roadmap](#roadmap)). The app **builds and runs with
> zero external configuration.**

---

## Quick start

The Xcode project is **generated** from [`project.yml`](project.yml) with
[XcodeGen](https://github.com/yonsig/XcodeGen) so the `.pbxproj` never has to be
hand-edited or merge-resolved.

```bash
# 1. Install the generator (one time)
brew install xcodegen

# 2. Generate Veryloving.xcodeproj
cd Veryloving
xcodegen generate

# 3. Open & run (⌘R) — or from the CLI:
open Veryloving.xcodeproj
xcodebuild -project Veryloving.xcodeproj -scheme Veryloving \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
```

On first launch you can sign in with **`demo@veryloving.ai`** / any 6+ character
password (mock auth), or create a new account. The simulator uses a mock BLE
service that surfaces fake "Veryloving Pendant/Bracelet" devices so the pairing
flow is fully demoable without hardware.

### Requirements

- Xcode 16+ (developed against Xcode 26), iOS 16.0+ deployment target
- XcodeGen (`brew install xcodegen`)
- Swift 5 language mode (built by the Swift 6 toolchain)

---

## Configuration (no secrets in the repo)

Nothing secret is committed. Configuration flows through `Core/Networking/AppConfig.swift`:

| What | How to set it | Default |
|------|---------------|---------|
| Backend host | `VL_API_HOST` in a git-ignored `Config/Secrets.xcconfig` | empty → **mock services** |
| BLE service / characteristic UUIDs | Constants in `AppConfig` | **placeholders** (⚠️ replace, see Q2) |
| Hume API key / Config ID | Stored at runtime in the Keychain (`KeychainKey.humeApiKey`) | none |
| Firebase | add `GoogleService-Info.plist` + SDK (both git-ignored) | abstraction only (console logging) |
| Apple Developer Team | `DEVELOPMENT_TEAM` in `project.yml` or Xcode Signing | unset |

**Go live in one step:**
```bash
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig   # then set VL_API_HOST
xcodegen generate
```
When `VL_API_HOST` is empty, `AppConfig.useMockServices` is `true` and the app
runs against in-memory mocks. Set it to your server's host and **every** networked
subsystem (auth, SOS dispatch + offline queue, push-token upload, subscription
validation) switches to its live implementation at once. xcconfig treats `//` as a
comment, so the scheme + host are kept separate and composed into `VL_API_BASE_URL`
in Info.plist — never put a full URL in xcconfig.

**Production hardening already in place (Phase 3):** automatic token refresh on
401 (single-flight, signs out on failure), a persisted **offline SOS queue** that
auto-retries when connectivity returns, **push notifications** (categories +
actions + tap routing + APNs token upload), an **analytics abstraction**
(Firebase-ready) instrumented at key events, biometric **App Lock**, and a
completed onboarding flow (permissions + paywall).

---

## Architecture

MVVM + protocol-oriented services + a composition root, carried forward from the
prototype's protocol/delegate style and modernised with `async/await` and Combine.

```
Veryloving/
├── App/            VerylovingApp, AppDelegate, AppEnvironment (DI), RootView
├── Core/
│   ├── Logging/        AppLogger (os.Logger)
│   ├── Security/       KeychainStore, BiometricAuthenticator
│   ├── Networking/     APIClient, Endpoint, APIError, TokenProvider, AppConfig
│   ├── Bluetooth/      WearableService (protocol + mock), BluetoothManager (live)
│   └── DesignSystem/   Theme, Haptics, FeaturePlaceholder
├── Models/         User, AuthToken, WearableDevice, WearableEvent
├── Features/
│   ├── Auth/           AuthService, SessionStore, AuthViewModel, Apple Sign-In, Views
│   ├── Wearable/       WearableViewModel, pairing & detail Views
│   ├── Home/           HomeView (tabs), GuardianHomeView (SOS hero)
│   ├── SOS/            SOSView (countdown → dispatch → confirm)
│   ├── Chat/ Contacts/ Settings/ Onboarding/   (Settings & Onboarding real; others placeholders)
└── Resources/      Info.plist, entitlements, Assets, Preview Content
VerylovingTests/    Event parsing, AuthViewModel, SecureStore
```

**Key seams** (where real implementations swap in for mocks behind a protocol):
`AuthService`, `WearableService`, `APIClient`, `SecureStore`, `BiometricAuthenticating`.

### Dependency strategy — why native-first

The spec named Alamofire, Starscream, SwiftKeychainWrapper, Firebase, and
RevenueCat. The foundation deliberately uses **native equivalents** so the
project builds and is TestFlight-clean with no secrets or config files:

| Specced | Used now | Why / how to swap |
|---------|----------|-------------------|
| Alamofire | `URLSession` (`APIClient`) | URLSession covers our JSON+auth needs with TLS 1.3. Swap behind `APIClient`. |
| Starscream | `URLSessionWebSocketTask` | Already proven in the prototype; reuse on port. |
| SwiftKeychainWrapper | `Security` (`KeychainStore`) | Zero-dependency, typed keys. |
| Firebase Analytics/Crashlytics | `os.Logger` | Add Firebase SPM package + `GoogleService-Info.plist` in Phase 5. |
| RevenueCat | — (Phase 4) | Add behind a `SubscriptionService` protocol. |
| GoogleSignIn | — (stubbed) | Needs OAuth client ID (Q1). Apple Sign-In is fully wired. |

`project.yml` keeps the intended SPM packages commented in one place to add per phase.

---

## Build & test

```bash
xcodebuild -project Veryloving.xcodeproj -scheme Veryloving \
  -destination 'platform=iOS Simulator,name=iPhone 16' test
```

> **Toolchain note:** a full simulator build needs an installed simulator
> **runtime whose version is ≥ your Xcode iOS SDK** (Xcode requires runtime ≥ SDK).
> If `xcodebuild` reports *"No simulator runtime version … available to use with
> iphonesimulator SDK version …"*, install the matching runtime via
> *Xcode → Settings → Components*. The sources themselves type-check cleanly
> against the iOS 16 simulator SDK in Swift 5 mode (verified with
> `swiftc -typecheck`), independent of which runtime is installed.

Covered today: the pure BLE event parser (8 cases), `AuthViewModel` (validation
+ sign-in/up success & error paths against `MockAuthService`), and `SecureStore`
conveniences. `BluetoothManager`/`WearableViewModel` need device/integration
tests (CoreBluetooth has no simulator radio); the protocol seam keeps the view
model itself unit-testable via `MockWearableService`.

---

## Roadmap

Built on the spec's 5-phase plan. ✅ done · 🟡 scaffolded/placeholder · ⬜ not started

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Project setup, auth, UI skeleton, **BLE pairing** | ✅ |
| 2 | SOS dispatch (CoreLocation + map + backend), contacts CRUD (CoreData) | ✅ dispatch UI, GPS capture, 30-min sharing, contacts CRUD/reorder/test-alert |
| 3 | AI voice companion (ported Hume EVI from `emo_ios`: WebSocket + AVAudioEngine + text/voice) | ✅ ported; key in Keychain; tier-gated |
| 4 | Subscriptions (StoreKit 2; RevenueCat-ready), feature gating | ✅ products/purchase/restore, paywall, tier→session gating |
| 5 | Onboarding (permissions + paywall), App Lock, analytics abstraction, accessibility | ✅ client-side; Firebase SDK pending plist |

**Phase 3 (production readiness) — client-side complete, credential-gated items remain.**
Built & verified: token refresh, offline SOS queue, push notifications, analytics
abstraction + instrumentation, onboarding completion, App Lock, accessibility pass,
`Secrets.xcconfig` config. **Still needs your inputs** (can't be done from here without
breaking the build / committing secrets):

| Blocked item | Unblock with |
|---|---|
| Live backend (auth/SOS/contacts) | a running server + `VL_API_HOST` (Q1) |
| SMS fan-out | Twilio creds on the backend (Q3) — app just POSTs `/v1/sos` |
| APNs delivery | real push cert + backend (Q1) — client is ready |
| Firebase Analytics/Crashlytics | add SDK + `GoogleService-Info.plist` (Q4) → `FirebaseAnalyticsService` |
| CloudKit contact sync | paid container + entitlement (Q2) → swap `NSPersistentCloudKitContainer` |
| Live subscriptions | real product IDs in App Store Connect (Q3) |
| Brand assets | logo/colors/fonts (Q5) → update `Theme` + asset catalog |

See [`docs/MIGRATION.md`](docs/MIGRATION.md) for moving from the prototype and
[`docs/BACKEND_API.md`](docs/BACKEND_API.md) for the backend contract.

---

## Open questions (blocking later phases)

These don't block the Phase-1 foundation but are needed to finish:

1. **Backend stack** (Firebase / AWS / custom) → sets `VL_API_BASE_URL` and auth scheme.
2. **Real BLE service & characteristic UUIDs** + the event wire format → replace the
   placeholders in `AppConfig` and the opcode table in `WearableEvent`.
3. **SMS provider** for SOS (e.g. Twilio via backend) → backend concern, see API doc §SOS.
4. **Brand assets** (logo, colors, fonts) → replace `Theme` tokens + asset catalog colors.
5. **App Store region** (US-only vs global) → localization scope & legal copy.
