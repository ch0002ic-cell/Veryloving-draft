# Hume EVI Customization

VeryLoving uses Hume's supported customization surfaces rather than modifying a Hume SDK:

- An OpenAI-compatible SSE Custom Language Model endpoint at `POST /chat/completions`.
- A `get_safety_tips` function tool registered on the EVI configuration.
- `custom_session_id` in `session_settings` and `resumed_chat_group_id` on reconnect.
- The authenticated WebSocket gateway to replace any client-supplied CLM key with the server bearer in the first `session_settings` frame. A chat-ID control-plane endpoint remains a direct-development fallback only.
- Octave voice design through the official TTS and voice-management endpoints.

## Implemented Architecture And Boundaries

This repository contains two runtime components:

1. The Expo/React Native mobile client.
2. A Node `22.x` service in `server/clm-server.cjs`, packaged by `server/Dockerfile` for HTTP plus raw WebSocket upgrades, with an HTTP-only Vercel Function adapter in `server/api/index.js`.

The Node service implements:

| Method and path | Caller | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET /health` | Hosting platform/operator | None | Liveness only; returns the CLM service identity. |
| `POST /chat/completions` | Hume CLM | `HUME_CLM_BEARER_TOKEN` | OpenAI-compatible SSE completion, deterministic safety handling, tools, and optional upstream model. |
| `POST /v1/auth/exchange` | Mobile app after Apple/Google sign-in | Provider RS256 JWT, issuer, audience, expiry, authorized-party, and Apple nonce validation | Issues a short-lived VeryLoving HS256 session JWT and verified profile. |
| `POST /v1/auth/refresh` | Mobile app before/after access expiry | Refresh JWT with distinct type, audience, and scope | Issues a new access/refresh pair; persistent reuse detection/revocation is not yet implemented. |
| `GET`/`POST`/`DELETE /v1/emergency-contacts` | Mobile app | VeryLoving session JWT | Reads and mutates account-partitioned DynamoDB contact records. |
| `POST /v1/sos-events` | Mobile app | VeryLoving session JWT | Idempotently persists an accepted SOS record; it does not deliver notifications. |
| `POST /v1/safety-sessions` | Mobile app | VeryLoving session JWT | Persists a requested safety-mode session. |
| `GET /v1/safety-sessions/current` | Mobile app | VeryLoving session JWT | Reads the account's current idempotent safety state. |
| `GET /v1/privacy/export` / `DELETE /v1/privacy/data` | Mobile app | VeryLoving session JWT | Exports or deletes the account's DynamoDB safety records; it does not orchestrate vendor deletion or session revocation. |
| `GET` upgrade `/api/voice/hume-ws` | Mobile app | First WebSocket message carries the VeryLoving session JWT; gateway requires `voice:connect` | Opens Hume with the server-only key after authentication and relays bounded frames. |
| `POST /v1/safety/tips` | Mobile-triggered Hume tool | Built-in session JWT first, optional `APP_AUTH_VERIFY_URL` fallback | Returns curated safety guidance. |
| `POST /v1/hume/session/configure` | Direct-development mobile path only | Built-in session JWT first, optional `APP_AUTH_VERIFY_URL` fallback | Development fallback for chat-ID control-plane configuration. Production returns `410`; the authenticated gateway configures proxy sessions. |

The health endpoint and its response are covered by `server/clm-server.test.cjs`. It intentionally reports process liveness, not readiness of provider JWKS, session signing, DynamoDB, Hume credentials, WebSocket upgrades, or an optional upstream model. Protected endpoints fail closed when their required feature or authentication is absent.

The production topology is split deliberately:

```text
Expo mobile app
  |-- HTTPS auth/safety/tool/config ----------> Vercel HTTP adapter or container --> DynamoDB
  `-- WSS /api/voice/hume-ws -----------------> separately hosted voice gateway ---> Hume EVI

Hume CLM -------------------------------------> POST /chat/completions (this repo)
                                                    `--> optional upstream model
```

Deploying `server/Dockerfile` provides both the HTTP endpoints and the WebSocket gateway above. Deploying `server/api/index.js` on Vercel provides the HTTP endpoints only. With configured AWS credentials and a compatible table, either HTTP path can provide DynamoDB persistence, account export, and account-record deletion for contacts, SOS acceptance, and current safety state. The service implements access/refresh JWT renewal but does **not** provision AWS infrastructure, persist refresh families for reuse detection/revocation, create deletion tombstones or vendor orchestration, provide SMS, push/contact delivery, SOS delivery receipts, a complete guardian delivery state machine, live sharing, route intelligence, or a single-use WebSocket-ticket service. This is a Node Function adapter, not a Next.js or SES implementation.

The mobile client opens the configured proxy URL without credentials or Hume parameters in its query. Its first TLS-protected frame carries the short-lived VeryLoving session JWT plus bounded connection choices. The gateway verifies the JWT and `voice:connect` scope before opening Hume with the server-only API key. This removes bearer credentials from client URLs, but the session JWT is not a single-use voice ticket: replay protection, independent revocation, rate limiting, and ownership-bound resume/session configuration remain production gates. Query strings and logs must still be redacted because the server-to-Hume connection uses Hume's required credential query.

## Run The CLM Locally

`server/clm-server.cjs` requires Node.js 22 or newer. Install its pinned runtime dependencies separately from the mobile workspace:

```bash
npm ci --prefix server
```

Configure these server-only variables for the complete local backend:

```bash
NODE_ENV=development
PORT=8787
HUME_API_KEY=<server-only Hume API key>
HUME_CONFIG_ID=<server-enforced EVI config ID>
HUME_ALLOWED_VOICE_IDS=<comma-separated approved voice IDs>
HUME_ALLOW_CLIENT_RESUME=false
HUME_CLM_BEARER_TOKEN=<at least 32 random bytes>
AUTH_EXCHANGE_ENABLED=true
SESSION_JWT_SECRET=<at least 32 random bytes>
SESSION_JWT_ISSUER=https://api.veryloving.ai
SESSION_JWT_AUDIENCE=veryloving-mobile
SESSION_JWT_TTL_SECONDS=3600
SESSION_REFRESH_TTL_SECONDS=2592000
APPLE_CLIENT_IDS=com.veryloving.app
GOOGLE_TOKEN_AUDIENCES=<Web OAuth client ID>
GOOGLE_AUTHORIZED_PARTIES=<trusted iOS/Android OAuth presenters>
PHONE_AUTH_ENABLED=true
PHONE_AUTH_CHALLENGE_SECRET=<independent 64-character random hex token>
PHONE_AUTH_SUBJECT_SECRET=<stable independent 64-character random hex token>
PHONE_AUTH_CHALLENGE_TTL_SECONDS=300
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_AUTH_TOKEN=<server-only Twilio auth token>
TWILIO_VERIFY_SERVICE_SID=<Twilio Verify service SID>
SAFETY_API_ENABLED=true
SAFETY_TABLE_NAME=<DynamoDB table with PK and SK string keys>
SAFETY_RETENTION_DAYS=30
AWS_REGION=<deployment region>
APP_AUTH_VERIFY_URL=
```

Generate independent CLM and session secrets with `openssl rand -hex 32`. Do not use an `EXPO_PUBLIC_` variable for either server secret. `APP_AUTH_VERIFY_URL` is an optional external-verifier fallback; it is not needed when all protected callers use the in-repository session JWT. The safety API requires a verified principal with `sub`, so its supported production path is the built-in session JWT.

Keep `HUME_ALLOW_CLIENT_RESUME=false` until a server-side ownership record binds every resumed chat group to the authenticated subject. If `HUME_CONFIG_ID` is set, it overrides the client choice; `HUME_ALLOWED_VOICE_IDS` restricts client-selected voices.

The CLM has a deterministic safety response layer for urgent requests and service outages. To use an existing hosted model for richer non-urgent conversation, configure any OpenAI-compatible streaming endpoint:

```bash
CLM_UPSTREAM_URL=https://provider.example/v1/chat/completions
CLM_UPSTREAM_API_KEY=<server-only provider key>
CLM_UPSTREAM_MODEL=<provider model identifier>
CLM_UPSTREAM_TIMEOUT_MS=25000
```

The upstream is optional. Tool calls and immediate-danger handling remain available without it. The CLM response path never contacts emergency services. A separately authenticated, user-confirmed SOS request can persist a recent location and contact IDs, but notification delivery and receipts still require a distinct reviewed workflow.

1. Create a local server environment file:

```bash
cp server/.env.example server/.env
openssl rand -hex 32
```

2. Put independent generated values in `HUME_CLM_BEARER_TOKEN`, `SESSION_JWT_SECRET`, `PHONE_AUTH_CHALLENGE_SECRET`, and `PHONE_AUTH_SUBJECT_SECRET`. Keep the subject secret stable across JWT-key rotations, store the Twilio token server-side, and use real provider assertions/codes for auth testing; the app has no fixed-code or development-token fallback. Leave the optional upstream variables empty to exercise deterministic local responses.

3. Load the variables and start the server:

```bash
set -a
source server/.env
set +a
npm run clm:start
```

4. Verify health and authentication behavior:

```bash
curl http://localhost:8787/health
curl -i http://localhost:8787/chat/completions \
  -H "Authorization: Bearer $HUME_CLM_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"model":"veryloving-safety-clm","messages":[{"role":"user","content":"Hello"}]}'
```

5. Expose port `8787` through an HTTPS development tunnel. Use the resulting URL ending in `/chat/completions` when provisioning Hume. Do not expose the local server without its bearer token.

The service can also be exercised through Docker:

```bash
docker build -f server/Dockerfile -t veryloving-clm .
docker run --env-file server/.env -p 8787:8787 veryloving-clm
```

Expose the CLM through HTTPS before adding it to Hume. The public URL must end with `/chat/completions`.

## Deploy HTTP Endpoints On Vercel

Vercel requires supported functions under the project `api/` directory for this deployment. `server/api/index.js` invokes the existing `createHandler()` with `httpOnlyDeployment: true`; `server/vercel.json` rewrites every app route to that one Function while preserving the original path. The adapter deliberately does not call `createVeryLovingCLMServer()` or attach the raw `upgrade` listener.

1. Import this repository into Vercel and set the project's **Root Directory** to `server`. This is required: Vercel must see `api/index.js`, `vercel.json`, and the server-specific `package.json` at the project root so it installs the AWS SDK and `ws` dependencies. Leave the framework preset as Other and keep build/output commands at their defaults.
2. Add the required production auth, phone, safety, JWT, Twilio, and DynamoDB values from `server/.env.example` to the Vercel project environment. Do not set `PORT`; Vercel invokes the Function and owns request routing. Shared configuration reads environment values, but HTTP-only startup does not require or validate `HUME_API_KEY`, `HUME_CONFIG_ID`, or `HUME_ALLOWED_VOICE_IDS` as gateway requirements. Do not install those gateway-only values in Vercel. Set `HUME_CLM_BEARER_TOKEN` if this deployment will serve Hume's `/chat/completions` calls; without it that route fails closed with HTTP `503` while health, auth, and safety startup validation remains strict. Keep every secret server-side and never use an `EXPO_PUBLIC_` name for it. The full container entrypoint continues to require complete Hume voice configuration in production.
3. Deploy, then verify the HTTP Function adapter:

```bash
curl --fail https://<vercel-project>.vercel.app/health
curl -i -X POST https://<vercel-project>.vercel.app/chat/completions \
  -H 'Content-Type: application/json' \
  --data '{"messages":[]}'
```

The health request must return the documented liveness JSON. Without configured CLM authentication the POST returns `503`; after configuration, a missing/incorrect bearer returns `401`. Then run an authenticated SSE probe and test provider exchange, Twilio Verify, DynamoDB account isolation, safety mutations, privacy export/deletion, timeouts, and rollback against that exact deployment. Health or a route-level `404` is not authentication evidence. `server/vercel.json` bounds a function invocation to 60 seconds; keep the configured upstream timeout below that ceiling and verify Hume's end-to-end CLM latency.

4. Set `EXPO_PUBLIC_API_BASE_URL=https://<vercel-project>.vercel.app`. The same root may be used for `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL`, and Hume may use `https://<vercel-project>.vercel.app/chat/completions` as `HUME_CLM_URL`, only after their respective production tests pass.

The existing Hume gateway is a long-lived raw WebSocket adapter attached to an `http.Server` upgrade event. It is not mounted by `server/api/index.js`, has not been adapted to or load-tested on Vercel's WebSocket facilities, and must not be inferred from a successful Vercel HTTP deployment. Keep `EXPO_PUBLIC_HUME_WS_PROXY_URL` pointed at a separately reviewed `wss://` host (for example, the Docker service on Railway or ECS/Fargate) until a Vercel-specific transport is implemented and validated. Do not point it at `wss://<vercel-project>.vercel.app/api/voice/hume-ws`.

## Deploy On Railway

An isolated staging container is currently live in Railway project `calm-delight`, environment `staging`, service `veryloving-clm-staging`, at `https://veryloving-clm-staging-staging.up.railway.app`. Deployment `f2ff7bcd-62e7-4e47-9280-678eb6c18117` built the Docker image and runs in Singapore. Public `/health` returned the exact liveness response; invalid Google exchange failed with `401`; disabled phone and CLM routes failed with `503`; and an invalid first WebSocket authentication frame was rejected with close code `4001`. This is staging liveness/fail-closed evidence only: Hume credentials/configuration, authenticated live audio, replay/revocation/rate limits, ingress restriction, load/backpressure, signed clients, production secrets, and rollback remain open.

1. Create or select an isolated Railway project/environment and connect this repository at its root. The committed root `railway.toml` selects `server/Dockerfile`, watches `server/**` and `railway.toml`, sets health path `/health` with a 60-second timeout, and configures restart-on-failure with three retries. Do not set `RAILWAY_DOCKERFILE_PATH` unless deliberately overriding the reviewed file.
2. In the service Variables tab, add:

```bash
NODE_ENV=production
HUME_API_KEY=<server-only Hume API key>
HUME_CONFIG_ID=<approved Hume config ID>
HUME_ALLOWED_VOICE_IDS=<approved comma-separated voice IDs>
HUME_ALLOW_CLIENT_RESUME=false
HUME_CLM_BEARER_TOKEN=<64-character random hex token>
AUTH_EXCHANGE_ENABLED=true
SESSION_JWT_SECRET=<independent 64-character random hex token>
SESSION_JWT_ISSUER=https://api.veryloving.ai
SESSION_JWT_AUDIENCE=veryloving-mobile
SESSION_JWT_TTL_SECONDS=3600
SESSION_REFRESH_TTL_SECONDS=2592000
APPLE_CLIENT_IDS=com.veryloving.app
GOOGLE_TOKEN_AUDIENCES=<Web OAuth client ID>
GOOGLE_AUTHORIZED_PARTIES=<trusted iOS/Android OAuth presenters>
PHONE_AUTH_ENABLED=true
PHONE_AUTH_CHALLENGE_SECRET=<independent 64-character random hex token>
PHONE_AUTH_SUBJECT_SECRET=<stable independent 64-character random hex token>
PHONE_AUTH_CHALLENGE_TTL_SECONDS=300
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_AUTH_TOKEN=<server-only Twilio auth token>
TWILIO_VERIFY_SERVICE_SID=<Twilio Verify service SID>
SAFETY_API_ENABLED=true
SAFETY_TABLE_NAME=<DynamoDB table name>
SAFETY_RETENTION_DAYS=30
AWS_REGION=<DynamoDB region>
CLM_UPSTREAM_URL=https://provider.example/v1/chat/completions
CLM_UPSTREAM_API_KEY=<server-only provider key>
CLM_UPSTREAM_MODEL=<provider model identifier>
CLM_UPSTREAM_TIMEOUT_MS=25000
```

The three upstream model variables are optional as a group. Phone authentication is enabled only when its complete Twilio and independent-secret configuration passes startup validation.

3. Deploy the exact commit containing `railway.toml` and the reviewed server changes. Read back the effective configuration and record the source SHA and deployment ID. Under Settings > Networking, generate an environment-specific public domain or attach the approved production voice domain.
4. The committed health check should gate deployment on `/health`; verify externally:

```bash
curl https://<railway-domain>/health
```

5. Choose one topology before assigning URLs. In a reviewed single-container deployment, use `https://<railway-domain>/chat/completions` as `HUME_CLM_URL`, the domain root as `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL`, and `wss://<railway-domain>/api/voice/hume-ws` for voice. In the recommended Vercel-authoritative split, keep API/customization/CLM on Vercel, point only `EXPO_PUBLIC_HUME_WS_PROXY_URL` at Railway, and have the Railway ingress deny every public path except `/health` and the WebSocket upgrade route.

Railway injects its own `PORT`; the server reads that value automatically. Secrets belong in Railway Variables, not Expo public variables or repository files.

This container handles both HTTP and WebSocket upgrades. Railway or any fronting proxy must preserve `Upgrade`/`Connection` semantics, use a reviewed idle timeout, bound concurrent connections and request rates, and avoid logging headers, frames, URL queries, audio, messages, or precise location. A `200` from `/health` proves only that the process is alive; separately test the auth exchange, safety API, authenticated WebSocket handshake, Hume connection, and DynamoDB permissions.

Railway is the documented container example because `server/Dockerfile` is directly deployable there. The Vercel path above is an HTTP-only alternative, not a replacement host for the WebSocket gateway. The root `railway.toml` defines only minimal service build, watch, liveness, and process-restart behavior; it does not provision Railway projects/environments, variables/secrets, domains, ingress restrictions, rate/connection limits, observability, provider resources, or rollback. The same image can run on another standards-compliant container platform.

## Deploy On AWS (ECS Fargate Or Existing-Customer App Runner)

This is an operator runbook, not evidence that AWS infrastructure has been provisioned. The repository has no CDK, Terraform, CloudFormation, ECR repository, IAM role, DynamoDB table, custom domain, or deployment pipeline. AWS deploys the same HTTP/WebSocket container described above; it does not create SMS, push/contact delivery, complete map/SOS workflows, or remote privacy orchestration.

AWS states that App Runner is no longer open to new customers. Existing App Runner customers can use the App Runner path below; new AWS customers should deploy the same image on [Amazon ECS with Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html).

1. Build an immutable release image from the repository root, create a private ECR repository if needed, and push a commit-addressed tag:

```bash
docker build -f server/Dockerfile -t veryloving-clm:<git-sha> .
aws ecr create-repository --repository-name veryloving-clm --region <region>
aws ecr get-login-password --region <region> | \
  docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
docker tag veryloving-clm:<git-sha> \
  <account>.dkr.ecr.<region>.amazonaws.com/veryloving-clm:<git-sha>
docker push <account>.dkr.ecr.<region>.amazonaws.com/veryloving-clm:<git-sha>
```

2. Enable ECR tag immutability. For ECS/Fargate, create a task definition for the reviewed commit-addressed image with `awsvpc` networking, container port `8787`, an `awslogs` log configuration, a least-privilege task execution role, and a task role limited to the safety table. Create a Fargate service behind an Application Load Balancer whose target group uses `GET /health`; terminate HTTPS with an approved ACM certificate, verify WebSocket upgrade forwarding and idle timeout, and allow the task security group to receive port `8787` only from the load balancer. Existing App Runner customers may instead [create an App Runner service from the private ECR image](https://docs.aws.amazon.com/apprunner/latest/dg/manage-create.html), provide an ECR access role, and configure container port `8787` plus HTTP health-check path `/health`.
3. Create or approve a DynamoDB table with string partition and sort keys named `PK` and `SK`. Enable DynamoDB TTL on the numeric `expiresAt` attribute, encryption, point-in-time recovery, backups, alarms, and an approved retention/deletion process. Grant the task role only `dynamodb:Query`, `dynamodb:GetItem`, `dynamodb:PutItem`, and `dynamodb:DeleteItem` on that table. The application stores contact PII and may store recent SOS location, so do not treat default table creation or eventual TTL deletion as privacy approval.
4. Add non-secret runtime configuration:

```bash
NODE_ENV=production
AUTH_EXCHANGE_ENABLED=true
SESSION_JWT_ISSUER=https://api.veryloving.ai
SESSION_JWT_AUDIENCE=veryloving-mobile
SESSION_JWT_TTL_SECONDS=3600
SESSION_REFRESH_TTL_SECONDS=2592000
APPLE_CLIENT_IDS=com.veryloving.app
GOOGLE_TOKEN_AUDIENCES=<Web OAuth client ID>
GOOGLE_AUTHORIZED_PARTIES=<trusted iOS/Android OAuth presenters>
PHONE_AUTH_ENABLED=true
PHONE_AUTH_CHALLENGE_TTL_SECONDS=300
TWILIO_ACCOUNT_SID=<Twilio account SID>
TWILIO_VERIFY_SERVICE_SID=<Twilio Verify service SID>
SAFETY_API_ENABLED=true
SAFETY_TABLE_NAME=<DynamoDB table name>
SAFETY_RETENTION_DAYS=30
AWS_REGION=<region>
HUME_CONFIG_ID=<approved Hume config ID>
HUME_ALLOWED_VOICE_IDS=<approved voice IDs>
HUME_ALLOW_CLIENT_RESUME=false
CLM_UPSTREAM_URL=https://provider.example/v1/chat/completions
CLM_UPSTREAM_MODEL=<provider model identifier>
CLM_UPSTREAM_TIMEOUT_MS=25000
```

The upstream variables are optional as a group. On ECS, set `PORT=8787` in the task definition. Existing App Runner customers must not define `PORT`: App Runner supplies its reserved `PORT` variable, and the service must be configured to the same `8787` container port. See AWS's [App Runner runtime guidance](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html).

5. Reference `HUME_API_KEY`, `HUME_CLM_BEARER_TOKEN`, `SESSION_JWT_SECRET`, `PHONE_AUTH_CHALLENGE_SECRET`, `PHONE_AUTH_SUBJECT_SECRET`, `TWILIO_AUTH_TOKEN`, and optional `CLM_UPSTREAM_API_KEY` from AWS Secrets Manager rather than entering secret values as plain environment variables. For ECS, map secret ARNs through the task definition and grant only the task execution role the required retrieval permissions. Existing App Runner customers should use its supported [Secrets Manager and Parameter Store environment references](https://docs.aws.amazon.com/apprunner/latest/dg/env-variable.html). Grant only the required `secretsmanager:GetSecretValue` and, when applicable, KMS decrypt permissions.
6. Attach the approved custom domain, verify its TLS certificate and DNS, and configure HTTP and WebSocket limits, frame/body limits, timeouts, rate limits, log redaction, alarms, and retention at the surrounding AWS boundary. Rotate a secret by publishing a new secret version and deliberately redeploying the service so the running revision receives it.
7. Verify the staged service before routing production traffic:

```bash
curl --fail --silent --show-error https://<aws-domain>/health
curl -i https://<aws-domain>/chat/completions \
  -H 'Content-Type: application/json' \
  --data '{"messages":[]}'
```

The health request must succeed and the unauthenticated CLM request must fail. Then test provider exchange, invalid/expired session JWTs, Dynamo contact/SOS/session operations, the first-frame WebSocket handshake, an authenticated SSE request, a forced ECS task replacement (or App Runner redeploy), and rollback. Use the AWS domain for every mobile/CLM/WSS URL only in the reviewed single-container topology. In the Vercel-authoritative split, point only WSS at AWS and deny its duplicate public HTTP API paths at the ALB/WAF.

## Production Authentication Contract

The in-repository exchange verifies Apple/Google RS256 signatures against official JWKS endpoints and validates issuer, allowed audience, expiry, future issue time, Google authorized party, and Apple nonce when supplied. It then issues a scoped HS256 access JWT and a refresh JWT with a refresh-only audience/scope. The app stores both in SecureStore, renews before access expiry, rotates the client-held refresh token on each successful refresh, retries transient outages, and clears rejected refresh sessions. It never persists the provider assertion as its app session.

Before enabling CLM or live voice in a release build:

1. Configure exact Apple and Google client-ID allowlists and prove success, cancellation, wrong audience/issuer, expired assertion, invalid signature, Apple nonce mismatch, key rotation, and provider outage behavior.
2. Production-harden the implemented refresh flow with server-side refresh-family state, old-token reuse detection, revocation/account disablement, deletion tombstones, replay/abuse controls, provider credential-state checks, and consistent authenticated-request 401 retry. Rotation currently replaces the client-held token but does not invalidate the old stateless refresh JWT before expiry.
3. Use an independently generated `SESSION_JWT_SECRET`, document rotation/overlap, and keep issuer/audience consistent across exchange, HTTP endpoints, and the gateway.
4. Treat the first-frame session token as a bearer credential. Add connection rate limits, revocation, replay resistance or a narrower single-use ticket, and redact it from ingress, application, tracing, and crash telemetry.
5. Keep client resume disabled until chat ownership is enforced. Production proxy mode must continue configuring sessions in the authenticated gateway; keep the chat-ID `/v1/hume/session/configure` fallback restricted to direct development unless ownership binding is implemented.
6. Rate-limit token exchange, session configuration, safety tools, safety mutations, and WebSocket creation independently. Record security events without message text, audio, precise location, raw session IDs, or credentials.

Phone/SMS authentication is implemented through signed, short-lived challenges and Twilio Verify. Deployment credentials, Twilio geo/fraud/rate-limit policy, distributed API abuse controls, provider delivery evidence, and physical-device verification remain external launch work. `APP_AUTH_VERIFY_URL` remains an optional verifier fallback for app-facing HTTP endpoints; no developer bearer-token mechanism exists.

## Design The Branded Voice

First inject `HUME_API_KEY` into the current process through the approved secret-manager runner; do not type the key on a command line or save it in shell history. Then generate three Octave 1 candidates:

```bash
npm run hume:voice:generate
```

Listen to the files under `artifacts/hume-voice/`, choose a `generationId` from its manifest, and save it:

```bash
npm run hume:voice:save -- <generation-id> "VeryLoving Warm Guardian"
```

The returned voice ID is used as `HUME_CUSTOM_VOICE_ID` during config provisioning and as `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` in the app.

## Provision The Safety Tool And Hume Config

The provisioning script registers the `get_safety_tips` function schema and creates an EVI 3 configuration that references both the tool and CLM. Supplying existing IDs publishes new versions instead of deleting production resources.

Run it only from an audited operator process where the approved secret runner has already injected `HUME_API_KEY`; the examples below intentionally omit the secret.

```bash
HUME_CLM_URL=https://voice-api.veryloving.ai/chat/completions \
HUME_CUSTOM_VOICE_ID=<voice-id> \
npm run hume:provision
```

The command prints the resulting `toolId` and `configId`. Save both in the deployment secret manager. To publish a later version without creating duplicate resources:

```bash
HUME_CLM_URL=https://voice-api.veryloving.ai/chat/completions \
HUME_TOOL_ID=<existing-tool-id> \
HUME_CONFIG_ID=<existing-config-id> \
HUME_CUSTOM_VOICE_ID=<voice-id> \
npm run hume:provision
```

For an update, additionally set `HUME_TOOL_ID` and `HUME_CONFIG_ID`. Put the returned config ID in the Expo build environment:

```bash
EXPO_PUBLIC_HUME_CONFIG_ID=<config-id>
EXPO_PUBLIC_HUME_CUSTOMIZATION_URL=https://voice-api.veryloving.ai
EXPO_PUBLIC_HUME_CLM_ENABLED=true
EXPO_PUBLIC_HUME_BRANDED_VOICE_ID=<voice-id>
```

Leave `EXPO_PUBLIC_HUME_CONFIG_ID` empty when testing Hume's default EVI configuration. In proxy mode, the client never places it in the URL; it sends the choice in the first authenticated frame. A valid custom configuration ID is still required to activate VeryLoving's CLM, custom tools, and branded voice settings. Set server `HUME_CONFIG_ID` to the same approved value to prevent arbitrary client selection.

Keep `EXPO_PUBLIC_HUME_CLM_ENABLED=false` until the authenticated gateway and CLM endpoints are deployed. Otherwise the app intentionally blocks microphone startup when secure CLM setup fails.

The current production mobile path must use `EXPO_PUBLIC_HUME_WS_PROXY_URL`, normally ending in `/api/voice/hume-ws` on the separately deployed container voice host. The Vercel HTTP adapter is not a valid value for this variable. A direct temporary Hume token remains a lower-level development option but is not fetched by the mobile hook. `EXPO_PUBLIC_HUME_API_KEY` remains a development-only compatibility path and is rejected at runtime in release builds; do not define it in an EAS production environment.

## Runtime Flow

1. Apple/Google Sign-In returns a provider identity token; the app posts it to `/v1/auth/exchange`, stores the validated VeryLoving access/refresh pair and profile in secure storage, and does not retain the provider assertion.
2. The app opens the configured WSS proxy URL with no token or Hume connection parameters in the query.
3. Its first frame is `{ type: "authenticate", access_token, connection: { config_id, voice_id, resumed_chat_group_id } }`.
4. The gateway validates the session JWT and `voice:connect` scope, enforces configured Hume config/voice policy, then opens Hume with the server-only API key. On upstream open it sends `auth_ok` to the app; failures return `auth_error` and close.
5. The app sends `custom_session_id` and the declared 48 kHz, mono, Linear16 format in `session_settings`. The gateway strips any client CLM key and injects its server-only `HUME_CLM_BEARER_TOKEN` before forwarding the first settings frame to Hume.
6. Hume returns `chat_metadata`; the app stores `chat_id` and `chat_group_id` locally. Proxy mode does not make the separate chat-ID control-plane request.
7. Only after authenticated gateway setup and `chat_metadata` succeed does the app enter `connected` and start the microphone.
8. A root-mounted `expo-audio` stream requests 48 kHz mono Int16 buffers. The audio service validates the native format, base64-encodes each headerless PCM frame, and the WebSocket service sends chunked `audio_input` frames with a backpressure limit. Received assistant audio is queued and played serially.
9. EVI tool calls are validated, executed against the authenticated safety-tips endpoint, and returned as correlated `tool_response` messages. Stale calls are aborted.

The PCM and gateway paths are implemented and covered by deterministic tests, but they were added after the recorded simulator validation. Continuous capture, full-duplex playback, interruptions, echo, Bluetooth routes, background/foreground transitions, lock screen, frame timing, reconnect under packet loss, and repeated resource cleanup still require signed physical-device evidence. Expo/native audio-session behavior must be verified rather than inferred from the configured background modes.

## Verification

```bash
npm test
npm run lint
npx expo export --platform ios
```

Verify the deployed HTTP boundaries separately:

```bash
curl --fail --silent --show-error https://<clm-domain>/health
curl -i -X POST https://<clm-domain>/chat/completions \
  -H 'Content-Type: application/json' \
  --data '{"messages":[]}'
curl -i -X POST https://<clm-domain>/v1/safety/tips \
  -H 'Content-Type: application/json' \
  --data '{"scenario":"general"}'
```

The unauthenticated POST requests must fail; they are not health probes. Then verify valid and invalid provider exchanges, expired/wrong-audience app sessions, account-isolated contact/SOS/session requests against the production DynamoDB table, and a real WSS client whose first frame authenticates before any Hume payload. Confirm query strings, ingress logs, application logs, tracing, and crash reports remain redacted.

On real devices, verify a new call, a resumed history item only after ownership binding is implemented, a safety-tips request, airplane-mode fallback, queued typed messages, reconnection, microphone interruption, Bluetooth routing, backgrounding, and lock-screen cleanup. Audio quality, continuous PCM timing, echo cancellation, and production gateway behavior cannot be validated reliably in the simulator.

See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for the complete stop-ship and release evidence matrix.
