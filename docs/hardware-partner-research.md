# Home Companion Robot Manufacturer Technical Research

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
