# Migration Plan: `emo_ios` prototype → `Veryloving`

The prototype (`emo_ios`, target name `Swift-EVIChat`) is a single-feature Hume
EVI chat client. `Veryloving` is the production app it grows into. We **keep the
prototype intact** as a reference and port its proven pieces deliberately, rather
than rewriting in place.

## Why a parallel project

- The prototype is one feature; the product is seven. Restructuring the existing
  `.xcodeproj` in place would churn it and lose the working reference.
- A clean target lets us adopt the new architecture (DI composition root,
  protocol seams, `async/await`, Keychain-first secrets) without half-migrated states.
- The two live side-by-side under `veryloving/` (`emo_ios/`, `Veryloving/`) until
  the companion port lands, then the prototype is archived.

## Component mapping

| Prototype (`EVIChat/…`) | Veryloving | Action |
|--------------------------|-----------|--------|
| `app.swift` (hardcoded `"YOUR_API_KEY_HERE"`) | `App/VerylovingApp.swift` + `KeychainStore` | **Replace** — key moves to Keychain (`KeychainKey.humeApiKey`); never in source. |
| `Utils/Logger.swift` (print-based) | `Core/Logging/AppLogger.swift` | **Replaced** by `os.Logger` (privacy-aware). |
| `Chat/Services/WebSocketService.swift` | Phase 3 `CompanionService` | **Port** — reuse `URLSessionWebSocketTask`, reconnect/backoff, ping logic. |
| `Chat/Services/AudioService.swift` (Linear16/48k, simulator support) | Phase 3 voice engine | **Port** — already solid; wrap behind a protocol. |
| `Chat/Services/ChatService.swift`, `Models/EVIMessage`, `ChatEntry`, `ChatMessage` | Phase 3 Chat models | **Port** mostly as-is. |
| `Chat/ViewModels/ChatViewModel.swift` | Phase 3 `CompanionViewModel` | **Refactor** — split connection/audio/state; reuse delegate→async bridge ideas. |
| `Chat/Views/*` (bubbles, controls, settings) | Phase 3 Chat `Views/` | **Restyle** with `Theme` + reuse layout. |
| `Models/Settings.swift` + `UserDefaults` extension | `Utils/UserDefaults+Codable.swift` | **Carried over** (extension already ported). |
| Protocol/delegate service pattern | Kept everywhere | **Pattern preserved** — it's why the prototype is testable. |

## Step-by-step

1. **Foundation (done):** scaffold, Core layer, Auth, BLE pairing, app shell, tests.
2. **Secrets hygiene (done):** no keys in source; `AppConfig` + Keychain + `.gitignore`
   cover `Secrets.xcconfig` / `GoogleService-Info.plist`.
3. **Phase 2 — SOS & contacts:** add `CoreLocation` capture to `SOSView.dispatchAlert()`,
   wire `POST /v1/sos`, build Contacts CRUD, register push token after onboarding.
4. **Phase 3 — Companion port:** copy `WebSocketService`/`AudioService`/chat models
   into `Features/Chat`, hide behind `CompanionService`, swap the placeholder tab.
   Move the Hume key to Keychain; prefer the proxied WebSocket (see API doc).
5. **Phase 4 — Subscriptions:** add StoreKit 2 / RevenueCat behind
   `SubscriptionService`; drive `Feature.isAvailable(for:)` from validated tier.
6. **Phase 5 — Polish:** Firebase Analytics/Crashlytics (SPM + plist), full
   localization (EN→ZH/ES), accessibility audit, then archive `emo_ios`.

## Risk notes

- **BLE UUIDs are placeholders.** Real hardware won't be discovered until the
  firmware constants land in `AppConfig` + `WearableEvent.Opcode` (Open Question 2).
- **Apple Sign-In** needs the capability on a real provisioning profile to run on
  device (compiles fine without it; works in the simulator UI flow via the coordinator).
- **Keychain in unit tests** is skipped when the host lacks entitlements — the
  in-memory `SecureStore` keeps logic covered regardless.
