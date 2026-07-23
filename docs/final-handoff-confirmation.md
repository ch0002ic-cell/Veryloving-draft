# Final Handoff Confirmation

Confirmed on: 23 July 2026

Branch: `features/dual-product-draft`

Assurance boundary: **SOURCE-COMPLETE FOR ALL FIVE FEEDBACK THEMES; EXTERNAL PM/UX, ACCESSIBILITY, PROVIDER, MANUFACTURER, AND PHYSICAL ACCEPTANCE REMAINS; NO-GO FOR PRODUCTION SAFETY USE UNTIL THOSE GATES PASS**

This is the canonical product handoff document in `docs/`. It consolidates the former design, QA, architecture, API, simulator, manufacturer, research, audit, troubleshooting, and demo documents. The dated [`dependency-audit-2026-07-23.md`](./dependency-audit-2026-07-23.md) is retained separately as package/toolchain evidence. Detailed deleted-file history remains recoverable through Git.

## 1. Grace feedback confirmation

### Status summary

Grace's five feedback themes are now **COMPLETE at source-code level**. That statement is deliberately narrower than product-market, signed-build, accessibility-device, clinical, or physical-hardware acceptance, which remains external/manual work.

| ID | Original feedback | Status | Source-level confirmation | Remaining work |
| --- | --- | --- | --- | --- |
| GF-001 | “These are very basic features” | ✅ **COMPLETE — SOURCE** | The existing dual-device, safety, pairing, Map, voice, medication, privacy, and localization journeys now include a dedicated Scenario Center for all five AI-native workflows, a Cognitive Engagement experience with memory/trivia/conversation activities, an Emotional Check-in experience with encrypted mood history and consent-aware Hume reflection, live execution states, cancellation, and interaction feedback. | Grace/PM/UX must validate scope and usefulness with representative users on an immutable build; this is external product acceptance, not missing source. |
| GF-002 | “Strong engineering background” | ✅ **COMPLETE** | The source demonstrates fail-closed authentication, account isolation, encrypted/versioned state, replay and idempotency protection, bounded I/O/concurrency, per-device queues, durable ACKs, cancellation, lifecycle recovery, redacted logging, graceful shutdown, reproducible builds, and extensive deterministic tests. | Live cloud, provider, penetration, clinical, firmware, load, and physical-device acceptance are external release gates, not missing source foundations. |
| GF-003 | “Product sense” | ✅ **COMPLETE — SOURCE** | The product uses progressive disclosure, truthful safety semantics, wearable/robot distinction beyond color, actionable permission/offline/error states, resumable onboarding, confirmed destructive actions, privacy lifecycle controls, honest demo-mode boundaries, safe scenario confirmations, and useful local wellbeing activities when connected care is unavailable. | Representative elderly-user/caregiver research, PM/UX sign-off, notification-fatigue validation, and native-speaker review remain external validation. |
| GF-004 | “Aesthetic quality” | ✅ **COMPLETE — SOURCE** | All mobile surfaces now consume canonical semantic color, typography, spacing, radii, elevation, layout, motion, status, loading, empty, error, and feedback patterns. Shared touch feedback, reduced-motion behavior, loading skeletons, Dynamic Type-safe controls, and programmatic accessibility semantics are regression-tested. | Retained iOS/Android screenshots, maximum-text and screen-reader walkthroughs, and Grace's visual acceptance remain external/manual validation. |
| GF-005 | “Worked with design system” | ✅ **COMPLETE** | A lightweight design system is implemented in `src/constants/theme.js` and `src/components/`, documented below, and protected by design/polish regression tests. | Continue governance and migration jointly with Grace's PM/UX team; this status describes the repository deliverable, not a claim about prior employment history. |

### GF-001 evidence — feature richness

- [`app/(tabs)/index.js`](../app/%28tabs%29/index.js) presents wearable and robot status, routine safety modes, quick actions, medication access when a robot exists, and visually separated SOS.
- [`app/device-management.js`](../app/device-management.js) deduplicates the canonical entity collection and supports naming, reconnect, remove/reset, and pairing. Precise robot coordinates were removed from this list during the handoff audit; location remains confined to intentional map/share/safety contexts.
- [`app/(auth)/jewelry-setup.js`](../app/%28auth%29/jewelry-setup.js) provides permission rationale, filtered scan, bounded progress, actionable unavailable/empty/error states, connection feedback, and cleanup.
- [`app/robot-pairing.js`](../app/robot-pairing.js) provides vendor selection, camera denial recovery, QR framing, synchronous duplicate-scan fencing, progress, and background recovery.
- [`app/(tabs)/map.js`](../app/%28tabs%29/map.js), [`app/safety-call.js`](../app/safety-call.js), [`app/emergency-sos.js`](../app/emergency-sos.js), and [`app/medication-reminders.js`](../app/medication-reminders.js) provide explicit online/offline, loading, retry, accepted/delivered, and empty states.
- [`server/src/scenarios/index.ts`](../server/src/scenarios/index.ts) registers fall detection, medication adherence, emotional check-in, cognitive engagement, and AI Angel auto-dial workflows.
- [`app/scenario-center.js`](../app/scenario-center.js) exposes authenticated, server-bound triggers for all five workflows with honest confirmations and queued/running/terminal state.
- [`app/cognitive-engagement.js`](../app/cognitive-engagement.js) provides accessible memory, trivia, and conversation activities plus the connected cognitive scenario.
- [`app/emotional-check-in.js`](../app/emotional-check-in.js) provides bounded mood logging, encrypted account-bound history, deletion, and explicit Hume-backed reflection.
- [`src/components/InteractionFeedbackModal.js`](../src/components/InteractionFeedbackModal.js) and [`app/safety-call.js`](../app/safety-call.js) collect bounded thumbs feedback after completed scenarios and voice calls without raw transcript or free-text analytics.

### GF-002 evidence — engineering strength

- Device abstraction and failure isolation: [`src/services/device-manager/`](../src/services/device-manager/), including per-device priority queues, critical STOP handling, registry rehydration, and robot offline persistence.
- Durable action routing: [`server/action-gateway.cjs`](../server/action-gateway.cjs) and [`server/robot-adapter-runtime.cjs`](../server/robot-adapter-runtime.cjs), including signed envelopes, adapter/binding fences, durable outbox, retry, asynchronous ACK, cancellation, and idempotency conflicts.
- Account and session safety: [`server/auth-session.cjs`](../server/auth-session.cjs), [`server/auth-session-repository.cjs`](../server/auth-session-repository.cjs), [`server/phone-auth.cjs`](../server/phone-auth.cjs), and [`server/push-notifications.cjs`](../server/push-notifications.cjs).
- AI-native reliability: [`server/src/orchestration/ScenarioEngine.ts`](../server/src/orchestration/ScenarioEngine.ts), [`server/src/models/UserState.ts`](../server/src/models/UserState.ts), and [`server/src/memory/MemoryNet.ts`](../server/src/memory/MemoryNet.ts).
- Bounded operations and deployment gates: [`server/bounded-response.cjs`](../server/bounded-response.cjs), [`server/environment-schema.cjs`](../server/environment-schema.cjs), [`server/graceful-shutdown.cjs`](../server/graceful-shutdown.cjs), [`server/Dockerfile`](../server/Dockerfile), and [`scripts/validate-production.cjs`](../scripts/validate-production.cjs).

### GF-003 evidence — product sense

- Safety copy and state distinguish request, acceptance, acknowledgement, delivery, completion, dialer opening, and failure instead of claiming false success.
- Home puts current device readiness first, routine actions second, and high-consequence SOS in a separate visual region.
- Wearable and robot identity uses icon, label, tone, connectivity, last seen, and capability rather than color alone.
- Permission, offline, stale, empty, and failure surfaces provide a concrete next action.
- Pairing progress, double-submit fences, resumable onboarding, account-bound persistence, privacy export/delete, and confirmed destructive operations reduce real user failure costs.

Acceptance gap: source review cannot validate comprehension, trust, stress behavior, or caregiver burden. Proposed resolution: run moderated tasks with representative elderly users, caregivers, and accessibility users; record task success, error/recovery, time, comprehension, trust, and notification burden; prioritize findings with Grace's PM/UX team.

### GF-004 evidence — aesthetic quality

- [`src/constants/theme.js`](../src/constants/theme.js) defines semantic colors/tones, Scada/Inter typography, spacing, radii, control sizes, shadows, motion, and readable layout limits.
- [`src/components/`](../src/components/) supplies shared Screen, Header, Button, Card, TextField, ActionTile, DeviceStatusCard, StatusPill, FeedbackBanner, Snackbar, Skeleton, loading, empty, and onboarding-progress patterns.
- Motion is restrained, causal, and Reduce Motion-aware; content remains present without animation.
- Critical controls meet minimum touch sizing, scale vertically with text, and expose accessibility roles/states; decorative art is silent.

The legacy-surface migration is complete at source level. A whole-source audit plus focused regression contracts reject raw app palette/type/spacing values outside the canonical token module; media geometry and native scanner-frame geometry remain intentionally local. Exact-build visual acceptance remains a separate manual gate.

### GF-005 evidence — design-system implementation

- Canonical tokens: [`src/constants/theme.js`](../src/constants/theme.js).
- Reusable components: [`src/components/`](../src/components/).
- Regression contracts: [`tests/design-system-foundation.test.cjs`](../tests/design-system-foundation.test.cjs), [`tests/mobile-design-polish.test.cjs`](../tests/mobile-design-polish.test.cjs), and [`tests/mobile-product-polish.test.cjs`](../tests/mobile-product-polish.test.cjs).
- The full usage, interaction, accessibility, localization, responsive-layout, motion, and contribution rules are preserved in the Design System appendix.

## 2. Final verification record

Status: **PASS — FINAL SOURCE GATES EXECUTED ON 23 JULY 2026**

| Gate | Expected command | Result |
| --- | --- | --- |
| Full repository suite | `npm test` | ✅ PASS — 1,058/1,058 (823 core, 44 adapter, 8 adapter integration, 183 AI-native) |
| ESLint | `npm run lint` | ✅ PASS — zero errors or warnings |
| TypeScript and mobile compiler checks | `npm run typecheck` | ✅ PASS — strict semantic checks cover adapters, mock simulator, AI-native, and all TypeScript tests; the JavaScript mobile tree passes its Expo compiler/config smoke and is enforced by ESLint/tests |
| Expo project health | `npm run doctor -- --verbose` | ✅ PASS — Expo Doctor 1.20.1, 20/20 checks |
| Consolidated source gate | `npm run validate` | ✅ PASS — reviewed toolchain, environment dry-run, lint, compiler checks, all tests, Expo Doctor, and both exports completed using the credential-free non-routable production fixture |
| Production source-readiness gate | `npm run validate:production` | ✅ PASS — 183 AI-native tests, 50 production-boundary tests, two validated CycloneDX SBOMs, and zero cached application dependency vulnerabilities |
| Production artifact gate | `npm run validate:production:release` plus commit-pinned Trivy | ✅ PASS IN CI — live root/server audits, immutable Docker build, non-root and fail-closed runtime checks, health and graceful shutdown, retained SBOMs, and zero high/critical final-image findings |
| iOS production-profile JavaScript export | Executed by `npm run validate` | ✅ PASS — Hermes bundle and 82 assets exported to a temporary directory with `.invalid` endpoints; not a signed release artifact |
| Android production-profile JavaScript export | Executed by `npm run validate` | ✅ PASS — Hermes bundle and 86 assets exported to a temporary directory with `.invalid` endpoints; not a signed release artifact |
| Dependency/security audit | `npm audit` in both workspaces plus Expo compatibility and final-image validation | ✅ PASS — zero vulnerabilities in full and production application graphs; zero high/critical final-image findings; Expo dependencies current for SDK 57 |
| Diff and document-reference hygiene | `git diff --check` plus consolidation regression tests | ✅ PASS — canonical handoff plus dated dependency evidence, stable appendix contracts, no broken local links |

Passing JavaScript exports do not replace signed native builds, simulator/emulator interaction tests, VoiceOver/TalkBack checks, provider delivery, BLE validation, or physical robot acceptance.

## 3. Remaining external and manual acceptance work

| Gate | Status | Owner / action |
| --- | --- | --- |
| iOS and Android visual walkthrough with retained screenshots | **PENDING ACCEPTANCE** | Mobile engineer + PM/UX execute the exact-candidate matrix below. |
| VoiceOver, TalkBack, maximum text/display size, Reduce Motion, RTL, keyboard, compact/tablet layout | **PENDING ACCEPTANCE** | Accessibility tester retains pass/fail evidence. |
| Elderly-user and caregiver usability study | **PENDING PRODUCT VALIDATION** | Grace/PM recruits representative participants and approves success criteria. |
| Grace product/visual sign-off | **PENDING SIGN-OFF** | Review an immutable development/preview build and record decisions. |

No Grace-feedback item remains missing or partial at source-code level. The remaining rows require people, signed builds, representative users, provider accounts, or physical devices and therefore cannot be closed by additional repository code.

## 4. External blockers

There are 13 tracked external dependencies: **2 PASS** (both manufacturer NDAs) and **11 BLOCKED — EXTERNAL**. This dependency count differs from the three externally blocked finding groups in the historical code audit: one is an operational dependency register, while the other grouped related source-audit findings.

| IDs | Blocker | Status | Next action |
| --- | --- | --- | --- |
| EXT-001–EXT-002 | Yongyida and Jiangzhi mutual NDAs | ✅ **PASS** | Retain signed copies in the approved private legal system; do not commit them. |
| EXT-003–EXT-004 | Yongyida API/SDK package, sandbox, scoped credentials, and artifacts | **BLOCKED — EXTERNAL** | Grace sends the technical-package request; Yongyida provisions controlled access. |
| EXT-005–EXT-007 | Jiangzhi licensed source, Android HAL/BSP/OTA package, and medical protocol/certification evidence | **BLOCKED — EXTERNAL** | Grace sends the Jiangzhi package request; legal/platform/medical owners provide artifacts. |
| EXT-008–EXT-009 | Exact Y120 and Jiangzhi engineering units in Shenzhen | **BLOCKED — EXTERNAL** | Request matching units, fixed BOM/firmware, accessories, diagnostics, RMA terms, and receiving window. |
| EXT-010–EXT-011 | Apple/APNs and Google/FCM production access | **BLOCKED — EXTERNAL** | SV Lead provisions least privilege and injects secrets through the deployment secret manager. |
| EXT-012 | Twilio production SMS/voice account and approved identities | **BLOCKED — EXTERNAL** | Complete compliance/billing and provision scoped credentials/test numbers. |
| EXT-013 | Hume EVI enterprise tenant, key, quotas, and data terms | **BLOCKED — EXTERNAL** | Obtain the enterprise package and provision the key server-side. |

Target-cloud IAM/TLS/WAF, signed store artifacts, provider receipts, monitoring/backups/rollback, penetration review, native localization review, clinical/regulatory claims, physical safety, and soak evidence remain production release gates.

## 5. What Grace should do next

1. Send the Technical Package Request template below to Yongyida and Jiangzhi immediately; the NDA gate is complete.
2. Request matching engineering units from both manufacturers in parallel.
3. Ask the SV Lead to begin Apple/APNs, Google/FCM, Twilio, and Hume enterprise provisioning through approved secret channels.
4. Nominate a PM/UX owner and schedule a 60–90 minute exact-build review of the implemented Scenario Center, Emotional Check-in, Cognitive Engagement, and safety journeys.
5. Schedule iOS, Android, accessibility, elderly-user, and caregiver walkthroughs using the QA appendix.
6. Rebaseline the integration timeline when requests are actually sent; update dependency status only when the evidence rule below is satisfied.

We are ready to work directly with Grace's PM/UX team on future iterations.

## 6. Architecture and operator map

| Need | Canonical source / section |
| --- | --- |
| General setup, release profiles, TestFlight acceptance, and environment commands | [`README.md`](../README.md) |
| Mobile design tokens and component rules | [Design System](#design-system) |
| Manual mobile acceptance | [Mobile Polish QA](#mobile-polish-qa) |
| Investor/partner walkthrough | [Demo Script](#demo-script) |
| Local dashboard | [Demo Dashboard](#demo-dashboard) |
| AI-native architecture and configuration | [AI-Native Integration Guide](#ai-native-integration-guide) |
| AI-native method and HTTP contracts | [AI-Native API Reference](#api-reference-ai-native) |
| Runtime diagnosis | [AI-Native Troubleshooting](#troubleshooting-ai-native) |
| Robot trust boundaries and HAL | [Robot HAL Architecture](#robot-hal-architecture) |
| Adapter environment, bridge, ACK, reset, telemetry, and fault tests | [Robot Adapter Integration Guide](#robot-adapter-integration-guide) |
| Public manufacturer evidence and caveats | [Hardware Partner Research](#hardware-partner-research) |
| Vendor decision | [Hardware Partner Decision Matrix](#hardware-partner-decision-matrix) |
| Package intake gate | [Manufacturer API Requirements](#manufacturer-api-requirements) |
| Owners and blockers | [External Dependencies Dashboard](#external-dependencies-dashboard) |
| Schedule scenarios | [Integration Timeline](#integration-timeline) |
| Copy-ready outreach | [Ask Templates](#ask-templates) |

## 7. Closed audit summary

The repository-wide audit closed the documented 66 source defects, passed its source-boundary check, and closed all three internal production gates. Subsequent final-polish review added and verified further mobile lifecycle, voice-completion, scenario, accessibility, and design-system hardening without changing those historical audit counts. Major corrected classes include authentication/deletion races, phone-token replay, push ownership, bounded provider I/O, SSE/WebSocket cleanup, action/outbox/ACK races, binding generation, pairing replay/recovery, multi-vendor isolation, AI-native cancellation and critical-event precedence, simulator limits, mobile account boundaries, BLE/voice/process-death recovery, map freshness, privacy export/delete, and release/supply-chain validation.

The historical robot-adapter log contains 41 closed findings. Their identifiers and titles are preserved below; full reproduction narratives and old candidate outputs remain in Git history because they are no longer active operator documentation.

| Finding | Closed failure mode | Status |
| --- | --- | --- |
| ROBOT-BUG-001 | Global vendor selection could not support a mixed fleet | **FIXED — verified** |
| ROBOT-BUG-002 | One adapter callback could acknowledge another adapter's action | **FIXED — verified** |
| ROBOT-BUG-003 | HTTP 202 or an unrelated receipt could be mistaken for delivery | **FIXED — verified** |
| ROBOT-BUG-004 | Retry could duplicate a physical command | **FIXED — verified** |
| ROBOT-BUG-005 | One stalled device could block unrelated device commands | **FIXED — verified** |
| ROBOT-BUG-006 | Gateway restart could lose or replay robot work incorrectly | **FIXED — verified** |
| ROBOT-BUG-007 | A fetch implementation ignoring abort could hang indefinitely | **FIXED — verified** |
| ROBOT-BUG-008 | Malformed or oversized bridge data was not a safe status source | **FIXED — verified** |
| ROBOT-BUG-009 | Concurrent initialization could cross-bind or poison an adapter | **FIXED — verified** |
| ROBOT-BUG-010 | Replayed QR claims could threaten account ownership | **FIXED — verified** |
| ROBOT-BUG-011 | Relay health or stale telemetry could create a ghost-online robot | **FIXED — verified** |
| ROBOT-BUG-012 | Offline commands could be lost or misbound during recovery | **FIXED — verified** |
| ROBOT-BUG-013 | Adapter logs could disclose identity, health context, or secrets | **FIXED — verified** |
| ROBOT-BUG-014 | Async reset/privacy receipt could cause false data-erasure success | **FIXED — verified** |
| ROBOT-BUG-015 | A stalled HTTP response body could outlive the adapter timeout | **FIXED — verified** |
| ROBOT-BUG-016 | Reset/privacy could cross vendor boundaries in a mixed fleet | **FIXED — verified** |
| ROBOT-BUG-017 | Losing a successful pairing response could permanently brick a one-time QR | **FIXED — verified** |
| ROBOT-BUG-018 | An ACK arriving before the pending transition could strand a device queue | **FIXED — verified** |
| ROBOT-BUG-019 | Schema-invalid success responses were reported as successful metrics | **FIXED — verified** |
| ROBOT-BUG-020 | Fresh status could smuggle stale or future optional telemetry into the app | **FIXED — verified** |
| ROBOT-BUG-021 | Mixed-vendor telemetry stopped at basic status instead of an account snapshot | **FIXED — verified** |
| ROBOT-BUG-022 | Legacy manufacturer calls could hang when abort was ignored or a body stalled | **FIXED — verified** |
| ROBOT-BUG-023 | Mobile robot requests could outlive their timeout or parse unbounded response helpers | **FIXED — verified** |
| ROBOT-BUG-024 | A delayed action could survive reset and execute after re-pairing | **FIXED — verified** |
| ROBOT-BUG-025 | Partial multi-vendor privacy deletion could repeat or omit erasure after process death | **FIXED — verified** |
| ROBOT-BUG-026 | Account deletion could race an already-started robot delivery | **FIXED — verified** |
| ROBOT-BUG-027 | Reusing one semantic idempotency key for different commands could return false success | **FIXED — verified** |
| ROBOT-BUG-028 | Slow pairing could bind a robot after account deletion completed | **FIXED — verified** |
| ROBOT-BUG-029 | Process death could strand account deletion without a credential | **FIXED — verified** |
| ROBOT-BUG-030 | Reset retries had no recurring recovery trigger | **FIXED — verified** |
| ROBOT-BUG-031 | GSI lag could hide an action from privacy deletion | **FIXED — verified** |
| ROBOT-BUG-032 | Reset lease identity was not an attempt generation | **FIXED — verified** |
| ROBOT-BUG-033 | Concurrent robot-credential mutations lost updates | **FIXED — verified** |
| ROBOT-BUG-034 | Malformed telemetry retained a ghost-online robot | **FIXED — verified** |
| ROBOT-BUG-035 | Unsigned direct HAL methods could bypass reset generation fencing | **FIXED — verified** |
| ROBOT-BUG-036 | Redirects could forward pairing/reset credentials | **FIXED — verified** |
| ROBOT-BUG-037 | Manufacturer response loss could brick a consumed QR | **FIXED — verified** |
| ROBOT-BUG-038 | Non-success bodies leaked robot HTTP resources | **FIXED — verified** |
| ROBOT-BUG-039 | Indoor position lacked an independent timestamp gate | **FIXED — verified** |
| ROBOT-BUG-040 | Callback credentials could equal outbound credentials | **FIXED — verified** |
| ROBOT-BUG-041 | Mobile pairing/reset body consumption was unbounded | **FIXED — verified** |

The former 101-item dual-product requirements audit is superseded by the current source evidence, QA matrix, production gates, and external register in this document. Its key disposition remains unchanged: source/mock handoff is permitted; production safety reliance is not.

## 8. Copy-ready summary for Grace

VeryLoving now has substantially more than a basic feature demo: it has a coherent dual-device mobile journey, a complete semantic design-system migration, accessible and honest safety interactions, dedicated Cognitive Engagement and Emotional Check-in experiences, authenticated all-five scenario control with live state/cancellation, privacy-bound wellbeing history, post-interaction feedback, AI-native cross-device orchestration, and a deeply hardened backend. All five of Grace's feedback themes are complete at source-code level, with no known open internal source gate. The remaining critical path is external: manufacturer technical packages, engineering hardware, production provider access, representative-user and accessibility testing, and joint PM/UX acceptance of the exact signed build.

**GO** for handoff, PM/UX iteration, mock-backed investor/partner demonstration, and manufacturer conformance work.

**NO-GO** for public production deployment, emergency-care reliance, medical claims, or unattended robot motion until external, signed-build, usability, accessibility, provider, deployment, and physical-device gates pass.

## 9. Documentation consolidation record

This file replaces 19 specialist Markdown documents. Contractual manufacturer tables, API intake requirements, dependency rows, timeline scenarios, outreach templates, design/QA rules, architecture, API, simulator, and troubleshooting guidance are retained in appendices. Historical duplicated audits and per-bug narratives are summarized because Git is the recoverable system of record.

Do not re-create separate documents for these topics. Update the stable appendix anchors below so README, environment comments, tests, and team links remain valid.

## 10. Canonical appendices

<!-- BEGIN:design-system -->
<a id="design-system"></a>
## Appendix — Design System

Status: **PASS — source foundation implemented; signed-device acceptance remains separate**

Last reviewed: 22 July 2026

VeryLoving supports a wearable safety product and a home companion robot in one mobile experience. This system gives both product lines one calm, recognizable interface while keeping life-safety actions unmistakable. The canonical token source is [`src/constants/theme.js`](../src/constants/theme.js); shared components live in [`src/components/`](../src/components/).

This document describes the implemented foundation and the rules for extending it. Every current mobile screen has completed the semantic token and shared-state migration at source level. That does not mean source review replaces VoiceOver, TalkBack, maximum Dynamic Type, emulator, signed-build, or physical-device QA.

## 1. Product principles

1. **Calm before clever.** Use generous space, short sentences, and predictable controls. Decoration must never compete with emergency information.
2. **Safety has a stable hierarchy.** The primary action is dark ink, the branded accent is orange, and destructive or emergency actions are red. Do not use red for ordinary emphasis.
3. **State must be honest.** Distinguish offline, connecting, requested, accepted, acknowledged, completed, and failed. A submitted SOS or robot command is not proof of delivery or physical completion.
4. **One ecosystem, two device identities.** Wearables use the watch/human visual language and warm accent; home robots use the home/robot visual language and cool accent. Always include a text label, because color and icon alone are insufficient.
5. **Progressive disclosure.** Put the next useful action first. Keep diagnostics and uncommon settings behind a detail screen instead of crowding the home screen.
6. **Accessible by default.** Controls start at 44 points, text scales, state is announced, motion respects the system preference, and layouts must work in both LTR and RTL.
7. **Privacy is part of the interface.** Never render raw provider errors, credentials, precise coordinates, hardware serials, or unredacted health/event payloads. Explain what export and deletion will do before starting them.

## 2. Tokens

Import tokens rather than repeating numeric or hex values:

```js
import {
  colors,
  layout,
  motion,
  radii,
  shadows,
  sizes,
  spacing,
  tones,
  typography
} from '../constants/theme';
```

### Color

Prefer semantic aliases in new or substantially revised UI. The original palette names remain available for incremental migration.

| Semantic token | Value | Use |
| --- | --- | --- |
| `colors.textPrimary` | `#304557` | Primary copy, titles, and high-emphasis icons. |
| `colors.textSecondary` | `#5F7484` | Supporting copy and metadata. Do not use for critical instructions. |
| `colors.textInverse` | `#FFFFFF` | Text/icons on verified dark, accent, or danger surfaces. |
| `colors.surfaceCanvas` | `#FFF8EF` | App canvas and safe-area background. |
| `colors.surfaceRaised` | `#FFFFFF` | Cards, sheets, and raised controls. |
| `colors.surfaceMuted` | `#F4F6F7` | Quiet grouped content and inactive status. |
| `colors.borderSubtle` | `#E6ECEF` | Card separation and non-interactive dividers. |
| `colors.borderControl` | `#7C8C98` | Interactive control outlines. |
| `colors.actionPrimary` | `#304557` | Default primary action. |
| `colors.actionAccent` | `#A84316` | Brand emphasis and selected non-emergency action. |
| `colors.actionDanger` | `#B52F2F` | Destructive and emergency actions only. |

Status feedback uses the reusable `tones` contract, which pairs an accessible foreground with a soft background and visible border:

| Intent | Tone | Required companion cue |
| --- | --- | --- |
| Neutral/inactive | `tones.neutral` | Neutral icon plus explicit text. |
| Brand emphasis | `tones.accent` | Product/action label; never color alone. |
| Information/active | `tones.info` | Information/active icon plus explicit text. |
| Warning/reconnecting | `tones.warning` | Warning icon plus explicit text. |
| Success/online | `tones.success` | Check icon plus explicit text. |
| Error/offline/danger | `tones.danger` | Alert icon plus explicit text. |

Do not add opacity to foreground text to manufacture a disabled or secondary color. Use the semantic token and apply opacity only to the whole disabled control. Any new color pairing must be contrast-checked in its actual font size and weight.

### Typography

The display face is Scada; interface copy is Inter. React Native font scaling remains enabled by default.

| Token | Family | Size / line height | Intended use |
| --- | --- | --- | --- |
| `typography.displayLarge` | Scada Bold | 44 / 52 | Rare hero moment on a spacious screen. |
| `typography.display` | Scada Bold | 28 / 34 | Screen title and branded loading title. |
| `typography.titleLarge` | Inter Bold | 24 / 31 | High-priority section or modal title. |
| `typography.title` | Inter Bold | 20 / 27 | Card group or secondary screen title. |
| `typography.heading` | Inter Bold | 18 / 25 | Section heading. |
| `typography.bodyLarge` | Inter Regular | 16 / 24 | Prominent body copy and control labels. |
| `typography.body` | Inter Regular | 15 / 22 | Default body copy. |
| `typography.bodySmall` | Inter Regular | 14 / 20 | Compact explanatory copy. |
| `typography.label` | Inter Semibold | 15 / 21 | Buttons, form labels, and compact emphasis. |
| `typography.caption` | Inter Regular | 13 / 18 | Metadata and supporting status. |

Rules:

- Do not disable font scaling on user-facing copy.
- Prefer `minHeight` over fixed height for controls containing text.
- Allow labels to wrap; never truncate a safety instruction solely to preserve a card height.
- Keep paragraphs within `layout.readableMaxWidth` (`560`) and full screen content within `layout.contentMaxWidth` (`720`).
- Use a real accessibility heading role for a screen's primary title; size and weight alone do not communicate hierarchy to assistive technology.

### Spacing and layout

| Token | Points | Typical use |
| --- | ---: | --- |
| `spacing.none` | 0 | Explicit opt-out only. |
| `spacing.xs` | 4 | Icon/label or stacked metadata gap. |
| `spacing.sm` | 8 | Compact element gap. |
| `spacing.mdSm` | 12 | Dense card padding or related-control gap. |
| `spacing.md` | 16 | Default component padding and section gap. |
| `spacing.lg` | 24 | Major section separation. |
| `spacing.xl` | 32 | Screen-region separation. |
| `spacing.xxl` | 48 | Hero or empty-state breathing room. |

Use `layout.screenPadding` (`20`) for ordinary screens and `layout.compactScreenPadding` (`16`) only when width is constrained. The shared `Screen` component supplies safe-area, scrolling, keyboard avoidance, a readable maximum width, and a consistent canvas.

### Radius, size, and elevation

| Group | Tokens | Rule |
| --- | --- | --- |
| Radius | `sm 6`, `md 8`, `lg 12`, `xl 16`, `bubble 18`, `pill 999` | Use `lg` for controls/cards, `pill` only for chips/status, and avoid arbitrary mixed radii in one region. |
| Controls | `controlCompact 44`, `control 50`, `controlLarge 56` | No interactive target may be smaller than `sizes.touchTarget` (`44`). |
| Icons | `iconSmall 18`, `icon 22`, `iconLarge 28` | Decorative icons are hidden from accessibility; meaningful icons need a labelled parent control. |
| Elevation | `shadows.subtle`, `shadows.raised` | Use subtle for ordinary cards and raised for the current focus/modal surface. Never rely on shadow alone for separation. |

### Motion

| Token | Value | Use |
| --- | ---: | --- |
| `motion.durationFast` | 140 ms | Press/dismiss feedback. |
| `motion.durationStandard` | 180 ms | Banner and ordinary state transition. |
| `motion.durationEmphasis` | 240 ms | One meaningful focal transition. |
| `motion.pressedScale` | 0.98 | Button press response. |

Motion reinforces causality; it does not delay access to an action. Reanimated transitions must use the system reduce-motion setting. Never encode an emergency state using motion alone, and avoid looping decoration, parallax, or celebratory animation in a safety flow.

## 3. Shared components

### `Screen`

Use `Screen` as the default route container. It provides safe-area handling, keyboard avoidance, scroll behavior, the cream canvas, and readable-width containment.

```jsx
<Screen>
  <Header title={t('common.settings')} showBack backLabel={t('common.back')} />
  {/* screen sections */}
</Screen>
```

Use `scroll={false}` only for a component that explicitly owns scrolling or needs a full-height canvas, such as the map. Verify keyboard access when doing so.

### `Header`

`Header` owns the brand/back affordance and screen hierarchy. Its title is exposed as an accessibility header. Supply a localized `backLabel`; the component safely returns home if native history is unavailable. `eyebrow`, `subtitle`, and `trailing` are optional—do not populate all three unless each adds useful context.

### Onboarding progress and tutorial pages

Use `OnboardingProgress` for a known, finite onboarding/tutorial sequence. Pass one-based `current` and `total` values; the component clamps unsafe inputs and exposes native progress semantics. Do not use it for an indeterminate network operation.

`TutorialPage` combines that progress pattern with localized header copy, contextual illustration, a focused explanation card, one Continue action, and an explicit Skip route. Keep new tutorial steps in the ordered step/art registry so the visible and announced progress stays accurate. Entry animation must use the motion scale and respect Reduce Motion.

### `Button`

`Button` provides a 44-point-or-larger target, loading and disabled semantics, selected state, icon placement, Android ripple, and a short press animation.

| Variant | Use |
| --- | --- |
| `primary` | One default next action in a region. |
| `orange` | Selected mode or branded affirmative emphasis. |
| `danger` | SOS/destructive action with confirmation where reversal is difficult. |
| `ghost` | Secondary navigation or low-emphasis action. |
| `secondary` | Informational alternative. |
| `success` | Confirmed positive state; not merely a submitted request. |

```jsx
<Button
  title={t('common.save')}
  loading={saving}
  loadingLabel={t('common.loading')}
  disabled={!isValid}
  onPress={save}
/>
```

Use one visually dominant action per card or modal. Supply `accessibilityHint` when the result is not obvious from the label. A spinner must be accompanied by a stable or loading-specific label.

### `Card`

`Card` standardizes surface, border, radius, padding, and elevation.

| Variant | Use |
| --- | --- |
| `default` | Ordinary grouped content. |
| `flat` | Nested or already-separated content. |
| `raised` | Current focal panel or sheet content. |
| `tinted` | Warm, non-critical guidance. |
| `critical` | Safety warning or destructive confirmation. |

Padding values are `none`, `sm`, `md` (default), and `lg`. Do not nest multiple elevated cards.

### `DeviceStatusCard` and `StatusPill`

Use `DeviceStatusCard` for the same identity/status pattern on Home and My Devices. Pass the complete normalized entity; do not infer an online robot merely because it is paired. `StatusPill` supports `ok`, `warn`, `danger`, `idle`, and `active` tones and always pairs color with an icon and label.

Status copy should answer three questions in order: which device, whether it can currently act, and—if useful—when it was last seen. Renaming changes the friendly name, never the hardware identity.

### `ActionTile`

Use `ActionTile` for a high-information navigation/action row with an icon, title, optional description, optional value, and trailing direction cue. Available tones are `default`, `wearable`, `robot`, `safety`, and `danger`. A danger tone communicates context; the destination must still confirm any irreversible action.

Do not use an action tile for a binary setting (use a labelled switch row) or a simple primary form submission (use `Button`). Keep the description short enough to scale and wrap without pushing the chevron off screen.

### `TextField`

`TextField` is the default new text-input primitive. It owns a visible label, optional hint/error, required marker, disabled/editable state, focused/invalid border, leading icon, trailing content, multiline mode, forwarded ref, and RTL alignment.

```jsx
<TextField
  label={t('contacts.name')}
  value={name}
  required
  error={nameError ? t(nameError) : null}
  autoComplete="name"
  returnKeyType="next"
  onChangeText={setName}
/>
```

Do not rely on a placeholder as the only label. Supply the appropriate keyboard/content/autofill attributes, keep validation near the field, and avoid echoing sensitive values into logs or generic errors. Existing specialist controls such as the global phone-number input may retain their domain-specific behavior while adopting the same visual and semantic rules.

### Loading: `AppLoadingState`, `LoadingState`, and skeletons

Use the branded, live-region-aware `AppLoadingState` only for application, font, authentication, or persistence hydration that temporarily prevents safe routing. Use an inline activity indicator or skeleton for content that can load while the rest of a screen remains usable.

Use `LoadingState` for a bounded route/section wait with optional compact presentation. Use `Skeleton`/`SkeletonText` to preserve the shape of async content and wrap related placeholders in one labelled `SkeletonGroup`; individual blocks stay silent to assistive technology. Skeleton animation observes Reduce Motion and stops on unmount.

A loading state must be bounded by the owning operation. On timeout or failure, transition to usable fallback/retry UI; never leave a spinner or skeleton indefinitely.

### `FeedbackBanner`

Use a banner for contextual, recoverable feedback that belongs on the current screen. Tones are `info`, `success`, `warning`, and `error`; error announcements are assertive and other tones are polite. Prefer an inline retry action. Add dismissal only when hiding the message is safe.

Use a native confirmation dialog for an irreversible decision that must block progress, such as delete-all-data or emergency activation. Do not show both a native alert and a banner for the same error.

### `Snackbar`

Use `Snackbar` for a short, non-blocking result such as a confirmed safety-mode change. It supports `success`, `info`, `warning`, and `error`, a manual close action, a bounded auto-dismiss duration (3.5 seconds by default), timer cleanup, RTL, live-region semantics, and reduced-motion entry/exit.

A snackbar must not be the only place to expose a critical failure, required recovery step, emergency result, or persistent offline state. Use `FeedbackBanner` for those cases. Pass a stable `onDismiss` callback when possible so unrelated renders do not restart the dismissal timer.

### `EmptyState`

An empty state explains why content is absent and offers one relevant action. Use `compact` inside a list/card and the default layout for a screen-level state. Illustrations are decorative; the title and message carry the meaning.

### Modal sheets and confirmations

The repository does not expose one universal modal abstraction. Use a native alert for short destructive confirmation and a safe-area-aware modal route for multi-step work. In either case, provide a localized title/body, keep confirm and cancel visually distinct, prevent duplicate submission, return focus predictably, and never close with false success after a failed mutation.

## 4. Interaction patterns

### Loading and retry

1. Preserve the last known valid content when refreshing.
2. Disable only controls affected by the in-flight action.
3. Give every network/native operation a bounded timeout or cancellation path.
4. Show an actionable localized failure; never expose raw exception text.
5. Retry idempotently and prevent duplicate taps.

For feedback selection: use inline field error for validation, `FeedbackBanner` for persistent/contextual recovery, `Snackbar` for transient confirmed results, and a confirmation dialog/modal route for a consequential decision.

### Success

Use success feedback only after the application's contract is satisfied. Examples:

- **Saved:** local or remote mutation committed according to that feature's contract.
- **Command accepted:** backend/vendor accepted the command; physical completion is still pending.
- **Emergency contact notified:** only after an approved delivery receipt, not after queuing.

### Safety and destructive actions

- Keep SOS visually separate from routine quick actions.
- Confirm actions that place calls, delete data, factory-reset a robot, or escalate an incident.
- State what happens next and what may still fail.
- Always offer an obvious cancel/close route unless immediate safety policy explicitly forbids it.

### Device states

Use this shared vocabulary:

| State | Meaning |
| --- | --- |
| Paired | The account owns a valid device binding. It may be offline. |
| Connecting | A bounded connection attempt is active. |
| Online | Current telemetry/transport evidence meets the feature's freshness rule. |
| Offline | The freshness/transport rule is not met; queued work may remain. |
| Action requested | The app/backend accepted intent. |
| Action acknowledged | The target transport/provider acknowledged it. |
| Completed | A trusted completion signal satisfied the action contract. |

## 5. Accessibility, localization, and responsiveness

### VoiceOver and TalkBack

- Give each critical control a concise localized label, role, hint when necessary, and current state.
- Group icon, device name, battery, and status only when the combined announcement is clearer than separate focus stops.
- Hide decorative art and duplicate icons with `accessible={false}`.
- Announce asynchronous feedback through an appropriate live region; avoid repeated announcements during telemetry updates.
- Verify focus after navigation, modal open/close, validation failure, item deletion, and direction reload.
- Test with the screen reader running; source attributes alone do not prove usable focus order or speech.

### Dynamic Type

- Test at the platform's default, one large accessibility size, and maximum supported size.
- Expect buttons, cards, pills, and headers to grow vertically.
- Replace absolute overlays or fixed-height content when labels overlap, clip, or become unreachable.
- Ensure the SOS confirmation and cancellation controls remain visible without precision scrolling.

### RTL

`I18nContext` provides `isRTL`, and supported native builds coordinate the required LTR/RTL reload. Use logical `start`/`end` spacing, mirror directional rows and chevrons, keep numbers readable, and never reverse chronological order or data values merely because the interface is RTL. Expo Go is not acceptance evidence for native direction changes.

### Responsive layouts

- Start with a single readable column.
- Let action groups wrap instead of shrinking labels.
- Keep critical controls full-width when a multi-column layout could obscure priority.
- Test compact iPhone, current iPhone, large Dynamic Type, 11-inch iPad portrait/landscape, iPad split view, and a representative Android phone/tablet width.

## 6. Contribution checklist

Before merging a new or materially changed mobile surface:

- [ ] It uses semantic tokens and shared components where applicable.
- [ ] It has loading, empty, success, failure, retry, offline, and disabled behavior appropriate to its data.
- [ ] Every external/native operation is bounded and duplicate-safe.
- [ ] Safety copy distinguishes request, acknowledgement, delivery, and completion.
- [ ] Controls are at least 44 points and have localized accessibility semantics.
- [ ] Text scales without clipping at an accessibility size.
- [ ] LTR and RTL layouts preserve reading and navigation order.
- [ ] Keyboard, safe area, compact width, and tablet width are covered.
- [ ] Motion respects Reduce Motion and is not required to understand state.
- [ ] Logs and visible failures contain no credential, PII, precise location, serial, or raw provider error.
- [ ] Unit/source checks pass, and the applicable rows in [Mobile Polish QA](#mobile-polish-qa) have current-candidate evidence.

## 7. Current evidence boundary

The token and component APIs in this document are present in source. The repository also contains automated checks and production JavaScript export gates. Visual quality, touch behavior, native permissions, screen-reader order, device radio behavior, and signed-build persistence still require the environment-specific evidence defined in [Mobile Polish QA](#mobile-polish-qa) and the main [TestFlight acceptance checklist](../README.md#12-testflight-acceptance-checklist).

<!-- END:design-system -->

<!-- BEGIN:mobile-polish-qa -->
<a id="mobile-polish-qa"></a>
## Appendix — Mobile Polish QA

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

The design-system contract below is inspectable in the current source. Automated rows must be re-run after all mobile polish changes and recorded against the release candidate.

| ID | Check | Acceptance | Current status |
| --- | --- | --- | --- |
| POLISH-SRC-001 | Semantic tokens | Color, typography, spacing, radius, size, shadow, motion, and layout tokens have one canonical source in `src/constants/theme.js`. | **PASS — SOURCE REVIEW** |
| POLISH-SRC-002 | Shared actions/surfaces | `Button` exposes variant, loading, disabled, selected, icon, hint, and 44-point minimum behavior; `Card` exposes stable surface/padding variants. | **PASS — SOURCE REVIEW** |
| POLISH-SRC-003 | Shared patterns | Header/onboarding hierarchy, text field, action tile, status pill, feedback banner/snackbar, empty state, bounded loading/skeletons, and dual-device status card are reusable components. | **PASS — SOURCE REVIEW** |
| POLISH-SRC-004 | Safe screen container | `Screen` supplies safe area, keyboard avoidance, scroll behavior, and readable-width containment. | **PASS — SOURCE REVIEW** |
| POLISH-AUTO-001 | Lint | `npm run lint` exits zero on the release candidate, with no new warnings. | **PASS — AUTOMATED** (23 July 2026) |
| POLISH-AUTO-002 | Test suite | `npm test` and applicable targeted suites exit zero on the release candidate. | **PASS — AUTOMATED** (23 July 2026) |
| POLISH-AUTO-003 | Expo dependency/config health | `npm run doctor` reports the repository's expected full pass on the release candidate. | **PASS — AUTOMATED** (Expo Doctor 20/20, 23 July 2026) |
| POLISH-AUTO-004 | iOS production JS export | `npx expo export --platform ios` exits zero with no Metro/Babel/module-resolution failure. | **PASS — AUTOMATED** (23 July 2026) |
| POLISH-AUTO-005 | Android production JS export | `npx expo export --platform android` exits zero with no Metro/Babel/module-resolution failure. | **PASS — AUTOMATED** (23 July 2026) |
| POLISH-AUTO-006 | Diff hygiene | `git diff --check` exits zero; no credential, generated `.env`, build output, or unrelated artifact is staged. | **PASS — AUTOMATED** (23 July 2026) |

The repository's `npm run validate` is the preferred combined source gate. It is still not a native compile/install, signed TestFlight/Play artifact, or physical-device result.

## 4. Core visual and interaction walkthrough

### Launch, authentication, and onboarding

| ID | Environment | Actions | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- |
| POLISH-AUTH-001 | iOS Simulator + Android Emulator | Clean install; launch on normal network; observe font/session hydration; enter the explicitly enabled development demo mode. | Branded loading is readable and announced once; it resolves without an indefinite spinner; demo sign-in reaches the protected app once; no “sign-in interrupted” alert, red LogBox for an expected emulator Google configuration failure, or redirect loop. Store profiles must not expose demo mode. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |
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
| POLISH-CARE-004 | Simulator + emulator | Walk through Scenario Center, Cognitive Engagement, and Emotional Check-in; trigger non-emergency workflows, exercise cancellation/status recovery, inspect mood history, and submit thumbs feedback. Verify the AI Angel warning before any emergency-path test. | All dedicated routes are reachable and understandable; local activities work offline; authenticated scenarios move through honest states; history and feedback remain account-bound; no practice fall drill moves a robot, calls, or alerts. | **REQUIRES SIMULATOR** / **REQUIRES EMULATOR** |

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

For the complete release record and external gates, use the [main TestFlight acceptance checklist](../README.md#12-testflight-acceptance-checklist). For component rules, see the [VeryLoving Mobile Design System](#design-system).

<!-- END:mobile-polish-qa -->

<!-- BEGIN:demo-script -->
<a id="demo-script"></a>
## Appendix — Demo Script

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

1. Record the final commit SHA and pass the source gates in [Mobile Polish QA](#mobile-polish-qa).
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
- [ ] Applicable automated and simulator rows in [Mobile Polish QA](#mobile-polish-qa) pass.
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

For component and content rules, see [Design System](#design-system). For AI-native architecture and the mock scenario engine, see [AI-Native Integration Guide](#ai-native-integration-guide) and [Demo Dashboard](#demo-dashboard).

<!-- END:demo-script -->

<!-- BEGIN:demo-dashboard -->
<a id="demo-dashboard"></a>
## Appendix — Demo Dashboard

**Status: PASS — local software demonstration.** This dashboard exercises the in-memory AI-native runtime, simulated wearable/robot telemetry, and mock manufacturer command transport. It does not validate physical hardware, clinical performance, carrier delivery, or a manufacturer API.

## Start the demo

Use two terminals from the repository root. The mock manufacturer must be restarted after pulling dashboard changes because its HTML and routes are compiled into the running process.

Terminal 1:

```bash
npm run mock:manufacturer
```

The simulator command and main entrypoint both load the ignored `server/.env`
file while preserving already-exported environment variables. This keeps the
mock API key, fixed demo account, and loopback ports consistent across the two
processes.

Terminal 2:

```bash
source server/.env
node server/server.cjs
```

Required development settings are:

```dotenv
AI_NATIVE_ENABLED=true
AI_NATIVE_DATA_LIFECYCLE_ENABLED=true
AI_NATIVE_SINGLE_REPLICA=true
MOCK_MANUFACTURER_URL=http://127.0.0.1:3001
MOCK_MANUFACTURER_API_KEY=mock-server-only-api-key
# Optional fixed demo account; use the same value in curl examples.
AI_NATIVE_DEMO_USER_ID=test-user-1
```

Do not commit `server/.env`. The values above are simulator-only placeholders, not production credentials.

Open [http://127.0.0.1:3001/dashboard](http://127.0.0.1:3001/dashboard). The page should show:

- a wearable and home robot with online state, battery, last observation, and redacted references;
- buttons for Fall response, Medication adherence, Emotional check-in, Cognitive engagement, and AI Angel auto-dial;
- real execution records read from the main server's in-memory Scenario Engine;
- synthetic lifecycle records and the ten most recent simulator events; and
- a green **Live** indicator while the dashboard SSE stream is connected.

Selecting a scenario disables that control for the request, displays the returned execution reference, and refreshes the real execution table. A scenario can also be triggered without a browser:

```bash
curl -X POST http://127.0.0.1:8787/v1/scenarios \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-fall-20260721-001' \
  -d '{"scenarioId":"fall-detection","userId":"test-user-1","deviceId":"wearable-1"}'
```

## Local API contract

The main server accepts the following exact development request shape at `POST /v1/scenarios`:

```json
{
  "scenarioId": "fall-detection",
  "userId": "test-user-1",
  "deviceId": "wearable-1",
  "robotDeviceId": "home-robot-1",
  "occurredAt": 1784589261143
}
```

`scenarioId` must be one of:

- `fall-detection`
- `medication-adherence`
- `emotional-check-in`
- `cognitive-engagement`
- `ai-angel-auto-dial`

`robotDeviceId` and `occurredAt` are optional. Unknown fields, malformed identifiers, stale or future timestamps, non-JSON bodies, oversized bodies, query strings, and non-loopback callers are rejected.

Send a unique `Idempotency-Key` for each intended scenario execution. Concurrent
or later retries with the same key and identical body join or return the same
execution; reusing that key with a different body returns `409`. The dashboard
generates one key per button click and forwards it unchanged through the
simulator proxy. A client disconnect after admission does not cancel the
scenario; use the explicit cancellation API when cancellation is intended.

`GET /v1/scenarios/executions?userId=test-user-1` returns a bounded, redacted list for that exact account. The response is for the local demo only; a production endpoint must derive the account from an authenticated session rather than accept a caller-selected user ID.

The browser does not receive the simulator API key or call port 8787 directly. `GET /dashboard` issues a random, process-local, `HttpOnly; SameSite=Strict` session cookie. Same-origin mock routes validate that cookie before proxying the exact scenario or execution request to the loopback main server. The simulator rejects production mode, non-loopback bind addresses, credential-bearing upstream URLs, arbitrary upstream paths, and unrecognized fields. The page also uses a nonce-based Content Security Policy and cannot load third-party scripts or styles.

## Live updates and lifecycle

`GET /api/v1/simulation/dashboard/events` is a bounded Server-Sent Events stream. It sends redacted snapshots and is closed when the browser disconnects or the simulator stops. The browser separately refreshes real execution state every three seconds and clears its timer on unload. The server caps concurrent dashboard streams, telemetry streams, connections, queued commands, response sizes, and retained events/executions.

`SIGINT` and `SIGTERM` stop the simulator gracefully: open SSE/telemetry responses are closed, outbound main-server requests are aborted, timers are cleared, queued delays are released, and sockets are drained. The main server also stops accepting new requests and drains existing HTTP connections.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Dashboard still shows raw JSON | Stop and restart `npm run mock:manufacturer`; the old Node process still holds the prior compiled page. |
| **Reconnecting** indicator | Confirm the simulator is still running on `127.0.0.1:3001`, reload `/dashboard` to renew its process-local cookie, and inspect redacted simulator logs. |
| Scenario button reports unavailable | Confirm the main server is on `127.0.0.1:8787`, `AI_NATIVE_ENABLED=true`, and `MOCK_MANUFACTURER_URL` points to the running simulator. |
| No real execution rows | Confirm `GET /v1/scenarios/executions?userId=test-user-1` succeeds locally and reload the dashboard. In-memory executions are intentionally lost when the main server restarts. |
| A request returns `400` or `403` | Use the exact schema above, no query on the POST route, and a loopback address. Browser proxy routes additionally require the cookie issued by `/dashboard`. |
| Intermittent simulated failures | Set `MOCK_MANUFACTURER_FAILURE_RATE=0` for a deterministic presentation. Non-zero failure injection is intentional retry/fallback testing. |

## Verification

```bash
npm test
npm run lint
npm run typecheck:manufacturer-mock
npm run typecheck:ai-native
```

The automated tests cover all five controls, execution listing, origin restrictions, strict request validation, proxy response bounds/timeouts, SSE cleanup, and simulator shutdown. Manual acceptance is complete when both device cards update, each button returns an execution reference, the real and simulator rows reach a terminal state, recent events update without a page refresh, and both Node processes stop cleanly.

<!-- END:demo-dashboard -->

<!-- BEGIN:hardware-partner-research -->
<a id="hardware-partner-research"></a>
## Appendix — Hardware Partner Research

Research date: 18 July 2026

Scope: Yongyida (勇艺达), Jiangzhi Robot (江智机器人), and the proposed Veryloving Product 2 integration.

## Executive conclusion

Neither manufacturer currently exposes enough public technical material to justify a production integration against a claimed vendor API.

- Yongyida is a publicly documented robot ODM with a current Y120 guide robot whose manufacturer claims autonomous patrol/navigation features, a Y120 open-SDK marketing claim, and government-reported elder-care deployment experience at company level. No public API reference, SDK package, authentication specification, telemetry schema, sandbox, or developer portal was found.
- This report assesses Jiangzhi's public material as more suggestive of an on-device Android application path and medical-instrument adjacency. No public robot-control SDK, JZKH1.0 API, source repository, license, sensor protocol, or production Android security contract was found.
- The prompt's ACTIVATE_FALL_ALERT, SEND_MEDICATION_REMINDER, and STREAM_VITALS names are Veryloving design placeholders. They are not documented vendor commands.
- The supplied [Veryloving Product 2 Google document](https://docs.google.com/document/d/1HrZNNiCfFsdRALsSu2hajf_P9su3sAAeS0fSHlxCG6o/edit?usp=sharing) is a strategic product/profitability narrative, not a manufacturer interface specification. Its safety, risk-reduction, response-time, legal-evidence, deterrence, medical-prediction, and margin claims require separate scientific, legal, regulatory, and commercial validation.

Recommendation: keep both vendors in a time-boxed technical discovery gate. Use the repository prototype only against a Veryloving-owned provisional bridge contract. Do not enable a production adapter until a vendor supplies the mandatory artifact package and an exact production unit passes conformance, security, privacy, safety, performance, and soak testing.

## Evidence standard

This report uses four evidence labels:

- Verified public fact: directly stated in an official manufacturer, government, chip-vendor, or standards source.
- First-party product claim: marketing or product material on a manufacturer's official site, not independently tested.
- Company-account host claim: published under the manufacturer's account on another platform whose publisher disclaims responsibility; first-party-attributed marketing, not independently verified fact.
- Unknown: no public implementation contract was found; no technical assumption is made.

Absence from public search does not prove that partner-only documentation does not exist. It means the document must be obtained under NDA before engineering depends on it.

# Yongyida (勇艺达)

## Product positioning and elder-care evidence

Yongyida's current official product page labels Y120 as an AI large-model guide robot. It lists guided narration, voice interaction, face recognition, greeting, customized Q&A, and multimodal interaction. It is not publicly positioned as a Y120康养 medical or elder-care SKU.

Sources:

- [Official Y120 product page](https://www.yydrobo.com/show-458.html)
- [Y120 core-function sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714105958_78870.png)

Yongyida does have elder-care experience at company level:

- A company announcement describes a Bao'an Social Welfare Center partnership involving companionship, health-data analysis, and reminders.
- A Shenzhen government article dated 22 January 2026 reports a Yongyida companion robot in a Bao'an elder-care facility providing medication reminders, entertainment, video calls, dialect conversation, and resident-profile-based interaction.

Neither source identifies that deployed robot as Y120 or publishes an integration protocol.

Sources:

- [Yongyida elder-care partnership announcement](https://www.yydrobo.com/show-446.html)
- [Shenzhen government elder-care deployment report](https://fgw.sz.gov.cn/ztzl/qtztzl/szscjmyjjfzzhfwpt/xwdt/content/post_12623414.html)

## Y120 capabilities claimed publicly

The official Y120 page and image sheets claim:

- Autonomous patrol/navigation with configurable routes, schedules, and tasks.
- Map construction/editing from phone, tablet, or PC.
- Point/route narration with image, audio, video, action, and expression content.
- Remote mobile control and camera monitoring; upgraded return-video/intercom options are described.
- Local recognition of more than 1,000 faces without network connectivity.
- Locally editable Q&A and bulk corpus import.
- Camera, face detection, video calling, microphone array, echo cancellation, noise reduction, and multi-turn dialogue.
- ToF laser radar, ultrasonic sensing, collision sensing, and optional structured-light 3D sensing.
- Physical SOS button, screen, camera, lights, collision strip, laser radar, and four-wheel mobile chassis.
- Automatic return to charge, a claimed 10-hour runtime, and a claimed 4–5-hour charge.
- An open SDK and staged business-specific software/content customization.

Sources:

- [Remote monitoring sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714110527_23582.png)
- [Offline face-recognition sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714110812_24217.png)
- [Environment-sensor sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714112649_48533.png)
- [Charging/runtime sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714112743_56345.png)
- [Physical-component sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714112948_87575.png)
- [Open-SDK/customization sheet](https://www.yydrobo.com/Uploads/image/20250714/20250714113112_58032.png)

The public material does not disclose:

- CPU/SoC, architecture, RAM, storage, or operating system.
- Dimensions, weight, speed, payload, ingress protection, battery chemistry/capacity, or charger electrical rating.
- Ethernet, cellular, USB, serial, GPIO, or other expansion interfaces.
- Exact Wi-Fi/security capabilities, camera codec/resolution, or sensor models and sampling rates.
- Safety certification, medical-device certification, or validated fall detection.
- ECG, blood pressure, glucose, SpO2, or structured medical-device integration.

## API, SDK, cloud, and developer access

Current Y120 marketing claims an open SDK. An older research-institute/roadmap page depicts a developer platform providing API/SDK capabilities while separately presenting an open AI developer platform as future work. Neither source establishes a currently downloadable package or callable public API.

Sources:

- [Yongyida Research Institute and cloud/developer roadmap](https://www.yydrobo.com/institute.html)
- [Yongyida software download page](https://www.yydrobo.com/download.html)
- [Yongyida ODM/OEM process](https://www.yydrobo.com/list-113.html)

No public item was located for:

- REST/OpenAPI reference or Postman collection.
- MQTT topics, broker details, WebSocket events, local-LAN API, ROS package, gRPC service, or Android SDK.
- API-key, OAuth, JWT, device-certificate, or request-signing scheme.
- Command, telemetry, callback, error, retry, ACK, idempotency, or versioning schema.
- Developer registration, sandbox credentials, release notes, SDK license, or SLA.

Assessment: cloud-to-cloud and local-SDK integration are plausible partner paths, but both remain unverified until Yongyida supplies the actual package.

## Yongyida top technical risks

### 1. API/SDK opacity — Critical

Risk: the open-SDK claim may resolve to a partner-only binary, a content customization surface, an incomplete interface, or a contract that cannot support Veryloving safety semantics.

Mitigation: make commercial commitment conditional on an OpenAPI/Postman package, SDK artifact and license, sample app, sandbox, credentials, schema catalogue, version/EOL policy, and two named engineering contacts. Run automated conformance before selection.

### 2. Y120 versus elder-care SKU mismatch — High

Risk: public Y120 evidence describes a guide robot with manufacturer-claimed patrol/navigation features. Fall monitoring, medication acknowledgement, indoor elder UX, medical instruments, emergency escalation, and privacy controls are not demonstrated for that exact model.

Mitigation: freeze the exact elder-care SKU, BOM, OS, firmware, and options in writing. Require live evidence for each claimed safety/care capability and treat missing functions as new ODM scope.

### 3. Cloud/security/reliability unknowns — Critical

Risk: hosting, data residency, tenant isolation, face/video data, command authorization, OTA signing, ACK/idempotency, retention/deletion, outage behavior, and latency are undisclosed.

Mitigation: require a security architecture, threat model, DPA, data-flow/residency map, device-bound mTLS credentials, signed commands, replay/idempotency rules, audit logs, OTA chain of trust, penetration evidence, retention/deletion APIs, availability/latency SLA, and offline safety behavior.

# Jiangzhi Robot (江智机器人)

## Android and hardware platform

Product pages published under Jiangzhi's Elecfans company account show a fragmented platform portfolio rather than one standard Android target. Elecfans-hosted claims in this section are first-party-attributed marketing, not independent validation:

| Public SKU | Platform claim | Public hardware claim | Integration observation |
| --- | --- | --- | --- |
| JZR580300 小暖心 | Android, Windows 10/11, or Linux | Android option uses RK3399 or RK3588; 4+64 GB or 8+128 GB; microphones, speakers, 5 MP camera, two USB ports | This report's preferred public Android prototype candidate; Android version/BSP not disclosed |
| JZR1400640CP chronic-disease robot | Android 8.1/9.0 or Windows 7/10 | Android 4+64 GB; Wi-Fi, Bluetooth, 4G, HDMI; cameras, microphone array, medical-instrument compartment | APK/peripheral potential, but the published Android 8.1/9.0 versions are legacy and require current security-patch/BSP evidence |
| JZR1560520 monitoring robot | Windows 10 in the published configuration | Intel i5-5200U, 8 GB, 256 GB, USB/USB-C, camera/microphones | Do not assume Android without a revised BOM |
| Historical JZR1580580YCD | Android 7.1/8.1 | RK3399, 4+64 GB, Ethernet, Wi-Fi, Bluetooth, 4G, HDMI | Historical evidence only |

Sources:

- [JZR580300 configuration](https://www.elecfans.com/d/6701065.html)
- [JZR1400640CP configuration](https://www.elecfans.com/p/v79941.html)
- [JZR1560520 monitoring robot](https://www.elecfans.com/p/v142013.html)
- [Historical RK3399 Android robot](https://m.elecfans.com/article/2223878.html)
- [Rockchip RK3399 architecture](https://opensource.rock-chips.com/wiki_RK3399)
- [Rockchip RK3588 architecture](https://www.rock-chips.com/a/cn/product/RK35xilie/2022/0926/1656.html)

The RK3399 and RK3588 are ARM64 platforms. Exact Android API level, security patch date, kernel/BSP, SELinux mode, bootloader policy, signing keys, privileged-app access, Device Owner support, and OTA ownership remain unknown.

## Source-code and cooperation terms

No public Jiangzhi/JZKH source repository or license was found on GitHub, Gitee, the company site, or indexed product material.

A cooperation article published under Jiangzhi's Elecfans company account says:

- Jiangzhi supplies written requirements for a co-development project.
- The external developer initially bears the agreed development cost.
- Cost is amortized over the first 100 robot sales and another 50 units provide a reward.
- After 150 units, the developer transfers source code to Jiangzhi and remains responsible for improvement/upgrades.
- Large projects may use a 1,000-unit arrangement.
- Developer-owned software may apply for ecosystem review and, if approved, be installed on the robot mainboard. It remains separate from Jiangzhi's software platform.

Source:

- [关于康养机器人软件合作的具体办法](https://www.elecfans.com/d/3894397.html)

This is not evidence that Jiangzhi gives its upper-layer source code to Veryloving. For the article's co-development model, source transfers from the developer to Jiangzhi after 150 units; it separately describes a developer-owned-software route without publishing equivalent IP or license terms. Background IP, commissioned work, derivative rights, binary distribution, source escrow, ongoing maintenance, termination, and security updates require a negotiated agreement.

## Kangyang Harbor / JZKH1.0

Jiangzhi's official company page describes 康养港湾 as an ecosystem spanning 14 elder-care scenarios and external services. A Jiangzhi-account post that reproduces general-purpose LLM summaries, plus an event listing based on Jiangzhi's project pitch, claim JZKH1.0 launched in June 2025 and supports Android/Windows. No release artifact or technical documentation was found.

Sources:

- [Official Jiangzhi company description](https://www.jzera.com.cn/%E5%85%AC%E5%8F%B8%E7%AE%80%E4%BB%8B)
- [JZKH/Kangyang Harbor Jiangzhi-account overview](https://m.elecfans.com/article/7729392.html)
- [Project-pitch event listing](https://www.yirongvc.com/news/newsdetail/1267.html)
- [2026 cooperation/market article](https://m.elecfans.com/article/7972390.html)

The JZKH overview explicitly incorporates output from multiple general-purpose AI systems. It is marketing context, not an implementation contract.

No public evidence was located for:

- REST, MQTT, WebSocket, gRPC, Binder, AIDL, deep-link, intent, content-provider, or bound-service API.
- Authentication, device identity, webhook registration, event schema, rate limit, SLA, versioning, sandbox, Maven/AAR/JAR artifact, or sample application.
- Structured health/telemetry export or third-party command access.

Assessment: do not put JZKH1.0 on the critical integration path. A Veryloving edge bridge should remain isolated and use only a formally supported vendor HAL supplied under contract.

## Lower-level and medical integration

A post under Jiangzhi's Elecfans company account gives one concrete lower-level example: a JZRF facial-expression module with 138 expressions controlled over USB serial and support for Android, Windows, Linux, and HarmonyOS.

Source:

- [JZRF USB-serial expression module](https://m.elecfans.com/article/3378684.html)

This does not prove that navigation, battery, alarm, cameras, medical instruments, or emergency stop expose the same protocol.

The Jiangzhi-account JZR1400640CP listing claims use or support of Lepu instruments covering temperature, blood pressure, glucose, blood oxygen, ECG, and other customer-selected equipment, and says the instruments have medical-device qualifications. It describes local display, speech output, local storage, consumer sharing, trend graphs, identity checks, and remote consultation; it does not establish integration certification.

Sources:

- [JZR1400640CP medical instrument page](https://www.elecfans.com/p/v79941.html)
- [Jiangzhi chronic-disease robot article](https://m.elecfans.com/article/2798339.html)

The following remain unknown:

- Exact instrument models and NMPA registration numbers.
- BLE services/characteristics, USB VID/PID, serial framing, Wi-Fi API, or manual-entry path.
- SDK license, sample payloads, JSON/XML/binary/FHIR/IEEE 11073 support.
- Units, precision, quality flags, calibration, timestamp/patient binding, and raw ECG access.
- Encryption, audit, retention, consent, export, and deletion behavior.

These should be treated as external medical instruments used with the robot, not as proven medical-grade sensors integrated into the robot motherboard.

## White-labeling

Jiangzhi-account material advertises custom robot design, existing-shell selection or custom molds, OEM/ODM cooperation, private-label/neutral sales, and installation of approved independent Android apps.

Sources:

- [Jiangzhi hardware/public-service platform](https://m.elecfans.com/article/2123864.html)
- [JZR580300 private-label/neutral-sales claim](https://www.elecfans.com/d/6701065.html)
- [Monitoring robot customization page](https://www.elecfans.com/p/v142013.html)
- [OEM/ODM cooperation statement](https://m.elecfans.com/article/7972390.html)

No public contract was found for logo/colors/MOQ/NRE, boot logo/animation, launcher/kiosk ownership, APK signing, wake-word replacement, OTA keys, privileged/system-app access, secure boot, recovery image, or factory-reset behavior.

## Jiangzhi top technical risks

### 1. No supported robot-control contract — Critical

Risk: permission to install an Android app does not grant navigation, sensors, cameras, battery, alarm, or emergency-stop access.

Mitigation: require a versioned AAR/JAR/AIDL/Binder or documented serial/BLE HAL, sample app, conformance tests, and cross-SKU compatibility/SLA as a purchase condition. Never control JZKH through UI automation.

### 2. OS fragmentation and security lifecycle — High

Risk: public configurations span Android 7.1, 8.1, 9.0, an unspecified Android release, Windows, and Linux. Unsupported images are unacceptable for a camera/health/safety device.

Mitigation: freeze one production board/image and require supported security patches, signed OTA, SBOM, secure boot, rollback protection, kiosk/Device Owner support, vulnerability disclosure, and a multi-year patch SLA.

### 3. IP and medical-data contract gaps — Critical

Risk: the published co-development model calls for source transfer to Jiangzhi after 150 units, while the separate developer-owned-software route does not specify equivalent public IP/license terms; the medical instruments lack public models, protocols, schemas, quality metadata, and regulatory boundaries.

Mitigation: preserve Veryloving background IP in a binary-distribution agreement or escrow arrangement. Obtain exact device registrations, protocols, SDK licenses, data samples, calibration/quality metadata, DPA, and regulatory review before any clinical claim.

# Comparative integration matrix

| Requirement | Yongyida | Jiangzhi |
| --- | --- | --- |
| API/SDK availability | Y120 marketing claims an open SDK; an older roadmap depicts API/SDK capabilities; no current public package/reference | No public robot/JZKH SDK; Android app installation and one USB-serial module are documented |
| Authentication | Unknown | Unknown |
| Command latency | Unknown; no SLA or benchmark | Unknown; must be measured on exact Android image/HAL |
| Command/ACK semantics | Unknown | Unknown |
| Telemetry/data access | Remote mobile control/video and broad conceptual cloud-data categories are claimed; no machine-readable status/telemetry schema | Local display/storage/sharing is claimed; no structured export/HAL schema |
| Customization | ODM/OEM and business software/content customization are advertised | OEM/ODM, existing-shell/custom-mold, private-label options, and independent APK installation are advertised; software privileges unknown |
| Offline support | Offline face recognition and local Q&A editing are claimed; navigation is claimed separately, but offline command/queue behavior is unknown | On-device APK can provide local logic; JZKH/HAL offline behavior unknown |
| Medical-grade integration | Not substantiated for Y120 | Promising external Lepu instrument adjacency; exact models/protocols not public |
| Developer access | Direct commercial contact; no public developer portal | Published cooperation path; no developer portal; public IP terms are unfavorable |
| Lower-level integration | Open SDK claimed but transport/interface unknown | Android edge app is plausible; one USB-serial peripheral is documented |
| Mixed fleet suitability | Requires an immutable vendor adapter and partner API | Requires an immutable vendor adapter and supported edge HAL |
| Production readiness | No-go pending partner package and exact elder-care SKU | No-go pending HAL, supported OS, medical protocols, and IP terms |

# Recommended vendor evaluation sequence

## Gate 0 — Paper artifact gate

Give both vendors the same ten-business-day request:

1. Exact production SKU/BOM, OS, processor, RAM/storage, interfaces, certifications, and lifecycle.
2. Complete API/SDK/HAL package, license, sample application, sandbox, and change policy.
3. Command mappings for medication, fall/safety alert, audio, voice call, battery/status, configuration, alarm, and emergency stop.
4. Signed callback/telemetry schemas, timestamps, idempotency, replay, ordering, ACK/error, timeout, and retry semantics.
5. Offline/process-restart behavior and local safety actions during cloud loss.
6. Security architecture, device identity, key rotation, OTA chain, SBOM, patch SLA, and penetration evidence.
7. Data map, residency, subprocessors, consent, export/delete, retention, backup/log policy, and DPA.
8. Exact medical instrument registrations, protocols, calibration and data-quality metadata.
9. White-label scope, APK/firmware signing, wake word, launcher/boot assets, MOQ/NRE/lead time.
10. Two identical sample production units and named engineering support.

A vendor that cannot deliver this package does not advance to integration.

## Gate 1 — Parallel constrained proof of concept

- Yongyida path: Veryloving backend to a vendor sandbox/cloud adapter, plus webhook/ACK/telemetry conformance.
- Jiangzhi path: Veryloving Edge Bridge APK on the exact robot image, using a supported vendor HAL. ADB is allowed only for lab provisioning, never runtime control.

## Gate 2 — Selection

Score measured evidence rather than feature claims:

- Security/privacy/safety fail-closed gates: mandatory.
- Durable command acceptance and exactly-once physical effect.
- Emergency-local behavior during internet loss.
- p50/p95/p99 acceptance and execution latency.
- Authenticated real-time fall/telemetry path.
- 72-hour minimum soak with bounded memory/socket/timer/storage growth.
- OTA/rollback and factory reset.
- Medical data provenance/quality and regulatory position.
- Commercial IP, lifecycle, SLA, MOQ, NRE, and engineering support.

## Current directional assessment

- Yongyida may offer the shorter cloud integration if its partner API is real and sufficiently complete. Its proposed cloud path has a material API-evidence gap and an unresolved Y120/elder-care SKU mismatch.
- Jiangzhi may offer deeper on-device customization and offline control if it provides a supported Android HAL. It has material OS-security, IP, and medical-interface risks.
- Do not select either manufacturer solely from the public evidence. Run the same artifact and hardware acceptance gates first.

<!-- END:hardware-partner-research -->

<!-- BEGIN:hardware-partner-decision-matrix -->
<a id="hardware-partner-decision-matrix"></a>
## Appendix — Hardware Partner Decision Matrix

**Document status:** ✅ **PASS** — decision framework completed and evidence-checked 20 July 2026

**Manufacturer selection status:** ❌ **BLOCKED — EXTERNAL** — neither candidate has supplied the production technical and commercial package required to select a vendor

**Decision owner:** Grace, advised by Veryloving Product, Engineering, Security, Privacy, Regulatory, and Procurement

**Scope:** Yongyida (勇艺达), with emphasis on the publicly listed Y120, and Jiangzhi Robot (江智机器人), with emphasis on its Android-capable care-robot portfolio

## Executive summary

Veryloving should **not award a production manufacturer from public evidence alone**. The present recommendation is to run the same mandatory document gate for both vendors, then give **Yongyida first priority for a constrained cloud-adapter proof of concept** if it supplies a complete, versioned API with signed device identity, durable command acknowledgement, telemetry, and offline safety behavior. That priority is about the smaller engineering surface of a complete cloud contract—not proof that such a contract exists or that Y120 is an elderly-care SKU. Keep **Jiangzhi as the parallel edge-platform candidate** and allow it to overtake only if it supplies a supported Android/HAL package, a secure and maintained production image, acceptable Veryloving IP rights, and exact medical-device protocols and certificates. Yongyida has a current public Y120 listing, an open-SDK marketing claim, and company-level elder-care deployment evidence; Jiangzhi has stronger public signals for on-device customization and medical-instrument adjacency, but those signals are mostly manufacturer-attributed posts and do not establish production interfaces. The selection remains **BLOCKED — EXTERNAL** until one candidate clears every knockout gate and wins measured hardware scoring.

## How to read this document

### Status markers

- ✅ **PASS** — the narrow fact being assessed is publicly and directly evidenced for the named company or exact SKU. PASS confirms the evidence exists; it is not a substitute for physical acceptance testing.
- ⚠️ **PARTIAL** — relevant public evidence exists, but it is incomplete, indirect, limited to a marketing claim, not tied to the exact production SKU, or not independently tested.
- ❌ **BLOCKED — EXTERNAL** — no decision-grade public artifact was found. The cited blocker entry states what is missing, who can provide it, and the estimated engineering effort after receipt.

### Confidence levels

- **High** — an official manufacturer, government, chip-vendor, or standards source directly supports the stated narrow finding.
- **Medium** — a first-party marketing statement or a post published under the manufacturer's account supports the finding, but independent or exact-SKU verification is absent.
- **Low** — only indirect, historical, portfolio-level, or ambiguous evidence exists.

Confidence measures confidence in the stated finding, not confidence that a marketed capability will pass Veryloving's production tests. Absence from public search does not prove that partner-only material does not exist.

## Mandatory knockout gates

Price and feature breadth must not compensate for failure of a safety or security gate. A candidate is ineligible for a Product 2 pilot involving elderly users unless all of the following are ✅ **PASS** after document and hardware review:

1. Exact production SKU, BOM, OS/firmware, lifecycle, and applicable certifications are frozen in the supply agreement.
2. A supported, versioned API/SDK/HAL provides every required command and telemetry event without UI automation or production ADB.
3. Device-bound authentication, signed commands/callbacks, replay protection, key rotation, tenant isolation, and audit evidence pass security review.
4. Command acceptance, physical execution, asynchronous ACK, idempotency, ordering, timeout, and retry semantics pass conformance testing.
5. Fall and emergency behaviors fail safely during cloud, Wi-Fi, app, and backend outages.
6. OTA signing, rollback protection, vulnerability disclosure, SBOM, and a contracted security-patch lifetime are acceptable.
7. Data residency, subprocessors, retention, export/deletion, camera/audio handling, and the DPA pass privacy and legal review.
8. Any medical measurement uses exact instrument models, registrations, calibration evidence, protocols, units, timestamps, quality flags, and patient-binding rules approved by Regulatory.
9. Veryloving retains its background IP and has sustainable binary/source, signing, maintenance, and termination rights.
10. Two production-equivalent units pass functional, privacy, security, recovery, performance, and minimum 72-hour soak acceptance.

## Manufacturer profile: Yongyida

### Publicly evidenced position

Yongyida maintains a current official page for the **小勇 Y120**, describing it as an AI large-model guide robot rather than an elderly-care or medical robot. The page lists fixed-point narration, voice interaction, face recognition, proactive greeting, customized questions and answers, and multimodal interaction. On 20 July 2026, that page displayed a retail-style price of **RMB 19,800**. This is useful evidence that a product and public list price exist, but it is not a procurement quotation: included options, tax, support, freight, warranty, customization, minimum order quantity, and production continuity are not stated. [Y1]

Y120 image sheets linked from the official page claim autonomous patrol/navigation, route and map editing, remote mobile control/camera monitoring, local face recognition, locally editable Q&A, ToF lidar, ultrasonic and collision sensing, optional structured-light sensing, automatic charging, and a physical SOS button. A separate sheet markets an “open SDK” and staged business customization. These are exact-product first-party claims, not a downloadable SDK contract or independent acceptance result. [Y2] [Y3]

Yongyida also has public elder-care activity at the company level. A July 2025 company announcement describes a Bao'an Social Welfare Center collaboration involving companionship, health-data collection/analysis, and reminders. A Shenzhen government report published in January 2026 describes a Yongyida companion robot in an elder-care facility delivering medication reminders, entertainment, video calls, dialect interaction, and profile-based services. Neither source identifies the deployed unit as Y120 or publishes the robot's command, telemetry, privacy, or reliability contract. The evidence therefore supports “company has participated in elder-care deployments,” not “Y120 already satisfies Product 2.” [Y4] [Y5]

### Integration fit

The cleanest Yongyida path would be Veryloving cloud → vendor cloud/API → robot, with authenticated asynchronous callbacks returning command acceptance, physical execution, status, and telemetry. That path would fit the repository's `YongyidaAdapter` without placing vendor credentials in the mobile app. It is only a proposed architecture. No public OpenAPI specification, Postman collection, SDK artifact, OAuth/API-key/device-certificate scheme, webhook catalogue, MQTT/WebSocket contract, sandbox, rate limit, error catalogue, idempotency semantics, or SLA was found.

The official research-institute page says a developer platform provides open APIs and SDKs, while its roadmap also describes an open AI developer platform as future work. The current Y120 marketing sheet separately claims an open SDK. Together these sources justify asking for a partner package, but they do not prove that the advertised surface controls navigation, alarm, emergency stop, medication workflow, camera, battery, or safety telemetry. The SDK could be a binary library, a content-authoring surface, or restricted to another product generation. [Y2] [Y6]

### Hardware, safety, and medical fit

Public Y120 materials disclose useful functional components but not the engineering baseline needed for a maintained safety device. CPU/SoC, architecture, RAM, storage, operating system, security-patch level, secure boot, OTA ownership, battery chemistry/capacity, ingress protection, camera models, exact radio security, expansion interfaces, and sensor sampling specifications remain undisclosed. The published ten-hour runtime and four-to-five-hour charge are manufacturer claims and require workload-specific measurement. [Y2]

No public Y120 evidence establishes validated fall detection, medical-device certification, or structured integration with ECG, blood-pressure, glucose, SpO2, or other clinical instruments. The company-level elder-care announcement mentions health-data collection and analysis but does not name instruments, protocols, registrations, accuracy, calibration, or patient-binding controls. Treating Y120 as medically capable before those artifacts arrive would be an unsupported product claim.

### Commercial and operational fit

Yongyida publicly advertises ODM/OEM and business customization, which is a positive route to a branded pilot. Public materials do not define customization boundaries, MOQ, NRE, unit pricing by volume, lead time, warranty, spares, field service, source/binary license, API support, end-of-life notice, or liability allocation. Face, voice, video, resident-profile, and cloud-data features create material privacy and data-residency questions that cannot be answered from the product page.

### Decision position

Yongyida is the **recommended first cloud-POC candidate, conditionally**, because a complete partner cloud interface would minimize on-device coupling and because company-level elder-care deployment evidence exists. It is **not the recommended production vendor yet**. It advances only if the private package proves the exact elder-care SKU, full safety command/telemetry contract, offline behavior, device-bound security, privacy controls, and lifecycle support. A content-only SDK or a Y120 guide-robot package without fall/emergency semantics fails the gate.

## Manufacturer profile: Jiangzhi Robot

### Publicly evidenced position

Jiangzhi presents itself as a care-robot ecosystem company. Its official company page describes “康养港湾” across multiple elderly-care scenarios, while a 2025 project-pitch listing describes more than ten JZR products and says JZKH1.0 launched in June 2025. The event listing is useful evidence of the company's stated direction, not API or deployment validation. No public JZKH1.0 release artifact, developer portal, interface reference, or production customer acceptance report was found. [J1] [J2]

Product posts published under Jiangzhi's account on Elecfans describe a portfolio rather than a single standard platform. The JZR580300 “小暖心” is advertised with Android, Windows, or Linux options and, for Android, RK3399/RK3588 configurations. A chronic-disease SKU is advertised with Android 8.1/9.0 or Windows and a medical-instrument compartment. Other public SKUs use Windows, while historical units cite Android 7.1/8.1. RK3399 and RK3588 are ARM64-class platforms according to Rockchip, but the exact Android API level, kernel/BSP, security patch, boot policy, and OTA ownership for a proposed Veryloving unit are unknown. These pages are manufacturer-attributed commercial posts hosted by Elecfans; they are not independent technical validation. [J3] [J4] [J5]

### Integration fit

Jiangzhi's apparent advantage is the possibility of a Veryloving-managed Android edge application. If formally supported, the edge service could expose a loopback or mutually authenticated LAN API to translate the repository's vendor-neutral commands into a documented AAR/JAR, AIDL/Binder service, serial interface, or other vendor HAL. That design could support low-latency local action and bounded offline behavior. The public evidence does not establish that such a HAL exists.

One Jiangzhi-account post gives a concrete lower-level example: a facial-expression module controlled over USB serial and supporting Android, Windows, Linux, and HarmonyOS. It proves only that this particular accessory is marketed with serial control. It does not establish serial or Android access to navigation, cameras, battery, alarm, medical instruments, emergency stop, or JZKH. Veryloving must not extrapolate a whole-robot control protocol from one peripheral. Runtime ADB and UI automation remain unacceptable production approaches. [J6]

No public robot-control REST, MQTT, WebSocket, gRPC, Binder/AIDL, Android intent/content-provider, SDK artifact, sample app, authentication model, callback schema, rate limit, sandbox, SLA, or version policy was found. JZKH1.0 should therefore stay outside the critical path until Jiangzhi supplies a supported contract.

### Source access and IP

A “specific cooperation methods” article under Jiangzhi's Elecfans account describes a co-development structure in which the external developer initially funds work; costs are amortized over early sales; after a specified unit threshold, the developer transfers source code to Jiangzhi and continues improvements. It separately describes an approval route for developer-owned software installed on the mainboard. This is not evidence that Jiangzhi supplies its upper-layer source to Veryloving, and it does not establish acceptable rights for Veryloving's orchestration, edge bridge, models, data, or security updates. Background IP, derivative work, source access, binary distribution, APK/firmware signing, escrow, maintenance, termination, and post-termination operation all require explicit contract language. [J7]

### Medical and safety fit

The chronic-disease product listing claims use or support of external Lepu instruments for temperature, blood pressure, glucose, blood oxygen, ECG, and configurable equipment, and says the instruments hold medical-device qualifications. The same material describes local display, voice output, storage, sharing, trends, identity checks, and consultation. No registration numbers, exact instrument models, certificates, BLE services, USB VID/PID, serial frames, SDK, structured payload examples, units, precision, quality flags, calibration schedule, patient binding, raw ECG access, or data-retention rules are public. These are promising product-adjacency signals—not proof that the robot motherboard or Veryloving can retrieve regulated measurements safely. [J4]

No public material validates fall detection from robot cameras or other sensors. Camera-based fall monitoring also raises consent, false-positive/false-negative, local-processing, retention, bystander, and emergency-escalation issues that require an exact implementation and clinical/safety test protocol.

### White-labeling and lifecycle

Jiangzhi-account material advertises custom designs, existing shells or custom molds, OEM/ODM, private-label/neutral sales, and installation of approved independent Android apps. That is stronger public evidence of customization intent than of implementation rights. Public terms do not define logo/boot screen/wake word, launcher/kiosk ownership, privileged permissions, signing keys, secure boot, factory reset, OTA, MOQ, NRE, or support lifetime. [J3] [J8]

The platform fragmentation visible in public listings is the central lifecycle concern. A camera- and health-capable robot cannot ship on an unsupported image. Selection requires one frozen board and image, a current supported security baseline, signed OTA and rollback protection, SBOM, vulnerability process, and a multi-year patch commitment.

### Decision position

Jiangzhi is the **recommended parallel edge/medical discovery candidate**, not the current production choice. It should overtake Yongyida only if the private package proves a supported whole-robot HAL, dependable local/offline safety, a maintained Android image, acceptable Veryloving IP and signing rights, and exact medical-device protocols/certificates. Permission to install an ordinary APK, access through ADB, or marketing evidence of medical instruments is insufficient.

## Weighted decision matrix

Weights total 100. Do not calculate a winner while any knockout criterion is ❌ **BLOCKED — EXTERNAL**. After the artifact gate, score a verified ✅ PASS at full weight and a bounded ⚠️ PARTIAL at half weight; a knockout failure disqualifies the candidate rather than merely scoring zero.

| # | Criterion | Weight | Yongyida | Jiangzhi | Selection evidence required |
| ---: | --- | ---: | --- | --- | --- |
| 1 | Exact Product 2 elderly-care fit | 6 | ⚠️ **PARTIAL** — company-level elder-care work is reported, but public Y120 positioning is guide/patrol rather than elderly-care. **Confidence: High.** [Y1] [Y4] [Y5] | ⚠️ **PARTIAL** — public portfolio and project-pitch material target care and chronic-disease scenarios, but no exact Veryloving SKU is frozen or tested. **Confidence: Medium.** [J1] [J2] [J4] | Exact SKU requirement traceability and witnessed demo; gaps route to **B-SKU** and **B-HWTEST**. |
| 2 | Public commercial product availability | 3 | ✅ **PASS** — Y120 has a current official product and purchase page. This verifies public listing, not supply continuity. **Confidence: High.** [Y1] | ⚠️ **PARTIAL** — multiple SKUs are advertised in Jiangzhi-attributed product posts, but current orderability and production status are not independently confirmed. **Confidence: Medium.** [J3] [J4] | Dated quotation for production-equivalent units and lifecycle statement. |
| 3 | Price and total-cost transparency | 5 | ⚠️ **PARTIAL** — the official Y120 page displayed RMB 19,800 on 20 July 2026; configuration, tax, support, customization, freight, warranty, and volume terms are unknown. **Confidence: High that the page displays the price; Low for procurement applicability.** [Y1] | ❌ **BLOCKED — EXTERNAL** — no decision-grade exact-SKU quotation or TCO schedule found. **Blocker: B-COM. Confidence: High that public evidence is insufficient.** | Comparable five-year TCO: unit, NRE, molds, licenses/cloud, freight, tax, warranty, spares, support, and EOL. |
| 4 | MOQ, NRE, lead time, warranty, and spares | 3 | ❌ **BLOCKED — EXTERNAL** — public ODM/OEM intent does not provide commercial terms. **Blocker: B-COM. Confidence: High.** [Y7] | ❌ **BLOCKED — EXTERNAL** — customization is advertised without comparable commercial terms. **Blocker: B-COM. Confidence: High.** [J8] | Signed quote and supply/service schedule. |
| 5 | Exact-model real deployment evidence | 4 | ⚠️ **PARTIAL** — official and government sources support company-level elder-care activity, but neither identifies Y120 or publishes acceptance outcomes. **Confidence: High.** [Y4] [Y5] | ⚠️ **PARTIAL** — care ecosystem and hospital collaboration are described in company/project-pitch material, but exact-model operational evidence and results are absent. **Confidence: Low–Medium.** [J1] [J2] | Reference customer, exact model/firmware, deployment period, incident/uptime data, and customer interview; **B-HWTEST** still applies. |
| 6 | Versioned production API/SDK/HAL | 8 | ⚠️ **PARTIAL** — Y120 marketing claims an open SDK and an older institute page depicts API/SDK access, but no downloadable contract, license, sample, or sandbox was found. **Confidence: High in claim existence; Low in usable scope.** [Y2] [Y6] | ❌ **BLOCKED — EXTERNAL** — Android/app and one peripheral-serial path are advertised, but no whole-robot SDK/HAL/JZKH API is public. **Blocker: B-API. Confidence: High.** [J3] [J6] | OpenAPI/Postman or versioned AAR/JAR/AIDL/serial HAL, license, samples, sandbox, compatibility and change policy. Yongyida's remaining gap also maps to **B-API**. |
| 7 | Authentication, device identity, and key rotation | 6 | ❌ **BLOCKED — EXTERNAL** — no public API-key/OAuth/mTLS/signing or device-provisioning contract. **Blocker: B-AUTH. Confidence: High.** | ❌ **BLOCKED — EXTERNAL** — no supported edge/cloud identity, signing, provisioning, or rotation contract. **Blocker: B-AUTH. Confidence: High.** | Device-bound identity, least privilege, rotation/revocation, callback verification, tenant isolation, and audit model. |
| 8 | Required command and safety-action coverage | 6 | ❌ **BLOCKED — EXTERNAL** — no machine interface for medication reminder, fall alert, safety check, audio, two-way call, alarm, or emergency stop. **Blocker: B-CMD. Confidence: High.** | ❌ **BLOCKED — EXTERNAL** — public Android/customization claims do not grant whole-robot or safety control. **Blocker: B-CMD. Confidence: High.** | Exact mapping for every `RobotAdapter` method, parameter bounds, authorization, physical effect, cancellation, and safe failure. |
| 9 | Telemetry and event schemas | 5 | ❌ **BLOCKED — EXTERNAL** — remote video and broad data categories are marketed, but no machine-readable battery, fall, vitals, status, or event schema is public. **Blocker: B-TELEM. Confidence: High.** [Y2] [Y6] | ❌ **BLOCKED — EXTERNAL** — medical display/storage and ecosystem data are discussed, but no supported export/stream schema exists publicly. **Blocker: B-TELEM; medical fields also B-MED. Confidence: High.** [J2] [J4] | Versioned schemas, units, timestamps, quality/freshness, frequency, ordering, reconnect/backfill, patient/device identity, and sample captures. |
| 10 | ACK, idempotency, ordering, retry, and replay semantics | 5 | ❌ **BLOCKED — EXTERNAL** — no acceptance-versus-execution ACK or duplicate-effect contract. **Blocker: B-CMD. Confidence: High.** | ❌ **BLOCKED — EXTERNAL** — no local/cloud delivery semantics are public. **Blocker: B-CMD. Confidence: High.** | Correlation IDs, idempotency retention, ordering domains, retry-after/error taxonomy, terminal states, and replay tests. |
| 11 | Command latency, availability, and SLA | 4 | ❌ **BLOCKED — EXTERNAL** — no API SLA or measured end-to-end safety latency. **Blocker: B-SLA. Confidence: High.** | ❌ **BLOCKED — EXTERNAL** — local control may be architecturally possible, but no supported interface benchmark or SLA exists. **Blocker: B-SLA. Confidence: High.** | p50/p95/p99 acceptance and physical-effect latency under load/loss, uptime, support response, and 72-hour soak. |
| 12 | Offline operation and local safety | 7 | ⚠️ **PARTIAL** — offline face recognition and local Q&A are claimed; offline queueing, fall response, emergency stop, alarm, and recovery are unknown. **Confidence: Medium.** [Y2] | ⚠️ **PARTIAL** — an on-device application path is plausible and product posts cite Android, but HAL privileges and fail-safe behavior are unknown. **Confidence: Low–Medium.** [J3] | Witnessed network-loss/process-death tests and local safety state machine; both candidates remain subject to **B-OFFLINE** and **B-HWTEST**. |
| 13 | Open platform and customization depth | 5 | ⚠️ **PARTIAL** — open-SDK and staged business customization are marketed; source, privileges, signing, and supported scope are unknown. **Confidence: Medium.** [Y2] | ⚠️ **PARTIAL** — OEM/ODM, independent app installation, and source-transfer cooperation models are advertised; exact privileges and Veryloving rights are unknown. **Confidence: Medium.** [J7] [J8] | Supported customization matrix, signing/launcher/wake-word controls and compatibility; gaps map to **B-WL**, **B-API**, and **B-IP**. |
| 14 | Compute, storage, connectivity, and expansion interfaces | 3 | ⚠️ **PARTIAL** — functional sensors and remote features are listed, but SoC, RAM/storage, OS, exact radios, Ethernet/USB/serial/GPIO, electrical data, and expansion limits are absent. **Confidence: High.** [Y2] | ⚠️ **PARTIAL** — company-account SKU pages give board/memory/OS/connectivity examples, but the portfolio is fragmented and the exact production BOM/image is not selected. **Confidence: Medium.** [J3] [J4] [J5] | Exact production BOM, schematics/interface control document, power/thermal envelope, and image manifest; **B-SKU**. |
| 15 | Navigation and environmental sensing | 4 | ⚠️ **PARTIAL** — exact-Y120 first-party sheets claim SLAM/navigation, ToF lidar, ultrasonic and collision sensing; models, safety envelope, maps, APIs, and measured performance are absent. **Confidence: Medium.** [Y2] | ❌ **BLOCKED — EXTERNAL** — no decision-grade exact-SKU navigation/safety-sensor HAL and performance package found. **Blockers: B-SKU, B-API, B-HWTEST. Confidence: High.** | Exact sensors, map ownership, restricted zones, localization accuracy, obstacle/drop tests, command HAL, and recovery behavior. |
| 16 | Validated fall detection and emergency escalation | 6 | ❌ **BLOCKED — EXTERNAL** — no exact-Y120 validated fall detector, dataset, thresholds, escalation interface, or acceptance result found. **Blocker: B-FALL. Confidence: High.** | ❌ **BLOCKED — EXTERNAL** — no exact-SKU validated camera/sensor fall detector, event schema, or privacy/safety result found. **Blocker: B-FALL. Confidence: High.** | Exact algorithm/sensor path, local behavior, sensitivity/specificity, false-alarm handling, diverse-home test set, event authentication, and witnessed escalation. |
| 17 | Medical instruments, protocols, calibration, and certification | 6 | ❌ **BLOCKED — EXTERNAL** — company-level health-data language does not establish exact instruments or a Y120 medical interface. **Blocker: B-MED. Confidence: High.** [Y4] | ⚠️ **PARTIAL** — a Jiangzhi-account product page claims external Lepu instruments and qualifications, but exact models, registration certificates, protocols, calibration, schemas, and robot integration boundary are not public. **Confidence: Medium.** [J4] | Exact device/model registrations and certificates, protocol/SDK, calibration/quality metadata, cybersecurity, patient binding, and regulatory scope; both remain subject to **B-MED**. |
| 18 | OS, firmware, OTA, and security lifecycle | 5 | ❌ **BLOCKED — EXTERNAL** — Y120 OS, patch state, secure boot, OTA keys, SBOM, rollback, disclosure process, and support term are not public. **Blocker: B-OTA. Confidence: High.** | ⚠️ **PARTIAL** — public portfolio examples include legacy Android releases and an unspecified release on newer boards; no frozen image, patch SLA, secure boot/OTA, or SBOM is public. **Confidence: Medium.** [J3] [J4] [J5] | Supported image/BSP, current patch baseline, signed OTA, rollback protection, SBOM/CVE process, factory recovery, and contracted lifecycle; **B-OTA**. |
| 19 | Privacy, residency, retention, export, and deletion | 4 | ❌ **BLOCKED — EXTERNAL** — face/video/voice/profile/cloud features are described without a production data map or DPA. **Blocker: B-PRIV. Confidence: High.** [Y2] [Y5] | ❌ **BLOCKED — EXTERNAL** — camera/health/local-sharing claims lack data flow, cloud/subprocessor, retention, consent, export/delete, and DPA details. **Blocker: B-PRIV. Confidence: High.** [J4] | Complete data inventory/flow, residency and subprocessors, controller/processor roles, consent, retention, deletion/export APIs, logs/backups, incident terms, and DPA. |
| 20 | Source, binary, IP, signing, and termination rights | 3 | ❌ **BLOCKED — EXTERNAL** — advertised SDK/customization does not disclose license, Veryloving background-IP protection, signing rights, escrow, or termination continuity. **Blocker: B-IP. Confidence: High.** | ⚠️ **PARTIAL** — public cooperation terms describe source transfer from developer to Jiangzhi in one model and a separate developer-owned app route, but do not establish acceptable Veryloving rights. **Confidence: Medium.** [J7] | Negotiated background/foreground IP, binary/source distribution, modification, escrow, signing, maintenance, audit, termination, and post-termination operation; **B-IP**. |
| 21 | Developer support, change control, and incident response | 2 | ❌ **BLOCKED — EXTERNAL** — commercial contact exists, but no named API engineering team, support SLA, release notes, deprecation, or incident process is public. **Blocker: B-SUPPORT. Confidence: High.** [Y1] | ❌ **BLOCKED — EXTERNAL** — a cooperation route is described, but no named integration support SLA, compatibility policy, or incident process is public. **Blocker: B-SUPPORT. Confidence: High.** [J7] | Named technical/security contacts, escalation coverage, response/restore SLA, compatibility matrix, release/deprecation notice, and joint incident procedure. |

## External blocker register

Every ❌ **BLOCKED — EXTERNAL** matrix cell points to at least one entry below. Estimates begin only after complete, internally consistent material or hardware access is received; legal negotiation and shipping time are excluded.

| Blocker | What is blocking | Who can unblock | Estimated effort once unblocked | Completion evidence |
| --- | --- | --- | --- | --- |
| **B-COM** | Exact configured unit quotation, MOQ, NRE/mold/customization fees, recurring cloud/license fees, freight/tax, lead time, warranty, spares, service, price protection, and EOL terms | Manufacturer sales/operations; Grace and Procurement approve assumptions | 1–2 business days to normalize quotes; 2–3 days for five-year TCO sensitivity | Signed comparable quote and TCO model |
| **B-SKU** | Frozen production SKU/BOM, SoC, RAM/storage, radios/ports, sensor models, power/thermal/mechanical data, OS/BSP/firmware, option codes, certifications, and lifecycle | Manufacturer product and hardware engineering | 2–3 business days for architecture/BOM review; 2 days to update adapter constraints | Signed configuration baseline and interface-control document |
| **B-API** | Versioned OpenAPI/Postman or supported Android SDK/HAL, artifacts, license, sample app, sandbox, schema bundle, compatibility, release notes, and deprecation policy | Manufacturer API/platform lead after NDA; Shenzhen engineer supports lab access | 3–5 business days for gap/security review; 5–10 business days for first conformance adapter | Contract tests pass against vendor sandbox/exact image |
| **B-AUTH** | Authentication, per-device identity/provisioning, mTLS/signing, callback verification, tenant isolation, secret storage, rotation/revocation, and audit design | Manufacturer security/API team; Veryloving Security approves | 2–4 business days for threat-model review; 3–5 days for implementation/conformance | Signed auth profile and negative/replay/rotation tests pass |
| **B-CMD** | Required command mappings, bounds, safety interlocks, authorization, acceptance/execution ACKs, correlation, idempotency, ordering, errors, timeout, retry, cancellation, and duplicate-effect behavior | Manufacturer robot-control/API team | 3–5 business days to map/test; 5–10 days if vendor semantics need a bridge | Every `RobotAdapter` command passes fault-injected contract tests |
| **B-TELEM** | Battery/status/fall/vitals/location/event schemas, transports, timestamps, units, quality/freshness, frequency, ordering, reconnect/backfill, samples, and versioning | Manufacturer telemetry/cloud/HAL team; medical supplier for vitals | 3–5 business days for parser/validation; 2–3 days of fault testing | Recorded samples and live stream pass schema/freshness/reconnect tests |
| **B-SLA** | Vendor endpoint/image access and written latency, throughput, uptime, rate-limit, maintenance, support and recovery commitments | Manufacturer platform/operations and commercial owner; Shenzhen engineer runs tests | 2–3 business days benchmark plus minimum 72-hour soak | p50/p95/p99 and failure/soak report meets Product 2 thresholds |
| **B-OFFLINE** | Exact documented behavior during internet, Wi-Fi, vendor-cloud, Veryloving-cloud, app, and process failure, including local alarm/stop/fall behavior and queue recovery | Manufacturer safety/firmware team; Shenzhen engineer validates | 3–5 business days for fault matrix and recovery testing | Witnessed fail-safe tests with no lost/duplicate safety effect |
| **B-FALL** | Exact fall-sensing hardware/algorithm, event interface, local escalation, datasets/metrics, limitations, privacy behavior, and validation protocol | Manufacturer safety/vision team; Veryloving Safety/Clinical/Privacy; independent test lab where required | 5 business days to design/execute initial engineering validation; clinical/regulatory validation is separately scheduled | Approved sensitivity/specificity/false-alarm and escalation report on exact SKU |
| **B-MED** | Exact instrument models and registrations, certificates, supported protocols/SDKs, schemas, units, precision, quality flags, calibration, timestamp/patient binding, raw-data rights, cybersecurity, and regulatory boundary | Manufacturer medical lead, medical-device supplier, Grace, and Veryloving Regulatory/Privacy | 5–10 business days for document/protocol review and bench integration; formal regulatory work depends on intended claims | Registration/certificate verification and calibrated end-to-end data provenance test |
| **B-OTA** | Production OS/BSP baseline, secure/verified boot, signing custody, OTA manifest/signature, rollback protection, recovery/factory reset, SBOM, CVE/disclosure process, patch cadence, and support/EOL term | Manufacturer firmware/security lead; Veryloving Security | 3–5 business days for architecture review; 3–5 days for OTA/rollback lab test | Signed lifecycle schedule and successful authorized/unauthorized/rollback tests |
| **B-PRIV** | Complete camera/audio/face/location/health data flow, cloud regions, subprocessors, controller/processor roles, consent, retention, logs/backups, access/export/deletion, breach terms, and DPA | Manufacturer privacy/security/legal; Grace and Veryloving Privacy/Legal | 3–5 business days technical review; legal negotiation duration is external | Approved data-flow map, deletion/export test, and executed DPA |
| **B-IP** | SDK/source/binary license, background and foreground IP, derivative rights, APK/firmware signing, distribution, escrow, audit, support, termination, and post-termination operation | Manufacturer legal/commercial; Grace and Veryloving Legal | 3–5 business days engineering/license impact review; negotiation duration is external | Executed agreement preserving Veryloving background IP and operational continuity |
| **B-WL** | Exact white-label controls for enclosure/logo/color, boot animation, launcher/kiosk, voice/wake word, app privileges, signing, factory reset, MOQ/NRE and lead time | Manufacturer ODM, firmware, and sales teams | 2–3 business days to validate software assets; enclosure/mold effort follows quote | Approved customization matrix and production sample |
| **B-HWTEST** | Two identical production-equivalent units, latest release firmware, accessories, diagnostic access, lab space, and an available Shenzhen engineer | Grace/Procurement, manufacturer logistics, and Shenzhen engineering lead | 2 days setup; 10 business days initial acceptance; minimum 72-hour soak | Signed hardware acceptance and defect report |
| **B-SUPPORT** | Named engineering/security contacts, coverage hours, severity definitions, response/restore targets, release/deprecation notice, compatibility ownership, RMA, and joint incident process | Manufacturer commercial owner and engineering manager; Grace approves SLA | 1–2 business days operational review after proposal; contract negotiation external | Executed support/SLA appendix and escalation exercise |

## Risk assessment

### Yongyida — top three risks

| Risk | Severity / current status | Evidence and consequence | Mitigation and acceptance gate |
| --- | --- | --- | --- |
| Advertised SDK is not a production robot-control contract | **Critical** — ❌ **BLOCKED — EXTERNAL** (`B-API`, `B-AUTH`, `B-CMD`, `B-TELEM`) | An official Y120 sheet claims an open SDK and an older institute page discusses APIs/SDKs, but no package or command contract is public. A content-only or partner-binary SDK could leave Veryloving unable to implement safe commands, durable ACKs, or telemetry. [Y2] [Y6] | Make purchase conditional on the complete package, sandbox and license. Run generated schema validation, negative auth, replay, duplicate-effect, ACK, retry, callback and version-compatibility tests before commercial selection. **Who:** Yongyida API/security leads. **Effort after receipt:** 5–10 business days for initial conformance. |
| Y120 and the observed elder-care deployment may be different products | **High** — ❌ **BLOCKED — EXTERNAL** (`B-SKU`, `B-FALL`, `B-MED`, `B-HWTEST`) | The official Y120 page positions a guide robot; elder-care sources are company-level and do not identify Y120. Fall monitoring, medication acknowledgement, medical instruments, indoor elder UX, and emergency escalation are not demonstrated for the exact candidate. [Y1] [Y4] [Y5] | Freeze SKU/BOM/options and trace every Veryloving requirement to a live demonstration and interface. Treat every missing care function as ODM scope with price/schedule. **Who:** Yongyida product/safety teams and Shenzhen engineer. **Effort after unit/package:** 10 business days initial acceptance plus 72-hour soak. |
| Cloud, privacy, and lifecycle controls are opaque | **Critical** — ❌ **BLOCKED — EXTERNAL** (`B-AUTH`, `B-OFFLINE`, `B-OTA`, `B-PRIV`, `B-SLA`) | Face, camera, voice, profile, remote control, and cloud-data functions create sensitive flows, while hosting, tenancy, OTA chain, outage behavior, data deletion, and SLAs are undisclosed. A cloud outage or compromised credential could affect a safety device. | Require device-bound mTLS/signing, regional data map/DPA, deletion tests, secure OTA/rollback, SBOM/patch SLA, incident process, and offline local safety. **Who:** Yongyida security/cloud/firmware and Veryloving Security/Privacy. **Effort after complete artifacts:** 7–10 business days technical review/testing; legal negotiation external. |

### Jiangzhi — top three risks

| Risk | Severity / current status | Evidence and consequence | Mitigation and acceptance gate |
| --- | --- | --- | --- |
| Android installation does not imply supported whole-robot control | **Critical** — ❌ **BLOCKED — EXTERNAL** (`B-API`, `B-AUTH`, `B-CMD`, `B-TELEM`) | Product posts support an Android/app hypothesis and one accessory has a serial claim, but no public HAL grants navigation, battery, cameras, alarm, emergency stop, fall, or medical access. [J3] [J6] | Require a versioned AAR/JAR/AIDL/Binder or documented serial/BLE HAL, sample application, signing/provisioning model, cross-SKU compatibility and support SLA. Prohibit runtime ADB and UI automation. **Who:** Jiangzhi Android/firmware lead. **Effort after package/image:** 5–10 business days first edge-bridge conformance. |
| Fragmented OS/BOM may create an unpatchable camera/health endpoint | **High** — ❌ **BLOCKED — EXTERNAL** (`B-SKU`, `B-OTA`, `B-HWTEST`) | Public portfolio examples span legacy Android releases, an unspecified Android release, Windows, Linux, RK3399 and RK3588. No exact maintained image or OTA/security contract is public. [J3] [J4] [J5] | Freeze one board/image; require current patch baseline, secure boot, signed OTA, rollback protection, SBOM, vulnerability disclosure and multi-year patch SLA; test update and recovery on production units. **Who:** Jiangzhi product/firmware/security. **Effort after unit/package:** 5–8 business days review and OTA/recovery tests. |
| IP terms and medical-data boundaries may be unacceptable | **Critical** — ❌ **BLOCKED — EXTERNAL** (`B-IP`, `B-MED`, `B-PRIV`) | Public cooperation material describes source transfer to Jiangzhi in one model, while product posts name medical-instrument adjacency without exact registrations/protocols/data rights. Veryloving could lose control of background IP or ingest measurements without defensible provenance. [J4] [J7] | Execute a background-IP/binary/signing/termination agreement before source sharing. Obtain exact registrations, protocols, calibration/quality data, DPA and regulatory assessment before any medical claim. **Who:** Jiangzhi legal/medical teams, instrument supplier, Grace and Veryloving Legal/Regulatory. **Effort after artifacts:** 5–10 business days technical review; contract/regulatory timing external. |

## Recommendation and selection rule

### Current recommendation

**Production award: ❌ BLOCKED — EXTERNAL.** Do not choose either manufacturer today, do not represent the provisional adapter contract as a vendor API, and do not place safety or medical claims on public marketing evidence.

**Next engineering priority: Yongyida constrained cloud POC, conditionally.** Send the same artifact request to both candidates. If Yongyida returns a complete package first and passes the knockout review, test its sandbox/cloud path first because it can remain isolated behind the existing server-side adapter and avoids dependence on a privileged on-device application. This is a sequencing decision, not vendor approval.

**Parallel strategic option: Jiangzhi edge/medical POC.** Proceed only on a frozen, supported image with a whole-robot HAL and acceptable IP/signing terms. Jiangzhi becomes the preferred vendor if—and only if—hardware evidence shows materially better local/offline safety and medical integration while it also passes security, privacy, lifecycle, and commercial gates.

### Evidence-driven award procedure

1. Grace sends both manufacturers one identical package request and requests two production-equivalent units.
2. Engineering records each artifact against blockers `B-SKU` through `B-SUPPORT`; unsupported verbal assurances stay ❌ **BLOCKED — EXTERNAL**.
3. Security, Privacy, Legal, Regulatory, and Procurement apply the knockout gates before numerical scoring.
4. Passing candidates receive full/half weighted scores only for verified PASS/PARTIAL evidence.
5. Run parallel fault-injected conformance on the exact units: network loss, duplicate/replayed command, process death, stale telemetry, factory reset, OTA failure, account deletion, and 72-hour soak.
6. Award the vendor with the higher measured score only after all mandatory gates pass. If neither passes, retain the vendor-neutral HAL and reopen sourcing; do not weaken a safety gate to preserve schedule.

### Tie-break rules

1. Safer local behavior during total cloud loss.
2. Stronger device identity, OTA chain, privacy deletion, and longer supported lifecycle.
3. Lower false-negative/false-positive fall risk on the agreed validation set.
4. Clearer Veryloving IP, signing, and termination continuity.
5. Lower five-year TCO at the same verified capability—not public list price alone.

## Evidence register

### Yongyida sources

- **[Y1] Official manufacturer:** [Y120 product page](https://www.yydrobo.com/show-458.html) — exact public positioning, features and page-listed price; accessed 20 July 2026.
- **[Y2] Official manufacturer image sheets linked from Y120:** [core functions](https://www.yydrobo.com/Uploads/image/20250714/20250714105958_78870.png), [remote monitoring](https://www.yydrobo.com/Uploads/image/20250714/20250714110527_23582.png), [offline face recognition](https://www.yydrobo.com/Uploads/image/20250714/20250714110812_24217.png), [environment sensors](https://www.yydrobo.com/Uploads/image/20250714/20250714112649_48533.png), [charging/runtime](https://www.yydrobo.com/Uploads/image/20250714/20250714112743_56345.png), [physical components](https://www.yydrobo.com/Uploads/image/20250714/20250714112948_87575.png), and [open SDK/customization](https://www.yydrobo.com/Uploads/image/20250714/20250714113112_58032.png) — first-party product claims, not independent test results.
- **[Y3] Official manufacturer:** [Y120 remote-control and capability material](https://www.yydrobo.com/show-458.html) — exact model marketing context.
- **[Y4] Official manufacturer:** [Bao'an Social Welfare Center partnership announcement](https://www.yydrobo.com/show-446.html), 6 July 2025 — company-level elder-care plans/claims, not exact-SKU integration evidence.
- **[Y5] Government:** [Shenzhen government report on elder-care deployment](https://fgw.sz.gov.cn/ztzl/qtztzl/szscjmyjjfzzhfwpt/xwdt/content/post_12623414.html), 22 January 2026 — government-reported company deployment; robot model and interface not stated.
- **[Y6] Official manufacturer:** [Research institute and cloud/developer roadmap](https://www.yydrobo.com/institute.html) — API/SDK developer-platform language and future-platform roadmap; no downloadable package established.
- **[Y7] Official manufacturer:** [ODM/OEM process](https://www.yydrobo.com/list-113.html) — customization intent; no quoted commercial or technical scope.

### Jiangzhi sources

- **[J1] Official manufacturer:** [Jiangzhi company description](https://www.jzera.com.cn/%E5%85%AC%E5%8F%B8%E7%AE%80%E4%BB%8B) — company and “康养港湾” ecosystem positioning; no API contract.
- **[J2] Event organiser / company project pitch:** [2025 Nanshan health-industry event listing](https://www.yirongvc.com/news/newsdetail/1267.html) — reports Jiangzhi's project claims, product breadth, hospital collaboration, and JZKH1.0 launch; not independent product validation.
- **[J3] Jiangzhi company-account post on Elecfans:** [JZR580300 configuration](https://www.elecfans.com/d/6701065.html) — Android/Windows/Linux, board/memory, and private-label claims; manufacturer-attributed marketing.
- **[J4] Jiangzhi company-account product page on Elecfans:** [JZR1400640CP chronic-disease robot](https://www.elecfans.com/p/v79941.html) and [related company-account article](https://m.elecfans.com/article/2798339.html) — platform and medical-instrument claims; certificates/protocols not published.
- **[J5] Jiangzhi company-account sources on Elecfans:** [JZR1560520 monitoring robot](https://www.elecfans.com/p/v142013.html) and [historical RK3399 Android robot](https://m.elecfans.com/article/2223878.html); supplemented by official [Rockchip RK3399](https://opensource.rock-chips.com/wiki_RK3399) and [RK3588](https://www.rock-chips.com/a/cn/product/RK35xilie/2022/0926/1656.html) architecture sources.
- **[J6] Jiangzhi company-account post on Elecfans:** [JZRF USB-serial facial-expression module](https://m.elecfans.com/article/3378684.html) — one accessory's advertised interface; not a whole-robot protocol.
- **[J7] Jiangzhi company-account post on Elecfans:** [Specific cooperation methods for care-robot ecosystem software](https://www.elecfans.com/d/3894397.html) — attributed commercial/co-development model; not an executed license for Veryloving.
- **[J8] Jiangzhi company-account posts on Elecfans:** [hardware/public-service platform customization](https://m.elecfans.com/article/2123864.html) and [OEM/ODM cooperation statement](https://m.elecfans.com/article/7972390.html) — customization marketing, not detailed scope or terms.

## Related internal documents

- [Detailed public technical research](#hardware-partner-research)
- [Robot HAL architecture](#robot-hal-architecture)
- [Adapter integration guide](#robot-adapter-integration-guide)
- [Adapter runtime bug and fix log](#closed-audit-summary)

<!-- END:hardware-partner-decision-matrix -->

<!-- BEGIN:manufacturer-api-requirements -->
<a id="manufacturer-api-requirements"></a>
## Appendix — Manufacturer API Requirements

Last reviewed: 22 July 2026

Scope: Product 2 home companion robot integrations with Yongyida and Jiangzhi

## Purpose

Use this checklist as the intake and acceptance gate for a manufacturer technical package. It maps every requested artifact, credential, and access right to the current vendor-neutral [`RobotAdapter`](../server/src/adapters/RobotAdapter.ts). Receiving a file is not the same as passing the gate: an item remains `BLOCKED — EXTERNAL` until the named artifact is received, reviewed, and exercised in a vendor sandbox or on the contracted hardware SKU.

The current endpoints and payloads in the Veryloving adapters are provisional Veryloving-owned bridge contracts. They are not evidence of a Yongyida or Jiangzhi production API.

## Status vocabulary

- `PASS` — the external artifact was received, reviewed, and verified against the stated acceptance evidence.
- `BLOCKED — EXTERNAL` — a manufacturer, credential owner, certification owner, or hardware custodian must act before verification is possible.

All requirements below are currently `BLOCKED — EXTERNAL`. No production adapter should be enabled merely because a mock implements the expected shape.

## Package-level acceptance gate

A manufacturer package is integration-ready only when all applicable checklist rows are `PASS` and the package includes:

1. an exact robot SKU, BOM revision, OS/BSP version, and firmware version;
2. versioned interface documentation with machine-readable schemas where applicable;
3. sandbox or engineering-device credentials delivered through an approved secret channel;
4. redistribution and modification rights for every SDK, binary, or source component;
5. a named vendor engineering owner and escalation path;
6. test evidence for authentication, commands, telemetry, reset, privacy deletion, failure recovery, and version compatibility.

Estimated efforts below start only after complete, readable materials and working access are received. They exclude manufacturer response time, commercial negotiation, regulatory testing, and hardware shipping.

## Core API

| ID | Requirement name | Description / acceptance evidence | Why it is critical | Fallback option | Status | What is blocking | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| API-001 | OpenAPI/Swagger specification | Versioned machine-readable specification covering base URLs, methods, headers, bodies, responses, and examples for every supported environment. | Defines transport for `initialize`, all command methods, status methods, and `deliverSignedAction`. | A vendor-reviewed Postman collection plus JSON Schemas can temporarily substitute; prose or traffic inference is not production-safe. | BLOCKED — EXTERNAL | No vendor API specification has been supplied. | Manufacturer API lead; Grace can request under NDA. | 1–2 engineering days to review and generate conformance tests. |
| API-002 | Command catalogue and semantics | Canonical commands, parameters, validation rules, prerequisites, side effects, completion states, cancellation rules, and unsupported-SKU behavior. | Maps `sendMedicationReminder`, `activateFallAlert`, `executeSafetyCheck`, `playSoothingAudio`, `startTwoWayVoiceCall`, `emergencyStop`, `activateAlarm`, and `setConfig`. | A Veryloving bridge may translate a smaller approved subset; unsupported safety actions must fail closed. | BLOCKED — EXTERNAL | Public materials do not define callable command semantics. | Manufacturer robot-control engineering lead. | 2–5 days for mapping; longer if commands require vendor changes. |
| API-003 | Authentication protocol | Exact API-key, OAuth, JWT, mTLS, device-certificate, token expiry, refresh, scope, and revocation rules, with sandbox credentials. | Required by `initialize` and every outbound adapter call. | Veryloving can terminate its own bridge authentication, but the bridge still needs an approved vendor credential flow. | BLOCKED — EXTERNAL | Authentication and credential lifecycle are undisclosed. | Manufacturer security/API team and credential administrator. | 1–3 days after credentials and protocol are available. |
| API-004 | Environment and endpoint catalogue | Sandbox, staging, production, regional endpoints, DNS/TLS requirements, IP allowlists, proxy rules, and data-residency boundaries. | Prevents adapters from using guessed URLs and defines safe deployment configuration. | A vendor-hosted test tenant can replace a separate sandbox if it is isolated and resettable. | BLOCKED — EXTERNAL | No endpoint or environment inventory has been supplied. | Manufacturer platform operations team. | 0.5–1 day to configure; 1–2 days for network approval. |
| API-005 | Request/response and asynchronous ACK contract | Synchronous status codes, accepted-versus-completed meaning, callback/webhook schema, correlation ID, final-state rules, and maximum completion time. | Required for `CommandResult`, `CallStatus`, `SafetyReport`, and `deliverSignedAction`; prevents treating acceptance as delivery. | Polling may replace callbacks only if the vendor documents a durable command-status endpoint and retention window. | BLOCKED — EXTERNAL | ACK delivery and completion semantics are unknown. | Manufacturer API and device-runtime leads. | 2–4 days to implement and test. |
| API-006 | Idempotency and duplicate-delivery rules | Supported idempotency header/key format, retention period, response replay, collision behavior, and device-side duplicate suppression. | Required for safe retries of every side-effecting command and signed action. | Veryloving can deduplicate before transport, but cannot safely prevent a vendor/device duplicate after an ambiguous timeout without vendor support. | BLOCKED — EXTERNAL | Vendor idempotency behavior is undocumented. | Manufacturer API/device firmware leads. | 2–5 days, including timeout and replay tests. |
| API-007 | Rate limits and quotas | Per-account, per-device, per-endpoint, burst, concurrent-stream, and daily limits; quota headers and increase process. | Sizes per-device queues and protects emergency commands from background traffic. | Conservative client-side limits can reduce risk but cannot reveal hidden vendor throttles. | BLOCKED — EXTERNAL | No published quota contract or test quota exists. | Manufacturer platform/product owner. | 1 day to model and configure after disclosure. |
| API-008 | Error catalogue and retry policy | Stable error codes, HTTP mapping, retryability, `Retry-After`, authentication failure behavior, invalid-device states, and localized/nonlocalized messages. | Drives clean `RobotAdapterError` classification, bounded retries, offline status, and user feedback. | Unknown errors can fail closed with no retry; this is safe but may reduce availability. | BLOCKED — EXTERNAL | Error taxonomy is unavailable. | Manufacturer API lead. | 1–3 days to map and test. |
| API-009 | API lifecycle and compatibility policy | Contract versioning, backward-compatibility period, change notice, deprecation/EOL schedule, release notes, and rollback procedure. | Prevents silent breakage across adapter and firmware upgrades. | Pinning a version helps only if the vendor guarantees it remains available. | BLOCKED — EXTERNAL | No version/EOL policy has been supplied. | Manufacturer product and platform owners. | 1 day to review; ongoing release governance. |
| API-010 | Device identity, pairing, unbinding, and reset API | QR claim format, one-time consumption, manufacturer device ID, hardware serial rules, ownership transfer, factory reset, erasure receipt, and re-pairing semantics. | Required for `initialize`, account binding, binding epochs, factory reset, and replay resistance. | Veryloving can own the user binding, but cannot prove physical-device possession or erase vendor-held data without a vendor claim/reset contract. | BLOCKED — EXTERNAL | Partner pairing and reset protocols are unavailable. | Manufacturer identity/device-lifecycle lead. | 3–7 days plus adversarial replay testing. |
| API-011 | Privacy export and deletion API | Export scope/format, deletion request, synchronous or asynchronous completion proof, retention exceptions, backups, and SLA. | Required for account export/deletion across manufacturer-held robot data. | Manual vendor tickets are acceptable only for a time-limited pilot with documented SLA and legal approval; not scalable production. | BLOCKED — EXTERNAL | No vendor data-subject workflow is documented. | Manufacturer privacy officer, API lead, and Veryloving privacy lead. | 3–5 days to integrate after policy approval. |
| API-012 | SDK/Postman/sample application package | Downloadable, checksum/versioned SDK or collection, sample credentials, sample device, changelog, build instructions, and executable examples. | Accelerates verification of every adapter method and reveals undocumented prerequisites. | Generate a client from API schemas; no safe fallback exists if neither schemas nor executable examples are provided. | BLOCKED — EXTERNAL | No distributable package or sandbox was found publicly. | Manufacturer developer-relations/API lead. | 1–3 days to validate the package. |
| API-013 | SDK/source license and support rights | Rights to use, modify, redistribute, deploy, audit, patch, and retain versions; third-party notices, export restrictions, source escrow, and termination effects. | Determines whether Yongyida SDK components or a Jiangzhi edge APK can legally ship and be maintained. | Use a clean-room REST bridge only if the vendor exposes a sufficient supported API and legal approves it. | BLOCKED — EXTERNAL | Licensing and source-access terms are not available. | Manufacturer legal/IP owner and Grace/Veryloving counsel. | 2–5 legal/engineering days; negotiation may take longer. |

## Telemetry

| ID | Requirement name | Description / acceptance evidence | Why it is critical | Fallback option | Status | What is blocking | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TEL-001 | Telemetry snapshot schema | Versioned schema for status, battery, vitals, location, navigation path, indoor position, safety events, and medication acknowledgements, including optional fields. | Directly defines `getDeviceStatus`, `getBatteryStatus`, and `getTelemetrySnapshot`. | Expose only vendor-confirmed fields; never synthesize missing medical or safety data. | BLOCKED — EXTERNAL | No vendor telemetry schema has been supplied. | Manufacturer telemetry/firmware lead. | 2–4 days to map and validate fixtures. |
| TEL-002 | Streaming protocol and subscription lifecycle | MQTT/WebSocket/SSE/gRPC/local callback details, topics/routes, subscribe/unsubscribe, reconnect, heartbeats, cursor/resume, and authorization. | Required for `streamVitals` and event-driven safety telemetry. | Bounded polling can support noncritical status if documented; it is unsuitable for time-critical fall alerts without an SLA. | BLOCKED — EXTERNAL | Streaming capability and protocol are unknown. | Manufacturer cloud and firmware leads. | 3–7 days plus network-failure tests. |
| TEL-003 | Field definitions, units, and valid ranges | Units, precision, nullability, enums, sensor origin, normal/invalid ranges, quality flags, and conversion rules. | Required to construct trustworthy `VitalSign`, `BatteryInfo`, and safety records. | Preserve opaque vendor payloads outside clinical UI until each field is approved; do not guess conversions. | BLOCKED — EXTERNAL | Public claims do not provide machine-level data definitions. | Manufacturer sensor/data owner. | 2–5 days; medical fields also require clinical review. |
| TEL-004 | Timestamp and ordering contract | Clock source, time zone, precision, synchronization, capture-versus-ingest time, ordering, late events, and clock-drift limits. | Supports `observedAt`, `capturedAt`, replay detection, stale-status handling, and correct event chronology. | Gateway receipt time may be recorded separately but cannot replace sensor capture time for safety or medical evidence. | BLOCKED — EXTERNAL | Vendor time semantics are undocumented. | Manufacturer firmware/cloud lead. | 1–3 days plus clock-skew tests. |
| TEL-005 | Frequency, retention, and backpressure limits | Maximum and typical sampling/publish rates, payload sizes, burst behavior, server retention, replay window, and consumer flow control. | Sizes queues, storage, bandwidth, telemetry page bounds, and reconnect behavior. | Downsample noncritical telemetry at the Veryloving bridge; safety events must remain lossless. | BLOCKED — EXTERNAL | No throughput or retention contract exists. | Manufacturer platform operations/data lead. | 2–4 days to capacity-test. |
| TEL-006 | Fall-event semantics | Detection source, event ID, confidence, location, posture state, cancellation, false-positive workflow, media linkage, and device/SKU support. | Maps robot fall monitoring into `RobotSafetyEvent` and `activateFallAlert` without confusing detection with escalation. | Veryloving may receive an opaque vendor alert for human review; it must not claim validated fall detection. | BLOCKED — EXTERNAL | No exact-SKU fall event protocol or validation report is available. | Manufacturer safety/vision lead and Veryloving clinical/safety owner. | 3–7 days integration; validation is separate. |
| TEL-007 | Medication acknowledgement semantics | Reminder ID, displayed/spoken/acknowledged/missed states, actor, timestamps, duplicate rules, and escalation policy hooks. | Required for `sendMedicationReminder` and `MedicationAcknowledgement`; accepted must not be reported as delivered. | Treat a sent reminder only as accepted and require human confirmation outside the robot. | BLOCKED — EXTERNAL | Vendor delivery/acknowledgement states are undefined. | Manufacturer application/API lead. | 2–4 days plus scenario testing. |
| TEL-008 | Indoor map and navigation coordinate system | Map IDs, floors, origin/axes/units, coordinate reference, confidence, path ordering, map version, room model, and update events. | Required for `IndoorPosition`, `RobotLocation`, and `RobotNavigationPath`. | Display only a static home marker; disable indoor paths until a map contract is verified. | BLOCKED — EXTERNAL | Coordinate frames and map lifecycle are undisclosed. | Manufacturer navigation/SLAM lead. | 3–7 days and onsite map calibration. |
| TEL-009 | Event authenticity and deduplication | Per-device signing/MAC, event ID uniqueness, sequence number, replay window, certificate rotation, and webhook retry behavior. | Prevents forged or replayed falls, vitals, and acknowledgements. | Terminate a private authenticated tunnel at a Veryloving edge bridge, but device-to-bridge authenticity still needs vendor support. | BLOCKED — EXTERNAL | No event-signing contract or keys are available. | Manufacturer security/firmware lead. | 3–7 days including replay tests. |
| TEL-010 | Telemetry consent, retention, and deletion policy | Field-by-field collection purpose, storage locations, retention, video/audio handling, user consent, export, deletion, and training-use controls. | Gates use of elder-care, location, audio/video, and medical telemetry. | Disable collection for any field without an approved lawful purpose and retention policy. | BLOCKED — EXTERNAL | Vendor processing and retention terms are unavailable. | Manufacturer privacy officer and Veryloving privacy/legal owners. | 3–10 days policy review; implementation 2–5 days. |
| TEL-011 | Golden telemetry fixtures and fault corpus | Signed examples for normal, boundary, missing, malformed, duplicated, delayed, out-of-order, and unsupported data from the contracted firmware. | Provides deterministic parser and recovery tests for status and `streamVitals`. | Veryloving can create synthetic fixtures, but they cannot prove vendor compatibility. | BLOCKED — EXTERNAL | No vendor capture set or simulator is available. | Manufacturer QA/telemetry lead. | 2–4 days to import and test. |

## Firmware and OTA

| ID | Requirement name | Description / acceptance evidence | Why it is critical | Fallback option | Status | What is blocking | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OTA-001 | Firmware inventory and compatibility matrix | Exact SKU/BOM, bootloader, OS/BSP, app, robot controller, sensor firmware, API version, and supported combinations. | `getDeviceStatus` must report actionable versions and adapters must reject incompatible contracts. | Pin pilot hardware to one audited image; production still needs a support matrix. | BLOCKED — EXTERNAL | Exact firmware stack is not disclosed. | Manufacturer firmware release manager. | 2–4 days to encode compatibility gates. |
| OTA-002 | Signed OTA chain of trust | Manifest/package format, signature algorithms, trust roots, key custody/rotation, anti-rollback, integrity checks, and secure-boot relationship. | Prevents unauthorized robot firmware and preserves command/telemetry trust. | Veryloving must not operate OTA itself without vendor-approved signing; freeze updates for a short supervised pilot only. | BLOCKED — EXTERNAL | OTA security architecture and keys are unknown. | Manufacturer security and firmware leads. | 5–10 days review/integration; independent security testing separate. |
| OTA-003 | OTA API and rollout controls | Query, download, schedule, pause, canary cohort, progress, health, completion, and forced-update behavior. | Allows safe fleet rollout without interrupting emergency or medication workflows. | Vendor-managed manual rollout can support an early pilot with written change windows and rollback SLA. | BLOCKED — EXTERNAL | No OTA control contract exists. | Manufacturer fleet-management lead. | 3–7 days if API is available. |
| OTA-004 | Failure recovery and rollback runbook | Power-loss behavior, A/B partitions, recovery image, physical recovery, rollback triggers, data preservation, and maximum unavailable time. | Prevents a failed update from bricking an elderly user's safety device. | Maintain onsite spares and vendor technicians for a pilot; not acceptable as the only production recovery model. | BLOCKED — EXTERNAL | Recovery procedure and evidence are unavailable. | Manufacturer firmware/support lead; Shenzhen engineer validates. | 2–5 days documentation/testing plus physical fault injection. |
| OTA-005 | Patch and support lifecycle | Security-patch cadence, CVE intake, maintenance window, severity SLA, Android/kernel/BSP EOL, and final support date. | Determines whether deployed robots can remain secure for their expected service life. | Contractually isolate and retire unsupported units; no software workaround makes an unpatched platform safe indefinitely. | BLOCKED — EXTERNAL | No lifecycle commitment has been provided. | Manufacturer product/security owner and procurement. | 2–5 days review; commercial negotiation may take weeks. |
| OTA-006 | Update compatibility test assets | Release candidates, changelog, migration notes, downgrade image, fixtures, and a staging fleet available before production rollout. | Lets Veryloving rerun adapter, pairing, reset, safety, and telemetry conformance on every release. | Require a minimum notice/freeze window and keep production rollout blocked until an engineering unit passes. | BLOCKED — EXTERNAL | No prerelease program or staging images exist for Veryloving. | Manufacturer release manager. | 2–3 days per release after access. |
| OTA-007 | Maintenance-state behavior | Document command acceptance, queueing, emergency stop, alarms, telemetry, local controls, and user messaging during install/reboot/recovery. | Ensures safety actions do not silently disappear while a robot updates. | Veryloving can block remote commands and notify the user, but local emergency behavior requires firmware proof. | BLOCKED — EXTERNAL | Runtime safety behavior during updates is unknown. | Manufacturer firmware/safety lead. | 2–4 days plus physical acceptance tests. |

## Security

| ID | Requirement name | Description / acceptance evidence | Why it is critical | Fallback option | Status | What is blocking | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | Security architecture and threat model | Trust boundaries, data flow, cloud/edge/device components, privileged services, attack assumptions, controls, and residual risks. | Validates the HAL bridge design and every adapter trust decision. | Veryloving can create its own threat model, but vendor components remain unassessed without architecture disclosure. | BLOCKED — EXTERNAL | Vendor security design is not available. | Manufacturer security architect. | 3–7 days joint review. |
| SEC-002 | Credential provisioning, storage, rotation, and revocation | Per-tenant/per-device issuance, scopes, secret/certificate storage, expiry, rotation overlap, compromise response, and test credentials. | Required for `initialize`, signed action delivery, callbacks, pairing, reset, and privacy operations. | A Veryloving secret manager protects our side only; vendor issuance and revocation remain mandatory. | BLOCKED — EXTERNAL | No credential lifecycle or credentials have been supplied. | Manufacturer IAM/security operations. | 2–5 days integration; rotation drill additional. |
| SEC-003 | Transport-security profile | Minimum TLS, cipher policy, certificate chain/pinning, mTLS, DNS, redirect behavior, proxy support, and certificate renewal. | Protects all REST, webhook, and streaming calls from interception or credential forwarding. | A private tunnel can add defense in depth; it cannot legitimize an unsupported insecure device endpoint. | BLOCKED — EXTERNAL | Vendor transport profile and endpoints are unknown. | Manufacturer infrastructure/security team. | 2–4 days plus certificate-expiry test. |
| SEC-004 | Command signing and replay protection | Canonical payload, signature/MAC algorithm, key distribution, clock tolerance, nonce/action ID, expiry, binding generation, and replay cache. | Needed for trustworthy `deliverSignedAction`, reset fencing, and stale-owner protection. | A Veryloving edge APK can verify `vl-robot-action/2`; downstream privileged execution still requires a supported vendor HAL. | BLOCKED — EXTERNAL | Vendor device/SDK verification capability is unconfirmed. | Manufacturer firmware/SDK security lead. | 5–10 days and adversarial tests. |
| SEC-005 | Tenant, account, and device authorization model | Ownership, roles, service accounts, least privilege, cross-tenant boundaries, support access, and auditability. | Prevents one user, vendor operator, or compromised token from controlling another user's robot. | Veryloving account fencing remains necessary but cannot govern vendor-cloud operator access. | BLOCKED — EXTERNAL | Vendor authorization model is undisclosed. | Manufacturer IAM/product security owner. | 3–5 days review and negative testing. |
| SEC-006 | Device platform hardening | Secure boot, verified boot, SELinux, disk encryption, hardware-backed keys, debug/ADB policy, root status, port exposure, app sandboxing, and kiosk controls. | Particularly critical for a Jiangzhi Android edge service and for physical tamper resistance. | Place a restricted gateway beside the robot; this does not cure an exposed/rooted robot platform. | BLOCKED — EXTERNAL | Exact platform and hardening evidence are unavailable. | Manufacturer BSP/platform security lead. | 5–10 days review; physical penetration testing separate. |
| SEC-007 | Audit-log contract and redaction policy | Event types, actor/device identifiers, timestamps, integrity, access control, retention, export, and explicit PII/secret redaction rules. | Supports incident response while preserving the HAL's no-PII logging boundary. | Veryloving logs its own bridge events; vendor-side actions remain unverifiable without vendor audit logs. | BLOCKED — EXTERNAL | Vendor audit capability and retention are unknown. | Manufacturer security operations/privacy lead. | 2–4 days integration/review. |
| SEC-008 | Vulnerability and incident-response program | SBOM, dependency/CVE process, penetration reports, disclosure channel, severity SLA, breach notification, and incident contacts. | Required for production risk acceptance and ongoing patch response. | Commission an independent assessment, but vendor remediation commitment is still required. | BLOCKED — EXTERNAL | No security assurance package has been shared. | Manufacturer CISO/security owner; Grace/procurement add contract terms. | 5–10 days review; remediation timing vendor-dependent. |
| SEC-009 | Data processing, residency, and subprocessors | DPA, data categories, regions, cross-border transfers, subprocessors, encryption, backups, retention, deletion, and model-training restrictions. | Robot audio/video, location, elder profile, and medical data may be highly sensitive. | Route only minimum approved data through a Veryloving-controlled region; vendor device/cloud processing still needs legal approval. | BLOCKED — EXTERNAL | Contractual privacy and hosting information is unavailable. | Manufacturer privacy/legal owner and Veryloving counsel. | 5–10 days review; negotiation may take longer. |
| SEC-010 | Network allowlist and callback verification package | Source IP/range policy, DNS ownership, webhook keys/certificates, rotation, retry, replay, and challenge/verification flow. | Secures asynchronous ACK and telemetry ingress. | Pull-based polling avoids inbound callbacks only if the vendor provides a durable authenticated status API. | BLOCKED — EXTERNAL | Callback endpoints and authenticators are undisclosed. | Manufacturer cloud/security lead. | 2–5 days implementation and negative tests. |
| SEC-011 | Factory-reset and secure-erasure proof | Exact data erased locally/cloud-side, cryptographic erase behavior, reset authorization, completion receipt, interruption recovery, and audit evidence. | Required by the reset saga and account deletion; a 202 acceptance is insufficient. | Physically retire/quarantine a pilot device after manual verified reset; not a production fleet solution. | BLOCKED — EXTERNAL | Vendor erasure behavior is unverified. | Manufacturer device-lifecycle/security lead. | 3–7 days plus physical interruption testing. |

## Hardware

| ID | Requirement name | Description / acceptance evidence | Why it is critical | Fallback option | Status | What is blocking | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| HW-001 | Exact SKU, BOM, processor, memory, and platform sheet | Contracted model/options, BOM revision, SoC/architecture, RAM/storage, OS/API level, kernel/BSP, bootloader, firmware, and lifecycle dates. | Determines deployability of the Yongyida bridge or Jiangzhi Android edge APK and binds test results to one product. | None for production; public marketing sheets are insufficient. | BLOCKED — EXTERNAL | Exact partner SKU and technical datasheet are not supplied. | Manufacturer hardware/product manager. | 1–3 days review after receipt. |
| HW-002 | Electrical specifications and power architecture | Input/output voltage/current, charger/dock, battery chemistry/capacity, runtime test method, grounding, protection, UPS behavior, and certifications. | Supports safe home deployment, charging status, outage behavior, and accessory design. | Use only manufacturer-provided power equipment during supervised tests. | BLOCKED — EXTERNAL | Detailed electrical data and reports are unavailable. | Manufacturer electrical engineer/compliance owner. | 2–4 days review; lab validation separate. |
| HW-003 | Connectors, pinouts, and expansion interfaces | USB/USB-C, serial/UART/RS-232/RS-485, GPIO, Ethernet, audio, display, accessory buses, pinouts, voltage levels, drivers, and hot-plug rules. | Required for Jiangzhi medical peripherals and any local edge/diagnostic integration. | Network-only bridge if it exposes every required capability; otherwise no safe workaround. | BLOCKED — EXTERNAL | Public materials do not provide usable interface contracts. | Manufacturer hardware/BSP lead. | 3–7 days and bench validation. |
| HW-004 | Network and radio specification | Wi-Fi bands/standards/security, Bluetooth/BLE version/profiles, Ethernet, cellular/eSIM, antennas, roaming, provisioning, captive portal, and offline mode. | Defines installation, reachability, status detection, and resilience under home-network failures. | Supply a managed external router for a pilot, subject to RF and site approval. | BLOCKED — EXTERNAL | Exact radio modules and provisioning flows are unknown. | Manufacturer connectivity/BSP lead. | 2–5 days plus site tests. |
| HW-005 | Sensor and actuator inventory | Model, placement, field of view/range, sampling rate, driver/interface, calibration, accuracy, failure modes, and health diagnostics for cameras, radar, ultrasonic, IMU, collision sensors, microphones, speakers, motors, and buttons. | Gates fall monitoring, navigation, safety checks, alarms, audio, and telemetry claims. | Disable unsupported features; do not infer a capability from a generic sensor name. | BLOCKED — EXTERNAL | Exact sensor BOM and interfaces are not disclosed. | Manufacturer robotics/hardware lead. | 5–10 days review and lab characterization. |
| HW-006 | Motion, navigation, and functional-safety package | Speed/force limits, braking, obstacle/cliff detection, emergency stop, safe state, hazards, standards, risk analysis, and test reports. | Required before executing navigation or safety-critical commands around elderly users. | Operate stationary or in a cordoned supervised area; no unsupervised deployment. | BLOCKED — EXTERNAL | Safety architecture and evidence are absent. | Manufacturer safety/compliance owner; independent lab as required. | 5–10 days document review; certification/tests longer. |
| HW-007 | Audio, camera, and privacy controls | Resolution/codecs, microphones, echo cancellation, speaker output, physical indicators/shutters, recording controls, consent UX, local processing, and API access. | Supports voice calls, soothing audio, alarm output, perception, and privacy design. | Disable camera/recording and expose only verified audio playback during early testing. | BLOCKED — EXTERNAL | Device-level media APIs and privacy controls are unknown. | Manufacturer multimedia/BSP and privacy leads. | 3–7 days plus acoustic/privacy tests. |
| HW-008 | Environmental and mechanical specification | Dimensions, weight, center of gravity, payload, operating/storage temperature/humidity, ingress protection, floor/slope/threshold limits, noise, and service clearances. | Defines safe homes/facilities and onsite acceptance criteria. | Restrict pilot site conditions to vendor-approved limits once supplied. | BLOCKED — EXTERNAL | Full mechanical/environmental specification is unavailable. | Manufacturer mechanical/product engineer. | 2–4 days review; site survey separate. |
| HW-009 | Diagnostics, service, and calibration tools | Supported logs, self-tests, health endpoints, service application, diagnostic cable, calibration procedure, error codes, field-replaceable units, and support workflow. | Required to debug status/telemetry failures and maintain a fleet without unsafe ADB/root access. | Vendor technician onsite for a small pilot; not scalable production operations. | BLOCKED — EXTERNAL | No engineering/service package has been supplied. | Manufacturer field-service/BSP lead. | 3–7 days tool onboarding. |
| HW-010 | Engineering sample units and accessories | Two units of each shortlisted exact SKU, latest approved firmware, docks, power supplies, cables, diagnostic accessories, spares, shipping terms, and return/RMA process. | Required to verify all adapter methods, process death, network split, latency, reset, OTA, and long soak behavior. | One unit can start exploratory work, but two are needed for update/recovery and reproducibility. | BLOCKED — EXTERNAL | No physical units are available to the Shenzhen team. | Grace/procurement and manufacturer logistics; Shenzhen engineer receives them. | 1 day setup, then 2–4 weeks validation. |
| HW-011 | White-label and configuration controls | Logo/enclosure, boot screen, launcher/kiosk, wake word, voice assets, app signing, certificates, factory provisioning, SKU minimums, and update persistence. | Determines whether `setConfig` can safely configure branding and whether customization survives OTA/reset. | Keep manufacturer branding for an engineering pilot; production white-labeling remains blocked. | BLOCKED — EXTERNAL | Configuration surface, firmware impact, and commercial terms are unknown. | Manufacturer ODM/product lead and Grace. | 3–7 engineering days after assets/access; manufacturing lead time separate. |

## Medical sensors — Jiangzhi only

These requirements apply only if Veryloving selects a Jiangzhi SKU or accessory set that claims integration with medical instruments. Marketing claims and the public USB-serial expression example are not substitutes for a medical-device protocol or clinical validation.

| ID | Requirement name | Description / acceptance evidence | Why it is critical | Fallback option | Status | What is blocking | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MED-001 | Supported instrument and SKU catalogue | Manufacturer/model/revision of each ECG, blood-pressure, blood-glucose, SpO2, temperature, rehabilitation, or other instrument; approved robot/firmware combinations. | Defines whether `streamVitals` and `getTelemetrySnapshot` can lawfully and technically expose a measurement. | Treat measurements as unsupported and omit them from the product. | BLOCKED — EXTERNAL | Exact instruments and compatibility list are unavailable. | Jiangzhi medical-product lead. | 2–4 days review. |
| MED-002 | Physical and transport protocol | USB/serial/Bluetooth profile, VID/PID, baud/parity, framing, discovery, pairing, driver, permissions, reconnect, and error recovery. | Required for an Android edge service to acquire sensor data reliably. | Use an instrument's independently supported cloud API only with regulatory/privacy approval; do not reverse-engineer production protocols. | BLOCKED — EXTERNAL | No supported integration protocol has been supplied. | Jiangzhi BSP/peripheral engineer and instrument OEM. | 5–10 days per protocol. |
| MED-003 | Message schema and data dictionary | Versioned frames/JSON, checksums, field names, units, precision, reference ranges, device/patient IDs, quality flags, errors, and sample captures. | Required to create valid `VitalSign` objects without unsafe interpretation. | Preserve raw values outside clinical UI for engineering only; no user-visible reading until mapped and reviewed. | BLOCKED — EXTERNAL | Data format and semantic dictionary are missing. | Jiangzhi medical software lead and instrument OEM. | 3–7 days per instrument plus clinical review. |
| MED-004 | Calibration, accuracy, and quality-control procedure | Calibration interval/method, accuracy and repeatability reports, invalid-reading detection, consumables, control solution, environmental limits, and maintenance records. | Determines whether a reading can be trusted and how `quality` should be assigned. | Label the feature unavailable; generic warning copy is not a substitute for accuracy evidence. | BLOCKED — EXTERNAL | Calibration and performance evidence are unavailable. | Instrument OEM quality owner and Jiangzhi medical lead. | 5–10 days review; independent validation longer. |
| MED-005 | Certification and intended-use package | Regulatory certificates and scope, market/jurisdiction, intended use, contraindications, labeling, software/accessory inclusion, expiry, notified test body, and change-control impact. | Prevents Veryloving from making an unsupported medical claim or combining products outside certification scope. | Position the robot as nonmedical wellness/communication only and remove medical claims/features, subject to legal review. | BLOCKED — EXTERNAL | Certification scope has not been supplied or verified. | Jiangzhi regulatory lead, instrument OEM, and Veryloving counsel. | 1–3 weeks document/regulatory review. |
| MED-006 | Alarm and threshold semantics | Source of thresholds, configurable range, clinical ownership, severity, hysteresis, acknowledgement, escalation, false readings, and emergency disclaimer. | Governs safety escalation from vitals without letting AI invent clinical decisions. | Do not generate clinical alarms; display a verified measurement for human review only if permitted. | BLOCKED — EXTERNAL | No approved alarm logic or responsibility model exists. | Jiangzhi clinical/regulatory lead and Veryloving clinical owner. | 5–10 days policy/integration review. |
| MED-007 | Patient identity and measurement attribution | Supported identity proof, caregiver-assisted flow, session start/end, multi-resident isolation, misattribution prevention, and correction audit. | Ensures vitals are attached to the correct account and preserves account-bound data isolation. | Restrict one supervised robot session to one known test participant; no production fallback. | BLOCKED — EXTERNAL | Vendor patient-binding workflow is unknown. | Jiangzhi application lead and Veryloving privacy/clinical owners. | 3–7 days plus usability tests. |
| MED-008 | Medical-data security and privacy | On-device encryption, transmission, cloud storage, access, consent, retention, deletion, audit logs, secondary use, and breach handling for health data. | Gates collection and processing of medical telemetry. | Process no medical data until an approved DPA, threat model, and retention policy exist. | BLOCKED — EXTERNAL | No health-data processing contract or architecture is available. | Jiangzhi privacy/security leads and Veryloving counsel/security. | 1–3 weeks review and remediation planning. |
| MED-009 | De-identified fixtures and simulator | Vendor/OEM-approved normal, abnormal, boundary, malformed, disconnect, low-battery, calibration-due, and device-error samples without patient data. | Enables deterministic `streamVitals` parsing, retries, and fault tests before human use. | Synthetic data tests parser mechanics only and cannot establish real compatibility. | BLOCKED — EXTERNAL | No approved test corpus or instrument simulator exists. | Jiangzhi QA and instrument OEM. | 3–7 days to integrate fixtures. |
| MED-010 | Clinical and usability validation protocol | Approved test population/environment, reference instrument comparison, acceptance thresholds, human factors, elderly accessibility, adverse-event handling, and sign-off owners. | Required before Product 2 presents or escalates medical readings in real care. | Remove the medical feature from pilot scope. | BLOCKED — EXTERNAL | No joint validation protocol or authorized hardware is available. | Jiangzhi regulatory/clinical leads, Veryloving clinical owner, and test site. | 4–12 weeks after hardware/protocol readiness. |
| MED-011 | Medical component lifecycle and traceability | Lot/serial tracking, consumables, calibration history, recalls, field safety notices, firmware changes, RMA, and supported lifetime. | Supports auditability, safe replacement, and response to instrument defects. | Maintain manual records for an engineering evaluation only; not sufficient for a production fleet. | BLOCKED — EXTERNAL | Lifecycle/traceability system and obligations are undisclosed. | Jiangzhi quality owner and instrument OEM. | 1–2 weeks integration/process design. |

## Intake procedure when a package arrives

1. Store materials in the approved access-controlled repository; do not commit credentials, licensed SDK binaries, personal data, or NDA-restricted documents to this repository.
2. Record manufacturer, exact SKU/BOM, document title, version, issue date, checksum, license, and owner.
3. Assign each applicable row to security, backend, mobile, hardware, privacy, clinical/regulatory, or legal review.
4. Convert documentation examples into redacted contract fixtures and negative tests.
5. Exercise the package first in the vendor sandbox, then on exact engineering units.
6. Mark a row `PASS` only with a linked review/test artifact. Verbal assurances do not change status.
7. Keep production feature gates disabled until every applicable critical row passes and the release owner signs the final conformance record.

<!-- END:manufacturer-api-requirements -->

<!-- BEGIN:external-dependencies-dashboard -->
<a id="external-dependencies-dashboard"></a>
## Appendix — External Dependencies Dashboard

Last reviewed: 22 July 2026

Branch scope: `features/dual-product-draft`

## Quick Status

**Total External Dependencies:** 13

**✅ PASS (Completed):** 2/13

**BLOCKED — EXTERNAL:** 11/13

**First Unblocking Milestone:** ✅ PASS — Grace confirms the mutual NDAs with Yongyida and Jiangzhi are signed.

**Next Unblocking Milestone:** Grace sends the [Technical Package Request](#ask-templates) to both manufacturers immediately; record the send date in the private tracker.

The 13-row total covers only actions outside this repository. Internal software/document deliverables are tracked separately below and are not included in the denominator.

## Internal deliverables checklist

| Deliverable | Evidence | Status |
| --- | --- | --- |
| Hardware partner decision matrix | [Hardware Partner Decision Matrix](#hardware-partner-decision-matrix) | PASS |
| Manufacturer API requirements checklist | [Manufacturer API Requirements](#manufacturer-api-requirements) | PASS |
| Configurable manufacturer mock simulator | [`server/mocks/ManufacturerMockServer.ts`](../server/mocks/ManufacturerMockServer.ts) | PASS |
| External dependencies dashboard | [External Dependencies Dashboard](#external-dependencies-dashboard) | PASS |
| Three-scenario integration timeline | [Integration Timeline](#integration-timeline) | PASS |
| Copy-ready ask templates | [Ask Templates](#ask-templates) | PASS |

`PASS` in this internal table means the repository artifact exists and is reviewable. It does not validate a manufacturer API, production credential, medical claim, or physical robot.

## External dependency register

| ID | Category | Item | Owner | Deadline | Status | Dependencies | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| EXT-001 | Legal | Signed mutual NDA — Yongyida | Grace | Completed | ✅ PASS | None — executed | Grace confirms the mutual NDA is signed. Agreement contents and legal-record locations are intentionally not recorded in source control. |
| EXT-002 | Legal | Signed mutual NDA — Jiangzhi | Grace | Completed | ✅ PASS | None — executed | Grace confirms the mutual NDA is signed. Agreement contents and legal-record locations are intentionally not recorded in source control. |
| EXT-003 | Vendor Docs | Yongyida API/SDK technical package | Yongyida API lead | TBD | BLOCKED — EXTERNAL | EXT-001 (PASS) | Send the technical-package request today. Need versioned API/SDK, auth, commands, telemetry, ACK, error, rate-limit, reset/privacy, SLA, and lifecycle documents. |
| EXT-004 | Vendor Access | Yongyida sandbox credentials and SDK artifacts | Yongyida platform operations | TBD | BLOCKED — EXTERNAL | EXT-001 (PASS), EXT-003 | Need isolated tenant, sample device identity, downloadable artifacts, checksums, and support contact. |
| EXT-005 | Vendor Docs | Jiangzhi source repository access and license | Jiangzhi product/legal leads | TBD | BLOCKED — EXTERNAL | EXT-002 (PASS) | Send the technical-package request today. Need exact repository/revision, build instructions, dependency notices, modification/distribution rights, and support terms. |
| EXT-006 | Vendor Access | Jiangzhi Android HAL/BSP/OTA engineering package | Jiangzhi BSP/platform lead | TBD | BLOCKED — EXTERNAL | EXT-002 (PASS), EXT-005 | Need exact SKU/OS/BSP, supported privileged APIs, signing/deployment route, OTA and diagnostics—not production ADB. |
| EXT-007 | Vendor Docs | Jiangzhi medical sensor protocol and certification package | Jiangzhi medical/regulatory lead | TBD | BLOCKED — EXTERNAL | EXT-002 (PASS) | Include this in today's Jiangzhi technical-package request. Need supported instruments, protocols, schemas, calibration, accuracy, intended use, certificates, and lifecycle. |
| EXT-008 | Hardware | Physical Y120 engineering unit in Shenzhen | Grace / Shenzhen engineer | TBD | BLOCKED — EXTERNAL | Manufacturer shipment; preferably EXT-003 | One exact unit unblocks initial testing; two are requested for recovery/update and reproducibility work. |
| EXT-009 | Hardware | Physical Jiangzhi engineering unit in Shenzhen | Grace / Shenzhen engineer | TBD | BLOCKED — EXTERNAL | Manufacturer shipment; preferably EXT-005–EXT-007 | One exact unit unblocks initial testing; two plus scoped medical peripherals are requested for full validation. |
| EXT-010 | Credentials | Apple Developer production access and APNs setup | SV Lead | TBD | BLOCKED — EXTERNAL | Grace approval; Apple organization access | Need least-privilege team role, production push configuration, and secret-manager injection. |
| EXT-011 | Credentials | Google Play Console production access and FCM setup | SV Lead | TBD | BLOCKED — EXTERNAL | Grace approval; Google organization access | Need least-privilege service account/project access and production push configuration. |
| EXT-012 | Credentials | Twilio production SMS/Voice access | SV Lead | TBD | BLOCKED — EXTERNAL | Grace approval; billing/compliance setup | Need scoped credentials, approved sender/caller identities, regional/compliance settings, and test numbers. |
| EXT-013 | Credentials | Hume EVI enterprise production access | SV Lead | TBD | BLOCKED — EXTERNAL | Grace approval; Hume enterprise tenant | Need production-scoped key, concurrency/rate limits, data-handling terms, and escalation contact. |

## Unblocking actions and implementation effort

| ID | What is blocking | Exact unblocking action | Who can unblock | Estimated effort after unblocking | Evidence required before `PASS` |
| --- | --- | --- | --- | --- | --- |
| Details for EXT-001 | Nothing — Grace confirms the Yongyida NDA is signed. | Completed. Retain the effective copy through the approved legal-record process and use the technical-package request template today. | Completed by Grace, Veryloving counsel, and the Yongyida authorized signatory. | No remaining NDA effort; allow up to 0.5 day for engineering intake when the package arrives. | ✅ PASS recorded from Grace's confirmation immediately; record the send date in the private tracker; keep the agreement and its private record reference outside source control. |
| Details for EXT-002 | Nothing — Grace confirms the Jiangzhi NDA is signed. | Completed. Retain the effective copy through the approved legal-record process and use the technical-package request template today. | Completed by Grace, Veryloving counsel, and the Jiangzhi authorized signatory. | No remaining NDA effort; allow up to 0.5 day for engineering intake when the package arrives. | ✅ PASS recorded from Grace's confirmation immediately; record the send date in the private tracker; keep the agreement and its private record reference outside source control. |
| Details for EXT-003 | Public information does not contain a production-callable Yongyida contract. | Yongyida supplies the applicable artifacts in the [manufacturer API checklist](#manufacturer-api-requirements), tied to the exact Y120/elder-care SKU and firmware. | Yongyida API/product/security leads; Grace escalates commercially. | 3–7 engineering days for review, mapping, fixtures, and first conformance run. | Versioned documents pass applicable checklist rows; open questions have named owners/dates. |
| Details for EXT-004 | No authorized endpoint, tenant, credentials, or downloadable SDK exists for Veryloving. | Yongyida provisions a resettable sandbox, sample identities, least-privilege credentials through an approved secret channel, versioned SDK binaries/source as licensed, and an engineering support route. | Yongyida platform operations and developer-support owner. | 2–5 days for configuration and automated sandbox tests. | Successful authentication, command, telemetry, ACK, retry, reset, and revocation exercises. |
| Details for EXT-005 | Jiangzhi source availability, revision, and legal rights are unconfirmed. | Jiangzhi grants named users read access to the exact repository/release and supplies a signed license covering use, modification, binary distribution, maintenance, third-party obligations, and termination. | Jiangzhi product/legal/IP owners; Grace and Veryloving counsel approve. | 5–10 engineering days for build/review; legal negotiation excluded. | Reproducible build, dependency/license inventory, supported branch, and written rights. |
| Details for EXT-006 | Exact Android platform, supported HAL, signing, deployment, diagnostics, and OTA controls are unknown. | Jiangzhi provides the exact SKU/BOM/OS/BSP matrix, supported SDK/HAL, sample APK/service, test signing route, non-ADB deployment procedure, OTA/recovery runbook, and named BSP engineer. | Jiangzhi BSP/platform/security leads. | 1–3 weeks for edge-service port, signing, device conformance, and recovery tests. | Veryloving edge service installs through the supported path and passes command, telemetry, reboot, update, and rollback tests. |
| Details for EXT-007 | Public product claims lack sensor protocols, calibration evidence, and verified certification scope. | Jiangzhi and each instrument OEM supply the medical artifacts listed in MED-001 through MED-011, then Veryloving legal/clinical/security owners review them. | Jiangzhi medical/regulatory lead, instrument OEMs, Veryloving clinical/legal/security owners. | 2–6 engineering weeks per initial sensor family; clinical/regulatory validation may take longer. | Exact device certificates, approved schema/parser tests, calibration evidence, privacy approval, and clinical sign-off. |
| Details for EXT-008 | No exact Y120 engineering unit is available in Shenzhen. | Grace/procurement requests two matching units with frozen BOM/firmware, accessories, diagnostics, shipping/RMA terms, and assigns the Shenzhen receiver and bench window. Receipt of the first complete exact unit clears this dependency for initial testing. | Grace/procurement, Yongyida logistics, and Shenzhen engineer. | 2–4 weeks for first full hardware validation after receipt; setup about 1 day. | Asset/BOM record, intake photos/checksums, network setup, and intake test report for at least one exact unit; record the second-unit delivery separately. |
| Details for EXT-009 | No exact Jiangzhi engineering unit/peripherals are available in Shenzhen. | Request two matching units plus all scoped medical devices/consumables, accessories, diagnostics, frozen images, shipping/RMA terms, and assign the Shenzhen receiver. Receipt of the first complete exact unit clears this dependency for initial testing. | Grace/procurement, Jiangzhi logistics, and Shenzhen engineer. | 3–6 weeks after receipt; medical validation may extend this. | Asset/BOM record and intake report for at least one exact unit with scoped peripherals; record the second-unit delivery and full validation separately. |
| Details for EXT-010 | Veryloving lacks authorized production Apple/APNs access. | SV Lead creates/assigns least-privilege Apple team access, configures the production app identifier and APNs key, and injects the secret into the deployment secret manager without exposing it to clients. | SV Lead and Apple organization Account Holder/Admin. | 1–2 days for configuration and production-device push verification. | Successful APNs delivery/rotation test; no key value in email, chat, docs, source, or `EXPO_PUBLIC_*`. |
| Details for EXT-011 | Veryloving lacks authorized production Google/FCM access. | SV Lead configures the production Firebase/Google Cloud project, creates a least-privilege service identity, and injects it through the deployment secret manager. | SV Lead and Google project/Play Console owner. | 1–2 days for configuration and production-device push verification. | Successful FCM delivery/revocation test; credential stays server-side and out of source/docs/chat. |
| Details for EXT-012 | No approved production Twilio account, identities, or scoped credential is available. | SV Lead completes billing/compliance, provisions approved numbers/senders, creates a least-privilege production credential, and injects it through the deployment secret manager. | SV Lead and Twilio account owner/compliance administrator. | 2–5 days for SMS/voice delivery, failure, callback, and rotation tests; carrier approval excluded. | Successful target-market test with redacted logs, spend limits, callback verification, and rotation runbook. |
| Details for EXT-013 | No Hume enterprise production tenant/key or quota contract is available. | SV Lead obtains the enterprise key and data terms, confirms concurrency/rate limits and regions, then injects the key through the deployment secret manager. | SV Lead and Hume enterprise account owner. | 1–3 days for gateway, load, reconnect, and revocation tests. | Successful authenticated EVI sessions under target load, documented limits/data terms, and key rotation test. |

## Priority and critical path

1. **COMPLETE — EXT-001 and EXT-002:** Grace confirms both mutual NDAs are signed. Do not store the agreements in source control.
2. **P0 — EXT-003 through EXT-007:** Grace sends the technical-package request to both manufacturers immediately; record the send date in the private tracker. Request documents, sandboxes, source access, and medical evidence in parallel.
3. **P0 — EXT-008 and EXT-009:** reserve and ship exact hardware while package review begins; do not wait for adapter translation to finish.
4. **P1 — EXT-010 through EXT-013:** begin account and compliance provisioning early, but keep production secrets out of the mock-development critical path.

The shortest production critical path is:

```text
NDA (PASS) → technical package/access → exact hardware → adapter conformance → physical safety/security/soak validation → pilot approval
```

## Status change rule

An owner may change a row from `BLOCKED — EXTERNAL` to `PASS` only when its “Evidence required before PASS” condition is met. “Requested,” “promised,” “received but unread,” and “works against the mock” are not `PASS`. Record dates and links in the team’s access-controlled tracker; do not add credentials or NDA-restricted content to this public-facing repository document.

<!-- END:external-dependencies-dashboard -->

<!-- BEGIN:integration-timeline -->
<a id="integration-timeline"></a>
## Appendix — Integration Timeline

Last reviewed: 22 July 2026

Planning origin: `Day 0` is the date Grace authorized manufacturer outreach. The NDA phase is now complete; record the date both technical-package requests are sent as the active schedule rebaseline.

## Current phase status

| Phase | Current status | Evidence or external blocker | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- |
| 1. NDA Signed | ✅ PASS | Grace confirms the mutual NDAs with Yongyida and Jiangzhi are signed. Agreement contents are intentionally absent from source control. | Complete. | No remaining NDA effort. |
| 2. Technical Package Received | BLOCKED — EXTERNAL | No production API/SDK/source/HAL/medical protocol package has been supplied. Grace can send both [technical-package requests](#ask-templates) immediately; record the send date in the private tracker. | Grace sends the requests; Yongyida and Jiangzhi technical/legal owners provide access. | 3–10 engineering days for initial review, depending on package completeness. |
| 3. Adapter Implementation | PASS | Vendor-neutral HAL, provisional Yongyida/Jiangzhi adapters, immutable per-device routing, signed actions, queues, ACK handling, reset, and privacy lifecycles exist. | Not applicable for the completed provisional layer. Real vendor translation still depends on Phase 2. | 3–10 days per vendor to replace provisional mappings after a complete contract arrives. |
| 4. Mock Testing | PASS | Deterministic adapter and manufacturer-bridge tests exist; the configurable mock exercises the provisional contract without real credentials. | Not applicable for software-mock scope. | Vendor conformance fixtures will require 2–5 days after Phase 2. |
| 5. Physical Hardware Received | BLOCKED — EXTERNAL | Exact-SKU engineering units, accessories, and frozen firmware are not in Shenzhen. | Grace/procurement, manufacturer logistics, and Shenzhen engineer. | About 1 day intake/setup after delivery. |
| 6. Real-World Testing | BLOCKED — EXTERNAL | Requires complete vendor contracts and exact physical units; no real manufacturer latency, safety, sensor, reset, OTA, or soak evidence exists. | Manufacturer engineering leads, Shenzhen engineer, and Veryloving safety/security owners. | 2–6 weeks; medical validation may take longer. |
| 7. Pilot Launch | BLOCKED — EXTERNAL | Requires Phases 1–6, production credentials, privacy/security approval, site approval, support runbooks, and release sign-off. | Grace, SV Lead, vendor, pilot-site owner, and Veryloving release/safety/privacy owners. | 1–3 weeks for controlled pilot preparation after every gate passes. |

`✅ PASS` for Phase 1 reflects Grace's confirmation that both NDAs are signed. `PASS` for Phases 3 and 4 is limited to the vendor-independent/provisional software scope; it does not mean a real Yongyida or Jiangzhi protocol has been implemented or validated.

## Requested scenario targets

The values supplied for planning are preserved below. They are target markers, not guaranteed delivery dates.

| Phase | Best Case (All Docs Ready) | Realistic (Delayed Docs) | Worst Case (No Docs) |
| --- | --- | --- | --- |
| **1. NDA Signed** | Day 0 | Day 7 | Day 30 |
| **2. Technical Package Received** | Day 3 | Day 14 | Day 60 |
| **3. Adapter Implementation** | Day 5 | Day 7 | Day 14 |
| **4. Mock Testing** | Day 7 | Day 10 | Day 14 |
| **5. Physical Hardware Received** | Day 10 | Day 21 | Day 90 |
| **6. Real-World Testing** | Day 14 | Day 28 | Day 100 |
| **7. Pilot Launch** | Day 21 | Day 42 | Day 120 |

The realistic and worst-case columns mix absolute milestones with work-duration assumptions: for example, an adapter cannot finish on absolute Day 7 if its technical package arrives on Day 14. The executable schedule below normalizes those values so dependencies remain ordered.

## Dependency-consistent cumulative schedule

| Phase | Entry dependency | Best-case cumulative completion | Realistic cumulative completion | Worst-case treatment |
| --- | --- | --- | --- | --- |
| **1. NDA Signed** | Outreach authorization and legal counterpart | Day 0 | Day 7 | Day 30 |
| **2. Technical Package Received** | Phase 1 | Day 3 | Day 14 | Day 60 decision gate. If still absent, the production path remains blocked. |
| **3. Real vendor translation/conformance** | Complete Phase 2 artifacts; provisional HAL is already `PASS` | Day 5 | Day 21 (7 days after package) | Day 74 only if a minimum approved contract arrives on Day 60; otherwise no date. |
| **4. Vendor-fixture/mock conformance** | Phase 3; generic mock testing is already `PASS` | Day 7 | Day 24 | Day 88 only on the late-contract recovery path; otherwise generic mocks cannot unblock production. |
| **5. Physical Hardware Received** | Purchase/shipment can run in parallel after commercial approval | Day 10 | Day 21 | Day 90 target; receiving hardware alone does not replace missing docs. |
| **6. Real-World Testing Complete** | Phases 3–5 and approved test plan | Day 14 | Day 28 earliest functional gate; Day 35 recommended for a complete first cycle | Day 100 only on the late-contract recovery path; impossible while documents remain absent. |
| **7. Pilot Launch** | Phase 6, production credentials, privacy/security/safety/site approvals | Day 21 earliest controlled pilot | Day 42 | Day 120 is a go/no-go or pivot checkpoint. If no approved interface exists, the decision must be `NO-GO`, not launch. |

### How to read the worst case

“No Docs” is not an engineering implementation strategy. The Day 60, Day 90, Day 100, and Day 120 markers are escalation and decision checkpoints. A conditional recovery schedule is shown only to make the cost of a Day 60 package visible. If no minimally sufficient, contractually supported interface arrives, adapter conformance, real-world integration, and pilot launch have no defensible completion date.

## Scenario assumptions

### Best case — all documents ready

- Mutual NDA language is pre-agreed and executes on Day 0.
- A complete, internally consistent technical package and sandbox arrive by Day 3.
- Exact hardware has already been reserved and ships in parallel.
- The vendor interface closely matches the provisional HAL, with no firmware change required.
- Production account/credential requests and pilot-site preparation run in parallel.
- Day 21 is an earliest tightly controlled pilot target, not general availability.

### Realistic — delayed documents

- NDA negotiation consumes the first week.
- Documentation arrives by Day 14 but needs clarification.
- Seven engineering days are allowed for real adapter translation and initial conformance.
- Hardware arrives on Day 21, permitting parallel bench setup and final vendor-fixture tests.
- Day 28 is the earliest functional checkpoint; a complete first test cycle may extend to Day 35.
- Day 42 assumes critical findings are resolved without vendor firmware redesign.

### Worst case — no usable documents

- NDA or disclosure slips to Day 30 and no sufficient contract is available at the Day 60 gate.
- Hardware may arrive by Day 90 but remains an unsupported black box; production reverse engineering is not authorized.
- The team continues only vendor-independent tests, procurement evaluation, and mock-contract work.
- Day 120 is a manufacturer replacement, bridge-scope reduction, or product-scope decision—not a launch promise.
- If a minimum approved contract arrives exactly on Day 60, the conditional recovery targets are Days 74, 88, 100, and 120 as shown above.

## Critical path and parallel work

```text
NDA (PASS)
  → versioned technical package + access rights
  → real adapter translation and vendor conformance
  → exact hardware validation
  → safety/security/privacy/OTA/soak acceptance
  → controlled pilot approval
```

The following work can run in parallel without vendor credentials:

- `PASS` — vendor-neutral HAL, dual-vendor routing, signed envelopes, queues, ACK, reset, privacy, and mock transport behavior;
- `PASS` — requirements checklist, decision framework, external tracker, timeline, and request templates;
- `PASS` — deterministic provisional-contract adapter and integration tests;
- `BLOCKED — EXTERNAL` — vendor fixtures, exact command/telemetry mapping, sandbox conformance, and physical validation;
- `BLOCKED — EXTERNAL` — Apple/APNs, Google/FCM, Twilio, and Hume production provisioning.

## Phase gates

| Gate | Acceptance condition | Current result |
| --- | --- | --- |
| Legal disclosure gate | Executed NDA for each manufacturer; request named technical disclosure contacts with the packages. | ✅ PASS — Grace confirms both NDAs are signed. |
| Package completeness gate | Every applicable critical row in [Manufacturer API Requirements](#manufacturer-api-requirements) has review evidence. | BLOCKED — EXTERNAL |
| Adapter conformance gate | Real vendor sandbox passes auth, commands, signed action, telemetry, ACK, idempotency, timeout, replay, reset, and deletion cases. | BLOCKED — EXTERNAL |
| Hardware intake gate | Two exact units recorded with matching BOM/firmware, accessories, diagnostics, and RMA path. | BLOCKED — EXTERNAL |
| Physical acceptance gate | Safety, network split, process death, reboot, OTA/rollback, reset, performance, and extended soak reports pass. | BLOCKED — EXTERNAL |
| Production-service gate | APNs, FCM, Twilio, Hume, cloud/IAM, monitoring, incident, privacy, and support controls pass staging. | BLOCKED — EXTERNAL |
| Pilot release gate | All prior gates pass and named product, safety, privacy, security, vendor, and site owners sign off. | BLOCKED — EXTERNAL |

## Timeline controls

- Review this document and the [external dependencies dashboard](#external-dependencies-dashboard) twice weekly while any P0 row is blocked.
- Rebaseline dates when a required artifact misses its checkpoint by more than two business days.
- Do not compress physical safety, security, privacy, OTA/recovery, or soak acceptance to preserve a launch date.
- Do not mark a phase `PASS` based on a promise, marketing page, mock response, or hardware demo that is not tied to the contracted SKU and firmware.

<!-- END:integration-timeline -->

<!-- BEGIN:ask-templates -->
<a id="ask-templates"></a>
## Appendix — Ask Templates

Last reviewed: 22 July 2026

Deliverable status: **PASS**

These templates are ready to copy. Replace every `[bracketed placeholder]` before sending and remove any optional text that does not apply.

## Secure handling rules

- Never ask anyone to email, chat, paste into a ticket/document, or commit an API key, token, password, private certificate, service-account JSON, `.env` file, source archive, or patient data.
- Credentials must be created with least privilege and injected directly into the approved deployment secret manager. Email should contain only the secret's approved name/reference, environment, owner, expiry/rotation date, and confirmation that access was granted.
- Do not use `EXPO_PUBLIC_*` for server credentials. Do not put real values in `.env.example`, source control, logs, screenshots, or this document.
- NDA-restricted documents and licensed source must use the approved access-controlled repository, with named users, expiry, audit logging, and license metadata.
- Engineering samples and technical packages must identify the exact SKU, BOM, OS/BSP, firmware, document version, and issue date.

Sending a request does not change a dependency to `PASS`. It remains `BLOCKED — EXTERNAL` until the acceptance evidence in the [external dependencies dashboard](#external-dependencies-dashboard) is complete.

## 1. NDA request to manufacturer

Status of template: **PASS**

Dependency after sending: **BLOCKED — EXTERNAL** until both parties execute the NDA.

```text
Subject: Request for Mutual NDA and Technical Collaboration — Veryloving.ai

Dear [Manufacturer Contact Name],

Veryloving.ai is developing an AI-driven elderly-care platform and is interested in partnering with [Manufacturer Name] for our home companion robot product line.

We would like to sign a mutual NDA to discuss:

- technical integration, including APIs, SDKs, supported source access, authentication, telemetry, and device lifecycle;
- hardware and software customization for our AI orchestration layer;
- security, privacy, firmware/OTA, support, and product-lifecycle requirements; and
- potential joint B2B pilots in senior-living facilities.

Please share your mutual NDA template or introduce the appropriate legal contact. Our legal entity is [Veryloving Legal Entity], incorporated in [Jurisdiction], with notice address [Legal Address]. Our legal contact is [Name, Title, Email].

Once the NDA is effective, please also identify your technical integration owner and the secure access-controlled channel you use for confidential documents and licensed artifacts. Please do not send credentials, private keys, source archives, or sensitive technical materials by ordinary email.

We would appreciate your proposed next step by [Requested Reply Date].

Best,
Grace
[Title]
[Company]
[Phone]
```

### Yongyida-specific optional paragraph

Insert after the first paragraph:

```text
Our evaluation covers the exact Y120 or recommended elder-care SKU, its current cloud/API and open-SDK capabilities, and the firmware/BOM configuration you would support for a Veryloving pilot.
```

### Jiangzhi-specific optional paragraph

Insert after the first paragraph:

```text
Our evaluation covers the exact Jiangzhi Android robot SKU, the supported source/SDK/HAL and JZKH integration route, medical-instrument interfaces in scope, and the firmware/BOM configuration you would support for a Veryloving pilot. The NDA should permit review by our legal, security, engineering, privacy, and clinical/regulatory reviewers.
```

### Before sending

- Confirm the counterparty's complete registered legal name and authorized signatory.
- Ask counsel to review confidentiality duration, residuals, reverse engineering, IP ownership, source access, export controls, security disclosures, medical documentation, and return/destruction terms.
- Send separate manufacturer threads; do not expose one manufacturer's information to the other.

## 2. Technical package request

Status of template: **PASS**

Dependency after sending: **BLOCKED — EXTERNAL** until the complete package and working access pass intake.

```text
Subject: Request for Product 2 Technical Integration Package — [Manufacturer / Exact Robot SKU]

Dear [Manufacturer Technical Contact Name],

Following execution of our mutual NDA dated [Effective Date], Veryloving.ai is ready to begin technical integration for [Exact Robot SKU, BOM Revision, OS/BSP, Firmware Version].

Please provide the following versioned materials:

1. OpenAPI/Swagger specification, or the complete supported SDK/API reference, for robot control;
2. authentication, authorization, credential issuance/rotation/revocation, TLS or mTLS, and request-signing requirements;
3. command catalogue and semantics, including medication reminders, fall/safety events, alarms, emergency stop, audio, two-way calls, status, configuration, and unsupported-capability behavior;
4. telemetry schemas and protocols for status, battery, health metrics, fall alerts, medication acknowledgements, location, indoor positioning, and navigation paths;
5. synchronous response and asynchronous acknowledgement/webhook contracts, correlation, idempotency, timeout, retry, duplicate, and replay rules;
6. rate limits, quotas, error codes, SLA commitments, maintenance windows, regional endpoints, data residency, and support escalation;
7. pairing, ownership transfer, factory reset, privacy export/deletion, and secure-erasure contracts;
8. firmware/OTA versioning, signed-update chain, compatibility, rollback/recovery, patch cadence, and support/EOL policy;
9. exact hardware/BOM, processor, memory, OS/BSP, radio, sensor, connector/pinout, electrical/power, safety, diagnostic, and service specifications;
10. security architecture, threat model, SBOM, platform hardening, audit logging, vulnerability/incident process, penetration evidence, and data-processing/subprocessor details;
11. a resettable sandbox or engineering tenant, sample device identities, golden request/response/telemetry fixtures, malformed/failure fixtures, and a Postman collection or sample application;
12. applicable SDK/source licenses, third-party notices, modification/distribution/deployment rights, checksums, build instructions, changelog, and supported release branch; and
13. named API, firmware/BSP, security, QA, support, and commercial contacts.

For Jiangzhi, please additionally provide:

14. access to the supported Android source/SDK/HAL and JZKH integration components, including repository/revision, reproducible build instructions, app-signing/deployment route, privileged-service contract, diagnostics, OTA ownership, and license terms;
15. the exact supported medical instrument catalogue and, for each instrument, transport protocol, data schema, units/ranges/quality flags, calibration and accuracy evidence, intended use, regulatory certificates, patient-attribution flow, privacy controls, test fixtures, and lifecycle/recall process.

For Yongyida, please additionally confirm:

16. whether the supported integration is cloud API, local SDK/API, or both; identify the downloadable open-SDK artifact; and distinguish the Y120 guide-robot capabilities from the exact elder-care SKU and options proposed for this project.

Our detailed acceptance checklist is available as [Secure Checklist Link or Attached Nonconfidential Checklist]. Please map each supplied artifact to the relevant checklist ID and identify any unavailable or roadmap-only item explicitly.

Please grant named-user access to [Approved Access-Controlled Repository / Vendor Portal] for:

- [Veryloving Engineering Reviewer Name / Email]
- [Veryloving Security Reviewer Name / Email]
- [Veryloving Legal or Privacy Reviewer Name / Email]
- [Veryloving Clinical/Regulatory Reviewer, if applicable]

Please do not send API keys, private keys, passwords, service-account files, source archives, production data, or patient information by email. Provision sandbox credentials through [Approved Secret Manager / Secure Credential Exchange] and reply only with the approved secret reference, scope, owner, expiry, and access confirmation.

We aim to complete initial package review within [X] business days and first conformance testing within [Y] business days of receiving a complete package and working sandbox access. Please propose a 60-minute technical kickoff during [Time Windows and Time Zone].

Best,
Grace
[Title]
[Company]
[Phone]
```

### Package receipt acknowledgement

Use this short reply after access is granted:

```text
Subject: Re: Product 2 Technical Integration Package — Receipt and Intake

Dear [Contact Name],

Thank you. We confirm access to [Portal/Repository Name] as of [Date and Time Zone]. We have recorded the package as [Package Name, Version, Issue Date, Exact SKU/Firmware]. This confirms receipt only; our technical, security, privacy, legal, and, where applicable, clinical/regulatory review is now beginning.

Our consolidated questions and checklist status will be returned by [Date]. Please keep [Named Engineering Contact] available for interface and test-environment questions.

No credentials or sensitive artifacts are reproduced in this email.

Best,
Grace
```

## 3. Hardware request

Status of template: **PASS**

Dependency after sending: **BLOCKED — EXTERNAL** until exact units are received, inventoried, and pass intake.

```text
Subject: Request for Product 2 Engineering Sample Units — [Manufacturer / Exact SKU]

Dear [Manufacturer Contact Name],

Veryloving.ai is ready to begin physical integration and validation. Please quote and arrange shipment of:

- 2 × [Y120 / Exact Jiangzhi Robot Model], fully functional and identical in SKU/BOM, with [Exact OS/BSP and Firmware Version];
- 2 × charging docks/power supplies and all region-appropriate power accessories;
- required cables, network/provisioning accessories, service adapters, and manufacturer-supported Wi-Fi/Bluetooth diagnostic tools;
- the supported diagnostic/service application and non-production engineering access procedure;
- spare field-replaceable accessories recommended for a [6]-week validation; and
- for Jiangzhi, each medical instrument, interface adapter, consumable, control/calibration accessory, and driver included in the proposed Product 2 scope.

Please include with the shipment:

1. packing list, exact model, serials, BOM revision, OS/BSP, firmware, and accessory versions;
2. electrical/power and safe-handling instructions;
3. setup, network provisioning, factory reset, recovery, RMA, and support procedures;
4. applicable safety/compliance documentation and battery shipping declarations;
5. license terms for any diagnostic software; and
6. a named engineering support contact for intake.

Destination:
[Shenzhen Engineering Team Legal Name]
[Full Address]
[District, Shenzhen, Guangdong, Postal Code, China]

Receiver: [Engineer Name]
Mobile: [Engineer Phone]
Email: [Engineer Email]
Receiving hours: [Days/Hours and Time Zone]
Customs/import reference: [If Applicable]

Please provide the commercial invoice, Incoterm, shipping cost, lead time, tracking, insurance, unit loan/purchase status, expected return date if loaned, and RMA/return instructions before dispatch. Do not ship until we confirm the receiver and address in writing.

Please do not place production credentials, reusable default passwords, private signing keys, or patient data in the package. Deliver any per-device engineering bootstrap secret through [Approved Secure Credential Channel], separately from the shipment, with expiry and revocation instructions.

We will inventory the units on arrival and report shipping damage or configuration mismatch within [X] business days. We will return loan units according to the agreed terms after testing.

Best,
Grace
[Title]
[Company]
[Phone]
```

### Manufacturer-specific configuration line

- **Yongyida:** Ask the vendor to state whether the shipment is the public Y120 guide SKU or a distinct elder-care configuration, and list every option affecting navigation, video/intercom, SOS, SDK, cloud, charging, or sensors.
- **Jiangzhi:** Ask for the exact Android/Windows/Linux selection, SoC, Android API/security-patch level, signing/deployment arrangement, medical compartment/peripherals, and the supported edge-service/HAL path.

## 4. Production credential provisioning request to SV Lead

Status of template: **PASS**

Dependency after sending: **BLOCKED — EXTERNAL** until each production service passes provisioning and rotation tests.

```text
Subject: Production Account and Secret Provisioning Request — Veryloving.ai Product 2

Dear [SV Lead Name],

Please provision the following production access for the Veryloving.ai backend under the company-owned organizations/projects:

1. Apple Developer / APNs
   - least-privilege team access for [Named Operators];
   - production app identifier and push-notification entitlement;
   - a production APNs signing key owned by the organization;
   - documented key ID, team ID, owner, creation date, rotation date, and revocation runbook.

2. Google Play Console / Firebase Cloud Messaging
   - least-privilege Play Console and Google Cloud/Firebase roles for [Named Operators];
   - production Android application/project registration;
   - a server-side, least-privilege FCM service identity;
   - documented project/application IDs, owner, creation date, rotation/revocation runbook, and quota.

3. Twilio SMS and Voice
   - production subaccount or project with spend/rate limits;
   - approved sender/caller identities and required target-market compliance registration;
   - least-privilege API credential and verified callback-signing configuration;
   - documented account/subaccount identifiers, owner, rotation/revocation runbook, and emergency escalation contact.

4. Hume AI Enterprise EVI
   - production enterprise project and server-side key;
   - confirmed concurrency/rate limits, regions, data retention/training terms, SLA, and support contact;
   - documented project identifier, owner, creation date, rotation/revocation runbook, and quota alerting.

5. Cloud provider
   - separate staging and production accounts/projects as applicable;
   - least-privilege workload IAM roles for DynamoDB, S3, SNS, Lambda, logging/metrics, and the deployment platform;
   - KMS/secret-manager access, audit logging, budget/quota alarms, break-glass ownership, and rotation/revocation runbooks.

Security and delivery requirements:

- Create separate staging and production credentials; do not reuse secrets across services, adapters, callbacks, or environments.
- Inject secret values directly into [Approved Deployment Secret Manager] as server-side runtime variables. Do not send values or credential files by email, Slack/Teams, ticket, shared document, or source control.
- Never expose these credentials through `EXPO_PUBLIC_*`, client bundles, `.env.example`, logs, screenshots, or build artifacts.
- Grant only named operators and runtime identities; enable MFA and audit logging for human access.
- Apply expiry/rotation dates, quota/spend alerts, and tested revocation procedures.

Please reply with a provisioning checklist containing only non-secret metadata:

- service and environment;
- approved secret/reference name (not its value);
- owning organization/project/subaccount identifier;
- owner and authorized operators;
- scope/roles;
- creation and rotation dates;
- quota/spend limits; and
- confirmation that the deployment runtime can read the secret.

Please target completion by [Requested Date]. Once provisioned, engineering will run staging delivery, failure, callback-verification, rotation, and revocation tests before any production enablement.

Best,
Grace
[Title]
[Company]
[Phone]
```

## 5. Follow-up when an external deadline slips

Status of template: **PASS**

```text
Subject: Follow-up: [Dependency Name] Required for Product 2 Critical Path

Dear [Owner Name],

I am following up on [exact requested artifact/access/unit], requested on [Date]. It currently blocks [specific phase or test] and remains BLOCKED — EXTERNAL in our Product 2 dependency register.

To clear the dependency, we need:

- [exact artifact/action 1];
- [exact artifact/action 2]; and
- [acceptance evidence or access test].

Requested completion: [Date and Time Zone]
Current owner: [Name/Role]
Veryloving reviewer ready to receive it: [Name/Role]

If the requested date is not feasible, please reply by [Earlier Date] with a committed delivery date, the remaining blocker, and the escalation owner. Please do not include secret values or restricted artifacts in email; use [Approved Secure Channel].

Best,
Grace
```

## Send log fields

Track these fields in the team's access-controlled work tracker, not in this repository:

| Field | Required value |
| --- | --- |
| Dependency ID | `EXT-001` through `EXT-013` |
| Request sent | Date/time/time zone |
| Sender and recipient | Named people and organizations |
| Requested deliverable | Exact artifact/access/unit and version/SKU |
| Requested reply/delivery date | Date/time/time zone |
| Secure channel | Portal/repository/secret-manager name only; no secret values |
| Current status | `BLOCKED — EXTERNAL` or `PASS` |
| Acceptance evidence | Link to approved review/test record |
| Next action and owner | One concrete action and named role/person |

<!-- END:ask-templates -->

<!-- BEGIN:robot-hal-architecture -->
<a id="robot-hal-architecture"></a>
## Appendix — Robot HAL Architecture

Status: prototype contract and production-oriented design
Last reviewed: 22 July 2026

## 1. Scope and evidence boundary

This document describes the Veryloving-owned hardware abstraction layer (HAL) for Product 2. It lets one orchestration service address Yongyida and Jiangzhi robots without putting vendor-specific payloads, credentials, or device identities into Hume tool calls or the mobile client.

The boundary is deliberate:

- `RobotAdapter`, `vl-robot-action/2`, `vl-robot-reset/1`, `veryloving.robot-bridge.v1`, `VL_*`, `vl.edge.*`, and every `/v1/veryloving/...` path in this repository are **Veryloving provisional contracts**.
- They are not published Yongyida or Jiangzhi APIs, SDK methods, command names, or compatibility promises.
- Public evidence supports a Yongyida open-SDK claim and a plausible Jiangzhi Android edge-app path, but no public API reference, authentication contract, telemetry schema, SDK artifact, or production SLA was found for either vendor.
- The prototype therefore terminates at a Veryloving-owned bridge. An approved vendor API/SDK/HAL must be implemented behind that bridge after partner documentation, credentials, licensing, and exact hardware are supplied.

The evidence and vendor comparison are maintained in [Hardware Partner Research](#hardware-partner-research). This architecture does not turn a marketing statement into a verified technical fact.

## 2. Design goals

The HAL is designed to provide:

1. One vendor-neutral command and telemetry model for the orchestration layer.
2. Simultaneous mixed-vendor operation, including multiple robots from either vendor.
3. Immutable account, robot, manufacturer-device, and adapter binding.
4. Signed, expiring, idempotent actions with durable asynchronous acknowledgement.
5. Per-device ordering without cross-device or cross-vendor head-of-line blocking.
6. Bounded time, retry, payload, pagination, queue, and memory behavior.
7. Fail-closed parsing and authentication, plus privacy-safe observability.
8. A replaceable bridge boundary for partner-only SDKs and protocols.

Non-goals for this prototype are:

- Claiming that either vendor already supports the provisional operations.
- Controlling a production Jiangzhi robot through ADB or UI automation.
- Treating HTTP acceptance as proof that a physical action occurred.
- Treating robot-attached health instruments as clinically validated integrations.
- Providing autonomous navigation or medical diagnosis without separate safety and regulatory approval.

## 3. System context

```mermaid
flowchart LR
    User[Authenticated mobile user] --> Voice[Hume EVI through authenticated voice gateway]
    Voice --> AG[Veryloving ActionGateway]
    Mobile[Veryloving mobile app] --> AG
    Mobile --> TAPI[Account-authorized telemetry API]
    AG --> Bind[(Account and robot binding)]
    AG --> Outbox[(Durable action outbox)]
    AG --> Registry[RobotAdapterRegistry]
    TAPI --> Bind
    TAPI --> Registry
    Registry --> YYD[YongyidaAdapter]
    Registry --> JZ[JiangzhiAdapter]
    YYD --> YBridge[Veryloving Yongyida cloud bridge]
    YBridge --> YVendor[Approved Yongyida partner API or SDK]
    JZ --> Edge[Veryloving Android Edge Bridge]
    Edge --> JHAL[Approved Jiangzhi HAL or peripheral SDK]
    YVendor --> Ack[Authenticated ACK ingress]
    JHAL --> Ack
    Ack --> AG
    YVendor --> YBridge
    JHAL --> Edge
```

This diagram shows the implemented provisional command/ACK and telemetry-polling boundaries. The mixed-vendor runtime implements signed command delivery, asynchronous ACK handling, and an account-authorized bounded snapshot covering status, battery, vitals, location, navigation, indoor position, safety events, and medication acknowledgements. A real vendor translation, authenticated vendor event/callback ingestion, medical provenance, retention/consent policy, and exact-hardware behavior remain target work until an approved partner contract is supplied and exercised.

The long-lived voice/action gateway is the trust boundary for device actions. The HTTP-only Vercel adapter must not be used for robot action delivery because it does not own the WebSocket session or the durable action lifecycle.

## 4. HAL contract

The source of truth is [`server/src/adapters/RobotAdapter.ts`](../server/src/adapters/RobotAdapter.ts). The interface is server-side TypeScript; mobile code never receives the manufacturer API key.

| Capability | HAL method | Result semantics |
| --- | --- | --- |
| Bind an adapter instance | `initialize(credentials)` | Authenticates and irreversibly binds the instance to one manufacturer device for its lifetime |
| Medication prompt | `sendMedicationReminder` | Returns accepted/completed/rejected command state |
| Fall/safety alert | `activateFallAlert` | Sends an alert operation; it does not claim that fall detection itself is validated |
| Vitals retrieval | `streamVitals` | Bounded async page iteration over allowlisted vital kinds |
| Area safety check | `executeSafetyCheck` | Returns bounded, normalized findings |
| Calming media | `playSoothingAudio` | Validates the audio identifier and 0–100 volume |
| Two-way call | `startTwoWayVoiceCall` | Returns accepted/ringing/connected/ended/failed state |
| Battery and status | `getBatteryStatus`, `getDeviceStatus` | Requires timestamps and bounded fields |
| Emergency actions | `emergencyStop`, `activateAlarm` | Uses the same authenticated, idempotent transport; the physical semantics need vendor conformance testing |
| Configuration | `setConfig` | Sends a bounded JSON configuration object |
| Orchestrated action | `deliverSignedAction` | Forwards the exact signed ActionGateway object without re-signing or reconstruction |

`CommandResult.state = accepted` means the bridge accepted a request. It does not mean the robot executed the physical behavior. Physical completion needs the authenticated asynchronous ACK or vendor-specific execution evidence.

### 4.1 Identity model

Four identifiers have different purposes and must not be collapsed:

| Identifier | Owner | Exposure | Purpose |
| --- | --- | --- | --- |
| `userId` | Veryloving identity system | Server only | Account isolation and authorization |
| `device_id` | Veryloving | App and server | Private logical robot ID shown to the user's account |
| `manufacturer_device_id` | Vendor/bridge | Server and bridge only | Routes to one physical robot; never accepted from the model or trusted from the app |
| `adapter_id` | Veryloving deployment | Server and signed envelope | Selects one immutable adapter configuration/contract boundary |

The DynamoDB robot binding resolves `(userId, device_id)` to `(manufacturer_device_id, adapter_id)`. The ActionGateway performs this resolution before signing. The app and Hume tool call cannot override either server-resolved value.

### 4.2 Adapter factory and registry

[`server/src/adapters/AdapterFactory.ts`](../server/src/adapters/AdapterFactory.ts) requires the vendor on each adapter configuration. There is intentionally no process-global `ROBOT_TYPE` switch.

Each `RobotAdapter` object instance:

- has an immutable `adapterId` and `vendor`;
- binds to exactly one `manufacturer_device_id` after `initialize()`;
- rejects initialization for a different device;
- joins an identical concurrent initialization attempt, rejects a conflicting one, and permits a clean retry after a failed attempt;
- owns its own network/retry state.

`RobotAdapterRegistry` is keyed by `adapterId`, rejects duplicates, and may hold Yongyida and Jiangzhi instances at the same time. It is useful when a process owns persistent one-robot adapter objects.

The long-lived gateway uses a related but distinct runtime pattern in [`server/robot-adapter-runtime.cjs`](../server/robot-adapter-runtime.cjs): its map is a registry of immutable **bridge configurations**, not connected physical-device objects. On each status/delivery operation it creates a short-lived adapter object, initializes that object to the account-resolved manufacturer device, performs the bounded operation, and discards it. This permits many physical robots to share one vendor bridge `adapter_id` without sharing mutable device/session state; concurrent operations receive separate adapter objects. A future connection-pooling implementation must retain the same per-device isolation.

The public HAL includes direct command-shaped methods for vendor conformance, but their provisional unsigned transport is disabled by default. The deployed runtime exposes side effects only through signed v2 actions; enabling `allowProvisionalUnsignedCommands` is limited to isolated tests/prototypes because it does not carry the production binding-generation proof.

Example topology:

```text
adapterId: yongyida-cloud -> immutable Yongyida bridge configuration
  account robot A -> short-lived YongyidaAdapter bound to manufacturer A
  account robot B -> separate YongyidaAdapter bound to manufacturer B

adapterId: jiangzhi-edge -> immutable Jiangzhi edge/relay configuration
  account robot C -> short-lived JiangzhiAdapter bound to manufacturer C
```

Changing a user's robot vendor means pairing or migrating that physical device to a binding with a different immutable `adapter_id`; it does not mean changing a global environment flag and silently rerouting every robot.

## 5. Command path

### 5.1 Hume/mobile to ActionGateway

1. Hume EVI emits a server-defined tool call, or the authenticated mobile app posts a device action.
2. The gateway validates the action/device-type combination and an action-specific parameter allowlist.
3. The authenticated user must own the requested logical robot and present the account-bound robot pairing credential for mobile REST actions.
4. The server resolves the authoritative manufacturer device and adapter binding.
5. The gateway confirms that the robot is online using session state and/or the configured status client.
6. It creates a bounded action with a short expiry and a stable action ID when an idempotency key is supplied.
7. It signs the envelope with the server-held Ed25519 private key.
8. The durable outbox records the exact signed object before asynchronous delivery begins.
9. The per-user/per-device/binding-epoch queue delivers the action through the bound adapter; every physical retry revalidates that exact active binding.

Wearable actions continue over the authenticated WSS voice channel. Robot actions use the robot adapter or the configured manufacturer webhook. A stalled BLE action, Yongyida request, or Jiangzhi request must not block a different device's queue.

### 5.2 Signed envelope

The canonical robot contract is `vl-robot-action/2` (wearable envelopes remain version 1):

```json
{
  "envelope": {
    "version": 2,
    "id": "<uuid>",
    "issued_at": 1770000000000,
    "expires_at": 1770000060000,
    "action": "medication_reminder",
    "device_type": "home_robot",
    "adapter_id": "living-room-yyd",
    "contract_version": "vl-robot-action/2",
    "binding_epoch": 7,
    "device_id": "<private Veryloving ID>",
    "manufacturer_device_id": "<server-resolved vendor ID>",
    "parameters": {
      "reminder_id": "<opaque ID>",
      "medication_id": "<opaque ID>",
      "scheduled_at": 1770000000000
    }
  },
  "payload": "<base64url serialized envelope bytes>",
  "signature": "<base64url Ed25519 signature>",
  "algorithm": "Ed25519"
}
```

Security invariants:

- The adapter serializes the same `SignedRobotAction` object it received; it does not reconstruct the envelope or translate the signed action to `VL_*` or `vl.edge.*`.
- The receiving bridge must verify the signature over the ASCII `payload`, decode the payload, compare it with the envelope, enforce the supported version/contract, verify its own `adapter_id`, `manufacturer_device_id`, and positive `binding_epoch`, reject expired, implausibly future, reset, or superseded-generation actions, and durably claim `envelope.id` before physical effect.
- `envelope.id` is also the transport `Idempotency-Key` for signed delivery.
- A retry may repeat transport delivery but must never repeat a physical effect after the receiving bridge has claimed the ID.
- Signing proves Veryloving authorization; TLS and bridge authentication are still required for confidentiality and endpoint authentication.

The current signer uses JSON serialization of an insertion-ordered server-built object. A future cross-language contract should either preserve and verify the supplied `payload` exactly or adopt an explicitly versioned canonical JSON encoding. A bridge must not independently reserialize an object and assume the bytes are identical.

### 5.3 Queue, outbox, and ACK state machine

```mermaid
stateDiagram-v2
    [*] --> queued: validated, signed, durably enqueued
    queued --> delivering: device queue reaches action
    delivering --> delivering: retryable failure and unexpired
    delivering --> pending_ack: bridge returns HTTP 202
    delivering --> delivered: bridge returns strict HTTP 200 completion receipt
    delivering --> failed: retries exhausted or action expired
    pending_ack --> delivered: authenticated positive ACK
    pending_ack --> failed: negative ACK
    pending_ack --> failed: ACK timeout
```

Important semantics:

- HTTP `202 Accepted` is `pending_ack`, never `delivered`.
- A 202 bridge receipt must correlate the exact `action_id` and report `state: "accepted", ok: true`. A synchronous 200 receipt must correlate the same ID and report `state: "completed", ok: true`. A rejection uses a non-2xx response before acceptance or an authenticated negative asynchronous ACK; it must never be converted into an acknowledged/delivered success. Any contradictory receipt fails closed.
- The outbox supports restart recovery of queued, delivering, and pending-ACK work.
- Recovery rejects invalid records and marks expired actions failed rather than replaying them.
- A pending ACK retains the device queue barrier so commands for the same robot remain ordered. Other robots continue independently.
- Retry delay is exponential and bounded. The same action ID and signed object are used on every attempt.
- Retry exhaustion, negative ACK, or ACK timeout triggers the user-facing failure push path. A push failure is logged but cannot resurrect or mark the robot action delivered.
- A manufacturer ACK callback must be authenticated and bound to the action's `adapter_id` and `binding_epoch`; a vendor or stale binding must not acknowledge another action generation.

The durable outbox and adapter-bound ACK transition live in DynamoDB and can therefore survive process restart and accept an authenticated callback on a different gateway replica. Queue ownership is different: the live per-device scheduler and its ordering barrier are process-local. Production configuration consequently fails closed unless `ACTION_GATEWAY_SINGLE_REPLICA=true`, and exactly one long-lived ActionGateway replica may own delivery until distributed per-device leases are implemented. Durable cross-replica ACK recovery must not be described as a horizontally scalable distributed command queue.

## 6. Shared bridge transport

[`server/src/adapters/RestRobotAdapter.ts`](../server/src/adapters/RestRobotAdapter.ts) implements the hardened transport used by both vendor adapters.

Default bounds are:

| Control | Default | Allowed range/behavior |
| --- | --- | --- |
| Request timeout | 5 seconds | 1 ms–120 seconds |
| Attempts | 3 | 1–5 |
| Initial backoff | 100 ms | 0–30 seconds, with jitter |
| Maximum backoff | 2 seconds | 0–60 seconds |
| Request body | 64 KiB | Configurable to at most 1 MiB |
| Response body | 64 KiB | Streamed/bounded; configurable to at most 1 MiB |
| Vitals pages | 100 | At most 100 items per page; configured ceiling at most 1,000 pages |

Only `408`, `425`, `429`, and selected `5xx` statuses are retryable. Authentication failures, other client rejections, malformed JSON, schema-invalid responses, and oversized responses fail closed without blind retry. A timeout race remains bounded even if an injected `fetch` implementation ignores `AbortSignal`, and late response bodies are cancelled when possible.

Requests use:

- `Authorization: Bearer <server-only bridge key>`;
- `Idempotency-Key: <stable ID>`;
- `X-Veryloving-Adapter-Protocol: veryloving.robot-bridge.v1`;
- an optional short-lived `X-Veryloving-Session` returned by bridge initialization.

This is the authentication shape of the **provisional Veryloving bridge**, not evidence of either manufacturer's authentication method. Production should prefer device-bound mTLS plus a rotating application credential when the partner supports it.

## 7. Vendor adapter boundaries

### 7.1 Yongyida cloud path

[`server/src/adapters/YongyidaAdapter.ts`](../server/src/adapters/YongyidaAdapter.ts) calls a Veryloving-owned prefix:

```text
/v1/veryloving/yongyida-cloud/session
/v1/veryloving/yongyida-cloud/commands
/v1/veryloving/yongyida-cloud/signed-actions
/v1/veryloving/yongyida-cloud/telemetry/{battery,status}/query
/v1/veryloving/yongyida-cloud/telemetry/vitals/query
/v1/veryloving/yongyida-cloud/telemetry/snapshot/query
```

The `VL_SEND_MEDICATION_REMINDER`, `VL_ACTIVATE_FALL_ALERT`, `VL_EMERGENCY_STOP`, and related operation names are placeholders inside that bridge contract. The bridge must later map them to approved Yongyida partner calls and normalize vendor responses back to the HAL.

The public Y120 page supports navigation, remote monitoring, sensors, an SOS control, charging claims, and an open-SDK claim, but it does not publish the API/SDK or identify Y120 as the reported elder-care deployment model. See the [official Y120 page](https://www.yydrobo.com/show-458.html), [Yongyida research/developer-platform page](https://www.yydrobo.com/institute.html), and [Shenzhen government elder-care report](https://fgw.sz.gov.cn/ztzl/qtztzl/szscjmyjjfzzhfwpt/xwdt/content/post_12623414.html).

Production activation requires the exact elder-care SKU, API/SDK artifact, authentication and callback contract, sandbox, data-processing terms, and hardware conformance results.

### 7.2 Jiangzhi Android edge path

[`server/src/adapters/JiangzhiAdapter.ts`](../server/src/adapters/JiangzhiAdapter.ts) calls a Veryloving-managed Android edge service using:

```text
/v1/veryloving/jiangzhi-edge/session
/v1/veryloving/jiangzhi-edge/commands
/v1/veryloving/jiangzhi-edge/signed-actions
/v1/veryloving/jiangzhi-edge/telemetry/{battery,status}/query
/v1/veryloving/jiangzhi-edge/telemetry/vitals/query
/v1/veryloving/jiangzhi-edge/telemetry/snapshot/query
```

`vl.edge.medication.remind`, `vl.edge.motion.emergency_stop`, and the other `vl.edge.*` names are provisional Veryloving operations. They are not JZKH1.0 methods.

The production edge bridge should be a signed, kiosk-managed Android application or privileged service with these layers:

1. **Network ingress:** TLS, preferably mTLS, bound to a provisioned robot identity. It accepts only the bounded Veryloving contract.
2. **Action verifier:** validates Ed25519 signatures, expiry, adapter/device target, supported contract version, and a durable replay ledger before dispatch.
3. **Policy/interlock:** applies local safety state, motion arbitration, volume limits, privacy state, and emergency-stop precedence.
4. **Vendor HAL boundary:** the only module that calls an approved Jiangzhi AAR/JAR/AIDL/Binder/serial/BLE API. No UI automation.
5. **Telemetry normalizer:** validates timestamps, units, quality, patient binding, and origin before exposing allowlisted events.
6. **Durable local queue:** survives app/process restart, deduplicates action IDs, records execution outcome, and retries the cloud ACK independently.
7. **OTA/operations:** signed application updates, rollback, health monitoring, bounded storage, key rotation, and auditable factory reset.

ADB may be used on isolated engineering units to install and inspect a development build. It must not be enabled as a production network control channel, authentication mechanism, or command transport. Production ADB should be disabled or physically/service restricted according to the agreed device-hardening profile.

Public material supports Android variants, APK-installation cooperation, and one USB-serial facial-expression module; it does not establish a robot-control HAL, JZKH API, source license, or medical-device protocol. See the [JZR580300 configuration](https://www.elecfans.com/d/6701065.html), [software cooperation terms](https://www.elecfans.com/d/3894397.html), [JZKH overview](https://m.elecfans.com/article/7729392.html), and [JZRF USB-serial example](https://m.elecfans.com/article/3378684.html).

## 8. Pairing and identity binding

The QR flow is a strict server-mediated ownership gate:

1. An authenticated user scans a manufacturer QR code in the Veryloving app.
2. The app sends the opaque code over TLS to `POST /v1/devices/home-robots/pair`; it does not parse a hardware serial into a trusted identity.
3. The backend hashes the adapter-scoped QR claim and derives a stable possession token with HMAC-SHA-256 over the authenticated account, adapter scope, and claim hash. `ROBOT_PAIRING_TOKEN_SECRET` is independent, server-only, and at least 32 characters.
4. Before contacting the manufacturer, the backend checks DynamoDB for a completed binding. The original account can resume an interrupted response and receive the same logical robot ID/token; a different account receives HTTP 410.
5. For a new claim, the backend derives a stable server-secret-bound verification ID, sends it as `Idempotency-Key` under `veryloving.robot-pairing-verify.v1`, and requires the bridge to persist/replay the correlated receipt if the response is lost.
6. Verification must echo that `claim_id` and return a one-time, unexpired claim, the opaque manufacturer device ID, and hardware serial; a different verification identity for the consumed QR is HTTP 410. The backend attaches the deployment-selected adapter ID from its immutable server configuration.
7. The backend hashes the hardware serial and possession token, creates a random logical robot ID, and uses one DynamoDB transaction to require the account deletion state be absent/active while recording `used_at`, `bound_to`, owner, adapter, manufacturer-device binding, lifecycle `active`, and a monotonically increasing positive binding epoch.
8. A cross-account or conflicting repeated claim is rejected with HTTP 410 and a redacted log entry.
9. The possession token is stored in account-scoped protected storage on the app and is required with the JWT for robot actions, telemetry, and reset. The raw token is not stored in DynamoDB.

Factory reset is a crash-resumable saga, not a raw manufacturer call followed by deletion. DynamoDB first moves the exact binding epoch out of `active`, gives the reset a stable idempotency ID, and schedules recovery. Every physical attempt receives a unique lease-generation token, and an unref'd recurring worker drains due/retried checkpoints rather than relying on one startup pass. ActionGateway durably fails pending work for that generation and drains bounded in-flight requests. The selected bridge must return HTTP 200 with the same reset ID/epoch and explicit `state: "completed", erased: true, fenced: true`; 202, 204, mismatch, or partial success is insufficient. Only then does DynamoDB atomically write a reset receipt and replace ownership with a data-minimized unbound epoch high-water tombstone. Re-pair increments the epoch, preventing delayed pre-reset envelopes from becoming valid again.

Bindings without a valid stored epoch/lifecycle are deliberately `migration_required`; command, status, reset, and re-pair paths fail closed rather than infer generation 1. Operators must drain the legacy outbox, deploy a bridge that enforces action v2/reset v1, and backfill or re-pair through an audited migration.

Modern reset and privacy operations keep `(adapter_id, manufacturer_device_id)` together. Reset routes only to the binding's adapter. Account export/deletion groups exact device IDs by adapter and calls each adapter's endpoint/key independently; a missing handler fails closed before local unbinding/deletion. Only historical `manufacturer-default` bindings use the shared legacy manufacturer client.

Account deletion persists its fence before any processor mutation. Outbox mutation/deletion uses strongly consistent base-table reads with verification rather than relying on an eventually consistent GSI. The canonical requesting session remains usable for an interrupted retry until a terminal transaction deletes the remaining sessions and changes `ACCOUNT#STATE` from `deleting` to `deleted`; the same marker participates in the pairing transaction so these lifecycles serialize.

## 9. Telemetry path

The production telemetry target follows a separate authenticated path from commands:

```text
robot/vendor event
  -> vendor cloud callback or Jiangzhi edge bridge
  -> timestamp, device, schema, signature/authentication checks
  -> vendor-to-HAL normalization
  -> bounded allowlisted status/event model
  -> account-authorized Veryloving API
  -> HomeRobotDevice/AppContext/map/safety workflows
```

The implemented mixed-vendor `RobotAdapterRuntime` calls `getTelemetrySnapshot()` through the account-resolved adapter and manufacturer-device binding. The strict provisional snapshot supports:

- status with a required authoritative timestamp and optional firmware version;
- battery plus at most 100 vital observations;
- one timestamped location, one timestamped path with at most 500 navigation
  points, and one indoor position;
- at most 20 safety events and 20 medication acknowledgements.

Missing, stale, future, contradictory, or invalid authoritative status—including a missing/non-Boolean `online` field—fails to offline/unknown and suppresses all sensor/event fields. Battery, vitals, location, navigation path, indoor position, safety events, and medication acknowledgements also have independent freshness checks; stale/future optional values are omitted. Medication acknowledgements have a 30-day maximum age. The provisional bridge must attest `location.captured_at`, `navigation_path.captured_at`, and `indoor_position.captured_at` separately; timestamp-less spatial data is rejected by the adapter and suppressed by the runtime's defensive boundary. The account-authorized API never accepts an adapter or manufacturer device ID from the app.

`HomeRobotDevice` consumes this snapshot, updates bounded location/path/battery state, and refuses malformed, oversized, stale, or regressive samples. Its independent deadline covers fetch and response-body parsing even if abort is ignored; it accepts only bounded UTF-8 text containing a JSON object and cancels a stalled body when possible. The current implementation is polling, not a deployed vendor event/callback ingestion service.

This proves a Veryloving-owned end-to-end **provisional contract path**, not real vendor data accessibility. Production still requires a documented vendor mapping, callback authentication/replay rules where events are enabled, telemetry provenance and quality semantics, retention/consent review, and exact-hardware conformance tests.

For medical data, every observation must include an exact instrument model/registration, patient binding, timestamp, unit, value range, quality/calibration state, and provenance. The public Jiangzhi material does not provide those protocols or metadata. Until they are contractually supplied and validated, the HAL vital types are a design target, not evidence of a medical-grade integration.

## 10. Security, privacy, and logging

Required controls include:

- API keys and Ed25519 private keys remain in the server secret manager; no `EXPO_PUBLIC_*` value is a secret.
- HTTPS is mandatory outside explicitly opted-in tests.
- The app uses its session JWT plus an account-bound possession token; the manufacturer uses a separate server-only key or stronger mutually authenticated transport.
- `ROBOT_PAIRING_TOKEN_SECRET` is a dedicated server-only HMAC key; it is not an action-signing, provider, or bridge credential and requires a controlled rotation/migration runbook.
- Every bridge must durably remember executed action IDs, reset IDs, and the revoked-through/newest-accepted binding epoch per physical robot. Veryloving's local checks cannot provide physical exactly-once or stale-generation rejection if the downstream bridge ignores these fields.
- Raw serials, manufacturer IDs, account IDs, medication details, network addresses, URLs, bodies, credentials, and raw exception messages do not enter adapter logs.
- [`StructuredAdapterLogger.ts`](../server/src/adapters/StructuredAdapterLogger.ts) builds events from an allowlist and replaces adapter IDs with a one-way short reference.
- Logging/metrics are best-effort: an observability failure cannot fail an emergency command.
- Vendor telemetry export, deletion, retention, residency, subprocessors, backups, and diagnostic logs require explicit contract coverage. Veryloving account deletion must not report success if manufacturer deletion is merely queued.

## 11. Failure behavior

| Failure | Required behavior |
| --- | --- |
| Bridge unreachable or timeout | Bounded retry using the same idempotency key; retain durable action; mark failed and notify after exhaustion |
| Authentication 401/403 | Fail immediately; do not retry credentials blindly; alert operations |
| HTTP 202 | Enter `pending_ack`; do not mark delivered |
| Negative or missing ACK | Mark failed, release the device queue, notify user |
| Malformed/oversized response | Fail closed without schema inference or retry storm |
| Process restart | Recover unexpired durable outbox entries and ACK deadlines; never replay expired actions |
| Duplicate action | Return/retain the existing action identity; receiver deduplicates before physical effect |
| Network split after physical effect | Retry may occur, so bridge replay ledger must return the original outcome without repeating the effect |
| Robot offline | Mobile marks robot offline and stores account-bound commands locally where policy permits; BLE wearable continues independently |
| Conflicting adapter initialization | Reject rather than rebind an adapter instance |
| Telemetry timestamp invalid/stale | Show offline/unknown and suppress untrusted state |

Emergency stop needs a separately reviewed local implementation. A cloud call alone cannot guarantee safe stopping during an internet outage, Android process death, or vendor-cloud failure.

## 12. Validation gates

Repository tests exercise adapter translation, authentication rejection, bounded retry, server and mobile timeout behavior (including stalled bodies and fetch implementations that ignore abort), malformed and oversized responses, semantic parser metrics, initialization races, mixed-vendor non-blocking behavior, signed-action targeting, and log redaction. Action-gateway and manufacturer integration tests cover queueing, durable recovery, early and cross-replica ACK races, expiry, asynchronous ACK, same-account interrupted-pairing recovery, cross-account QR replay rejection, push failure feedback, the bounded mixed-vendor snapshot path, per-field freshness suppression, mobile telemetry normalization, adapter-bound reset/privacy behavior, and strict erasure completion.

Those tests do not prove any real vendor robot behavior. Before production, both candidates must pass:

- partner API/SDK/HAL and license review;
- exact-SKU identity, OS/BSP, security patch, secure boot, OTA, rollback, and factory-reset review;
- signed-action and replay conformance at the receiving bridge;
- offline/local emergency behavior and physical interlock testing;
- command acceptance and physical-execution p50/p95/p99 measurement, including the stated p95 under 250 ms target where applicable;
- network split, duplicate, reordering, delayed ACK, process death, power loss, and key-rotation tests;
- telemetry provenance, clock, unit, quality, retention, consent, export, and deletion tests;
- accessibility and elder-care user testing;
- a minimum 72-hour hardware/bridge soak with bounded memory, socket, timer, queue, and storage growth;
- safety, privacy, cybersecurity, clinical, and regulatory review appropriate to the shipped claims.

No 24-hour/72-hour soak, real Yongyida/Jiangzhi command test, medical-instrument validation, or physical emergency-stop/fall-detection validation is claimed by this document.

## 13. Architecture decisions

| Decision | Reason |
| --- | --- |
| Explicit per-instance factory instead of `ROBOT_TYPE` | Supports mixed fleets and prevents a global switch from rerouting unrelated robots |
| Registry keyed by immutable adapter ID | Binds a signed action to one deployment target and supports multiple robots from one vendor |
| Veryloving bridge contract | Lets core orchestration remain stable while partner-only protocols are unavailable or change |
| Exact signed-action forwarding | Preserves signature, expiry, target, and idempotency semantics across the vendor boundary |
| Durable outbox plus asynchronous ACK | Separates request acceptance from verified execution and enables restart recovery |
| Per-device queues | Preserves ordering without cross-device head-of-line blocking in one active gateway process; distributed queue ownership requires per-device leases before active-active deployment |
| Android edge service, no production ADB | Provides a securable application boundary; ADB is not a safe runtime protocol |
| Fail-closed typed parsing | Prevents malformed vendor data from becoming safety or medical truth |
| Structured allowlisted logging | Provides latency/error observability without disclosing PII, device identity, or credentials |

## 14. Partner artifact package

The adapter stubs may be replaced only after the chosen manufacturer supplies:

1. The exact production SKU/BOM/OS/firmware and lifecycle commitment.
2. A versioned OpenAPI/Postman package or supported Android HAL artifact and sample app.
3. Authentication, device identity, key rotation, signing, ACK, idempotency, error, callback, and versioning rules.
4. A sandbox and at least two identical production-representative units.
5. Command and telemetry schemas for every enabled HAL capability.
6. Offline, process-restart, OTA, rollback, reset, and local emergency semantics.
7. Data residency, retention, export/deletion, subprocessor, audit, and DPA terms.
8. Medical instrument models, registrations, protocols, units, quality/calibration metadata, and regulatory boundary where applicable.
9. SDK/source/binary distribution rights, background-IP protection, maintenance, escrow, and termination terms.
10. Named engineering support, SLA, rate limits, release notes, deprecation policy, and incident process.

Until that gate is complete, `YongyidaAdapter` and `JiangzhiAdapter` are working protocol prototypes against mock/Veryloving endpoints, not production vendor integrations.

<!-- END:robot-hal-architecture -->

<!-- BEGIN:robot-adapter-integration-guide -->
<a id="robot-adapter-integration-guide"></a>
## Appendix — Robot Adapter Integration Guide

Last reviewed: 22 July 2026

This guide covers the Veryloving Product 2 prototype for Yongyida and Jiangzhi. The runnable endpoints are test/Veryloving bridge contracts. They are not official manufacturer endpoints and must not be pointed at guessed vendor URLs.

Read [Robot HAL Architecture](#robot-hal-architecture) for trust boundaries and [Hardware Partner Research](#hardware-partner-research) before enabling a vendor.

## 1. What is implemented

The repository contains:

- a vendor-neutral TypeScript interface in [`server/src/adapters/RobotAdapter.ts`](../server/src/adapters/RobotAdapter.ts);
- hardened REST bridge transport in [`server/src/adapters/RestRobotAdapter.ts`](../server/src/adapters/RestRobotAdapter.ts);
- provisional [`YongyidaAdapter`](../server/src/adapters/YongyidaAdapter.ts) and [`JiangzhiAdapter`](../server/src/adapters/JiangzhiAdapter.ts);
- an explicit per-instance factory and registry in [`AdapterFactory.ts`](../server/src/adapters/AdapterFactory.ts);
- a CommonJS runtime bridge in [`server/robot-adapter-runtime.cjs`](../server/robot-adapter-runtime.cjs) that loads compiled adapters into the existing gateway;
- mixed-vendor routing, signed actions, per-device queues, durable outbox recovery, and asynchronous ACK handling in [`server/action-gateway.cjs`](../server/action-gateway.cjs);
- QR ownership binding, one-time claim enforcement, and same-account interrupted-pairing recovery in [`server/robot-pairing.cjs`](../server/robot-pairing.cjs);
- an account-authorized, bounded telemetry snapshot path for status, battery, vitals, location, navigation path, indoor position, safety events, and medication acknowledgements;
- a test-only strict manufacturer bridge in [`tests/integration/manufacturer-mock-server.js`](../tests/integration/manufacturer-mock-server.js); and
- a loopback-only development simulator in [`server/mocks/ManufacturerMockServer.ts`](../server/mocks/ManufacturerMockServer.ts), exposing the generic assumed-manufacturer API and both provisional adapter contracts.

The final translation from the provisional bridge to a real Yongyida API or Jiangzhi SDK/HAL is not implemented because neither vendor has supplied a verified partner contract. Real hardware behavior, vendor latency, and medical data are unvalidated.

## 2. Prerequisites

- Node.js 24.18.0, matching `server/package.json` and the release policy.
- npm 12.0.1 with the committed lockfile.
- A DynamoDB table using string `PK` and `SK`, TTL, the action-outbox GSI, and the factory-reset recovery GSI described in the main README.
- An Ed25519 action-signing key pair held by the long-lived gateway.
- Separate server-only bridge and callback credentials for every enabled adapter.
- For production, HTTPS bridge and pairing-verification endpoints; HTTP is test/development only.
- A supported long-lived container host for the voice/action gateway. The HTTP-only Vercel function is not an action-delivery host.

Install from the repository root:

```bash
npm ci
```

Build the adapters before starting the backend:

```bash
npm run build:adapters
```

Compiled output is generated under `server/dist/adapters`. It is a build artifact and should be rebuilt from source, not hand-edited.

## 3. Server environment

Copy `server/.env.example` to an uncommitted runtime secret file or, preferably, set these in the deployment secret manager. Never put real values in `.env.example` or in an `EXPO_PUBLIC_*` variable.

### 3.1 Shared action and persistence settings

| Variable | Required use |
| --- | --- |
| `ACTION_SIGNING_PRIVATE_KEY` | Ed25519 PKCS8 private key, PEM or base64url DER; server only |
| `ACTION_SIGNING_PUBLIC_KEY` | Matching raw 32-byte Ed25519 public key in base64url |
| `DEVICE_TABLE_NAME` | Robot binding, outbox, push, and related account data table |
| `ACTION_OUTBOX_USER_INDEX_NAME` | GSI for restart recovery; partition `user_index_pk`, sort `user_index_sk` |
| `ROBOT_RESET_RECOVERY_INDEX_NAME` | GSI for reset recovery; partition `resetRecoveryPk` (String), sort `resetRecoveryAt` (Number) |
| `ROBOT_PAIRING_TOKEN_SECRET` | Independent HMAC secret, at least 32 characters, used to derive an account/scope/claim-bound possession token that can be reissued after an interrupted pairing response |
| `ACTION_GATEWAY_SINGLE_REPLICA` | Must be `true` for the current production gateway; acknowledges that per-device delivery ownership is process-local until distributed leases are implemented |
| `ROBOT_ACK_TIMEOUT_MS` | Maximum wait after a bridge returns 202; default 30000 |
| `ACTION_REQUEST_TIMEOUT_MS` | Shared legacy manufacturer/status/reset timeout; default 5000 |

Follow the main server environment documentation for authentication, Hume, push tokens, AWS region, and the wearable command mapping.

### 3.2 Yongyida bridge adapter

| Variable | Meaning |
| --- | --- |
| `YONGYIDA_ADAPTER_ENABLED` | `true` to register the adapter |
| `YONGYIDA_ADAPTER_ID` | Immutable deployment ID; default `yongyida-cloud` |
| `YONGYIDA_BRIDGE_URL` | HTTPS base URL of the Veryloving-owned Yongyida cloud bridge |
| `YONGYIDA_BRIDGE_API_KEY` | Server-to-bridge bearer credential |
| `YONGYIDA_CALLBACK_API_KEY` | Independent credential used by this adapter's ACK callback |
| `YONGYIDA_PAIRING_VERIFY_URL` | HTTPS endpoint that validates one-time Yongyida QR claims |
| `YONGYIDA_RESET_URL` | HTTPS endpoint that synchronously confirms reset and user-data erasure |
| `YONGYIDA_PRIVACY_EXPORT_URL` | HTTPS endpoint for Yongyida-bound account export |
| `YONGYIDA_PRIVACY_DELETE_URL` | HTTPS endpoint that synchronously confirms Yongyida-bound erasure |

### 3.3 Jiangzhi edge adapter

| Variable | Meaning |
| --- | --- |
| `JIANGZHI_ADAPTER_ENABLED` | `true` to register the adapter |
| `JIANGZHI_ADAPTER_ID` | Immutable deployment ID; default `jiangzhi-edge` |
| `JIANGZHI_BRIDGE_URL` | HTTPS-reachable Veryloving Android edge-bridge base URL or managed relay URL |
| `JIANGZHI_BRIDGE_API_KEY` | Server-to-edge bearer credential |
| `JIANGZHI_CALLBACK_API_KEY` | Independent credential used by this adapter's ACK callback |
| `JIANGZHI_PAIRING_VERIFY_URL` | HTTPS endpoint that validates one-time Jiangzhi QR claims |
| `JIANGZHI_RESET_URL` | HTTPS endpoint that synchronously confirms reset and user-data erasure |
| `JIANGZHI_PRIVACY_EXPORT_URL` | HTTPS endpoint for Jiangzhi-bound account export |
| `JIANGZHI_PRIVACY_DELETE_URL` | HTTPS endpoint that synchronously confirms Jiangzhi-bound erasure |

### 3.4 Shared adapter transport bounds

| Variable | Default | Constraint |
| --- | --- | --- |
| `ROBOT_ADAPTER_TIMEOUT_MS` | `5000` | Bounded adapter request timeout |
| `ROBOT_ADAPTER_MAX_ATTEMPTS` | `3` | Adapter accepts 1–5 attempts |
| `ROBOT_ADAPTER_RETRY_BASE_MS` | `100` | Initial exponential backoff |
| `ROBOT_ADAPTER_RETRY_MAX_MS` | `2000` | Maximum backoff |
| `ROBOT_ADAPTER_ALLOW_INSECURE_HTTP` | `false` | Test/development only; ignored in production |
| `MOCK_MANUFACTURER_URL` | unset | Development/test-only loopback origin overriding both bridge URLs |

Production adapter and callback keys are required by the runtime validator to be at least 32 characters. Every callback secret must differ from every outbound and callback secret across the enabled registry; startup fails closed on any collision. Length is only a minimum validation—use independently generated high-entropy secrets and rotate them through the secret manager.

### 3.5 Reset and privacy endpoints

Bindings created before the adapter rollout (`manufacturer-default`) continue to use the shared legacy control-plane variables:

```text
MANUFACTURER_RESET_URL
MANUFACTURER_PRIVACY_EXPORT_URL
MANUFACTURER_PRIVACY_DELETE_URL
MANUFACTURER_API_KEY
```

Modern bindings never use those shared endpoints. They route reset/export/deletion through the matching adapter's URLs and API key. If any adapter-specific handler is absent, the operation fails closed and the local binding/data is retained. Do not point a shared legacy URL/key directly at one vendor and assume modern bindings are covered.

### 3.6 Example with both adapters

The following contains placeholders only:

```dotenv
YONGYIDA_ADAPTER_ENABLED=true
YONGYIDA_ADAPTER_ID=yongyida-cloud
YONGYIDA_BRIDGE_URL=https://yongyida-bridge.example.invalid/
YONGYIDA_BRIDGE_API_KEY=<secret-manager-reference>
YONGYIDA_CALLBACK_API_KEY=<independent-secret-manager-reference>
YONGYIDA_PAIRING_VERIFY_URL=https://yongyida-bridge.example.invalid/v1/pairing/verify
YONGYIDA_RESET_URL=https://yongyida-bridge.example.invalid/v1/reset
YONGYIDA_PRIVACY_EXPORT_URL=https://yongyida-bridge.example.invalid/v1/privacy/export
YONGYIDA_PRIVACY_DELETE_URL=https://yongyida-bridge.example.invalid/v1/privacy/delete

JIANGZHI_ADAPTER_ENABLED=true
JIANGZHI_ADAPTER_ID=jiangzhi-edge
JIANGZHI_BRIDGE_URL=https://jiangzhi-edge-relay.example.invalid/
JIANGZHI_BRIDGE_API_KEY=<secret-manager-reference>
JIANGZHI_CALLBACK_API_KEY=<independent-secret-manager-reference>
JIANGZHI_PAIRING_VERIFY_URL=https://jiangzhi-edge-relay.example.invalid/v1/pairing/verify
JIANGZHI_RESET_URL=https://jiangzhi-edge-relay.example.invalid/v1/reset
JIANGZHI_PRIVACY_EXPORT_URL=https://jiangzhi-edge-relay.example.invalid/v1/privacy/export
JIANGZHI_PRIVACY_DELETE_URL=https://jiangzhi-edge-relay.example.invalid/v1/privacy/delete

ROBOT_ADAPTER_TIMEOUT_MS=5000
ROBOT_ADAPTER_MAX_ATTEMPTS=3
ROBOT_ADAPTER_RETRY_BASE_MS=100
ROBOT_ADAPTER_RETRY_MAX_MS=2000
ROBOT_ADAPTER_ALLOW_INSECURE_HTTP=false
ROBOT_PAIRING_TOKEN_SECRET=<independent-secret-manager-reference>
ACTION_GATEWAY_SINGLE_REPLICA=true
```

`.invalid` is intentional; replace it only with a controlled bridge that implements the documented provisional contract or a reviewed successor.

### 3.7 Local manufacturer simulator — PASS

The simulator is a development aid based on Veryloving-owned assumptions. It is not manufacturer documentation, a clinical-data source, a vendor conformance result, or a production service. It is omitted from the production adapter build and Docker image, binds to loopback by default, and refuses to start when `NODE_ENV=production`.

Build and start it in one terminal:

```bash
NODE_ENV=development \
MOCK_MANUFACTURER_FAILURE_RATE=0.05 \
npm run mock:manufacturer
```

Defaults are port `3001`, 50–200 ms deterministic seeded latency/failure selection, a 5% simulated failure rate, and 1 Hz telemetry. Set `MOCK_MANUFACTURER_FAILURE_RATE=0` for a deterministic happy-path manual run. Tests construct the simulator with failure injection disabled unless a test explicitly enables it. Optional controls are:

```text
MOCK_MANUFACTURER_PORT
MOCK_MANUFACTURER_LATENCY_MIN_MS
MOCK_MANUFACTURER_LATENCY_MAX_MS
MOCK_MANUFACTURER_FAILURE_RATE
MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS
MOCK_MANUFACTURER_SEED
MOCK_MANUFACTURER_API_KEY
MOCK_MANUFACTURER_MAX_REQUEST_BYTES
MOCK_MANUFACTURER_REQUEST_TIMEOUT_MS
MOCK_MANUFACTURER_MAX_QUEUE_KEYS
MOCK_MANUFACTURER_MAX_QUEUED_COMMANDS_TOTAL
MOCK_MANUFACTURER_MAX_CONNECTIONS
MOCK_MANUFACTURER_MAX_CONCURRENT_REQUESTS
MOCK_MANUFACTURER_MAX_TELEMETRY_STREAMS
MOCK_MANUFACTURER_FALL_EVENT_RATE
MOCK_MANUFACTURER_STRESS_EVENT_RATE
MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS
MOCK_MANUFACTURER_MAX_SIMULATED_DEVICES
```

`MOCK_MANUFACTURER_API_KEY` is simulator-only. If omitted, the documented placeholder `mock-server-only-api-key` is used. When the mock URL override is active, runtime configuration replaces both vendor outbound keys with this dedicated mock key, rejects any mock key equal to a configured vendor bridge key, and disables real pairing/reset/privacy URLs. This prevents mock-mode traffic or existing vendor credentials from reaching an external lifecycle endpoint.

The generic assumed-manufacturer surface is:

```text
POST /api/v1/authenticate
POST /api/v1/command
GET  /api/v1/status/{deviceId}
GET  /api/v1/telemetry/{deviceId}   # Server-Sent Events, one event/second
```

The same process implements the actual provisional paths used by the adapters under `/v1/veryloving/yongyida-cloud/*` and `/v1/veryloving/jiangzhi-edge/*`. The focused test therefore exercises each adapter over real loopback HTTP rather than replacing `fetch` with a stub.

To direct both enabled adapters to the simulator, set this server-only configuration in another terminal. Callback keys remain distinct because normal runtime credential-isolation checks still apply:

```bash
export NODE_ENV=development
export MOCK_MANUFACTURER_URL=http://127.0.0.1:3001/
export MOCK_MANUFACTURER_API_KEY=mock-server-only-api-key
export YONGYIDA_ADAPTER_ENABLED=true
export YONGYIDA_CALLBACK_API_KEY=mock-yongyida-callback-key
export JIANGZHI_ADAPTER_ENABLED=true
export JIANGZHI_CALLBACK_API_KEY=mock-jiangzhi-callback-key
```

`MOCK_MANUFACTURER_URL` accepts only a loopback origin with no path, query, fragment, or embedded credentials. It automatically permits local HTTP for that origin. Configuration loading rejects the override unless `NODE_ENV` is exactly `development` or `test`, and rejects it unconditionally under production configuration.

The provisional `signed-actions` routes fail closed with `503 SIGNING_KEY_NOT_CONFIGURED` unless `ACTION_SIGNING_PUBLIC_KEY` contains the matching Ed25519 public key. With the key configured, the simulator verifies the exact signed payload, rejects forged or expired envelopes, and permits only byte-equivalent retries for a previously accepted action ID.

Open `http://127.0.0.1:3001/dashboard` for the redacted dual-device state, scenario lifecycle records, and last ten events. The authenticated JSON projection is `GET /api/v1/simulation/dashboard`; wearable and robot SSE streams are exposed only on the documented loopback development surface. Camera commands accept only an opaque `session_id` and return a correlated readiness reference, never a stream URL or raw media.

Run the focused end-to-end verification:

```bash
npm run typecheck:manufacturer-mock
npm run test:manufacturer-mock
```

For manual generic-API inspection, authenticate first and use the returned development bearer token:

```bash
curl --fail-with-body \
  -H 'Authorization: Bearer mock-server-only-api-key' \
  -H 'Content-Type: application/json' \
  --data '{"device_id":"lab-robot-001"}' \
  http://127.0.0.1:3001/api/v1/authenticate

curl --no-buffer \
  -H 'Authorization: Bearer mock-development-access-token' \
  http://127.0.0.1:3001/api/v1/telemetry/lab-robot-001
```

Requests and responses are bounded, commands are serialized per vendor/device while unrelated devices remain independent, retries require the same idempotency key and payload, and shutdown clears listeners, timers, streams, and sockets. Structured logs contain route templates and one-way device references; headers, bearer tokens, bodies, raw device IDs, medical values, and credentials are never logged.

## 4. Starting the gateway

Validate and build from the repository root:

```bash
npm run validate-env
npm run typecheck:adapters
npm run build:adapters
```

Then start the long-lived service with its environment injected:

```bash
set -a
source server/.env
set +a
npm run clm:start
```

Node does not automatically load `server/.env` for this command. The shell snippet above is for a local, ignored secret file; deployment environments should inject the same values from their secret manager.

Check `GET /health` for process liveness. A healthy response does not prove Hume authentication, DynamoDB permissions, adapter credentials, vendor connectivity, signed-action verification, or physical robot execution.

The production Dockerfile builds TypeScript in a builder stage and copies only compiled adapter output and runtime dependencies into the non-root image. Run the same image and configuration through staging before production.

## 5. Selecting and pairing a manufacturer

There is no global `ROBOT_TYPE`. Vendor selection happens per robot during pairing and is persisted as `adapter_id` in the account binding.

Current default deployment IDs are:

```text
Yongyida -> yongyida-cloud
Jiangzhi -> jiangzhi-edge
```

The mobile pairing screen sends only the selected vendor and the opaque QR code. It never chooses a deployment adapter ID:

```http
POST /v1/devices/home-robots/pair
Authorization: Bearer <Veryloving session JWT>
Content-Type: application/json

{
  "robot_vendor": "jiangzhi",
  "qr_code": "<opaque manufacturer QR payload>"
}
```

The server then:

1. resolves that vendor to exactly one enabled, allowlisted server-side adapter configuration;
2. hashes the adapter-scoped QR claim and derives a stable possession token from that hash, the authenticated account, the adapter scope, and `ROBOT_PAIRING_TOKEN_SECRET`;
3. checks DynamoDB first for a completed binding owned by the same account, allowing an app that lost the first HTTP response to recover the same robot ID and possession token without asking the manufacturer to consume the QR again;
4. rejects a claim already bound to another account with HTTP 410 before contacting the manufacturer;
5. for a new claim, derives a stable secret-bound verification ID and calls that adapter's configured pairing-verification URL with `X-Veryloving-Pairing-Contract: veryloving.robot-pairing-verify.v1`, that ID as `Idempotency-Key`, and the exact body `{ contract_version: "vl-robot-pairing-verify/1", pairing_code }`;
6. requires the bridge to replay the same receipt for that ID after response loss and to return the matching `claim_id`, one-time/unexpired result, hardware serial, and opaque manufacturer device ID;
7. transactionally checks the account is not deleting/deleted while recording `used_at`, `bound_to`, the hashed serial, opaque manufacturer device ID, adapter ID, and hashed possession token;
8. returns the private Veryloving robot ID and possession credential.

The HMAC derivations are response-loss recovery mechanisms, not permission to reuse a QR for another account or adapter scope. The provisional manufacturer bridge must consume a one-time claim once, persist the correlated receipt before responding, replay it for the identical verification ID, and reject a different ID with HTTP 410. Rotate `ROBOT_PAIRING_TOKEN_SECRET` only through a migration/runbook that accounts for active robot possession credentials and verification receipts; an uncoordinated rotation makes those credentials or ambiguous pairing retries unrecoverable.

The app stores the possession credential in account-scoped protected storage and does not put it in the device descriptor, AsyncStorage entity list, map feature, or logs. Pairing logs use one-way claim/serial references and a hashed `robotReference`; they do not emit the returned logical robot ID, raw QR, hardware serial, manufacturer device ID, account ID, or possession token.

Custom deployment adapter IDs therefore do not require a mobile release. If a deployment ever enables multiple configurations for the same vendor, pairing fails closed until an authenticated server-owned adapter catalog or another unambiguous selection rule is implemented.

Pair one robot from each manufacturer to operate a mixed fleet. The registry and ActionGateway choose the adapter from each stored binding; enabling both environment blocks does not send one action to both vendors.

The TypeScript interface retains vendor-neutral direct command methods for adapter conformance and isolated prototypes, but their unsigned `/commands` transport is disabled by default. Production orchestration must call only `deliverSignedAction`; `allowProvisionalUnsignedCommands` is test/prototype-only and must never be enabled on a deployed gateway.

## 6. Command flow and bridge contract

Mobile actions use:

```http
POST /v1/device-actions
Authorization: Bearer <Veryloving session JWT>
X-Device-Pairing-Token: <account-bound robot possession token>
Idempotency-Key: <stable caller ID>
Content-Type: application/json

{
  "device_type": "home_robot",
  "device_id": "<private Veryloving robot ID>",
  "action": "check_medication",
  "parameters": {
    "medication_id": "<opaque medication ID>"
  },
  "idempotency_key": "<same stable caller ID>"
}
```

The server ignores any client attempt to supply a manufacturer device, adapter identity, or binding generation. It resolves all three from DynamoDB, signs `vl-robot-action/2` with a positive `binding_epoch`, durably queues it, and returns HTTP 202 with the action ID. Bindings created before the epoch migration fail closed until they are explicitly migrated; the server never guesses a generation for an old record.

The adapter initializes its bridge session and calls one of these Veryloving-owned prefixes:

```text
Yongyida: /v1/veryloving/yongyida-cloud
Jiangzhi: /v1/veryloving/jiangzhi-edge
```

Bridge operations are `POST` requests to `session`, `commands`, `signed-actions`, and telemetry query paths. See the architecture document for request bounds and signature verification requirements.

The `signed-actions` receipt is also strict. HTTP 202 must return the same `action_id` with `state: "accepted"` and `ok: true`. HTTP 200 must return the same ID with `state: "completed"` and `ok: true`. A rejection uses a non-2xx response before acceptance or a later authenticated negative ACK. The adapter rejects an empty, unrelated, failed, or contradictory 2xx receipt.

## 7. Asynchronous ACK callback

When signed delivery returns HTTP 202, the action remains `pending_ack`. The corresponding bridge posts its later outcome to:

```http
POST /v1/manufacturer/robot/ack
X-Robot-Adapter-Id: jiangzhi-edge
X-Robot-Callback-Key: <that adapter's callback key>
Content-Type: application/json

{
  "action_id": "<signed action UUID>",
  "binding_epoch": 7,
  "ok": true
}
```

A rejection may include a bounded `error_code`. The gateway authenticates the callback against the named adapter and requires the callback generation to match the pending action. It will not accept another adapter or an older/newer binding epoch. A successful HTTP response from the callback is still not a substitute for the bridge's durable exactly-once execution ledger.

## 7.1 Factory reset contract

`DELETE /v1/devices/home-robots/<robot-id>` starts or resumes a durable reset saga. The caller supplies its session JWT and `X-Device-Pairing-Token`. Before any manufacturer call, the backend changes the binding lifecycle from `active`, durably fails queued work for that exact binding epoch, and waits for bounded in-flight requests. The reset worker uses one stable `reset_id` across retries and process restarts.

The selected bridge receives exactly:

```http
POST <adapter reset URL>
Idempotency-Key: <stable reset UUID>
X-Veryloving-Reset-Contract: veryloving.robot-reset.v1
Content-Type: application/json

{
  "contract_version": "vl-robot-reset/1",
  "reset_id": "<stable reset UUID>",
  "robot_id": "<server-resolved manufacturer ID>",
  "binding_epoch": 7,
  "erase_user_data": true
}
```

Only HTTP 200 with matching `reset_id`/`binding_epoch` and `{ "state": "completed", "erased": true, "fenced": true }` proves completion. HTTP 202/204, a mismatched generation, or partial/malformed JSON fails closed. After that proof, DynamoDB atomically writes the reset receipt and leaves a data-minimized unbound epoch high-water tombstone. Re-pairing the same physical serial receives epoch 8, so delayed epoch-7 work remains invalid. The bridge must durably deduplicate `reset_id` and reject signed actions at or below every reset epoch; this downstream behavior remains a vendor conformance gate.

Outbox/ACK state is durable and an authenticated callback can complete its adapter-bound transition on a fresh gateway replica. The live per-device queue and ordering barrier are process-local, however. Keep exactly one long-lived delivery replica and set `ACTION_GATEWAY_SINGLE_REPLICA=true` in production until distributed per-device leases are implemented; do not run active-active action delivery merely because durable ACK recovery is cross-replica capable.

Account deletion first persists its account fence, drains delivery, and performs vendor erasure. The requesting session remains available for an interrupted retry until `finalizeAccountDeletion` atomically deletes the terminal session set and changes the account marker to `deleted`. Pairing carries the same account marker as a Dynamo transaction condition, so a slow verification cannot create a binding after deletion wins.

If no valid callback arrives before `ROBOT_ACK_TIMEOUT_MS`, the outbox marks the action failed and the app user receives: “Robot command failed. Please check your robot's network connection.”

## 8. Telemetry

The app fetches account-authorized telemetry using its JWT and robot possession token:

```http
GET /v1/devices/<private-robot-id>/telemetry
Authorization: Bearer <Veryloving session JWT>
X-Device-Pairing-Token: <account-bound robot possession token>
```

The server resolves the adapter and manufacturer device from the account binding and calls the provisional bridge's `telemetry/snapshot/query` operation. The implemented snapshot can return:

- authoritative status (`online`, `hardware_status`, `reported_at`, optional `firmware_version`);
- battery percentage/charging state and up to 100 vital observations;
- one timestamped location, one timestamped path with up to 500 navigation
  points, and one bounded indoor position;
- up to 20 safety events and 20 medication acknowledgements.

The adapter and runtime reject malformed or oversized shapes. A stale, future, or invalid authoritative status—or a status with no Boolean `online` field—suppresses the sensor/event snapshot and reports offline/unknown. Battery, vitals, location, navigation path, indoor position, safety events, and medication acknowledgements also have their own freshness checks; stale/future optional samples are omitted. The provisional bridge contract requires Unix-millisecond `captured_at` values on location, the complete navigation path, and indoor position. Timestamp-less spatial fields fail closed even when status is fresh. `HomeRobotDevice` applies its own independent timeout across credentials, fetch, and response consumption (even when abort is ignored), refuses redirects, accepts only object JSON from bounded UTF-8 text, cancels stalled/non-success bodies when possible, updates bounded location/path/battery state, marks network failures offline, and retries locally queued commands when connectivity returns.

This is an authenticated polling path against the **provisional Veryloving bridge contract**. It is not evidence that either manufacturer emits these fields, that a callback/event-ingestion pipeline is deployed, that medical values are clinically valid, or that vendor retention/consent obligations are satisfied. A real vendor mapping, provenance/quality contract, event authentication/replay design, privacy review, and exact-hardware conformance remain production blockers.

Do not expose raw camera frames, medical records, serials, or vendor response bodies through the status endpoint. Add new telemetry only through a versioned, bounded normalizer and update retention/privacy review at the same time.

## 9. Jiangzhi Edge Bridge deployment

The TypeScript `JiangzhiAdapter` expects an HTTP service; it does not execute ADB commands. A production Android edge bridge must:

- run as a signed, managed APK/service on the frozen production Android image;
- authenticate the server/relay, verify Ed25519 actions, expiry, adapter/device target, and idempotency before local execution;
- use a supported Jiangzhi SDK/HAL behind a narrow module boundary;
- persist replay claims and ACKs across Android process death and power loss;
- implement local safety interlocks and offline emergency behavior;
- expose only normalized, consented telemetry;
- support key rotation, signed OTA, rollback, factory reset, bounded logs/storage, and health reporting.

ADB is permitted only for isolated lab provisioning and diagnosis. Disable production network ADB. Do not use shell commands or UI automation as the runtime control plane.

No public JZKH1.0 or Jiangzhi robot-control SDK was found. Obtain the exact AAR/JAR/AIDL/Binder/serial/BLE contract and license before replacing edge stubs.

## 10. Yongyida bridge deployment

The TypeScript `YongyidaAdapter` expects a Veryloving cloud bridge. That bridge must:

- authenticate Veryloving and the partner cloud independently;
- verify signed actions before translating them;
- map provisional `VL_*` operations to documented vendor commands;
- preserve the Veryloving action ID through vendor idempotency and callbacks;
- normalize status, battery, telemetry, errors, and timestamps;
- shield the core gateway from vendor credential rotation and API versions;
- provide deterministic sandbox behavior and production monitoring.

Do not use `https://api.yongyida.com` or any other guessed hostname. Public Yongyida material does not provide a callable endpoint or authentication method.

## 11. Tests

Run the full deterministic suite from the repository root:

```bash
npm test
```

The command builds adapter TypeScript, runs the core `node:test` suite, runs adapter Jest tests with coverage gates, and runs the test-only manufacturer bridge integration flow.

`npm run validate` is the consolidated source gate. It validates a deterministic, credential-free production export fixture in addition to development configuration, tests, lint, Doctor, and both platform bundles. It does not prove that the real release environment is provisioned or waive the separate candidate-environment gate:

```bash
npm run validate-env -- --profile production
```

Run that command only with the authorized candidate deployment environment. It must continue to fail closed until action/signing configuration, approved VL01 UUIDs, provider values, and other required release inputs are provisioned; retain only redacted results. For credential-free source readiness, use `npm run validate:production`, whose live registry/container extension remains a separate external release action.

Useful focused commands are:

```bash
npm run typecheck:adapters
npm run test:adapters
npm run test:integration:adapters
npm run test:soak:adapters
npm run test:core
npm run lint
```

The Jest configuration enforces 90% global statements, branches, functions, and lines for executable adapter implementation files. Do not describe the target as met unless the current command exits zero and prints coverage at or above each threshold.

The TypeScript manufacturer simulator refuses `NODE_ENV=production`, binds to loopback by default, lives under `server/mocks`, and is excluded from the production server image. A separate legacy bridge fixture remains test-only under `tests/integration`. The deterministic simulator controls cover:

- both vendor prefixes and sessions;
- signature and envelope verification;
- expiry and adapter/device targeting;
- stable idempotency and conflict rejection;
- 202 versus synchronous ACK behavior;
- the bounded provisional telemetry snapshot, including status, battery, vitals, location/path, indoor position, safety events, medication acknowledgements, and stale/future suppression;
- authentication failure, HTTP 500, timeout, malformed JSON, and oversized payloads.
- simultaneous wearable/robot telemetry, bounded synthetic fall/stress/medication events, camera-session correlation, and the redacted dashboard.

These tests prove Veryloving contract behavior only. They do not exercise Hume's hosted service, a manufacturer sandbox, a real Android image, a real robot, or medical instruments.

## 12. Fault-testing checklist

Run these against the test bridge first, then an approved vendor sandbox, then production-representative hardware:

| Scenario | Expected result |
| --- | --- |
| 401/403 bridge response | One attempt; `ADAPTER_AUTH_FAILED`; no credential retry |
| Retryable 500/503/429 | Bounded exponential retry with unchanged idempotency key |
| Fetch ignores `AbortSignal` | Adapter still reaches its own bounded timeout |
| Mobile relay fetch ignores abort or body stalls | `HomeRobotDevice` reaches `ROBOT_NETWORK_TIMEOUT`, cancels the body where possible, retains durable commands, and does not mark hardware online |
| Malformed or oversized response | Typed failure; no inferred status and no blind retry |
| Duplicate signed action | Same receipt/outcome; one recorded physical execution |
| Same action ID with different body | HTTP 409 idempotency conflict |
| Expired or wrong-target action | Rejected before physical dispatch |
| One vendor stalls | Other adapter/device proceeds independently |
| Gateway process dies after enqueue | Unexpired outbox action recovers once after restart |
| Process dies after physical execution before ACK | Receiver replay ledger prevents a second physical effect |
| HTTP 202 with no callback | ACK timeout, failed outbox state, user push notification |
| Stale/invalid telemetry | Robot shown offline/unknown |
| App loses internet | Robot marked offline; bounded commands remain account-scoped; wearable BLE remains independent |

Do not simulate a 24-hour or 72-hour soak by extrapolating a short test. Record exact duration, build SHA, hardware SKU/serial hash, firmware, network profile, sampling interval, memory/socket/timer/storage curves, command count, and failure count.

The committed soak harness defaults to 60 seconds and accepts a bounded duration up to 24 hours. For a 24-hour software-transport run:

```bash
ROBOT_SOAK_DURATION_MS=86400000 npm run test:soak:adapters
```

This harness uses an in-process test transport. It checks heap and active-handle growth but does not replace a 72-hour exact-hardware/vendor-network soak.

## 13. Adding a real vendor mapping

When partner artifacts arrive:

1. Archive the versioned API/SDK/HAL and license in the approved internal artifact system.
2. Freeze the exact model, BOM, OS/firmware, and compatibility range.
3. Write a bridge conformance table for every HAL method, including unsupported methods.
4. Implement translation inside the Yongyida cloud bridge or Jiangzhi edge HAL module, not in Hume prompts or mobile screens.
5. Preserve account-resolved identity, signed payload, expiry, idempotency, and ACK semantics.
6. Add fixture-based contract tests for every vendor response/error and a sandbox integration suite.
7. Add key rotation, rate-limit, outage, rollback, reset, privacy export/delete, and version-deprecation tests.
8. Run real hardware safety, latency, process-death, network-split, power-loss, and soak acceptance.
9. Keep the adapter disabled until security, privacy, safety, regulatory, and commercial gates sign off.

## 14. Troubleshooting

| Symptom/code | Check |
| --- | --- |
| `Robot adapter build is missing` | Run `npm run build:adapters`; confirm `server/dist/adapters` exists in the runtime image |
| `ROBOT_ADAPTER_NOT_CONFIGURED` | Stored `adapter_id` does not match an enabled immutable deployment ID |
| `ROBOT_ADAPTER_BINDING_MISMATCH` | Signed adapter/manufacturer target does not match runtime selection; do not rewrite the envelope |
| `ADAPTER_AUTH_FAILED` | Bridge bearer/session key, endpoint trust, clock/key rotation; never log the secret |
| `ADAPTER_TIMEOUT` / unavailable | Bridge connectivity and bounded retry metrics; do not increase limits before finding the failure |
| `ADAPTER_RESPONSE_INVALID` | Bridge schema, timestamps, signed receipt/action ID, or malformed JSON |
| Pairing HTTP 410 | Claim is expired, conflicts with an existing binding, or belongs to another account. A response-loss retry by the original account should resume rather than return 410; investigate that path before requesting a new code |
| Pairing requests manufacturer selection | Mobile `robot_vendor` is missing/unsupported, or the server cannot resolve that vendor to exactly one enabled adapter |
| Robot stays `pending_ack` | Bridge returned 202 but did not call the authenticated ACK route before deadline |
| Robot appears offline | Verify bridge status timestamp, account binding, possession token, network, and exact adapter ID |
| Reset does not unbind | Manufacturer reset did not synchronously confirm user-data erasure; the binding is intentionally retained |

## 15. Production readiness checklist

- [ ] Vendor documentation and credentials are received under a reviewed agreement.
- [ ] Exact production SKU/BOM/OS/firmware and support lifecycle are frozen.
- [ ] Real vendor mappings replace only the bridge internals; provisional names are not presented as vendor facts.
- [ ] Every enabled adapter has independent bridge and callback credentials and a rotation drill.
- [ ] Bridge verifies signature, exact payload/envelope agreement, expiry, target, and durable idempotency.
- [ ] Pairing QR is manufacturer-issued, one-time, expiring, and replay-tested across accounts.
- [ ] Same-account pairing response loss/process death recovers the existing binding and possession credential; pairing-secret rotation/recovery is rehearsed.
- [ ] Reset and privacy operations work correctly for each vendor in a mixed fleet.
- [ ] Offline/local emergency behavior and physical interlocks are validated.
- [ ] Medical instrument identity, units, quality, calibration, consent, retention, and regulatory position are approved.
- [ ] p50/p95/p99 acceptance and execution latency are measured on real hardware.
- [ ] Process death, power loss, network split, duplicate, delayed ACK, key rotation, OTA, rollback, and factory reset pass.
- [ ] Minimum 72-hour hardware/bridge soak passes with bounded resource growth.
- [ ] `npm test`, lint, typecheck, build/export, container health, and deployment probes pass on the release SHA.

Until every applicable item is evidenced, keep the vendor adapter disabled in production.

<!-- END:robot-adapter-integration-guide -->

<!-- BEGIN:ai-native-integration-guide -->
<a id="ai-native-integration-guide"></a>
## Appendix — AI-Native Integration Guide

Status: development prototype — simulated devices and inference only

Last reviewed: 22 July 2026

## 1. Scope and assurance boundary

This guide describes the Veryloving-owned AI-native coordination layer for Product 1 (the VL01 BLE wearable) and Product 2 (the home companion robot). The layer combines account-scoped state, summary memory, deterministic scenario execution, simulated edge inference, and the existing signed device-action gateway.

The implementation can exercise both product paths without real hardware. That is useful for software integration and failure testing, but it is not evidence of clinical accuracy, emergency-delivery reliability, fall-detection sensitivity, autonomous-navigation safety, camera coverage, battery life, or sub-100 ms inference on a target processor.

The following remain **BLOCKED — EXTERNAL**:

- approved Yongyida or Jiangzhi API/SDK contracts, production endpoints, credentials, and SLAs;
- target wearable firmware, sensor calibration, and physical Cortex-M profiling;
- target robot camera, microphone, motor-control, NPU/GPU, serial/GPIO, and safety-controller contracts;
- Hume EVI production credentials, voice/persona configuration, and provider availability testing;
- APNs/FCM, Twilio, caregiver consent, emergency-routing policy, and physical-device validation.

Ownership and unblocking actions are tracked in [External Dependencies Dashboard](#external-dependencies-dashboard); manufacturer contract requirements are in [Manufacturer API Requirements](#manufacturer-api-requirements).

No simulated health or emotion value should be used for diagnosis, treatment, medication decisions, dispatch, or a representation that a real person is safe. A scenario reaching `completed` means the configured software steps completed; it does not prove that a person received help or that a device performed a physical action.

| Capability | Status | Evidence/remaining gate |
| --- | --- | --- |
| Account-bound encrypted User State and trends | PASS — software | Domain API plus tested DynamoDB ciphertext repository; production table/key operations still require deployment |
| Encrypted summary Memory Net with recall/export/delete | PASS — software | Local recall/privacy tests plus tested DynamoDB ciphertext repository; production key management still requires deployment |
| Priority/idempotent/cancellable Scenario Engine | PASS — software | Five versioned workflows, tested DynamoDB execution repository, and fail-closed restart reconciliation; production remains explicitly single-replica pending a distributed lease protocol |
| Dual-device mock telemetry and dashboard | PASS — simulated | Loopback development/test service only |
| Authenticated AI-native server composition and ingress | PASS — software | `createAINativeSystem` is fail-closed and `clm-server` mounts authenticated scenario, edge, cancellation, privacy, and voice-memory integration when the durable system is injected; deployment construction and credentials remain external |
| Hume EVI live empathetic sessions | BLOCKED — EXTERNAL | Enterprise key, approved configuration/personas, and availability validation |
| Wearable edge inference and battery target | BLOCKED — EXTERNAL | Final firmware/model/sensors and target-hardware profiling |
| Robot perception, voice, navigation, and camera stream | BLOCKED — EXTERNAL | Approved vendor HAL/SDK, exact robot, safety/privacy validation |
| Push, SMS, calls, and caregiver delivery | BLOCKED — EXTERNAL | APNs/FCM/Twilio credentials, consent/escalation policy, provider receipts |

## 2. Architecture

```mermaid
flowchart LR
    WE[Wearable edge inference] --> ER[Authenticated Edge Scenario Router]
    RE[Robot edge inference] --> ER
    ER --> SE[Scenario Engine]
    SE --> H[Bounded Hume EVI session provider]
    T[Trusted scheduler/context events] --> ER
    SE --> US[Encrypted User State]
    SE --> MN[Encrypted Memory Net]
    SE --> AG[Action Gateway]
    AG --> W[Wearable BLE path]
    AG --> RA[Robot adapter runtime]
    RA --> R[Manufacturer bridge]
    W --> ACK[Telemetry and acknowledgements]
    R --> ACK
    ACK --> US
    ACK --> SE
```

The important trust boundaries are:

1. Edge modules emit normalized observations; they do not directly invoke emergency or robot actions.
2. The Scenario Engine validates a trigger, checks account and device scope, applies idempotency and priority, and invokes an allowlisted workflow.
3. The Action Gateway remains the authority that resolves device bindings, signs action envelopes, and dispatches through the correct device-specific queue.
4. User State stores timestamped observations for trend queries. Memory Net stores deliberately selected summaries, not raw conversations, camera frames, microphone audio, or opaque provider transcripts.
5. Manufacturer credentials and hardware serials remain server-side. Structured logs use bounded metadata and one-way references, never raw action parameters, secrets, user text, sensor payloads, coordinates, or serial numbers.

Hume EVI is the conversational and emotional-interaction provider, not the authorization or life-safety policy engine. A scenario may request an allowlisted Hume mode such as a voice check or calming session. A separately authenticated Hume tool ingress may propose an allowlisted scenario trigger, but deterministic server code must validate it before execution. That code decides whether a scenario may start, which bound devices may act, when a timeout has elapsed, and which fallback is required. This keeps a model response, prompt injection, or provider outage from changing device identity or bypassing escalation policy.

For direct coordinated dispatch, `ActionGateway.routeMany` accepts 1–10 fully validated, idempotent child actions and supports parallel or sequential execution. Parallel dispatch preserves the independent wearable and robot queues, so a stalled BLE path does not prevent a robot request from starting. Scenario workflows use `ActionGatewayScenarioRuntime`, which creates stable child idempotency keys and delegates each side effect back through the same gateway rather than bypassing its binding and signature checks.

Source boundaries:

- [UserState.ts](../server/src/models/UserState.ts) — account-bound encrypted state and history
- [ScenarioEngine.ts](../server/src/orchestration/ScenarioEngine.ts) — workflow execution, timeout, fallback, cancellation, and idempotency
- [EdgeScenarioRouter.ts](../server/src/orchestration/EdgeScenarioRouter.ts) — authenticated inference/context mapping, freshness, source binding, and thresholds
- [TelemetryStateIngestor.ts](../server/src/orchestration/TelemetryStateIngestor.ts) — bounded edge-envelope projection into encrypted account state
- [AINativeRuntime.ts](../server/src/orchestration/AINativeRuntime.ts) — bounded Hume context, concrete User State/Memory Net composition, and coordinated account fencing
- [AINativeSystem.ts](../server/src/orchestration/AINativeSystem.ts) — fail-closed composition root for stores, workflows, edge routing, and privacy export/deletion
- [MemoryNet.ts](../server/src/memory/MemoryNet.ts) — encrypted summary memory, recall, export, and deletion
- [WearableEdgeAI.ts](../server/src/edge/WearableEdgeAI.ts) — deterministic wearable sensor/inference simulator
- [RobotEdgeAI.ts](../server/src/edge/RobotEdgeAI.ts) — deterministic robot perception/voice simulator
- [`server/src/scenarios/`](../server/src/scenarios/) — the five cross-device workflow definitions
- [ManufacturerMockServer.ts](../server/mocks/ManufacturerMockServer.ts) — development-only dual-device transport and dashboard

## 3. Request and data lifecycle

### 3.1 Observations

Every accepted observation should carry an authenticated account context, a Veryloving logical device ID, an observed timestamp, and a source label. Do not let Hume, a mobile client, or a manufacturer callback select another account ID. Validate freshness, numeric bounds, and device binding before writing state or evaluating a trigger.

The Scenario Engine is a domain API, not a public telemetry-ingestion endpoint. `EdgeScenarioRouter` is the post-authentication domain router: it verifies freshness and the expected telemetry source reference, maps allowlisted inference/context events to one scenario ID, and derives stable idempotency keys before calling `startScenario`. A transport controller still must authenticate the producer and load the account's binding before invoking it. The development simulator's event injector only creates a synthetic event; tests provide the trusted in-process wiring.

The simulated edge modules normalize:

- wearable accelerometer, PPG-derived heart rate/HRV, temperature, UTC day-to-date steps, battery, activity, stress, and fall classification; coarse `home`/`away` context is supplied separately by the authenticated transport;
- robot derived vision/prosody/motor features, fall/facial-expression classification, local voice intent/emotion, and motor safety. Bedroom-inactivity policy comes from the trusted scheduler, while camera readiness comes only from a correlated manufacturer acknowledgement.

The simulator produces synthetic values. In production, replace each generator/inference boundary with an approved parser and model while preserving the normalized output contract.

### 3.2 State and memory

User State and Memory Net require a server-owned 256-bit encryption key (or versioned keyring) and an account identifier on every operation. The account is converted to a keyed opaque storage key; AES-GCM authenticates the domain, opaque storage key, revision, and—starting with key version 2—the key version. A copied ciphertext record must not decrypt under another account/domain/revision. Key rotation retains the stable account-index key, rewrites each account aggregate with `migrateEncryption`, and retires an old data key only after migration is verified.

Use User State for current and time-series facts such as device status, steps, medication confirmation, mood, and heart-rate observations. Use Memory Net only for concise personalization facts that have a defined purpose and retention policy. Examples include “prefers classical music in the morning” or a bounded summary of a shared life event. Do not use raw transcripts as memory.

`createAINativeScenarioRuntime` composes these stores with Action Gateway and the injected Hume/provider functions. Before a Hume session it builds a bounded context: selected current health/context values, up to five summarized recalls, relationship count/trust metadata, and device type/connectivity/battery only. It omits device IDs and precise coordinates, and never supplies raw transcript/audio/video. Sending even summarized health or life-event context to Hume still requires the applicable user consent, provider data terms, retention controls, and production credential gate.

`AINativeAccountLifecycle` supplies the process-local half of the deletion fence: it rejects new provider work, aborts and drains in-flight work (including composed export), invokes the Action Gateway and Scenario Engine account fences, then deletes User State, Memory Net, scenario analytics, and provider-owned Hume/signal records. The runtime now requires a lifecycle instance; production must pass that same instance to both `createAINativeScenarioRuntime` and the privacy coordinator. The external export provider receives an abort signal; the erasure callback is mandatory and must be idempotent. Every provider must honor its abort signal or deletion can remain safely blocked while work drains.

The compiled source includes two production persistence primitives. `DynamoCiphertextRepository` stores only HMAC-derived storage keys and AES-GCM records, uses strongly consistent reads and conditional revision writes, and fails closed before DynamoDB's item-size ceiling. `DynamoScenarioExecutionRepository` uses transactional idempotent admission, monotonic updates fenced by an account deletion tombstone, bounded account export/deletion, and retry handling for unprocessed deletes. It requires a table with string `PK`/`SK` keys and an `ALL`-projected GSI whose partition/sort keys are `GSI1PK`/`GSI1SK` (the index name is configurable). These classes provide durable repository implementations; they do not create tables, retrieve KMS keys, supply a distributed execution lease, or prove backup/restore behavior.

Exports return only the authenticated account's decrypted records. Account deletion must first move the account to a server-owned `deleting` state that fences new state, memory, scenario, outbox, and adapter mutations; it then deletes all related records through the established privacy workflow. Without that lifecycle fence, a concurrent write can recreate data after a delete scan. Treat an upstream manufacturer's “accepted” deletion response as incomplete until the relevant deletion contract provides confirmation.

### 3.3 Scenario execution

A scenario execution has a stable execution ID and idempotency key. Its state progresses through the engine's terminal-safe lifecycle; step results and timestamps are retained as bounded analytics metadata. A retry with the same account, scenario, trigger, and idempotency key joins or returns the original execution. Reusing a key for a different request is rejected.

The engine intentionally does not blindly resume a non-terminal execution after process death because workflow input is deliberately ephemeral. `reconcileAccountAfterRestart` finds orphaned `queued`/`running` snapshots, requires the configured recovery provider before closing a Critical orphan, and then marks the record failed with `PROCESS_RESTARTED`. Production must still provide durable storage, a way to enumerate affected accounts, an idempotent `onRecoveryRequired` escalation, startup/lazy reconciliation ownership, and crash tests. Do not describe this as step-level resume.

Priority is explicit:

| Priority | Intended use | Scheduling rule |
| --- | --- | --- |
| Critical | Fall response and AI Angel emergency flow | Dedicated reserved lane plus separate global/account admission caps; never drop silently |
| Standard | Medication and emotional check-in | Per-device ordering with bounded timeout and documented escalation |
| Background | Cognitive engagement analytics and trend summaries | Yield to higher priorities and remain cancellable |

Cancellation propagates an abort signal through undispatched queue work, retry/transport waits, and cancellable scenario providers, then marks the execution accordingly. If robot navigation may be active, the engine issues a separately bounded, idempotent `emergency_stop` compensation and records its outcome. It also records already-delivered alarms, messages, calls, camera sessions, and audio actions under `cancellation.nonRetractable`; those effects must be shown as unknown/possibly sent rather than claimed as retracted. Robot outbox records distinguish pre-dispatch `ACTION_CANCELLED` from `ACTION_CANCELLED_NON_RETRACTABLE`, and a wearable abort after send carries `nonRetractable: true`. A production audit store should also retain any late authenticated acknowledgement.

The router treats a local robot `cancel` intent only as `cancellationRequested`; it does not select or stop a Critical execution. An authenticated user or authorized caregiver must identify the execution and call `confirmCancellation`. Physical release must additionally establish speaker/user confirmation, liveness, false-activation handling, an audit trail, and which life-safety steps can no longer be cancelled.

## 4. Configuring the Scenario Engine

Construct the engine with explicit dependencies rather than global credentials. The injected action dispatcher, state store, memory store, clock, analytics sink, and notification/caregiver fallbacks make execution deterministic in tests and replaceable in production. `createAINativeSystem` is the domain composition root: it requires ciphertext and scenario repositories (including exhaustive account export), a rotation-capable keyring, an identity secret, every side-effect provider, and an external privacy provider; creates User State, Memory Net, the shared account lifecycle, runtime, five definitions, Scenario Engine, telemetry ingestor, and Edge Scenario Router; and exposes coordinated voice context and export/deletion boundaries. `clm-server` accepts this composed system as an injected dependency and fails closed when AI-native mode is enabled without it.

The focused tests exercise the domain components in process and route-level tests cover the server controllers. Both long-lived command-line entrypoints pass through `ai-native-composition.cjs`. In production, `AI_NATIVE_PRODUCTION_MODULE` must be an absolute path inside the reviewed deployment image. That CommonJS module exports synchronous `createAINativeProductionDependencies({ env, logger })` and returns contract version `1`, five required capability declarations, durable system options, the four trust hooks below, and an optional cleanup function. The entrypoint constructs the official `createAINativeSystem` before listening. It rejects the bundled in-memory repository classes, a legacy raw encryption key, missing providers/hooks, an incomplete capability contract, and asynchronous startup. These structural declarations are a fail-closed interface, not independent proof that an external store, KMS, or provider is durable; release validation must verify the packaged implementation and infrastructure. The provider module must obtain keyring material and credentials from the deployment secret/KMS boundary; nothing is read from a public mobile variable.

Set `AI_NATIVE_DATA_LIFECYCLE_ENABLED=true` before an environment first stores AI-native state or memory, and never turn that lifecycle flag off while such data may exist: export and erasure continue to include the durable AI-native repository even while orchestration is disabled. Set `AI_NATIVE_ENABLED=true` only after the production composition module is packaged; runtime enablement requires the lifecycle flag. Production also requires `AI_NATIVE_SINGLE_REPLICA=true` until distributed scenario-admission leases exist. This is an explicit temporary topology gate; the server refuses to start if a gate is absent. The deployment module must inject four trust-boundary functions:

- `resolveEdgeDeviceBinding` — resolves an app-authenticated wearable source to the account's server-owned command targets and source references;
- `authenticateRobotEdgeIngress` — authenticates the manufacturer callback credential and returns its account and active robot binding;
- `resolveScenarioDevices` — derives wearable/robot targets for an authenticated app, voice, or scheduler scenario without accepting client-selected IDs;
- `authenticateScenarioIngress` — authenticates the trusted medication/occupancy scheduler before accepting context events.

These are code-level trust hooks, not public environment credentials. Their backing secrets, repositories, and key material belong in the server secret manager. The exact authenticated HTTP and voice transport shapes are documented in [AI-Native API Reference](#api-reference-ai-native).

Configuration rules:

- enable each scenario explicitly for the deployment and, where applicable, for the user's consent profile;
- use server-owned, bounded timeout values; tests may shorten virtual time, but production safety timers must match the approved care protocol;
- derive idempotency keys from a trusted event ID and scenario version, never from free-form model text alone;
- resolve wearable and robot bindings from the authenticated account; reject missing, offline, stale, or cross-account targets;
- keep notification and SMS delivery as explicit, observable fallback steps rather than assuming transport acceptance equals delivery;
- route Hume output through a strict trigger/tool schema. Hume must not generate manufacturer IDs, arbitrary URLs, phone numbers, or unrestricted action parameters.

The development simulator supports deterministic latency and failure injection. `MOCK_MANUFACTURER_URL` is permitted only for a loopback origin when `NODE_ENV` is `development` or `test`; production configuration rejects it. See [Robot Adapter Integration Guide](#robot-adapter-integration-guide) for the adapter bridge configuration.

Synthetic dual-device events are configured with `MOCK_MANUFACTURER_FALL_EVENT_RATE`, `MOCK_MANUFACTURER_STRESS_EVENT_RATE`, `MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS`, `MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS`, and `MOCK_MANUFACTURER_SEED`. Set event rates to zero for a quiet deterministic walkthrough and inject the desired event explicitly. The HTML dashboard is at `GET /dashboard`; it shows live devices and real/synthetic executions and can launch all five workflows. Setup, its local cookie/proxy boundary, and operator acceptance steps are documented in [Demo Dashboard](#demo-dashboard); authenticated JSON/event/SSE routes are listed in [AI-Native API Reference](#api-reference-ai-native).

## 5. The five workflows

All durations below are workflow policy inputs. Automated tests use controlled clocks and do not wait 15 real minutes.

### 5.1 Fall response

Trigger: a fresh, high-confidence wearable fall observation with impact and post-impact inactivity.

1. Mark the execution critical and attach a server-owned opaque location reference (the authenticated provider resolves it to the account's permitted current/last-known location; the workflow does not persist coordinates).
2. If fresh authenticated robot inference reports `safeToMove`, request navigation to that opaque target; otherwise skip motion and alert immediately.
3. Start a local Hume-backed voice check through the robot; this is not yet an emergency-contact call or video stream.
4. Await a bounded user-response signal.
5. If the robot is offline, navigation fails, or no response arrives within the configured window, invoke the emergency-contact fallback immediately with the permitted location/context. Include camera context only after an authenticated acknowledgement proves `camera_ready` for the exact server-derived session reference.

The software simulator cannot validate physical fall detection, obstacle avoidance, arrival, camera visibility, audio intelligibility, or emergency-contact delivery.

### 5.2 Medication adherence

Trigger: a trusted, account-owned schedule occurrence, not model-generated free text.

1. Ask the robot to display and speak the reminder.
2. Await a wearable movement/proximity confirmation associated with that reminder.
3. If no confirmation arrives within the configured adherence window, request caregiver push notification.
4. If the escalation policy still has no confirmation, request the SMS fallback.
5. Record `reminded`, `confirmed`, `declined`, or `unconfirmed`; never infer ingestion solely from movement.

Medication identifiers should be opaque. Do not put medication names, dosage, or medical history in logs or notification previews without an approved privacy policy.

### 5.3 Emotional check-in

Trigger: a fresh wearable stress classification whose threshold and cooldown rules are enabled.

1. Ask the robot to initiate a gentle check-in.
2. Offer a configured breathing exercise, meditation, or calming activity.
3. Store only a bounded emotional summary or user-provided mood when consent permits.
4. Schedule a bounded later check-in only when the observer explicitly returns `responded: false` (including an intentional `not_found` outcome); record transport/provider failures separately rather than inferring silence.

HRV-derived stress and facial/voice emotion are probabilistic wellness signals, not diagnoses. Hume-backed empathetic conversation remains external until credentials and production policies are configured.

### 5.4 Cognitive engagement

Trigger: a trusted scheduler event indicating the configured morning inactivity condition. The current robot edge envelope does not contain occupancy; a future camera/occupancy provider must remain an authenticated, consented scheduler input.

1. Query the wearable's current step/activity state.
2. If it is below the configured threshold, offer a walk or an allowlisted cognitive activity.
3. Record a bounded engagement outcome only from an explicit response or explicit `responded: false`; an unavailable observer becomes availability analytics, not a user outcome.
4. Do not label cognitive decline from one event; any longitudinal flag requires an approved clinical/product rule and human review.

The simulator can emit a synthetic inactivity event, but its robot edge classifier does not derive room occupancy. Any future camera-derived occupancy must not be enabled on real hardware without consent, retention, placement, and false-positive review.

### 5.5 AI Angel auto-dial

Trigger: a verified panic-button event, fall event, or tightly allowlisted authenticated voice intent.

1. Request the wearable emergency-call path.
2. Request a robot room-view session using the server-secret, account/execution-scoped reference; expose a link only after a correlated `camera_ready` acknowledgement.
3. Request the allowlisted robot two-way-call action and Hume emergency-session provider independently; neither transport acceptance nor the mock is proof that audio reached a contact.
4. If robot/Wi-Fi delivery fails, request the SMS fallback containing only the permitted GPS snapshot.

The repository's mock implementation does not place a real call, send an SMS, expose a real video feed, or prove delivery. Twilio, APNs/FCM, Hume, camera-stream authorization, and emergency-policy approval remain external gates.

## 6. Extending the system

### 6.1 Add a scenario

1. Define a versioned scenario and allowlisted trigger in [`server/src/scenarios/`](../server/src/scenarios/).
2. Assign one priority and declare every device target, timeout, retry boundary, cancellability rule, and fallback.
3. Validate parameters at the boundary; never pass free-form model objects directly to an adapter.
4. Use one idempotency key for the logical execution and stable child keys for side-effecting steps.
5. Record bounded state transitions without PII or raw sensor payloads.
6. Add happy-path, offline, timeout, cancellation, duplicate-trigger, cross-account, and latency-budget tests.
7. Document which outcomes mean transport acceptance versus verified physical completion.

### 6.2 Add a memory kind

1. Establish a specific personalization purpose, user-visible label, source, confidence, and retention period.
2. Store a concise summary, never an unrestricted transcript or media blob.
3. Add schema validation and a bounded recall filter.
4. Include the kind in account export and specific/all-memory deletion tests.
5. Confirm account-bound authenticated encryption and log redaction.

Recall output is context for a response generator, not an instruction authority. Before including recalled text in a Hume prompt, delimit it as user memory and prevent it from altering tool policies or device bindings.

## 7. Edge hardware integration contracts

### 7.1 Wearable target

The simulated wearable boundary expects timestamped accelerometer samples, PPG/heart-rate observations, skin/ambient temperature as defined by hardware, and optional location supplied by the paired mobile app. Production integration must document sampling frequency, units, integer/float representation, endian order, calibration, missing-sample flags, monotonic sequence, clock synchronization, BLE fragmentation, and integrity checks.

The provisional production model candidate is an int8 1D depthwise-separable CNN with three temporal blocks, a `[1, 128, 5]` sensor tensor, and fall, stress, and activity heads under 120,000 parameters. It is an engineering architecture target only; no trained weights, dataset rights, model card, clinical validation, or final-hardware profile are available yet.

Target acceptance gates include:

- an approved TensorFlow Lite Micro or equivalent model artifact with version/hash and representative validation data;
- target-specific ARM Cortex-M RAM, flash, CPU/DSP instruction, tensor-arena, and sensor-buffer measurements;
- measured p95/p99 inference under 100 ms on final hardware, including acquisition and preprocessing policy;
- measured daily battery impact below 10% under an agreed workload and radio schedule;
- fall and stress sensitivity/specificity targets, false-alarm behavior, watchdog recovery, and signed OTA rollback.

Until these are measured, `latencyMs` from the TypeScript simulator is software timing only.

### 7.2 Robot target

The simulated robot boundary uses bounded scene/voice feature objects instead of retaining raw media. A production edge service must define camera resolution, frame rate, color space, orientation, timestamping, privacy masks, microphone sample rate/format/channel count, acoustic-echo cancellation, and secure IPC framing.

Provisional candidates are a quantized pose-plus-temporal CNN for fall detection, quantized MobileNetV3-Small expression classification without embedding retention, and small-footprint keyword/intent plus prosody models for offline voice. Vendor runtime support, training data and bias review, accuracy, thermal behavior, and safety validation are unresolved.

The serial/GPIO statement in the product concept is not yet a verified vendor interface. Prefer an authenticated local Android service, Unix-domain socket, gRPC, or vendor HAL when available; reserve GPIO for simple safety-rated signals rather than rich payload transport. Required hardware evidence includes NPU/GPU model support, RAM/thermal budget, secure boot, model signing, watchdog behavior, motor-controller isolation, and offline speech-language coverage.

Raw camera frames and microphone audio should remain on-device unless a user-authorized, encrypted session explicitly requires transmission. Face analysis must not be used as identity proof, diagnosis, or an unrestricted surveillance capability.

## 8. Privacy and security checklist

- Authenticate first and derive `accountId` from the server session.
- Authorize every device and memory/state key against that account.
- Encrypt records at rest with an independently managed 256-bit key; rotate through a versioned key policy.
- Bind authenticated-encryption metadata to account, record type, record ID, and schema version.
- Keep current state, historical samples, memory summaries, scenario executions, and adapter outbox within explicit retention limits.
- Support account export, specific-memory deletion, all-memory deletion, and complete account deletion.
- Never log PII, raw prompts/transcripts, coordinates, action parameters, health measurements, keys, tokens, serials, camera/audio content, or plaintext records.
- Reject stale, replayed, malformed, oversized, cross-account, cross-binding, or unknown-version inputs.
- Treat edge and manufacturer telemetry as untrusted until authenticated, schema-validated, bounded, and freshness-checked.
- Keep mock endpoints loopback-only and fail startup in production.

## 9. Verification and production readiness

Run the focused TypeScript and integration suites documented by the repository's package scripts, then run the full gate:

```bash
npm run typecheck:ai-native
npm run test:ai-native
npm test
npm run validate
```

The tests demonstrate deterministic software behavior against simulated inputs and loopback transports. Production approval additionally requires vendor-contract conformance, threat modeling, privacy/legal review, physical wearable and robot validation, end-to-end notification/call delivery tests, Hume failure testing, accessibility testing, incident response, monitoring, load/soak testing, and a reviewed human escalation policy.

The focused integration suite is [scenarios.test.ts](../server/tests/integration/scenarios.test.ts). Its five happy paths measure authenticated in-process edge routing through terminal Scenario Engine state and `ActionGateway.waitForDeliveries()` with zero-delay test providers, asserting under 500 ms. Separate cases cover offline fallback, virtual-clock timeout, policy-approved cancellation, replay/idempotency, and encrypted export/deletion. This is a deterministic software budget, not a hardware, Hume, carrier, or manufacturer SLA.

For method-level contracts, see [AI-Native API Reference](#api-reference-ai-native). For operational failures, see [AI-Native Troubleshooting](#troubleshooting-ai-native). For a simulated partner presentation, see [Demo Script](#demo-script).

<!-- END:ai-native-integration-guide -->

<!-- BEGIN:api-reference-ai-native -->
<a id="api-reference-ai-native"></a>
## Appendix — AI-Native API Reference

Status: development prototype — local TypeScript APIs and simulated device endpoints

Last reviewed: 22 July 2026

## 1. Contract boundary

These are Veryloving-owned contracts. They are not Yongyida, Jiangzhi, Hume, clinical-device, emergency-provider, or hardware compatibility promises. Edge outputs and simulator telemetry are synthetic and non-clinical. Production use requires authenticated HTTP/service wrappers, durable repositories, secret-manager keys, approved vendor/provider contracts, and physical validation.

The APIs below are TypeScript domain APIs exercised by deterministic tests. `createAINativeSystem` provides a fail-closed composition factory, and `clm-server.cjs` mounts authenticated controllers when that durable system is injected. The command-line server does not manufacture production repositories, keys, or provider clients; those remain deployment dependencies. No endpoint should be inferred from a method signature unless it is explicitly listed in this reference.

The TypeScript classes accept an `accountId` because they are domain services. A public controller must derive that value from the verified server session. Never accept an arbitrary account ID from a request body, Hume tool arguments, edge payload, or manufacturer callback.

These domain classes do not replace the account lifecycle coordinator. Before export/deletion, the coordinator must mark the account `deleting` and reject every new state, memory, scenario, outbox, and device mutation until deletion reaches its terminal state. This prevents a concurrent compare-and-set or scenario start from recreating records after a delete scan.

Source modules:

```text
server/src/models/UserState.ts
server/src/memory/MemoryNet.ts
server/src/orchestration/ScenarioEngine.ts
server/src/orchestration/EdgeScenarioRouter.ts
server/src/orchestration/TelemetryStateIngestor.ts
server/src/orchestration/AINativeRuntime.ts
server/src/orchestration/AINativeSystem.ts
server/src/scenarios/
server/src/edge/WearableEdgeAI.ts
server/src/edge/RobotEdgeAI.ts
server/mocks/ManufacturerMockServer.ts
```

## 2. User State Model

### 2.1 Construction

```ts
const model = new UserStateModel({
  repository,             // CiphertextRepository
  encryptionKey,          // exactly 32 bytes from a server secret manager
  clock,                  // optional () => Date
  maxHistory,             // optional, default 512; valid 2..10,000
  maxIdempotencyRecords,  // optional, default 256; valid 1..2,000
  maxWriteRetries         // optional, default 32; valid 1..100
});
```

`InMemoryCiphertextRepository` is a test/development implementation. It retains only ciphertext but is not durable across process death and is not a production database. `DynamoCiphertextRepository` is the bundled durable implementation; it expects an AWS SDK v3 document client and a string-keyed `PK`/`SK` table, and it stores only opaque HMAC-derived keys plus bounded ciphertext records. A production `CiphertextRepository` must provide atomic compare-and-set semantics:

```ts
interface CiphertextRepository {
  get(storageKey: string): Promise<CiphertextRecord | null>;
  compareAndSet(
    storageKey: string,
    expectedRevision: number | null,
    next: CiphertextRecord | null
  ): Promise<boolean>;
}
```

`AccountDataCipher` derives an opaque HMAC storage key and an independent per-record key from the 32-byte master key. Records use AES-256-GCM with a 12-byte random IV and authenticated additional data containing domain, opaque storage key, and revision. `accountId` is not used as a plaintext repository key.

### 2.2 State schema

`UserStateSnapshot` has:

| Section | Fields |
| --- | --- |
| Metadata | `schemaVersion`, monotonic `revision`, `recordedAt` |
| `physical` | heart rate, HRV, steps, sleep, activity, temperature observations |
| `cognitive` | medication-adherence counts/rate, memory-assessment score, weekly engagement |
| `emotional` | mood, stress score, valence/arousal tone |
| `context` | home/away context, optional coordinates, time of day, social count, environment |
| `devices` | up to 16 wearable/home-robot records with battery, connectivity, last state, timestamp |

Observations carry their own ISO timestamp. Inputs use strict allowlists and bounded values. Examples include heart rate 20–260 bpm, HRV 0–500 ms, stress 0–100, coordinates within geographic bounds, and battery 0–100. Consult [UserState.ts](../server/src/models/UserState.ts) for the complete source-of-truth validation bounds.

`UserStateUpdate` is a partial patch by section. A property set to `null` removes that property. Supplying `devices` atomically replaces the device array.

### 2.3 Methods

| Method | Result | Semantics |
| --- | --- | --- |
| `getCurrentState(accountId)` | `UserStateSnapshot \| null` | Returns the latest immutable state for one account |
| `updateState(accountId, update, options?)` | `UserStateSnapshot` | Validates, merges, increments revision, encrypts, and conditionally persists |
| `queryTrends(accountId, query)` | `readonly TrendPoint[]` | Returns bounded, chronological observations in an inclusive UTC range |
| `exportData(accountId)` | `UserStateExport` | Returns current state and retained history for that account |
| `deleteAllData(accountId)` | `boolean` | Deletes the account's state aggregate; `false` means no record existed |

`UserStateUpdateOptions` supports:

- `idempotencyKey`: 16–128 characters from `[A-Za-z0-9_-]`. Reuse with the same update returns the original snapshot; reuse with different content fails.
- `expectedRevision`: optimistic concurrency precondition; zero represents no current state.
- `signal`: optional `AbortSignal`; cancellation is checked before and during bounded compare-and-set retries.

Trend metrics are:

```text
heart_rate_bpm
hrv_ms
steps
sleep_minutes
activity_minutes
temperature_celsius
medication_adherence_rate
memory_assessment_score
cognitive_engagement_per_week
stress_score
emotional_valence
social_interactions_today
```

`TrendQuery.limit` defaults to 1,000 and is bounded to 1–10,000. Repeated unchanged observation values/timestamps are deduplicated across state revisions.

### 2.4 Errors

| Class | Code | Meaning |
| --- | --- | --- |
| `AccountDataValidationError` | `ACCOUNT_DATA_VALIDATION` | Unsupported shape, field, identifier, timestamp, range, option, or idempotency conflict |
| `AccountDataConflictError` | `ACCOUNT_DATA_CONFLICT` | Revision precondition or bounded compare-and-set retry failure |
| `AccountDataIntegrityError` | `ACCOUNT_DATA_INTEGRITY` | Ciphertext, tag, key version, key, or authenticated metadata did not verify |

Integrity failures are fail-closed. Do not return partial plaintext or silently replace the record.
An aborted update throws an `AbortError` with code `OPERATION_CANCELLED`; callers must not convert it into a successful write.

## 3. Memory Net

Memory Net stores intentionally selected summaries for personalization and trend recall. It does not accept raw conversations, camera frames, microphone audio, voiceprints, face embeddings, provider prompts, or unrestricted health payloads.

### 3.1 Construction

```ts
const memory = new MemoryNet({
  repository,             // CiphertextRepository
  encryptionKey,          // exactly 32 bytes from a server secret manager
  clock,                  // optional () => Date
  maxMemories,            // optional, default 2,000; valid 1..100,000
  maxIdempotencyRecords,  // optional, default 256; valid 1..2,000
  maxWriteRetries,        // optional, default 32; valid 1..100
  recencyHalfLifeDays     // optional, default 30; valid 1..3,650
});
```

Memory Net reuses `CiphertextRepository` and `AccountDataCipher`. Its opaque index uses the separate `memory-net` domain, so it does not share a storage key or derived data key with User State. `InMemoryCiphertextRepository` remains test/development-only and is not process-durable.

### 3.2 Memory kinds

| Kind | Required content | Purpose |
| --- | --- | --- |
| `conversation_summary` | summary, occurrence time, up to 24 topics, optional emotional tone | Key interaction summary without raw transcript |
| `health_trend` | metric, weekly/monthly range, direction, summary | Bounded longitudinal summary |
| `life_event` | summary, occurrence time, salience 0–1, up to 24 tags | User-shared notable event |
| `preference` | category, value, optional preferred time of day | Personalization preference |

Every input also has an allowlisted `source` (`user`, `wearable`, `home_robot`, or `system`) and a bounded caller-owned `id`. Summaries are limited to 2,000 characters; a preference value is limited to 512. Stored entries add `createdAt`, `updatedAt`, and `recordRevision`.

`RelationshipMetadata` stores `interactingSince`, `interactionCount`, a 0–100 user-controlled `trustLevel`, optional `lastInteractionAt`, update time, and revision. Trust level is a personalization signal only; it must never grant authorization, skip consent, or weaken a safety rule.

### 3.3 Methods

| Method | Result | Semantics |
| --- | --- | --- |
| `storeMemory(accountId, input, options?)` | `MemoryEntry` | Creates or replaces one bounded memory by ID |
| `listMemories(accountId, query?)` | `readonly MemoryEntry[]` | Returns a kind-filtered page for that account |
| `recall(accountId, query?)` | `readonly RecalledMemory[]` | Filters and deterministically ranks by term overlap, recency, and life-event salience |
| `getTrendSummaries(accountId, query?)` | `readonly HealthTrendMemory[]` | Returns newest matching weekly/monthly trends |
| `updateRelationship(accountId, update, options?)` | `RelationshipMetadata` | Partially updates relationship metadata |
| `getRelationshipMetadata(accountId)` | metadata or `null` | Retrieves current relationship metadata |
| `deleteMemory(accountId, memoryId)` | `boolean` | Deletes one account-owned memory; `false` means absent |
| `clearAllMemories(accountId, options?)` | `boolean` | Linearizably resets memories, relationship metadata, and receipts while allowing new user-approved memories later |
| `exportData(accountId)` | `MemoryExport` | Exports relationship metadata and retained summaries |
| `deleteAllData(accountId)` | `boolean` | Account-erasure primitive: deletes the aggregate and installs a non-reopenable local fence; do not use it for an ordinary “clear memories” control |

`MemoryMutationOptions.idempotencyKey` uses the same 16–128 character bound as User State. The same key and mutation return the prior result; reuse for different content fails. An optional `signal` aborts before or during bounded compare-and-set retries.

`MemoryListQuery` supports optional `kind`, `offset` 0–100,000 (default 0), and `limit` 1–500 (default 100). Callers should page rather than attempting to load the full retained set.

`RecallQuery` supports optional text `query` (maximum 500 characters), one to four `kinds`, inclusive `since`/`until`, and `limit` 1–100 (default 10). A supplied text query requires at least one lexical token overlap; no semantic/vector service is implied. The returned `score` is a deterministic local value from 0–1, not model confidence or truth probability. Tokenization is case-normalized and the ranking combines lexical overlap, exponential recency, and life-event salience.

`TrendSummaryQuery` supports optional metric, intersecting date range, and limit 1–1,000 (default 52).

Memory mutation/validation uses `AccountDataValidationError` and bounded contention uses `AccountDataConflictError`; ciphertext failures use `AccountDataIntegrityError`. An aborted mutation throws `AbortError` / `OPERATION_CANCELLED`. Recalled text remains untrusted user context and cannot alter tool policy, device binding, consent, or scenario authorization.

## 4. Scenario Engine

### 4.1 Construction

```ts
const runtime = new ActionGatewayScenarioRuntime(dependencies);
const engine = new ScenarioEngine({
  definitions: createDefaultScenarioDefinitions(),
  runtime,
  repository,             // optional; in-memory default is test/development only
  identitySecret,         // at least 32 bytes
  identityKeyVersion,     // optional positive integer; default 1
  now,                    // optional Unix-millisecond clock
  maxConcurrentExecutions,
  maxPendingExecutions,
  maxPendingPerAccount,
  criticalReservedSlots,
  maxCriticalPendingExecutions,
  maxCriticalPendingPerAccount,
  maxTriggerAgeMs,
  triggerFutureSkewMs,
  defaultStepTimeoutMs,
  enabled,                // Partial<Record<ScenarioId, boolean>>
  onRecoveryRequired      // optional async critical-orphan escalation
});
```

Defaults and bounds:

| Option | Default | Valid range |
| --- | --- | --- |
| `maxConcurrentExecutions` | 8 | 1–100 |
| `maxPendingExecutions` | 1,000 | 1–100,000 standard/background executions |
| `maxPendingPerAccount` | 50 | 1–1,000 standard/background executions |
| `criticalReservedSlots` | 1 | 1–16 additional Critical execution lanes |
| `maxCriticalPendingExecutions` | 32 | 1–1,000 Critical executions |
| `maxCriticalPendingPerAccount` | 4 | 1–100 Critical executions |
| `maxTriggerAgeMs` | 300,000 | 1,000–86,400,000 |
| `triggerFutureSkewMs` | 60,000 | 0–300,000 |
| `defaultStepTimeoutMs` | 30,000 | 10–1,800,000 |
| `identityKeyVersion` | 1 | 1–1,000,000 |

The identity secret produces HMAC-derived account, trigger, idempotency, and device references. Scenario snapshots do not contain the plaintext account ID, event ID, idempotency key, device IDs, trigger data, workflow input, action parameters, health values, location, or conversation text.

`InMemoryScenarioExecutionRepository` is development/test-only and loses executions at process death. `DynamoScenarioExecutionRepository` supplies the durable account-partitioned contract with transactional admission, deletion fencing, stale-version protection, bounded listing/export/deletion, and an `ALL`-projected `GSI1PK`/`GSI1SK` created-at index. Trigger/input payloads are intentionally not persisted, so the engine never blindly resumes an orphan. `reconcileAccountAfterRestart` shares the account maintenance fence with scheduling/deletion, invokes `onRecoveryRequired` before failing a Critical orphan, and rejects without that provider. A deployment still needs account enumeration, one recovery lease owner, idempotent escalation, and crash testing; durable storage alone does not provide distributed execution ownership.

### 4.2 Scenario identifiers

| ID | Definition version | Allowed trigger types | Priority | Purpose |
| --- | ---: | --- | --- | --- |
| `fall_detection` | 1 | `wearable_fall`, `robot_fall` | Critical | Robot navigation/check followed by emergency fallback |
| `medication_adherence` | 1 | `medication_due` | Standard | Robot reminder, wearable confirmation, push/SMS escalation |
| `emotional_check_in` | 1 | `wearable_stress` | Standard | Calming check-in and bounded emotional summary |
| `cognitive_engagement` | 1 | `bedroom_inactivity` | Background | Activity check and allowlisted engagement prompt |
| `ai_angel_auto_dial` | 1 | `panic_button`, `voice_emergency`, `robot_help_request` | Critical | Wearable emergency path, robot context, and SMS fallback |

The priorities above are the default workflow policy; [the scenario definitions](../server/src/scenarios/) are the source of truth.

### 4.3 Start request

```ts
interface ScenarioStartRequest {
  scenarioId: ScenarioId;
  trigger: {
    eventId: string;
    type: string;
    occurredAt: number;
    data?: Readonly<Record<string, ScenarioJson>>;
  };
  devices: {
    wearableId?: string;
    homeRobotId?: string;
  };
  idempotencyKey: string;
  input?: Readonly<Record<string, ScenarioJson>>;
}
```

Identifiers are bounded. Trigger `data` and workflow `input` are each bounded to 16 KiB of JSON and remain ephemeral. The trigger must be within the configured freshness/skew window and its type must appear in that scenario definition's allowlist; otherwise the engine rejects it with `TRIGGER_NOT_ALLOWED`.

### 4.4 Methods

| Method | Result | Semantics |
| --- | --- | --- |
| `setEnabled(scenarioId, enabled)` | `void` | Enables/disables a known definition for new starts |
| `listDefinitions()` | ID/priority/description list | Returns safe definition metadata, not executable closures |
| `startScenario(accountId, request)` | `ScenarioStartResult` | Validates and queues; returns immediately with `duplicate` status |
| `executeScenario(accountId, request)` | `ScenarioExecutionSnapshot` | Starts/joins and waits for terminal completion |
| `waitForCompletion(accountId, executionId)` | snapshot | Waits for an in-process execution or returns stored terminal/current state |
| `reconcileAccountAfterRestart(accountId)` | reconciled snapshots | Fails orphaned work closed; Critical records require recovery-provider escalation first |
| `getExecution(accountId, executionId)` | snapshot or `undefined` | Account-scoped lookup |
| `listExecutions(accountId, limit?)` | snapshots | Newest-first; the provided repository owns and must enforce pagination/bounds (the included in-memory repository accepts 1–500) |
| `exportExecutions(accountId)` | all snapshots | Exhaustive account export; the durable repository must paginate internally |
| `cancelScenario(accountId, executionId)` | snapshot | Cancels queued/running work where possible; terminal executions remain terminal |
| `deleteAccountData(accountId)` | deleted count | Aborts account work and removes its scenario records |

Stable scenario error codes include `SCENARIO_UNKNOWN`, `SCENARIO_DISABLED`, `SCENARIO_NOT_FOUND`, `SCENARIO_CAPACITY_EXCEEDED` (HTTP-style status 429), `TRIGGER_NOT_ALLOWED`, `TRIGGER_NOT_FRESH`, `IDEMPOTENCY_CONFLICT`, `ACCOUNT_DATA_DELETED`, `RECOVERY_HANDLER_MISSING`, `DEVICE_UNAVAILABLE`, `ACTION_OUTCOME_UNTRACKABLE`, `ACTION_OUTCOME_TRACKING_UNAVAILABLE`, `RUNTIME_DEPENDENCY_MISSING`, `STEP_TIMEOUT`, and `USER_CANCELLED`. Validation `TypeError` messages remain generic and must not be reflected with raw request data.

Execution states: `queued`, `running`, `completed`, `fallback_completed`, `failed`, `cancelled`.

Step states: `pending`, `running`, `succeeded`, `failed`, `fallback_succeeded`, `cancelled`, `skipped`.

Each step snapshot stores only bounded operation metadata, timestamps, latency, outcome/error code, and—when used—per-fallback operation results. It does not persist the ephemeral trigger/input/result payloads or action parameters.

`fallback_succeeded` means the compensating operation ran; it does not retroactively make the primary delivery successful. Downstream conditions receive a failed primary result with `FALLBACK_SUCCEEDED` and `fallbackExecuted: true`, preventing a notification fallback from being mistaken for a robot/device success.

Every persisted execution records `schemaVersion: 1`, the scenario `definitionVersion`, and an `identityKeyVersion`, giving repository migrations an explicit discriminator rather than a guess. The engine accepts one active identity secret and does not itself provide a historical keyring or re-key job; those are separate production requirements. A production repository must reject unknown schema versions and stale writes.

Cancellation cannot retract a side effect already accepted by an external transport. The cancellation snapshot records `requestedAt`, a bounded `robotEmergencyStop` compensation outcome when navigation may be active, and sorted `nonRetractable` side-effect labels. Callers must display this distinction and must not translate `cancelled` into “every physical effect stopped.”

### 4.5 Operations and runtime

Scenario definitions may use only these operation kinds:

| Kind | Role |
| --- | --- |
| `device_action` | Routes an allowlisted wearable or robot action through Action Gateway; optional `cameraSessionScope` injects a server-derived `session_id` |
| `device_action_batch` | Dispatches a bounded group of independent device actions concurrently through Action Gateway |
| `hume_session` | Starts `voice_check`, `calming`, `cognitive_game`, or `emergency_call` through an injected provider |
| `wait_for_signal` | Awaits user response, pillbox approach, medication taken, or caregiver acknowledgement |
| `notification` | Requests an injected user/caregiver/emergency-contact notification template |
| `sms` | Requests an injected caregiver/emergency-contact SMS template |
| `read_state` | Reads steps, last location, medication adherence, or stress trend |
| `update_state` | Applies a strict `UserStateUpdate`, static or derived from prior bounded step results |
| `append_memory` | Stores a strict `MemoryInput`, static or derived from prior bounded step results |
| `analytics` | Records a bounded scenario event |

Each step may gate execution with `when`, define compensating `fallback` operations, continue after an unhandled failure with `continueOnFailure`, or terminate the remaining sequence explicitly with `stopAfterFallback` / `stopAfterSuccess`. Branch termination finalizes still-pending steps as `skipped`; use it for immediate safety escalation when further robot interaction would be misleading.

`ActionGatewayScenarioRuntime` converts these operations into injected, server-owned dependencies. It creates stable child idempotency keys as `scenario_<43-character base64url SHA-256 digest>` (52 characters total), which satisfies the Action Gateway, User State, and Memory Net key allowlists without exposing an execution or operation identifier. Missing optional providers fail with `RUNTIME_DEPENDENCY_MISSING`; the Scenario Engine then applies the configured fallback/failure policy.

For `share_camera_view`, `cameraSessionScope` is converted through the runtime's server-secret `opaqueReference` function using the account reference, execution ID, and scope. Delivery counts as camera-ready only when the authenticated action outcome returns both `camera_ready: true` and the exact expected `camera_session_ref`. A notification with `includeCameraLink` uses the same opaque scope; workflow conditions select the camera-link branch only after that correlation. The reference is not itself a public URL, and raw trigger IDs are never used as media-session tokens.

A `wait_for_signal` operation may include `observe` signals collected by the provider, an absolute `deadlineAt`, and `replayFrom: 'operation_start'` when a later phase must not consume a signal already used by an earlier phase. The engine caps its timeout at the remaining deadline. Medication adherence uses one schedule-relative deadline while observing pillbox approach, so sequential waits cannot silently turn a 15-minute policy into 30 minutes. Emotional/cognitive workflows interpret no response only from an explicit result with `data.responded === false` (status `succeeded` or intentional `not_found`); timeout/provider failure remains infrastructure failure. `idempotencyScope` may deliberately deduplicate semantically identical provider fallbacks reached through different branches.

The Action Gateway remains responsible for validating action/device combinations, resolving active bindings, signing envelopes, per-device queues, durable outbox/ACK handling, replay protection, and binding-epoch fencing.

### 4.6 Action Gateway extensions

The existing `ActionGateway` exposes server-side coordination methods:

| Method | Result | Semantics |
| --- | --- | --- |
| `routeMany(userId, actions, { mode?, signal? })` | settled result per input | Validates 1–10 idempotent actions, then dispatches in `parallel` (default) or `sequential` mode with linked cancellation |
| `startScenario(userId, request)` | `ScenarioStartResult` | Delegates to the configured Scenario Engine |
| `cancelScenario(userId, executionId)` | execution snapshot | Account-scoped cancellation delegate |
| `getScenarioExecution(userId, executionId)` | snapshot or `undefined` | Account-scoped status delegate |

Every `routeMany` child requires an idempotency key. A duplicate child identity in one batch is rejected. Runtime failures are returned as privacy-safe settled entries so one offline device does not erase another device's result. If no Scenario Engine is injected, scenario methods fail with `SCENARIO_ENGINE_UNAVAILABLE`; they do not silently fall back to unrestricted action routing.

`route(userId, action, { signal? })` checks cancellation before validation, device/binding/status resolution, durable enqueue, each queued transport attempt, and acknowledgement waiting. A pre-dispatch robot abort persists `ACTION_CANCELLED`; cancellation after transport invocation or HTTP 202 persists `ACTION_CANCELLED_NON_RETRACTABLE`. Wearable cancellation after WebSocket send rejects with `ACTION_CANCELLED` plus `nonRetractable: true`. These outcomes mean local waiting stopped; they are never evidence that hardware stopped or ignored the command. The current terminal record wins over a late vendor ACK, so retaining that late acknowledgement as separate audit evidence remains a production outbox-schema requirement.

### 4.7 Concrete AI-native runtime

`createAINativeScenarioRuntime(providers)` in [AINativeRuntime.ts](../server/src/orchestration/AINativeRuntime.ts) creates an `ActionGatewayScenarioRuntime` backed by concrete `UserStateModel` and `MemoryNet` instances. Providers supply:

```text
actionGateway
userState
memoryNet
accountLifecycle   // required AINativeAccountLifecycle shared with privacy coordination
beginHumeSession
authorizeHumeContext
waitForSignal
notify
sendSms
recordAnalytics
```

Provider contracts are server-side and account-scoped:

| Provider | Contract |
| --- | --- |
| `actionGateway.route` | Routes one validated action using the scenario's abort signal and stable child idempotency key |
| `beginHumeSession` | `(accountId, boundedRequest, AbortSignal) => Promise<unknown>` |
| `authorizeHumeContext` | Durable consent check `(accountId, "scenario_voice" | "general_voice", AbortSignal) => Promise<boolean>`; only exact `true` permits state/memory disclosure |
| `waitForSignal` | `(accountId, signalType, AbortSignal, { executionId, operationId, sinceAt, deadlineAt?, observe }) => Promise<ScenarioOperationResult>` |
| `notify` / `sendSms` | `(accountId, allowlistedRequest, { idempotencyKey, signal })`; provider acceptance is not proof of delivery |
| `recordAnalytics` | `(accountId, boundedEvent, { idempotencyKey, signal })`; event data does not repeat the plaintext account ID |

User State reads receive the operation abort signal. State updates and Memory Net appends receive the stable child idempotency key plus that signal; the concrete wrapper passes the key into each encrypted store and fails closed on an invalid update or memory shape.

The Hume wrapper reads current state, up to five recalled summaries, and relationship metadata. It sends a bounded projection: selected physical/cognitive/emotional/context values; summarized memories; relationship count/trust/time; device type/connectivity/battery; and opaque scenario/execution routing metadata. It explicitly removes `target_device_id` and omits precise coordinates, raw transcripts, audio, video, and unrestricted store records. These minimization rules do not replace consent or Hume's production data-processing review.

State selectors map to current steps, location, medication-adherence, or stress observations. Scenario update/memory operations are translated to the strict User State and Memory Net contracts before persistence; invalid shapes fail closed.

### 4.8 Account lifecycle and privacy fencing

`AINativeAccountLifecycle` exposes:

| Method | Result | Semantics |
| --- | --- | --- |
| `run(accountId, parentSignal, operation)` | operation result | Rejects fenced accounts, links cancellation, and tracks/drains in-flight account work |
| `deleteAccountData(accountId, dependencies)` | `{ scenarioExecutionsDeleted, userStateDeleted, memoriesDeleted, externalProviderDataDeleted: true }` | Fences Action Gateway and Scenario Engine, drains active work, then deletes encrypted aggregates and external provider/analytics data |

Deletion dependencies are the same `actionGateway`, `scenarioEngine`, `userState`, and `memoryNet` instances used by the runtime, plus mandatory `deleteExternalProviderData(accountId)`. That idempotent callback erases scenario analytics and provider-owned Hume/signal records. `actionGateway.fenceUserActions` is mandatory; deletion fails closed with `ACCOUNT_FENCE_UNAVAILABLE` if the durable action fence is missing. The method returns `externalProviderDataDeleted: true` only after the callback resolves. A fenced lifecycle is intentionally not reopened.

The runtime requires `accountLifecycle`; use the same instance in the privacy coordinator. Providers must honor abort signals and make side effects and deletion retries idempotent.

### 4.9 AI-native system composition

`createAINativeSystem(options)` in [AINativeSystem.ts](../server/src/orchestration/AINativeSystem.ts) is the supported composition boundary for the AI-native domain. It rejects missing repository capabilities or external privacy methods and returns one frozen object; the factory cannot prove that an implementation is process-durable, so production deployment validation must supply and test durable implementations:

```ts
interface AINativeSystem {
  userState: UserStateModel;
  memoryNet: MemoryNet;
  accountLifecycle: AINativeAccountLifecycle;
  scenarioEngine: ScenarioEngine;
  edgeScenarioRouter: EdgeScenarioRouter;
  getVoiceContext(accountId: string, signal?: AbortSignal): Promise<Record<string, unknown>>;
  memory: {
    store(accountId: string, input: MemoryInput, options: MemoryMutationOptions & { idempotencyKey: string }): Promise<MemoryEntry>;
    list(accountId: string, query?: MemoryListQuery, signal?: AbortSignal): Promise<readonly MemoryEntry[]>;
    delete(accountId: string, memoryId: string, signal?: AbortSignal): Promise<boolean>;
    deleteAll(accountId: string, signal?: AbortSignal): Promise<boolean>;
  };
  privacyRepository: {
    exportUserData(accountId: string): Promise<unknown>;
    deleteUserData(accountId: string): Promise<unknown>;
  };
}
```

Required options are the Action Gateway (including outcome waiting and account fencing), ciphertext and scenario repositories, either a legacy 32-byte encryption key or a versioned encryption keyring, scenario identity secret, Hume consent/session, signal, notification, SMS, and analytics providers, plus `externalPrivacyProvider` with both `exportUserData(accountId, signal)` and `deleteUserData(accountId)`. Every required method is checked when the factory is constructed. The export provider must honor its `AbortSignal`; deletion can then fence and drain a concurrent export. Optional bounded Scenario Engine and Edge Scenario Router policy values are accepted under `scenario` and `edge`; runtime objects containing unsupported override keys are rejected so policy cannot replace the factory's repositories, runtime, engine, or telemetry ingestor.

The factory registers all five default scenario definitions, creates the shared deletion lifecycle, and wires telemetry ingestion into edge routing. Its privacy export joins encrypted state, summary memory, every scenario snapshot through `listAll`, and provider-owned export data. Its deletion path uses the shared fence and does not report `externalProviderDataDeleted: true` until the provider erasure resolves.

This is a domain composition API, not a credential or database factory. `clm-server.cjs` consumes an injected instance for its authenticated controllers. Callers must not represent the path as deployed until durable implementations, startup recovery ownership, credentials, ingress authentication, and environment-specific validation are present.

### 4.10 Edge Scenario Router

`EdgeScenarioRouter` is a post-authentication domain router. Construct it with a Scenario Engine and optional policy:

| Option | Default | Valid range |
| --- | --- | --- |
| `maxTelemetryAgeMs` | 30,000 | 1,000–300,000 |
| `maxFutureSkewMs` | 2,000 | 0–60,000 |
| `fallConfidenceThreshold` | 0.8 | 0–1 |
| `stressThreshold` | 70 | 0–100 |
| `helpConfidenceThreshold` | 0.75 | 0–1 |
| `fallEpisodeCooldownMs` | 5,000 | 1,000–300,000 |
| `stressEpisodeCooldownMs` | 900,000 | 10,000–86,400,000 |
| `helpEpisodeCooldownMs` | 30,000 | 1,000–1,800,000 |
| `episodeSourceStaleMs` | `max(30,000, maxTelemetryAgeMs)` | 1,000–3,600,000 |
| `maxEpisodeKeys` | 1,000 | 10–100,000 |
| `telemetryPersistenceTimeoutMs` | 100 | 10–5,000 |
| `robotSafetyMaxAgeMs` | 5,000 | 500–30,000 |

`telemetryStateIngestor` is the optional encrypted-state sink used before scenario routing. Persistence is bounded by `telemetryPersistenceTimeoutMs`; an error or timeout is reported through `onTelemetryPersistenceFailure('TELEMETRY_STATE_PERSIST_FAILED')` without making a life-safety trigger wait indefinitely. `robotSafetyMaxAgeMs` bounds how long a positive robot `safeToMove` observation may authorize the fall workflow's navigation branch.

Methods:

| Method | Mapping |
| --- | --- |
| `ingestWearableInference(accountId, envelope, binding, context?)` | High-confidence fall → `fall_detection`; threshold stress → `emotional_check_in` |
| `ingestRobotInference(accountId, envelope, binding, context?)` | High-confidence vision fall → `fall_detection`; help intent → `ai_angel_auto_dial`; local `cancel` intent → `cancellationRequested` only |
| `ingestContextEvent(accountId, event, binding)` | Medication due → `medication_adherence`; bedroom inactivity → `cognitive_engagement`; panic/voice emergency → `ai_angel_auto_dial` |
| `confirmCancellation(accountId, executionId, confirmation)` | Cancels that non-terminal execution only after an authenticated-user or authorized-caregiver confirmation |

`EdgeDeviceBinding` contains command targets and separately authenticated wearable/robot source references. The router rejects a source mismatch, malformed envelope/model metadata, stale/future observation, mutated same-sequence frame, or lower sequence before starting a scenario. Accepted frames for one source execute in sequence; failed exact frames may retry without lowering the high-water mark. It creates deterministic edge/context event and idempotency identifiers, coalesces continuous fall/stress/help episodes across sources, shares an in-flight episode start, rolls back admission after a transient start failure, applies bounded cooldowns, and expires a positive source after transport loss. Robot fall context carries `safeToMove`; a wearable fall authorizes navigation only from fresh authenticated robot safety telemetry. `EdgeRoutingResult.started` contains accepted scenario starts and may report `cancellationRequested`.

A bound robot's probabilistic local `cancel` intent never cancels an execution by itself. A trusted controller must correlate the request to a specific execution and obtain an authenticated user or authorized-caregiver confirmation before invoking `confirmCancellation`. Physical deployment still requires approved speaker/liveness and non-cancellable-side-effect rules.

The confirmation object is exactly `{ confirmed: true, source: 'authenticated_user' | 'authorized_caregiver', occurredAt }`. Its timestamp must pass the same freshness policy, and the referenced execution must exist in that account and remain non-terminal.

Errors are `EdgeScenarioRouterError` with `EDGE_EVENT_INVALID`, `EDGE_EVENT_STALE`, or `EDGE_SOURCE_MISMATCH`; messages omit raw telemetry and identity. Transport authentication and account binding retrieval happen before this API and must not be inferred from a matching source string alone.

## 5. Wearable Edge AI simulator

### 5.1 Construction and methods

```ts
const edge = new WearableEdgeAI({
  clockNow,       // optional () => Unix milliseconds
  random,         // optional deterministic generator
  staleAfterMs,   // optional, default 30,000
  maxFutureSkewMs // optional, default 2,000
});

const frame = edge.generateFrame({
  deviceRef: 'simulated-wearable',
  sequence: 1,
  profile: 'fall',
  batteryLevelPercent: 82
});
const envelope = edge.infer(frame);
const json = edge.serializeOutbound(envelope);
```

Profiles: `resting`, `walking`, `running`, `fall`, `stressed`.

`WearableSensorFrame` uses contract `vl-wearable-sensors/1` and contains a 32-sample synthetic accelerometer window, heart rate, HRV RMSSD, signal quality, skin temperature, and battery estimate. `WearableInferenceEnvelope` uses `vl-wearable-inference/1` and returns:

- `fallDetected` and `fallConfidence`;
- `stressScore` from 0–100;
- activity `resting`, `walking`, `running`, or `fall`;
- engineering-only estimated energy and daily additional drain.

The model metadata always declares `deterministic-simulation` and `clinicallyValidated: false`. The estimates do not close the target-hardware `<100 ms` or `<10% additional drain/day` acceptance gates.

`serializeOutbound` validates the envelope and rebuilds JSON from an explicit allowlist. Extra properties attached by an untyped caller—including raw sensor samples or unrelated private data—are not relayed.

`createWearableSeededRandom(seed)` supplies deterministic non-cryptographic randomness. Never use it for identifiers, keys, tokens, signatures, or security decisions.

### 5.2 Provisional firmware contract

`WEARABLE_EDGE_CONTRACT` specifies a Veryloving-owned boundary:

- input/output versions listed above;
- CBOR on firmware and structurally equivalent JSON in simulation;
- `uint16 length + uint32 sequence + payload + CRC32` framing;
- BLE GATT notification from firmware with mobile-to-cloud relay;
- maximum 4,096-byte frame;
- accelerometer in g, PPG heart rate in bpm, HRV RMSSD in ms, temperature in °C, UTC epoch-ms timestamps;
- proposed ARM Cortex-M4F/M33, 80 MHz, 256 KiB RAM, 1 MiB flash, int8 TFLM/equivalent target.

The production candidate recorded in the contract is an int8 1D depthwise-separable CNN with three temporal blocks, input tensor `[1, 128, 5]` (accelerometer x/y/z, normalized PPG, temperature delta), and separate fall-probability, stress-regression, and activity-softmax heads, capped at 120,000 parameters. This is a design candidate—not a trained artifact or validated model.

Manufacturer UUIDs, calibration, electrical behavior, processor resources, model accuracy, actual inference time, and battery measurements remain **BLOCKED — EXTERNAL**.

Errors are `WearableEdgeAIError` with `EDGE_INPUT_INVALID` or `EDGE_INPUT_STALE`. Error messages deliberately omit device/sensor values.

## 6. Robot Edge AI simulator

### 6.1 Construction and methods

```ts
const edge = new RobotEdgeAI({
  clockNow,
  random,
  staleAfterMs,   // optional, default 5,000
  maxFutureSkewMs // optional, default 1,000
});

const frame = edge.generateFrame({
  deviceRef: 'simulated-home-robot',
  sequence: 1,
  profile: 'help_request'
});
const envelope = edge.infer(frame);
const json = edge.serializeOutbound(envelope);
```

Profiles: `idle`, `navigating`, `fall`, `distressed`, `help_request`, `happy`.

`RobotEdgeFeatureFrame` (`vl-robot-edge-features/1`) contains bounded derived vision, acoustic/prosody, and motor features. It contains no bitmap, raw audio, transcript, voiceprint, or facial embedding. `RobotEdgeInferenceEnvelope` (`vl-robot-edge-inference/1`) returns:

- vision fall classification/confidence and a coarse facial-expression label;
- local voice intent/emotion/confidence with `processedOffline: true` for the simulator;
- motor state and `safeToMove` heuristic;
- metadata declaring deterministic simulation, no clinical validation, and no raw-media retention.

`serializeOutbound` validates the envelope and emits only the allowlisted inference fields; appended media, transcript, biometric, or private properties are stripped.

`createRobotSeededRandom(seed)` is deterministic and non-cryptographic. Errors are `RobotEdgeAIError` with `EDGE_INPUT_INVALID` or `EDGE_INPUT_STALE` and privacy-safe text.

### 6.2 Provisional hardware contract

`ROBOT_EDGE_CONTRACT` proposes:

- camera capture as RGB/NV12, at least 720p/15 fps, with features leaving the camera process;
- microphone capture as signed 16-bit little-endian mono PCM at 16 kHz, with derived features leaving the audio process;
- versioned CBOR over UART/USB CDC, COBS framing, sequence/timestamp/CRC, provisional 921,600 baud, and 16,384-byte maximum frames;
- manufacturer-approved fail-safe emergency-stop GPIO and optional inference-ready GPIO;
- 64-bit four-core ARM, at least 2-TOPS NPU/equivalent GPU, 4 GiB RAM, and 16 GiB available storage as proposed minimums.

Candidate production models are quantized pose features plus a temporal 1D CNN for fall detection, a quantized MobileNetV3-Small expression classifier with no embedding retention, and small-footprint keyword/intent plus prosody classifiers for offline voice. They are architecture candidates only.

Connector, voltage, GPIO polarity, serial speed, camera/microphone implementation, motor-controller safety, model/runtime compatibility, thermal behavior, and measured latency remain **BLOCKED — EXTERNAL**.

## 7. Authenticated server transport API

These controllers are mounted by [clm-server.cjs](../server/clm-server.cjs) only when an injected AI-native system and the required trust hooks are available. `accountId`, command device IDs, source bindings, fall-navigation safety, and cancellation identity are derived server-side; none may be supplied as arbitrary client fields.

| Route | Authentication | Exact purpose |
| --- | --- | --- |
| `POST /v1/scenarios` | First-party app JWT | Starts one of the five fixed user intents. Every request supplies `scenario_id`, `request_id`, and `occurred_at`; fall, medication, emotional, and cognitive requests also supply their exact server-defined `intent`; emotional and cognitive requests require their bounded scenario-specific `context`. Device targets are always resolved server-side. |
| `GET /v1/scenarios/executions?limit=` | First-party app JWT | Lists only the authenticated account's bounded execution snapshots for process recovery and live status reconciliation. |
| `GET /v1/scenarios/{executionId}` | First-party app JWT | Returns that account's execution snapshot or 404 |
| `POST /v1/scenarios/{executionId}/cancel` | First-party app JWT | Requires exactly `{ confirmed: true, occurred_at }`; the server supplies authenticated-user cancellation identity |
| `POST /v1/scenarios/{executionId}/feedback` | First-party app JWT | Accepts only a bounded helpful/not-helpful rating for an account-owned terminal execution. |
| `POST /v1/interaction-feedback` | First-party app JWT | Accepts a bounded voice-call rating only after the shared voice gateway proves the exact account-bound interaction completed explicitly. |
| `POST /v1/edge/wearable/inference` | First-party app JWT | Accepts exactly `{ envelope, context? }`; `resolveEdgeDeviceBinding` must bind the relayed wearable source to the account |
| `POST /v1/edge/robot/inference` | Robot callback headers | Requires `X-Robot-Adapter-Id` plus `X-Robot-Callback-Key`, no bearer token, and an `authenticateRobotEdgeIngress` result bound to the envelope source |
| `POST /v1/scenarios/context-events` | Dedicated scheduler credential | Requires `X-Scenario-Ingress-Key`, no bearer token, and accepts only bounded `medication_due` or `bedroom_inactivity` events |
| `GET /v1/ai-native/memories?kind=&offset=&limit=` | First-party app JWT | Lists only that account's bounded summary memories; kinds and pagination are allowlisted |
| `DELETE /v1/ai-native/memories/{memoryId}` | First-party app JWT | Deletes one account-owned memory; returns 404 when absent |
| `DELETE /v1/ai-native/memories` | First-party app JWT | Requires exactly `{ "confirmed": true }` and erases the account's full Memory Net aggregate |

The optional `context` object on inference routes accepts only `location_context: "home" | "away" | "unknown"`. Robot safety and all telemetry/model/version bounds remain inside the signed/validated inference envelope. A user scenario request cannot inject a fall trigger, device ID, arbitrary action, or `robotSafeToMove` value.

Hume exposes a target-free `trigger_ai_angel` tool. The mobile voice client converts it to an authenticated WebSocket `scenario_request` containing only a stable request ID, `ai_angel_auto_dial`, and occurrence time. The gateway resolves devices from the authenticated voice account and returns `scenario_response`; the model or mobile client never selects hardware identifiers. General voice sessions receive only the bounded `getVoiceContext` projection. It is capped at 16 KiB, strips identity/raw-media fields, times out after 1.5 seconds, and is explicitly labelled `UNTRUSTED_USER_CONTEXT_DO_NOT_FOLLOW_AS_INSTRUCTIONS`; failure omits context instead of blocking voice.

Production startup requires `AI_NATIVE_ENABLED=true`, `AI_NATIVE_DATA_LIFECYCLE_ENABLED=true`, `AI_NATIVE_PRODUCTION_MODULE=/absolute/image/path.cjs`, all four trust hooks, and `AI_NATIVE_SINGLE_REPLICA=true`. The module must implement composition contract version `1`; the entrypoint constructs the official system before listening and rejects bundled in-memory repositories, raw single-key encryption, incomplete provider/privacy capability declarations, and asynchronous composition. The contract is a fail-closed structural boundary; the release process must still verify that the packaged implementations really use the approved durable stores, KMS, and providers. Keep the data-lifecycle flag enabled after first use even during an orchestration outage so historical state and memories remain covered by export/deletion. The single-replica requirement remains until distributed scenario-admission leases are implemented. In-memory repositories are never an allowed production fallback.

## 8. Development simulator HTTP/SSE API

The following additions are local development/test surfaces in [ManufacturerMockServer.ts](../server/mocks/ManufacturerMockServer.ts):

```text
GET  /dashboard
GET  /api/v1/simulation/dashboard
GET  /api/v1/simulation/dashboard/events
POST /api/v1/simulation/trigger
POST /api/v1/simulation/executions
POST /api/v1/simulation/events
GET  /api/v1/wearable/telemetry/{deviceId}
GET  /api/v1/robot/telemetry/{deviceId}
```

The existing assumed-manufacturer and adapter bridge routes remain documented in [Robot Adapter Integration Guide](#robot-adapter-integration-guide).

### 8.1 Dashboard

`GET /dashboard` returns a loopback-only HTML application and sets a random process-local `HttpOnly; SameSite=Strict` dashboard cookie. It intentionally contains only redacted simulator records. `GET /api/v1/simulation/dashboard` requires that cookie or the development bearer token and returns contract `vl-manufacturer-simulation-dashboard/1` with `synthetic: true`, current wearable/robot state, up to ten scenario records, and the last ten redacted event summaries. `GET /api/v1/simulation/dashboard/events` applies the same protection and streams bounded snapshots as SSE with connection caps, heartbeat, backpressure handling, and disconnect cleanup.

The cookie-protected same-origin UI uses `POST /api/v1/simulation/trigger` to forward one exact five-scenario request to the configured loopback main server. `POST /api/v1/simulation/executions` accepts only the fixed `{ "userId": "<AI_NATIVE_DEMO_USER_ID>" }` account (default `test-user-1`) and reads its bounded main-server execution list. Both mutation routes additionally require an exact same-origin `Origin` (and, when supplied, `Sec-Fetch-Site`) header; bearer access remains available to automated local tests. Upstream destinations are fixed, loopback-only, credential-free, timed, and response-size bounded.

When the in-memory AI-native demo is enabled, its loopback wrapper accepts the five camel-case aliases at `POST /v1/scenarios` and exposes `GET /v1/scenarios/executions?userId=test-user-1`. The configured demo user is fixed by `AI_NATIVE_DEMO_USER_ID`; this does not create a caller-selectable production account API. Requests and returned snapshots are strictly validated, bounded, redacted, and unavailable in production. See [Demo Dashboard](#demo-dashboard) for the exact local shapes.

The in-process `recordScenarioExecution({ scenarioId, status, wearableDeviceId?, robotDeviceId? })` helper accepts status `started`, `completed`, `fallback`, `failed`, or `cancelled`. It one-way hashes device IDs before retaining the bounded record.

### 8.2 Event injection

`POST /api/v1/simulation/events` requires the development bearer token and exactly this shape:

```json
{
  "device_id": "simulated-wearable",
  "device_type": "wearable",
  "event_type": "fall_detected"
}
```

Allowlisted events are `fall_detected`, `stress_spike`, `medication_reminder`, `device_offline`, and `device_online`. `stress_spike` is wearable-only; `medication_reminder` is home-robot-only. A successful injection returns HTTP 201 with `accepted: true` and a synthetic event containing only a one-way device reference. Request size, identifiers, exact keys, and combinations are bounded. The route must not be generalized into arbitrary command execution or enabled in production.

Injection does not automatically start a scenario. Integration tests or a trusted local demo driver must authenticate/bind the event and call `ScenarioEngine.startScenario`; a production ingestion controller is a separate security boundary.

### 8.3 Telemetry streams

- `GET /api/v1/wearable/telemetry/{deviceId}` emits SSE event `wearable.telemetry` using contract `vl-simulation-wearable-telemetry/1`: the bounded synthetic sensor frame, inference envelope, battery, fictional location, and generated event summaries.
- `GET /api/v1/robot/telemetry/{deviceId}` emits SSE event `robot.telemetry` using contract `vl-simulation-robot-telemetry/1`: bounded derived feature/inference envelopes, motor state, and generated event summaries. It explicitly reports that raw camera and microphone data are not retained.

Both require the development bearer returned by `POST /api/v1/authenticate`, respect global stream/connection limits, handle backpressure, and stop timers/listeners on disconnect or shutdown. Neither emits real media.

For `share_camera_view`, the simulator requires one bounded opaque `session_id` and echoes it only as `camera_session_ref` with `camera_ready: true`. Missing, malformed, or URL-bearing values are rejected before a command is recorded. The response never includes a camera URL, raw frame, or media payload.

CLI behavior is controlled by bounded development variables:

```text
MOCK_MANUFACTURER_FALL_EVENT_RATE                 # 0..1, default 0.001 per device frame
MOCK_MANUFACTURER_STRESS_EVENT_RATE               # 0..1, default 0.01 per wearable frame
MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS # default 3,600; 0 disables
MOCK_MANUFACTURER_MAX_SIMULATED_DEVICES           # 1..1,000, default 100
MOCK_MANUFACTURER_TELEMETRY_INTERVAL_MS
MOCK_MANUFACTURER_SEED
```

The simulator binds to loopback by default, rejects production mode, and uses mock-only credentials. Do not deploy or reverse-proxy these routes.

## 9. Acceptance semantics

| Result | What it proves | What it does not prove |
| --- | --- | --- |
| Scenario `completed` | Configured software operations reported success | Physical assistance or human safety |
| Scenario `fallback_completed` | At least one configured fallback succeeded, or a `continueOnFailure` step left the run degraded | Physical success or notification/call/SMS delivery unless separately provider-confirmed |
| Action `accepted` | Transport/bridge accepted the action | Robot/wearable completed it |
| Authenticated ACK | Configured sender acknowledged the action | Real-world effect without vendor-defined evidence |
| Simulated edge inference | Deterministic classifier path ran | Clinical accuracy or target-hardware performance |
| Memory recall | A bounded account-owned summary matched | Truth, recency beyond metadata, or instruction authority |

See [AI-Native Integration Guide](#ai-native-integration-guide) for configuration and extension guidance and [AI-Native Troubleshooting](#troubleshooting-ai-native) for failure diagnosis.

<!-- END:api-reference-ai-native -->

<!-- BEGIN:troubleshooting-ai-native -->
<a id="troubleshooting-ai-native"></a>
## Appendix — AI-Native Troubleshooting

Status: development prototype — simulated devices and inference only

Last reviewed: 22 July 2026

## 1. Start with the assurance boundary

The local environment proves software orchestration against synthetic sensor, camera, voice, and transport events. It cannot prove real fall detection, autonomous navigation, medication ingestion, emotion accuracy, call/SMS delivery, clinical suitability, target-hardware latency, or battery impact.

Before debugging a production-style flow, identify which layer owns the failure:

1. simulated edge observation;
2. account-bound state or memory write;
3. scenario trigger and execution;
4. Action Gateway validation/signing/outbox;
5. wearable BLE or robot adapter transport;
6. asynchronous acknowledgement or fallback provider.

Keep diagnostic output privacy-safe. Never print authentication headers, keys, tokens, hardware serials, account IDs, phone numbers, medication details, health values, coordinates, raw conversations, camera frames, microphone audio, signed payloads, or action parameters. Use execution IDs, scenario IDs, step names, status codes, bounded error codes, latency, and one-way references.

## 2. Baseline checks

From the repository root:

```bash
npm run validate-env
npm run typecheck:adapters
npm run typecheck:manufacturer-mock
npm run typecheck:ai-native
npm run test:ai-native
npm test
```

For the full mobile/build gate:

```bash
npm run validate
```

Start the development simulator with deterministic happy-path behavior:

```bash
NODE_ENV=development \
MOCK_MANUFACTURER_FAILURE_RATE=0 \
MOCK_MANUFACTURER_FALL_EVENT_RATE=0 \
MOCK_MANUFACTURER_STRESS_EVENT_RATE=0 \
MOCK_MANUFACTURER_MEDICATION_REMINDER_EVERY_TICKS=0 \
npm run mock:manufacturer
```

Open `http://127.0.0.1:3001/dashboard` for the local HTML dashboard. Machine-readable state is available at `GET /api/v1/simulation/dashboard`. These routes, the event injector, and both telemetry streams are development/test-only and must never be exposed as production services.

## 3. Common startup and configuration failures

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| Simulator refuses to start | `NODE_ENV=production`, a non-loopback bind, invalid limits, or an occupied port | Use `development` or `test`, bind to `127.0.0.1`, validate numeric bounds, and select an unused `MOCK_MANUFACTURER_PORT` |
| `MOCK_MANUFACTURER_URL` rejected | URL is non-loopback, has a path/query/fragment/credentials, or is enabled in production | Use an origin such as `http://127.0.0.1:3001/` only in development/test |
| Adapter runtime reports missing build | TypeScript adapter output is absent | Run `npm run build:adapters` before starting the gateway |
| Signing-key error on signed-action mock route | Mock server lacks the matching Ed25519 public key | Configure the test public key that matches the Action Gateway test private key; never copy production keys into local files |
| Both adapters do not start | One is disabled or callback/outbound secrets collide | Enable each adapter separately and use distinct simulator-only callback placeholders; production credentials remain external |
| Hume voice flow is unavailable | Hume API/config/persona credentials are not provisioned | Exercise scenario event injection locally; Hume production behavior remains **BLOCKED — EXTERNAL** |
| Server rejects `AI_NATIVE_ENABLED` at startup | `AI_NATIVE_PRODUCTION_MODULE` is missing/relative, its versioned durable contract is incomplete, or the temporary topology gate is absent | Package a reviewed absolute-path composition module with durable repositories, an external rotation keyring, providers/privacy lifecycle, and all four trust hooks; keep `AI_NATIVE_DATA_LIFECYCLE_ENABLED=true`; set `AI_NATIVE_SINGLE_REPLICA=true` only for an intentionally single-replica deployment |
| Voice works but has no remembered context | Context read exceeded 1.5 seconds, failed validation, or was over 16 KiB | Inspect only the safe `AI_NATIVE_VOICE_CONTEXT_UNAVAILABLE` code; fix repository latency/shape and never log the omitted context |

Do not weaken production guards to make a local demo work. In particular, do not allow a remote mock URL, reuse a vendor credential as a mock key, disable action signature verification, or expose simulator routes on a public interface.

## 4. Scenario does not trigger

Check in order:

1. The scenario ID is one of `fall_detection`, `medication_adherence`, `emotional_check_in`, `cognitive_engagement`, or `ai_angel_auto_dial`.
2. The scenario is enabled in the engine configuration.
3. The authenticated controller supplied the correct `EdgeDeviceBinding`, including the expected telemetry source reference.
4. The edge/context event contract and bounded payload match the router method.
5. The event timestamp is inside the router and engine freshness windows.
6. Fall/stress thresholds are satisfied and the scenario is not merely a no-op inference.
7. The idempotency key has not already completed the same logical execution.

`EDGE_SOURCE_MISMATCH` means an envelope source does not equal the authenticated binding; do not bypass it by copying the envelope's value into the binding. `EDGE_EVENT_STALE` means the clock or event pipeline is outside the configured window. `EDGE_EVENT_INVALID` means shape, bounds, account/target identity, or policy configuration failed validation.

Use the correct ingress boundary: an app JWT may relay wearable inference, robot inference requires adapter/device callback authentication, and scheduled medication/occupancy events require the dedicated scheduler credential. Do not reuse one credential class for another route. `POST /v1/scenarios` accepts only five server-mapped user intents: fall practice, medication reminder review, emotional check-in, cognitive engagement, and AI Angel. It rejects client-selected devices and arbitrary scenario actions. Emotional check-in requires `context.mood_key` plus an optional bounded `reflection_summary`; cognitive engagement requires an allowlisted `context.activity`. AI Angel has no client context and remains the only user action that starts the real emergency workflow.

For local event injection, use `POST /api/v1/simulation/events` with the documented bounded simulator event shape, then let the trusted integration-test/demo driver map it to `ScenarioEngine.startScenario`. The injector alone does not start a workflow. The endpoint should reject malformed, oversized, unsupported, or unauthenticated input. It must not accept arbitrary commands, URLs, account selection, phone numbers, or manufacturer device identities.

If a duplicate produces no new actions, inspect the original execution: idempotent replay should return or join it. If the same key is reused with a different scenario or trigger payload, rejection is correct and prevents an accidental or malicious collision.

## 5. Scenario is stuck or out of order

| Observation | Diagnosis | Corrective action |
| --- | --- | --- |
| Execution remains active at one step | A dependency never resolved or timeout clock did not advance | Confirm every injected action returns/throws; in tests advance the controlled clock; keep timeouts bounded |
| Robot delay blocks unrelated wearable action | Shared global queue or awaited unrelated work | Preserve per-device queues and dispatch independent device branches concurrently where the workflow permits |
| Fallback runs twice | Side-effect child key is unstable or timeout and late success both won | Use stable child idempotency keys and an atomic terminal transition; ignore a late result after the fallback wins |
| Robot timeout sometimes has a different code | Durable ACK expiry raced the bounded outcome wait | Both are normalized to `ACTION_OUTCOME_TIMEOUT`; if another code appears, verify the current Scenario Engine build and Action Gateway outcome contract |
| Steps appear in the wrong sequence | Workflow definition does not express a dependency | Make the dependency explicit; do not rely on promise creation order or log timestamps alone |
| Critical work waits behind analytics | Priority scheduler or device queue did not honor priority | Confirm Critical > Standard > Background selection while preserving same-device safety ordering |
| Cancellation reports success but a call/message still happens | The side effect was already accepted externally or bytes may have left the process | Treat `ACTION_CANCELLED_NON_RETRACTABLE` or `nonRetractable: true` as unknown/possibly sent, expose that state to the UI, and preserve any late authenticated acknowledgement in the production audit schema |
| A duplicate stays `queued`/`running` after server restart | Durable snapshot survived but account reconciliation has not run | Do not start a second execution; invoke `reconcileAccountAfterRestart` under the deployment's single-owner policy and configure an idempotent Critical recovery provider |

The router reports a local robot `cancel` intent as `cancellationRequested` only. A trusted controller must correlate a specific execution and obtain an authenticated-user or authorized-caregiver confirmation before calling `confirmCancellation`. If a Critical execution stopped without that path, treat it as a safety defect; review speaker/liveness and non-cancellable-side-effect policy before hardware release.

An HTTP `202`, adapter `accepted`, or queue completion is not evidence of physical execution. Wait for the authenticated acknowledgement required by the workflow or take the documented fallback.

The engine deliberately does not resume ephemeral workflow input after process death. Its reconciliation API fails orphans closed and requires `onRecoveryRequired` before closing Critical work. Production still needs account enumeration, an explicit recovery-owner lease, provider idempotency, and deterministic crash tests.

## 6. The five scenario-specific checks

### 6.1 Fall response

- Confirm the wearable event includes the expected impact/inactivity classification and a fresh event ID.
- Confirm last location is an authorized state snapshot, not untrusted model text.
- If robot navigation fails or the robot is offline, emergency-contact fallback should begin without waiting for the voice-check timer.
- If no user response arrives, advance the configured 30-second policy timer in the test clock and verify exactly one escalation.
- If camera context is attached, verify the authenticated outcome reported `camera_ready: true` with the exact server-derived `camera_session_ref`; a generic command ACK is insufficient.
- A synthetic success does not validate physical detection, arrival, obstacle avoidance, camera coverage, or contact delivery.

### 6.2 Medication adherence

- Ensure the trigger comes from a trusted schedule and has an opaque reminder/medication identifier.
- Associate movement confirmation with the same reminder; generic steps or room movement do not prove medication ingestion.
- Advance the configurable 15-minute window in tests rather than sleeping.
- Verify push fallback precedes SMS and that both are idempotent.
- Do not log medication names, dosage, instructions, or notification bodies.

### 6.3 Emotional check-in

- Check HRV/stress sample freshness, threshold, confidence, and cooldown.
- Confirm only an explicit observer result with `responded: false` schedules the unanswered path; a timeout/provider failure must remain infrastructure failure rather than inferred silence.
- If Hume is unavailable, the implemented workflow requests the bounded `emotional_checkin_later` notification fallback; it does not fabricate a local Hume conversation.
- Treat stress/emotion outputs as wellness estimates, never diagnoses.

### 6.4 Cognitive engagement

- Validate the trusted scheduler's morning/inactivity policy and device clock/time zone. The current robot edge envelope does not report occupancy.
- Query wearable activity state after the scheduler trigger; accept only a current UTC-day step total and reject stale or regressing samples.
- Record a bounded engagement outcome only after an explicit response/no-response observation, not video or a raw conversation; observer failure should emit availability analytics.
- One missed response must not be labeled cognitive decline.

### 6.5 AI Angel auto-dial

- Confirm panic/fall/voice trigger authenticity and critical priority.
- Keep camera link creation, call initiation, and SMS as separately observable actions.
- Never build a camera link from a trigger/device ID or uncorrelated callback; the provider must resolve the opaque account/execution-scoped session only after matching readiness metadata.
- If Wi-Fi/robot delivery fails, the SMS fallback should use only the permitted location snapshot.
- The simulator does not call a person, send an SMS, or produce a real video stream. Twilio, APNs/FCM, Hume, camera authorization, and delivery verification remain external.

## 7. User State failures

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| State is absent after update | Wrong account context, validation rejection, or a non-persistent test repository | Confirm authenticated account scope, inspect the bounded error code, and use the intended repository |
| Trend query returns no samples | Time window excludes observations or field path is unsupported | Use explicit UTC bounds, check observation timestamps, and request an allowlisted trend field |
| Cross-account read succeeds | Critical authorization or encryption-context defect | Stop testing and treat as a release blocker; ensure the keyed opaque storage key is derived from the authenticated account and AES-GCM AAD binds domain, storage key, revision, and applicable key version |
| Decryption/authentication fails | Wrong key/version, corrupted ciphertext, or copied record | Fail closed; never return partial plaintext. Restore the approved key through the deployment keyring/recovery process or remove corrupted test data |
| Export omits records | Export implementation does not cover every state/history kind | Add the missing kind and a round-trip test before release |
| Delete returns but data remains | Only a cache was cleared or an external deletion is pending | Verify repository records, indexes, scenario analytics, outbox, memory, and vendor deletion workflow separately |

If a concurrent update or scenario start recreates data after deletion, the account lifecycle fence is missing or was checked too late. Transition the authenticated account to `deleting` before starting any delete and reject every new write until the complete privacy workflow finishes; do not try to solve this with a best-effort scan alone.

Encryption is not a substitute for authorization. The server must derive the account from the authenticated session; callers must not supply an arbitrary account and receive data merely because they know its identifier.

## 8. Memory Net failures

- Empty recall may be correct when no bounded record matches the requested kind, time range, or query terms.
- Unexpected recall ranking usually indicates missing source/confidence/timestamp metadata or a nondeterministic tie-breaker.
- A memory that resembles an instruction must remain quoted/untrusted context. It cannot override system policy, tool schemas, consent, device binding, or emergency rules.
- If raw transcript, audio, image, location, or health payload appears in memory, delete the test record and fix the summarization boundary.
- Specific deletion should remove only the requested account-owned memory. All-memory deletion should leave another account unchanged.
- Export must be user-readable, versioned, bounded, and free of ciphertext implementation details or secrets.

## 9. Edge simulation failures

### Wearable

Check units, sample interval, monotonic timestamps, deterministic seed, accelerometer magnitude, PPG/heart-rate bounds, temperature bounds, and output confidence. Repeated positive frames may repeat the classifier result, but `EdgeScenarioRouter` must coalesce them into one account-level fall episode until sources clear or cool down. A stress spike should use the documented HRV relationship but must remain labeled synthetic and non-clinical.

### Robot

Check camera-feature bounds, microphone-feature format, expression/fall labels, motor safety, sequence number, and deterministic seed. Occupancy and camera-ready are not robot edge outputs: the former is scheduler policy and the latter is a correlated manufacturer ACK. Raw simulated camera/microphone data should not be logged. If an offline result is expected, verify it queues or emits an explicit offline status instead of silently pretending cloud delivery succeeded.

If an edge envelope triggers correctly but no current-state projection appears, confirm the composed router has a `TelemetryStateIngestor`, check the bounded `TELEMETRY_STATE_PERSIST_FAILED` health signal, and verify that the durable store can meet the 100 ms default `telemetryPersistenceTimeoutMs`. State projection is best-effort on this path: do not duplicate a life-safety scenario merely because persistence timed out. A robot `safeToMove` value is also short-lived; check `robotSafetyMaxAgeMs` and the observation timestamp before treating skipped navigation as a defect.

### Hardware performance claims

Node.js elapsed time is not Cortex-M, Android NPU/GPU, or end-to-end hardware latency. Do not close the `<100 ms` wearable inference or battery `<10% per day` requirements with simulator measurements. Profile the signed release model on final hardware under representative sensor/radio/thermal conditions.

## 10. Simulator dashboard and streams

Development/test-only surfaces:

```text
GET  /dashboard
GET  /api/v1/simulation/dashboard
POST /api/v1/simulation/events
GET  /api/v1/wearable/telemetry/{deviceId}
GET  /api/v1/robot/telemetry/{deviceId}
```

If an SSE stream connects but emits nothing:

- confirm the bearer/API contract expected by the simulator;
- confirm the requested logical device identifier is valid;
- confirm the telemetry interval and connection/stream limits;
- inspect the JSON dashboard for online state;
- ensure the client consumes SSE records and has not paused indefinitely under backpressure.

If the dashboard is stale, fetch the JSON route directly. The HTML view is a projection, not a system of record. Restarting the simulator intentionally resets its in-memory development state.

## 11. Latency and performance tuning

The integration target for automated simulated scenarios is event-to-final-software-action under 500 ms where the workflow has no intentional human wait. Measure at least:

- trigger validation;
- state read/write;
- queue wait per device;
- adapter request and retry;
- scenario step/fallback transition;
- total elapsed time using a monotonic clock.

Do not include a 30-second response window or 15-minute medication window in the immediate-dispatch latency assertion; test timer policy separately with a fake clock. Report p50, p95, and p99 over a meaningful sample size. A single fast local run is not a production SLA.

For memory/soak diagnosis, monitor active timers, SSE clients, sockets, per-device queues, idempotency records, scenario executions, retained history, and heap after forced quiescence. Every subscription, timer, abort handler, and socket must be released during shutdown.

## 12. Escalation criteria

Stop and treat the issue as a release blocker if any test shows:

- cross-account state, memory, device, or scenario access;
- plaintext health/context/memory at rest or sensitive values in logs;
- unsigned, expired, replayed, cross-adapter, or old-binding actions being accepted;
- duplicate emergency/contact side effects for one idempotency key;
- Critical work silently dropped or falsely reported as delivered;
- simulator endpoints reachable in production mode;
- a claim of physical, clinical, Hume, provider, or manufacturer behavior supported only by a mock.

See [AI-Native Integration Guide](#ai-native-integration-guide) for architecture and [AI-Native API Reference](#api-reference-ai-native) for method-level contracts.

<!-- END:troubleshooting-ai-native -->
