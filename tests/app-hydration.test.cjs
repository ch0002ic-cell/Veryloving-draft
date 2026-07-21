'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  accountSettingsAreHydrated,
  pairedDeviceNeedsHydration
} = require('../src/utils/app-hydration');

test('account-bound hydration waits for settings owned by the newly published account', () => {
  assert.equal(accountSettingsAreHydrated({
    accountId: null,
    authLoading: false,
    localStateHydrated: true,
    settingsAccountId: null
  }), true);

  // Demo publication can occur before the settings effect has invalidated the
  // previous signed-out snapshot. That stale snapshot must not start device
  // hydration for the new account.
  assert.equal(accountSettingsAreHydrated({
    accountId: 'demo:local',
    authLoading: false,
    localStateHydrated: true,
    settingsAccountId: null
  }), false);

  assert.equal(accountSettingsAreHydrated({
    accountId: 'demo:local',
    authLoading: false,
    localStateHydrated: true,
    settingsAccountId: 'demo:local'
  }), true);
});

test('paired-device hydration recovers when a cancelled restore left only its request marker', () => {
  assert.equal(pairedDeviceNeedsHydration({
    accountId: 'demo:local',
    hydratedAccountId: undefined,
    requestedAccountId: 'demo:local'
  }), true);

  assert.equal(pairedDeviceNeedsHydration({
    accountId: 'demo:local',
    hydratedAccountId: 'demo:local',
    requestedAccountId: 'demo:local'
  }), false);
});
