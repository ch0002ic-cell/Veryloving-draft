# Mobile Polish Manual QA Matrix

Status: **PASS — test plan complete; execution status is recorded per row**

Last reviewed: 22 July 2026

This matrix turns the mobile design-system and product-polish expectations into repeatable acceptance checks. It deliberately separates source/automated evidence from simulator, emulator, signed-build, provider, and physical-device evidence. A JavaScript export or passing unit test must never be used to mark a native interaction **PASS**.

## 1. Status vocabulary

| Status | Meaning |
| --- | --- |
| **PASS — SOURCE REVIEW** | The implementation contract is present and was inspected. This is not visual or native-runtime evidence. |
| **PASS — AUTOMATED** | The named command passed on the exact recorded commit and output is attached. |
| **PASS — SIMULATOR** | The flow passed on a recorded iOS Simulator build for the exact candidate. |
| **PASS — EMULATOR** | The flow passed on a recorded Android Emulator build for the exact candidate. |
| **PASS — PHYSICAL DEVICE** | The flow passed on the recorded physical device and signed/development build. |
| **REQUIRES SIMULATOR** | Visual or iOS lifecycle behavior must be exercised in an iOS Simulator; no current-candidate evidence is recorded here. |
| **REQUIRES EMULATOR** | Android behavior must be exercised in an Android Emulator; no current-candidate evidence is recorded here. |
| **REQUIRES PHYSICAL DEVICE** | Radios, camera, audio routes, notifications, assistive technology, performance, or signed persistence cannot be accepted from source/simulator evidence alone. |
| **BLOCKED — EXTERNAL** | Production credentials, provider delivery, manufacturer API, or real hardware is required. Keep an owner and unblock action. |
| **FAIL** | Actual behavior did not meet the acceptance criteria; capture evidence and open a defect before release. |

When a row has more than one required environment, record a result for each environment. Do not collapse “iOS passed, Android not run” into one PASS.

## 2. Candidate record

Complete this block before execution:

| Field | Value |
| --- | --- |
| Tester | _To record_ |
| Date/time and timezone | _To record_ |
| Git commit SHA | _To record_ |
| App version/build number | _To record_ |
| Build/profile | Expo Go / development / preview / TestFlight / production |
| iOS device and OS | _To record_ |
| Android device and OS | _To record_ |
| Backend version/base URL class | local mock / staging / production; do not paste secrets |
| Install path | clean / upgrade from version |
| Network conditions | normal / constrained / offline / restored |
| Accessibility configuration | font scale, screen reader, Reduce Motion, contrast settings |
| Evidence folder/ticket | _To record_ |

## 3. Source and automated gates

The design-system contract below is inspectable in the current source. Automated rows must be re-run after all mobile polish changes and recorded against the final SHA.

| ID | Check | Acceptance | Current status |
| --- | --- | --- | --- |
| POLISH-SRC-001 | Semantic tokens | Color, typography, spacing, radius, size, shadow, motion, and layout tokens have one canonical source in `src/constants/theme.js`. | **PASS — SOURCE REVIEW** |
| POLISH-SRC-002 | Shared actions/surfaces | `Button` exposes variant, loading, disabled, selected, icon, hint, and 44-point minimum behavior; `Card` exposes stable surface/padding variants. | **PASS — SOURCE REVIEW** |
| POLISH-SRC-003 | Shared patterns | Header/onboarding hierarchy, text field, action tile, status pill, feedback banner/snackbar, empty state, bounded loading/skeletons, and dual-device status card are reusable components. | **PASS — SOURCE REVIEW** |
| POLISH-SRC-004 | Safe screen container | `Screen` supplies safe area, keyboard avoidance, scroll behavior, and readable-width containment. | **PASS — SOURCE REVIEW** |
| POLISH-AUTO-001 | Lint | `npm run lint` exits zero on the final SHA, with no new warnings. | **PASS — AUTOMATED** (22 July 2026) |
| POLISH-AUTO-002 | Test suite | `npm test` and applicable targeted suites exit zero on the final SHA. | **PASS — AUTOMATED** (22 July 2026) |
| POLISH-AUTO-003 | Expo dependency/config health | `npm run doctor` reports the repository's expected full pass on the final SHA. | **PASS — AUTOMATED** (Expo Doctor 20/20, 22 July 2026) |
| POLISH-AUTO-004 | iOS production JS export | `npx expo export --platform ios` exits zero with no Metro/Babel/module-resolution failure. | **PASS — AUTOMATED** (22 July 2026) |
| POLISH-AUTO-005 | Android production JS export | `npx expo export --platform android` exits zero with no Metro/Babel/module-resolution failure. | **PASS — AUTOMATED** (22 July 2026) |
| POLISH-AUTO-006 | Diff hygiene | `git diff --check` exits zero; no credential, generated `.env`, build output, or unrelated artifact is staged. | **PASS — AUTOMATED** (22 July 2026) |

The repository's `npm run validate` is the preferred combined source gate. It is still not a native compile/install, signed TestFlight/Play artifact, or physical-device result.

## 4. Core visual and interaction walkthrough

### Launch, authentication, and onboarding

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-AUTH-001 | iOS Simulator | Clean install; launch on normal network; observe font/session hydration; enter development demo mode. | Branded loading is readable and announced once; it resolves without an indefinite spinner; demo sign-in reaches the protected app once; no “sign-in interrupted” alert or redirect loop. | **REQUIRES SIMULATOR** |
| POLISH-AUTH-002 | Android Emulator | Repeat clean launch and demo-mode entry; use system Back during onboarding. | No blank frame, navigation loop, or double route; Back behavior is predictable and never bypasses onboarding. | **REQUIRES EMULATOR** |
| POLISH-AUTH-003 | Simulator + emulator | Throttle or disconnect network before demo entry, then restore it; rapidly tap the CTA twice. | Demo mode remains local, one transition is committed, the busy state prevents duplicates, and a bounded/actionable failure replaces any indefinite loading. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-AUTH-004 | Signed physical iPhone/Android | Exercise Apple, Google, and phone flows: success, cancellation, provider failure, background return, and retry. | Cancellation is not described as connection failure; provider errors are localized/redacted; protected routes remain closed until verified; account state persists only as designed. | **BLOCKED — EXTERNAL** (provider credentials) and **REQUIRES PHYSICAL DEVICE** |
| POLISH-AUTH-005 | Simulator + emulator | Force-quit at each onboarding step and relaunch; traverse every tutorial step once. | The latest committed step resumes; visible and announced progress match the actual step; no completed permission/pairing step is falsely inferred; contextual art is decorative; the user can continue or choose the documented skip path. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |

### Home, quick actions, and safety modes

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-HOME-001 | Compact/current iOS Simulator + Android Emulator | Open Home with zero devices, wearable only, robot only, and both entities. | Wearable and robot remain visually/textually distinct; unknown data is shown as offline/absent, not online; cards wrap without clipping; My Devices is discoverable. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-HOME-002 | Simulator + emulator | Activate Home, Guardian, then Emergency mode; observe/dismiss the success snackbar; double-tap and switch during slow response. | Selected mode is visible and announced; only affected controls become busy; duplicate requests are suppressed; confirmed success appears once and dismisses cleanly; failure retains the last confirmed mode and offers persistent retry rather than a transient-only error. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-HOME-003 | Simulator + emulator | Exercise Safety Call, Excuse Call, Friends, medication (when a robot is present), Settings, and SOS quick actions. | One tap opens the correct route; target labels remain readable at large text; SOS is visually separated from routine actions and is not accidentally triggered. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-HOME-004 | Simulator + emulator | Switch to RTL, return to Home, then switch back to LTR. | Rows, directional icons, and text alignment mirror exactly once; device identity and chronological/state values remain correct. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |

### SOS, contacts, and safety truthfulness

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-SAFE-001 | Simulator + emulator | Open SOS; cancel; reopen; confirm with backend available, unavailable, and timed out. | Confirmation is explicit; cancellation is immediate; submitted/stored/accepted/delivered states are not conflated; failure is localized and retryable; repeat taps do not create duplicate incidents. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-SAFE-002 | Physical phone | Invoke emergency dialer and return to the app; deny call capability where supported. | App distinguishes “dialer opened” from “call connected”; return route is safe; denial/failure does not claim help was reached. | **REQUIRES PHYSICAL DEVICE** |
| POLISH-SAFE-003 | Simulator + emulator | Add, edit, delete, and reorder/revisit emergency contacts; submit malformed values and force persistence failure. | Labels and validation are clear; destructive action is confirmed; the last valid state survives failure; empty state explains how to add a contact. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-SAFE-004 | Production provider + physical phone | Trigger the approved emergency-contact push/SMS/call path and verify receipts, deduplication, opt-out, and invalid-token cleanup. | One intended delivery per incident with an auditable provider receipt and no PII in logs. | **BLOCKED — EXTERNAL** |

### Device management, BLE, and robot pairing

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-DEV-001 | Simulator + emulator with test records | Open My Devices with none, one, and multiple wearables/robots; rename each; relaunch. | One card per registry entity; names persist to the correct account/device; status and last-seen copy are honest; add/remove actions remain obvious. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-DEV-002 | Simulator + emulator | Switch Account A → sign out → Account B after storing device metadata. | Account B never sees Account A's names, bindings, locations, battery, queued actions, or stale markers; sign-out cleanup does not hang. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-DEV-003 | Physical BLE-capable iPhone/Android + VL01 | Test rationale, deny, Settings recovery, scan filter, connect, GATT discovery, battery/status/events, long command fragmentation, disconnect, bounded reconnect, and STOP priority. | No simulator-only BLE error is shown as an app fault; state is clear; no duplicate listeners/commands; STOP bypasses queued routine work; recovery is bounded. | **REQUIRES PHYSICAL DEVICE** and **BLOCKED — EXTERNAL** (VL01) |
| POLISH-DEV-004 | Physical phone camera + mock backend | Deny camera, grant in Settings, scan valid/invalid/expired/replayed robot QR, background during pairing, then relaunch. | Rationale precedes prompt; permanent denial has a Settings route; progress is visible; token replay is rejected; no serial is logged or displayed; the binding appears once. | **REQUIRES PHYSICAL DEVICE** |
| POLISH-DEV-005 | Physical manufacturer robot | Pair, disconnect Wi-Fi, restore it, command it, factory-reset, and re-pair under approved vendor contract. | Offline state updates without crashing; queued behavior follows policy; reset clears ownership safely; acknowledgement never implies physical completion. | **BLOCKED — EXTERNAL** |

### Map and location

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-MAP-001 | iOS Simulator + Android Emulator | Open Map with token present; simulate movement for wearable and robot; change entity arrays rapidly. | Distinct markers update without ghost/stale duplicates; camera remains stable; overlays do not block map controls; stale/unknown location is labelled. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-MAP-002 | Simulator + emulator | Run with missing token, style error, permission denied, no cached location, stale cached location, and restored network. | Each state has informative copy and one useful action; no infinite spinner or blank map; retry recovers without duplicate sources/listeners. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-MAP-003 | Simulator + emulator | Create/delete Saved Places and perform Quick Share; test failure/cancel and account switch. | The list and map agree; delete is confirmed; share uses a bounded snapshot with no hidden precise-location logging; cancellation is not failure; data is account-bound. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-MAP-004 | Physical phone | Walk/drive with screen locked/backgrounded under approved permission setting, then reopen. | Freshness and background behavior match disclosure; battery impact is measured; stale data is never presented as live. | **REQUIRES PHYSICAL DEVICE** |

### Voice, conversation, medication, and care

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-CARE-001 | Simulator + emulator with mock backend | Open voice UI online, connecting, failed, offline text fallback, reconnecting, and ended; send/resume history. | Status is visually clear and announced without chatter; controls remain available; typed fallback queues once; history has useful loading/empty/error/retry states. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-CARE-002 | Physical phone + Hume staging | Exercise microphone permission, capture/playback, barge-in, Bluetooth route, interruption, lock/background, network split, reconnect, and repeated calls. | No overlapping playback, orphan recording, runaway reconnect, leaked temporary audio, or silent loss; state copy matches transport; latency is recorded. | **REQUIRES PHYSICAL DEVICE** and **BLOCKED — EXTERNAL** (Hume credentials) |
| POLISH-CARE-003 | Simulator + emulator with mock robot | Create, edit, enable/disable, and delete a medication reminder; test no robot, offline robot, and scheduling failure. | The screen explains the robot dependency; time/medication labels are clear; mutation feedback is honest; failure retains the prior schedule; empty state is actionable. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-CARE-004 | Simulator + emulator | Walk through any exposed cognitive/emotional entry points; otherwise verify no control claims the capability exists. | Only implemented, reachable functionality is advertised. Scenario-engine capability is not presented as a completed mobile experience without a route and user controls. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |

### Settings, privacy, and localization

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-SET-001 | Simulator + emulator | Traverse every Settings row; use Back/Home fallback; toggle settings rapidly and relaunch. | Grouping and icon treatment are consistent; each row has one meaning; saved state is durable and no stale write wins; unavailable capability is explained. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-SET-002 | Simulator + emulator | Export local/mock account data; cancel share; inject local and remote failures; retry. | Progress is visible; output is complete or explicitly partial; cancellation is not shown as an error; temporary file is removed; sensitive content is not logged. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-SET-003 | Simulator + emulator | Start delete-all, cancel, confirm with success, then inject partial remote failure and relaunch. | Consequences are explicit; cancel preserves data; failure remains retryable and never presents false success; successful deletion clears protected/account-bound state and cannot resurrect. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-LANG-001 | Development/signed native builds | Change English → Spanish → French → Simplified Chinese; navigate without relaunch; force-quit and reopen. | Mounted app-owned copy updates immediately, choice persists, no missing key appears, and native reminder copy follows the committed locale. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR**; signed persistence also **REQUIRES PHYSICAL DEVICE** |
| POLISH-LANG-002 | Development/signed native builds | Change English → Arabic/Hebrew → relaunch → English; repeat quickly. | One bounded direction reload per actual change; no reload loop; navigation and icons mirror; language and reminder state remain consistent. Expo Go is not acceptance evidence. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR**; final acceptance **REQUIRES PHYSICAL DEVICE** |
| POLISH-LANG-003 | Native-speaker review | Review every public catalog's authentication, permission, SOS, failure, privacy deletion, and emergency copy in context. | Wording is natural, unambiguous, culturally appropriate, and legally approved; structural catalog coverage alone is insufficient. | **BLOCKED — EXTERNAL** |

## 5. Accessibility and responsive-layout matrix

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-A11Y-001 | iOS Simulator preliminary; physical iPhone final | Enable VoiceOver; traverse auth, Home, mode selector, SOS confirmation, My Devices, Map fallback, voice controls, Settings, privacy confirmation, and QR denial. | Focus order follows reading/task order; headings, labels, hints, busy/disabled/selected states, and live feedback are useful; decorative art is skipped; no focus trap. | Preliminary **REQUIRES SIMULATOR**; final **REQUIRES PHYSICAL DEVICE** |
| POLISH-A11Y-002 | Android Emulator preliminary; physical Android final | Repeat with TalkBack and system Back. | Same semantic result as iOS; no inaccessible custom pressable; announcements are not duplicated; Back dismisses the expected layer. | Preliminary **REQUIRES EMULATOR**; final **REQUIRES PHYSICAL DEVICE** |
| POLISH-A11Y-003 | Simulator + emulator; physical final | Set maximum supported Dynamic Type/font size and Bold Text where available; complete all critical flows. | Text wraps without clipping/overlap; controls grow; scroll reaches every field/action; SOS confirm/cancel remains accessible; status is not truncated into ambiguity. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR**; final **REQUIRES PHYSICAL DEVICE** |
| POLISH-A11Y-004 | Simulator + emulator | Enable Reduce Motion and repeat navigation, banner, empty-state, modal, and selected-mode changes. | No essential state depends on animation; reduced-motion behavior follows the platform setting; no looping or disorienting transition remains. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-A11Y-005 | Simulator/emulator + measurement tool | Check every semantic foreground/background pair and inspect controls at default/pressed/disabled/focused states. | Body/large text and non-text contrast meet the approved target; focus/selected state is visible without color alone; touch targets are at least 44 points. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-LAYOUT-001 | iOS Simulator | Test compact iPhone, current notched iPhone, landscape where supported, 11-inch iPad portrait/landscape, and split view. | No horizontal clipping, unsafe-area collision, unreachable action, fixed overlay collision, or unreadably wide paragraph. | **REQUIRES SIMULATOR** |
| POLISH-LAYOUT-002 | Android Emulator | Test representative small phone, large phone, tablet width, display scaling, keyboard open, and gesture/three-button navigation. | Content reflows and remains reachable; keyboard does not cover input/actions; system insets and Back remain correct. | **REQUIRES EMULATOR** |

## 6. Lifecycle, failure, and resource checks

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-LIFE-001 | Simulator + emulator | Pair/store mock entities, save preferences/places, force-stop, relaunch, then switch accounts. | Registry and UI rehydrate before dependent markers/actions render; account boundary remains intact; no ghost marker or stale device status appears. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-LIFE-002 | Simulator + emulator | Background/foreground repeatedly during login, map refresh, voice reconnect, reminder mutation, QR pairing, and privacy export. | Stale completions do not overwrite newer state; timers/listeners are cleaned; one operation resumes or fails visibly; no unhandled rejection. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-LIFE-003 | Simulator + emulator | Toggle network normal → offline → constrained → restored while wearable mock and robot REST state coexist. | Robot becomes offline without crashing or blocking wearable UI; retry is bounded; queued state is honest; restoration does not duplicate work. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
| POLISH-LIFE-004 | Physical phones | Repeat 30 voice open/close cycles, 30 map visits, 20 BLE scans, background/lock cycles, and one-hour telemetry observation; capture native memory/energy. | No sustained handle/listener growth, runaway timer/reconnect, overheating, crash, or material unexplained battery drain. | **REQUIRES PHYSICAL DEVICE** |
| POLISH-LOG-001 | Simulator/emulator/device | Capture mobile and backend logs during success/failure cases; search for tokens, phone/email, coordinates, serials, raw messages, audio text, and stack traces in user-visible copy. | Structured codes and redacted references only; no credential/PII/precise location/serial/provider payload leakage. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** / **REQUIRES PHYSICAL DEVICE** |

## 7. Exit criteria

The mobile polish pass can be called **source-complete** when all automated rows pass on the exact SHA and no known source defect remains. It can be called **demo-ready** when both simulator/emulator matrices relevant to the demo pass and the recording discloses mocked capabilities. It can be called **signed-build accepted** only when all applicable physical-device and TestFlight/Play rows pass.

Release remains **NO-GO** when any of these is true:

- a critical route can hang, crash, duplicate an action, bypass authentication, or present false success;
- SOS confirmation/cancellation or account isolation fails;
- a critical control is unreachable at large text or with a screen reader;
- BLE, camera, microphone, notification, background, or signed persistence is claimed without physical-device evidence;
- provider delivery or manufacturer behavior is claimed without approved external evidence;
- a required row is untested and has no accepted owner/date.

For the complete release record and external gates, use the [main TestFlight acceptance checklist](../README.md#12-testflight-acceptance-checklist). For component rules, see the [VeryLoving Mobile Design System](./design-system.md).
