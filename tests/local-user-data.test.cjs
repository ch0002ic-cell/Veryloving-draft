'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { deleteLocalUserStores } = require('../src/services/local-user-data');
const { storage } = require('../src/services/storage');

test('logout purges all VeryLoving stores after draining voice mutation queues', async () => {
  const memory = new Map([
    ['veryloving.settings', { language: 'en' }],
    ['veryloving.emergencyContacts', [{ id: 'private-contact' }]],
    ['veryloving.conversationHistory', [{ id: 'private-call' }]],
    ['veryloving.offlineMessageQueue', [{ id: 'private-message' }]],
    ['unrelated.host.preference', true]
  ]);
  storage.getJSON = async (key, fallback) => memory.has(key) ? structuredClone(memory.get(key)) : fallback;
  storage.setJSON = async (key, value) => memory.set(key, structuredClone(value));
  storage.keys = async () => [...memory.keys()];
  storage.removeMany = async (keys) => keys.forEach((key) => memory.delete(key));
  let artifactPurges = 0;

  await deleteLocalUserStores({ purgeArtifacts: () => { artifactPurges += 1; } });

  assert.deepEqual([...memory.entries()], [['unrelated.host.preference', true]]);
  assert.equal(artifactPurges, 1);
});
