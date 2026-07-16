'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { RoboticsCommandQueue, ROBOTICS_PRIORITY } = require('../src/services/robotics-command-queue');

const flush = () => new Promise((resolve) => globalThis.setImmediate(resolve));

test('Critical commands bypass the queue and execute immediately without response', async () => {
  const calls = [];
  const driver = { writeCommand: async (deviceId, payload, options) => calls.push({ deviceId, payload, options }) };
  const queue = new RoboticsCommandQueue({ driver, deviceId: 'robot-1', loggerImpl: {} });
  await queue.enqueue({ name: 'robot_stop' }, { priority: ROBOTICS_PRIORITY.CRITICAL });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.withResponse, false);
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
  const queue = new RoboticsCommandQueue({ driver, deviceId: 'robot-1', loggerImpl: {} });
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
  const queue = new RoboticsCommandQueue({ driver, deviceId: 'robot-1', loggerImpl: {} });
  const background = queue.enqueue({ name: 'telemetry_refresh' }, { priority: ROBOTICS_PRIORITY.BACKGROUND });
  const critical = queue.enqueue({ name: 'robot_stop' }, { priority: ROBOTICS_PRIORITY.CRITICAL });
  await flush();
  assert.deepEqual(calls, ['critical']);
  releaseCritical(true);
  await critical;
  await background;
  assert.deepEqual(calls, ['critical', 'background']);
});
