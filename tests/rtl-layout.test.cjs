'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const mirroredLayoutFiles = [
  'app/(auth)/tutorial/choose-voice.js',
  'app/(tabs)/index.js',
  'app/(tabs)/map.js',
  'app/conversation-history.js',
  'app/safety-call.js',
  'app/settings.js',
  'app/voices.js',
  'src/components/ChatBubble.js',
  'src/components/CountryPicker.js',
  'src/components/EmptyState.js',
  'src/components/FeedbackBanner.js',
  'src/components/GlobalPhoneInput.js',
  'src/components/Header.js',
  'src/components/LanguageSelector.js',
  'src/components/SettingsSection.js'
];

test('semantic rows mirror from the reactive i18n direction', () => {
  mirroredLayoutFiles.forEach((relativePath) => {
    const source = readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
    assert.match(source, /\bisRTL\b/, `${relativePath} must consume the reactive RTL state`);
    assert.match(
      source,
      /isRTL && styles\.rtlRow|isRTL && styles\.rtlInputRow/,
      `${relativePath} must conditionally mirror a semantic row`
    );
  });
});

test('phone numbers and calling codes remain left-to-right inside mirrored controls', () => {
  const phoneInput = readFileSync(
    path.resolve(process.cwd(), 'src/components/GlobalPhoneInput.js'),
    'utf8'
  );
  const countryPicker = readFileSync(
    path.resolve(process.cwd(), 'src/components/CountryPicker.js'),
    'utf8'
  );

  assert.match(phoneInput, /input: \{[^}]*writingDirection: 'ltr'[^}]*textAlign: 'left'/);
  assert.match(countryPicker, /callingCode: \{[^}]*writingDirection: 'ltr'[^}]*textAlign: 'left'/);
});

test('back navigation icon follows the reactive RTL direction', () => {
  const header = readFileSync(
    path.resolve(process.cwd(), 'src/components/Header.js'),
    'utf8'
  );

  assert.match(header, /name=\{isRTL \? 'chevron-forward' : 'chevron-back'\}/);
});
