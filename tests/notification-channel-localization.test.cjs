'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const originalLoad = Module._load;
Module._load = function loadNotificationChannelDependency(request, parent, isMain) {
  if (parent?.filename.endsWith('/src/services/notifications.js')) {
    if (request === 'react-native') return { Platform: { OS: 'android' } };
    if (request === 'expo-constants') {
      return { __esModule: true, default: { easConfig: { projectId: 'test-project' } } };
    }
    if (request === './permissions') return { explainPermission: async () => true };
    if (request === '../i18n/core') {
      return {
        translate: (key) => `current:${key}`,
        translateForLocale: (locale, key) => `${locale}:${key}`
      };
    }
    if (request === '../utils/logger') return { logger: { info() {} } };
    if (request === '../utils/runtime-environment') return { isExpoGoRuntime: () => false };
    if (request === './notifications-runtime') {
      return {
        NOTIFICATIONS_UNAVAILABLE: {},
        detectNotificationsUnavailableReason: async () => null,
        createNotificationsRuntime: () => ({
          isAvailable: async () => true,
          getModule: async () => null
        })
      };
    }
    if (request === './safety-api') return { safetyRequest: async () => null };
    if (request === './secure-storage') {
      return {
        secureStorage: {
          getItemAsync: async () => null,
          setItemAsync: async () => {},
          deleteItemAsync: async () => {}
        }
      };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { refreshSafetyNotificationChannel } = require('../src/services/notifications');
Module._load = originalLoad;

test('locale channel refresh is idempotent metadata work with no permission prompt', async () => {
  let permissionReads = 0;
  let permissionPrompts = 0;
  const writes = [];
  const notifications = {
    AndroidImportance: { MAX: 5 },
    async setNotificationChannelAsync(id, options) {
      writes.push({ id, options });
    },
    async getPermissionsAsync() {
      permissionReads += 1;
      return { status: 'undetermined' };
    },
    async requestPermissionsAsync() {
      permissionPrompts += 1;
      return { status: 'denied' };
    }
  };

  assert.equal(await refreshSafetyNotificationChannel('fr', {
    notificationsModule: notifications
  }), true);
  assert.deepEqual(writes, [{
    id: 'safety',
    options: {
      name: 'fr:notifications.channelName',
      importance: 5
    }
  }]);
  assert.equal(permissionReads, 0);
  assert.equal(permissionPrompts, 0);
  assert.equal(await refreshSafetyNotificationChannel('fr', {
    notificationsModule: notifications,
    platformOS: 'ios'
  }), false);
  assert.equal(writes.length, 1);
});

test('channel refresh serializes rapid locale writes and recovers after native failure', async () => {
  const writes = [];
  let releaseFirst;
  const firstPending = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const notifications = {
    AndroidImportance: { MAX: 5 },
    async setNotificationChannelAsync(_id, options) {
      writes.push(options.name);
      if (options.name.startsWith('fr:')) await firstPending;
    }
  };

  const french = refreshSafetyNotificationChannel('fr', {
    notificationsModule: notifications
  });
  const arabic = refreshSafetyNotificationChannel('ar', {
    notificationsModule: notifications
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(writes, ['fr:notifications.channelName']);
  releaseFirst();
  assert.deepEqual(await Promise.all([french, arabic]), [true, true]);
  assert.deepEqual(writes, [
    'fr:notifications.channelName',
    'ar:notifications.channelName'
  ]);

  let attempts = 0;
  const flakyNotifications = {
    AndroidImportance: { MAX: 5 },
    async setNotificationChannelAsync() {
      attempts += 1;
      if (attempts === 1) throw new Error('native channel unavailable');
    }
  };
  await assert.rejects(
    refreshSafetyNotificationChannel('en', {
      notificationsModule: flakyNotifications
    }),
    /native channel unavailable/
  );
  assert.equal(await refreshSafetyNotificationChannel('es', {
    notificationsModule: flakyNotifications
  }), true);
  assert.equal(attempts, 2);
});
