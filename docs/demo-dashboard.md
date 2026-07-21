# Dual-device demo dashboard

**Status: PASS — local software demonstration.** This dashboard exercises the in-memory AI-native runtime, simulated wearable/robot telemetry, and mock manufacturer command transport. It does not validate physical hardware, clinical performance, carrier delivery, or a manufacturer API.

## Start the demo

Use two terminals from the repository root. The mock manufacturer must be restarted after pulling dashboard changes because its HTML and routes are compiled into the running process.

Terminal 1:

```bash
npm run mock:manufacturer
```

The simulator command and main entrypoint both load the ignored `server/.env`
file while preserving already-exported environment variables. This keeps the
mock API key, fixed demo account, and loopback ports consistent across the two
processes.

Terminal 2:

```bash
source server/.env
node server/server.cjs
```

Required development settings are:

```dotenv
AI_NATIVE_ENABLED=true
AI_NATIVE_DATA_LIFECYCLE_ENABLED=true
AI_NATIVE_SINGLE_REPLICA=true
MOCK_MANUFACTURER_URL=http://127.0.0.1:3001
MOCK_MANUFACTURER_API_KEY=mock-server-only-api-key
# Optional fixed demo account; use the same value in curl examples.
AI_NATIVE_DEMO_USER_ID=test-user-1
```

Do not commit `server/.env`. The values above are simulator-only placeholders, not production credentials.

Open [http://127.0.0.1:3001/dashboard](http://127.0.0.1:3001/dashboard). The page should show:

- a wearable and home robot with online state, battery, last observation, and redacted references;
- buttons for Fall response, Medication adherence, Emotional check-in, Cognitive engagement, and AI Angel auto-dial;
- real execution records read from the main server's in-memory Scenario Engine;
- synthetic lifecycle records and the ten most recent simulator events; and
- a green **Live** indicator while the dashboard SSE stream is connected.

Selecting a scenario disables that control for the request, displays the returned execution reference, and refreshes the real execution table. A scenario can also be triggered without a browser:

```bash
curl -X POST http://127.0.0.1:8787/v1/scenarios \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-fall-20260721-001' \
  -d '{"scenarioId":"fall-detection","userId":"test-user-1","deviceId":"wearable-1"}'
```

## Local API contract

The main server accepts the following exact development request shape at `POST /v1/scenarios`:

```json
{
  "scenarioId": "fall-detection",
  "userId": "test-user-1",
  "deviceId": "wearable-1",
  "robotDeviceId": "home-robot-1",
  "occurredAt": 1784589261143
}
```

`scenarioId` must be one of:

- `fall-detection`
- `medication-adherence`
- `emotional-check-in`
- `cognitive-engagement`
- `ai-angel-auto-dial`

`robotDeviceId` and `occurredAt` are optional. Unknown fields, malformed identifiers, stale or future timestamps, non-JSON bodies, oversized bodies, query strings, and non-loopback callers are rejected.

Send a unique `Idempotency-Key` for each intended scenario execution. Concurrent
or later retries with the same key and identical body join or return the same
execution; reusing that key with a different body returns `409`. The dashboard
generates one key per button click and forwards it unchanged through the
simulator proxy. A client disconnect after admission does not cancel the
scenario; use the explicit cancellation API when cancellation is intended.

`GET /v1/scenarios/executions?userId=test-user-1` returns a bounded, redacted list for that exact account. The response is for the local demo only; a production endpoint must derive the account from an authenticated session rather than accept a caller-selected user ID.

The browser does not receive the simulator API key or call port 8787 directly. `GET /dashboard` issues a random, process-local, `HttpOnly; SameSite=Strict` session cookie. Same-origin mock routes validate that cookie before proxying the exact scenario or execution request to the loopback main server. The simulator rejects production mode, non-loopback bind addresses, credential-bearing upstream URLs, arbitrary upstream paths, and unrecognized fields. The page also uses a nonce-based Content Security Policy and cannot load third-party scripts or styles.

## Live updates and lifecycle

`GET /api/v1/simulation/dashboard/events` is a bounded Server-Sent Events stream. It sends redacted snapshots and is closed when the browser disconnects or the simulator stops. The browser separately refreshes real execution state every three seconds and clears its timer on unload. The server caps concurrent dashboard streams, telemetry streams, connections, queued commands, response sizes, and retained events/executions.

`SIGINT` and `SIGTERM` stop the simulator gracefully: open SSE/telemetry responses are closed, outbound main-server requests are aborted, timers are cleared, queued delays are released, and sockets are drained. The main server also stops accepting new requests and drains existing HTTP connections.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Dashboard still shows raw JSON | Stop and restart `npm run mock:manufacturer`; the old Node process still holds the prior compiled page. |
| **Reconnecting** indicator | Confirm the simulator is still running on `127.0.0.1:3001`, reload `/dashboard` to renew its process-local cookie, and inspect redacted simulator logs. |
| Scenario button reports unavailable | Confirm the main server is on `127.0.0.1:8787`, `AI_NATIVE_ENABLED=true`, and `MOCK_MANUFACTURER_URL` points to the running simulator. |
| No real execution rows | Confirm `GET /v1/scenarios/executions?userId=test-user-1` succeeds locally and reload the dashboard. In-memory executions are intentionally lost when the main server restarts. |
| A request returns `400` or `403` | Use the exact schema above, no query on the POST route, and a loopback address. Browser proxy routes additionally require the cookie issued by `/dashboard`. |
| Intermittent simulated failures | Set `MOCK_MANUFACTURER_FAILURE_RATE=0` for a deterministic presentation. Non-zero failure injection is intentional retry/fallback testing. |

## Verification

```bash
npm test
npm run lint
npm run typecheck:manufacturer-mock
npm run typecheck:ai-native
```

The automated tests cover all five controls, execution listing, origin restrictions, strict request validation, proxy response bounds/timeouts, SSE cleanup, and simulator shutdown. Manual acceptance is complete when both device cards update, each button returns an execution reference, the real and simulator rows reach a terminal state, recent events update without a page refresh, and both Node processes stop cleanly.
