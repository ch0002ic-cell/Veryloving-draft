# VeryLoving UI Framework Audit and Hardening Report

Audit date: 15 July 2026

Primary iOS acceptance environment: TestFlight
Release decision: **NO-GO until the open P1 gates below have signed-build or external-service evidence**

## Outcome

The whole app was audited across routing, auth/onboarding state, persistence, account isolation, async feedback, accessibility, localization, native permissions, responsive configuration, safety semantics, and release profiles. The foundational UI code is materially hardened and is a valid source candidate for the next signed TestFlight iteration. It is not honestly certifiable as production-ready from source tests, simulator exports, or a successful archive alone.

The pass corrected the concrete language-switcher concern and broader framework defects that could lose progress, restore unsafe routes, expose previous-account state, present placeholder features as working, discard privacy-export data on a network failure, or show technical service errors. It also introduced a dedicated `testflight` EAS profile so signed QA and public production no longer need to share an ambiguous locale policy.

A local iOS 26.5 Simulator debug target compiled, ad-hoc signed, installed, and launched its development client. CoreSimulator then intermittently timed out while delivering the local Expo development-client URL, so no live language-switch screenshot from that run is presented as evidence. No simulator-only route, mock session, or production workaround was added. The issue is recorded as a non-blocking development-environment quirk because TestFlight on a physical device is the acceptance artifact, but the signed-device language result remains open rather than inferred.

Automated evidence at this audit point:

| Gate | Result |
| --- | --- |
| ESLint | Pass |
| Deterministic tests | **313/313 pass; 0 skipped or failed** |
| `git diff --check` | Pass |
| Expo Doctor | **20/20** |
| iOS JavaScript production export | Pass through `npm run validate` |
| Android JavaScript production export | Pass through `npm run validate` |
| Signed TestFlight install and physical-device matrix | **Open — not implied by the results above** |

### Verification status by foundation area

The status column names the evidence layer. **PASS (source/automated)** means the implementation and deterministic contracts passed; it is not a signed-device PASS. **REQUIRES TESTFLIGHT** means Grace must fill the actual outcome on the exact build in the linked checklist.

| Area | Status | What was verified / what remains |
| --- | --- | --- |
| Language switcher | **PASS (source/automated); REQUIRES TESTFLIGHT** | Durable-before-publish selection, immediate same-direction rendering, checked/radio state, system fallback, release locale gate, reminder localization, generation-safe LTR/RTL reload ordering, and restart hydration are covered. Physical process reload, notification text, mirroring, and screenshots remain open. |
| Navigation and routing | **PASS (source/automated); REQUIRES TESTFLIGHT** | Public/protected stacks, ordered auth/onboarding resume, account-bound stable restoration, back/home fallbacks, and direct operating-system URL sanitization pass. Signed universal/custom links and gesture/hardware Back behavior remain device checks. |
| Global state | **PASS (source/automated); REQUIRES TESTFLIGHT** | Auth, settings, contacts, and device hydration are bounded, serialized, account-checked, and persist-before-publish. Signed Keychain lifecycle and provider refresh across process death remain open. |
| Data persistence | **PASS for implemented baseline; P1 gaps remain** | Preferences, history, contacts including edit, Saved Places, queues, SOS/navigation resilience, and device metadata have persistence/cleanup tests. Remote contact edit needs the current backend deployment; plaintext AsyncStorage content still has an at-rest-encryption gate. |
| Errors/loading/retry | **PASS (source/automated); REQUIRES TESTFLIGHT** | Typed/user-safe errors, disabled/loading/empty/success states, timeout handling, WebSocket queue recovery, stale location, export/deletion failure semantics, and retry paths pass. Production outage behavior still needs signed end-to-end observation. |
| Components/accessibility | **PASS (source/automated); REQUIRES TESTFLIGHT** | Tokens, contrast, programmatic labels, live status, selected state, map semantics, decorative-image hiding, safe-area modals, and back controls pass. VoiceOver, Dynamic Type, hit targets, rotation, and split view require physical QA. |
| Permissions | **PASS for active source/config; REQUIRES TESTFLIGHT** | Location, notification, microphone, and Bluetooth rationales plus denial/Settings recovery are implemented; unused camera/photo permission declarations were removed. Native prompts, revocation, notification delivery, and background behavior require a signed device. |
| Background/foreground | **PARTIAL; REQUIRES EXTERNAL HARDWARE/SERVICES** | App-state rechecks, bounded reconnect/queue behavior, cleanup, and ownership guards pass. Audio routes, lock screen, APNs, Hume, and physical VL01 reconnect/memory behavior remain unproven. |
| RTL | **PASS (source/automated); REQUIRES TESTFLIGHT/NATIVE SPEAKERS** | Arabic/Hebrew TestFlight-only exposure, RTL metadata, target-locale persistence, reminder ordering, reload-loop guards, and LTR return logic pass. Visual/gesture correctness and linguistic safety approval remain open. |
| Developer-only isolation | **PASS (source/automated)** | Demo auth requires development plus a confirmed iOS Simulator and is tokenless/volatile; store danger-zone fixtures resolve to none; production config rejects forced offline mode/public Hume secrets; camera/image-picker stubs are removed. Shipped offline responses and cached data are intentional production-safe fallbacks, not test doubles. |

## UI Framework Overview

The runtime provider order is:

```text
Outer startup error boundary
└── Safe-area and audio-stream root
    └── AuthProvider
        └── AppProvider
            └── I18nProvider
                └── Localized render error boundary
                    └── Protected Expo Router stack
```

`AuthProvider` owns the atomic app session, refresh lifecycle, pending phone challenge, and account-bound onboarding progress. `AppProvider` owns normalized settings, contacts, paired-device state, and mutation queues. `I18nProvider` resolves the runtime locale, propagates translations, and performs the required native reload when layout direction changes. The router is withheld until auth and app hydration finish or a bounded restore operation fails safely.

Persistence is deliberately tiered:

| Data | Persistence contract |
| --- | --- |
| Access/refresh/profile envelope | One validated, account-bound SecureStore record on supported signed builds. |
| Phone verification and onboarding progress | Versioned, expiring/account-bound SecureStore records; process relaunch resumes only a valid next step. |
| Emergency contacts and Saved Places | Account-bound SecureStore records; Saved Places validates coordinates and retains at most eight records. |
| Settings | Strict versioned schema; writes serialize and complete before UI state is published. Language is the sole device preference retained across sign-out/account changes. |
| Navigation | One versioned, account-bound, allowlisted stable destination—not arbitrary history or emergency modal state. |
| Conversations, queues, location/SOS resilience, device metadata | Serialized local records with stale-data checks, cleanup locks, and a fail-closed account-owner boundary. They remain plaintext at rest and therefore retain a P1 encryption gate. |
| Native artifacts | Reminder schedule, voice files, and Mapbox packs participate in sign-out/account-switch/privacy cleanup, with residual failures surfaced rather than hidden. |

## Findings and Fixes

### Navigation and routing

| Finding | Severity | Resolution |
| --- | --- | --- |
| Completed users could be sent into an onboarding-only jewelry route with no valid protected entry. | P0 broken flow | Added a protected standalone jewelry setup route and kept onboarding routing separately guarded. |
| Cold start knew only signed-in/signed-out, so phone verification and partial onboarding could be lost or skipped. | P0 state loss/bypass | Added an expiring persisted phone challenge and a versioned ordered onboarding state machine bound to the authenticated account. |
| Root and auth route protection was incomplete and direct advanced onboarding links could jump ahead. | P0 access control | Declared public/protected root routes, guarded auth stages, and required all exits to pass the completion gate. |
| Navigation persistence and direct operating-system URLs could have restored or opened stale/high-risk UI. | P1 | Persist only stable account-bound destinations and apply the same fail-closed policy at Expo Router's native-intent boundary. Trusted app/web links are canonicalized to query-free allowlisted routes; malformed, foreign, unknown-scheme, auth/onboarding-bypass, and high-risk modal URLs are rejected before file-route resolution. |
| Modal close behavior could fail with no back history; unknown routes had no useful recovery. | P1 | Added guarded Back/Home fallbacks and a localized not-found screen. |
| Startup/render failures could blank the app outside localized providers. | P1 | Added both an outer startup boundary and an inner localized render boundary. |

Exact navigation history is intentionally not persisted. Reconstructing an emergency modal or sensitive back stack after process death is less safe than restoring a known stable destination.

### Global state and lifecycle

| Finding | Severity | Resolution |
| --- | --- | --- |
| Session, settings, contacts, and device hydration could wait indefinitely or publish state for a previous account. | P0/P1 | Added bounded restore timeouts, generation/account checks, fail-safe defaults, and navigation gating until the expected account is hydrated. |
| Concurrent auth/session writes could leave a mixed token/profile snapshot. | P0 security/state | Serialize auth mutations and persist one validated access/refresh/profile envelope atomically. |
| Cross-account local data had no single ownership boundary. | P0 privacy | Before publishing a different account, purge prior or unowned settings/history/queues/location/SOS/device/navigation/permission state plus secure contacts/Saved Places and native artifacts. Preserve same-account offline recovery only. |
| Settings UI could claim a change before persistence succeeded. | P1 consistency | Normalize a strict schema, serialize writes, persist first, and then publish context state; invalid/future fields fail closed. |
| Paired-device callbacks and hydration could race removal or an account switch. | P1 | Bind metadata to the account, use lifecycle generations, serialize persistence/removal, and reject stale callbacks. |
| Redundant battery persistence caused avoidable writes/re-renders. | P2 performance | Treat live battery as telemetry and avoid redundant durable writes while preserving stable device metadata. |

### Data persistence and privacy

| Finding | Severity | Resolution |
| --- | --- | --- |
| The visible Capybear reminder choice was a placeholder and legacy `true` values looked like consent. | P0 functional gap | Added real daily 20:00 local scheduling, explicit Enable/Skip actions, permission handling, persisted notification identifier, Settings toggle, cancellation, localized rescheduling, and migration that resets legacy placeholder consent. |
| Saved Places was visible but not functional. | P0 functional gap | Added authenticated account-bound secure add/list/remove persistence, coordinate/timestamp validation, an eight-place bound, localized feedback, export, deletion, and account isolation. |
| Emergency contacts could be added, called, and removed but not edited. | P0 functional gap | Added accessible Edit/Save/Cancel UI, transactional account-bound cache updates, authenticated backend `PATCH`, optimistic version checks, and conflict refresh/retry. The updated safety backend must be deployed before remote TestFlight editing can pass; offline/local editing is implemented. |
| Remote privacy-export failure could discard an already assembled local export. | P1 privacy/UX | Always retain the local snapshot and label remote data as `included`, `unavailable`, or `not-configured` with a safe error code. |
| Delete My Data cleared credentials in parallel with remote deletion, preventing a safe retry after backend failure. | P1 privacy | Require authenticated remote deletion to succeed first when the backend is enabled; only then clear local data and credentials. Backend deletion is idempotent for response-loss retry. |
| Local cleanup could race conversation, queue, or settings writers. | P0 privacy | Lock and drain mutation queues before sweeping stores; keep only opaque cleanup retry evidence when a native artifact cannot be removed. |
| Stale location could be attached to an SOS request. | P1 safety accuracy | Omit location outside the accepted freshness window instead of blocking SOS or presenting stale coordinates as current. |
| Accepted/pending SOS state could reuse or lose an idempotency key incorrectly across reload. | P1 reliability | Separate definitive backend acceptance from pending retry state and guard accepted keys during transient storage failures. |

Conversation history is stored and retrievable, and contacts/safety settings restore through their bounded caches. Full at-rest encryption, server session revocation/deletion tombstones, vendor deletion orchestration, and backup/log retention proof remain open P1 items.

### Error handling and user feedback

- API, auth restore, settings/contact/device hydration, notification scheduling, location, share, SOS, BLE, voice, WebSocket, export, and deletion paths now fail through bounded catches or typed outcomes.
- Provider/native error strings are no longer rendered directly in auth, location/map/share, SOS, BLE, or voice flows. Stable error codes map to localized actionable copy at the render boundary.
- Location, microphone, and Bluetooth denial states expose a native Settings recovery action where the platform allows it. Notification Settings recovery rechecks permission after the app returns to foreground.
- WebSocket sends that race a closing connection fall back to the durable FIFO queue instead of dropping the message.
- Loading, disabled, success, empty, and error states use shared accessible components; async status banners use live-region/status semantics.
- SOS copy distinguishes a stored backend receipt, an opened dialer, a connected call, and actual external delivery. The app never claims emergency dispatch.

### UI consistency and accessibility

- Existing design tokens remain the single source for spacing, color, typography, radii, and shadows; no parallel theme system was introduced.
- Critical inputs now have programmatic labels, shared async feedback is announced, map annotations are named, and decorative empty-state art is hidden from assistive technology.
- Protected detail screens expose visible localized back navigation, and entrance animation no longer hides screen content if an animation callback stalls.
- Empty conversation/contact/friend/device states remain explicit rather than rendering blank lists.
- The native app is intentionally light-only (`userInterfaceStyle: light`). Dark-mode switching is not a promised feature and is not counted as implemented; adding it requires a token/component/device audit.
- Store builds no longer render development-only Toronto danger-zone fixtures as live safety intelligence.

### Internationalization and RTL

- Production runtime/native declarations expose only reviewed `en/es/fr/zh`.
- The `testflight` profile explicitly adds only `ar/he` for signed RTL QA. Both remain `reviewRequired` until native-speaker approval.
- All 155 catalog files remain for translation parity/review, but 149 unreviewed work products are nonselectable.
- Runtime per-string fallback remains disabled. A release-critical six-locale overlay covers auth, location/map/share, SOS, BLE, voice, and Saved Places. Reminder strings continue to come from the complete locale catalogs.
- Same-direction language selection updates mounted UI after durable persistence. Direction changes create a generation token before settings publication, schedule target-locale reminder copy with bounded cleanup, and allow one native `I18nManager` reload only after the current transition is safe. Superseded or uncertain native work defers automatic reload instead of leaving a stale notification schedule or reload loop.
- Traditional Chinese device tags do not silently receive Simplified Chinese; they resolve to explicit English until a reviewed Traditional catalog exists.

Signed TestFlight evidence is still required for actual process reload, visual mirroring, native share UI, notification text, map annotations, Dynamic Type, VoiceOver, mixed-direction phone/coordinate text, rotation, and iPad split view.

### Device-specific configuration

- Native orientation is responsive rather than portrait-locked; iPad support and split view remain enabled.
- Unused camera/photo-library permissions and the unused Expo Image Picker plugin/dependency were removed.
- Obsolete iOS Bluetooth/location permission strings were removed. iOS `UIBackgroundModes` are contributed by the active audio/BLE plugins; Android audio foreground-service permissions remain explicitly declared for the active feature.
- Android blocks legacy broad external-storage permissions and keeps only active notification/location/BLE/audio requirements.
- Production config now fails closed if forced offline mode or a public Hume API key is present.
- The dedicated TestFlight profile uses store distribution, the production EAS environment, a real-device archive, and auto-incremented build numbers.
- Demo authentication is available only when `__DEV__` is true, the host is not Expo Go, and native metadata confirms an iOS Simulator; it is volatile, tokenless, and absent from TestFlight. Visual-development danger-zone fixtures are likewise compiled to an empty list in store builds. The bundled offline companion is an explicitly labeled product fallback, not a simulator mock.

## TestFlight Acceptance Plan

The exact archive build number must pass every applicable row; results from another commit/build cannot be carried forward without a documented impact assessment.

| Area | Required signed-build evidence |
| --- | --- |
| Install/upgrade | Clean install and upgrade from the previous TestFlight build; state/schema migration; no stale account data. |
| Process restoration | Force-quit during phone verification and every onboarding stage; relaunch on each tab/detail screen; verify only a safe destination resumes. |
| Authentication | Real Apple, Google, and SMS success/cancel/error/expiry/revocation paths plus sign-out and two-account switching. |
| Preferences | Language, voice, reminder, companion visibility, offline preference, contacts, Saved Places, and paired-device state survive the intended lifecycle. |
| Permissions | Allow, deny, restricted/unavailable, revoke in Settings, return to foreground, and retry for notification/location/microphone/Bluetooth. No camera/photo prompt. |
| RTL/responsive | `en/es/fr/zh/ar/he`, repeated LTR/RTL relaunch, iPhone SE-class, current Pro-class, iPad portrait/landscape/split view, Dynamic Type, VoiceOver, keyboard. |
| Safety/map/privacy | Fresh/stale location, Mapbox/offline cache, static Quick Share wording, duplicate SOS, dialer fallback, backend outage, partial export, failed/successful remote deletion, no false delivery copy. |
| Voice/BLE/background | Hume live/offline/reconnect/queue, audio interruptions/routes/lock screen, physical VL01 pair/events/reconnect/loss, foreground/background and repeated cleanup. |
| Performance | Long map/history lists, rapid navigation, repeated calls/pairing, memory pressure, render profiling, crash/ANR and network-duplication review. |

## Remaining Gaps and Blockers

| Priority | Gap | Why it cannot be called complete |
| --- | --- | --- |
| P1 | No signed TestFlight device matrix for this change set | Simulator/export tests cannot prove Keychain, APNs, native auth, permission Settings recovery, RTL reload, audio routing, BLE, backgrounding, memory, or upgrade behavior. |
| P1 | Signed build access for this handoff | No physical iPhone is connected, and the authenticated Expo user cannot read the configured EAS project. An EAS project/organization owner must grant access or build the exact committed SHA; no real-device language PASS is claimed. |
| P1 | Plaintext account-scoped AsyncStorage records | Account switching is fail-closed, but transcripts, settings, queues, locations, SOS/navigation resilience, and wearable metadata still require approved at-rest encryption and migration. |
| P1 | Durable SOS acceptance is not delivery | There is no production guardian/contact/push delivery outbox, provider receipt, escalation policy, or operational response evidence. |
| P1 | Server revocation and privacy lifecycle | Refresh-family reuse detection, revocation, deletion tombstones, vendor/backup/log orchestration, and production retention proof are incomplete. |
| P1 | VL01 firmware behavior | Event/status decoding, command authorization, ownership challenge/secure pairing, reset behavior, and physical hardware evidence require the approved firmware contract. |
| P1 | Native voice/background behavior | Hume deployment plus the implemented/requested 48 kHz capture/playback path, interruptions, Bluetooth routes, lock screen, repeated cleanup, load, and redacted observability remain unproven on physical hardware. |
| P1 | Arabic/Hebrew linguistic approval | These are QA-only locales until native speakers approve safety-critical copy and the signed RTL matrix. |
| P1 | Production credentials/services | Real provider, SMS, Mapbox, Hume, APNs/FCM, DynamoDB, signing, EAS access, monitoring, rollback, privacy, and store-review evidence remains externally owned. |
| P2 | Friends is an honest empty/read-only surface | No account-backed friend/invite API, consent model, abuse controls, or product contract exists; fake local friends were deliberately not added. |
| P2 | Map product scope | Quick Share is a static native share payload, not a revocable live link; production routes, remote avoidance/danger intelligence, and recipients/expiry are not implemented. |
| P2 | Offline companion localization | Bundled offline response packs and system prompt remain English content; do not market localized offline conversation until separately translated/reviewed. |
| Product decision | Dark mode | The current app explicitly supports light mode only. A future dark mode requires design tokens, assets, maps, native surfaces, accessibility, and device QA. |

## Handoff Decision

The next action is for an authorized project owner to build the exact committed source with `eas build --platform ios --profile testflight`, upload that archive to TestFlight, run [How to Test the Language Switcher on TestFlight](./TESTFLIGHT_LANGUAGE_SWITCHER.md) first, and then execute [TESTFLIGHT_UI_CHECKLIST.md](./TESTFLIGHT_UI_CHECKLIST.md) against the exact signed build number. The current EAS account is authenticated but lacks read/build access to the configured project, and no physical iPhone is connected; those external facts block signed-device execution here. Attach the redacted build/access record and assign its owner rather than substituting Expo Go or simulator evidence.

Grace can treat the UI framework as ready for a TestFlight candidate build, but not as a released or fully verified safety product. The decision remains **NO-GO** until every P1 row has a named owner, due date, release-SHA/build-number-specific evidence, and approval in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).
