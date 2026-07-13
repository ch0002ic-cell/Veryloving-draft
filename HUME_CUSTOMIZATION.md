# Hume EVI Customization

VeryLoving uses Hume's supported customization surfaces rather than modifying a Hume SDK:

- An OpenAI-compatible SSE Custom Language Model endpoint at `POST /chat/completions`.
- A `get_safety_tips` function tool registered on the EVI configuration.
- `custom_session_id` in `session_settings` and `resumed_chat_group_id` on reconnect.
- Hume's control plane to inject the CLM bearer key from the server after `chat_metadata` arrives.
- Octave voice design through the official TTS and voice-management endpoints.

## Implemented Architecture And Boundaries

This repository contains two runtime components:

1. The Expo/React Native mobile client.
2. A dependency-free Node 22 HTTP service in `server/clm-server.cjs`, packaged by `server/Dockerfile`.

The Node service implements:

| Method and path | Caller | Authentication | Purpose |
| --- | --- | --- | --- |
| `GET /health` | Hosting platform/operator | None | Liveness only; returns the CLM service identity. |
| `POST /chat/completions` | Hume CLM | `HUME_CLM_BEARER_TOKEN` | OpenAI-compatible SSE completion, deterministic safety handling, tools, and optional upstream model. |
| `POST /v1/safety/tips` | Mobile-triggered Hume tool | VeryLoving app bearer verified through `APP_AUTH_VERIFY_URL` | Returns curated safety guidance. |
| `POST /v1/hume/session/configure` | Mobile app after `chat_metadata` | VeryLoving app bearer verified through `APP_AUTH_VERIFY_URL` | Injects the CLM bearer into the Hume chat through Hume's control plane. |

The health endpoint and its response are covered by `server/clm-server.test.cjs`. It intentionally reports process liveness, not readiness of Hume credentials, app authentication, or an optional upstream model. The protected endpoints fail closed when their required authentication is absent.

The production topology is split deliberately:

```text
Expo mobile app
  |-- HTTPS app session/tool/config requests --> production auth/API gateway (external; incomplete)
  |                                                `--> Node CLM/control-plane service (this repo)
  `-- WSS EVI audio/messages -----------------> authenticated Hume proxy (external; missing)
                                                   `--> Hume EVI

Hume CLM -------------------------------------> POST /chat/completions (this repo)
                                                    `--> optional upstream model
```

Deploying `server/Dockerfile` alone does **not** provide `/api/voice/hume-ws`, provider-token exchange, refresh tokens, SMS, push delivery, durable SOS/guardian state, location sharing, or a database. The repository contains no Next.js, Vercel, AWS, DynamoDB, or SES implementation, and those technologies must not be claimed as deployed architecture.

The mobile client currently forwards its app credential into the configured WebSocket URL. That is a documented launch blocker, not an approved production authentication design. The production gateway should exchange verified provider credentials for a VeryLoving session and issue a short-lived, audience-bound, preferably single-use WebSocket ticket. Query strings and logs must not contain a long-lived bearer token.

## Run The CLM Locally

`server/clm-server.cjs` has no runtime package dependencies and requires Node.js 22 or newer. Configure these server-only variables:

```bash
NODE_ENV=production
PORT=8787
HUME_API_KEY=<server-only Hume API key>
HUME_CLM_BEARER_TOKEN=<at least 32 random bytes>
APP_AUTH_VERIFY_URL=https://api.veryloving.ai/v1/auth/verify
```

Generate the CLM token with `openssl rand -hex 32`. Do not use an `EXPO_PUBLIC_` variable for either server secret.

The CLM has a deterministic safety response layer for urgent requests and service outages. To use an existing hosted model for richer non-urgent conversation, configure any OpenAI-compatible streaming endpoint:

```bash
CLM_UPSTREAM_URL=https://provider.example/v1/chat/completions
CLM_UPSTREAM_API_KEY=<server-only provider key>
CLM_UPSTREAM_MODEL=<provider model identifier>
CLM_UPSTREAM_TIMEOUT_MS=25000
```

The upstream is optional. Tool calls and immediate-danger handling remain available without it. The service deliberately does not send locations or contact emergency services; those actions require a separate confirmation and delivery workflow.

1. Create a local server environment file:

```bash
cp server/.env.example server/.env
openssl rand -hex 32
```

2. Put the generated value in `HUME_CLM_BEARER_TOKEN`. Set `DEV_APP_TOKEN` to the same development bearer token used by the Expo app's local authentication flow. Leave the optional upstream variables empty to exercise deterministic local responses.

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

## Deploy On Railway

1. Create a Railway project and add this GitHub repository as a service.
2. Set `RAILWAY_DOCKERFILE_PATH=/server/Dockerfile` so Railway builds the dedicated CLM image.
3. In the service Variables tab, add:

```bash
NODE_ENV=production
HUME_API_KEY=<server-only Hume API key>
HUME_CLM_BEARER_TOKEN=<64-character random hex token>
APP_AUTH_VERIFY_URL=https://api.veryloving.ai/v1/auth/verify
CLM_UPSTREAM_URL=https://provider.example/v1/chat/completions
CLM_UPSTREAM_API_KEY=<server-only provider key>
CLM_UPSTREAM_MODEL=<provider model identifier>
CLM_UPSTREAM_TIMEOUT_MS=25000
```

The three upstream variables are optional as a group. Never configure `DEV_APP_TOKEN` in production.

4. Deploy the staged Railway changes. Under Settings > Networking, generate a public domain or attach the production voice domain.
5. Set the service health-check path to `/health` and verify:

```bash
curl https://<railway-domain>/health
```

6. Use `https://<railway-domain>/chat/completions` as `HUME_CLM_URL`. Configure the app with the domain root as `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` only after both authenticated application endpoints are reachable through the production app-token verifier.

Railway injects its own `PORT`; the server reads that value automatically. Secrets belong in Railway Variables, not Expo public variables or repository files.

This container serves HTTP requests only; it does not handle WebSocket upgrades. Do not point `EXPO_PUBLIC_HUME_WS_PROXY_URL` at this Railway service unless a separate gateway or proxy has been deployed on that domain and routes `/api/voice/hume-ws` to a real authenticated WebSocket implementation. A `200` from `/health` proves only that the CLM process is alive.

Railway is the documented example because `server/Dockerfile` is directly deployable there. The same image can run on another standards-compliant container platform, but no alternative cloud infrastructure is defined in this repository.

## Deploy On AWS (ECS Fargate Or Existing-Customer App Runner)

This is an operator runbook, not evidence that AWS infrastructure has been provisioned. The repository has no CDK, Terraform, CloudFormation, ECR repository, IAM role, custom domain, or deployment pipeline. AWS deploys only the same HTTP CLM/control-plane container described above; it does not create the external auth/SMS, push, map/SOS, or Hume WebSocket-proxy services.

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

2. Enable ECR tag immutability. For ECS/Fargate, create a task definition for the reviewed commit-addressed image with `awsvpc` networking, container port `8787`, an `awslogs` log configuration, a least-privilege task execution role, and a task role only if runtime AWS API access is needed. Create a Fargate service behind an Application Load Balancer whose target group uses `GET /health`; terminate HTTPS with an approved ACM certificate and allow the task security group to receive port `8787` only from the load balancer. Existing App Runner customers may instead [create an App Runner service from the private ECR image](https://docs.aws.amazon.com/apprunner/latest/dg/manage-create.html), provide an ECR access role, and configure container port `8787` plus HTTP health-check path `/health`.
3. Add non-secret runtime configuration:

```bash
NODE_ENV=production
APP_AUTH_VERIFY_URL=https://api.veryloving.ai/v1/auth/verify
CLM_UPSTREAM_URL=https://provider.example/v1/chat/completions
CLM_UPSTREAM_MODEL=<provider model identifier>
CLM_UPSTREAM_TIMEOUT_MS=25000
```

The upstream variables are optional as a group. On ECS, set `PORT=8787` in the task definition. Existing App Runner customers must not define `PORT`: App Runner supplies its reserved `PORT` variable, and the service must be configured to the same `8787` container port. See AWS's [App Runner runtime guidance](https://docs.aws.amazon.com/apprunner/latest/dg/develop.html).

4. Reference `HUME_API_KEY`, `HUME_CLM_BEARER_TOKEN`, and optional `CLM_UPSTREAM_API_KEY` from AWS Secrets Manager rather than entering secret values as plain environment variables. For ECS, map secret ARNs through the task definition and grant only the task execution role the required retrieval permissions. Existing App Runner customers should use its supported [Secrets Manager and Parameter Store environment references](https://docs.aws.amazon.com/apprunner/latest/dg/env-variable.html). Grant only the required `secretsmanager:GetSecretValue` and, when applicable, KMS decrypt permissions. Never configure `DEV_APP_TOKEN` in production.
5. Attach the approved custom domain, verify its TLS certificate and DNS, and configure request limits, rate limits, log redaction, alarms, and retention at the surrounding AWS boundary. Rotate a secret by publishing a new secret version and deliberately redeploying the service so the running revision receives it.
6. Verify the staged service before routing production traffic:

```bash
curl --fail --silent --show-error https://<aws-domain>/health
curl -i https://<aws-domain>/chat/completions \
  -H 'Content-Type: application/json' \
  --data '{"messages":[]}'
```

The health request must succeed and the unauthenticated CLM request must fail. Then run an authenticated SSE request, the app-token-protected endpoint contract tests, a forced ECS task replacement (or App Runner redeploy), and a rollback to the preceding image. Use the domain root as `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` only after the external app-token verifier is live. Do not use this HTTP container as `EXPO_PUBLIC_HUME_WS_PROXY_URL`; it has no WebSocket upgrade handler.

## Production Authentication Contract

Before enabling CLM or live voice in a release build:

1. Exchange Apple and Google identity assertions, and phone challenges, at a trusted backend. Validate signature, issuer, audience, nonce where applicable, expiry, and replay/revocation state.
2. Return short-lived VeryLoving access tokens plus rotated refresh tokens. Do not persist a provider identity token as the application's long-lived session.
3. Make `APP_AUTH_VERIFY_URL` validate the VeryLoving access token and its intended audience. A network error, missing verifier, expired token, or invalid token must fail closed.
4. Give the WebSocket proxy a short-lived connection credential. Redact URL queries and authorization data at the load balancer, proxy, application, and tracing layers.
5. Rate-limit token exchange, session configuration, safety tools, and WebSocket creation independently. Record security events without message text, audio, precise location, raw session IDs, or credentials.

The auth/session service and WebSocket proxy described here remain external launch work. The in-repo tests use an injected verifier or development-only `DEV_APP_TOKEN`; `DEV_APP_TOKEN` is rejected as a production authentication mechanism.

## Design The Branded Voice

Generate three Octave 1 candidates:

```bash
HUME_API_KEY=<key> npm run hume:voice:generate
```

Listen to the files under `artifacts/hume-voice/`, choose a `generationId` from its manifest, and save it:

```bash
HUME_API_KEY=<key> npm run hume:voice:save -- <generation-id> "VeryLoving Warm Guardian"
```

The returned voice ID is used as `HUME_CUSTOM_VOICE_ID` during config provisioning and as `EXPO_PUBLIC_HUME_BRANDED_VOICE_ID` in the app.

## Provision The Safety Tool And Hume Config

The provisioning script registers the `get_safety_tips` function schema and creates an EVI 3 configuration that references both the tool and CLM. Supplying existing IDs publishes new versions instead of deleting production resources.

```bash
HUME_API_KEY=<key> \
HUME_CLM_URL=https://voice-api.veryloving.ai/chat/completions \
HUME_CUSTOM_VOICE_ID=<voice-id> \
npm run hume:provision
```

The command prints the resulting `toolId` and `configId`. Save both in the deployment secret manager. To publish a later version without creating duplicate resources:

```bash
HUME_API_KEY=<key> \
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

Leave `EXPO_PUBLIC_HUME_CONFIG_ID` empty when testing Hume's default EVI configuration. The client then omits `config_id` from both direct and proxied WebSocket URLs. A valid custom configuration ID is still required to activate VeryLoving's CLM, custom tools, and branded voice settings.

Keep `EXPO_PUBLIC_HUME_CLM_ENABLED=false` until the control-plane and CLM endpoints are deployed. Otherwise the app intentionally blocks microphone startup when secure CLM setup fails.

The current production mobile path must use `EXPO_PUBLIC_HUME_WS_PROXY_URL`. The lower-level service can accept a temporary `humeAccessToken`, but the mobile hook does not fetch one from a backend today; using that alternative requires a separate token-exchange implementation and tests. `EXPO_PUBLIC_HUME_API_KEY` remains a development-only compatibility path and is rejected at runtime in release builds; do not define it in an EAS production environment.

## Runtime Flow

1. The app obtains a valid VeryLoving session and a short-lived voice connection credential from the external production backend.
2. The app opens the EVI WebSocket through the external proxy with the config ID and optional prior `resumed_chat_group_id`.
3. It sends `custom_session_id` in `session_settings`.
4. Hume returns `chat_metadata`; the app stores `chat_id` and `chat_group_id` locally.
5. The app asks the authenticated backend to configure that chat. The Node service sends the CLM key through Hume's control plane.
6. Only after step 5 succeeds does the app enter `connected` and start the microphone.
7. EVI tool calls are validated, executed against the authenticated safety-tips endpoint, and returned as `tool_response` messages. Stale calls are aborted.

The JavaScript microphone service does not yet emit live 48 kHz mono Linear16 chunks even though that format is declared to Hume. A successful proxy/CLM deployment therefore does not by itself complete live voice; a native dev-client PCM streaming implementation and physical-device audio validation remain mandatory.

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

The unauthenticated POST requests must fail; they are not health probes. Then run authenticated contract tests with short-lived test credentials and confirm logs remain redacted.

On real devices, verify a new call, a resumed history item, a safety-tips request, airplane-mode fallback, queued typed messages, reconnection, microphone interruption, Bluetooth routing, backgrounding, and lock-screen cleanup. Audio quality, continuous PCM, echo cancellation, and production proxy authentication cannot be validated reliably in the simulator.

See [LAUNCH_CHECKLIST.md](./LAUNCH_CHECKLIST.md) for the complete stop-ship and release evidence matrix.
