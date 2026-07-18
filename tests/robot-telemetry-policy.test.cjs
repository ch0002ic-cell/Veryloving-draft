'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeDeviceEntity, persistDeviceEntities } = require('../src/services/device-entity-store');
const {
  retainableRobotLocation,
  ROBOT_TELEMETRY_LOCAL_RETENTION_MS
} = require('../src/services/robot-telemetry-policy');

test('robot telemetry policy retains only a fresh last-known location', () => {
  const now = 2_000_000_000_000;
  assert.deepEqual(retainableRobotLocation({
    longitude: 103.8,
    latitude: 1.3,
    capturedAt: now - 1000
  }, { now: () => now }), {
    longitude: 103.8,
    latitude: 1.3,
    capturedAt: now - 1000
  });
  assert.equal(retainableRobotLocation({
    longitude: 103.8,
    latitude: 1.3,
    capturedAt: now - ROBOT_TELEMETRY_LOCAL_RETENTION_MS - 1
  }, { now: () => now }), null);
  assert.equal(retainableRobotLocation({ longitude: 103.8, latitude: 1.3 }, { now: () => now }), null);
});

test('robot entity persistence strips raw telemetry, paths, and expired location data', async () => {
  const now = 2_000_000_000_000;
  let snapshot;
  const storageImpl = {
    async setJSON(_key, value) { snapshot = value; }
  };
  await persistDeviceEntities('account-a', [{
    deviceId: 'robot-a',
    deviceType: 'home_robot',
    name: 'Kitchen robot',
    location: {
      longitude: 103.8,
      latitude: 1.3,
      capturedAt: now - ROBOT_TELEMETRY_LOCAL_RETENTION_MS - 1
    },
    navigationPath: [[103.8, 1.3], [103.9, 1.4]],
    rawTelemetry: { cameraFrame: 'private' }
  }], { storageImpl, now: () => now });

  assert.equal(snapshot.entities[0].location, null);
  assert.equal('navigationPath' in snapshot.entities[0], false);
  assert.equal('rawTelemetry' in snapshot.entities[0], false);
  assert.doesNotMatch(JSON.stringify(snapshot), /cameraFrame|private/);

  const restored = normalizeDeviceEntity(snapshot.entities[0], 'account-a', { now: () => now });
  assert.equal(restored.location, null);
});
