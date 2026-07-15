# VeryLoving TestFlight UI Framework Checklist

Audience: Grace and mobile QA

Primary acceptance artifact: signed TestFlight build

Priority language script: [How to Test the Language Switcher on TestFlight](./TESTFLIGHT_LANGUAGE_SWITCHER.md)
Companion engineering report: [UI_FRAMEWORK_AUDIT.md](./UI_FRAMEWORK_AUDIT.md)

Current engineering handoff status: no physical iPhone is connected and the authenticated Expo account lacks access to the configured EAS project, so no row below is pre-marked PASS. An authorized project owner must build/upload the exact committed SHA and QA must record observations from that signed build.

## Test Record

- Tester:
- Date/time and timezone:
- Git commit SHA:
- App version / TestFlight build number:
- Backend deployment IDs:
- Device model / iOS version:
- Install type: clean / upgrade from build:
- Network conditions exercised:
- Evidence folder or ticket:

Status labels:

- **PASS** — observed on the exact TestFlight build and device recorded above.
- **FAIL** — reproducible defect; record steps, screen, expected/actual result, screenshot/video, and logs.
- **BLOCKED — EXTERNAL** — needs a named credential, service, physical VL01, native-speaker reviewer, or other resource that was unavailable. Name the owner and requirement.
- **N/A** — approved as outside this release scope, with the approver recorded.

Do not mark an item PASS from Expo Go, a JavaScript export, a simulator, or another build number. Those may be attached as supporting evidence only.

QA result summary (complete after the detailed checks; link defects/evidence in **Actual outcome**):

| Area | Steps and expected outcome | Actual outcome | Blocker / owner |
| --- | --- | --- | --- |
| Language | Run section 1; immediate translated UI, checked state, restart persistence, honest system fallback, and one bounded LTR/RTL reload. | _QA to fill_ | _QA to fill_ |
| Navigation | Run section 2; protected routes/deep links cannot bypass auth, stable restoration is safe, and Back/Close always recovers. | _QA to fill_ | _QA to fill_ |
| State/data | Run section 3; persisted data survives intended lifecycle, stays account-bound, and failed mutations retain the last valid state. | _QA to fill_ | _QA to fill_ |
| Errors | Run section 4 under loss/timeout/malformed responses; feedback is actionable, retry is bounded, and no false success/raw error appears. | _QA to fill_ | _QA to fill_ |
| UI/accessibility | Run section 5; layouts remain usable across supported sizes and VoiceOver/Dynamic Type, with consistent controls and no store fixtures. | _QA to fill_ | _QA to fill_ |
| Permissions | Run section 6; rationale, allow/deny/revoke/Settings recovery work for active permissions and no camera/photo prompt appears. | _QA to fill_ | _QA to fill_ |
| Lifecycle/performance | Run section 7; foreground recovery is consistent, queues do not duplicate, and audio/BLE/memory behavior matches policy. | _QA to fill_ | _QA to fill_ |
| Release decision | Run section 8; every failure/external dependency has an owner and the exact build is accepted or rejected explicitly. | _QA to fill_ | _QA to fill_ |

## 1. Language Switcher — Priority Acceptance Flow

Test first on a clean install, then repeat the persistence steps after upgrading from the previous TestFlight build.

### Availability and visual state

- [ ] Open **Settings → Language**; the sheet opens without a blank frame, overlap, or clipped close button.
- [ ] Confirm the TestFlight build offers exactly **System default, English, Spanish, French, Simplified Chinese, Arabic, and Hebrew**. Report any additional unreviewed locale as a release defect.
- [ ] The current preference has a visible green checkmark/selected row.
- [ ] With VoiceOver, each language row is announced as a radio option and the current row is announced as checked.
- [ ] Search finds a language by native name, English name, or code; a no-result query shows a localized empty state.

### Immediate translation and persistence

- [ ] Select **Spanish**. The sheet closes, Settings text changes immediately, and the trigger reads `Español / ES` without reopening the app.
- [ ] Reopen Language; Spanish remains checked.
- [ ] Navigate through Home, Map, Settings, contacts, Saved Places, voice, privacy/export, SOS confirmation, and one permission/error state. App-owned strings are Spanish; no raw provider/native error is shown.
- [ ] Force-quit from the app switcher and relaunch. Spanish and the current safe destination persist.
- [ ] Select **French** and repeat immediate update, checked state, navigation, and force-quit persistence.
- [ ] Select **Simplified Chinese** and repeat immediate update, checked state, navigation, and force-quit persistence.
- [ ] Set **System default**, change the iPhone preferred language to Spanish/French/Chinese, terminate and relaunch, and verify the matching maintained interface is selected.
- [ ] With System default and an unsupported or Traditional Chinese device locale, verify the app explicitly uses English rather than claiming an unavailable translation.

### RTL TestFlight QA

- [ ] Select **Arabic**. Allow the intentional one-time process reload; the app returns in Arabic with Arabic checked.
- [ ] Verify the root layout, headers/back controls, lists, forms, language sheet, map controls/annotations, Saved Places, dialogs, dates, coordinates, and phone numbers mirror/read correctly without reversing numeric content.
- [ ] Force-quit and relaunch. Arabic and RTL direction persist with no reload loop.
- [ ] Verify an enabled Capybear reminder is rescheduled with Arabic app-owned copy.
- [ ] Select **Hebrew** and repeat checked state, process reload, screen coverage, and persistence.
- [ ] Switch back to **English** and confirm one LTR reload, correct persistence, and no layout-direction loop.
- [ ] **BLOCKED — EXTERNAL until complete:** attach Arabic and Hebrew native-speaker approval for safety, emergency, consent, auth, permission, map, voice, privacy, and notification copy. TestFlight availability does not equal public-release approval.

Required language evidence:

- [ ] Screenshot: Language sheet with Spanish checked.
- [ ] Screenshot: Spanish Settings immediately after selection.
- [ ] Screenshot: Spanish Settings after force-quit/relaunch.
- [ ] Screenshot: Arabic Language sheet with Arabic checked.
- [ ] Screenshot pair: the same representative LTR and RTL screen.
- [ ] Screen recording: English → Arabic reload → force-quit/relaunch → English.
- [ ] Redacted device log excerpt for the same build showing no fatal/unhandled/reload loop; do not include tokens, phone numbers, or precise location.

## 2. Navigation and Routing

- [ ] Clean launch routes a signed-out user to onboarding; protected tabs/details cannot be opened directly.
- [ ] Apple, Google, and phone auth success/cancel/failure paths return to an actionable screen without a loop. **BLOCKED — EXTERNAL** if production provider/SMS credentials are unavailable.
- [ ] Force-quit during phone verification; a still-valid challenge resumes at verification and an expired challenge returns safely to phone entry.
- [ ] Force-quit after each onboarding step; relaunch resumes the next valid step and cannot jump ahead via a deep link.
- [ ] Complete onboarding and verify all main tabs, Settings, voice, contacts, history, friends empty state, device management, jewelry setup, Saved Places, and privacy routes are reachable.
- [ ] Back and Close work when history exists; direct-opened details fall back safely to Home when no history exists.
- [ ] Relaunch from Home, Map, Settings, contacts, and device management; only the last allowlisted stable destination resumes.
- [ ] SOS/safety-call modals, malformed URLs, foreign web hosts, and unknown routes are never restored; unknown routes offer Back/Home.
- [ ] Trusted `veryloving://` and approved web links wait for auth/onboarding and then open only a query-free allowlisted destination; provider callbacks, auth/onboarding file routes, emergency modals, malformed/traversal URLs, foreign hosts, credentials/ports, HTTP, and unknown schemes do not become app routes.

## 3. State and Data Persistence

- [ ] Voice, language, companion visibility, offline preference, and reminder toggle update only after a successful save and persist after force-quit.
- [ ] Capybear reminder Enable schedules one daily reminder; Disable/Skip cancels it; denial produces an honest disabled state and Settings recovery.
- [ ] Create conversation history, force-quit, relaunch, and retrieve it; empty history has a clear empty state.
- [ ] Add/edit/remove emergency contacts, relaunch offline and online, and verify no valid cache is erased by a timeout or edit conflict. **BLOCKED — EXTERNAL** for remote edits until the updated safety backend with authenticated `PATCH` support is deployed; local/offline editing is implemented.
- [ ] Save and remove locations in Saved Places; verify valid timestamps/coordinates, an eight-item cap, relaunch persistence, and the empty state.
- [ ] Pair/remove a VL01 and relaunch; metadata belongs only to the active account and removed state does not reappear. **BLOCKED — EXTERNAL** without approved physical hardware/firmware.
- [ ] Sign out: prior account data is removed, language alone is retained, and the session cannot resurrect after force-quit.
- [ ] Sign in as a different account: contacts, history, queues, locations, Saved Places, navigation, and paired device from the first account are absent.
- [ ] Export with the backend online, offline, and timing out. Local data remains in the JSON and remote status is clearly included/unavailable/not configured.
- [ ] Make remote deletion fail. The user remains signed in and can retry; local credentials/data are not prematurely removed.
- [ ] Complete deletion successfully. Local session/data/artifacts disappear and relaunch remains signed out. **BLOCKED — EXTERNAL** for full vendor/backup deletion, revocation, and tombstone evidence.

## 4. Errors, Loading, Empty States, and Retry

- [ ] Slow auth/settings/contact/device restoration shows a loading state and cannot be tapped through.
- [ ] Airplane mode, timeout, HTTP error, malformed response, and recovery are exercised for each configured API surface.
- [ ] App messages are friendly and actionable; no stack trace, raw native/provider message, bearer, internal URL, or exception text is visible.
- [ ] Failed settings/reminder/contact/Saved Places actions do not show a success state or lose the last valid value.
- [ ] Failed WebSocket send becomes one durable queued message and sends once after reconnect.
- [ ] Map distinguishes live, cached-with-time, unavailable, and retry states; stale location is not sent as current SOS data.
- [ ] SOS wording distinguishes stored acceptance, dialer opened, call connection, and actual delivery; no screen claims a guardian or emergency service was notified without a receipt.
- [ ] Every list/data surface has a useful loading, empty, failure, and retry state where applicable.

## 5. Components, Responsive Layout, and Accessibility

- [ ] iPhone SE-class/small width, current Pro-class iPhone, and iPad are tested in supported portrait and landscape orientations.
- [ ] On iPad, resize through split-view widths; no clipped actions, blank screen, overlap, or unreadably wide content appears.
- [ ] Spacing, typography, colors, button/input treatment, icons, and feedback banners remain consistent across screens.
- [ ] All controls have at least a practical 44-point target and visible pressed/disabled/loading state.
- [ ] Dynamic Type is tested through the largest supported accessibility sizes; essential text/actions remain reachable by scrolling.
- [ ] VoiceOver reaches controls in a logical order, announces labels/roles/checked/disabled/live status, and ignores decorative art.
- [ ] Keyboard entry, dismissal, return actions, autofill, and form error focus work without hiding the active field/action.
- [ ] Contrast remains readable in normal/high-contrast conditions. The product is intentionally light-only; do not mark dark mode as supported.
- [ ] Store builds contain no development danger-zone fixture, demo auth action, mock contact, placeholder success, or broken image/icon.

## 6. Permissions

- [ ] Location rationale appears before the first prompt; allow, deny, revoke, Settings recovery, retry, foreground return, and cached fallback are correct.
- [ ] Notification rationale appears before the first prompt; allow, deny, Settings recovery, return/recheck, scheduling, delivery, and opt-out are correct on the signed build.
- [ ] Microphone rationale appears before the first safety call; allow, deny, revoke, Settings recovery, interruption, and repeated call cleanup are correct.
- [ ] Bluetooth rationale and OS prompt are correct; powered-off, denied, unsupported, and later-enabled states are actionable. **BLOCKED — EXTERNAL** for protocol behavior without VL01 hardware.
- [ ] No camera or photo-library permission is requested or declared by the tested build.

## 7. Background, Foreground, Audio, BLE, and Performance

- [ ] Background/foreground and lock/unlock during auth refresh, Map, notification Settings recovery, voice, and BLE return to one consistent UI state.
- [ ] Airplane mode and Wi-Fi/cellular transitions do not duplicate requests/messages/SOS records or leave endless spinners.
- [ ] Live voice handles microphone/audio interruptions, speaker/earpiece/Bluetooth routes, lock screen, reconnect cap, and repeated start/stop without leaked audio. **BLOCKED — EXTERNAL** without production Hume and physical-device evidence.
- [ ] VL01 scan/connect/reconnect stops or resumes according to policy across backgrounding, Bluetooth changes, wearable loss/reset, and account switching. **BLOCKED — EXTERNAL** without approved device/firmware.
- [ ] Long history/map use and rapid navigation scroll smoothly; capture profiler/memory evidence for excessive commits, retained screens, or growth after repeated calls/pairing.
- [ ] Review TestFlight crash/ANR and redacted app/backend logs for the test window; no fatal, unhandled promise, secret/PII log, or unexplained duplicate operation remains.

## 8. Release Exit Decision

- [ ] Every FAIL has a linked defect, owner, severity, target build, and retest result.
- [ ] Every BLOCKED — EXTERNAL has a named owner, missing resource, due date, and exact closure evidence.
- [ ] Language screenshots/video and native-speaker status are attached.
- [ ] The exact TestFlight build passes clean install, previous-build upgrade, force-quit/relaunch, permission denial/recovery, two-account isolation, and the supported device matrix.
- [ ] Backend, auth/SMS, Hume/audio, SOS delivery, APNs, Mapbox, privacy lifecycle, VL01, security, observability, rollback, legal/privacy, and store-review P1 gates in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) are closed.

Final decision:

- [ ] **UI FOUNDATION ACCEPTED FOR THIS TESTFLIGHT BUILD** — every applicable UI item passed and all external blockers are explicitly owned.
- [ ] **NO-GO / NEW BUILD REQUIRED** — one or more P0/P1 defects or unowned blockers remain.

Approvals:

- QA lead:
- Grace / release coordinator:
- Mobile owner:
- Localization owner:
- Safety/Privacy owner:
