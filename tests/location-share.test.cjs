'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  buildLocationShareContent,
  LocationShareUnavailableError,
  shareLocationSnapshot
} = require('../src/services/location-share');
const { formatLocalizedDateTime } = require('../src/utils/localized-format');

test('quick share creates an honest, static current-location payload', () => {
  const timestamp = Date.parse('2026-07-13T04:00:00.000Z');
  const content = buildLocationShareContent({
    timestamp,
    coords: { latitude: 1.3521, longitude: 103.8198 }
  });

  assert.match(content.message, new RegExp(
    `location recorded at ${formatLocalizedDateTime(timestamp, 'en').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
  ));
  assert.doesNotMatch(content.message, /T04:00:00\.000Z/);
  assert.match(content.message, /query=1\.3521,103\.8198/);
  assert.match(content.message, /one-time location snapshot/i);
  assert.match(content.message, /does not update after sending/i);
  assert.doesNotMatch(content.message, /live|revoc|tracking/i);
});

test('quick share localizes safety copy while retaining exact coordinates and freshness', () => {
  const timestamp = Date.parse('2026-07-12T23:00:00.000Z');
  const content = buildLocationShareContent({
    isCached: true,
    cachedAt: timestamp,
    coords: { latitude: 40.4168, longitude: -3.7038 }
  }, { locale: 'es' });

  assert.match(content.title, /Envío rápido/);
  assert.match(content.message, /última ubicación guardada/i);
  assert.ok(content.message.includes(formatLocalizedDateTime(timestamp, 'es')));
  assert.doesNotMatch(content.message, /T23:00:00\.000Z/);
  assert.match(content.message, /query=40\.4168,-3\.7038/);
  assert.match(content.message, /No se actualizará/);
});

test('quick share labels cached coordinates as the last saved location', () => {
  const timestamp = Date.parse('2026-07-12T23:00:00.000Z');
  const content = buildLocationShareContent({
    isCached: true,
    cachedAt: timestamp,
    coords: { latitude: -33.8688, longitude: 151.2093 }
  });

  assert.match(content.message, /last saved location/i);
  assert.ok(content.message.includes(formatLocalizedDateTime(timestamp, 'en')));
  assert.doesNotMatch(content.message, /T23:00:00\.000Z/);
});

test('quick share rejects invalid coordinates before opening the native sheet', async () => {
  let shareCalls = 0;
  await assert.rejects(
    shareLocationSnapshot(
      { coords: { latitude: 91, longitude: 0 } },
      { share: async () => { shareCalls += 1; } }
    ),
    (error) => error instanceof LocationShareUnavailableError && error.code === 'LOCATION_MISSING'
  );
  assert.equal(shareCalls, 0);
});

test('quick share forwards the static payload and normalizes native failures', async () => {
  const shared = [];
  const location = { coords: { latitude: 43.6532, longitude: -79.3832 } };
  await shareLocationSnapshot(location, { share: async (content) => shared.push(content) });
  assert.equal(shared.length, 1);
  assert.match(shared[0].message, /query=43\.6532,-79\.3832/);

  await assert.rejects(
    shareLocationSnapshot(location, { share: async () => { throw new Error('native detail'); } }),
    (error) => error instanceof LocationShareUnavailableError
      && error.code === 'LOCATION_SHARE_FAILED'
      && !error.message.includes('native detail')
  );
});

test('the safety map exposes Quick Share and passes a resolved location to it', () => {
  const mapScreen = readFileSync(path.resolve(process.cwd(), 'app/(tabs)/map.js'), 'utf8');
  assert.match(mapScreen, /title=\{t\('quickShare\.title'\)\}/);
  assert.match(mapScreen, /const shareLocation = location \|\| await requestCurrentLocation\(\)/);
  assert.match(mapScreen, /watchLiveLocation\(\(nextLocation\)/);
  assert.match(mapScreen, /if \(loading \|\| !liveLocationAllowed \|\| !appIsActive\) return undefined/);
  assert.match(mapScreen, /useFocusEffect\(useCallback/);
  assert.match(mapScreen, /AppState\.addEventListener\('change'/);
  assert.match(mapScreen, /liveSubscription\?\.remove\?\.\(\)/);
  assert.match(mapScreen, /setError\(\{ translationKey: locationErrorTranslationKey\(liveError\) \}\)/);
  assert.match(mapScreen, /await shareQuickLocation\(shareLocation, \{ locale \}\)/);
  assert.match(mapScreen, /shareInProgressRef\.current/);
});
