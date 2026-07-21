# Product 2 External Dependencies Dashboard

Last reviewed: 21 July 2026

Branch scope: `features/dual-product-draft`

## Quick Status

**Total External Dependencies:** 13

**✅ PASS (Completed):** 2/13

**BLOCKED — EXTERNAL:** 11/13

**First Unblocking Milestone:** ✅ PASS — Grace confirms the mutual NDAs with Yongyida and Jiangzhi are signed.

**Next Unblocking Milestone:** Grace sends the [Technical Package Request](./ask-templates.md#2-technical-package-request) to both manufacturers on 21 July 2026.

The 13-row total covers only actions outside this repository. Internal software/document deliverables are tracked separately below and are not included in the denominator.

## Internal deliverables checklist

| Deliverable | Evidence | Status |
| --- | --- | --- |
| Hardware partner decision matrix | [`docs/hardware-partner-decision-matrix.md`](./hardware-partner-decision-matrix.md) | PASS |
| Manufacturer API requirements checklist | [`docs/manufacturer-api-requirements.md`](./manufacturer-api-requirements.md) | PASS |
| Configurable manufacturer mock simulator | [`server/mocks/ManufacturerMockServer.ts`](../server/mocks/ManufacturerMockServer.ts) | PASS |
| External dependencies dashboard | [`docs/external-dependencies-dashboard.md`](./external-dependencies-dashboard.md) | PASS |
| Three-scenario integration timeline | [`docs/integration-timeline.md`](./integration-timeline.md) | PASS |
| Copy-ready ask templates | [`docs/ask-templates.md`](./ask-templates.md) | PASS |

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
| Details for EXT-001 | Nothing — Grace confirms the Yongyida NDA is signed. | Completed. Retain the effective copy through the approved legal-record process and use the technical-package request template today. | Completed by Grace, Veryloving counsel, and the Yongyida authorized signatory. | No remaining NDA effort; allow up to 0.5 day for engineering intake when the package arrives. | ✅ PASS recorded from Grace's confirmation on 21 July 2026; keep the agreement and its private record reference outside source control. |
| Details for EXT-002 | Nothing — Grace confirms the Jiangzhi NDA is signed. | Completed. Retain the effective copy through the approved legal-record process and use the technical-package request template today. | Completed by Grace, Veryloving counsel, and the Jiangzhi authorized signatory. | No remaining NDA effort; allow up to 0.5 day for engineering intake when the package arrives. | ✅ PASS recorded from Grace's confirmation on 21 July 2026; keep the agreement and its private record reference outside source control. |
| Details for EXT-003 | Public information does not contain a production-callable Yongyida contract. | Yongyida supplies the applicable artifacts in the [manufacturer API checklist](./manufacturer-api-requirements.md), tied to the exact Y120/elder-care SKU and firmware. | Yongyida API/product/security leads; Grace escalates commercially. | 3–7 engineering days for review, mapping, fixtures, and first conformance run. | Versioned documents pass applicable checklist rows; open questions have named owners/dates. |
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
2. **P0 — EXT-003 through EXT-007:** Grace sends the technical-package request to both manufacturers on 21 July 2026. Request documents, sandboxes, source access, and medical evidence in parallel.
3. **P0 — EXT-008 and EXT-009:** reserve and ship exact hardware while package review begins; do not wait for adapter translation to finish.
4. **P1 — EXT-010 through EXT-013:** begin account and compliance provisioning early, but keep production secrets out of the mock-development critical path.

The shortest production critical path is:

```text
NDA (PASS) → technical package/access → exact hardware → adapter conformance → physical safety/security/soak validation → pilot approval
```

## Status change rule

An owner may change a row from `BLOCKED — EXTERNAL` to `PASS` only when its “Evidence required before PASS” condition is met. “Requested,” “promised,” “received but unread,” and “works against the mock” are not `PASS`. Record dates and links in the team’s access-controlled tracker; do not add credentials or NDA-restricted content to this public-facing repository document.
