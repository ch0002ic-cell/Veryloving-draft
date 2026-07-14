# Final Feature Validation Report

Date: 2026-07-14
Release decision: **NO-GO until the P1 gates in `LAUNCH_CHECKLIST.md` are closed**

> Historical runtime evidence notice: the simulator observations and `118/118` validation result below describe the code exercised during that validation session. Later architecture changes are recorded separately in **Post-Validation Architecture Update — 13 July 2026** and are not retroactively marked as runtime passes.

## Status Legend

- **PASS (runtime):** exercised in the iOS development build.
- **PASS (automated):** covered by the deterministic test/build gates.
- **PARTIAL:** a safe fallback or part of the flow was exercised; production completion still needs external infrastructure or manual device QA.
- **BLOCKED:** this environment lacks a required account, credential, SDK, emulator, or physical device.
- **GAP:** the production capability is not implemented and must not be represented as working.

## Environment And Release Gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Native iOS build | PASS | A fresh Expo prebuild and CocoaPods integration compiled with Xcode 26.6 for the booted `veryloving-test` iOS 26.5 simulator. The app installed, launched, and remained crash-free during the exercised flows. |
| iOS runtime | PARTIAL | Authentication mock, onboarding, dashboard, map fallback, SOS screen, Quick Share, Voice AI failure/offline paths, voice persistence, and history were exercised. CoreSimulator automation became increasingly slow; remaining manual items are not marked as passes. |
| Android runtime | BLOCKED | `adb`, `emulator`, and an Android SDK/emulator were not installed. Android behavior was limited to tests, config checks, and the production export. |
| Physical iOS / BLE / background audio | BLOCKED | No signed physical device or VL01 wearable was available. |
| `npm run validate` | PASS | ESLint clean; 118/118 tests; Expo Doctor 20/20; iOS and Android production exports succeeded; temporary exports were removed. |

The simulator runtime used development-only `EXPO_PUBLIC_ENABLE_MOCK_PHONE_AUTH=true`. Voice fallback was also rechecked with `EXPO_PUBLIC_ENABLE_OFFLINE_MODE=true`. Neither flag is suitable for a production build.

## Runtime Findings And Fixes

| Priority | Finding and root cause | Fix | Verification |
| --- | --- | --- | --- |
| P1 | Hermes did not provide a usable `Intl.DisplayNames`, so the phone country picker displayed ISO codes and searching for “Singapore” returned no result (`src/utils/phone.js`). | Added a complete 245-region English fallback catalog while retaining localized `Intl.DisplayNames` when usable. | Runtime: human-readable names, Singapore search, `+65`, formatting, and valid-state UI. Automated: globalization coverage including missing/throwing/code-echo implementations. |
| P1 | Google Sign-In invoked the native module before confirming that its client ID existed, producing a native configuration error instead of a controlled app state (`src/context/AuthContext.js`). | Fail fast before loading/calling the native module. | Runtime: the missing-config path no longer produced the native RedBox. Automated: source-order guard and Google response/cancellation tests. Production OAuth completion remains blocked by credentials and backend token verification. |
| P2 | The country-picker modal created its safe-area view outside a modal-local provider, allowing the header to overlap the Dynamic Island (`src/components/CountryPicker.js`). | Added a modal-local `SafeAreaProvider` boundary. | Runtime screenshot inspection and an automated structural regression. |
| P1 | Quick Share was not reliably reachable from the map and did not provide a validated, honest native location payload (`app/(tabs)/map.js`, `app/quick-share-location.js`). | Added a common validated snapshot builder, recent-cache handling, retry feedback, and native `Share` integration. | Runtime: iOS share sheet opened with a timestamped cached coordinate. Automated: valid, cached, invalid, native-failure, and map-wiring tests. |
| P1 | Safety-mode taps could race local persistence and the UI could imply a safety action beyond the data actually saved (`app/(tabs)/index.js`). | Serialized mode changes, awaited persistence, restored the control state on failure, and limited copy to the local preference. | Automated source/persistence/error-state checks. The simulator exposed all three labelled controls; the off-screen automation bridge stalled while invoking one, so runtime transition is not claimed. |
| P1 | “Remove device” could leave remembered metadata or allow an in-flight reconnect to restore the removed wearable (`app/device-management.js`, `src/context/AppContext.js`). | Clear persisted identity first, invalidate stale reconnect generations, then make native disconnect best-effort with honest feedback. | Automated removal, hydration, disconnect-failure, and storage-failure tests. Physical BLE remains blocked. |
| P2 | Onboarding’s voice action did not provide a complete in-flow selector (`app/(auth)/tutorial/choose-voice.js`). | Added the four voice profiles, selected state, serialized persistence, user feedback, and completion/skip controls. | Runtime selector rendering; production voice selection also changed to Muscleman and persisted through a reload. |
| P1 security | Verbose production logging and nested credential-shaped values could leak or create noisy diagnostics (`src/utils/logger.js`). | Suppress verbose voice/info logs outside development and recursively redact secrets and bearer tokens while retaining actionable warnings/errors. | Runtime Hume error log showed redacted fields; the recursive sanitizer regression passes, and the remaining direct console calls are limited to explicit CLI/server/config diagnostics and the logger transport. |
| P2 | The offline response for “safety tips” was generic (`src/mocks/offlineResponses.js`). | Added deterministic, conservative safety guidance for the safety-tip prompt. | Automated regression; the preceding generic response and its local persistence were reproduced at runtime. |
| P2 maintenance | `hume-patch.js` duplicated active Hume lifecycle code and had no references. | Removed the dead file. | Repository search, lint, tests, and both exports pass. |

No P0 crash or data-loss defect was reproduced in this pass.

## Feature Matrix

### Authentication And Onboarding

| Flow | Status | Result |
| --- | --- | --- |
| Apple Sign-In | PARTIAL | Button rendered. Provider completion needs a signed build, Apple test account, entitlement evidence, and backend identity-token validation. |
| Google Sign-In | PARTIAL | Button rendered and missing-config handling is now controlled. Provider completion needs OAuth credentials and backend token validation. |
| Phone entry | PASS (runtime) | Singapore search, `+65`, national formatting, validation, and Send Code navigation worked. |
| SMS verification | PASS (runtime, mock only) | Invalid `000000` stayed on the screen with feedback; development code `123456` completed sign-in and opened onboarding. Real SMS is a GAP/external backend gate. |
| Logout / local purge | PASS (automated) | Secure credentials and all tracked local stores are drained/purged without stale writers. Runtime logout was not repeated after evidence collection because it is destructive to the test session. |
| Session persistence | PASS (runtime) | Reload retained the authenticated user, completed onboarding, and selected Muscleman voice. Server-side expiry/refresh validation is a GAP. |
| Location permission | PARTIAL | Contextual explanation and native request path rendered; Skip advanced correctly. Grant/deny matrix still needs manual device QA. |
| Notifications | PARTIAL | Contextual explanation and native request path rendered; Skip advanced correctly. APNs and signed-delivery testing are blocked. |
| Microphone / Bluetooth | PARTIAL | Contextual permission services and typed failures are covered; native prompts require the relevant voice/BLE flows and physical-device QA. |
| Camera / photo library | GAP | Native descriptions exist, but there is no current user-invoked capture/picker feature. Remove the declarations or implement and review the intended flow before submission. |
| Device check / tutorials | PASS (runtime) | NorthStar device check, Capybear introduction, voice selector, completion gate, and dashboard navigation rendered without a crash. |

### Safety, Map, And Emergency

| Flow | Status | Result |
| --- | --- | --- |
| Home mode | PASS (runtime) | Dashboard rendered the selected companion, current local mode, core actions, and device state. |
| Guardian / Emergency preference | PASS (automated) / PARTIAL runtime | Labelled controls exist and persistence/error behavior is covered. There is no backend guardian notification or remote state acknowledgement. |
| Map load / puck | PARTIAL | Public Mapbox token was absent, so the app correctly used its deterministic cached-location fallback. Native tiles and puck remain blocked by a production token. |
| Danger zones | PASS (runtime fallback) | Both local zone cards rendered. They are static local data, not backend-delivered risk intelligence. |
| Avoided zones / route guidance | GAP | No production route or avoidance backend/client implementation exists. |
| Quick Share | PASS (runtime) | Native share sheet opened with a one-time, timestamped location snapshot. Revocable live links, recipients, and expiry are a backend GAP. |
| SOS screen | PASS (runtime) | Missing-contact state and Activate/AI/Cancel actions rendered. Automated tests ensure cancellation/failure never claims activation and dialer-open is not represented as dispatch. |
| Safety call | PASS (runtime fallback) | See Voice AI below. |
| Emergency contacts | PARTIAL | Add/display/delete/call are wired and persistence is tested. A distinct edit-existing-contact flow is not implemented. |

### BLE Wearable

| Flow | Status | Result |
| --- | --- | --- |
| Bluetooth off / permission denied / no device | PASS (automated) | Each maps to a stable actionable error code/message. |
| Scan / pair / connect | BLOCKED | Simulator cannot validate BLE; no physical VL01 was available. |
| Remember / reconnect / unpair | PASS (automated) | Metadata is normalized, one reconnect state is restored, stale reconnects cannot re-add an unpaired device, and disconnect failure is surfaced honestly. |
| Battery | GAP | No approved VL01 GATT battery characteristic is implemented; the UI keeps battery unknown instead of inventing a value. |
| Background / foreground | BLOCKED | Requires physical-device BLE testing and the approved hardware protocol. |

### Voice AI

| Flow | Status | Result |
| --- | --- | --- |
| Voice list / selected badge | PASS (runtime) | Four avatars and preview controls rendered; selecting Muscleman updated the dashboard and survived reload. |
| Preview audio | PARTIAL | Controls and bundled files are present and exports include them. Audible routing was not independently verified by automation. |
| Missing Hume credentials | PASS (runtime) | Start Call moved to “Connection interrupted,” displayed “Voice AI is not configured yet. Please contact support.”, and offered the offline companion without a crash. |
| Offline call and chat | PASS (runtime) | Forced-offline call connected; “Safety tips” appeared as a user message and received a local assistant response. |
| Safety-tips tool | PASS (automated) / BLOCKED online | Offline deterministic guidance and CLM tool payloads are tested. A real Hume tool round trip needs production Hume/CLM credentials. |
| Conversation history | PASS (runtime) | The offline exchange appeared in the history screen with Resume/Delete controls. |
| Offline queue / retry | PASS (automated) | Ordering, exponential backoff, accepted-only removal, manual retry, and cleanup races pass. Real airplane-mode-to-Hume replay remains a credential/device test. |
| Real-time audio | GAP/BLOCKED | The current recorder does not supply production continuous 48 kHz mono Linear16 chunks. Physical-device routing, interruptions, background audio, and lock-screen behavior remain stop-ship gates. |

### Settings, Privacy, And Global UI

| Flow | Status | Result |
| --- | --- | --- |
| 155-language catalog / search | PASS (automated) | Catalog/key/placeholder parity, registry coverage, search metadata, and persistence pass. Runtime visual switching was not completed after CoreSimulator automation degraded. |
| RTL | PASS (automated) / BLOCKED visual | All eleven RTL catalogs are flagged and native RTL is enabled. Arabic layout still needs manual visual/device QA. |
| Privacy export | PASS (automated) | Snapshot content, temporary-file cleanup, and native sharing path are covered. A final manual Settings share-sheet check remains. |
| Delete data | PASS (automated) | Tracked writers drain, local records and SecureStore auth are removed, and ancillary native-cache failures cannot preserve PII. Remote/vendor deletion is a GAP. |
| Account | PARTIAL | Current identity and logout action are wired. Production refresh/revocation is not implemented. |
| Device management | PASS (automated) / BLOCKED hardware | Empty, reconnecting, remove, and disconnect-failure states are covered; real device behavior is blocked. |
| Responsive layout | PARTIAL | Exercised on one Dynamic-Island simulator; the country modal overlap was fixed. iPhone SE, iPad, Dynamic Type, rotation, and screen-reader matrices remain manual. |
| Translation visual review | BLOCKED | French, Spanish, Chinese, and Arabic catalogs pass structural checks, but safety copy and visual fit require native-speaker/device review. The other 151 catalogs are explicitly machine-generated starting points. |
| Async feedback | PASS (runtime/automated) | Phone, location, Voice AI, sharing, and persistence paths expose loading/error states. |

## Console And Build Findings

- Fixed during this pass: Google native missing-client configuration error, Hermes country-name/search failure, and country-modal safe-area overlap.
- Expected configuration warnings: Mapbox public token absent; Hume credentials absent. Both produced deterministic, user-facing fallback states.
- Development-only Hume `console.error` output triggered the React Native LogBox toast while the app simultaneously displayed the correct in-app message. Production verbose logs are suppressed/redacted.
- A repeated `Sending onAnimatedValueUpdate with no listeners registered` warning was observed from the development/native animation stack; no app crash or broken flow accompanied it.
- Xcode emitted dependency deprecation, deployment-target, and Swift concurrency warnings from React Native/Expo/Mapbox/Google/BLE pods. The application target still built successfully.
- CoreSimulator service and macOS accessibility automation became progressively slow after many deep-link/screenshot operations. This limited later manual checks; it is recorded as harness instability, not converted into app passes or failures.

## Post-Validation Architecture Update — 13 July 2026

After the runtime session above, the repository added the following production-oriented code paths:

| Area | Implemented after validation | Evidence boundary / remaining gate |
| --- | --- | --- |
| Authentication | Apple/Google identity tokens are exchanged at `POST /v1/auth/exchange`; Twilio Verify phone auth uses signed five-minute start/check challenges and opaque phone subjects. The server issues access/refresh JWTs, and `/v1/auth/refresh` rotates the client-held pair while the app renews across expiry/cold-start/foreground. | Automated only. Signed provider/phone completion, production credentials, distributed abuse controls, persistent refresh-family reuse detection/revocation, deletion tombstones, provider credential-state checks, and uniform request-level 401 retry remain open. |
| Voice gateway authentication | Proxy URLs contain no app bearer. `/api/voice/hume-ws` requires the session JWT in the first TLS frame, verifies `voice:connect`, then opens Hume with the server-only key. | Automated only. The JWT is not a single-use voice ticket; production ingress, rate limits, revocation/replay, ownership-bound resume/configuration, quotas, and load tests remain open. |
| Real-time audio | A root `expo-audio` stream requests 48 kHz mono Int16 buffers; the audio service validates/base64-encodes PCM and Hume sends chunks with backpressure protection. | Automated only. Continuous frame timing, two-way audio, interruption, echo, Bluetooth routing, background/foreground, lock screen, and cleanup require signed physical devices. |
| VL01 GATT | Approved configuration can filter scanning, normalize short/vendor UUIDs, time-bound discovery/read/write, read/conditionally monitor battery, surface raw status/events, observe degradation/disconnects, and serialize reconnect backoff. Missing protocol fails closed. | Automated only. Firmware-approved battery/status/event/command semantics, ownership/secure pairing, background behavior, and physical hardware remain open. |
| Safety backend | Session-authenticated DynamoDB endpoints migrate/synchronize account-bound contacts, maintain idempotent current safety state, durably accept retry-safe SOS records, and export/delete account Dynamo records. | Automated only. Acceptance is storage, not guardian delivery. Delivery/receipts, deletion tombstones/session revocation, vendor privacy orchestration, retention approval, and production DynamoDB remain open. |
| Animation lifecycle | The app-owned Safety Call pulse now uses a Reanimated shared value with explicit cancellation instead of React Native's legacy `NativeAnimated` emitter. | On 14 July, a clean Debug build installed on the iOS 26.5 simulator completed cold launch, onboarding/account transitions, and an isolated active-indicator probe with no matching `onAnimatedValueUpdate` log entry. The probe does not claim an authenticated end-to-end Safety Call. |

Nothing in this section changes the earlier runtime statuses. It narrows several code gaps into deployment, security, data-migration, and physical-validation gates.

The final post-change release validator passed on 13 July 2026: ESLint clean; 163/163 tests with no skips/failures; Expo Doctor 20/20; iOS export at 2,550 modules/8.6 MB Hermes; Android export at 2,633 modules/8.8 MB Hermes; exit 0 with temporary exports removed. Root and server production dependency audits both reported 0 vulnerabilities after the narrow `xcode.uuid=11.1.1` override; the resolved tree and CommonJS `v4` compatibility were checked. This is deterministic build evidence, not a new simulator/device validation session.

The 14 July 2026 follow-up validator also exited 0: ESLint clean; 215/215 tests; Expo Doctor 20/20; iOS export at 2,557 modules/8.7 MB Hermes; Android export at 2,640 modules/8.9 MB Hermes; temporary exports removed. It covered the final auth-session envelope, production phone flow, Vercel HTTP adapter, privacy cleanup continuation, Reanimated Safety Call pulse, and notification/SecureStore entitlement preflights. It did not repeat the dependency audits. The narrow animation run and buffer-clean entitlement run add simulator evidence only; they are not provider, Hume, physical-device, or authenticated Safety Call evidence.

## Final UI And Staging Follow-Up — 14 July 2026

This follow-up validates the current Railway staging contract and the final UI changes without upgrading externally blocked flows to passes.

### UI and accessibility fixes

| Finding | Fix | Evidence |
| --- | --- | --- |
| Semantic orange, red, green, blue, and gold states did not consistently reach WCAG 2.1 AA contrast on light surfaces. | Added dedicated accessible foreground/action tokens while retaining the original palette for decorative use. Error, warning, success, status, loading, voice, and selected-state components now use the semantic tokens. | Automated contrast checks require 4.5:1 for normal semantic text and 3:1 for controls/large action treatment. |
| Input outlines and placeholder treatment were too faint. | Added a shared 3:1 control-border token and explicit readable placeholder colours to every current `TextInput`. | Repository-wide input regression plus simulator inspection. |
| Hidden native headers left protected detail screens without an obvious way back. | Added a localized, RTL-aware, 48-point back control to settings, voices, friends, contacts, device management, history, sharing, debug, and character detail screens. | Automated route/header checks; native navigation remains gesture-enabled. |
| Fixed rows, fixed content widths, and keyboard-sensitive forms could truncate or obscure content. | Removed picker-row truncation, allowed variable row heights, capped general content at 720 points on tablets, and added keyboard-safe/scrollable contact, verification, onboarding, and safety-call layouts. | iPhone 17, compact iPhone 17e, and 11-inch iPad simulator inspection. |
| The onboarding image reduced legibility and the shared route-entry transition could leave the iPad content transparent after the route loaded. | Added a high-opacity cream copy panel and removed the nonessential global entrance-opacity gate. Local feedback animations remain. | The initial iPad run reproduced background-only content; the rebuilt/relaunched route then rendered Bestie, title, copy, and CTA. A regression prevents reintroducing a shared `entering` gate. |
| Switches and contact actions lacked complete assistive labels/busy states. | Added localized switch labels/hints and contact-specific call/remove labels with serialized busy/disabled state. | Source regression and manual rendering inspection. |

The app deliberately declares a light-only interface (`userInterfaceStyle: light`); this pass therefore does not claim system dark-mode support. All 155 selectable locale files still have complete structural key/placeholder parity, but native-speaker review—especially safety-critical copy and the 11 RTL catalogs—remains a launch gate.

### Current simulator and console evidence

| Check | Result | Boundary |
| --- | --- | --- |
| Native iOS build | **PASS** | Xcode 26.6 built the Debug app for the iOS 26.5 simulator with `CODE_SIGNING_ALLOWED=NO`. The installed Expo CLI does not accept the requested `expo run:ios --simulator` option, so the equivalent workspace/scheme build and `simctl` launch were used. |
| Responsive onboarding | **PASS** | iPhone 17, compact iPhone 17e, and 11-inch iPad portrait layouts rendered without overlap; copy and CTA remained readable and Bestie remained visible. This is not a complete all-screen tablet/Dynamic Type/screen-reader matrix. |
| Historical warning regression | **PASS** | Timestamped iPhone and iPad queries contained no `onAnimatedValueUpdate`, notification-registration Keychain, Auth SecureStore, Dev Launcher file-scheme, fatal, or unhandled-error signature during the captured smoke-test windows. |
| Android runtime | **BLOCKED** | No Android SDK, `adb`, emulator, or physical Android device is installed in this environment. Android evidence remains automated checks plus the production export. |

### Railway staging and provider contract evidence

| Integration | Result | Evidence / limitation |
| --- | --- | --- |
| Backend health | **PASS** | `GET /health` returned HTTP 200 with `status: ok` and service `veryloving-hume-clm`. |
| Auth exchange surface | **PASS, fail-closed contract** | An empty exchange returned HTTP 400 (`provider and idToken are required`); a synthetic invalid Google JWT returned HTTP 401 in the staging probe. No real Apple/Google account or provider credential was available, so provider completion, secure persistence after a real exchange, restart, and logout are not marked as runtime passes. |
| Phone verification | **BLOCKED by staging configuration** | `POST /v1/auth/phone/start` returned HTTP 503 with `PHONE_AUTH_NOT_CONFIGURED`. Twilio Verify is intentionally disabled on this service. |
| Safety contacts and SOS | **BLOCKED by staging configuration** | `GET /v1/emergency-contacts` returned HTTP 503 because the production safety API/Dynamo configuration is intentionally disabled. CRUD, synchronization, and SOS acceptance cannot be represented as staging passes. |
| Hume control plane | **PASS, fail-closed contract** | Unauthenticated `POST /v1/hume/session/configure` returned HTTP 401. |
| Hume WebSocket authentication | **PASS, fail-closed contract** | An invalid first-frame token received `auth_error` and close code 4001. Existing staging evidence also proves a synthetic first-party `voice:connect` session reached Hume `auth_ok`; it does not prove a signed mobile provider session, `chat_metadata`, PCM capture/playback, or tool execution. The four bundled profile labels are not Hume UUIDs and are deliberately not forwarded; online calls use the approved configured/default voice until Product either provisions canonical IDs for every marketed acoustic choice or relabels the choices as personas. |
| Mapbox credential | **PASS, service check** | The ignored local public token returned HTTP 200 from the Mapbox styles API without being printed. Native tiles, location puck, permissions, and backend zones still require development-build/device interaction. |
| VL01 BLE | **BLOCKED by protocol/hardware** | VL01 is disabled and its firmware-approved UUID registry is absent; there is no physical wearable. The implemented GATT/reconnect behavior remains automated-only evidence. |

The public environment validator, automatic EAS production gate, and production container startup now apply the same canonical-UUID rule to Hume configuration and voice identifiers. This prevents display slugs or malformed IDs from passing local validation and then failing only after a release reaches Hume; the server also validates every entry in its comma-separated voice allowlist.

### Final deterministic gates

- Development environment validation: **16 configured/valid, 6 intentional optional warnings, 0 errors**.
- ESLint: **clean**.
- Tests: **241/241 passed**, no failures, cancellations, skips, or todos.
- Expo Doctor: **20/20 passed**.
- iOS Hermes export: **2,558 modules, 8.7 MB**.
- Android Hermes export: **2,641 modules, 8.9 MB**.
- Native iOS Debug simulator build: **succeeded**.

The codebase is stable for continued staging/device QA, but the release decision remains **NO-GO** until the open production-service, signed-provider, physical-device, Android, APNs, localization, security/load, and store gates below have objective closure evidence.

## Remaining Stop-Ship Items

1. Production deployment of provider/phone exchange and refresh plus Twilio Verify policy, distributed abuse controls, persistent refresh-family reuse detection/revocation, deletion tombstones, uniform request-level 401 retry, and account isolation.
2. Signed-device verification/migration of the existing account-bound SecureStore contact cache, plus encrypted account-bound storage for settings, location, queues, transcripts/history, and remaining resilience records.
3. Production security/load testing of the implemented authenticated Hume gateway, production EVI/CLM configuration, and signed-device PCM validation.
4. Real SOS/guardian delivery and receipts, production Mapbox routes/avoidance/live sharing, push, remote privacy deletion/tombstones, and session revocation.
5. Approved physical VL01 battery/status/event/command semantics, secure ownership/pairing, reconnect, and lifecycle validation.
6. APNs/FCM delivery, signed iOS physical-device matrix, and Android emulator/physical-device matrix.
7. Store privacy/legal reconciliation and native-speaker safety-copy review.

Owners, required evidence, environment variables, test procedures, and the final Grace handoff are maintained in `LAUNCH_CHECKLIST.md`.

## Job-Requirement Alignment

- **Native iOS:** native CNG build/CocoaPods diagnosis, entitlements/privacy-manifest checks, SecureStore sessions, permission behavior, audio lifecycle tests, and a later Expo native PCM path; physical audio behavior remains unverified.
- **Full stack:** tested CLM endpoints and subsequently added provider exchange, session JWTs, an authenticated WebSocket gateway, and DynamoDB safety endpoints with explicit deployment boundaries.
- **Security and architecture:** fail-closed routes/provider validation, access/refresh renewal, user-bound onboarding, SecureStore contact migration, first-frame WS authentication, redacted logs, cleanup locks, and honest local-vs-remote semantics; stateless refresh revocation/reuse and plaintext remaining stores remain stop-ship risks.
- **BLE:** permission split, typed errors, account-bound persistence/unpair semantics, and later timed GATT battery/raw-channel/write/disconnect/reconnect logic; firmware semantics, hardware, ownership, and secure pairing remain blocked.
- **Voice AI:** Hume error classification, bounded reconnects, offline/history/queue/tool behavior, and later PCM plus gateway paths; production Hume and signed-device evidence remain blocked.
