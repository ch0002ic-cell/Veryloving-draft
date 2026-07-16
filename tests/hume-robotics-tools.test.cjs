'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const { ROBOTICS_TOOL_NAMES } = require('../server/robotics-gateway.cjs');

const originalModuleLoad = Module._load;
Module._load = function loadHumeRoboticsDependency(request, parent, isMain) {
  const isHumeService = parent?.filename.endsWith('/src/services/websocket/hume-evi.js');
  if (isHumeService && request === '../audio') return { audioService: {} };
  if (isHumeService && request === '../../utils/config') return { config: {} };
  if (isHumeService && request === '../../utils/logger') {
    return { logger: { error() {}, voice() {}, warn() {} }, sanitizeUrl: (value) => value };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { HumeEVIService } = require('../src/services/websocket/hume-evi');
Module._load = originalModuleLoad;
const { SimulatedRobot } = require('../src/services/robotics-simulator-server');

test('provisioned Hume robotics tools exactly match gateway names and use strict schemas', async () => {
  const { ROBOTICS_HUME_TOOL_SPECS, VERYLOVING_PROMPT } = await import('../scripts/hume-tool-definitions.mjs');
  const provisionedNames = ROBOTICS_HUME_TOOL_SPECS.map((spec) => spec.definition.name).sort();
  const expectedParameters = {
    navigate_robo_cane: ['latitude', 'longitude', 'reason', 'speed'],
    robot_stop: ['reason'],
    stop_robo_cane: ['reason'],
    find_robot: ['reason'],
    set_robot_speed: ['reason', 'speed']
  };
  assert.deepEqual(provisionedNames, [...ROBOTICS_TOOL_NAMES].sort());
  for (const spec of ROBOTICS_HUME_TOOL_SPECS) {
    const schema = JSON.parse(spec.definition.parameters);
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.ok(Array.isArray(schema.required));
    assert.ok(spec.definition.fallback_content);
    assert.deepEqual(Object.keys(schema.properties).sort(), expectedParameters[spec.definition.name]);
    if (schema.properties.speed) {
      assert.equal(schema.properties.speed.minimum, 0.1);
      assert.equal(schema.properties.speed.maximum, 2);
    }
    assert.equal(schema.properties.reason.maxLength, 120);
  }
  const navigate = ROBOTICS_HUME_TOOL_SPECS.find((spec) => spec.definition.name === 'navigate_robo_cane');
  const navigationSchema = JSON.parse(navigate.definition.parameters);
  assert.deepEqual(navigationSchema.required, ['latitude', 'longitude']);
  assert.equal(navigationSchema.properties.latitude.minimum, -90);
  assert.equal(navigationSchema.properties.longitude.maximum, 180);
  assert.match(VERYLOVING_PROMPT, /Never claim.+robot action occurred unless its tool result confirms completion/i);
});

test('Hume robot action results preserve one tool-call correlation ID', () => {
  const service = new HumeEVIService();
  const sent = [];
  service.socket = { readyState: 1, send: (payload) => sent.push(JSON.parse(payload)) };
  service.chatMetadataReceived = true;
  assert.equal(service.sendRobotActionResult({ id: 'call-1', name: 'navigate_robo_cane' }, true), true);
  assert.equal(service.sendRobotActionFailure({ id: 'call-2', name: 'find_robot' }, { code: 'DEVICE_BUSY' }), true);
  assert.equal(service.sendRobotActionResult({ id: 'call-3', name: 'find_robot', responseRequired: false }, true), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((message) => [message.type, message.tool_call_id]), [
    ['tool_response', 'call-1'],
    ['tool_error', 'call-2']
  ]);
  assert.deepEqual(JSON.parse(sent[0].content), { status: 'completed', action: 'navigate_robo_cane' });
});

test('simulator applies set_robot_speed to realistic movement telemetry', () => {
  const robot = new SimulatedRobot('robot-speed', () => {}, { info() {} });
  robot.execute({ name: 'set_robot_speed', speed: 1.25 });
  assert.equal(robot.commandedSpeed, 1.25);
  assert.throws(() => robot.execute({ name: 'set_robot_speed', speed: 0 }), /between 0\.1 and 2/);
  const startLongitude = robot.telemetry.longitude;
  robot.execute({ name: 'navigate_robo_cane', latitude: robot.telemetry.latitude, longitude: startLongitude + 0.001 });
  robot.tick({ emitTelemetry: false });
  const movedMeters = (robot.telemetry.longitude - startLongitude)
    * 111320
    * Math.cos(robot.telemetry.latitude * Math.PI / 180);
  assert.ok(Math.abs(movedMeters - 0.125) < 0.002);
  assert.equal(robot.telemetry.speed, 1.25);
});
