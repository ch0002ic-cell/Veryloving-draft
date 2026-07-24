'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { performSettingsSignOut } = require('../src/services/settings-sign-out');

test('settings never sweeps or publishes logout when durable session invalidation fails', async () => {
  let swept = false;
  await assert.rejects(
    performSettingsSignOut({
      establishSessionBarrier: async () => {
        const error = new Error('both persistence barriers failed');
        error.code = 'SESSION_INVALIDATION_FAILED';
        throw error;
      },
      sweepLocalData: async () => {
        swept = true;
      }
    }),
    { code: 'SESSION_INVALIDATION_FAILED' }
  );
  assert.equal(swept, false);
});

test('settings treats post-sign-out account cleanup as a non-fatal warning', async () => {
  let barrierEstablished = false;
  const result = await performSettingsSignOut({
    establishSessionBarrier: async () => {
      barrierEstablished = true;
    },
    sweepLocalData: async () => {
      assert.equal(barrierEstablished, true);
      throw new Error('storage cleanup failed');
    }
  });
  assert.deepEqual(result, {
    cleanupFailed: true,
    cleanupResult: null
  });
});
