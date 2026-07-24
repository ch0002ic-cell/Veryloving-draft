'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const {
  conversationCompanionName,
  conversationRoleLabel,
  conversationTimestamp
} = require('../src/utils/conversation-history-display');

function translate(key) {
  const known = {
    'history.aiCompanion': 'AI companion',
    'history.roles.assistant': 'companion',
    'history.roles.user': 'you',
    'voices.profiles.capybara.name': 'Capybear'
  };
  return known[key] || `[missing ${key}]`;
}

test('conversation history resolves only allowlisted voice translation keys', () => {
  assert.equal(conversationCompanionName({ voiceId: 'capybara' }, translate), 'Capybear');
  assert.equal(
    conversationCompanionName({ voiceId: 'corrupt-key', voiceName: ' Legacy Guardian ' }, translate),
    'Legacy Guardian'
  );
  assert.equal(
    conversationCompanionName({ voiceId: { injected: true }, voiceName: null }, translate),
    'AI companion'
  );
  assert.doesNotMatch(
    conversationCompanionName({ voiceId: '../../unknown' }, translate),
    /\[missing/
  );
});

test('persisted voice names are bounded and stripped of unsafe control characters', () => {
  const longName = `  Legacy\u0000\n\u202e${'x'.repeat(120)}  `;
  const result = conversationCompanionName({ voiceId: 'retired', voiceName: longName }, translate);
  assert.equal(Array.from(result).length, 80);
  assert.doesNotMatch(result, /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
});

test('unknown or malformed roles use a localized neutral label', () => {
  assert.equal(conversationRoleLabel('assistant', translate), 'companion');
  assert.equal(conversationRoleLabel('user', translate), 'you');
  assert.equal(conversationRoleLabel('system', translate), 'AI companion');
  assert.equal(conversationRoleLabel({ injected: true }, translate), 'AI companion');
});

test('a corrupt updated timestamp falls back to a valid session start', () => {
  const startedAt = '2026-07-25T08:30:00.000Z';
  assert.equal(
    conversationTimestamp({ updatedAt: 'not-a-date', startedAt }, 'fr'),
    new Date(startedAt).toLocaleString('fr')
  );
  assert.equal(conversationTimestamp({
    updatedAt: Number.POSITIVE_INFINITY,
    startedAt: null
  }, 'en'), null);
});

test('conversation history screen never constructs translation keys from persisted values', () => {
  const screen = readFileSync(
    path.resolve(process.cwd(), 'app/conversation-history.js'),
    'utf8'
  );

  assert.match(screen, /conversationCompanionName\(item, t\)/);
  assert.match(screen, /conversationRoleLabel\(message\.role, t\)/);
  assert.match(screen, /conversationTimestamp\(item, locale\) \|\| t\('common\.unknown'\)/);
  assert.doesNotMatch(screen, /t\(`voices\.profiles\.\$\{item\.voiceId\}/);
  assert.doesNotMatch(screen, /t\(`history\.roles\.\$\{message\.role\}/);
});
