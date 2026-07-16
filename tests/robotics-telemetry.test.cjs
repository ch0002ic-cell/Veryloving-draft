'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  createRobotFeatureCollection,
  decodeRoboticsTelemetry,
  normalizeRobotEntity,
  removeRobotEntity,
  selectMapCameraCoordinates,
  upsertRobotEntity
} = require('../src/services/robotics-telemetry');

function telemetry(overrides = {}) {
  return {
    latitude: 1.3521,
    longitude: 103.8198,
    battery: 87.5,
    heading: 42,
    speed: 0.8,
    ...overrides
  };
}

test('robot telemetry is decoded and normalized without retaining untrusted fields', () => {
  const encoded = Buffer.from(JSON.stringify({ ...telemetry(), secret: 'discard-me' })).toString('base64');
  const entity = normalizeRobotEntity('robot-1', decodeRoboticsTelemetry(encoded), 1700000000000);
  assert.deepEqual(entity, {
    id: 'robot-1',
    ...telemetry(),
    receivedAt: 1700000000000
  });
  assert.equal(Object.hasOwn(entity, 'secret'), false);
});

test('robot telemetry rejects malformed identifiers and out-of-range measurements', () => {
  assert.equal(normalizeRobotEntity('robot 1', telemetry(), 1), null);
  assert.equal(normalizeRobotEntity('robot-1', telemetry({ latitude: 91 }), 1), null);
  assert.equal(normalizeRobotEntity('robot-1', telemetry({ longitude: -181 }), 1), null);
  assert.equal(normalizeRobotEntity('robot-1', telemetry({ battery: 101 }), 1), null);
  assert.equal(normalizeRobotEntity('robot-1', telemetry({ heading: 360 }), 1), null);
  assert.equal(normalizeRobotEntity('robot-1', telemetry({ speed: -1 }), 1), null);
  assert.throws(() => decodeRoboticsTelemetry('not base64'), /invalid/i);
});

test('robot entity updates are newest-first, stale-safe, removable, and capped at three', () => {
  let entities = [];
  for (let index = 1; index <= 4; index += 1) {
    const entity = normalizeRobotEntity(`robot-${index}`, telemetry({ heading: index }), index);
    entities = upsertRobotEntity(entities, entity);
  }
  assert.deepEqual(entities.map(({ id }) => id), ['robot-4', 'robot-3', 'robot-2']);

  const stale = normalizeRobotEntity('robot-4', telemetry({ heading: 99 }), 0);
  assert.strictEqual(upsertRobotEntity(entities, stale), entities);

  entities = removeRobotEntity(entities, 'robot-3');
  assert.deepEqual(entities.map(({ id }) => id), ['robot-4', 'robot-2']);
  assert.strictEqual(removeRobotEntity(entities, 'missing'), entities);
});

test('map GeoJSON uses longitude-first coordinates and centers the simulator over Singapore', () => {
  const singaporeRobot = normalizeRobotEntity('robot-1', telemetry(), 10);
  const collection = createRobotFeatureCollection([singaporeRobot]);
  assert.deepEqual(collection, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'robot-1',
      geometry: { type: 'Point', coordinates: [103.8198, 1.3521] },
      properties: {
        id: 'robot-1',
        label: 'robot-1',
        battery: 88,
        heading: 42,
        receivedAt: 10
      }
    }]
  });
  assert.deepEqual(
    selectMapCameraCoordinates([-79.3832, 43.6532], [singaporeRobot], [0, 0]),
    [103.8198, 1.3521]
  );
  assert.deepEqual(selectMapCameraCoordinates([-79.3832, 43.6532], [], [0, 0]), [-79.3832, 43.6532]);
});

test('orchestrator owns a lifecycle-clean mock telemetry subscription and the map uses a ShapeSource', () => {
  const orchestrator = readFileSync(path.resolve('src/hooks/useRoboticsOrchestrator.js'), 'utf8');
  const map = readFileSync(path.resolve('app/(tabs)/map.js'), 'utf8');
  assert.match(orchestrator, /subscribeToNotifications\([\s\S]*ROBOTICS_TELEMETRY_CHARACTERISTIC_UUID/);
  assert.match(orchestrator, /return \(\) => \{[\s\S]*active = false;[\s\S]*unsubscribe\?\.\(\);/);
  assert.match(map, /<Mapbox\.ShapeSource id="robot-entities" shape=\{robotFeatureCollection\}>/);
  assert.match(map, /<Mapbox\.CircleLayer/);
  assert.match(map, /<Mapbox\.SymbolLayer/);
});
