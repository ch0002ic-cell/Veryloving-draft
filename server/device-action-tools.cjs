'use strict';

const ACTION_TOOL_DEFINITIONS = Object.freeze([
  ['deploy_barrier', 'wearable', 'Deploy the paired wearable safety barrier.'],
  ['emit_alarm', 'wearable', 'Sound the paired wearable alarm.'],
  ['check_medication', 'home_robot', 'Ask the paired home robot to check the medication schedule.']
]);

const ACTION_TOOL_SCHEMAS = Object.freeze(ACTION_TOOL_DEFINITIONS.map(([name, deviceType, description]) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['device_type', 'device_id'],
      properties: {
        device_type: { type: 'string', enum: [deviceType] },
        device_id: { type: 'string', minLength: 1, maxLength: 128 },
        parameters: deviceType === 'wearable'
          ? { type: 'object', additionalProperties: false, maxProperties: 0 }
          : {
              type: 'object',
              additionalProperties: false,
              properties: {
                medication_id: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9._:-]+$' }
              }
            }
      }
    }
  }
})));

module.exports = { ACTION_TOOL_SCHEMAS };
