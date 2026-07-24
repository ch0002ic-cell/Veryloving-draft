'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = (relativePath) => readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('friend data cannot construct arbitrary translation keys or invalid React text children', () => {
  const friends = source('app/friends.js');
  assert.match(friends, /const FRIEND_STATUSES = new Set\(\['guardian', 'pending'\]\)/);
  assert.match(friends, /FRIEND_STATUSES\.has\(statusId\)/);
  assert.match(friends, /: t\('common\.unknown'\)/);
  assert.match(friends, /typeof item\?\.name === 'string'/);
  assert.doesNotMatch(
    friends,
    /t\(`friends\.statuses\.\$\{String\(item\.status\)\.toLowerCase\(\)\}`\)/
  );
});

test('scenario cards fail closed when a caller supplies an unknown server enum', () => {
  const card = source('src/components/ScenarioStatusCard.js');
  assert.match(card, /const SCENARIO_IDS = new Set\(/);
  assert.match(card, /const SCENARIO_STATES = new Set\(Object\.keys\(STATE_TONES\)\)/);
  assert.match(card, /SCENARIO_IDS\.has\(execution\.scenarioId\)/);
  assert.match(card, /SCENARIO_STATES\.has\(execution\.state\)/);
  assert.match(card, /STATE_TONES\[execution\.state\] \|\| 'idle'/);
  assert.match(card, /: t\('common\.unknown'\)/);
});

test('BLE failures never render an Error or diagnostic object as a React text child', () => {
  const pairing = source('app/(auth)/jewelry-setup.js');
  assert.match(pairing, /error\?\.translationKey[\s\S]*t\(error\.translationKey\)/);
  assert.match(pairing, /t\('settings\.updateFailedMessage'\)/);
  assert.match(pairing, /message=\{errorMessage\}/);
  assert.doesNotMatch(pairing, /message=\{error\}/);
});

test('offline companion has no silent machine-catalog safety-copy path', () => {
  const responses = source('src/mocks/offlineResponses.js');
  assert.match(responses, /const REVIEWED_OFFLINE_LOCALES = new Set\(\['en', 'es', 'fr', 'zh'\]\)/);
  assert.match(responses, /return REVIEWED_OFFLINE_LOCALES\.has\(language\) \? language : 'en'/);
  assert.match(responses, /151 machine-QA catalogs/);
  assert.doesNotMatch(responses, /offlineResponsesByLocale\[language\]/);
});
