'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const Module = require('node:module');
const { test } = require('node:test');
const path = require('node:path');

const calls = [];
let pendingAttemptBehavior = () => ({ idempotencyKey: 'persisted-sos-key' });

const originalLoad = Module._load;
Module._load = function loadEmergencyTestDependency(request, parent, isMain) {
  const isEmergencyService = parent?.filename.endsWith('/src/services/emergency.js');
  if (isEmergencyService && request === 'react-native') {
    return {
      Alert: {
        alert(_title, _message, buttons) {
          buttons.find((button) => button.style !== 'cancel')?.onPress?.();
        }
      },
      Linking: {
        async canOpenURL() { return true; },
        async openURL(url) { calls.push({ type: 'dialer', url }); }
      },
      Share: { async share() {} }
    };
  }
  if (isEmergencyService && request === '../utils/config') {
    return { config: { safetyBackendEnabled: true } };
  }
  if (isEmergencyService && request === './sos-state') {
    return {
      async clearPendingSOSAttempt() {},
      loadOrCreatePendingSOSAttempt(options) {
        calls.push({ type: 'pending', options });
        return pendingAttemptBehavior(options);
      },
      async markSOSAttemptAccepted() {},
      async runAndPersistSOS(operation) { return operation(); }
    };
  }
  if (isEmergencyService && request === './safety-api') {
    return {
      async dispatchSOS(options) {
        calls.push({ type: 'backend', options });
        return { id: 'sos-receipt', status: 'accepted' };
      }
    };
  }
  if (isEmergencyService && request === '../utils/session-token') {
    return {
      createAuthenticationNonce: () => 'ephemeral-sos-key',
      sessionTokenClaims: () => ({ sub: 'account-a' })
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { triggerSOS } = require('../src/services/emergency');
Module._load = originalLoad;

test.beforeEach(() => {
  calls.length = 0;
  pendingAttemptBehavior = () => ({ idempotencyKey: 'persisted-sos-key' });
});

test('a locally pending emergency contact still opens the dialer without connected delivery', async () => {
  const result = await triggerSOS([
    { id: 'local-contact', name: 'Grace', phone: '+6591234567', syncStatus: 'pending' }
  ], { accessToken: 'first-party-session', accountId: 'account-a' });

  assert.equal(result.status, 'dialer_opened');
  assert.equal(result.backendStatus, 'disabled');
  assert.deepEqual(calls, [{ type: 'dialer', url: 'tel:+6591234567' }]);
});

test('connected SOS filters local contact IDs and cannot let synchronous bookkeeping block the dialer', async () => {
  pendingAttemptBehavior = () => { throw new Error('storage unavailable'); };
  const remoteContactId = 'contact_abcdefghijklmnopqrstuvwx';
  const result = await triggerSOS([
    { id: 'local-contact', name: 'Local', phone: '+6591234567', syncStatus: 'pending' },
    { id: remoteContactId, name: 'Synced', phone: '+6598765432' }
  ], { accessToken: 'first-party-session', accountId: 'account-a' });

  assert.equal(result.status, 'dialer_opened');
  assert.equal(result.backendStatus, 'accepted');
  assert.equal(calls[0].type, 'pending');
  assert.equal(calls.some((call) => call.type === 'dialer'), true);
  const backend = calls.find((call) => call.type === 'backend');
  assert.deepEqual(backend.options.contactIds, [remoteContactId]);
  assert.equal(backend.options.idempotencyKey, 'ephemeral-sos-key');
});

test('SOS feedback remains reactive when the language changes while the screen is open', () => {
  const screen = readFileSync(path.resolve(process.cwd(), 'app/emergency-sos.js'), 'utf8');
  assert.match(screen, /setFeedbackKey\('emergency\.addContact'\)/);
  assert.match(screen, /setFeedbackKey\('settings\.updateFailedMessage'\)/);
  assert.match(screen, /message=\{feedbackKey \? t\(feedbackKey\) : null\}/);
  assert.doesNotMatch(screen, /setFeedback(?:Key)?\(t\(/);
  assert.match(screen, /!callableContact[\s\S]*router\.push\('\/emergency-contacts'\)/);
});
