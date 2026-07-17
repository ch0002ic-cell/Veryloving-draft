'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BaseDevice, DEVICE_TYPES } = require('../src/services/device-manager/BaseDevice');
const { DeviceRegistry } = require('../src/services/device-manager/DeviceRegistry');
const { HomeRobotDevice } = require('../src/services/device-manager/HomeRobotDevice');

class TestDevice extends BaseDevice {
  async connect() { return this.setStatus({ online: true }); }
  async disconnect() { return this.setStatus({ online: false }); }
  async sendCommand(command) { return command; }
}

test('DeviceRegistry rejects non-devices and duplicate identities', () => {
  const registry = new DeviceRegistry();
  const device = new TestDevice({ deviceId: 'wearable-1', deviceType: DEVICE_TYPES.wearable });
  assert.throws(() => registry.register({ deviceId: 'bad' }), /BaseDevice/);
  assert.equal(registry.register(device), device);
  assert.throws(() => registry.register(device), /already registered/);
});

test('DeviceRegistry filters devices by type and online status', async () => {
  const registry = new DeviceRegistry();
  const wearable = registry.register(new TestDevice({ deviceId: 'w1', deviceType: DEVICE_TYPES.wearable }));
  registry.register(new TestDevice({ deviceId: 'r1', deviceType: DEVICE_TYPES.homeRobot }));
  await wearable.connect();
  assert.deepEqual(registry.list({ deviceType: 'wearable', online: true }), [wearable]);
});

test('HomeRobotDevice serializes commands through the backend relay', async () => {
  const bodies = [];
  const robot = new HomeRobotDevice({
    deviceId: 'robot-1', gatewayURL: 'https://api.example.test', accessToken: 'session',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return { ok: true, status: 202, json: async () => ({ accepted: true }) };
    }
  });
  await Promise.all([robot.sendCommand({ type: 'first' }), robot.sendCommand({ type: 'second' })]);
  assert.deepEqual(bodies.map((body) => body.command.type), ['first', 'second']);
});
