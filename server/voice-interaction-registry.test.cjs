'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createVoiceInteractionCompletionRegistry
} = require('./voice-interaction-registry.cjs');

test('voice interaction completion proofs are completed, account-bound, and time-bound', () => {
  let now = 10_000;
  const registry = createVoiceInteractionCompletionRegistry({
    clock: () => now,
    activeTTLms: 2_000,
    completedTTLms: 1_000
  });

  assert.equal(registry.begin('google:owner', 'voice-session-1'), true);
  assert.equal(registry.begin('google:owner', 'voice-session-1'), true);
  assert.equal(registry.hasActivity('google:owner', 'voice-session-1'), false);
  assert.equal(registry.complete('google:owner', 'voice-session-1'), false);
  assert.equal(registry.observeActivity('google:owner', 'voice-session-1'), true);
  assert.equal(registry.hasActivity('google:owner', 'voice-session-1'), true);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-session-1', { occurredAt: now }), false);
  assert.equal(registry.disconnect('google:owner', 'voice-session-1'), true);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-session-1', { occurredAt: now }), false);
  now += 100;
  assert.equal(registry.complete('google:owner', 'voice-session-1'), true);
  assert.equal(registry.verifyCompleted('google:other', 'voice-session-1', { occurredAt: now }), false);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-session-2', { occurredAt: now }), false);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-session-1', { occurredAt: now }), true);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-session-1', { occurredAt: 9_999 }), false);
  now += 1_001;
  assert.equal(registry.verifyCompleted('google:owner', 'voice-session-1', { occurredAt: now }), false);
});

test('voice interaction proof permits bounded reconnects but never reopens explicit completion', () => {
  let now = 30_000;
  const registry = createVoiceInteractionCompletionRegistry({
    clock: () => now,
    activeTTLms: 10_000,
    completedTTLms: 5_000,
    reconnectGraceMs: 1_000
  });

  assert.equal(registry.begin('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.observeActivity('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.disconnect('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.hasActivity('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-reconnect-1', { occurredAt: now }), false);
  now += 500;
  assert.equal(registry.begin('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.hasActivity('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.verifyCompleted('google:owner', 'voice-reconnect-1', { occurredAt: now }), false);
  assert.equal(registry.complete('google:owner', 'voice-reconnect-1'), true);
  assert.equal(registry.begin('google:owner', 'voice-reconnect-1'), false);

  assert.equal(registry.begin('google:owner', 'voice-reconnect-2'), true);
  assert.equal(registry.disconnect('google:owner', 'voice-reconnect-2'), true);
  now += 1_001;
  assert.equal(registry.begin('google:owner', 'voice-reconnect-2'), false);
});

test('voice interaction completion registry rejects malformed identities and remains bounded', () => {
  let now = 20_000;
  const registry = createVoiceInteractionCompletionRegistry({
    clock: () => now,
    maxRecords: 2,
    activeTTLms: 1_000,
    completedTTLms: 1_000
  });

  assert.equal(registry.begin('', 'voice-1'), false);
  assert.equal(registry.begin('google:owner', 'bad interaction'), false);
  assert.equal(registry.observeActivity('google:owner', 'bad interaction'), false);
  assert.equal(registry.hasActivity('google:owner', 'bad interaction'), false);
  assert.equal(registry.begin('google:owner', 'voice-1'), true);
  assert.equal(registry.begin('google:owner', 'voice-2'), true);
  assert.equal(registry.begin('google:owner', 'voice-3'), true);
  assert.equal(registry.complete('google:owner', 'voice-1'), false);
  assert.equal(registry.complete('google:owner', 'voice-2'), false);
  assert.equal(registry.observeActivity('google:owner', 'voice-2'), true);
  assert.equal(registry.complete('google:owner', 'voice-2'), true);
  now += 1_001;
  assert.equal(registry.complete('google:owner', 'voice-2'), false);
});
