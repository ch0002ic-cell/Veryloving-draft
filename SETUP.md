# VeryLoving Environment Setup

This guide configures a local development build and the matching cloud environments without placing credentials in source control. Start with the templates; never copy backend/runtime production secrets into the root `.env` file.

```bash
cp .env.example .env
cp server/.env.example server/.env
npm run validate-env
```

The root `.env` contains public mobile configuration, a native-build download secret, and a development-only direct Hume compatibility field that should normally remain empty. Expo replaces every `EXPO_PUBLIC_*` reference in the JavaScript bundle, so those values—including any mistakenly supplied Hume key—must be treated as public. Server credentials belong in `server/.env` for local work and in the hosting provider's secret manager for deployed services. Both local files are ignored by Git.

The Node server does not load `server/.env` automatically. For a local process, export the file into that process before starting it:

```bash
set -a
source server/.env
set +a
npm run clm:start
```

## Root Environment Reference

Empty values mean “not configured.” Boolean flags default to `false`; build diagnostics default to the development profile. The validator reports development omissions as warnings and makes production requirements blocking when run with the production profile.

| Variable | Purpose and dependent feature | Source and default |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | HTTPS root used by provider-token exchange, phone verification, safety contacts/sessions/SOS, privacy, and authenticated CLM control requests. | Set after deploying and verifying the repository's HTTP service, for example `https://<project>.vercel.app`. Default: empty. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Public Web application OAuth client ID used as the Google ID-token audience. Required for Google Sign-In. | Google Cloud Console, **Google Auth Platform > Clients**. Keep server `GOOGLE_TOKEN_AUDIENCES` synchronized. Default: empty in the template; the current local file already contains a candidate that still needs verification. |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Public iOS OAuth client ID for bundle `com.veryloving.app`; its reversed value is the native callback scheme. Required for iOS Google Sign-In. | Google Cloud Console, **Google Auth Platform > Clients**. Keep trusted `azp` presenters in server `GOOGLE_AUTHORIZED_PARTIES`. Default: empty in the template; the current local file already contains a candidate that still needs verification. |
| `EXPO_PUBLIC_PHONE_AUTH_ENABLED` | Shows/enables phone authentication only after the deployed SMS endpoints are ready. | Release decision, not a vendor credential. Set `true` only with server `PHONE_AUTH_ENABLED=true`, complete Twilio Verify configuration, and passed abuse-control tests. Default: `false`. |
| `EXPO_PUBLIC_HUME_WS_PROXY_URL` | TLS WebSocket endpoint for live PCM voice, normally `wss://<voice-host>/api/voice/hume-ws`. | URL of the separately deployed long-lived Node container. The Vercel HTTP adapter does not host this raw WebSocket route. Default: empty. |
| `EXPO_PUBLIC_HUME_CONFIG_ID` | Public ID of the approved Hume EVI configuration containing the prompt, CLM, tools, and voice policy. | Hume Platform **EVI Configurations > More Options > Copy Configuration ID**, or the repository provisioning command. Default: empty. |
| `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` | HTTPS root for authenticated CLM/tool HTTP calls from the app. | Deployed HTTP service URL; it can equal `EXPO_PUBLIC_API_BASE_URL` after verification. Default: empty, with the API base used as the runtime fallback. |
| `EXPO_PUBLIC_HUME_CLM_ENABLED` | Enables the custom Hume language-model and tool integration. | Release readiness flag. Set `true` only after the config, bearer-protected CLM endpoint, and voice gateway pass end-to-end testing. Default: `false`. |
| `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` | Optional public ID of the approved Hume custom/library voice override. | Hume Voice Library or **My Voices**, or the repository voice-design command. Default: empty, which retains configured/default voice behavior. |
| `EXPO_PUBLIC_HUME_API_KEY` | Direct client-to-Hume development credential supported only in development builds. | Hume Platform API Keys. Default: empty. Prefer the server-side `HUME_API_KEY`; this variable must remain empty in preview and production because it is bundled into the app. |
| `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public runtime `pk.*` token used to load Mapbox maps, styles, fonts, and offline map packs. | Mapbox **Access tokens** page. Create a distinct least-privilege public mobile token. Mapbox URL restrictions do not support native Maps SDK traffic, so do not add a restriction that breaks the app. Default: empty. |
| `EXPO_PUBLIC_ENABLE_OFFLINE_MODE` | Forces the offline voice path for deliberate fault testing; it does not make backend SOS, live routes, or sharing available offline. | Local/release test decision. Default: `false`; keep it `false` in production. |
| `EXPO_PUBLIC_SAFETY_BACKEND_ENABLED` | Enables account-backed emergency contacts, safety-session persistence, SOS acceptance, and backend privacy operations. | Release readiness flag after the API and DynamoDB paths pass tests. Default: `false`; production requires `true`. |
| `EXPO_PUBLIC_VL01_ENABLED` | Enables real VL01 filtered scanning and GATT validation. | Release decision after firmware approval and physical-device validation. Default: `false`; production diagnostics require the approved protocol to be enabled. |
| `EXPO_PUBLIC_VL01_SERVICE_UUID` | Primary VL01 GATT service used for scan filtering and service discovery. | Approved VL01 firmware/GATT specification from the firmware owner. Default: empty. |
| `EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID` | One-byte battery percentage characteristic. | Approved VL01 firmware/GATT specification. Default: empty. |
| `EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID` | Readable/notifiable device-status channel. | Approved UUID plus payload schema from the firmware owner. Default: empty. |
| `EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID` | Notifiable wearable-event channel. | Approved UUID plus event semantics from the firmware and safety owners. Default: empty. |
| `EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID` | Writable command channel. | Approved UUID, command schema, authorization, and secure-pairing policy from firmware/security owners. Default: empty. |
| `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` | Secret `sk.*` token with `downloads:read`, used only while resolving native Mapbox SDK artifacts. It is not bundled because it lacks the public prefix. | Mapbox **Access tokens** page; create a secret token and save it at creation time. Default: empty. Store it as an EAS secret/build variable, never in a committed file. |
| `VERYLOVING_BUILD_PROFILE` | Selects `development`, `preview`, or `production` validation rules during local config resolution. | Local command or the matching `eas.json` profile. Default in the template: `development`. |
| `VERYLOVING_CONFIG_DIAGNOSTICS` | Emits a redacted presence/scheme report from `app.config.js`; values are never printed. | Local/EAS diagnostic choice. Default: `0`; EAS profiles set `1`. |

Apple Sign-In intentionally has no root environment variable. Native Apple tokens use the iOS bundle identifier `com.veryloving.app` as their audience, and the backend accepts it through `APPLE_CLIENT_IDS`.

## One-Time Provider Setup

### 1. Verify Google OAuth

The local `.env` already has candidate Web and iOS client IDs. Verify them before creating replacements:

1. Open [Google Auth Platform credentials](https://console.cloud.google.com/auth/clients) in the intended production project. Google's [OAuth credential guide](https://developers.google.com/workspace/guides/create-credentials) describes the same console flow.
2. Confirm the **Web application** client is intended for VeryLoving. Copy its client ID to `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and to server `GOOGLE_TOKEN_AUDIENCES`.
3. Confirm the **iOS** client uses bundle ID `com.veryloving.app`. Copy its client ID to `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`; allow that native presenter in `GOOGLE_AUTHORIZED_PARTIES` when it appears as the token's `azp`.
4. Configure the consent screen, publication state, and test users for the intended environment.
5. Register Android OAuth clients separately for package `com.veryloving.app` and each signing SHA-1. Android client IDs are registered with Google but are not another root environment variable.
6. After changing the iOS client ID, run a new prebuild and reinstall the native app; a Metro reload cannot change the callback URL scheme.

Follow Google's [native-app OAuth guidance](https://developers.google.com/identity/protocols/oauth2/native-app) and never copy a client secret into the mobile environment.

### 2. Create the two Mapbox tokens

1. Create or select the organization account at the [Mapbox Access tokens page](https://console.mapbox.com/account/access-tokens/). Review Mapbox's [token management guide](https://docs.mapbox.com/accounts/guides/tokens/).
2. Create a distinct public mobile token beginning with `pk.` with only the scopes needed for native map display (including style/font reads). Put it in `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`. Mapbox URL restrictions do not support native Maps SDK requests, so use scope minimization, monitoring, and rotation instead of a restriction that blocks the app.
3. Create a separate secret token beginning with `sk.` and grant `downloads:read` for native SDK downloads. Copy it when Mapbox shows it; secret token values are shown only at creation time. Put it in the uncommitted local `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` and the matching EAS environment as a secret.
4. Never place the `sk.*` token in an `EXPO_PUBLIC_*` variable, app config `extra`, ticket, screenshot, or log.

### 3. Deploy the HTTP API on Vercel

The repository's Vercel adapter serves ordinary HTTP routes. It does not replace the live voice WebSocket host.

1. Import the repository in [Vercel](https://vercel.com/new) and set **Root Directory** to `server`.
2. Leave framework, build, and output settings at their defaults. Vercel uses `server/api/index.js` as the HTTP-only Node Function and applies the catch-all route in `server/vercel.json`.
3. Add the production values from `server/.env.example` under **Project Settings > Environment Variables**. Vercel's [environment-variable guide](https://vercel.com/docs/environment-variables) explains per-environment values. Store signing, Twilio, Hume, and upstream-model credentials as server secrets, never `EXPO_PUBLIC_*` values.
4. Deploy, then verify `GET https://<project>.vercel.app/health` and the authenticated auth, phone, safety/privacy, and CLM routes. `/health` proves liveness only.
5. Set `EXPO_PUBLIC_API_BASE_URL=https://<project>.vercel.app`. If the same deployment serves the reviewed CLM/tool HTTP routes, set `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` to the same root.
6. Redeploy after changing Vercel variables; environment changes do not alter an existing immutable deployment.

The Vercel adapter does not mount `/api/voice/hume-ws`. Vercel now documents [WebSocket support as a public beta](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), but this repository's raw Node `upgrade` gateway has not been adapted to that API or its function-duration/reconnect constraints. Deploy `server/Dockerfile` on a long-lived container platform that supports WebSocket upgrades (the repository runbook uses Railway or AWS), verify TLS/upgrades/authentication/backpressure, and set its `wss://` URL as `EXPO_PUBLIC_HUME_WS_PROXY_URL`.

### 4. Obtain and provision Hume

Grace or the designated Voice platform owner must provide access to the production Hume organization and approve quotas, retention, prompt/tool behavior, and the voice.

1. Obtain the organization API and secret keys from the [Hume developer portal](https://app.hume.ai/developers). Follow Hume's [API key guide](https://dev.hume.ai/docs/introduction/api-key). Put the long-lived API key only in the backend secret manager as `HUME_API_KEY`; do not place it in the production mobile environment.
2. Deploy the bearer-protected CLM endpoint and set the operator-only `HUME_CLM_URL` to its public URL ending in `/chat/completions`.
3. Use `npm run hume:provision` from an audited operator shell, or create/test a configuration in Hume's EVI Configurations UI. Hume documents how to [build and copy an EVI configuration ID](https://dev.hume.ai/docs/speech-to-speech-evi/configuration/build-a-configuration).
4. Put the approved public config ID in `EXPO_PUBLIC_HUME_CONFIG_ID` and the corresponding backend `HUME_CONFIG_ID`. If an approved voice override exists, put its public ID in `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` and keep the backend voice allowlist synchronized.
5. Deploy and validate the separate authenticated WebSocket gateway before setting `EXPO_PUBLIC_HUME_CLM_ENABLED=true` for production.

See [HUME_CUSTOMIZATION.md](./HUME_CUSTOMIZATION.md) for exact server variables, provisioning commands, Vercel/container boundaries, and security tests.

### 5. Configure phone and safety backends

1. Create a Twilio Verify service following the [Twilio Verify documentation](https://www.twilio.com/docs/verify). Store `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` only on the server. The current integration uses the main Auth Token; treat it as a high-value secret and track migration to a restricted Twilio API key as production hardening.
2. Generate independent server secrets for sessions, phone challenges, and stable phone-subject derivation; do not reuse provider credentials.
3. Follow AWS's [DynamoDB table guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html) to create the safety table with string keys `PK` and `SK`. Enable [TTL](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-how-to.html) on numeric `expiresAt`, encryption, backups/point-in-time recovery, alarms, and a least-privilege runtime role. Prefer workload roles or reviewed short-lived federation over long-lived AWS access keys. DynamoDB TTL cleanup is asynchronous and does not replace the app's explicit privacy-deletion path.
4. Enable server `PHONE_AUTH_ENABLED` and `SAFETY_API_ENABLED` only after integration and abuse tests pass, then enable the corresponding public mobile flags.

### 6. Obtain the VL01 GATT registry

VL01 UUIDs do not come from an online dashboard. Request a versioned, approved GATT document from the firmware owner covering the primary service, battery/status/event/command characteristics, properties, encodings, command authorization, secure pairing, ownership reset, and firmware-version compatibility. Leave `EXPO_PUBLIC_VL01_ENABLED=false` until all required UUIDs and a physical-device test matrix are approved.

### 7. Test offline mode deliberately

Set `EXPO_PUBLIC_ENABLE_OFFLINE_MODE=true` only to exercise the bundled offline voice path, restart Metro with a cleared cache, and label the test as forced-offline. Return it to `false` before online or release verification. Cached map/contact/device data can improve resilience, but offline mode does not prove remote SOS delivery, route freshness, live sharing, or Hume availability.

## Validate Local and EAS Environments

Validate the current `.env` without revealing values:

```bash
npm run validate-env
```

Validate against launch requirements before creating a production build:

```bash
npm run validate-env -- --profile production
```

The command exits nonzero for missing or invalid required production configuration. Optional omissions remain warnings. It reads `.env` first and lets explicitly supplied process variables override it; reports contain variable names and status only. Use concrete values rather than `$VAR`/`${VAR}` interpolation so the validator and Expo cannot resolve different effective configuration.

For EAS, create separate `development`, `preview`, and `production` environments in **Project Settings > Environment variables** or with `eas env:create`. Expo's [EAS environment guide](https://docs.expo.dev/eas/environment-variables/manage/) explains scopes and visibility. Public mobile values can be plain/sensitive because the bundle exposes them; `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` must be a build secret. EAS secret values cannot be pulled locally, so a local production report warns rather than fails when that download token is absent; its presence becomes a blocking check when `EAS_BUILD=true` on the remote builder.

Verify names without copying values into logs or release tickets:

```bash
eas env:list --environment production --scope project
eas env:pull --environment production --path .env.production.local
npm run validate-env -- --file .env.production.local --profile production
```

Delete the pulled file after validation and keep it untracked. Then run the full repository quality gate:

```bash
npm run validate
```

Follow [DEPLOYMENT_PLAN.md](./DEPLOYMENT_PLAN.md) to execute these steps in dependency order and record deployment evidence. The authoritative go/no-go evidence list remains [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md).
