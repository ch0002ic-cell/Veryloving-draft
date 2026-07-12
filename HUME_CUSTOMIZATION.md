# Hume EVI Customization

VeryLoving uses Hume's supported customization surfaces rather than modifying a Hume SDK:

- An OpenAI-compatible SSE Custom Language Model endpoint at `POST /chat/completions`.
- A `get_safety_tips` function tool registered on the EVI configuration.
- `custom_session_id` in `session_settings` and `resumed_chat_group_id` on reconnect.
- Hume's control plane to inject the CLM bearer key from the server after `chat_metadata` arrives.
- Octave voice design through the official TTS and voice-management endpoints.

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

6. Use `https://<railway-domain>/chat/completions` as `HUME_CLM_URL`. Configure the app with the domain root as `EXPO_PUBLIC_HUME_CUSTOMIZATION_URL` only after the authenticated session configuration endpoint is reachable.

Railway injects its own `PORT`; the server reads that value automatically. Secrets belong in Railway Variables, not Expo public variables or repository files.

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

Keep `EXPO_PUBLIC_HUME_CLM_ENABLED=false` until the control-plane and CLM endpoints are deployed. Otherwise the app intentionally blocks microphone startup when secure CLM setup fails.

Production builds must use `EXPO_PUBLIC_HUME_WS_PROXY_URL` (or provide a temporary `humeAccessToken` from a trusted backend). `EXPO_PUBLIC_HUME_API_KEY` remains a development-only compatibility path and is rejected at runtime in release builds; do not define it in an EAS production environment.

## Runtime Flow

1. The app opens the EVI WebSocket with the config ID and optional prior `resumed_chat_group_id`.
2. It sends `custom_session_id` in `session_settings`.
3. Hume returns `chat_metadata`; the app stores `chat_id` and `chat_group_id` locally.
4. The app asks the authenticated backend to configure that chat. The backend sends the CLM key through Hume's control plane.
5. Only after step 4 succeeds does the app enter `connected` and start the microphone.
6. EVI tool calls are validated, executed against the authenticated safety-tips endpoint, and returned as `tool_response` messages. Stale calls are aborted.

## Verification

```bash
npm test
npm run lint
npx expo export --platform ios
```

On a real device, verify a new call, a resumed history item, a safety-tips request, airplane-mode fallback, queued typed messages, and reconnection. Audio quality and echo cancellation cannot be validated reliably in the simulator.
