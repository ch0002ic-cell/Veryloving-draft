# Veryloving Backend (reference implementation)

A small, dependency-light **Express** server that implements the contract the
iOS app expects (see [`../docs/BACKEND_API.md`](../docs/BACKEND_API.md)). It uses
**in-memory storage** with optional JSON persistence, a **mock SMS gateway**
(logs to the console), and a **placeholder push service** (logs token
registration). It exists so the app can be exercised end-to-end without standing
up real infrastructure (Twilio, APNs, a database).

> ⚠️ This is a development/reference server, **not production-ready**. Passwords
> are hashed (bcrypt) and JWTs are signed, but there is no rate limiting, no real
> receipt validation, no durable database, and SMS/push are mocked.

## Requirements

- Node.js ≥ 18 (uses the built-in `fetch`). Developed on Node 26.

## Setup

```bash
cd backend
npm install
cp .env.example .env        # then edit JWT_SECRET
npm start                   # http://localhost:3000
```

Useful scripts:

| Command | What it does |
|---------|--------------|
| `npm start` | Run the server. |
| `npm run dev` | Run with `node --watch` (auto-restart on file change). |
| `npm run smoke` | Boot the app in-process and replay the real client payloads, asserting decode-compatibility. |

Verify it's up:

```bash
curl -s http://localhost:3000/health        # → {"status":"ok"}
```

## Configuration (`.env`)

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3000` | HTTP port. |
| `JWT_SECRET` | `change_this` | **Change this.** HS256 signing secret. |
| `ACCESS_TTL_SECONDS` | `3600` | Echoed to the client as `expires_in`. |
| `REFRESH_TTL_SECONDS` | `2592000` | Refresh-token lifetime (30 days). |
| `PERSIST` | `true` | Mirror the store to `data/db.json`. Set `false` for pure in-memory. |
| `BCRYPT_ROUNDS` | `10` | Password hash cost factor. |

## How it matches the iOS client

The app decodes JSON with `JSONDecoder` configured for `.convertFromSnakeCase`
and `.iso8601` dates, and posts with `.convertToSnakeCase`. Two consequences the
server honours:

1. **All keys are snake_case** (`access_token`, `display_name`, `notified_contacts`…).
2. **Dates carry no fractional seconds** — `2026-06-30T12:00:00Z`, not
   `…:00.000Z`. The default `.iso8601` strategy rejects milliseconds, so
   [`src/util/time.js`](src/util/time.js) strips them. The only date the client
   currently decodes from the server is `user.created_at`.

Auth routes are mounted at **both** `/v1/auth/*` (what the app calls) and
`/auth/*` (the simplified alias from the Phase 4 brief). Where the brief and the
app diverge (e.g. push-token endpoint name, SOS response keys), the server
accepts/returns a **superset** so both work.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|:----:|---------|
| `GET` | `/health` | — | Liveness → `{ "status": "ok" }`. |
| `POST` | `/v1/auth/register` · `/auth/register` | — | Create account → `AuthResponse`. |
| `POST` | `/v1/auth/login` · `/auth/login` | — | Sign in → `AuthResponse`. |
| `POST` | `/v1/auth/apple` | — | Sign in with Apple → `AuthResponse`. |
| `POST` | `/v1/auth/refresh` · `/auth/refresh` | token | New token pair (body `{ refresh_token }` or bearer header). |
| `GET` | `/v1/contacts` | ✓ | `{ contacts: [...] }`. |
| `POST` | `/v1/contacts` | ✓ | Bulk `{ contacts: [...] }` → `{ success }`, or single contact → `Contact`. |
| `PUT` | `/v1/contacts/:id` | ✓ | Update a contact. |
| `DELETE` | `/v1/contacts/:id` | ✓ | Remove a contact (`204`). |
| `POST` | `/v1/contacts/:id/test-alert` | ✓ | Send a non-emergency test SMS. |
| `POST` | `/v1/sos` | ✓ | Dispatch SOS, fan out SMS/push → `{ alert_id, status, notified_contacts }`. |
| `POST` | `/v1/sos/:id/location` | ✓ | Live location update. |
| `POST` | `/v1/sos/:id/cancel` | ✓ | Cancel (false alarm). |
| `POST` | `/v1/devices` | ✓ | Register a paired jewelry device. |
| `DELETE` | `/v1/devices/:id` | ✓ | Unpair. |
| `POST` | `/v1/devices/push-token` · `/v1/devices/token` | ✓ | Upload APNs token. |
| `GET` | `/v1/devices/:id/firmware` | ✓ | OTA firmware metadata. |
| `POST` | `/v1/subscription/validate` | ✓ | Validate receipt → tier. |
| `GET` | `/v1/subscription/status` | ✓ | Current tier. |
| `POST` | `/v1/analytics/events` | ✓ | Batched analytics ingest. |

Errors use `{ "message": "human readable" }`. `401` makes the app clear the
session and re-auth; `403` signals a tier-gated feature.

## Quick manual test

```bash
# Register and capture the access token (requires jq)
TOKEN=$(curl -s -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ava@example.com","password":"sup3rsecret","display_name":"Ava"}' \
  | jq -r .access_token)

# Upload contacts
curl -s -X POST http://localhost:3000/v1/contacts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"contacts":[{"name":"Mom","phone":"+15551230001","priority":"primary"}]}'

# Trigger an SOS — watch the server console for the [SMS] / [SOS] logs
curl -s -X POST http://localhost:3000/v1/sos \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"triggered_by":"app","location":{"lat":37.77,"lng":-122.41,"accuracy_m":12,"captured_at":"2026-06-30T12:00:00Z"},"battery_level":87}'
```

## Connecting the iOS app

Point the app at this server via `Config/Secrets.xcconfig`:

```
VL_API_SCHEME = http
VL_API_HOST = localhost:3000
```

Regenerate the project (`xcodegen generate`) and run. A non-empty `VL_API_HOST`
flips `AppConfig.useMockServices` to `false`, so the app uses the live
`URLSessionAPIClient` against this backend. The simulator reaches the host Mac's
`localhost` directly; the Info.plist carries an ATS exception for `localhost` so
cleartext HTTP is allowed in development. See the project root README for the
full toggle.

## Project layout

```
backend/
  src/
    server.js            entry point (loads env, starts HTTP)
    app.js               Express app + route mounting + error handling
    config.js            env-driven config
    store.js             in-memory store + JSON persistence
    auth.js              JWT issue/verify, user serialisation, requireAuth
    util/time.js         non-fractional ISO date formatting
    services/
      sms.js             mock SMS gateway (console)
      push.js            placeholder APNs (console)
    routes/
      auth.js  contacts.js  sos.js  devices.js  subscription.js  analytics.js
  scripts/smoke-test.js  in-process end-to-end contract check
  .env.example
```
