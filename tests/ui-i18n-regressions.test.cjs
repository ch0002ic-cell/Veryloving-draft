'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = (relativePath) => readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('forward action icons follow the active writing direction', () => {
  const onboarding = source('app/(auth)/onboarding.js');
  const cognitive = source('app/cognitive-engagement.js');

  assert.match(onboarding, /icon=\{isRTL \? 'arrow-back' : 'arrow-forward'\}/);
  assert.match(
    cognitive,
    /icon=\{isRTL \? 'arrow-back-outline' : 'arrow-forward-outline'\}/
  );
  assert.doesNotMatch(onboarding, /icon="arrow-forward"/);
  assert.doesNotMatch(cognitive, /icon="arrow-forward-outline"/);
});

test('language choices expose native, English, code, review, and selection metadata', () => {
  const selector = source('src/components/LanguageSelector.js');

  assert.match(selector, /const languageAccessibilityLabel = \(language, selected = false\)/);
  assert.match(selector, /effectiveLanguage\.englishName/);
  assert.match(selector, /languageCodeLabel\(effectiveLanguage\)/);
  assert.match(selector, /selected \? t\('common\.selected'\) : null/);
  assert.match(selector, /accessibilityLabel=\{languageAccessibilityLabel\(item, selected\)\}/);
  assert.match(selector, /language\.code === 'system' \? resolvedLanguage : language/);
  assert.match(selector, /languageLabel\(resolvedLanguage\).*languageCodeLabel\(resolvedLanguage\)/s);
});

test('demo identity uses the localized generic user label at its UI boundary', () => {
  const auth = source('src/context/AuthContext.js');
  const settings = source('app/settings.js');

  assert.match(auth, /provider: 'demo',[\s\S]*name: null,/);
  assert.doesNotMatch(auth, /name: 'Demo User'/);
  assert.match(settings, /user\?\.name \|\| t\('common\.user'\)/);
});

test('user-visible device, scenario, and history dates use guarded locale formatting', () => {
  for (const relativePath of [
    'src/components/DeviceStatusCard.js',
    'src/components/ScenarioStatusCard.js',
    'app/medication-reminders.js',
    'app/emotional-check-in.js',
    'app/medical-profile.js',
    'app/emergency-sos.js',
    'app/conversation-history.js',
    'app/(tabs)/map.js'
  ]) {
    const contents = source(relativePath);
    const usesGuardedConversationTimestamp = relativePath === 'app/conversation-history.js'
      && /conversationTimestamp/.test(contents);
    assert.match(
      contents,
      usesGuardedConversationTimestamp ? /conversationTimestamp/ : /formatLocalizedDateTime/,
      `${relativePath} must reject invalid dates before display`
    );
    assert.doesNotMatch(
      contents,
      /new Date\([^\n]+\)\.toLocaleString\(locale\)/,
      `${relativePath} must use the guarded shared formatter`
    );
  }
});

test('map localizes human-facing measurements while preserving technical coordinates as LTR', () => {
  const map = source('app/(tabs)/map.js');

  assert.match(map, /radius: formatLocalizedNumber\(/);
  assert.match(map, /writingDirection: 'ltr'/);
  assert.match(map, /textAlign: 'left'/);
});
