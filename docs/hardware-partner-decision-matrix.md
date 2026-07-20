# Hardware Partner Decision Matrix — Home Companion Robot

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

- [Detailed public technical research](./hardware-partner-research.md)
- [Robot HAL architecture](./robot-hal-architecture.md)
- [Adapter integration guide](./robot-adapter-integration-guide.md)
- [Adapter runtime bug and fix log](./robot-adapter-bug-log.md)
