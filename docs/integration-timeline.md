# Product 2 Manufacturer Integration Timeline

Last reviewed: 20 July 2026

Planning origin: `Day 0` is the date Grace authorizes manufacturer outreach and both NDA requests are sent.

## Current phase status

| Phase | Current status | Evidence or external blocker | Who can unblock | Estimated effort once unblocked |
| --- | --- | --- | --- | --- |
| 1. NDA Signed | BLOCKED — EXTERNAL | Neither manufacturer NDA has been executed for this integration. | Grace, Veryloving counsel, and manufacturer signatories. | Engineering intake within 0.5 day of each executed NDA; legal negotiation excluded. |
| 2. Technical Package Received | BLOCKED — EXTERNAL | No production API/SDK/source/HAL/medical protocol package has been supplied. | Yongyida and Jiangzhi technical/legal owners; Grace escalates. | 3–10 engineering days for initial review, depending on package completeness. |
| 3. Adapter Implementation | PASS | Vendor-neutral HAL, provisional Yongyida/Jiangzhi adapters, immutable per-device routing, signed actions, queues, ACK handling, reset, and privacy lifecycles exist. | Not applicable for the completed provisional layer. Real vendor translation still depends on Phase 2. | 3–10 days per vendor to replace provisional mappings after a complete contract arrives. |
| 4. Mock Testing | PASS | Deterministic adapter and manufacturer-bridge tests exist; the configurable mock exercises the provisional contract without real credentials. | Not applicable for software-mock scope. | Vendor conformance fixtures will require 2–5 days after Phase 2. |
| 5. Physical Hardware Received | BLOCKED — EXTERNAL | Exact-SKU engineering units, accessories, and frozen firmware are not in Shenzhen. | Grace/procurement, manufacturer logistics, and Shenzhen engineer. | About 1 day intake/setup after delivery. |
| 6. Real-World Testing | BLOCKED — EXTERNAL | Requires complete vendor contracts and exact physical units; no real manufacturer latency, safety, sensor, reset, OTA, or soak evidence exists. | Manufacturer engineering leads, Shenzhen engineer, and Veryloving safety/security owners. | 2–6 weeks; medical validation may take longer. |
| 7. Pilot Launch | BLOCKED — EXTERNAL | Requires Phases 1–6, production credentials, privacy/security approval, site approval, support runbooks, and release sign-off. | Grace, SV Lead, vendor, pilot-site owner, and Veryloving release/safety/privacy owners. | 1–3 weeks for controlled pilot preparation after every gate passes. |

`PASS` for Phases 3 and 4 is limited to the vendor-independent/provisional software scope. It does not mean a real Yongyida or Jiangzhi protocol has been implemented or validated.

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
NDA
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
| Legal disclosure gate | Executed NDA for the manufacturer and named disclosure contacts. | BLOCKED — EXTERNAL |
| Package completeness gate | Every applicable critical row in [`manufacturer-api-requirements.md`](./manufacturer-api-requirements.md) has review evidence. | BLOCKED — EXTERNAL |
| Adapter conformance gate | Real vendor sandbox passes auth, commands, signed action, telemetry, ACK, idempotency, timeout, replay, reset, and deletion cases. | BLOCKED — EXTERNAL |
| Hardware intake gate | Two exact units recorded with matching BOM/firmware, accessories, diagnostics, and RMA path. | BLOCKED — EXTERNAL |
| Physical acceptance gate | Safety, network split, process death, reboot, OTA/rollback, reset, performance, and extended soak reports pass. | BLOCKED — EXTERNAL |
| Production-service gate | APNs, FCM, Twilio, Hume, cloud/IAM, monitoring, incident, privacy, and support controls pass staging. | BLOCKED — EXTERNAL |
| Pilot release gate | All prior gates pass and named product, safety, privacy, security, vendor, and site owners sign off. | BLOCKED — EXTERNAL |

## Timeline controls

- Review this document and the [external dependencies dashboard](./external-dependencies-dashboard.md) twice weekly while any P0 row is blocked.
- Rebaseline dates when a required artifact misses its checkpoint by more than two business days.
- Do not compress physical safety, security, privacy, OTA/recovery, or soak acceptance to preserve a launch date.
- Do not mark a phase `PASS` based on a promise, marketing page, mock response, or hardware demo that is not tied to the contracted SKU and firmware.
