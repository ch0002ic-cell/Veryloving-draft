# AI-Native Dual-Product Demo Script

Status: development demonstration — all people, health signals, locations, calls, messages, and device behavior are simulated

Target length: 2 minutes 45 seconds

Last reviewed: 20 July 2026

## 1. Presenter guardrails

This walkthrough demonstrates deterministic software orchestration, not production hardware or clinical performance. Display a persistent **SIMULATED — NOT FOR MEDICAL OR EMERGENCY USE** banner. Use fictional names, synthetic sensor values, a fictional map location, and development-only credentials. Do not show terminal environment values, authentication headers, signed envelopes, hardware serials, phone numbers, raw camera/microphone content, or real account data.

The opening phrase supplied by the product team — “Veryloving.ai is the first unified AI-native safety and care ecosystem” — appears below as **spoken marketing copy**, not as an independently verified market-leadership claim. Legal/marketing should substantiate or revise “first” before external publication.

## 2. Pre-demo setup

1. Build and test the current branch before recording.
2. Start the local manufacturer simulator with failures disabled and a stable seed.
3. Open the simulator dashboard at `http://127.0.0.1:3001/dashboard`.
4. Show one fictional wearable and one fictional home robot online with healthy synthetic battery levels.
5. Confirm the dashboard's `scenarioExecutions` list has no active incident. The current HTML dashboard is a read-only formatted JSON snapshot, not a polished product UI.
6. Prepare the deterministic fall event, robot-navigation success, voice-check timeout, correlated mock `camera_ready` acknowledgement, and caregiver-alert acknowledgement. If the camera correlation is not configured, use the no-camera branch instead of fabricating a link.
7. If Hume is not provisioned, label the conversation **SCRIPTED HUME PLACEHOLDER**. Never imply that the local text is a live Hume EVI exchange.
8. Disable desktop notifications and hide browser bookmarks, account avatars, terminal history, and environment panes.

Suggested development command:

```bash
NODE_ENV=development \
MOCK_MANUFACTURER_FAILURE_RATE=0 \
MOCK_MANUFACTURER_FALL_EVENT_RATE=0 \
MOCK_MANUFACTURER_STRESS_EVENT_RATE=0 \
MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS=0 \
MOCK_MANUFACTURER_SEED=1447833650 \
npm run mock:manufacturer
```

## 3. Timed walkthrough

| Time | Screen/action | Presenter script |
| --- | --- | --- |
| 0:00–0:15 | Title card: wearable + home robot + “SIMULATED” banner | “Veryloving.ai is the first unified AI-native safety and care ecosystem.” **Spoken marketing copy; substantiate before publication.** “One account connects an on-the-go safety wearable with a home companion robot.” |
| 0:15–0:32 | Dashboard shows both fictional devices online | “Product 1 continuously interprets local motion and wellness signals. Product 2 contributes presence, conversation, and home assistance. The intelligence layer sees one consented user context while each device keeps an independent command queue.” |
| 0:32–0:48 | Inject a synthetic wearable fall; fall card appears | “Here, a simulated impact followed by inactivity produces a fall observation. The edge classifier is local and fast in this software demo. The Scenario Engine validates the event, assigns critical priority, and deduplicates it.” |
| 0:48–1:08 | Timeline: `fall_detection` → opaque `home-bedroom` reference → robot navigation request | “The engine combines a server-owned location reference with the active robot binding. The provider—not the AI model—resolves that reference under the account’s location policy, without exposing coordinates or a manufacturer serial.” |
| 1:08–1:28 | Mock navigation ACK changes status to checking; switch to an **ILLUSTRATIVE SCRIPTED CALL** overlay | “The mock acknowledges the navigation command; this does not prove physical arrival. The workflow then requests a two-way check. In a credentialed deployment, Hume EVI can provide emotionally aware conversation. For this recording, the exchange is explicitly scripted.” |
| 1:28–1:46 | Illustrative dialogue overlay: “I’m here with you. Are you able to respond?”; simulated no-response timer advances | “The user does not respond within the configured window. A transport acceptance is not treated as proof of safety, so the workflow moves to its emergency fallback.” |
| 1:46–2:04 | **MOCK CAREGIVER ACKNOWLEDGEMENT** overlay shows only fictional references | “The caregiver path receives the permitted location and incident context exactly once. If the robot or Wi-Fi path fails, the workflow does not block behind it; the wearable and fallback channels remain independent.” |
| 2:04–2:20 | Prepared slide shows a redacted state export plus a separately seeded preference memory; label both **SYNTHETIC DATA** | “Fall telemetry updates encrypted, account-bound state. The separate Memory Net example stores only a concise, user-approved summary for continuity—never raw audio, video, or a full private transcript. Authenticated APIs let the user list, delete one, or delete all memories.” |
| 2:20–2:35 | Prepared closing slide lists the five scenario IDs | “This is one of five implemented software scenarios: fall response, medication adherence, emotional check-in, cognitive engagement, and AI Angel auto-dial—all exercised against simulated devices and failure paths.” |
| 2:35–2:45 | Closing ecosystem graphic and external-gates note | “The foundation is ready for partner integration. Final claims depend on approved manufacturer contracts, production providers, and validation on the actual wearable and robot hardware.” |

## 4. On-screen event sequence

Use the simulator's development-only event injector (`POST /api/v1/simulation/events`) to create one bounded fall event for a fictional logical device. The current dashboard is read-only and the injector records an event; neither independently starts the Scenario Engine. A trusted local demo driver must pass the corresponding inference and authenticated test binding through `EdgeScenarioRouter`, then forward lifecycle states to `recordScenarioExecution`. Do not imply that this glue is a production ingestion service, and do not use a production hostname or a real account/device ID.

The expected visible sequence is:

```text
wearable fall observation
  -> scenario fall_detection started (Critical)
  -> server-owned opaque location reference attached
  -> robot navigation requested
  -> two-way check requested
  -> user-response timeout
  -> emergency-contact fallback requested once
  -> scenario completed with step audit metadata
  -> bounded state update available for account export
  -> separately seeded summary memory available through authenticated list/delete APIs
```

The dashboard provides scenario lifecycle states, while prepared overlays should label `requested`, `accepted`, `acknowledged`, and `completed` distinctly. Do not imply that the current formatted-JSON dashboard contains controls or conversation UI that it does not implement. Do not use a green checkmark for a physical outcome that the simulator cannot verify.

## 5. Optional failure-path insert

If the recording can run closer to three minutes, add a 15-second split-screen replay with the robot offline:

> “Now the home robot is offline. The critical wearable path does not wait for it. The Scenario Engine records the navigation failure and begins the caregiver fallback immediately, using the same idempotent incident.”

The insert should show one escalation, no duplicate notification, and an explicit robot-offline state. It should not imply that an SMS or call was really delivered unless a production provider receipt is present.

## 6. Screen-recording instructions

### Capture

- Record at 1920×1080 or higher, 30 fps, with 125–150% browser zoom for readable text.
- Capture only the browser window; crop the terminal and operating-system menu bar.
- Keep the simulation disclaimer in frame from first product screen to closing card.
- Use cursor highlights sparingly and avoid fast scrolling.
- Record narration on a separate track where possible; normalize speech and keep alert sounds quiet.
- Use a single deterministic take after a rehearsal so event IDs, order, timing, and UI state remain consistent.

### Suggested layout

- For live capture, use the simulator's formatted JSON snapshot and zoom to the relevant `devices`, `scenarioExecutions`, or `lastEvents` section.
- For an edited layout, build clearly labeled presentation overlays: Product 1 at left, scenario timeline at center, and Product 2 at right.
- Keep the last ten redacted event types at the bottom; do not display raw payloads.
- Do not present an overlay as an implemented mobile/dashboard screen.

### Editing

- Add captions and a transcript for accessibility.
- Blur any accidental account avatar, hostname, device identifier, notification preview, or terminal content.
- Do not replace the simulation disclaimer with fine print.
- Use callouts such as **synthetic fall event**, **robot action requested**, **scripted Hume placeholder**, and **mock caregiver acknowledgement**.
- End with the external gates: vendor contract, Hume/provider credentials, physical hardware, safety/privacy review, and measured conformance.

## 7. Recording acceptance checklist

- [ ] Runtime is development/test and the simulator is loopback-only.
- [ ] The video contains no real PII, credentials, serials, signed payloads, or private sensor/media data.
- [ ] The persistent simulation/non-medical disclaimer is readable.
- [ ] Product 1 triggers Product 2 through the Scenario Engine.
- [ ] Critical priority, ordered steps, timeout, and one fallback are visible.
- [ ] “Accepted” is not presented as physical completion or contact delivery.
- [ ] Any camera context follows a matching mock `camera_ready` / opaque session acknowledgement; otherwise the no-camera branch is shown.
- [ ] Hume content is labeled live only if a real configured Hume session is visibly verified; otherwise it is labeled scripted.
- [ ] Memory is shown as a bounded summary with clearly labeled authenticated API results; no dashboard control is implied and no raw transcript is shown.
- [ ] The five scenario names are shown accurately.
- [ ] Closing copy lists external production blockers.
- [ ] Any “first” claim is approved and substantiated, or removed before external release.

For architecture details, see [ai-native-integration-guide.md](./ai-native-integration-guide.md). For known operational limits, see [troubleshooting-ai-native.md](./troubleshooting-ai-native.md).
