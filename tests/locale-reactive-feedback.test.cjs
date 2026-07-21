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

test('onboarding, permission, and device failures remain reactive to locale changes', () => {
  const onboardingNavigation = screenSource('src/hooks/useOnboardingNavigation.js');
  assert.match(onboardingNavigation, /setNavigationErrorKey\('settings\.updateFailedMessage'\)/);
  assert.match(onboardingNavigation, /navigationError: navigationErrorKey \? t\(navigationErrorKey\) : null/);
  assert.doesNotMatch(onboardingNavigation, /setNavigationError(?:Key)?\(t\(/);

  const locationPermission = screenSource('app/(auth)/location-permission.js');
  assert.match(locationPermission, /setErrorKey\('map\.permissionOff'\)|\? 'map\.permissionOff'/);
  assert.match(locationPermission, /message=\{errorKey \? t\(errorKey\) : null\}/);
  assert.doesNotMatch(locationPermission, /setError(?:Key)?\(t\(/);

  const reminder = screenSource('app/(auth)/capybear-reminder.js');
  assert.match(reminder, /setScheduleErrorKey\('permissions\.notificationsRationaleMessage'\)/);
  assert.match(reminder, /scheduleErrorKey \? t\(scheduleErrorKey\) : navigationError/);
  assert.doesNotMatch(reminder, /setScheduleError(?:Key)?\(t\(/);

  const jewelry = screenSource('app/(auth)/jewelry-setup.js');
  assert.match(jewelry, /translationKey: 'settings\.updateFailedMessage'/);
  assert.match(jewelry, /message=\{error\?\.translationKey \? t\(error\.translationKey\) : error\}/);
  assert.doesNotMatch(jewelry, /setError\(t\(/);

  const deviceManagement = screenSource('app/device-management.js');
  assert.match(deviceManagement, /setErrorKey\('settings\.updateFailedMessage'\)/);
  assert.match(deviceManagement, /message=\{errorKey[\s\S]*?\? t\(errorKey\)[\s\S]*?deviceHydrationErrorCode[\s\S]*?connectionErrorKey \? t\(connectionErrorKey\) : null\}/);
  assert.match(deviceManagement, /onPress=\{retryDeviceHydration\}/);
  assert.doesNotMatch(deviceManagement, /setError(?:Key)?\(t\(/);
});

test('changing language cannot retrigger onboarding completion persistence', () => {
  const completion = screenSource('app/(auth)/completion.js');
  const finish = completion.slice(
    completion.indexOf('const finish = useCallback'),
    completion.indexOf('\n\n  useEffect', completion.indexOf('const finish = useCallback'))
  );

  assert.match(finish, /setErrorKey\('settings\.updateFailedMessage'\)/);
  assert.match(finish, /\}, \[completeOnboarding\]\);/);
  assert.doesNotMatch(finish, /\bt\(/);
  assert.match(completion, /message=\{t\(errorKey\)\}/);
});
