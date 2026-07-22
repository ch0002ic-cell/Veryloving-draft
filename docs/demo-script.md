# Polished Mobile Ecosystem Demo Script

Status: **PASS — recording script ready; runtime/provider/hardware claims remain evidence-gated**

Target length: 2 minutes 45 seconds

Last reviewed: 22 July 2026

## 1. Story and guardrails

This walkthrough shows how one calm mobile experience coordinates VeryLoving's personal-safety wearable and home companion robot. The story should feel useful before it feels technical: the user can understand device health, choose a safety posture, ask for support, and control their data without interpreting raw telemetry.

For a local demonstration, keep a persistent **SIMULATED DEVICES — NOT FOR MEDICAL OR EMERGENCY USE** label in the recording. Use fictional accounts, contacts, medication, device names, locations, and health events. Do not show environment values, tokens, internal URLs, QR payloads, hardware serials, phone numbers, precise coordinates, raw camera/microphone media, or terminal history.

The phrase “Veryloving.ai is the first unified AI-native safety and care ecosystem” is supplied marketing copy, not an independently verified market-leadership claim. Legal/marketing must substantiate or revise “first” before external publication.

Never claim that:

- an accepted SOS or device command was delivered or physically completed;
- a simulator demonstrates clinical fall detection, battery performance, navigation, or emergency reliability;
- scripted/offline text is a live Hume EVI exchange;
- an offline placeholder card represents a paired/online device;
- camera, BLE, push, or provider behavior passed without the matching physical/external evidence.

## 2. Pre-demo setup

1. Record the final commit SHA and pass the source gates in [`mobile-polish-qa.md`](./mobile-polish-qa.md).
2. Use a development build or simulator session with development demo mode enabled. Demo mode is volatile and intentionally unavailable in store builds.
3. Reset the app to a known fictional account. Clear accidental contacts, locations, history, and notifications from earlier rehearsals.
4. Decide which honest device state to show:
   - **Local-only path:** leave both cards offline and explain how the interface communicates absence safely.
   - **Connected mock path:** use the repository's approved local test fixture/backend to create one fictional wearable and one fictional robot. Label both simulated. Never edit visible JSON or storage during the recording to manufacture a result.
5. If using Mapbox, configure only the approved public development token and a fictional location. Otherwise use the implemented map-unavailable state and explain recovery.
6. If Hume staging is unavailable, use the implemented offline text fallback and label it **OFFLINE FALLBACK — NOT LIVE HUME**.
7. Optional cross-device ending: start the loopback mock manufacturer server and main development server, then open `http://127.0.0.1:3001/dashboard`. The dashboard is development-only and must not be exposed on a production interface.
8. Enable screen-recording privacy controls: hide notifications, browser accounts/bookmarks, terminal windows, and system location indicators that could reveal real data.

## 3. Timed 2–3 minute walkthrough

| Time | Screen and action | Presenter script |
| --- | --- | --- |
| 0:00–0:12 | Title card, then launch into the branded loading state | “Veryloving.ai brings personal safety and at-home care into one intentionally calm experience.” If approved: “Veryloving.ai is the first unified AI-native safety and care ecosystem.” **Substantiate before publication.** |
| 0:12–0:28 | Authentication/onboarding; choose **Continue as demo** | “For this local walkthrough I’m using a development-only, volatile demo session—no production identity or health data. Loading, authentication, and routing resolve into a clear next step instead of leaving the user at a blank spinner.” |
| 0:28–0:55 | Home: point to wearable and robot status cards, quick actions, and the separated SOS control | “Home answers the three questions that matter now: which devices belong to me, can they act, and what can I do next? The wearable and robot keep distinct identities and connection states. Routine actions are grouped together; SOS stays visually separate so urgency never becomes visual noise.” If cards are offline: “They are honestly shown offline—pairing is not the same as connectivity.” |
| 0:55–1:12 | Select Home, Guardian, then Emergency safety mode | “Safety modes use label, icon, color, and selected state together. While a change is being confirmed, the affected control shows progress and duplicate taps are blocked. A failed request keeps the last confirmed mode rather than showing false success.” |
| 1:12–1:32 | Map tab; show configured map with distinct markers, or the map-unavailable recovery state; open Quick Share/Saved Places if configured | “Location is useful only when its freshness and source are clear. Wearable and robot markers are distinct, saved places remain account-bound, and the unavailable state explains what is missing instead of presenting an empty map. Quick Share creates a deliberate snapshot; it is not silent continuous sharing.” |
| 1:32–1:53 | Open Safety Call; show connection state and typed/offline fallback; return safely | “The companion surface makes the transport state explicit. In a configured environment it connects through the authenticated Hume gateway and supports interruption. Today I’m showing the labelled offline fallback, so the app remains usable without pretending the cloud is available.” Use live Hume wording only when the session is actually verified. |
| 1:53–2:10 | Open My Devices; show wearable/robot cards, rename affordance, status, and Add Robot QR entry without scanning | “My Devices provides one place to name and understand both product lines. Friendly names never replace hardware identity, offline status is visible, and adding a manufacturer-controlled robot begins with explicit QR consent and a one-time account binding.” Do not invoke the camera unless permission copy and a physical-device QR test are ready. |
| 2:10–2:29 | Open Settings; briefly show medication, language, and Privacy; open export/delete confirmation without confirming | “Care preferences and privacy controls are first-class product features. Medication reminders explain their robot dependency. Language changes update app-owned copy, including RTL in supported builds. Export and deletion explain scope, show progress, and never claim completion after a partial failure.” |
| 2:29–2:40 | Open SOS confirmation, point to confirm/cancel, then cancel | “In an emergency, the interface is direct but still truthful. The user confirms intent, can cancel safely, and the app distinguishes a stored request, an opened dialer, and verified delivery.” Never send a real alert during the demo. |
| 2:40–2:55 | Closing ecosystem view; optionally cut to the local mock dashboard showing a bounded simulated scenario | “The mobile experience is the control surface for one ecosystem: Product 1 supports the user on the go, Product 2 supports them at home, and the orchestration layer coordinates without coupling either product to one manufacturer. The remaining gates are real provider credentials, approved vendor APIs, and physical-device validation.” |

If the recording must stay under 2:30, omit the optional dashboard cut and shorten the Settings segment. Do not speed up safety confirmation copy.

## 4. Optional 20-second cross-device insert

Use this only when both local servers are running and the dashboard visibly identifies all data as simulated.

1. Trigger the predefined synthetic fall scenario using the dashboard's development control.
2. Show one wearable event and one scenario execution with a correlated, fictional execution reference.
3. Show the robot action moving through `requested` and mock acknowledgement.
4. If a fallback is demonstrated, force the robot offline and show one caregiver fallback—not a real message or call.

Narration:

> “Here a synthetic wearable fall observation starts a critical cross-device workflow. The robot path has its own queue and timeout, so it cannot block the wearable or emergency fallback. The dashboard shows software request and acknowledgement states; it does not claim that a physical robot arrived or that a caregiver received a real alert.”

Do not use a green completion symbol for a physical outcome the mock cannot verify.

## 5. Visual capture direction

### Framing

- Record a current notched iPhone at native aspect ratio, 30 fps, with the simulator frame hidden or intentionally styled.
- Keep the pointer/touch indicator slow and deliberate. Pause after each navigation or state change.
- Use the light-only interface as implemented; do not fake a dark theme.
- Avoid rapid scrolling. Let the home hierarchy, device cards, and critical action separation stay visible long enough to read.
- If the browser dashboard appears, crop browser chrome and keep the simulation banner in frame.

### Accessibility presentation

- Add captions and provide a transcript.
- Keep captions away from bottom navigation, status pills, and destructive-action labels.
- Record one short optional clip with VoiceOver focus on the Home heading, a device status card, selected safety mode, and SOS button—but only after the corresponding QA row passes.
- If showing RTL, use a supported development/standalone build and record one complete direction transition. Expo Go is not RTL acceptance evidence.

### Editing and privacy

- Use straight cuts or restrained 140–240 ms transitions consistent with the design-system motion scale.
- Do not add artificial “AI thinking,” heartbeat, radar, camera, or delivery animation that could be mistaken for runtime behavior.
- Blur any accidental notification, avatar, account identifier, hostname, device identifier, location, QR data, or system log.
- Keep labels such as **SIMULATED DEVICE**, **OFFLINE FALLBACK**, **MOCK ACKNOWLEDGEMENT**, and **EXTERNAL VALIDATION REQUIRED** large enough to read on a phone-sized frame.

## 6. Rehearsal failure paths

Before the final take, rehearse these outcomes even if they are not all shown:

| Failure | Expected presentation |
| --- | --- |
| Font/session hydration is slow | Branded bounded loading, then usable fallback or localized retry—not an indefinite spinner. |
| Demo CTA tapped repeatedly | One session transition and one route. |
| Map token or location unavailable | Explanatory state with retry/settings action; no blank canvas. |
| Robot offline | Robot card changes to offline; wearable and routine app navigation remain usable. |
| Voice gateway unavailable | Clear offline state and typed fallback; no endless connecting animation. |
| Privacy export cancelled | Cancellation is neutral, temporary file is cleaned, and no error alert is fabricated. |
| SOS backend unavailable | No false delivery; user can retry or use the clearly described phone fallback. |

Any unexpected spinner, duplicate route, raw error, stale online state, overlapping control, missing back path, or unlabelled mocked result blocks recording until fixed.

## 7. Recording acceptance checklist

- [ ] Exact app commit/build and mock/backend versions are recorded.
- [ ] Applicable automated and simulator rows in [`mobile-polish-qa.md`](./mobile-polish-qa.md) pass.
- [ ] The demo-mode notice and simulation/non-medical disclaimer are visible.
- [ ] No PII, credential, serial, private URL, precise coordinate, or raw sensor/media payload appears.
- [ ] Home presents wearable and robot identity/status honestly.
- [ ] Safety modes show clear selected and busy behavior.
- [ ] SOS remains separate and no acceptance is described as delivery.
- [ ] Map freshness/configuration state is honest.
- [ ] Voice is labelled live only when Hume is genuinely connected; otherwise offline/scripted wording is used.
- [ ] QR, BLE, camera, push, and hardware behavior are not claimed without matching evidence.
- [ ] Privacy export/delete and language behavior are described within their implemented boundaries.
- [ ] Any dashboard segment remains loopback-only and visibly simulated.
- [ ] The closing statement names external provider/vendor/hardware gates.
- [ ] The word “first” is substantiated and approved, or removed.

For component and content rules, see [`design-system.md`](./design-system.md). For AI-native architecture and the mock scenario engine, see [`ai-native-integration-guide.md`](./ai-native-integration-guide.md) and [`demo-dashboard.md`](./demo-dashboard.md).
