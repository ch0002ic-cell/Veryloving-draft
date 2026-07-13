'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { runSOSFlow } = require('../src/services/sos-flow');

test('SOS never reports activation when no callable contact exists', async () => {
  let calls = 0;
  const result = await runSOSFlow({
    contacts: [],
    confirmCall: async () => true,
    openDialer: async () => { calls += 1; }
  });
  assert.equal(result.status, 'contact_required');
  assert.equal(calls, 0);
});

test('SOS cancellation performs no dialer action', async () => {
  let calls = 0;
  const result = await runSOSFlow({
    contacts: [{ id: 'guardian', name: 'Guardian', phone: '+6591234567' }],
    confirmCall: async () => false,
    openDialer: async () => { calls += 1; }
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(calls, 0);
});

test('SOS reports only that the selected contact dialer opened', async () => {
  const actions = [];
  const result = await runSOSFlow({
    contacts: [{ id: 'guardian', name: 'Guardian', phone: '+6591234567' }],
    confirmCall: async () => true,
    openDialer: async (phone) => actions.push(`dialer:${phone}`)
  });
  assert.equal(result.status, 'dialer_opened');
  assert.equal(result.backendStatus, 'disabled');
  assert.deepEqual(actions, ['dialer:+6591234567']);
});

test('SOS opens the local dialer without waiting for backend acceptance', async () => {
  const actions = [];
  let resolveBackend;
  const result = await runSOSFlow({
    contacts: [{ id: 'contact-1', phone: '+6591234567' }],
    confirmCall: async () => true,
    dispatchSOS: async () => new Promise((resolve) => {
      actions.push('backend');
      resolveBackend = () => resolve({ id: 'sos-1', status: 'accepted' });
      setTimeout(resolveBackend, 0);
    }),
    openDialer: async () => actions.push('dialer')
  });
  assert.ok(resolveBackend);
  assert.ok(actions.includes('dialer'));
  assert.equal(result.backendStatus, 'accepted');
  assert.equal(result.backendReceipt.status, 'accepted');
});

test('SOS backend failure remains explicit while preserving the dialer fallback', async () => {
  const actions = [];
  const result = await runSOSFlow({
    contacts: [{ id: 'contact-1', phone: '+6591234567' }],
    confirmCall: async () => true,
    dispatchSOS: async () => { throw new Error('backend unavailable'); },
    openDialer: async () => actions.push('dialer')
  });
  assert.deepEqual(actions, ['dialer']);
  assert.equal(result.backendStatus, 'failed');
  assert.match(result.backendError.message, /unavailable/);
});

test('SOS surfaces dialer failures instead of claiming activation', async () => {
  await assert.rejects(runSOSFlow({
    contacts: [{ phone: '+6591234567' }],
    confirmCall: async () => true,
    openDialer: async () => { throw new Error('dialer unavailable'); }
  }), /dialer unavailable/);
});
