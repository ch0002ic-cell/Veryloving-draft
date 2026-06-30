# Veryloving Backend API Contract

The contract the iOS app expects. All payloads are JSON with **snake_case** keys
and **ISO-8601** dates (the client uses `convertFromSnakeCase` + `.iso8601`).
All traffic is HTTPS (TLS 1.3). Authenticated requests send
`Authorization: Bearer <access_token>`.

Base URL is configured via `VL_API_BASE_URL` (see README). Paths below are
relative to it. Versioned under `/v1`.

Conventions:
- Success: `2xx`. Errors return `{ "message": "human readable" }` (the client
  surfaces `message`) with an appropriate status.
- `401` → client clears the session and forces re-auth. `403` → feature gated by tier.

---

## Auth

### `POST /v1/auth/register`
```jsonc
// request
{ "email": "ava@x.com", "password": "•••••••", "display_name": "Ava" }
```
### `POST /v1/auth/login`
```jsonc
{ "email": "ava@x.com", "password": "•••••••" }
```
### `POST /v1/auth/apple`
```jsonc
// identity_token is the JWT from ASAuthorizationAppleIDCredential
{ "identity_token": "eyJ…", "full_name": "Ava Stone" }
```
### `POST /v1/auth/refresh`
```jsonc
{ "refresh_token": "•••" }
```

**All four return `AuthResponse`:**
```jsonc
{
  "user": {
    "id": "usr_123",
    "email": "ava@x.com",
    "display_name": "Ava",
    "subscription_tier": "free",        // free | plus | pro
    "created_at": "2026-06-30T12:00:00Z"
  },
  "access_token": "•••",
  "refresh_token": "•••",
  "expires_in": 3600                     // seconds until access_token expiry
}
```

---

## Emergency Contacts (Phase 2)

| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/v1/contacts` | → `[Contact]` |
| `POST` | `/v1/contacts` | `{ name, phone, email?, priority }` → `Contact` |
| `PUT` | `/v1/contacts/{id}` | full `Contact` |
| `DELETE` | `/v1/contacts/{id}` | `204` |
| `POST` | `/v1/contacts/{id}/test-alert` | sends a non-emergency test SMS/push |

```jsonc
// Contact
{ "id": "ct_1", "name": "Mom", "phone": "+15551234567",
  "email": "mom@x.com", "priority": "primary" }   // primary | secondary | tertiary
```

---

## SOS (Phase 2)

The app captures a GPS fix (CoreLocation, last-known fallback) and posts it; the
**backend** fans out SMS + push to contacts (e.g. via Twilio) and returns an alert id.

### `POST /v1/sos`
```jsonc
{
  "triggered_by": "app",                 // app | wearable
  "location": { "lat": 37.77, "lng": -122.41, "accuracy_m": 12, "captured_at": "…" },
  "battery_level": 87                    // optional, from jewelry
}
// → { "alert_id": "sos_9", "status": "dispatched", "notified_contacts": 3 }
```
### `POST /v1/sos/{alert_id}/location`  — live updates during the 30-min window
```jsonc
{ "lat": 37.77, "lng": -122.41, "accuracy_m": 8, "captured_at": "…" }
```
### `POST /v1/sos/{alert_id}/cancel`  — false alarm → `{ "status": "cancelled" }`

---

## Devices (Phase 1–2)

| Method | Path | Body / Notes |
|--------|------|--------------|
| `POST` | `/v1/devices` | register a paired device `{ ble_identifier, name, firmware_version? }` |
| `DELETE` | `/v1/devices/{id}` | unpair |
| `POST` | `/v1/devices/push-token` | `{ apns_token, environment }` — routes SOS pushes |
| `GET` | `/v1/devices/{id}/firmware` | `{ latest_version, url, notes }` for OTA |

---

## Subscription (Phase 4)

### `POST /v1/subscription/validate`
```jsonc
// Server-side receipt / RevenueCat validation; returns the authoritative tier.
{ "platform": "ios", "receipt": "•••" }
// → { "subscription_tier": "plus", "expires_at": "…", "in_trial": true }
```

Tier → feature matrix is mirrored client-side in `Models/User.swift` (`Feature`):
Free = SOS only · Plus = + AI Companion · Pro = + Satellite SOS + Family Monitoring.

---

## Analytics (Phase 5)
`POST /v1/analytics/events` — `{ "events": [ { name, properties, ts } ] }`, batched.

---

## Real-time AI Companion (Phase 3)

WebSocket. Two options:
1. **Direct to Hume** `wss://api.hume.ai/v0/evi/chat?api_key=…&config_id=…`
   (as in the prototype) — key injected from the Keychain, never bundled.
2. **Proxied** `wss://<backend>/v1/companion/chat` so the Hume key stays
   server-side and conversations can be persisted/synced. **Recommended for production.**

Message framing matches the prototype's `EVIMessage` types (`audio_input`,
`audio_output`, `user_message`, `assistant_message`, `error`, …).

---

## Push (APNs)

Backend holds the APNs auth key (`.p8`) and sends:
- **SOS alert** — high priority, custom sound, to contacts who have the app.
- **Battery low**, **safety check-in**, **companion prompt** — normal priority.

Payload includes a `type` and a deep-link target the app routes on tap
(`AppDelegate.userNotificationCenter(_:didReceive:)`).
