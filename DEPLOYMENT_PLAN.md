# VeryLoving Deployment Action Plan

Last reviewed: 15 July 2026. This runbook turns [SETUP.md](./SETUP.md) and [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) into an executable sequence. It distinguishes a deployed artifact from a launch-ready system: a successful build or `/health` response is necessary evidence, but it is not permission to ship a personal-safety product.

## Current Execution Record

The deployment work has started; it is not being left as a paper handoff.

| Item | State on 14 July 2026 | Evidence / next action |
| --- | --- | --- |
| Vercel account | Authenticated as the existing project owner | CLI authentication succeeded without copying a token into the repository. |
| Vercel project | `veryloving-draft`; Git Root Directory corrected from `.` to `server`; Node runtime pinned to `22.x` | Project settings were read back after both changes. Keep framework/build/output settings at their defaults. |
| HTTP adapter preview | Protected smoke deployment `dpl_7XijEsMc9ECpHF3rxwAGdjG4YEKU` at `https://veryloving-draft-dhxvmumfj-chans-projects-0fea1a3e.vercel.app` | Built 14 July 2026 at 04:19 UTC with CLI `56.1.0` (remote builder `55.0.0`). Authenticated `vercel curl` probes returned health `200`, missing CLM config `503`, disabled auth `503`, and Vercel WSS path `404`. Record the committed source SHA after the final clean preview. This protected URL is not a public mobile or production URL. |
| Preview CLM security | Fail-closed | `POST /chat/completions` without configured CLM authentication returned `503` and did not serve an unauthenticated model response. |
| Vercel production variables | Not configured | Vercel reported no production variables. Install reviewed values before a production deployment; do not use dummy credentials. |
| Vercel production alias | Not approved | `https://veryloving-draft.vercel.app/health` returned `404` before the corrected server deployment. Do not put it in the app until a production deployment passes every HTTP probe below. |
| Vercel Git automation | Deliberately disconnected | The linked production branch was `main`; auto-deploy was disconnected before this repository push so missing production variables cannot turn that push into an unsafe promotion. Reconnect only after environment isolation, branch policy and the production promotion gate are approved. |
| Railway staging container | Live authenticated Hume handshake; not a production voice gateway | Railway project `calm-delight`, isolated environment `staging`, service `veryloving-clm-staging`, successful redeployment `7451045c-1ed7-4105-a4e2-a5e9421c71c5` of the container artifact/config from commit `a879b8c`, and generated TLS domain `https://veryloving-clm-staging-staging.up.railway.app`. The replica is in Singapore. Public `/health` returned the exact liveness JSON; invalid provider input failed closed; phone and CLM remained disabled with `503`; the server-only Hume key/config were accepted by Hume; and a synthetic first-party session completed the real WebSocket upgrade, first-frame authentication, upstream Hume connection, and `auth_ok`. |
| Railway production service | Safely stopped and disconnected | The pre-existing `Veryloving-draft` production service was incorrectly running Expo Metro from the repository root. Its production replicas were scaled to zero and its GitHub source was disconnected. It has no public domain. Do not reactivate it; promote a reviewed container artifact into a separately configured production service/environment. |
| AWS container alternative | Not deployed | No ECS/Fargate, ALB, ECR, IAM, Secrets Manager, or DynamoDB production resources have been provisioned. Railway is the active staging path; AWS remains an approved alternative only if the organization chooses and provisions it. |
| Local server secret handling | No committed secret file; ignored provider tooling file present | `server/.env` does not exist. An ignored provider-created `server/.env.local` is local CLI state, not application configuration or release evidence; never commit/copy it, and remove or rotate it through the provider when it is no longer needed. Install application secrets directly in provider secret managers. |
| Mobile provider configuration | Partial | The ignored local `.env` has the Railway staging API/WSS roots, candidate Google IDs, a verified Hume config ID, and correctly formatted Mapbox public/build tokens. The direct public Hume key was moved into Railway's server-only staging variables and cleared locally. Phone, custom Hume CLM/tools, safety persistence, and VL01 remain disabled; their false/empty values are intentional gates. EAS promotion is also blocked by project access. Run the redacted validator after every change. |
| EAS project access | Blocked by organization membership | Browser login succeeded as Expo user `ch0002ic`, but EAS denied read access to project `e723f2d7-d6bb-4a31-83c4-07e832cf7242`, whose configured owner is `verylovingai`. No EAS variables, credentials, project IDs, or builds were changed. An owner must add this user to the organization/project or the authorized owner must log in; do not create a replacement project or change `extra.eas.projectId` as a workaround. |

Do not promote the protected preview merely to obtain a stable-looking URL. A production deployment must start with `NODE_ENV=production`, which deliberately requires real auth, phone, safety, and provider configuration.

The preview proves only that the Vercel Function adapter builds, rewrites `/health`, and fails closed when CLM configuration is absent. It did **not** exercise production strict startup, public mobile reachability, Apple/Google exchange, Twilio, DynamoDB, Hume streaming, WebSocket upgrades, signed clients, or rollback. Preview protection was accessed with Vercel's authenticated CLI; no bypass token belongs in this document.

The Railway staging deployment proves the Docker image builds and starts, public TLS/liveness works from Singapore, protected HTTP routes fail closed, the edge preserves WebSocket upgrades, and a server-minted synthetic session can authenticate through to the verified Hume configuration. Staging provider-token exchange is enabled with the documented Apple/Google public allowlists and an independently generated server-side session secret; that session secret was not written to this repository or the mobile `.env`. The ignored local `.env` may use this staging WSS endpoint for signed-development testing. A valid signed provider assertion, PCM/audio, custom CLM/tools, Twilio, DynamoDB, replay/revocation controls, ingress path restriction, rate/load/backpressure limits, observability, rollback, and signed mobile builds are still unverified; the staging WSS endpoint is not an approved production/EAS value.

## Launch Rule And Remaining Stop-Ship Work

The deterministic baseline is currently 313/313 tests after the UI-foundation, direct deep-link, emergency-contact-edit, and RTL/reminder-transition regressions were added; the latest full pipeline remains ESLint clean, Expo Doctor 20/20, with successful iOS and Android production exports. The 2,558-module iOS and 2,641-module Android figures remain the dated 14 July snapshot rather than a claim about the current bundle graph. The source-of-truth checklist still marks production **NO-GO** until its P1 gates have objective evidence. In particular, credentials alone do not complete:

- durable refresh-family reuse detection, revocation, deletion tombstones, provider credential-state checks, and distributed auth/SMS abuse controls;
- verification/migration of the existing account-bound SecureStore contact cache plus encryption/account binding for remaining settings, locations, transcripts/history, queues, and resilience records;
- guardian/contact and push delivery with receipts, revocable live sharing, routes/zones, and complete privacy/vendor deletion orchestration;
- production WebSocket replay/revocation/rate-limit controls and ownership-bound resume;
- approved VL01 decoding, command authorization, secure ownership/pairing, and signed physical-hardware evidence;
- signed iOS/Android PCM, notifications, BLE, location, background/lock-screen, privacy, and upgrade matrices.

Grace must keep the release decision at **NO-GO** until each row in [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) has a named owner, due date, and evidence link.

## Deployment Topology

The current repository has two deployment surfaces:

```text
Expo app -- HTTPS auth/safety/tool --> Vercel HTTP Function --> DynamoDB/Twilio
    |
    `-- WSS /api/voice/hume-ws --> Railway or ECS container --> Hume EVI

Hume EVI -- HTTPS POST /chat/completions --> Vercel HTTP Function --> optional approved model
```

- Vercel uses `server/api/index.js` plus the catch-all rewrite in `server/vercel.json`. It exposes ordinary HTTP only.
- `server/Dockerfile` runs the long-lived HTTP/WebSocket server. Railway or ECS/Fargate must preserve WebSocket upgrades.
- Never set `EXPO_PUBLIC_HUME_WS_PROXY_URL` to the Vercel domain.
- Choose one authoritative public HTTP surface before production. The recommended split is Vercel for app HTTP and inbound Hume CLM, while the Railway/ECS ingress allowlists only `/health` and `/api/voice/hume-ws`; implement that path restriction at the proxy/WAF because the container itself also exposes HTTP APIs.
- Do not expose overlapping Vercel and container HTTP APIs until both use shared durable session-revocation state, identical issuer/audience/allowlists, synchronized rotation, and account-deletion tombstones. Statelessly sharing a JWT secret is not sufficient.
- A single reviewed Railway/ECS container may instead host all HTTP and WSS routes. In that model, point every public API/CLM/WSS URL to its stable domains and keep Vercel as a non-production bootstrap only.

## Environment Promotion Model

Use three isolated environments and promote immutable artifacts; never copy live user data backward:

| Environment | Resources and permitted use | Promotion gate |
| --- | --- | --- |
| Development | Local/test provider accounts, test phone numbers, synthetic contacts/locations, development Hume config, non-production signing keys. | Deterministic tests and signed development-build smoke tests pass. |
| Staging / Preview | Separate DynamoDB table, Twilio Verify service or approved test credentials, JWT/phone/CLM secrets, Hume config/quota, Mapbox token, domains, push credentials, dashboards, and test accounts. No production PII, real-user SMS, real guardian dispatch, or emergency-service contact. | Security review, rollback rehearsal, provider matrix, signed iOS/Android evidence, and every evidence-dependent P1 pass. |
| Production | Production-only secrets/resources, stable custom domains, approved markets/languages, on-call and alerting. | Explicit GO, immutable release SHA/build IDs, staged rollout, and rollback owner. |

Use environment-scoped Vercel/Railway/EAS variables. A staging failure-injection run may use synthetic data only; scrub evidence and delete test records after the run.

## P1 Engineering Work Packages

Credentials do not close these code/security gaps. Complete them against isolated staging before production promotion:

| Work package | Accountable owners | Required outcome / acceptance evidence |
| --- | --- | --- |
| Identity lifecycle | Backend Identity + Security | Durable refresh families, rotation/reuse detection, logout/account-disable/deletion revocation, provider credential-state checks, uniform 401 recovery, distributed exchange/SMS throttles, audit events, and replay tests across process restarts. |
| Local and backend PII | Mobile Storage + Backend Privacy | Verify and migrate the existing account-bound SecureStore contact cache on signed devices; encrypt/account-bind location/history/queues and remaining stores; add deletion tombstones, vendor export/deletion orchestration, retention jobs, backup/restore, and rollback evidence. |
| Safety delivery and maps | Safety Backend + Maps + Product Safety | Guardian/contact/push delivery state machine, authenticated receipts, retries/deduplication, revocable expiring share links, route/zones data contract, honest SOS status copy, outage behavior, and consented staging-recipient evidence. |
| Voice gateway | Voice Backend + Security/SRE | Narrow single-use connection ticket or equivalent replay control, durable revocation, ownership-bound resume, per-account/IP limits, ingress allowlist, backpressure/load/timeout tests, redacted telemetry and rollback. |
| VL01 protocol | Firmware + Mobile BLE + Security | Approved decoding, event/action mapping, authorized commands, ownership/reset/secure pairing, firmware compatibility, DFU/rollback policy and signed physical-hardware matrix. |
| Notifications | Notifications Backend + Mobile Platform | APNs/FCM credentials, authenticated token registration/rotation/revocation, opt-out, delivery receipts/deduplication, invalid-token cleanup, deep-link contract, observability and signed lifecycle tests. |

## Prioritised Critical Path

Estimates assume the relevant account owner is available and work streams run in parallel. A credible best-case launch path is roughly **3–6 weeks**, not the sum of the setup commands: vendor approval, security/privacy engineering, firmware, store review, and physical QA dominate. Public production is already constrained to reviewed `en/es/fr/zh`; the TestFlight QA profile adds only Arabic/Hebrew, which still need native-speaker review before public release. The other 149 catalog work products remain non-launch content.

| # | Action | Owner | Expected elapsed time | Exit evidence |
| --- | --- | --- | --- | --- |
| 1 | Open the release/evidence record and name every owner | Grace + release owner | 30–60 min | Release SHA, environments, owners, due dates, rollback/on-call contacts recorded; no secrets in the ticket. |
| 2 | Request Hume organization access, credentials, quotas, retention approval, and voice/config authority | Grace + Voice/Security | 10 min to request; typically 1–5 business days | Access granted through the Hume organization and secret manager; no key sent in chat/email. |
| 3 | Acquire Mapbox, verify Google/Apple, establish EAS/Play signing fingerprints, prepare Twilio/Dynamo/push, and request VL01 details in parallel | Provider owners | 0.5–3 days if accounts exist | Redacted inventory of public IDs/installed variable names and approved firmware document. |
| 4 | Complete the integration-prerequisite P1 engineering packages above | Engineering/Security/Privacy | Roughly 2–4 calendar weeks in parallel | Merged SHAs, threat-model approval, migrations, rollback tests, and staging-ready acceptance criteria. |
| 5 | Finish the isolated staging environment: the Railway container/TLS/liveness and fail-closed auth/WSS probes are complete; add isolated provider resources, a staging Hume configuration, security controls, dashboards, and rollback evidence | Backend/Voice/SRE | 1–3 days after remaining inputs exist | Committed artifact/deployment IDs, stable staging DNS, synthetic resources, valid auth/CLM/Hume WSS probes, dashboards and rollback ID. |
| 6 | Populate staging EAS configuration and build signed development artifacts | Mobile/Release Engineering | 2–4 hours plus queues | Development build URLs, signing fingerprints, release SHA, and native smoke evidence. |
| 7 | Build the signed TestFlight candidate and run provider, physical-device, BLE, push, safety, privacy, RTL, security and end-to-end QA | Mobile/Device QA/Product/Security | 5–10 business days including one retest cycle | TestFlight build-number/device/OS-labelled matrix; evidence-dependent P1s closed, not merely scheduled. |
| 8 | Install production resources/secrets, create stable production domains, and promote the reviewed immutable backend artifact | Backend/SRE/Security | 1–2 days | Production deployment/rollback IDs, DNS/TLS evidence, smoke tests and no test data. |
| 9 | Build one approved production release candidate and complete compliance/localization/store checks | Release/Legal/Privacy/Localization | 2–5 days plus external review | Production validator, signed build IDs, approved markets/languages, store metadata and all P1 evidence. |
| 10 | Record GO, submit, stage rollout and monitor | Grace + Release + SRE | Store review plus 3–7 days staged monitoring | Alerts/on-call live, rollback rehearsed, thresholds met, final decision recorded. |

## 1. Establish Release Control

| Field | Instruction |
| --- | --- |
| What | Create one release ticket and evidence folder. Record target version, release SHA, backend deployment IDs, EAS build IDs, intended markets, rollout window, rollback owner, incident owner, and one named individual/due date for every launch-checklist row. |
| Where | The team's private release tracker and evidence store. |
| Outcome | One auditable decision record instead of credentials and screenshots spread across messages. |
| Verify | Grace confirms every row has a person, date, and evidence placeholder. Team names alone are not ownership. |
| Estimate | 30–60 minutes. |

Never paste keys, tokens, SMS credentials, session secrets, precise user locations, or production PII into the ticket.

## 2. Obtain Hume Access From Grace

1. Ask Grace to add the Voice platform owner and deployment operator to the intended production Hume organization at the [Hume Portal](https://app.hume.ai/).
2. Use the Hume API Keys page described in the [official key guide](https://dev.hume.ai/docs/introduction/api-key). Install `HUME_API_KEY` directly in the backend/operator secret manager. Never put it in an `EXPO_PUBLIC_*` value.
3. Confirm billing/quota, allowed environments, data retention/deletion, incident contact, prompt/tool approval, and whether an approved branded voice already exists.
4. If an EVI configuration already exists, record its ID/version and owner. Otherwise obtain approval to create it after the HTTP deployment and Hume-provisioning work in Sections 8–9.
5. Keep the mobile `EXPO_PUBLIC_HUME_API_KEY` empty for preview and production.

Expected outcome: organization access, confirmation that the key is installed in each named backend environment—not a key copied into a message—and authority to provision the EVI configuration.

Verification: the operator can access the organization and list configurations without printing credentials; Security/Privacy sign off on quota and retention.

Estimated time: 10 minutes to send; 1–5 business days for access and approval.

### Message To Grace — Hume Access

> Subject: VeryLoving production Hume access and approval
>
> Hi Grace — we are ready to deploy the VeryLoving voice path. Please arrange access to the production Hume organization for the named Voice platform owner and deployment operator. We need: (1) an organization API key installed directly as `HUME_API_KEY` in the named staging and production backend/operator environments, (2) the approved EVI config/tool/voice IDs if they already exist, or permission to provision versioned resources once the CLM URL is live, (3) quota/billing limits and outage contact, and (4) retention/deletion and branded-voice approval from Security/Privacy/Product. Please do not send any secret in email, chat, Git or the release ticket; reply with the variable name, named environment, accountable owner, due date and confirmation/evidence that installation is complete—not the credential value.

## 3. Create Mapbox Tokens

1. Sign in or create the intended organization at the [Mapbox Access Tokens page](https://console.mapbox.com/account/access-tokens/).
2. Create a distinct public mobile token beginning `pk.`. Grant only the scopes needed for native map/style/font/tile access. Native Maps SDK traffic does not support ordinary website URL restrictions, so rely on least privilege, monitoring, and rotation rather than a restriction that breaks the app.
3. Put that public token in `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` locally and in each matching EAS environment.
4. Create a separate secret token beginning `sk.` with `downloads:read`, following the [Mapbox token guidance](https://docs.mapbox.com/accounts/guides/tokens/). Copy it at creation time and store it as `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` in local/EAS build secrets only.
5. Never place the `sk.*` value in an Expo public variable, app config `extra`, log, screenshot, or ticket.

Expected outcome: one runtime `pk.*` token and one build-only `sk.*` token.

Verification:

```bash
npm run validate-env
eas env:list --environment production --scope project
```

Then install a signed development build and verify map style, fonts/tiles, location puck, denial/retry, zones, and offline cache. A JavaScript export does not prove native map authorization.

Estimated time: 20–40 minutes plus a signed-build test.

## 4. Verify Google And Apple Provider Registration

The existing local Google IDs are candidates; verify them before creating replacements.

1. Name the EAS credentials owner and Play Console owner. Run `eas credentials` through the authenticated operator workflow, record the development/preview/production Android signing-certificate SHA-1 values, and record Play App Signing's app-signing SHA-1. Do not export private keys into the release ticket.
2. Open [Google Auth Platform > Clients](https://console.cloud.google.com/auth/clients) in the intended production project.
3. Confirm the Web application client is the backend token audience. Keep its public ID aligned between `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and server `GOOGLE_TOKEN_AUDIENCES`.
4. Confirm the iOS client uses bundle `com.veryloving.app`. Keep its public ID in `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and allow the trusted native presenter in `GOOGLE_AUTHORIZED_PARTIES` when it appears as `azp`.
5. Verify consent-screen publication, support contacts, test users, and production scopes.
6. Register Android clients for package `com.veryloving.app` with each actual local/EAS/Play SHA-1 fingerprint. Android client IDs are registered with Google but are not added as another mobile environment value.
7. In Apple Developer, verify Sign in with Apple is enabled for App ID `com.veryloving.app`; put that exact native audience in server `APPLE_CLIENT_IDS`. Apple needs no separate public mobile variable.
8. If a native OAuth client or signing certificate changes, regenerate and reinstall the native build; a Metro reload cannot change native callback/signing configuration.

Expected outcome: exact provider registrations and backend allowlists, with no client secrets embedded in the app.

Verification: valid, cancelled, wrong-audience, wrong-presenter, expired, bad-signature, nonce-mismatch, logout, refresh, deletion, and account-switch tests on signed builds.

Estimated time: 30–90 minutes if project access exists; longer if consent or organization verification is required.

## 5. Configure Twilio Verify And DynamoDB

### Twilio Verify

1. Create/select the production Twilio account and follow the [Twilio Verify guide](https://www.twilio.com/docs/verify) to create an SMS Verification Service.
2. Approve target countries, geo permissions, fraud controls, sender behavior, resend policy, code length, rate limits, spend alerts, and support ownership.
3. Install `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` only in backend secret/config storage.
4. Generate independent `PHONE_AUTH_CHALLENGE_SECRET` and stable `PHONE_AUTH_SUBJECT_SECRET`; do not reuse the session or Hume secret.
5. Keep `PHONE_AUTH_ENABLED=false` and `EXPO_PUBLIC_PHONE_AUTH_ENABLED=false` until real-number delivery, expiry, resend, throttling, abuse, and deletion tests pass.

### DynamoDB

1. Create the safety table with string partition/sort keys named `PK` and `SK`.
2. Enable TTL on numeric `expiresAt`, encryption, point-in-time recovery/backups, alarms, and an approved retention/deletion process.
3. Grant only the required Query/GetItem/PutItem/DeleteItem operations to the runtime role. A Vercel deployment needs a reviewed AWS credential/federation design; table name and region are not credentials. Prefer workload federation/short-lived roles over long-lived access keys.
4. Set server `SAFETY_TABLE_NAME`, `AWS_REGION`, and approved `SAFETY_RETENTION_DAYS`. Keep both safety flags false until account-isolation/idempotency/privacy tests pass.

Expected outcome: a working SMS provider and encrypted, access-controlled safety store.

Verification: phone start/check and Dynamo contacts/session/SOS/export/delete tests against production-like resources; confirm `202` SOS means durable acceptance only, not guardian or emergency dispatch.

Estimated time: 2–4 hours for existing accounts, plus security/privacy and real-delivery review.

## 6. Obtain The VL01 Contract

VL01 UUIDs cannot be guessed or sourced from a public dashboard. Keep `EXPO_PUBLIC_VL01_ENABLED=false` until the signed specification and hardware are available.

### Message To The Firmware Owner

> Subject: VL01 production GATT contract and test hardware
>
> Please provide the signed firmware binary, checksum, protocol version, supported serial/hardware revisions, and a version-controlled approved GATT specification. Include advertising identity; service and battery/status/event/command UUIDs; MTU and payload limits; characteristic properties; required discovery/subscription/CCCD order; write-with/without-response rules; byte layouts, endianness, units/ranges/sentinels; test vectors or redacted packet captures; ATT error mapping; event acknowledgement/idempotency; command authorization; connection parameters and retry limits; battery cadence; LE pairing/bonding/MITM, ownership and factory-reset rules; background expectations; DFU/update/rollback policy; and cross-version compatibility. Product/Safety must sign off every event-to-app action and command. Please assign custody of at least two inventoried, representative charged devices/test units and name the firmware, BLE Security, Product Safety and QA approvers with dates. Do not place pairing keys or device secrets in the ticket.

Expected outcome: approved UUID/schema/security contract plus representative hardware.

Verification: configure all five public UUID values, enable VL01 only in a signed test build, and run scan/discovery/read/write/notify, battery, reset, ownership, two-account, Bluetooth off/on, reconnect, foreground/background, and low-battery tests.

Estimated time: 10 minutes to request; 2–5 days if a specification exists, or 1–3+ weeks if firmware changes are needed.

## 7. Prepare Independent Server Secrets

Create each value directly in the target secret manager using a cryptographically secure generator. Do not paste generated values into shell commands, tickets, or this document.

- `SESSION_JWT_SECRET`: independent, at least 32 random bytes.
- `HUME_CLM_BEARER_TOKEN`: independent, at least 32 random bytes.
- `PHONE_AUTH_CHALLENGE_SECRET`: independent, at least 32 random bytes.
- `PHONE_AUTH_SUBJECT_SECRET`: independent, stable across JWT-key rotation.
- Optional `CLM_UPSTREAM_API_KEY`: only when all three upstream model variables are configured together.

Record owner, created date, rotation cadence, overlap/rollback procedure, affected services, and revocation drill. Vercel and the WSS container must share compatible session signing configuration while both validate the same mobile JWTs.

Estimated time: 30–60 minutes plus Security approval.

## 8. Deploy The HTTP API On Vercel

The existing project has already been corrected to Root Directory `server` and Node `22.x`. For a new project, use the same settings.

### Dashboard Setup

1. Import the Git repository from [Vercel New Project](https://vercel.com/new).
2. Set **Root Directory** to `server`.
3. Keep Framework Preset as **Other** and leave build/output/install commands at defaults.
4. Confirm the deployment includes `api/index.js`, `vercel.json`, `clm-server.cjs`, and the server-specific lockfile.
5. Do not set `PORT`; Vercel manages invocation routing.

### Production Environment Groups

Install values separately for Production and Preview/Staging. Staging must use its own JWT/phone/CLM secrets, DynamoDB table, Twilio service or approved test credentials, Hume configuration/quota, provider test accounts, and observability labels. Never send preview SMS to real users or load production PII into preview. Vercel's environment-scoped variables must point each deployment at the matching resources:

- Core: `NODE_ENV=production`, `AUTH_EXCHANGE_ENABLED=true`, `PHONE_AUTH_ENABLED=true`, `SAFETY_API_ENABLED=true`.
- Session: `SESSION_JWT_SECRET`, issuer/audience, access/refresh TTLs.
- Providers: `APPLE_CLIENT_IDS`, `GOOGLE_TOKEN_AUDIENCES`, `GOOGLE_AUTHORIZED_PARTIES`.
- Phone: the independent challenge/subject secrets, challenge TTL, and three Twilio values.
- Safety: table name, region, approved retention, and the reviewed AWS credential mechanism.
- CLM: `HUME_CLM_BEARER_TOKEN`; optional upstream URL/key/model must be supplied as a complete group.
- Optional: `APP_AUTH_VERIFY_URL` only when its HTTPS verifier is approved.

The production proxy flow does not rely on Vercel for raw WebSocket upgrades. Do not install `HUME_API_KEY`, `HUME_CONFIG_ID`, or `HUME_ALLOWED_VOICE_IDS` in Vercel: the HTTP-only Function does not need them. Keep those values on the Railway/ECS gateway and audited Hume operator path.

### Deploy And Verify

```bash
# Run at the repository root. Stop unless status is empty and HEAD matches the
# reviewed release ticket; Vercel CLI uploads the working tree, not an implied SHA.
git status --short
git rev-parse HEAD
npm ci --prefix server
npx --yes vercel@56.1.0 deploy

# After staging verification and real production variables only, create the
# production-environment candidate without moving production domains.
npx --yes vercel@56.1.0 deploy --prod --skip-domain

# Probe the returned candidate URL/ID, then assign traffic only at approved GO.
npx --yes vercel@56.1.0 promote https://<verified-production-candidate>
```

The Vercel project Root Directory is already `server`; do not also pass `--cwd server` from this repository root, which would incorrectly resolve `server/server`. Treat the URL returned by `--prod --skip-domain` as a candidate, run the complete protected endpoint/rollback matrix against that exact deployment, and promote that immutable ID only during the owned cutover window.

Version `56.1.0` is the CLI used for the 14 July 2026 adapter smoke test. Re-review and record any upgrade rather than using the mutable `latest` tag. Do not pass secrets with CLI `--env KEY=value`; command lines and shell history are poor secret stores. Add them through the Vercel dashboard or a reviewed secret automation path.

Required evidence:

```bash
curl --fail --silent --show-error https://<api-domain>/health
curl -i -X POST https://<api-domain>/chat/completions \
  -H 'Content-Type: application/json' \
  --data '{"messages":[]}'
```

- Health returns exactly `{"status":"ok","service":"veryloving-hume-clm"}`.
- Missing/incorrect CLM bearer fails; a valid bearer streams the approved response format.
- Provider exchange accepts valid assertions and rejects bad signature/issuer/audience/presenter/expiry/nonce.
- Refresh, phone, contacts, safety sessions, SOS, privacy export/delete, safety tips, timeouts, account isolation, and rollback pass.
- Logs contain no message text, raw session/provider/Hume tokens, precise location, phone numbers, or credentials.

After staging passes, attach an organization-owned custom API domain. Verify DNS ownership, TLS issuance/renewal, HSTS/security headers at the ingress, environment isolation, and both old/new deployment IDs. Lower DNS TTL before cutover, retain the last known-good immutable deployment, rehearse alias rollback, then move the production alias during an owned change window. The mobile configuration must use the stable domain, not an ephemeral preview URL.

Expected outcome: a public, production-tested HTTPS root suitable for `EXPO_PUBLIC_API_BASE_URL` and, after CLM tests, `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL`.

Estimated time: 2–4 hours after every credential/resource is available; 1–2 days including security and rollback evidence.

## 9. Provision Hume Tool, Voice, And Configuration

1. Verify the deployed CLM endpoint is public over HTTPS, ends `/chat/completions`, requires the independent bearer, and passes streaming/timeout tests.
2. If a branded voice is required, generate candidates and obtain Product/Voice approval following [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md). Never run voice-design commands from an unaudited shell.
3. From an audited operator environment with `HUME_API_KEY` injected by its secret manager, set `HUME_CLM_URL=https://<api-domain>/chat/completions` and optional approved voice identifiers.
4. Run `npm run hume:provision`. For updates, also supply the prior `HUME_TOOL_ID` and `HUME_CONFIG_ID` so the script publishes a new version rather than creating duplicates.
5. Save the returned tool/config IDs and versions. Align server `HUME_CONFIG_ID`, `HUME_ALLOWED_VOICE_IDS`, mobile `EXPO_PUBLIC_HUME_CONFIG_ID`, and optional branded voice ID.
6. Keep `HUME_ALLOW_CLIENT_RESUME=false` until chat ownership enforcement exists.

Expected outcome: versioned safety tool, prompt, CLM, and approved voice configuration.

Verification: Hume Playground test, authenticated CLM SSE, safety-tool correlation, configured voice, invalid bearer/config rejection, quota/outage behavior, and redacted logs.

Estimated time: 1–2 hours after access, CLM URL, and approvals exist.

## 10. Deploy The WebSocket Gateway On Railway

Railway is the active staging container path because `server/Dockerfile` is directly deployable. Vercel remains HTTP-only for this repository. The root `railway.toml` is the reviewed config-as-code source: it selects `server/Dockerfile`, watches only `server/**` and `railway.toml`, sets `/health` with a 60-second timeout, and restarts on failure up to three times. `RAILWAY_DOCKERFILE_PATH` is unnecessary unless an operator intentionally overrides that committed configuration.

The existing staging service is live at `https://veryloving-clm-staging-staging.up.railway.app`; use it only with synthetic/test provider accounts. Its WSS path may be set in the ignored local development `.env`, but it is not an approved EAS/production voice URL until signed-provider PCM, security/load, and rollback gates pass.

1. Connect the repository root—not `server/`—to an isolated Railway environment/service, or deploy the reviewed commit with Railway CLI `5.26.1`. Read back the effective build/deploy configuration and record the source SHA and deployment ID.
2. Add the complete environment-specific server variables from `server/.env.example`. Production additionally needs `HUME_API_KEY`, final `HUME_CONFIG_ID`, approved `HUME_ALLOWED_VOICE_IDS`, `HUME_CLM_BEARER_TOKEN`, and `HUME_ALLOW_CLIENT_RESUME=false`; never reuse the staging session secret.
3. Let Railway inject `PORT`; do not override it. The committed config does not provision projects/environments, domains, variables/secrets, ingress rules, idle/frame/rate limits, observability, or rollback policy beyond process restart.
4. Deploy the exact reviewed commit, then attach an organization-owned voice domain under Networking. Verify DNS, managed TLS renewal, connection idle timeout, and rollback to the prior deployment/domain target.
5. When Vercel remains the authoritative HTTP API, configure Railway's edge proxy/WAF to allow public access only to `/health` and WebSocket upgrades on `/api/voice/hume-ws`; deny the container's duplicate auth/safety/CLM HTTP routes. If the platform cannot enforce that boundary, use a dedicated ingress or choose the single-container topology before production.
6. Verify WebSocket upgrade routing, frame/body limits, connection and per-account/IP rate limits, backpressure, termination, revocation/replay behavior, redacted logs, dashboards and alerts.
7. Set `EXPO_PUBLIC_HUME_WS_PROXY_URL=wss://<voice-domain>/api/voice/hume-ws` only after the gateway passes authentication and real Hume tests.

The app sends its VeryLoving session JWT in the first TLS-protected frame, never in the URL. The existing stateless bearer is not production-grade replay protection: complete the narrower ticket or shared durable revocation work package first. Test valid, missing, malformed, expired, wrong-audience, wrong-scope, replayed/revoked, rate-limited, reconnect, and upstream-outage cases before sending PCM.

Expected outcome: reviewed TLS WebSocket endpoint that opens Hume only after first-frame session validation.

Verification: continuous authenticated 48 kHz mono Int16 streaming, assistant playback, tool calls, reconnect/backpressure/load, no bearer query, and no credential/audio/message/location logging.

Estimated time: 2–4 hours to deploy after credentials; 1–2 days for security/load/reconnect evidence.

### AWS Alternative

Use the same `server/Dockerfile` on ECS Fargate behind an HTTPS Application Load Balancer if Railway is not approved. Create ECR, task/execution roles, Secrets Manager references, Dynamo permissions, target health path `/health`, TLS certificate, WebSocket forwarding, alarms, and rollback outside this repository. The detailed operator runbook is in [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md). The repository contains no Terraform/CDK/CloudFormation, so infrastructure creation remains explicit work rather than an implied deliverable.

## 11. Configure APNs And FCM

Credentials enable native delivery but do not replace the Notifications work package's authenticated token registry and delivery service.

1. In Apple Developer, enable Push Notifications for App ID `com.veryloving.app`. Confirm the development/production provisioning profiles carry the correct `aps-environment` entitlement.
2. Have the Apple account owner create or select a least-privilege APNs authentication key. Record Key ID and Team ID as non-secret metadata; install the `.p8` through the approved EAS credentials workflow and never commit or paste it into a ticket.
3. In Firebase Console, use the production Google project, register Android package `com.veryloving.app`, enable Cloud Messaging API v1, and create/select the dedicated FCM v1 service account under the organization's key policy.
4. Upload the FCM v1 service-account credential through `eas credentials` for the matching project/profile. Keep the credential out of Git, `.env`, logs and screenshots; record only the EAS credential ID/owner.
5. Create separate staging APNs/FCM/EAS credentials or clearly isolated test topics/tokens according to provider policy. Never send a staging alert to real users.
6. Implement and deploy the authenticated backend token register/rotate/revoke and delivery path before enabling safety pushes. Store platform, app version, environment and consent state; never accept an arbitrary destination token from an unauthenticated SOS request.
7. Test first registration, permission denial and Settings re-enable, token rotation, logout/account switch, opt-out, invalid-token cleanup, duplicate suppression, foreground/background/terminated delivery, tap/deep-link routing, provider outage and credential rotation on signed builds.

Expected outcome: environment-correct APNs and FCM credentials in EAS plus a reviewed backend delivery path; Expo Go remains intentionally unsupported for this evidence.

Verification: inspect signed entitlements/credentials without printing secrets, send only to approved test devices/accounts, confirm server receipt/deduplication and alerts, then revoke a test token and verify cleanup.

Estimated time: 1–3 hours for credential owners; backend delivery/reliability work remains part of the P1 schedule.

## 12. Configure Mobile And EAS Environments

After the final domains and IDs pass server-side tests, update uncommitted local `.env` and the matching EAS environments:

```env
EXPO_PUBLIC_API_BASE_URL=https://<approved-http-domain>
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<verified-public-id>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<verified-public-id>
EXPO_PUBLIC_PHONE_AUTH_ENABLED=true
EXPO_PUBLIC_HUME_WS_PROXY_URL=wss://<approved-voice-domain>/api/voice/hume-ws
EXPO_PUBLIC_HUME_CONFIG_ID=<approved-config-id>
EXPO_PUBLIC_HUME_CUSTOMIZATION_URL=https://<approved-http-domain>
EXPO_PUBLIC_HUME_CLM_ENABLED=true
EXPO_PUBLIC_HUME_BRANDED_VOICE_ID=<approved-public-id-or-empty>
EXPO_PUBLIC_HUME_API_KEY=
EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=<public-pk-token>
EXPO_PUBLIC_ENABLE_OFFLINE_MODE=false
EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES=false
EXPO_PUBLIC_SAFETY_BACKEND_ENABLED=true
EXPO_PUBLIC_VL01_ENABLED=true
```

Enable phone, Hume CLM, safety, and VL01 only after their matching gates pass. Add all approved VL01 UUIDs when VL01 is enabled. Store `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` as an EAS build secret.

Validate without printing values:

```bash
npm run validate-env -- --profile production
eas env:list --environment production --scope project
npm run validate
```

Build through explicit gates; do not queue production immediately after development:

```bash
# Gate A: development smoke on owned physical devices.
eas build --platform ios --profile development
# Run auth/map/audio/BLE/push smoke and fix every P0/P1 before Gate B.

# Gate B: immutable staging candidate and full matrix.
eas build --platform all --profile preview
# Close the staging/security/physical evidence matrix and record approval.

# Gate C: primary signed iOS acceptance build from the reviewed SHA.
eas build --platform ios --profile testflight
# Upload to TestFlight and close the clean-install/upgrade/RTL/device matrix.

# Gate D: public production artifacts only after TestFlight and localization approval.
eas build --platform ios --profile production
eas build --platform android --profile production
```

Expected outcome: signed builds whose public configuration points only to reviewed domains/IDs and whose secrets remain in backend/EAS secret managers.

Estimated time: 2–4 hours after final values, plus build queues.

## 13. Feature Verification After Each Dependency

| Dependency just completed | Immediate test | Pass condition |
| --- | --- | --- |
| Vercel HTTP | Health; valid/invalid Apple/Google exchange; refresh; contacts/SOS/privacy; authenticated CLM | Correct status/schema, account isolation, fail-closed auth, no PII/secret logs. |
| Twilio | Start/check/resend/expiry/throttle with real numbers in launch countries | One-time codes deliver, expire, throttle, and never leak whether an account exists. |
| Mapbox | Map load/location/denial/retry/zones/offline cache on signed iOS and Android | Correct style/token, honest stale/offline state, no crash or blank unrecoverable map. |
| Hume config | Playground, CLM SSE, safety tool, approved voice | Config/tool versions match; invalid bearer/config fails; no secret reaches the app. |
| Railway WSS | First-frame auth matrix, new call, PCM, playback, tool, reconnect/backpressure | No token in URL; audio starts only after `auth_ok`; capped retries and clean release. |
| Google/Apple | Success, cancel, mismatch, expiry/revocation, logout/relaunch/account switch | Backend-issued session only; provider assertion not retained; secure storage works in signed builds. |
| VL01 | Scan/pair/GATT/battery/status/events/commands/reconnect/reset/two accounts | Approved semantics, ownership isolation, bounded backoff, no unsafe command. |
| APNs/FCM | Registration/rotation/opt-out plus foreground/background/terminated/tap | Authenticated delivery, deduplication, invalid-token cleanup, correct routing. |

## 14. Final End-To-End Test

Use TestFlight and Play internal builds, not Expo Go. Before testing, activate staging dashboards/alerts and on-call, rehearse rollback, approve synthetic accounts/numbers/contacts, obtain every recipient's consent, inventory and charge the test hardware, and confirm testers will not contact emergency services or unconsenting guardians. Record build SHA, backend versions, device model, OS, account, network state and timestamps. Redact evidence; after the run, revoke test sessions and delete test messages, contacts, locations, audio and provider records under the approved retention procedure.

1. Fresh install; review permission explanations; grant/deny each permission and relaunch.
2. Apple Sign-In and Google Sign-In success/cancel, logout, process death/relaunch, access refresh, old-refresh reuse, provider revocation and account switch; then phone start/resend/expiry/wrong code/throttle and verification with approved test numbers.
3. Complete onboarding and verify account-bound state does not leak after account switching.
4. Load Mapbox with consented test and stale/mock location; render zones and route state; test denial/re-enable, offline cache, quick-share creation, expiry/revocation, recipient receipt and access after logout/deletion.
5. Add/edit/delete emergency contacts and confirm backend persistence, optimistic conflict recovery, and account isolation. Deploy the current safety backend with authenticated `PATCH` support before treating remote editing as testable.
6. Transition Home → Guardian → Emergency; trigger SOS. Confirm the UI reports only durable acceptance/delivery states actually received—never implied dispatch.
7. Start a Hume call through the production WSS gateway. Verify continuous PCM, assistant audio ordering, interruption, Bluetooth route, screen lock, background/foreground, reconnect, tool response, history, and resource cleanup.
8. Disable network, use labeled offline fallback, queue a typed message, reconnect, and confirm exactly-once replay.
9. Pair VL01, read battery/status/events, exercise approved commands, background/foreground, Bluetooth off/on, disconnect/reconnect, reset/unpair, and ownership isolation.
10. Verify push denial and Settings re-enable, registration, token rotation, opt-out, invalid-token cleanup, duplicate suppression, foreground/background/terminated delivery and tap/deep-link routing.
11. Export data, inspect the JSON for the current account only, delete data, verify local/backend/vendor effects, session revocation/tombstone behavior, and inability to repopulate with an old token.
12. Verify deep links, Android Back behavior, share sheet and telephony fallbacks; repeated taps and retries must remain idempotent and must not duplicate SOS, SMS, contact or push actions.
13. Repeat critical flows on small/large iPhone, supported iPad layout, API 36 emulator, physical Android, RTL Arabic, and every safety-copy launch language. Include VoiceOver/TalkBack, dynamic type/font scaling, reduced motion, contrast, focus order and screen-reader announcements.
14. Upgrade from the last supported production schema/build with queued/offline data, then exercise migration failure and backend/mobile rollback without account crossover or data loss.
15. In isolated staging only, force Hume, Mapbox, Twilio, Dynamo, APNs/FCM and gateway failures; verify actionable messages, bounded retries, redacted telemetry, alerts and rollback. Never inject faults into production.
16. Hold a staged soak and record crash-free session rate, auth/SMS/map/voice/SOS latency/error percentiles, queue depth, delivery success, provider quota, alert thresholds and on-call response. Product/Safety and SRE must approve the numeric thresholds in the release record.

Exit condition: every P1 row has linked objective evidence and no unresolved P0/P1 defect. Otherwise record **NO-GO** with owner and next review date.

## 15. Handoff Messages To Grace

### Credentials And Ownership Request

> Subject: VeryLoving production deployment inputs and named owners
>
> Hi Grace — the HTTP adapter has a protected preview smoke test, but production remains gated on the open P1 evidence in `LAUNCH_CHECKLIST.md`. Please confirm the initial launch markets and human-reviewed languages; Apple Developer/App Store Connect and Google Play roles; the EAS signing owner; APNs/FCM owners; organization DNS/TLS owner; and separate staging/production provider resources. Assign one named person and due date for Hume, Identity/Twilio, Maps, Safety/Dynamo, Voice gateway, push, iOS/Android audio, VL01/firmware, Security/Privacy, Localization, SRE/on-call and store release. Please arrange Hume organization/config/voice/quota/retention approval and have each secret owner install the named variables directly in the matching Vercel, Railway/AWS or EAS environment. Do not paste secrets into email, chat, Git or the release ticket. Reply with public IDs/domains where applicable, installation confirmation by environment, due dates and evidence links—not credential values.

### Deployment And Test Completion

> Subject: VeryLoving deployment status and release evidence
>
> Hi Grace — the reviewed HTTP deployment is live at `<HTTPS root>` and the authenticated voice gateway is live at `<WSS root>`. Mobile build `<build IDs>` uses commit `<SHA>`. We verified health, auth exchange/refresh, real SMS, account-isolated safety/privacy, Mapbox, Hume CLM/tool/PCM, gateway auth/reconnect/backpressure, VL01, push, export/deletion, and rollback on the attached signed-device matrix. Remaining failures/gates: `<none, or explicit owner/date>`; dashboards/on-call/rollback: `<links>`. The release decision remains `<GO/NO-GO>` according to `LAUNCH_CHECKLIST.md`. No credential values are included in this message.

## Final Production Record

Complete this table in the private release record, not by adding secrets to Git:

| Evidence | Value/link |
| --- | --- |
| Release commit |  |
| Railway staging deployment/source SHA/health evidence |  |
| Vercel production deployment + rollback ID |  |
| HTTP API root |  |
| Railway/ECS deployment + rollback ID |  |
| WSS root |  |
| Hume config/tool/voice versions |  |
| Dynamo table/region and privacy approval |  |
| Twilio Verify service evidence |  |
| EAS production variable-name inventory |  |
| iOS/Android signed build URLs/numbers |  |
| Physical-device/PCM/BLE/push matrix |  |
| Security/privacy/localization approvals |  |
| Dashboards, on-call and runbooks |  |
| Rollback rehearsal |  |
| Final GO/NO-GO and approver |  |

Use [SETUP.md](./SETUP.md) for the variable-by-variable reference, [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for exact backend/Hume contracts, and [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for the binding release decision.
