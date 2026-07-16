'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RoboticsCommandQueue,
  ROBOTICS_COMMAND_FAILED_MESSAGE,
  ROBOTICS_PRIORITY
} = require('../src/services/robotics-command-queue');
const {
  enqueueRobotActionEnvelope,
  removeRobotActionEnvelope
} = require('../src/services/robotics-action-inbox');

const flush = () => new Promise((resolve) => globalThis.setImmediate(resolve));

function readyQueue(driver, overrides = {}) {
  return new RoboticsCommandQueue({
    driver,
    deviceId: 'robot-1',
    connectionReady: true,
    loggerImpl: {},
    retryBaseMs: 0,
    sleep: async () => {},
    ...overrides
  });
}

test('Critical commands bypass waiting work and use writeWithoutResponse immediately', async () => {
  const calls = [];
  let acknowledgeStandard;
  const driver = {
    writeCommand: (deviceId, payload, options) => {
      calls.push({ deviceId, options });
      if (options.withResponse) return new Promise((resolve) => { acknowledgeStandard = resolve; });
      return Promise.resolve(true);
    }
  };
  const queue = readyQueue(driver);
  const standard = queue.enqueue({ name: 'navigate_robo_cane', latitude: 1, longitude: 2 });
  await flush();
  const critical = queue.enqueue({ name: 'robot_stop' }, { priority: ROBOTICS_PRIORITY.CRITICAL });
  await critical;
  assert.deepEqual(calls.map((call) => call.options.withResponse), [true, false]);
  acknowledgeStandard(true);
  await standard;
});

test('Standard commands execute sequentially after each simulator acknowledgment', async () => {
  const calls = [];
  const acknowledgments = [];
  const driver = {
    writeCommand: (deviceId, payload, options) => new Promise((resolve) => {
      calls.push({ deviceId, payload, options });
      acknowledgments.push(resolve);
    })
  };
  const queue = readyQueue(driver);
  const first = queue.enqueue({ name: 'navigate_robo_cane', latitude: 1, longitude: 2 });
  const second = queue.enqueue({ name: 'navigate_robo_cane', latitude: 3, longitude: 4 });
  await flush();
  assert.equal(calls.length, 1);
  acknowledgments.shift()(true);
  await first;
  await flush();
  assert.equal(calls.length, 2);
  acknowledgments.shift()(true);
  await second;
  assert.equal(calls.every((call) => call.options.withResponse), true);
});

test('offline Critical and Standard commands are retained and Critical resumes first', async () => {
  const calls = [];
  const driver = { writeCommand: async (deviceId, payload, options) => calls.push(options.withResponse ? 'standard' : 'critical') };
  const queue = new RoboticsCommandQueue({ driver, deviceId: 'robot-1', loggerImpl: {} });
  const standard = queue.enqueue({ name: 'navigate_robo_cane' });
  const critical = queue.enqueue({ name: 'robot_stop' }, { priority: ROBOTICS_PRIORITY.CRITICAL });
  await flush();
  assert.deepEqual(calls, []);
  queue.setConnectionReady(true);
  await Promise.all([critical, standard]);
  assert.deepEqual(calls, ['critical', 'standard']);
});

test('Background work remains paused while a Critical command is in flight', async () => {
  const calls = [];
  let releaseCritical;
  const driver = {
    writeCommand: (deviceId, payload, options) => {
      calls.push(options.withResponse ? 'background' : 'critical');
      if (!options.withResponse) return new Promise((resolve) => { releaseCritical = resolve; });
      return Promise.resolve(true);
    }
  };
  const queue = readyQueue(driver);
  const background = queue.enqueue({ name: 'telemetry_refresh' }, { priority: ROBOTICS_PRIORITY.BACKGROUND });
  const critical = queue.enqueue({ name: 'robot_stop' }, { priority: ROBOTICS_PRIORITY.CRITICAL });
  await flush();
  assert.deepEqual(calls, ['critical']);
  releaseCritical(true);
  await critical;
  await background;
  assert.deepEqual(calls, ['critical', 'background']);
});

test('a mid-write disconnect pauses without burning retries and resumes on reconnection', async () => {
  let attempts = 0;
  const driver = {
    writeCommand: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('socket closed'), { code: 'BLE_CONNECT_FAILED' });
      return true;
    }
  };
  const queue = readyQueue(driver);
  const command = queue.enqueue({ name: 'navigate_robo_cane' });
  await flush();
  await flush();
  assert.equal(queue.connectionReady, false);
  assert.equal(queue.standard.length, 1);
  assert.equal(queue.standard[0].attempts, 0);
  queue.setConnectionReady(true);
  await command;
  assert.equal(attempts, 2);
});

test('NACKs receive three retries, then dead-letter and allow the next command through', async () => {
  const calls = [];
  const failures = [];
  const driver = {
    writeCommand: async (deviceId, payload) => {
      calls.push(payload);
      if (calls.length <= 4) throw Object.assign(new Error('busy'), { code: 'DEVICE_BUSY' });
      return true;
    }
  };
  const queue = readyQueue(driver);
  queue.addFailureListener((failure) => failures.push(failure));
  const doomed = queue.enqueue({ name: 'navigate_robo_cane', latitude: 1, longitude: 2 });
  const next = queue.enqueue({ name: 'find_robot' });
  await assert.rejects(doomed, (error) => error.userMessage === ROBOTICS_COMMAND_FAILED_MESSAGE);
  await next;
  assert.equal(calls.length, 5);
  assert.equal(queue.failed.length, 1);
  assert.equal(queue.failed[0].attempts, 4);
  assert.equal(failures[0].message, ROBOTICS_COMMAND_FAILED_MESSAGE);
});

test('a never-resolving write is bounded, dead-lettered, and cannot stall the next command', async () => {
  let calls = 0;
  const driver = {
    writeCommand: () => {
      calls += 1;
      return calls === 1 ? new Promise(() => {}) : Promise.resolve(true);
    }
  };
  const queue = readyQueue(driver, { maxRetries: 0, writeTimeoutMs: 10 });
  const stalled = queue.enqueue({ name: 'navigate_robo_cane' });
  const next = queue.enqueue({ name: 'find_robot' });
  await assert.rejects(stalled, /timed out/i);
  await next;
  assert.equal(calls, 2);
});

test('clear rejects queued and in-flight work and releases timers/listeners', async () => {
  const driver = { writeCommand: () => new Promise(() => {}) };
  const queue = readyQueue(driver, { writeTimeoutMs: 10000 });
  const inFlight = queue.enqueue({ name: 'navigate_robo_cane' });
  const queued = queue.enqueue({ name: 'find_robot' });
  await flush();
  queue.clear();
  await assert.rejects(inFlight, /cleared/i);
  await assert.rejects(queued, /cleared/i);
  assert.equal(queue.timers.size, 0);
  assert.equal(queue.pendingWaiters.size, 0);
});

test('queued commands are never silently retargeted to a different robot', async () => {
  const queue = new RoboticsCommandQueue({ driver: { writeCommand: async () => true }, deviceId: 'robot-1', loggerImpl: {} });
  const command = queue.enqueue({ name: 'navigate_robo_cane' });
  queue.setDevice('robot-2');
  await assert.rejects(command, (error) => error.code === 'ROBOT_CHANGED');
  assert.equal(queue.failed[0].errorCode, 'ROBOT_CHANGED');
});

test('AppContext robotics inbox preserves burst order, deduplicates, and removes only the handled action', () => {
  const first = { type: 'ROBOT_ACTION', token: 'token-1' };
  const second = { type: 'ROBOT_ACTION', token: 'token-2' };
  let inbox = enqueueRobotActionEnvelope([], first);
  inbox = enqueueRobotActionEnvelope(inbox, second);
  inbox = enqueueRobotActionEnvelope(inbox, first);
  assert.deepEqual(inbox, [first, second]);
  assert.deepEqual(removeRobotActionEnvelope(inbox, first), [second]);
});
