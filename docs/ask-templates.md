# Product 2 External Ask Templates

Last reviewed: 20 July 2026

Deliverable status: **PASS**

These templates are ready to copy. Replace every `[bracketed placeholder]` before sending and remove any optional text that does not apply.

## Secure handling rules

- Never ask anyone to email, chat, paste into a ticket/document, or commit an API key, token, password, private certificate, service-account JSON, `.env` file, source archive, or patient data.
- Credentials must be created with least privilege and injected directly into the approved deployment secret manager. Email should contain only the secret's approved name/reference, environment, owner, expiry/rotation date, and confirmation that access was granted.
- Do not use `EXPO_PUBLIC_*` for server credentials. Do not put real values in `.env.example`, source control, logs, screenshots, or this document.
- NDA-restricted documents and licensed source must use the approved access-controlled repository, with named users, expiry, audit logging, and license metadata.
- Engineering samples and technical packages must identify the exact SKU, BOM, OS/BSP, firmware, document version, and issue date.

Sending a request does not change a dependency to `PASS`. It remains `BLOCKED — EXTERNAL` until the acceptance evidence in the [external dependencies dashboard](./external-dependencies-dashboard.md) is complete.

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
