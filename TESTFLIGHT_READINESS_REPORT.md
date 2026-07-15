# VeryLoving TestFlight Readiness Report

Audit date: 15 July 2026

Primary acceptance environment: signed TestFlight build on physical iPhone/iPad

Environment available for this audit: iPhone 17 Pro simulator (iOS 26.5), static analysis, deterministic tests, and Expo exports

## Decision

- **Code and simulator baseline: PASS.** The audited source builds, exports, and passes all deterministic gates. The language switcher updates immediately and its preference survives a simulator cold restart.
- **TestFlight acceptance: NO-GO / BLOCKED — EXTERNAL.** No physical iPhone is connected, the authenticated Expo account cannot access the configured EAS project, and the locally readable production environment fails validation with nine release errors. No signed-device claim is made.
- **Safety-product launch: NO-GO.** Physical auth, Keychain, APNs, telephony, live Hume audio, VL01 hardware, background behavior, and production delivery still require release-build evidence and the open P1 gates in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).

## Fixes Applied in This Pass

| Finding | Root cause | Fix and regression coverage |
| --- | --- | --- |
| A valid phone challenge could disappear after logout and process restart. | The signed-out tombstone cleanup could not distinguish a challenge issued before logout from one issued afterward. | Persist challenge creation time and restore only a valid challenge proven newer than the tombstone. Legacy, pre-logout, malformed, and expired challenges fail closed. |
| Rejected/restored sessions lacked a specific recovery message. | Session invalidation changed route state without durable user-facing error semantics. | Store a localized session-expired translation key and render it reactively. |
| Google logout could race a rapid re-login. | Native provider sign-out ran unawaited after local invalidation. | Await native sign-out behind a five-second bound while keeping local invalidation authoritative. |
| Some visible errors stayed in the old language after switching locale. | Screens stored already-translated text in component state. | Store stable translation keys for onboarding, permission, device, auth, and SOS feedback, then translate during render. Added locale-reactivity tests. |
| The picker appeared to have lost 149 of the 155 JSON catalogs. | Commit `94a7c71` intentionally quality-gated release selection to reviewed `en/es/fr/zh`, plus `ar/he` in the base RTL-QA profile; the catalogs were not deleted. | Keep the base `testflight` profile at six and production at four, while adding separately named `testflight-full-catalog` metadata that enables all 155 in a signed audit build without code changes. The audit profile is production-like for readiness, marks review-required picker rows/triggers `QA`, and is not a translation-approval artifact. |
| Changing language could retrigger onboarding-completion persistence. | The completion callback depended on the translation function. | Remove the locale dependency and keep translated errors at the render boundary. |
| A privacy export could silently omit contacts or Saved Places. | Protected-store read failures were converted to empty arrays. | Fail the export visibly so the user can retry rather than receive an incomplete archive presented as complete. |
| Local emergency contacts could be blocked by connected-delivery bookkeeping. | SOS idempotency preflight ran before the independent native dialer path and included unsynchronized local IDs. | Enable connected delivery only for valid synchronized IDs and run preflight in parallel with the dialer fallback. Added local-only and synchronous-failure coverage. |
| Empty SOS state had no direct recovery action. | The screen only displayed explanatory copy. | Add a direct **Add emergency contact** action and keep status/errors locale-reactive. |
| BLE rationale dismissal looked like an OS-level denial. | The same error code represented declining the app rationale and denying the native permission. | Add a retryable `BLE_PERMISSION_NOT_REQUESTED` state; reserve Settings recovery for actual OS denial. |
| A remembered BLE device had no manual recovery control. | Reconnect existed only as lifecycle behavior. | Add typed connection feedback and an explicit bounded **Reconnect** action through `AppContext`. |
| Voice cleanup could accept late frames while native audio was stopping. | WebSocket teardown happened after awaited microphone cleanup. | Detach and close the transport first, catch native close errors, and stop microphone/playback concurrently. Added lifecycle-race tests. |

## Core Flow Verification

Status meanings:

- **PASS** — verified at the stated source/simulator layer without a crash or false success.
- **PARTIAL — EXTERNAL** — implemented behavior passed locally, but a named signed-device, backend, provider, or hardware layer could not be exercised.
- **BLOCKED — EXTERNAL** — acceptance cannot proceed until the external requirement is supplied.

| Flow | Status | Evidence from this audit | Still required on TestFlight / production-like setup |
| --- | --- | --- | --- |
| Language switcher | **PASS (recorded simulator/source); PARTIAL — EXTERNAL** | English showed the selected checkmark; selecting Spanish immediately translated Settings; terminating and relaunching restored Spanish on onboarding. The repository has 155 JSON catalogs with the same 353 non-empty keys each. The six pre-existing critical blocks are preserved; the other 149 were generated by Codex `gpt-5.6-sol` on 15 July 2026. The base TestFlight policy exposes six; the separately named full-catalog policy exposes all 155 for audit. System fallback, RTL direction, numeric LTR isolation, and reload-loop guards have deterministic coverage. | On base `testflight`, confirm exactly System plus `en/es/fr/zh/ar/he` and repeat signed-device persistence/RTL tests. On `testflight-full-catalog`, confirm 156 rows, review-required picker/trigger `QA` badges, German/Portuguese/Russian switching, additional RTL such as Urdu, and selected-language critical copy with no English overlay fallback. The 149 generated blocks still require native-speaker safety review. |
| Authentication | **PARTIAL — EXTERNAL** | Protected routing, token-envelope validation, refresh/offline/rejection behavior, phone challenge resume, account isolation, logout, and safe errors pass. Simulator demo is correctly volatile and tokenless. | Apple/Google/Twilio success, cancel, logout, Keychain persistence, provider credential state, refresh revocation/reuse, abuse controls, and two-account tests with production credentials. |
| Onboarding | **PASS (simulator/source); PARTIAL — EXTERNAL** | Onboarding rendered and navigation/progress/permission state machines pass, including process-safe resume and no locale-triggered completion write. | Native location/notification prompts, deny/revoke/Settings recovery, APNs scheduling, and clean-install/upgrade tests on a signed device. |
| Navigation/routing | **PASS (simulator/source); PARTIAL — EXTERNAL** | Protected stacks, Back recovery, stable account-bound restoration, unknown-route recovery, and custom-link allowlist tests pass. Home, Map, Settings, contacts, SOS, and Safety Call were navigated without a crash. | Universal/custom-link launch from other apps, swipe-back behavior, process restoration, and iPad split-view navigation on the exact TestFlight build. |
| Safety modes | **PASS for implemented baseline; PARTIAL — EXTERNAL** | Home and Emergency UI rendered; persisted mode transitions and failure semantics pass deterministic coverage. | Connected Guardian/Emergency session behavior, push/delivery receipts, and background transitions against the deployed safety service. |
| Map | **PARTIAL** | Mapbox rendered in the simulator; location resolved; Saved Places saved; native Quick Share opened; cached/stale/offline contracts pass. | Signed-device GPS/background testing. Production routes, avoidance/danger intelligence, and revocable live sharing are not implemented and require a product/backend contract. Store builds correctly exclude development sample zones. |
| Emergency/SOS | **PASS for local fallback; PARTIAL — EXTERNAL** | Added and restored a valid contact; SOS confirmation appeared; cancellation persisted as “no call was placed”; the simulator’s unsupported `tel:` path produced an actionable “phone dialer could not open” state rather than false success. Connected-delivery filtering and idempotency tests pass. | Physical telephony, synchronized contacts, backend acceptance, real delivery receipts/escalation, notifications, and repeated offline/online tests. |
| BLE / NorthStar | **BLOCKED — EXTERNAL** | Permission classification, scan/connect failure mapping, persistence, removal, foreground reconnect, manual retry, and cleanup pass automated tests. Development simulation is guarded by `__DEV__`; Expo Go/store failures remain explicit. | Approved VL01 UUIDs/schema, secure ownership/pairing, physical scan/pair/battery/status/event/command/reconnect, Bluetooth denial/recovery, and background tests. |
| Voice AI | **PASS for offline path; PARTIAL — EXTERNAL** | Safety Call entered bundled offline companion mode, accepted text interactions, ended cleanly, and returned to a ready state. Queue, timeout, tool fallback, and WebSocket/audio cleanup tests pass. | Production Hume gateway/config, signed microphone permission, two-way 48 kHz audio, routes/interruptions, Bluetooth, lock screen, backgrounding, reconnect, and load. Bundled offline conversational responses remain English content. |
| Settings/privacy/history | **PASS for implemented local baseline; PARTIAL — EXTERNAL** | Language, voice/offline settings UI, emergency contacts, Saved Places, history/empty states, privacy export/deletion failure semantics, persistence, and account cleanup pass coverage. Protected-store export failures are no longer hidden. | Native share sheet contents, remote export/delete against production, deletion tombstones/vendor/backup/log proof, and signed Keychain lifecycle. |
| Errors/loading/accessibility | **PASS (source/simulator); PARTIAL — EXTERNAL** | Typed localized feedback, loading/empty/retry states, contrast, labels, roles, selected state, and live status pass. Simulator telephony failure was actionable and honest. | VoiceOver order, Dynamic Type, Reduce Motion, hit-size inspection, interruption alerts, iPhone SE/iPad layouts, and TestFlight crash/log review. |
| Background/foreground/performance | **PARTIAL — EXTERNAL** | App-state recovery guards, serialized writes, queue/reconnect bounds, stale-callback rejection, and Hume cleanup pass deterministic tests; no crash was seen during simulator terminate/relaunch. | Instruments/memory profiling plus physical audio, BLE, APNs, location, lock/unlock, suspension, cellular/Wi-Fi changes, and repeated lifecycle tests. |

## Simulator Observations

- iPhone 17 Pro, iOS 26.5: onboarding, protected Home, Map, Saved Places, native share sheet, emergency contacts, SOS confirmation/cancel/error, offline Safety Call, Settings, and Language selector rendered without an app crash.
- Spanish changed immediately throughout Settings and was still selected after app termination/relaunch.
- A fresh post-change catalog-audit launch could not be captured because the host CoreSimulator service became unavailable. German selection is therefore verified by the isolated development-runtime probe, not presented as screenshot evidence; the previously completed Spanish/RTL simulator observations remain the visual baseline.
- Demo authentication deliberately did **not** survive restart; this is the tested development-only contract, not a production-session failure.
- The simulator cannot open a real telephone call, exercise APNs/Keychain/provider entitlements, validate physical BLE, or prove production audio/background behavior.
- Intermittent black rectangles in command-line screenshots were simulator capture/compositor artifacts; settled recaptures showed the underlying screen. They were not observed as a persistent application state.

## Deterministic Release Gates

These are the current source and bundle results. They do not claim a signed `testflight-full-catalog` archive or physical-device run.

| Gate | Recorded result |
| --- | --- |
| `npm test` | **PASS — 341/341, 0 failed, 0 skipped** |
| `npm run lint` | **PASS** |
| `git diff --check` | **PASS** |
| `npx expo-doctor` | **PASS — 20/20** |
| `EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES=true EXPO_PUBLIC_SHOW_ALL_LANGUAGES=false npx expo export --platform ios` | **PASS** |
| `EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES=true EXPO_PUBLIC_SHOW_ALL_LANGUAGES=false npx expo export --platform android` | **PASS** |
| Full-catalog release-runtime/native probes | **PASS — `__DEV__=false`, 155 base catalogs, 156 picker rows including System default, 155 iOS and Android native locale declarations; German/Portuguese/Russian and Urdu RTL samples resolve correctly** |
| Full-catalog iOS/Android release exports | **PASS — production-mode bundles with `VERYLOVING_BUILD_PROFILE=testflight` and `EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true`; iOS 2,574 modules/9.3 MB, Android 2,657 modules/9.5 MB** |
| `testflight-full-catalog` signed archive and physical install | **BLOCKED — EXTERNAL; no signed-device or linguistic PASS is claimed** |
| `npm run validate-env -- --profile production --no-color` with full-catalog mode explicitly off | **FAIL — 13 OK, 2 warnings, 9 unrelated release errors** |
| Signed EAS/TestFlight archive and physical install | **BLOCKED — EXTERNAL** |

## Production Configuration Blocker

The locally readable production profile is not releasable. It requires:

- `EXPO_PUBLIC_PHONE_AUTH_ENABLED=true`
- `EXPO_PUBLIC_HUME_CLM_ENABLED=true`
- `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED=true`
- `EXPO_PUBLIC_VL01_ENABLED=true`
- approved values for `EXPO_PUBLIC_VL01_SERVICE_UUID`, `EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID`, `EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID`, `EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID`, and `EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID`

The optional branded Hume voice ID and RTL-QA flag also warn locally. EAS may hold a different production environment, but this account cannot inspect it; the release owner must run the same redacted validator in the build environment and attach evidence. No UUID or readiness flag was fabricated to make the gate green.

## Required Handoff Action

1. An authorized Expo project owner supplies the production variables above and proves the backend/provider/hardware dependencies are actually ready.
2. Build the exact commit with `eas build --platform ios --profile testflight` for the six-locale base candidate. When the 155-catalog layout audit is requested, create a distinct build with `eas build --platform ios --profile testflight-full-catalog`; never substitute one profile's result for the other.
3. Grace runs [TESTFLIGHT_LANGUAGE_SWITCHER.md](./TESTFLIGHT_LANGUAGE_SWITCHER.md) first, then [TESTFLIGHT_UI_CHECKLIST.md](./TESTFLIGHT_UI_CHECKLIST.md), recording the exact commit, profile, build number, devices, outcomes, picker/trigger `QA` badges, selected-language critical-copy observations, native-review status, and blockers.
4. Keep the decision at **NO-GO** until the production validator passes and every applicable P1 signed-device/external gate has named evidence.
