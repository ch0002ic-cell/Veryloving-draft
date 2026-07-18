'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPrivacyDataCoordinator } = require('./privacy-data.cjs');

function repository(name, calls) {
  return {
    async exportUserData(userId) {
      calls.push(['export', name, userId]);
      return { owner: userId, records: [`${name}-record`] };
    },
    async deleteUserData(userId) {
      calls.push(['delete', name, userId]);
      return { deleted: 1 };
    }
  };
}

test('privacy coordinator exports every configured account-bound data class', async () => {
  const calls = [];
  const coordinator = createPrivacyDataCoordinator({
    safetyRepository: repository('safety', calls),
    robotRepository: repository('devices', calls),
    actionOutboxRepository: repository('actions', calls),
    pushRepository: repository('push', calls),
    manufacturerPrivacyRepository: repository('manufacturer', calls),
    authSessionRepository: repository('sessions', calls)
  });
  assert.deepEqual(coordinator.missingRepositories(), []);

  const exported = await coordinator.exportUserData('user-a');
  assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(Object.keys(exported.datasets), [
    'manufacturer', 'safety', 'deviceActions', 'pushRegistrations', 'devices', 'sessions'
  ]);
  assert.equal(exported.datasets.sessions.status, 'included');
  assert.equal(calls.filter(([operation]) => operation === 'export').length, 6);
  assert.ok(calls.every(([, , userId]) => userId === 'user-a'));
});

test('privacy coordinator never silently omits an unconfigured repository', async () => {
  const coordinator = createPrivacyDataCoordinator({ safetyRepository: repository('safety', []) });
  assert.deepEqual(coordinator.missingRepositories(), [
    'manufacturerPrivacyRepository',
    'actionOutboxRepository',
    'pushRepository',
    'robotRepository',
    'authSessionRepository'
  ]);
  const exported = await coordinator.exportUserData('user-a');
  assert.equal(exported.datasets.safety.status, 'included');
  assert.equal(exported.datasets.devices.status, 'not-configured');
  assert.equal(exported.datasets.sessions.data, null);
});

test('privacy coordinator stops deletion before credentials after a bounded failure', async () => {
  const deleted = [];
  const coordinator = createPrivacyDataCoordinator({
    safetyRepository: {
      async exportUserData() { return {}; },
      async deleteUserData(userId) { deleted.push(['safety', userId]); }
    },
    robotRepository: {
      async exportUserData() { return {}; },
      async deleteUserData(userId) { deleted.push(['devices', userId]); throw new Error('private Dynamo detail'); }
    },
    authSessionRepository: {
      async exportUserData() { return {}; },
      async deleteUserData(userId) { deleted.push(['sessions', userId]); }
    }
  });

  await assert.rejects(coordinator.deleteUserData('user-a'), (error) => {
    assert.equal(error.code, 'PRIVACY_DELETE_INCOMPLETE');
    assert.deepEqual(error.failures, [{
      dataset: 'devices',
      code: 'PRIVACY_DELETE_DEVICES_FAILED'
    }]);
    assert.doesNotMatch(JSON.stringify(error.failures), /private Dynamo detail/);
    return true;
  });
  assert.deepEqual(deleted, [['safety', 'user-a'], ['devices', 'user-a']]);
});

test('manufacturer erasure failure preserves all VeryLoving data and the retry credential', async () => {
  const deleted = [];
  const lifecycle = [];
  const coordinator = createPrivacyDataCoordinator({
    manufacturerPrivacyRepository: {
      async exportUserData() { return {}; },
      async deleteUserData() { throw new Error('manufacturer offline'); }
    },
    safetyRepository: repository('safety', deleted),
    robotRepository: repository('devices', deleted),
    authSessionRepository: {
      ...repository('sessions', deleted),
      async beginAccountDeletion(userId) { lifecycle.push(['begin', userId]); },
      async completeAccountDeletion(userId) { lifecycle.push(['complete', userId]); }
    }
  });
  await assert.rejects(coordinator.deleteUserData('user-a'), (error) => {
    assert.deepEqual(error.failures, [{
      dataset: 'manufacturer',
      code: 'PRIVACY_DELETE_MANUFACTURER_FAILED'
    }]);
    return true;
  });
  assert.deepEqual(deleted, []);
  assert.deepEqual(lifecycle, [['begin', 'user-a']]);
});

test('privacy deletion fences the account before mutation and marks completion last', async () => {
  const lifecycle = [];
  const coordinator = createPrivacyDataCoordinator({
    authSessionRepository: {
      async exportUserData() { return []; },
      async beginAccountDeletion(userId) { lifecycle.push(['begin', userId]); },
      async deleteUserData(userId) { lifecycle.push(['sessions', userId]); },
      async completeAccountDeletion(userId) { lifecycle.push(['complete', userId]); }
    }
  });
  await coordinator.deleteUserData('user-a');
  assert.deepEqual(lifecycle, [
    ['begin', 'user-a'],
    ['sessions', 'user-a'],
    ['complete', 'user-a']
  ]);
});
