'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const {
  configureMapboxModule,
  hasUsableMapboxAccessToken
} = require('../src/utils/mapbox-config');
const {
  MAX_MAP_NAVIGATION_PATH_POINTS,
  normalizeMapNavigationPath
} = require('../src/utils/map-geometry');
const { refreshMapShapeSource } = require('../src/utils/map-source-refresh');

test('Mapbox native rendering requires a non-empty runtime token', () => {
  assert.equal(hasUsableMapboxAccessToken(), false);
  assert.equal(hasUsableMapboxAccessToken(''), false);
  assert.equal(hasUsableMapboxAccessToken('   '), false);
  assert.equal(hasUsableMapboxAccessToken('pk.public-token'), true);
});

test('Mapbox native setup fails closed for missing, throwing, and asynchronous setters', async () => {
  const failures = [];
  const options = { onFailure: (code) => failures.push(code) };
  assert.equal(configureMapboxModule({}, 'pk.public-token', options), null);
  assert.equal(configureMapboxModule({
    setAccessToken() {
      const error = new Error('stale native binary');
      error.code = 'NATIVE_BINARY_STALE';
      throw error;
    }
  }, 'pk.public-token', options), null);
  assert.equal(configureMapboxModule({
    setAccessToken() {
      return Promise.reject(new Error('unexpected async setter'));
    }
  }, 'pk.public-token', options), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(failures, [
    'MAPBOX_NATIVE_MODULE_INVALID',
    'NATIVE_BINARY_STALE',
    'MAPBOX_NATIVE_MODULE_INVALID'
  ]);

  let configuredToken = null;
  const module = {
    setAccessToken(token) {
      configuredToken = token;
    }
  };
  assert.equal(configureMapboxModule(module, '  pk.public-token  ', options), module);
  assert.equal(configuredToken, 'pk.public-token');
});

test('Mapbox navigation paths are bounded and reject malformed native geometry', () => {
  const oversized = Array.from(
    { length: MAX_MAP_NAVIGATION_PATH_POINTS + 20 },
    (_, index) => [103 + (index / 10000), 1.3]
  );
  assert.equal(
    normalizeMapNavigationPath(oversized).length,
    MAX_MAP_NAVIGATION_PATH_POINTS
  );
  assert.deepEqual(normalizeMapNavigationPath([
    [103.8, 1.3],
    [Infinity, 1.31],
    [999, 1.31],
    { longitude: 103.81, latitude: 1.31 },
    ['not-a-number', 1.32]
  ]), []);
  assert.deepEqual(normalizeMapNavigationPath([[103.8, 1.3], [999, 999]]), []);
  assert.deepEqual(normalizeMapNavigationPath([[103.8, 1.3], [null, null]]), []);
  assert.deepEqual(normalizeMapNavigationPath([[103.8, 1.3], ['103.81', '1.31']]), []);

  const revoked = Proxy.revocable([], {});
  revoked.revoke();
  assert.doesNotThrow(() => normalizeMapNavigationPath(revoked.proxy));
  assert.deepEqual(normalizeMapNavigationPath(revoked.proxy), []);
});

test('Mapbox ShapeSource refresh supports both native APIs and awaits failures', async () => {
  const shape = { type: 'FeatureCollection', features: [] };
  const calls = [];
  assert.equal(await refreshMapShapeSource({
    async setData(value) {
      calls.push(['setData', value]);
    },
    setNativeProps() {
      calls.push(['setNativeProps']);
    }
  }, shape), true);
  assert.deepEqual(calls, [['setData', shape]], 'setData is preferred when available');

  assert.equal(await refreshMapShapeSource({
    async setNativeProps(value) {
      calls.push(['setNativeProps', value]);
    }
  }, shape), true);
  assert.deepEqual(calls.at(-1), ['setNativeProps', { shape }]);
  assert.equal(await refreshMapShapeSource({}, shape), false);
  assert.equal(await refreshMapShapeSource(null, shape), false);

  await assert.rejects(
    refreshMapShapeSource({ setData: async () => { throw new Error('native update failed'); } }, shape),
    /native update failed/
  );
  await assert.rejects(
    refreshMapShapeSource({ setNativeProps: () => { throw new Error('sync native failure'); } }, shape),
    /sync native failure/
  );
});

test('Mapbox source failures transition to the localized visible fallback', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'app/(tabs)/map.js'),
    'utf8'
  );
  assert.match(source, /refreshMapShapeSource\(deviceSourceRef\.current, deviceFeatureCollection\)/);
  assert.match(source, /refreshMapShapeSource\(robotPathSourceRef\.current, robotPathFeatureCollection\)/);
  assert.match(source, /operation\.catch\(\(error\) => \{\s*if \(active\) onSourceUpdateError\(error\)/);
  assert.match(source, /onSourceUpdateError=\{handleMapSourceUpdateError\}/);

  const loadHandler = source.slice(
    source.indexOf('const handleMapLoadError'),
    source.indexOf('const handleMapStyleLoaded')
  );
  assert.match(loadHandler, /mountedRef\.current && !mapStyleReadyRef\.current/);

  const sourceHandler = source.slice(
    source.indexOf('const handleMapSourceUpdateError'),
    source.indexOf('const refreshLocation')
  );
  assert.match(sourceHandler, /mapStyleReadyRef\.current = false/);
  assert.match(sourceHandler, /setMapLoadFailed\(true\)/);
  assert.match(sourceHandler, /translationKey: 'releaseCritical\.mapUnavailable'/);
});
