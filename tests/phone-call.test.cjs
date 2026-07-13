'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  openPhoneCall,
  phoneCallURL,
  PhoneCallUnavailableError
} = require('../src/services/phone-call');

test('phone call URLs preserve canonical E.164 numbers', () => {
  assert.equal(phoneCallURL('+1 415 555 2671'), 'tel:+1 415 555 2671');
  assert.throws(
    () => phoneCallURL(''),
    (error) => error instanceof PhoneCallUnavailableError && error.code === 'PHONE_NUMBER_MISSING'
  );
});

test('phone calls check device support before awaiting the native launcher', async () => {
  const calls = [];
  const linking = {
    canOpenURL: async (url) => {
      calls.push(['canOpenURL', url]);
      return true;
    },
    openURL: async (url) => {
      calls.push(['openURL', url]);
    }
  };

  assert.equal(await openPhoneCall('+14155552671', linking), 'tel:+14155552671');
  assert.deepEqual(calls, [
    ['canOpenURL', 'tel:+14155552671'],
    ['openURL', 'tel:+14155552671']
  ]);
});

test('unsupported phone calls fail without invoking the native launcher', async () => {
  let opened = false;
  await assert.rejects(
    openPhoneCall('+14155552671', {
      canOpenURL: async () => false,
      openURL: async () => { opened = true; }
    }),
    (error) => error instanceof PhoneCallUnavailableError && error.code === 'PHONE_CALL_UNAVAILABLE'
  );
  assert.equal(opened, false);
});
