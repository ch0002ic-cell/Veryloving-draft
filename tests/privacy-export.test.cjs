'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  attachRemoteDataToExport,
  loadAccountBoundExportData,
  REMOTE_DATA_EXPORT_STATUS,
  remoteDataExportErrorCode
} = require('../src/services/privacy-export');

test('privacy export never silently omits protected account-bound stores', async () => {
  const complete = await loadAccountBoundExportData('account-a', {
    loadEmergencyContacts: async (accountId) => [{ id: `contact-${accountId}` }],
    loadSavedPlaces: async (accountId) => [{ id: `place-${accountId}` }],
    loadMedicalProfile: async (accountId) => ({ accountId, bloodType: 'O+' })
  });
  assert.deepEqual(complete, {
    emergencyContacts: [{ id: 'contact-account-a' }],
    savedPlaces: [{ id: 'place-account-a' }],
    medicalProfile: { accountId: 'account-a', bloodType: 'O+' }
  });

  await assert.rejects(loadAccountBoundExportData('account-a', {
    loadEmergencyContacts: async () => { throw new Error('Keychain unavailable'); },
    loadSavedPlaces: async () => []
  }), /Keychain unavailable/);

  let loads = 0;
  assert.deepEqual(await loadAccountBoundExportData(null, {
    loadEmergencyContacts: async () => { loads += 1; },
    loadSavedPlaces: async () => { loads += 1; }
  }), { emergencyContacts: [], savedPlaces: [], medicalProfile: null });
  assert.equal(loads, 0);
});

test('privacy export preserves local data when the remote export fails', async () => {
  const localSnapshot = {
    schemaVersion: 1,
    conversations: [{ id: 'local-conversation' }],
    settings: { language: 'en' }
  };
  const exported = await attachRemoteDataToExport(localSnapshot, {
    backendEnabled: true,
    accessToken: 'active-session',
    fetchRemoteData: async () => {
      const error = new Error('private upstream detail');
      error.code = 'SAFETY_TIMEOUT';
      throw error;
    }
  });

  assert.deepEqual(exported.conversations, localSnapshot.conversations);
  assert.deepEqual(exported.settings, localSnapshot.settings);
  assert.equal(exported.remoteData, null);
  assert.equal(exported.remoteDataStatus, REMOTE_DATA_EXPORT_STATUS.unavailable);
  assert.equal(exported.remoteDataErrorCode, 'SAFETY_TIMEOUT');
  assert.equal(JSON.stringify(exported).includes('private upstream detail'), false);
});

test('privacy export records whether remote data was included or not configured', async () => {
  let fetchCalls = 0;
  const included = await attachRemoteDataToExport({ account: { id: 'account-a' } }, {
    backendEnabled: true,
    accessToken: 'active-session',
    fetchRemoteData: async () => {
      fetchCalls += 1;
      return { contacts: [{ id: 'remote-contact' }] };
    }
  });
  assert.equal(included.remoteDataStatus, REMOTE_DATA_EXPORT_STATUS.included);
  assert.equal(included.remoteDataErrorCode, null);
  assert.equal(included.remoteData.contacts[0].id, 'remote-contact');

  const disabled = await attachRemoteDataToExport({ account: null }, {
    backendEnabled: false,
    accessToken: null,
    fetchRemoteData: async () => { fetchCalls += 1; }
  });
  assert.equal(disabled.remoteDataStatus, REMOTE_DATA_EXPORT_STATUS.notConfigured);
  assert.equal(disabled.remoteDataErrorCode, null);
  assert.equal(fetchCalls, 1);
});

test('privacy export reports missing authentication and sanitizes unknown failures', async () => {
  let fetchCalls = 0;
  const offline = await attachRemoteDataToExport({ localStorage: {} }, {
    backendEnabled: true,
    accessToken: null,
    fetchRemoteData: async () => { fetchCalls += 1; }
  });
  assert.equal(offline.remoteDataStatus, REMOTE_DATA_EXPORT_STATUS.unavailable);
  assert.equal(offline.remoteDataErrorCode, 'SAFETY_AUTHENTICATION_REQUIRED');
  assert.equal(fetchCalls, 0);

  assert.equal(remoteDataExportErrorCode(new TypeError('secret network detail')), 'REMOTE_EXPORT_FAILED');
  assert.equal(remoteDataExportErrorCode({ code: 'SAFETY_HTTP_503' }), 'SAFETY_HTTP_503');
});
