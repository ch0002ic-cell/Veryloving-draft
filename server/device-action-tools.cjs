'use strict';

const ACTION_TOOL_DEFINITIONS = Object.freeze([
  ['deploy_barrier', 'wearable', 'Deploy the paired wearable safety barrier.'],
  ['emit_alarm', 'wearable', 'Sound the paired wearable alarm.'],
  ['stop', 'wearable', 'Immediately stop the paired wearable alarm or active actuator.'],
  ['check_medication', 'home_robot', 'Ask the paired home robot to check the medication schedule.']
]);

const deviceActionSchemas = ACTION_TOOL_DEFINITIONS.map(([name, deviceType, description]) => ({
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
}));

const HELP_DIAL_TOOL_SCHEMA = Object.freeze({
  type: 'function',
  function: {
    name: 'request_help_dial',
    description: 'Open the confirmed emergency-contact help flow when the user reports immediate danger.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {}
    }
  }
});

const AI_ANGEL_TOOL_NAME = 'trigger_ai_angel';
const AI_ANGEL_TOOL_SCHEMA = Object.freeze({
  type: 'function',
  function: {
    name: AI_ANGEL_TOOL_NAME,
    description: 'Start the account-bound AI Angel emergency workflow across paired devices.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      maxProperties: 0,
      properties: {}
    }
  }
});

const DEVICE_ACTION_TOOL_SCHEMAS = Object.freeze([...deviceActionSchemas, HELP_DIAL_TOOL_SCHEMA]);
const ACTION_TOOL_SCHEMAS = Object.freeze([...DEVICE_ACTION_TOOL_SCHEMAS, AI_ANGEL_TOOL_SCHEMA]);

module.exports = {
  ACTION_TOOL_SCHEMAS,
  AI_ANGEL_TOOL_NAME,
  AI_ANGEL_TOOL_SCHEMA,
  DEVICE_ACTION_TOOL_SCHEMAS,
  HELP_DIAL_TOOL_SCHEMA
};
