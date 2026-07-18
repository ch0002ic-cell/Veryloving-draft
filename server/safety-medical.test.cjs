'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validateMedicalAttachment } = require('./safety-api.cjs');

test('server accepts fresh bounded medical attachments and rejects stale or oversized input', () => {
  const originalNow = Date.now;
  Date.now = () => 1_000_000;
  try {
    const valid = validateMedicalAttachment({
      schemaVersion: 1,
      profileVersion: 2,
      consentRecordedAt: 999_000,
      generatedAt: 1_000_000,
      bloodType: 'O+',
      conditions: ['Asthma'],
      allergies: [],
      medications: [{ name: 'Inhaler', dose: null, instructions: null }],
      emergencyNotes: null
    });
    assert.equal(valid.profileVersion, 2);
    assert.equal(valid.medications[0].name, 'Inhaler');
    assert.throws(() => validateMedicalAttachment({ ...valid, generatedAt: 1 }), /stale or invalid/);
    assert.throws(() => validateMedicalAttachment({ ...valid, emergencyNotes: 'x'.repeat(501) }), /invalid/);
  } finally {
    Date.now = originalNow;
  }
});
