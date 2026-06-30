//
// scripts/smoke-test.js — end-to-end check that the backend speaks exactly what
// the iOS client sends/expects. Boots the app in-process on an ephemeral port
// (PERSIST off) and replays the real client payloads (snake_case, /v1 paths),
// asserting the responses are decode-compatible with the Swift models.
//
//   npm run smoke
//

process.env.PERSIST = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test-secret';

const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

// The client decodes Date with `.iso8601` (no fractional seconds allowed).
const ISO_NO_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      console.error(`  ✗ ${name}\n      ${err.message}`);
      process.exitCode = 1;
      throw err;
    });
}

async function main() {
  const server = createApp().listen(0);
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const req = async (method, path, { token, body } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };

  const email = `ava_${Date.now()}@example.com`;
  let session;

  try {
    await check('GET /health → { status: "ok" }', async () => {
      const { status, json } = await req('GET', '/health');
      assert.equal(status, 200);
      assert.deepEqual(json, { status: 'ok' });
    });

    await check('POST /v1/auth/register → AuthResponse (snake_case, ISO date)', async () => {
      const { status, json } = await req('POST', '/v1/auth/register', {
        body: { email, password: 'sup3rsecret', display_name: 'Ava' },
      });
      assert.equal(status, 201);
      assert.ok(typeof json.access_token === 'string' && json.access_token.length);
      assert.ok(typeof json.refresh_token === 'string' && json.refresh_token.length);
      assert.equal(json.expires_in, 3600);
      assert.equal(json.user.email, email);
      assert.equal(json.user.display_name, 'Ava');
      assert.ok(['free', 'plus', 'pro'].includes(json.user.subscription_tier));
      // CRITICAL: no fractional seconds, or the client's Date decoder rejects it.
      assert.match(json.user.created_at, ISO_NO_MILLIS);
      session = json;
    });

    await check('POST /v1/auth/register (duplicate) → 409', async () => {
      const { status, json } = await req('POST', '/v1/auth/register', {
        body: { email, password: 'sup3rsecret', display_name: 'Ava' },
      });
      assert.equal(status, 409);
      assert.ok(typeof json.message === 'string');
    });

    await check('POST /v1/auth/login → AuthResponse', async () => {
      const { status, json } = await req('POST', '/v1/auth/login', {
        body: { email, password: 'sup3rsecret' },
      });
      assert.equal(status, 200);
      assert.equal(json.user.email, email);
      assert.match(json.user.created_at, ISO_NO_MILLIS);
    });

    await check('POST /v1/auth/login (wrong password) → 401', async () => {
      const { status } = await req('POST', '/v1/auth/login', {
        body: { email, password: 'nope' },
      });
      assert.equal(status, 401);
    });

    await check('POST /v1/auth/refresh { refresh_token } → AuthResponse', async () => {
      const { status, json } = await req('POST', '/v1/auth/refresh', {
        body: { refresh_token: session.refresh_token },
      });
      assert.equal(status, 200);
      assert.ok(json.access_token);
    });

    await check('GET /v1/contacts without token → 401 { message }', async () => {
      const { status, json } = await req('GET', '/v1/contacts');
      assert.equal(status, 401);
      assert.ok(typeof json.message === 'string');
    });

    await check('POST /v1/contacts { contacts: [...] } → { success: true }', async () => {
      const { status, json } = await req('POST', '/v1/contacts', {
        token: session.access_token,
        body: {
          contacts: [
            { name: 'Mom', phone: '+15551230001', email: 'mom@x.com', priority: 'primary' },
            { name: 'Dad', phone: '+15551230002', priority: 1 },
          ],
        },
      });
      assert.equal(status, 200);
      assert.equal(json.success, true);
    });

    await check('GET /v1/contacts → { contacts: [2] }', async () => {
      const { status, json } = await req('GET', '/v1/contacts', { token: session.access_token });
      assert.equal(status, 200);
      assert.equal(json.contacts.length, 2);
      assert.equal(json.contacts[1].priority, 'secondary'); // Int 1 normalised
    });

    let alertId;
    await check('POST /v1/sos (client DispatchBody) → SOSDispatchResult', async () => {
      const { status, json } = await req('POST', '/v1/sos', {
        token: session.access_token,
        body: {
          triggered_by: 'app',
          location: { lat: 37.77, lng: -122.41, accuracy_m: 12, captured_at: '2026-06-30T12:00:00Z' },
          battery_level: 87,
        },
      });
      assert.equal(status, 201);
      assert.ok(typeof json.alert_id === 'string' && json.alert_id.length); // required by client
      assert.equal(typeof json.notified_contacts, 'number'); // required by client
      assert.equal(json.notified_contacts, 2);
      assert.equal(json.status, 'dispatched');
      alertId = json.alert_id;
    });

    await check('POST /v1/sos/:id/location → ok', async () => {
      const { status } = await req('POST', `/v1/sos/${alertId}/location`, {
        token: session.access_token,
        body: { lat: 37.78, lng: -122.42, accuracy_m: 8, captured_at: '2026-06-30T12:01:00Z' },
      });
      assert.equal(status, 200);
    });

    await check('POST /v1/sos/:id/cancel → cancelled', async () => {
      const { status, json } = await req('POST', `/v1/sos/${alertId}/cancel`, {
        token: session.access_token,
      });
      assert.equal(status, 200);
      assert.equal(json.status, 'cancelled');
    });

    await check('POST /v1/contacts/:id/test-alert → { success: true }', async () => {
      const { json: contacts } = await req('GET', '/v1/contacts', { token: session.access_token });
      const id = contacts.contacts[0].id;
      const { status, json } = await req('POST', `/v1/contacts/${id}/test-alert`, {
        token: session.access_token,
      });
      assert.equal(status, 200);
      assert.equal(json.success, true);
    });

    await check('POST /v1/devices/push-token { apns_token, environment } → success', async () => {
      const { status, json } = await req('POST', '/v1/devices/push-token', {
        token: session.access_token,
        body: { apns_token: 'a'.repeat(64), environment: 'sandbox' },
      });
      assert.equal(status, 200);
      assert.equal(json.success, true);
    });

    await check('POST /v1/subscription/validate → subscription_tier', async () => {
      const { status, json } = await req('POST', '/v1/subscription/validate', {
        token: session.access_token,
        body: { platform: 'ios', receipt: 'base64-receipt' },
      });
      assert.equal(status, 200);
      assert.ok(['free', 'plus', 'pro'].includes(json.subscription_tier));
      assert.match(json.expires_at, ISO_NO_MILLIS);
    });

    await check('GET /v1/subscription/status → tier', async () => {
      const { status, json } = await req('GET', '/v1/subscription/status', {
        token: session.access_token,
      });
      assert.equal(status, 200);
      assert.ok(['free', 'plus', 'pro'].includes(json.tier));
    });

    console.log(`\n${passed} checks passed.`);
  } finally {
    server.close();
  }
}

main().catch(() => {
  console.error('\nSmoke test FAILED.');
  process.exit(1);
});
