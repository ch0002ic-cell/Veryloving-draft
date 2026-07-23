'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

let nativeWriteCalls = 0;
const originalModuleLoad = Module._load;
Module._load = function loadAudioTestDependency(request, parent, isMain) {
  const isAudioService = parent?.filename?.endsWith('/src/services/audio.js');
  if (isAudioService && request === 'expo-audio') {
    return {
      createAudioPlayer() { throw new Error('playback is not expected'); },
      requestRecordingPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => {}
    };
  }
  if (isAudioService && request === 'expo-file-system/legacy') {
    return {
      cacheDirectory: '/cache/',
      EncodingType: { Base64: 'base64' },
      deleteAsync: async () => {},
      writeAsStringAsync() {
        nativeWriteCalls += 1;
        return new Promise(() => {});
      }
    };
  }
  if (isAudioService && request === './permissions') {
    return { explainPermission: async () => true };
  }
  if (isAudioService && request === './voice-audio-cache') {
    return { VOICE_AUDIO_CACHE_PREFIX: 'voice-' };
  }
  if (isAudioService && request === '../utils/logger') {
    return { logger: { error() {}, info() {}, voice() {}, warn() {} } };
  }
  if (isAudioService && request === '../utils/runtime-environment') {
    return { isExpoGoRuntime: () => false };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { AudioService } = require('../src/services/audio');
Module._load = originalModuleLoad;

test('stalled native audio writes remain globally bounded across repeated cancellation', async () => {
  nativeWriteCalls = 0;
  const service = new AudioService();
  const encodedSegment = 'A'.repeat(1_300_000);
  const cancellations = [];

  for (let index = 0; index < 20; index += 1) {
    void service.playBase64Audio(encodedSegment).catch(() => {});
    await Promise.resolve();
    // cancelAndClearQueue detaches synchronously; overlap its bounded cleanup
    // waits so this regression stays fast while exercising many generations.
    cancellations.push(service.cancelAndClearQueue());
  }

  await Promise.all(cancellations);
  assert.equal(nativeWriteCalls, 8);
  assert.equal(service.playbackRetainedSegments, 8);
  assert.ok(service.playbackRetainedBytes <= 8 * 1024 * 1024);
  assert.equal(await service.playBase64Audio(encodedSegment), false);
});

test('cancel followed by enqueue retains one playback drain owner', async () => {
  const service = new AudioService();
  const started = [];
  let activePlayers = 0;
  let maximumActivePlayers = 0;
  service._playFile = async ({ uri }) => {
    activePlayers += 1;
    maximumActivePlayers = Math.max(maximumActivePlayers, activePlayers);
    started.push(uri);
    try {
      if (uri === 'old') {
        await new Promise((resolve) => { service.currentPlaybackFinish = resolve; });
      }
    } finally {
      if (uri === 'old') service.currentPlaybackFinish = null;
      activePlayers -= 1;
    }
  };
  const enqueue = (uri) => {
    service.playbackQueue.push({
      uri,
      generation: service.playbackGeneration,
      sizeBytes: 1,
      releaseAdmission() {}
    });
  };

  enqueue('old');
  const originalDrain = service._drainPlaybackQueue();
  while (started.length === 0) await Promise.resolve();
  const cancellation = service.cancelAndClearQueue();
  enqueue('new-1');
  enqueue('new-2');
  const resumedDrain = service._drainPlaybackQueue();

  assert.equal(resumedDrain, originalDrain);
  await Promise.all([originalDrain, resumedDrain, cancellation]);
  assert.deepEqual(started, ['old', 'new-1', 'new-2']);
  assert.equal(maximumActivePlayers, 1);
});
