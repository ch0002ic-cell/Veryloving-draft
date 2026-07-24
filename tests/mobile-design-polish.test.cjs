'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = (relativePath) => readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('startup hydration uses one branded progress surface and font loading cannot hang forever', () => {
  const root = source('app/_layout.js');
  const authLayout = source('app/(auth)/_layout.js');
  const index = source('app/index.js');
  const loading = source('src/components/AppLoadingState.js');
  const fonts = source('src/hooks/useAppFonts.js');

  assert.match(root, /<AppLoadingState message={t\('common\.loading'\)\} \/>/);
  assert.match(root, /if \(!fontsReady\) return <AppLoadingState \/>/);
  assert.match(authLayout, /if \(loading\)[\s\S]*<AppLoadingState message=\{t\('common\.loading'\)\} \/>/);
  assert.equal([...index.matchAll(/<AppLoadingState message=\{t\('common\.loading'\)\} \/>/g)].length, 2);
  assert.match(loading, /accessibilityRole="progressbar"/);
  assert.match(loading, /accessibilityState=\{\{ busy: true \}\}/);
  assert.match(loading, /<Image accessible=\{false\}/);
  assert.match(fonts, /withTimeout\(/);
  assert.match(fonts, /FONT_LOAD_TIMEOUT_MS/);
  assert.match(fonts, /\.catch\(\(error\) =>/);
  assert.match(fonts, /\.finally\(\(\) => mounted && setReady\(true\)\)/);
});

test('onboarding has reduced-motion transitions, contextual art, and explicit progress', () => {
  const landing = source('app/(auth)/onboarding.js');
  const tutorial = source('src/components/TutorialPage.js');
  const progress = source('src/components/OnboardingProgress.js');

  assert.match(landing, /ReduceMotion\.System/);
  assert.match(landing, /motion\.durationEmphasis/);
  assert.match(landing, /<Image accessible=\{false\}/);
  assert.match(tutorial, /<OnboardingProgress/);
  assert.match(tutorial, /tutorialArt\[titleKey\]/);
  assert.match(tutorial, /ReduceMotion\.System/);
  assert.match(progress, /accessibilityRole="progressbar"/);
  assert.match(progress, /accessibilityValue=\{\{ min: 1, max: safeTotal, now: safeCurrent \}\}/);
});

test('routine mode success uses a bounded, accessible snackbar', () => {
  const snackbar = source('src/components/Snackbar.js');
  const home = source('app/(tabs)/index.js');

  assert.match(snackbar, /setTimeout\(\(\) => dismissRef\.current\?\.\(\), duration\)/);
  assert.match(snackbar, /\[canDismiss, duration, message\]/);
  assert.match(snackbar, /return \(\) => clearTimeout\(timer\)/);
  assert.match(snackbar, /ReduceMotion\.System/);
  assert.match(snackbar, /accessibilityLiveRegion=\{tone === 'error' \? 'assertive' : 'polite'\}/);
  assert.match(home, /setModeFeedback\(mode\)/);
  assert.match(home, /<Snackbar/);
});

test('BLE, voice, map, SOS, and medication surfaces expose polished async and status states', () => {
  const ble = source('app/(auth)/jewelry-setup.js');
  const voice = source('app/safety-call.js');
  const map = source('app/(tabs)/map.js');
  const sos = source('app/emergency-sos.js');
  const medication = source('app/medication-reminders.js');

  assert.match(ble, /tone=\{error\?\.code === 'BLE_UNAVAILABLE' \? 'info' : 'error'\}/);
  assert.match(ble, /actionLabel=\{t\('jewelry\.scan'\)\}/);
  assert.match(voice, /accessibilityLiveRegion="polite"/);
  assert.match(voice, /<StatusPill label=\{statusLabel\}/);
  assert.match(map, /function DeviceLegend/);
  assert.match(map, /<ScrollView[\s\S]*style=\{\[styles\.savedOverlay/);
  assert.match(map, /maxHeight: '58%'/);
  assert.match(sos, /t\('emergency\.body'\)/);
  assert.match(sos, /<StatusPill/);
  assert.match(medication, /<TextField/);
  assert.match(medication, /<SkeletonGroup/);
  assert.match(medication, /<EmptyState compact/);
});
