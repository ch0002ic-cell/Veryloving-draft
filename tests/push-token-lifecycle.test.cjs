'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const secureValues = new Map();
let receiptDeletionFails = true;
let registrations = 0;
let receiptDeletes = 0;
const receipt = 'A'.repeat(120);
const notifications = {
  async getPermissionsAsync() { return { status: 'granted' }; },
  async getExpoPushTokenAsync() { return { data: 'ExpoPushToken[token_00000001]' }; }
};

const originalLoad = Module._load;
Module._load = function loadPushLifecycleDependency(request, parent, isMain) {
  if (parent?.filename.endsWith('/src/services/notifications.js')) {
    if (request === 'react-native') return { Platform: { OS: 'ios' } };
    if (request === 'expo-constants') {
      return { __esModule: true, default: { easConfig: { projectId: 'test-project' } } };
    }
    if (request === './permissions') return { explainPermission: async () => true };
    if (request === '../i18n/core') return { translate: (key) => key };
    if (request === '../utils/logger') return { logger: { info() {} } };
    if (request === '../utils/runtime-environment') return { isExpoGoRuntime: () => false };
    if (request === './notifications-runtime') {
      return {
        NOTIFICATIONS_UNAVAILABLE: {},
        detectNotificationsUnavailableReason: async () => null,
        createNotificationsRuntime: () => ({
          isAvailable: async () => true,
          getModule: async () => notifications
        })
      };
    }
    if (request === './secure-storage') {
      return {
        secureStorage: {
          getItemAsync: async (key) => secureValues.get(key) ?? null,
          setItemAsync: async (key, value) => secureValues.set(key, value),
          deleteItemAsync: async (key) => secureValues.delete(key)
        }
      };
    }
    if (request === './safety-api') {
      return {
        safetyRequest: async (path) => {
          if (path.endsWith('/receipt')) {
            receiptDeletes += 1;
            if (receiptDeletionFails) throw new Error('offline');
            return null;
          }
          registrations += 1;
          return { unregisterReceipt: receipt };
        }
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  PENDING_PUSH_UNREGISTER_KEY,
  registerDevicePushToken,
  retryPendingPushTokenUnregister
} = require('../src/services/notifications');
Module._load = originalLoad;

test('push receipt survives offline logout and blocks cross-account registration until removal', async () => {
  receiptDeletionFails = false;
  assert.equal(await registerDevicePushToken('first-account-token'), true);
  assert.match(secureValues.get(PENDING_PUSH_UNREGISTER_KEY), /"version":1/);
  assert.equal(registrations, 1);

  receiptDeletionFails = true;
  await assert.rejects(retryPendingPushTokenUnregister(), /offline/);
  await assert.rejects(registerDevicePushToken('second-account-token'), /offline/);
  assert.equal(registrations, 1, 'the physical token must not be bound to two accounts');
  assert.ok(secureValues.has(PENDING_PUSH_UNREGISTER_KEY));

  receiptDeletionFails = false;
  assert.equal(await retryPendingPushTokenUnregister(), true);
  assert.equal(secureValues.has(PENDING_PUSH_UNREGISTER_KEY), false);
  assert.equal(await registerDevicePushToken('second-account-token'), true);
  assert.equal(registrations, 2);
  assert.ok(receiptDeletes >= 3);
});
