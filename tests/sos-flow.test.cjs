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
  assert.deepEqual(actions, ['dialer:+6591234567']);
});

test('SOS surfaces dialer failures instead of claiming activation', async () => {
  await assert.rejects(runSOSFlow({
    contacts: [{ phone: '+6591234567' }],
    confirmCall: async () => true,
    openDialer: async () => { throw new Error('dialer unavailable'); }
  }), /dialer unavailable/);
});
