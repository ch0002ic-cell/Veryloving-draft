'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fragmentPayload, encodeRoboticsCommand } = require('../src/services/robotics-mock-driver');
const { SimulatedRobot } = require('../src/services/robotics-simulator-server');

test('a 150-byte payload is split into 18-byte chunks and reassembled by the mock server', () => {
  const action = { name: 'navigate_robo_cane', latitude: 1.3521, longitude: 103.8198 };
  const encoded = encodeRoboticsCommand(action);
  assert.ok(encoded.length < 150);
  const payload = Uint8Array.from([...encoded, ...new Uint8Array(150 - encoded.length).fill(0x20)]);
  const fragments = fragmentPayload(payload);
  assert.equal(payload.length, 150);
  assert.equal(fragments.length, 9);
  assert.equal(fragments.slice(0, -1).every((fragment) => fragment.length === 20), true);
  assert.equal(fragments.at(-1).length, 8);

  let executed;
  const robot = new SimulatedRobot('robot-1', () => {}, { info() {} });
  robot.execute = (nextAction) => { executed = nextAction; };
  const client = { _roboticsClientId: 'test-client' };
  fragments.forEach((fragment, index) => {
    const result = robot.acceptFragment(client, {
      commandId: '150-byte-command',
      value: Buffer.from(fragment).toString('base64')
    });
    assert.equal(result.complete, index === fragments.length - 1);
  });
  assert.deepEqual(executed, action);
});
