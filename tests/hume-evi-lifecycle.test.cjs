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
  if (isHumeService && request === '../audio') {
    return { audioService: fakeAudioService, MAX_PLAYBACK_SEGMENT_BASE64_CHARACTERS: 1400000 };
  }
  if (isHumeService && request === '../../utils/config') return { config: {} };
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { HumeEVIService } = require('../src/services/websocket/hume-evi');
const { HUME_CONFIGURATION_USER_MESSAGE } = require('../src/services/websocket/hume-errors');
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

test('missing and invalid Hume configuration use a stable user-safe error', async () => {
  const service = new HumeEVIService();
  const received = [];
  service.setMessageHandler({ onError: (error) => received.push(error) });

  await assert.rejects(
    service.connect(),
    (error) => (
      error.code === 'VOICE_CONFIGURATION_MISSING'
      && error.message === HUME_CONFIGURATION_USER_MESSAGE
    )
  );
  assert.equal(received.at(-1).code, 'VOICE_CONFIGURATION_MISSING');

  service.handleServerError({ code: 'E0703', message: 'Configuration resource private-id is invalid.' });
  assert.equal(received.at(-1).code, 'VOICE_CONFIGURATION_INVALID');
  assert.equal(received.at(-1).message, HUME_CONFIGURATION_USER_MESSAGE);
  assert.doesNotMatch(received.at(-1).message, /private-id/);
});

test('an invalid direct Hume credential remains user-safe after the socket closes', () => {
  const service = new HumeEVIService();
  const socket = { readyState: 3 };
  const received = [];
  service.socket = socket;
  service.intentionallyConnected = true;
  service.sessionConfig = {};
  service.state = 'connecting';
  service.setMessageHandler({ onError: (error) => received.push(error) });

  service.handleClose({ code: 1008, reason: '403 invalid api key' }, socket);

  assert.equal(received.at(-1).code, 'VOICE_CONFIGURATION_INVALID');
  assert.equal(received.at(-1).message, HUME_CONFIGURATION_USER_MESSAGE);
  assert.doesNotMatch(received.at(-1).message, /api key|403/i);
});

test('a Hume configuration error is not overwritten by a generic close error', () => {
  const service = new HumeEVIService();
  const socket = { readyState: 3 };
  const received = [];
  service.socket = socket;
  service.intentionallyConnected = true;
  service.sessionConfig = {};
  service.state = 'connecting';
  service.setMessageHandler({ onError: (error) => received.push(error) });

  service.handleServerError({ code: 'E0709', message: 'Configuration secret-id does not exist.' });
  service.handleClose({ code: 1008, reason: 'policy violation' }, socket);

  assert.equal(received.at(-1).code, 'VOICE_CONFIGURATION_INVALID');
  assert.equal(received.at(-1).message, HUME_CONFIGURATION_USER_MESSAGE);
  assert.doesNotMatch(received.at(-1).message, /secret-id/);
});

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

test('disconnect detaches the WebSocket before waiting for native microphone cleanup', async () => {
  let resolveStop;
  let closeCall;
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = () => new Promise((resolve) => { resolveStop = resolve; });
  fakeAudioService.cancelAndClearQueue = async () => {};

  const service = readyService();
  const socket = service.socket;
  socket.onopen = () => {};
  socket.onmessage = () => {};
  socket.onerror = () => {};
  socket.onclose = () => {};
  socket.close = (...args) => { closeCall = args; };
  await service.startMicrophone();

  const disconnecting = service.disconnect();
  assert.equal(service.socket, null);
  assert.equal(socket.onopen, null);
  assert.equal(socket.onmessage, null);
  assert.equal(socket.onerror, null);
  assert.equal(socket.onclose, null);
  assert.deepEqual(closeCall, [1000, 'Client disconnected']);

  await Promise.resolve();
  assert.equal(typeof resolveStop, 'function');
  resolveStop();
  await disconnecting;
  assert.equal(service.getState(), 'disconnected');
});

test('disconnect clears the pending connection timeout owned by its socket', async () => {
  fakeAudioService.stopRecording = async () => {};
  fakeAudioService.cancelAndClearQueue = async () => {};
  const service = readyService();
  const timeout = setTimeout(() => {}, 60_000);
  service.connectionTimer = { socket: service.socket, timeout };

  await service.disconnect();

  assert.equal(service.connectionTimer, null);
  assert.equal(service.getState(), 'disconnected');
});

test('a replacement connection waits for native cleanup from the previous call', async () => {
  let resolveStop;
  let socketCreations = 0;
  const originalWebSocket = global.WebSocket;
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = () => new Promise((resolve) => { resolveStop = resolve; });
  fakeAudioService.cancelAndClearQueue = async () => {};
  class FakeWebSocket {
    constructor(url) {
      socketCreations += 1;
      this.url = url;
      this.readyState = 0;
    }
    send() {}
    close() { this.readyState = 3; }
  }
  global.WebSocket = FakeWebSocket;

  try {
    const service = readyService();
    await service.startMicrophone();
    const disconnecting = service.disconnect();
    const reconnecting = service.connect({ humeAccessToken: 'test-access-token' });
    await Promise.resolve();
    assert.equal(socketCreations, 0);

    await Promise.resolve();
    assert.equal(typeof resolveStop, 'function');
    resolveStop();
    await disconnecting;
    await reconnecting;
    assert.equal(socketCreations, 1);
    assert.equal(service.getState(), 'connecting');

    const replacement = service.socket;
    replacement.readyState = 1;
    replacement.onopen();
    await service.handleMessage({
      data: JSON.stringify({
        type: 'chat_metadata',
        chat_id: 'replacement-chat',
        chat_group_id: 'replacement-group'
      })
    }, replacement);
    assert.equal(service.socket, replacement);
    assert.equal(service.getState(), 'connected');

    fakeAudioService.stopRecording = async () => {};
    await service.disconnect();
  } finally {
    global.WebSocket = originalWebSocket;
  }
});

test('a final disconnect cancels a replacement connection waiting on old native cleanup', async () => {
  let resolveStop;
  let socketCreations = 0;
  const originalWebSocket = global.WebSocket;
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = () => new Promise((resolve) => { resolveStop = resolve; });
  fakeAudioService.cancelAndClearQueue = async () => {};
  global.WebSocket = class {
    constructor() {
      socketCreations += 1;
      this.readyState = 0;
    }
    close() { this.readyState = 3; }
    send() {}
  };

  try {
    const service = readyService();
    await service.startMicrophone();
    const firstDisconnect = service.disconnect();
    const replacementConnect = service.connect({ humeAccessToken: 'test-access-token' });
    const finalDisconnect = service.disconnect();
    assert.equal(firstDisconnect, finalDisconnect);

    await Promise.resolve();
    resolveStop();
    await Promise.all([firstDisconnect, replacementConnect, finalDisconnect]);

    assert.equal(socketCreations, 0);
    assert.equal(service.socket, null);
    assert.equal(service.getState(), 'disconnected');
  } finally {
    global.WebSocket = originalWebSocket;
  }
});

test('a native WebSocket close exception cannot skip microphone and playback cleanup', async () => {
  let stopCalls = 0;
  let cancelCalls = 0;
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = async () => { stopCalls += 1; };
  fakeAudioService.cancelAndClearQueue = async () => { cancelCalls += 1; };

  const service = readyService();
  service.socket.close = () => { throw new Error('native close failed'); };
  await service.startMicrophone();
  await service.disconnect();

  assert.equal(stopCalls, 1);
  assert.equal(cancelCalls, 1);
  assert.equal(service.socket, null);
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

test('microphone PCM frames become bounded Hume audio_input messages only while ready', async () => {
  const sent = [];
  fakeAudioService.callback = null;
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = async () => {};
  const service = readyService();
  service.socket.send = (payload) => sent.push(JSON.parse(payload));

  assert.equal(await service.startMicrophone(), true);
  fakeAudioService.callback('AAD/fwCA');
  assert.deepEqual(sent, [{ type: 'audio_input', data: 'AAD/fwCA' }]);

  service.socket.bufferedAmount = 300 * 1024;
  fakeAudioService.callback('another-frame');
  assert.equal(sent.length, 1);
  await service.stopMicrophone();
  assert.equal(fakeAudioService.callback, null);
});

test('barge-in cancels queued playback and drops stale audio until the next assistant turn', async () => {
  const playback = [];
  let cancelCalls = 0;
  fakeAudioService.playBase64Audio = async (data) => { playback.push(data); };
  fakeAudioService.cancelAndClearQueue = async () => { cancelCalls += 1; };
  const service = readyService();

  await service.handleMessage({ data: JSON.stringify({
    type: 'assistant_message',
    message: { content: 'First answer' }
  }) }, service.socket);
  await service.handleMessage({ data: JSON.stringify({ type: 'audio_output', data: 'first-audio' }) }, service.socket);
  await service.handleMessage({ data: JSON.stringify({ type: 'user_interruption' }) }, service.socket);
  await service.handleMessage({ data: JSON.stringify({ type: 'audio_output', data: 'stale-audio' }) }, service.socket);

  assert.equal(cancelCalls, 1);
  assert.deepEqual(playback, ['first-audio']);

  await service.handleMessage({ data: JSON.stringify({
    type: 'assistant_message',
    message: { content: 'Second answer' }
  }) }, service.socket);
  await service.handleMessage({ data: JSON.stringify({ type: 'audio_output', data: 'second-audio' }) }, service.socket);
  assert.deepEqual(playback, ['first-audio', 'second-audio']);

  await service.handleMessage({ data: JSON.stringify({
    type: 'user_message',
    message: { content: 'Stop' }
  }) }, service.socket);
  assert.equal(cancelCalls, 2);
});

test('a text-send race returns false for durable queue fallback and surfaces a safe error', () => {
  const service = readyService();
  const received = [];
  let sendCalls = 0;
  service.socket.send = () => {
    sendCalls += 1;
    throw new Error('native socket detail must not escape');
  };
  service.setMessageHandler({ onError: (error) => received.push(error) });

  assert.equal(service.sendText('Please stay with me'), false);
  assert.equal(sendCalls, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].code, 'VOICE_TEXT_SEND_FAILED');
  assert.doesNotMatch(received[0].message, /native socket detail/);
});

test('oversized voice text and assistant audio are rejected before transport or playback', async () => {
  const service = readyService();
  const errors = [];
  const sent = [];
  const playback = [];
  service.socket.send = (payload) => sent.push(payload);
  service.setMessageHandler({ onError: (error) => errors.push(error) });
  fakeAudioService.playBase64Audio = async (data) => { playback.push(data); };

  assert.equal(service.sendText('x'.repeat(4097)), false);
  assert.equal(errors[0].code, 'VOICE_TEXT_TOO_LONG');
  assert.deepEqual(sent, []);

  await service.handleMessage({
    data: JSON.stringify({ type: 'audio_output', data: 'A'.repeat(1400001) })
  }, service.socket);
  assert.deepEqual(playback, []);
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

test('parallel tool calls retain independent abort controllers and both respond', async () => {
  const service = readyService();
  const resolvers = new Map();
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  service.setMessageHandler({
    onToolCall: (message) => new Promise((resolve) => resolvers.set(message.tool_call_id, resolve))
  });
  const first = service.handleToolCall({ type: 'tool_call', tool_call_id: 'call-1', name: 'emit_alarm', response_required: true }, service.socket);
  const second = service.handleToolCall({ type: 'tool_call', tool_call_id: 'call-2', name: 'check_medication', response_required: true }, service.socket);
  resolvers.get('call-2')('robot accepted');
  resolvers.get('call-1')('wearable accepted');
  await Promise.all([first, second]);
  assert.deepEqual(sent.map((message) => message.tool_call_id).sort(), ['call-1', 'call-2']);
  assert.equal(service.activeToolAbortControllers.size, 0);
});

test('device tool actions round-trip on the authenticated voice socket', async () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  const resultPromise = service.requestDeviceAction({
    tool_call_id: 'call-robot',
    name: 'check_medication',
    parameters: { device_type: 'home_robot', device_id: 'robot-1' }
  });
  const request = sent[0];
  assert.equal(request.type, 'action_request');
  assert.equal(request.device_id, 'robot-1');
  service.handleActionResponse({
    type: 'action_response',
    request_id: request.request_id,
    ok: true,
    result: { status: 'accepted', action_id: 'action-1' }
  });
  assert.deepEqual(JSON.parse(await resultPromise), { status: 'accepted', action_id: 'action-1' });
  assert.equal(service.pendingActionRequests.size, 0);
});

test('device action request identity is stable and duplicate in-flight tool calls are coalesced', async () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  service.sessionConfig = { customSessionId: 'stable-voice-session' };
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  const toolCall = {
    tool_call_id: 'call-robot-stable',
    name: 'check_medication',
    parameters: { device_type: 'home_robot', device_id: 'robot-1' }
  };
  const first = service.requestDeviceAction(toolCall);
  const duplicate = service.requestDeviceAction(toolCall);
  assert.equal(first, duplicate);
  assert.equal(sent.length, 1);
  const firstRequestId = sent[0].request_id;
  service.handleActionResponse({ type: 'action_response', request_id: firstRequestId, ok: true, result: { status: 'accepted' } });
  await Promise.all([first, duplicate]);

  const retry = service.requestDeviceAction(toolCall);
  assert.equal(sent[1].request_id, firstRequestId);
  service.handleActionResponse({ type: 'action_response', request_id: firstRequestId, ok: true, result: { status: 'accepted', duplicate: true } });
  await retry;
});

test('AI Angel sends a target-free scenario request and reuses its occurrence time on retry', async () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  service.sessionConfig = { customSessionId: 'stable-ai-angel-session' };
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  const toolCall = {
    tool_call_id: 'call-ai-angel',
    name: 'trigger_ai_angel',
    parameters: {}
  };

  const first = service.requestAINativeScenario(toolCall);
  assert.equal(sent[0].type, 'scenario_request');
  assert.equal(sent[0].scenario, 'ai_angel_auto_dial');
  assert.equal(Number.isSafeInteger(sent[0].occurred_at), true);
  assert.equal(Object.hasOwn(sent[0], 'device_id'), false);
  assert.equal(Object.hasOwn(sent[0], 'devices'), false);
  service.handleActionResponse({
    type: 'scenario_response',
    request_id: sent[0].request_id,
    ok: true,
    result: { started: [{ executionId: 'execution-1' }] }
  });
  await first;

  const retry = service.requestAINativeScenario(toolCall);
  assert.equal(sent[1].request_id, sent[0].request_id);
  assert.equal(sent[1].occurred_at, sent[0].occurred_at);
  service.handleActionResponse({
    type: 'scenario_response',
    request_id: sent[1].request_id,
    ok: true,
    result: { started: [{ executionId: 'execution-1' }] }
  });
  await retry;

  await assert.rejects(() => service.requestAINativeScenario({
    ...toolCall,
    tool_call_id: 'call-ai-angel-forged',
    parameters: { device_id: 'robot-forged' }
  }), /does not accept device identifiers/);
});

test('wearable action NACKs a transient failure and ACKs a successful redelivery', async () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  const sent = [];
  let attempts = 0;
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  service.setMessageHandler({
    onDeviceAction: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('BLE busy');
    },
    onError() {}
  });
  const frame = { data: JSON.stringify({ type: 'device_action', envelope: { id: 'signed-action-1' } }) };
  await service.handleMessage(frame, service.socket);
  await service.handleMessage(frame, service.socket);
  assert.deepEqual(sent.map(({ type, action_id, ok }) => ({ type, action_id, ok })), [
    { type: 'device_action_ack', action_id: 'signed-action-1', ok: false },
    { type: 'device_action_ack', action_id: 'signed-action-1', ok: true }
  ]);
  assert.equal(attempts, 2);
});

test('voice socket sends tolerate an OPEN-to-CLOSING race without escaping', () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  service.socket.send = () => { throw new Error('socket is closing'); };

  assert.doesNotThrow(() => service.updateDevices([{ deviceId: 'wearable-1' }]));
  assert.equal(service.updateDevices([{ deviceId: 'wearable-1' }]), false);
  assert.equal(service.sendToolResponse('tool-1', 'ok'), false);
  assert.equal(service.sendToolError('tool-1', 'failed', 'fallback'), false);
  assert.equal(service.sendDeviceActionAcknowledgement('action-1', true), false);
});

test('tool failures expose only localized fallback copy and a stable provider error code', async () => {
  const service = readyService();
  service.sessionConfig = {
    customSessionId: 'test-session',
    toolFailureMessage: 'No se pudo iniciar la atención conectada.'
  };
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  service.setMessageHandler({
    async onToolCall() {
      throw new Error('manufacturer token private-diagnostic-value expired');
    }
  });

  await service.handleToolCall({
    response_required: true,
    tool_call_id: 'tool-localized-failure',
    name: 'check_medication'
  }, service.socket);

  assert.deepEqual(sent, [{
    type: 'tool_error',
    tool_call_id: 'tool-localized-failure',
    error: 'TOOL_EXECUTION_FAILED',
    fallback_content: 'No se pudo iniciar la atención conectada.',
    level: 'warn'
  }]);
  assert.doesNotMatch(JSON.stringify(sent), /manufacturer token|private-diagnostic-value|expired/);
});

test('device action responses bound untrusted status and error identifiers', async () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));
  const result = service.requestDeviceAction({
    tool_call_id: 'call-invalid-error',
    name: 'check_medication',
    parameters: { device_type: 'home_robot', device_id: 'robot-1' }
  });

  service.handleActionResponse({
    type: 'action_response',
    request_id: sent[0].request_id,
    ok: false,
    status: 999999,
    error_code: `FORGED_${'X'.repeat(500)}`
  });

  await assert.rejects(result, (error) => (
    error.message === 'Device action service returned 500.'
    && error.code === 'DEVICE_ACTION_FAILED'
  ));
});

test('a failed secure voice handshake send reports a typed error and closes safely', () => {
  const service = new HumeEVIService();
  const received = [];
  let closeCode = null;
  const socket = {
    readyState: 1,
    send() { throw new Error('socket is closing'); },
    close(code) { closeCode = code; }
  };
  service.socket = socket;
  service.usesProxy = true;
  service.sessionConfig = { accessToken: 'test-token' };
  service.setMessageHandler({ onError: (error) => received.push(error) });

  assert.doesNotThrow(() => service.handleOpen(socket));
  assert.equal(received.at(-1).code, 'VOICE_HANDSHAKE_SEND_FAILED');
  assert.equal(service.state, 'error');
  assert.equal(closeCode, 4000);
});

test('voice interaction completion is coalesced and requires the matching gateway acknowledgement', async () => {
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  const sent = [];
  service.socket.send = (payload) => sent.push(JSON.parse(payload));

  const first = service.completeInteraction('voice-session-1');
  const duplicate = service.completeInteraction('voice-session-1');
  assert.equal(duplicate, first);
  assert.deepEqual(sent, [{
    type: 'interaction_complete',
    interaction_id: 'voice-session-1'
  }]);

  service.handleInteractionCompleted({
    type: 'interaction_completed',
    interaction_id: 'another-session',
    ok: true
  });
  assert.notEqual(service.pendingInteractionCompletion, null);

  await service.handleMessage({ data: JSON.stringify({
    type: 'interaction_completed',
    interaction_id: 'voice-session-1',
    ok: true
  }) }, service.socket);
  assert.equal(await first, true);
  assert.equal(service.pendingInteractionCompletion, null);
});

test('voice interaction completion fails closed on rejection and timeout', async () => {
  const rejectedService = readyService();
  rejectedService.usesProxy = true;
  rejectedService.proxyAuthenticated = true;
  rejectedService.socket.send = () => {};
  const rejected = rejectedService.completeInteraction('voice-session-rejected');
  rejectedService.handleInteractionCompleted({
    type: 'interaction_completed',
    interaction_id: 'voice-session-rejected',
    ok: false
  });
  await assert.rejects(rejected, (error) => (
    error.code === 'VOICE_INTERACTION_COMPLETION_REJECTED'
  ));
  assert.equal(rejectedService.pendingInteractionCompletion, null);

  const timeoutService = readyService();
  timeoutService.usesProxy = true;
  timeoutService.proxyAuthenticated = true;
  timeoutService.socket.send = () => {};
  await assert.rejects(
    timeoutService.completeInteraction('voice-session-timeout', { timeoutMs: 5 }),
    (error) => error.code === 'VOICE_INTERACTION_COMPLETION_TIMEOUT'
  );
  assert.equal(timeoutService.pendingInteractionCompletion, null);
});

test('voice interaction completion is cancelled and cleaned up when the transport disconnects', async () => {
  fakeAudioService.startRecording = async () => {};
  fakeAudioService.stopRecording = async () => {};
  fakeAudioService.cancelAndClearQueue = async () => {};
  const service = readyService();
  service.usesProxy = true;
  service.proxyAuthenticated = true;
  service.socket.send = () => {};

  const pending = service.completeInteraction('voice-session-disconnect', { timeoutMs: 30_000 });
  const rejected = assert.rejects(pending, (error) => (
    error.code === 'VOICE_INTERACTION_COMPLETION_CANCELLED'
  ));
  await service.disconnect();
  await rejected;

  assert.equal(service.pendingInteractionCompletion, null);
  assert.equal(service.getState(), 'disconnected');
});

test('voice interaction completion rejects invalid, unauthenticated, and overlapping requests', async () => {
  const service = readyService();
  await assert.rejects(
    service.completeInteraction('voice-session-not-authenticated'),
    (error) => error.code === 'VOICE_INTERACTION_NOT_CONNECTED'
  );

  service.usesProxy = true;
  service.proxyAuthenticated = true;
  service.socket.send = () => {};
  await assert.rejects(
    service.completeInteraction('../invalid interaction'),
    (error) => error.code === 'VOICE_INTERACTION_INVALID'
  );

  const pending = service.completeInteraction('voice-session-first', { timeoutMs: 30_000 });
  await assert.rejects(
    service.completeInteraction('voice-session-second'),
    (error) => error.code === 'VOICE_INTERACTION_COMPLETION_BUSY'
  );
  service.cancelPendingInteractionCompletion();
  await assert.rejects(pending, (error) => (
    error.code === 'VOICE_INTERACTION_COMPLETION_CANCELLED'
  ));
  assert.equal(service.pendingInteractionCompletion, null);
});
