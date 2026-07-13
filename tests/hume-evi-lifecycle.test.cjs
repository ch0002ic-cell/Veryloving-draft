'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { test } = require('node:test');

const fakeAudioService = {
  callback: null,
  setAudioChunkCallback(callback) { this.callback = callback; },
  async startRecording() {},
  async stopRecording() {},
  async playBase64Audio() {},
  async cancelAndClearQueue() {}
};

const originalModuleLoad = Module._load;
Module._load = function loadVoiceTestDependency(request, parent, isMain) {
  const isHumeService = parent?.filename.endsWith('/src/services/websocket/hume-evi.js');
  if (isHumeService && request === '../audio') return { audioService: fakeAudioService };
  if (isHumeService && request === '../../utils/config') return { config: {} };
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { HumeEVIService } = require('../src/services/websocket/hume-evi');
Module._load = originalModuleLoad;

const readyService = () => {
  const service = new HumeEVIService();
  service.socket = {
    readyState: 1,
    close() {},
    send() {}
  };
  service.state = 'connected';
  service.chatMetadataReceived = true;
  service.intentionallyConnected = true;
  service.sessionConfig = { customSessionId: 'test-session' };
  return service;
};

test('disconnect invalidates an in-flight microphone start and then stops native recording', async () => {
  let resolveStart;
  let stopCalls = 0;
  fakeAudioService.callback = null;
  fakeAudioService.startRecording = () => new Promise((resolve) => { resolveStart = resolve; });
  fakeAudioService.stopRecording = async () => { stopCalls += 1; };
  fakeAudioService.cancelAndClearQueue = async () => {};

  const service = readyService();
  const starting = service.startMicrophone();
  assert.equal(service.microphoneState, 'starting');

  const disconnecting = service.disconnect();
  assert.equal(service.microphoneState, 'stopping');
  assert.equal(service.isMicrophoneActive(), false);

  resolveStart();
  assert.equal(await starting, false);
  await disconnecting;

  assert.equal(stopCalls, 1);
  assert.equal(fakeAudioService.callback, null);
  assert.equal(service.microphoneState, 'idle');
  assert.equal(service.isMicrophoneActive(), false);
  assert.equal(service.getState(), 'disconnected');
});

test('a native microphone stop error cannot poison subsequent starts', async () => {
  let startCalls = 0;
  fakeAudioService.callback = null;
  fakeAudioService.startRecording = async () => { startCalls += 1; };
  fakeAudioService.stopRecording = async () => { throw new Error('native stop failed'); };

  const service = readyService();
  assert.equal(await service.startMicrophone(), true);
  assert.equal(service.isMicrophoneActive(), true);
  await assert.rejects(service.stopMicrophone(), /native stop failed/);

  assert.equal(fakeAudioService.callback, null);
  assert.equal(service.microphoneState, 'idle');
  assert.equal(service.isMicrophoneActive(), false);

  fakeAudioService.stopRecording = async () => {};
  assert.equal(await service.startMicrophone(), true);
  assert.equal(startCalls, 2);
  assert.equal(service.isMicrophoneActive(), true);
  await service.stopMicrophone();
});

test('chat metadata does not replenish the bounded reconnect budget', async () => {
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = async () => {};
  const service = readyService();
  service.state = 'reconnecting';
  service.chatMetadataReceived = false;
  service.reconnectAttempts = 3;

  await service.handleMessage({
    data: JSON.stringify({ type: 'chat_metadata', chat_id: 'chat-1', chat_group_id: 'group-1' })
  }, service.socket);

  assert.equal(service.reconnectAttempts, 3);
  assert.equal(service.getState(), 'connected');
});

test('reconnect scheduling remains capped across one connection episode', () => {
  const service = readyService();
  service.reconnectDelay = 60000;
  service.maxReconnectAttempts = 2;

  service.scheduleReconnect('transport');
  assert.equal(service.reconnectAttempts, 1);
  service.clearReconnectTimer();

  service.scheduleReconnect('transport');
  assert.equal(service.reconnectAttempts, 2);
  service.clearReconnectTimer();

  service.scheduleReconnect('transport');
  assert.equal(service.reconnectAttempts, 2);
  assert.equal(service.reconnectTimer, null);
});
