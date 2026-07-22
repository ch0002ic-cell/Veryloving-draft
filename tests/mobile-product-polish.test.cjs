'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

function source(relativePath) {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

test('home presents both product lines and exposes selected safety-mode semantics', () => {
  const home = source('app/(tabs)/index.js');

  assert.match(home, /wearableEntities, robotEntities/);
  assert.match(home, /deviceType="wearable"/);
  assert.match(home, /deviceType="home_robot"/);
  assert.match(home, /selected=\{settings\.mode === mode\}/);
  assert.match(home, /activeRobot \? \([\s\S]*router\.push\('\/medication-reminders'\)/);
  assert.match(home, /title=\{t\('common\.sos'\)\}[\s\S]*variant="danger"/);
});

test('My Devices renders the canonical entity collection without a legacy primary-device card', () => {
  const management = source('app/device-management.js');

  assert.match(management, /for \(const entity of \[\.\.\.wearableEntities, \.\.\.robotEntities\]\)/);
  assert.match(management, /if \(!unique\.has\(key\)\) unique\.set\(key, entity\)/);
  assert.match(management, /<DeviceStatusCard/);
  assert.doesNotMatch(management, /<Card\b/);
  assert.doesNotMatch(management, /images\.jewelryConnected|images\.jewelryDisconnected/);
  assert.doesNotMatch(management, /entity\.location\.(latitude|longitude)|toFixed\(5\)/);
  assert.match(management, /isRTL && styles\.rtlRow/);
});

test('settings exposes one device-management destination', () => {
  const settings = source('app/settings.js');
  assert.equal([...settings.matchAll(/router\.push\('\/device-management'\)/g)].length, 1);
});

test('robot pairing recovers blocked camera access and retains the duplicate-scan fence', () => {
  const pairing = source('app/robot-pairing.js');

  assert.match(pairing, /permission\?\.canAskAgain === false/);
  assert.match(pairing, /permission\.canAskAgain === false \? t\('common\.settings'\)/);
  assert.match(pairing, /Linking\.openSettings\(\)/);
  assert.match(pairing, /const cameraAccessInFlightRef = useRef\(false\)/);
  assert.match(pairing, /if \(cameraAccessInFlightRef\.current\) return/);
  assert.match(pairing, /cameraAccessInFlightRef\.current = false/);
  assert.match(pairing, /awaitingSettingsReturnRef\.current = true/);
  assert.match(pairing, /getCameraPermission\(\)\.catch/);
  assert.match(pairing, /accessibilityRole="radio"/);
  assert.match(pairing, /accessibilityState=\{\{ checked: selected, disabled: busy \}\}/);
  assert.match(pairing, /accessibilityRole="progressbar"/);
  assert.match(pairing, /loading=\{busy\}[\s\S]*disabled=\{busy\}[\s\S]*onPress=\{openCameraAccess\}/);
  assert.match(pairing, /onBarcodeScanned=\{busy \? undefined : pair\}/);

  const fence = pairing.slice(
    pairing.indexOf('const pair = useCallback'),
    pairing.indexOf('\n\n  const openCameraAccess')
  );
  assert.ok(fence.indexOf('pairingInFlightRef.current = true') < fence.indexOf('setBusy(true)'));
});

test('shared device cards distinguish wearable and robot status without color alone', () => {
  const card = source('src/components/DeviceStatusCard.js');

  assert.match(card, /wearable \? 'watch-outline' : 'home-outline'/);
  assert.match(card, /wearable \? t\('home\.northStarDevice'\) : t\('medication\.robot'\)/);
  assert.match(card, /<StatusPill label=\{statusLabel\}/);
  assert.match(card, /isRTL && styles\.rtlRow/);
  assert.match(card, /Number\.isFinite\(entity\?\.battery\)/);
  assert.match(card, /Number\.isFinite\(entity\?\.lastSeenAt\)/);
  assert.match(card, /onEndEditing=\{finishRename\}/);
  assert.doesNotMatch(card, /onBlur=\{finishRename\}|onSubmitEditing=\{finishRename\}/);
});
