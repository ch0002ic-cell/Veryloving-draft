'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

function screenSource(relativePath) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

test('visible app-owned feedback is translated from stable keys during render', () => {
  const history = screenSource('app/conversation-history.js');
  assert.match(history, /setErrorKey\('history\.loadFailed'\)/);
  assert.match(history, /message=\{errorKey \? t\(errorKey\) : null\}/);
  assert.doesNotMatch(history, /setError(?:Key)?\(t\(/);

  const contacts = screenSource('app/emergency-contacts.js');
  assert.match(contacts, /messageKey: 'contacts\.saveFailedMessage'/);
  assert.match(contacts, /message=\{feedback\?\.messageKey \? t\(feedback\.messageKey\) : null\}/);
  assert.doesNotMatch(contacts, /setFeedback\(\{ message: t\(/);

  const map = screenSource('app/(tabs)/map.js');
  assert.match(map, /translationKey: 'releaseCritical\.locationShareFailed'/);
  assert.match(map, /message=\{localizedFeedbackMessage\(shareError \|\| error\)\}/);
  assert.match(map, /capturedAt: new Date\(feedback\.capturedAt\)\.toLocaleString\(locale\)/);
  assert.doesNotMatch(map, /set(?:Error|ShareError|SavedPlaceFeedback)\([^\n]*t\(/);

  const notifications = screenSource('app/(auth)/notification-permission.js');
  assert.match(notifications, /setErrorKey\('permissions\.notificationsRationaleMessage'\)/);
  assert.match(notifications, /message=\{errorKey \? t\(errorKey\) : null\}/);
  assert.doesNotMatch(notifications, /setError(?:Key)?\(t\(/);

  const quickShare = screenSource('app/quick-share-location.js');
  assert.match(quickShare, /setErrorKey\('releaseCritical\.locationShareFailed'\)/);
  assert.match(quickShare, /message=\{t\(errorKey\)\}/);
  assert.doesNotMatch(quickShare, /setError(?:Key)?\(t\(/);
});
