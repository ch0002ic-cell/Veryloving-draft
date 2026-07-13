# VeryLoving Runtime Stability Report

Audit date: 13 July 2026
Fix commit: `69cb99c` (`fix: harden critical runtime safety flows`)

> Historical evidence notice: test counts, simulator observations, file references, and “remaining” findings below describe the `69cb99c` audit snapshot. They are preserved rather than rewritten as if later work had been exercised in that runtime session. See **Post-Validation Architecture Update — 13 July 2026** for the current code state and [COMPREHENSIVE_FINAL_AUDIT.md](./COMPREHENSIVE_FINAL_AUDIT.md) for the final handoff assessment.

## Executive Summary

The audit reproduced the app in an iOS development build, reviewed every core flow, and fixed the highest-risk failures found in authentication, onboarding, SOS, privacy export/deletion, Mapbox fallback behavior, phone calls, and Hume connection/audio lifecycle management.

The final deterministic suite passes 74/74, ESLint is clean, Expo Doctor passes 20/20, CocoaPods installs successfully, an unsigned iOS simulator build compiles, and final iOS and Android production exports succeed. A clean iOS simulator launch rendered the logged-out onboarding UI without a JavaScript crash.

At that audit snapshot, the app was materially safer and more stable but **not production-ready**. Real Hume PCM streaming, the production voice proxy and auth-token exchange, account-scoped encrypted PII storage, production SMS, complete VL01 GATT behavior, and several map/safety backend flows were still absent.

## Test Environment and Limitations

| Area | Result |
| --- | --- |
| Host toolchain | Node 22.23.1, npm 10.9.8, CocoaPods 1.17.0, Xcode 26.6 |
| iOS | iOS 26.5 simulator available; requested iOS 17 runtime was not installed |
| Native iOS build | `xcodebuild` Debug simulator build passed with `CODE_SIGNING_ALLOWED=NO` |
| Android | Android SDK, `adb`, emulator, and required JDK 17 were unavailable; no Android runtime claim is made |
| Physical hardware | No physical VL01, production push entitlement, real microphone routing, telephony, or background/lock-screen validation |
| External services | No local Mapbox, Google, Hume, SMS, or production auth credentials were present |
| UI automation | Simulator screen capture worked; automated taps were unavailable, and iOS presented a confirmation dialog for custom-scheme deep links |

The unsigned simulator build cannot access the app Keychain entitlement. The clean launch therefore logged these expected environment artifacts:

```text
[expo-notifications] Error reading persisted server registration info
Keychain access failed: A required entitlement isn't present.
[Auth] Could not restore the secure session
```

No JavaScript red screen or app exception appeared after the final clean bundle. Metro was deliberately bound through LAN/IPv4; an earlier localhost-only run exposed an Expo development-launcher IPv6 inspector failure for `ws://::1:8081`, which is a toolchain/runtime limitation rather than app logic.

## Verification Results

| Check | Final result |
| --- | --- |
| `npm install` | Passed |
| `pod install` | Passed, including the newly required Expo Sharing native module |
| `npm test` | **74/74 passed** |
| `npm run lint` | Passed |
| `git diff --check` | Passed before commit |
| `npx expo-doctor` | **20/20 passed** |
| `npx expo export --platform ios` | Passed; 2,523 modules in the final production export |
| `npx expo export --platform android` | Passed; 2,606 modules in the final production export |
| Clean iOS development bundle | Passed; 2,685 modules and onboarding rendered |
| Logged-out protected-route checks | Route guards covered by regression tests; simulator deep links reached the iOS confirmation dialog, so full automated tap-through was not claimed |

## Fixed Bugs

### AUTH-01 — Authentication and protected-route bypass

- **Priority:** P0 — unauthorized access / broken trust boundary
- **Reproduction:** In the old flow, submit arbitrary phone verification input, cancel or misconfigure a social provider, skip onboarding, or deep-link directly to a root feature screen.
- **Expected:** Only a verified account with completed onboarding can access tabs and safety/PII screens. Provider failure must fail closed.
- **Actual before fix:** The local phone path accepted weak input, provider fallbacks could create local identities, root screens lacked a complete route guard, and onboarding completion was not account-bound.
- **Root cause:** `src/context/AuthContext.js`, `app/_layout.js`, `app/(auth)/_layout.js`, `app/(auth)/verify-code.js`, and direct onboarding exits.
- **Fix:** Added explicit Expo Router protected groups; made Apple/Google identity-token absence fail closed; limited mock phone auth to an explicit development/test flag with exact code `123456`, a bound verification ID, and five-minute expiry; bound the versioned onboarding marker to the account; and routed every exit through `app/(auth)/completion.js`. Incomplete cold starts resume at `location-permission` (`app/index.js:9`).
- **Verification:** `tests/auth-hardening.test.cjs` covers route classification, provider boundaries, mock expiry, account binding, completion gates, cold-start resume, and permission-screen guards.
- **Status:** Fixed in `69cb99c`.

### DATA-01 — Cross-session data recreation during logout/deletion

- **Priority:** P0 — PII exposure across normal account transitions
- **Reproduction:** Sign out or delete data while a conversation/offline-queue/settings write is in flight, then sign in again.
- **Expected:** Cleanup is atomic from the UI's perspective and no completed in-flight write can recreate deleted user data.
- **Actual before fix:** Durable mutation queues and AppContext writes could complete after cleanup and recreate local records.
- **Root cause:** Cleanup did not drain or lock writers in `src/context/AppContext.js`, conversation history, and the offline message queue.
- **Fix:** `src/services/local-user-data.js:7-16` drains history/queue mutations, sweeps every `veryloving.*` key, and purges voice artifacts. Settings now locks and flushes AppContext writers before logout/deletion, removes secure auth/onboarding state first, and resets memory only after persistence cleanup.
- **Verification:** `tests/local-user-data.test.cjs` confirms queue drain and complete store removal; existing persistence/queue tests cover serialization.
- **Status:** Normal logout/deletion race fixed in `69cb99c`. Account-scoped encryption remains an open P1 gate below.

### SOS-01 — False emergency activation

- **Priority:** P0 — false safety assurance
- **Reproduction:** Trigger SOS with no callable emergency backend/contact or on a simulator without telephony.
- **Expected:** The app must never claim help was activated unless an external action was actually initiated.
- **Actual before fix:** A local notification could imply SOS activation without contacting anyone.
- **Root cause:** UI-side success semantics in the emergency service were not tied to a dialer result.
- **Fix:** `src/services/sos-flow.js:1-11` requires a callable contact, explicit confirmation, and a successfully opened dialer; the UI reports only `dialer_opened`. The fake activation notification was removed and failures are shown to the user.
- **Verification:** Four SOS regression cases cover missing contacts, cancellation, dialer success, and dialer failure.
- **Status:** Fixed in `69cb99c`.

### PRIV-01 — Privacy export failed at runtime

- **Priority:** P1 — broken privacy flow
- **Reproduction:** Open Settings > Privacy & data > Export on the current Expo SDK.
- **Expected:** Create a temporary JSON export, open the native share sheet, and remove the temporary file afterward.
- **Actual before fix:** The legacy filesystem call was incompatible with the installed Expo FileSystem API.
- **Root cause:** Stale API usage in `src/services/privacy.js` and no installed native sharing module.
- **Fix:** Migrated to Expo `File`/`Paths`, added `expo-sharing`, writes only to cache, checks share availability, and deletes the temporary file in `finally`.
- **Verification:** iOS native linking/build and both production exports passed; the share-availability and `finally` cleanup paths were statically reviewed.
- **Status:** Fixed in `69cb99c`.

### PERM-01 — Fragile onboarding permissions and incorrect resume point

- **Priority:** P1 — broken onboarding flow
- **Reproduction:** Double-tap location/notification enable, make the native permission request reject, or kill the app after sign-in but before permissions finish.
- **Expected:** One request/navigation at a time, actionable failure feedback, and a deterministic resume at the first incomplete step.
- **Actual before fix:** Rejections could become unhandled promises, rapid taps could push duplicate screens, and relaunch skipped directly to device check.
- **Root cause:** One-line async handlers and mismatched auth anchors in `app/(auth)` and `app/index.js`.
- **Fix:** Added request/navigation refs, busy states, `try/catch`, feedback banners, guarded skip actions, and a consistent `location-permission` resume anchor.
- **Verification:** Auth hardening tests plus clean logged-out iOS launch.
- **Status:** Fixed in `69cb99c`.

### MAP-01 — Blank Mapbox state, location dead-end, and invisible annotations

- **Priority:** P1 — broken map core flow
- **Reproduction:** Launch without `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`, deny location, or load a style/annotation that fails.
- **Expected:** Explain missing configuration or permission, retain a retry path, and visibly render user/zone markers.
- **Actual before fix:** Missing tokens/style failures could leave a blank surface, permission work could appear frozen, and empty `PointAnnotation` children were invisible.
- **Root cause:** No fail-soft token gate or style error fallback, combined permission/location work, and empty marker components.
- **Fix:** Added an explicit unavailable/fallback state, style-load fallback, separated permission from location acquisition, `LocationPuck`, and visible marker children (`app/(tabs)/map.js:26-30`).
- **Verification:** `tests/mapbox-config.test.cjs`, clean bundle/export, and static map component review.
- **Status:** Fixed in `69cb99c`; real routes/zones/sharing remain open.

### CALL-01 — Unsafe call launch and broken standalone pairing navigation

- **Priority:** P1 — broken emergency/device flow
- **Reproduction:** Initiate a safety/contact call on a device without a dialer, or open standalone jewelry setup and complete/cancel it.
- **Expected:** Check native support, report errors, and return to the correct parent screen.
- **Actual before fix:** `Linking.openURL` failures were not consistently handled, Android package visibility was incomplete, and standalone jewelry setup returned through onboarding.
- **Root cause:** Direct linking calls and a hard-coded onboarding route.
- **Fix:** Added typed `canOpenURL`/`openURL` handling in `src/services/phone-call.js`, user feedback, Android `ACTION_VIEW`/`tel` query generation (`plugins/withAndroidManifest.js:14-35`), and context-aware jewelry navigation.
- **Verification:** Phone-call unit tests, config-plugin tests, and Android export passed.
- **Status:** Fixed in `69cb99c`; real telephony still needs a physical-device check.

### VOICE-01 — Hume protocol, reconnect, and microphone lifecycle failures

- **Priority:** P1 — broken voice session / resource leak
- **Reproduction:** Connect to Hume, receive a terminal close, disconnect while microphone start is pending, or invoke a tool fallback.
- **Expected:** Send the documented payload fields, never reconnect terminal/auth failures, cap retries, and stop stale native microphone work.
- **Actual before fix:** Wire keys did not match the intended protocol, terminal sessions could reconnect, reconnect budgeting was fragile, and an async microphone start could survive disconnect.
- **Root cause:** `src/services/websocket/hume-protocol.js` and `hume-evi.js` lacked a terminal-close classifier and lifecycle generation.
- **Fix:** Corrected `audio.format` and `fallback_content`, classified terminal close/error/auth cases, bounded reconnect attempts, and added microphone generation/state invalidation (`hume-evi.js:437-486`).
- **Verification:** Protocol and lifecycle tests cover payloads, terminal closes, retry caps, stale starts, and recovery after native stop errors.
- **Status:** Transport/lifecycle bugs fixed in `69cb99c`; live PCM capture remains a launch gate.

### VOICE-02 — Overlapping playback, stale audio files, and offline retry stalls

- **Priority:** P1 — degraded/unstable voice flow
- **Reproduction:** Receive several audio messages rapidly, interrupt playback, disconnect during recording, or wait for a backed-off offline retry.
- **Expected:** Play responses sequentially, make interruption deterministic, clean cache/recordings, and schedule the next eligible retry.
- **Actual before fix:** Players could overlap, completion could stall indefinitely, temporary files accumulated, and retry backoff could lack a future wake-up.
- **Root cause:** No serialized playback queue/cancellation generation, incomplete artifact purge, and event-only queue flushing.
- **Fix:** Added sequential playback with cancellation and a 60-second timeout, removes each temporary file, purges iOS/Android recorder artifacts, deletes stopped recordings, merges hydrated history, and schedules backoff retries/network-restoration flushes.
- **Verification:** Full queue/history tests, Hume lifecycle tests, lint, native build, and both exports.
- **Status:** Fixed in `69cb99c`, subject to real PCM/backend limitations.

## Feature Coverage Matrix

| Feature | What was exercised | Result / limitation |
| --- | --- | --- |
| Authentication | Static audit, route/provider/mock/onboarding tests, logged-out iOS launch | Guards and fail-closed behavior fixed; production provider/backend validation unavailable |
| Onboarding | Initial screen runtime, permission error/double-tap/resume tests | Fixed; native prompts not fully tap-driven in this environment |
| Safety modes | Code/state review and route protection | Protected, but Home/Guardian/Emergency are not yet a backend-backed safety state machine |
| Map | Token/config tests, component/fallback audit, production bundles | Fail-soft behavior fixed; no Mapbox credential for live tiles/routes |
| Emergency | SOS and phone-call unit tests | False assurance fixed; no real phone/guardian dispatch test |
| BLE wearable | Permission/config review and existing BLE tests | No physical VL01; GATT behavior incomplete |
| AI voice | Protocol, lifecycle, queue, history, error, and CLM server tests | Deterministic layers pass; no real PCM stream, proxy, Hume credential, or WebRTC/device audio test |
| Settings/privacy | Export/delete/logout race review and tests | Modern export and cleanup implemented; encrypted per-account storage still required |
| UI/globalization | Clean onboarding render, static route/layout review, catalog/RTL tests | 155 catalogs have structural parity; 151 require native-speaker safety-copy review |

## Remaining Known Issues And Launch Gates At The `69cb99c` Snapshot

### P1 — must resolve before production

1. **Account-scoped encrypted PII storage.** Contacts, settings, offline messages, and transcripts still use shared `veryloving.*` JSON keys through `src/services/storage.js`. Normal logout/deletion is now safe, but session corruption or an account mismatch can hydrate prior plaintext data. Use an OS-protected per-account key, bind every sensitive store to user ID, migrate existing data, and purge/fail closed on mismatch.
2. **Backend-issued application sessions.** `src/context/AuthContext.js:99-115` still stores Apple/Google identity tokens as the app access token without backend exchange, refresh rotation, issuer/audience/expiry validation, credential-state checks, or 401 recovery. The token is also forwarded into the voice connection path. Add server-side provider JWT validation and short-lived VeryLoving access/refresh tokens; do not put bearer credentials in WebSocket query strings.
3. **Production phone verification.** The hardened mock is intentionally disabled outside development/test, and no SMS challenge/verification backend exists in this repository.
4. **Real Hume microphone streaming.** `src/services/audio.js:53-62` records a high-quality file but does not emit live chunks, while the WebSocket advertises 48 kHz mono Linear16 (`hume-protocol.js:57`). Implement a dev-client native PCM stream and verify interruption, echo, Bluetooth routing, backgrounding, and lock-screen behavior on real iOS/Android devices.
5. **Voice proxy/backend.** `.env.example` points to `/api/voice/hume-ws`, but the in-repo CLM server does not implement that authenticated WebSocket proxy. Provision the proxy, temporary Hume credentials, rate limiting, audit logging, and revocation before live voice testing.
6. **VL01 GATT implementation.** `src/services/ble.js:142-150` discovers/connects but reports a hard-coded 82% battery and lacks service/characteristic UUID reads, notifications, reconnection, and persisted device ownership. The physical protocol and hardware are required.
7. **Map/share/safety backend.** Quick Share is still an alert stub (`src/services/emergency.js:39`); danger points are hard-coded Toronto data (`mapbox-core.js:6`); route guidance, avoidance radii, live guardian links, remote SOS dispatch, and durable safety-mode transitions are absent.
8. **Remote notifications.** Local permissions/channels exist, but production push-token registration, backend delivery, revocation, and emergency-event semantics require a signed build and backend.
9. **Android runtime QA.** The Android export and config tests pass, but an API 36 emulator and physical Android device must run the entire matrix before release.

### P2 — follow-up polish

- Voice fallback/queued notice state can remain stale after an automatic successful reconnect.
- Native builds emit third-party warnings from Mapbox/BLE/Reanimated and older pod deployment targets; monitor and remove them during dependency upgrades.
- Perform native-speaker review of the 151 machine-generated catalogs, prioritizing emergency, consent, permission, and privacy text.
- Complete responsive and accessibility checks across every device size, RTL layout, dynamic type category, and screen-reader flow.

## Post-Validation Architecture Update — 13 July 2026

The following code was added after the historical runtime session above. It has deterministic test coverage but was not exercised with production credentials, DynamoDB, Hume, a signed physical device, or a VL01 wearable during that session:

- **Authentication:** Apple and Google identity assertions now go to `POST /v1/auth/exchange`. The server verifies provider JWT claims and issues distinct access/refresh JWTs. `POST /v1/auth/refresh` rotates the client-held pair; the app renews before expiry/on cold start/foreground, preserves offline state for network failures, and clears rejected sessions. Persistent refresh-family state, reuse detection/revocation, deletion tombstones, provider credential-state checks, production phone/SMS, and uniform request-level 401 retry remain open.
- **WebSocket authentication:** the client proxy URL no longer carries an app bearer or Hume connection choices. The first TLS-protected frame carries the VeryLoving JWT and bounded connection settings. The in-repository `/api/voice/hume-ws` gateway verifies the JWT and `voice:connect` scope before opening Hume with the server-only key. The JWT is not a single-use voice ticket; production rate limits, revocation/replay resistance, ownership-bound resume/session configuration, and load/ingress testing remain open.
- **PCM path:** a root-mounted `expo-audio` stream requests 48 kHz mono Int16 buffers, the audio service validates and base64-encodes headerless PCM, and the Hume service sends chunks with a backpressure limit. Physical evidence is still required for continuous frame timing, full-duplex audio, interruption, echo, Bluetooth routing, background/foreground, lock screen, and repeated cleanup.
- **BLE:** real-device scanning is filtered by a configured VL01 service UUID. Connection normalizes short/vendor UUIDs, bounds discovery/read/write operations, reads and conditionally monitors one-byte battery, surfaces configured raw status/events, performs bounded raw command writes, observes degradation/disconnection, and serializes reconnect backoff. The code fails closed without approved service/battery UUIDs. Firmware-approved semantics/decoding/commands, ownership/secure pairing, and physical/background testing remain open.
- **Safety backend:** account-authenticated DynamoDB endpoints now migrate/synchronize account-bound contacts, maintain idempotent current safety state, durably accept retry-safe SOS records, and export/delete the authenticated account's Dynamo records. `accepted` means stored, not delivered. Notification delivery/receipts, deletion tombstones/session revocation, vendor privacy orchestration, production retention, and live-table evidence remain open.

The original `74/74` result above remains the evidence for commit `69cb99c`; later suite totals belong in the final audit report and must not be backdated into this historical run.

For the post-change working tree, the final release validator subsequently passed ESLint, 163/163 tests with no skips/failures, Expo Doctor 20/20, and both production exports. Root and server production dependency audits also reported 0 vulnerabilities after the scoped UUID override and compatibility check. See [COMPREHENSIVE_FINAL_AUDIT.md](./COMPREHENSIVE_FINAL_AUDIT.md) for exact module/bundle results and the remaining P1 decision.

## Job-Description Alignment

- **Native iOS:** Installed and linked CocoaPods, produced a native simulator build, handled entitlements honestly, hardened asynchronous audio lifecycle, and subsequently implemented an Expo native PCM stream. Swift/SwiftUI is not part of this React Native repository, and physical audio behavior remains unverified.
- **Full stack:** Validated the Node CLM service and subsequently added provider exchange, first-party JWTs, an authenticated WebSocket gateway, and DynamoDB safety endpoints. This remains a Node rather than Next.js application; AWS infrastructure and production delivery systems are not provisioned.
- **Security and architecture:** Added fail-closed routes, account-bound onboarding, provider verification, scoped session JWTs, first-frame WS authentication, deterministic cleanup, and safe secret configuration. Refresh/revocation and encrypted per-account storage remain stop-ship gates.
- **BLE:** Added protocol-gated, timed GATT discovery/read/write, battery handling, raw status/events, disconnect degradation, and serialized reconnect while keeping firmware decoding/commands, ownership, secure pairing, and hardware behavior explicit.
- **Voice AI:** Added the PCM and gateway paths alongside corrected Hume payloads, terminal-close handling, bounded reconnects, playback serialization, offline retry scheduling, and artifact cleanup; production/device verification remains a launch gate.

## Recommended Next Verification Order

1. Add persistent refresh-family reuse detection/revocation, deletion tombstones, uniform request-level 401 recovery, and encrypt/account-bind every remaining local PII store.
2. Deploy and security/load-test the implemented auth, Hume gateway, CLM, and DynamoDB safety endpoints; add actual guardian/contact delivery and remote privacy operations.
3. Complete approved VL01 decoding/commands, secure ownership/pairing, and the physical-wearable matrix.
4. Connect production SMS, push registration/delivery, live map/share/route endpoints, and idempotent safety-mode transitions.
5. Run the complete manual matrix on signed iOS and Android builds with production-like credentials, then repeat tests, Doctor, native builds, and both exports.
