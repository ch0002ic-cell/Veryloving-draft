'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionGateway, redactSerial, signEnvelope, validateAction } = require('./action-gateway.cjs');

const secret = 'a-secure-test-secret-with-more-than-32-characters';

test('action validation enforces device/action compatibility', () => {
  assert.throws(() => validateAction({ action: 'check_medication', device_type: 'wearable', device_id: 'w1' }), /not allowed/);
  assert.equal(validateAction({ action: 'check_medication', device_type: 'home_robot', device_id: 'r1' }).device_id, 'r1');
});

test('signed action envelopes are deterministic with a fixed clock except identity', () => {
  const signed = signEnvelope({ action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1', parameters: {} }, secret, () => 42);
  assert.equal(signed.envelope.issued_at, 42);
  assert.equal(signed.algorithm, 'HS256');
  assert.ok(signed.signature.length > 20);
});

test('wearable actions use the active authenticated voice channel', async () => {
  const sent = [];
  const gateway = new ActionGateway({ signingSecret: secret });
  gateway.registerSession('user-1', { readyState: 1, send: (message) => sent.push(JSON.parse(message)) }, [
    { device_id: 'w1', device_type: 'wearable', online: true }
  ]);
  const result = await gateway.route('user-1', { action: 'deploy_barrier', device_type: 'wearable', device_id: 'w1' });
  assert.equal(result.status, 'delivered');
  assert.equal(sent[0].type, 'device_action');
});

test('robot actions return asynchronous acceptance and retry manufacturer delivery', async () => {
  let attempts = 0;
  const gateway = new ActionGateway({
    signingSecret: secret, manufacturerWebhookURL: 'https://manufacturer.example.test/hooks', manufacturerApiKey: 'key', retryDelayMs: 1,
    sleep: async () => {},
    fetchImpl: async () => { attempts += 1; if (attempts === 1) throw new Error('offline'); return { ok: true, status: 202 }; }
  });
  gateway.registerSession('user-1', null, [{ device_id: 'r1', device_type: 'home_robot', online: true }]);
  const result = await gateway.route('user-1', { action: 'check_medication', device_type: 'home_robot', device_id: 'r1' });
  assert.equal(result.status, 'accepted');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(attempts, 2);
});

test('hardware serial redaction never contains the serial', () => {
  assert.doesNotMatch(redactSerial('SERIAL-PRIVATE-123'), /SERIAL-PRIVATE-123/);
});
