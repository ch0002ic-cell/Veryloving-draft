'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const indicatorSource = readFileSync(
  path.resolve(process.cwd(), 'src/components/VoiceActivityIndicator.js'),
  'utf8'
);

test('voice activity pulse avoids the legacy NativeAnimated listener lifecycle', () => {
  assert.match(indicatorSource, /from 'react-native-reanimated'/);
  assert.match(indicatorSource, /useSharedValue\(1\)/);
  assert.match(indicatorSource, /cancelAnimation\(scale\)/);
  assert.doesNotMatch(indicatorSource, /\bAnimated\.(?:Value|loop|timing|sequence)\b/);
  assert.doesNotMatch(indicatorSource, /useNativeDriver/);
});
