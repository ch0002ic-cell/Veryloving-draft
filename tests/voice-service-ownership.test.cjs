'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { OfflineEVIService } = require('../src/services/websocket/offline-evi');
const {
  VoiceServiceOwnership
} = require('../src/services/websocket/voice-service-ownership');

test('a stale voice-screen cleanup cannot release the replacement owner', () => {
  const ownership = new VoiceServiceOwnership();
  const service = { async disconnect() {} };
  const firstOwner = Symbol('first');
  const secondOwner = Symbol('second');
  let revocations = 0;

  assert.equal(ownership.claim(firstOwner, service, () => { revocations += 1; }), null);
  assert.equal(ownership.owns(firstOwner, service), true);
  assert.equal(ownership.claim(secondOwner, service).owner, firstOwner);
  assert.equal(revocations, 1);
  assert.equal(ownership.release(firstOwner, service), false);
  assert.equal(ownership.owns(secondOwner, service), true);
  assert.equal(ownership.release(secondOwner, service), true);
  assert.equal(ownership.owns(secondOwner, service), false);
});

test('an offline response is never delivered to a replacement call handler', () => {
  let nextTimerId = 0;
  const timers = new Map();
  const service = new OfflineEVIService({
    setTimeoutImpl(callback) {
      const id = ++nextTimerId;
      timers.set(id, callback);
      return id;
    },
    clearTimeoutImpl(id) {
      timers.delete(id);
    }
  });
  service.state = 'connected';
  const first = [];
  const second = [];
  service.setMessageHandler({
    onUserMessage: (text) => first.push(`user:${text}`),
    onAssistantMessage: (text) => first.push(`assistant:${text}`)
  });
  assert.equal(service.sendText('help'), true);
  service.setMessageHandler({
    onUserMessage: (text) => second.push(`user:${text}`),
    onAssistantMessage: (text) => second.push(`assistant:${text}`)
  });

  timers.get(1)();
  assert.deepEqual(first.map((entry) => entry.split(':')[0]), ['user']);
  assert.deepEqual(second, []);

  assert.equal(service.sendText('hello'), true);
  timers.get(2)();
  assert.deepEqual(second.map((entry) => entry.split(':')[0]), ['user', 'assistant']);
});

test('offline service uses the active session locale for reviewed responses', () => {
  const timers = [];
  const service = new OfflineEVIService({
    setTimeoutImpl(callback) {
      timers.push(callback);
      return timers.length;
    }
  });
  const messages = [];
  service.state = 'connected';
  service.sessionConfig = { locale: 'es-MX' };
  service.setMessageHandler({
    onAssistantMessage: (text) => messages.push(text)
  });

  assert.equal(service.sendText('Necesito un consejo de seguridad'), true);
  timers[0]();
  assert.match(messages[0], /lugar público/i);
});

test('the voice hook claims ownership and guards stale cleanup and delivery', () => {
  const hook = readFileSync(
    path.resolve(process.cwd(), 'src/hooks/useHumeVoiceCall.js'),
    'utf8'
  );
  assert.match(hook, /voiceServiceOwnership\.claim\([\s\S]*?owner,[\s\S]*?service,[\s\S]*?handleOwnershipRevoked/);
  assert.match(hook, /handleOwnershipRevoked/);
  assert.match(hook, /setStatus\('disconnected'\)/);
  assert.match(hook, /voiceServiceOwnership\.owns\(serviceOwnerRef\.current, service\)/);
  assert.match(hook, /voiceServiceOwnership\.release\(serviceOwnerRef\.current, service\)/);
  assert.match(hook, /nativeLocaleTagForLanguage\(locale\) \|\| 'en'/);
  assert.match(hook, /locale: providerLocale/);
  assert.match(
    hook,
    /systemPrompt: `[^`]*Respond in the selected interface language \(\$\{providerLocale\}\) unless the user explicitly requests another language\.[^`]*`/
  );
  assert.doesNotMatch(
    hook,
    /return \(\) => \{[\s\S]{0,300}serviceRef\.current\.disconnect/
  );
});
