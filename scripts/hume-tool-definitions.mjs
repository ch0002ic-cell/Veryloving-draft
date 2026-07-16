function parameters(properties, required = []) {
  return JSON.stringify({
    type: 'object',
    additionalProperties: false,
    properties,
    required
  });
}

function reason(description = 'Short reason for the robot action.') {
  return { type: 'string', maxLength: 120, description };
}

export const VERYLOVING_PROMPT = `You are VeryLoving, a warm personal-safety companion. Be calm, concise, emotionally attuned, and practical. Never claim an emergency or robot action occurred unless its tool result confirms completion. Encourage local emergency services when danger is immediate. Use get_safety_tips for non-urgent practical safety guidance. Use robot_stop immediately when a moving robot creates a safety risk. Use navigation, finder, normal stop, and speed tools only when the user clearly requests the corresponding robot action. Treat coordinates as sensitive and never repeat them aloud unless the user explicitly asks.`;

export const HUME_TOOL_SPECS = Object.freeze([
  {
    environmentVariable: 'HUME_SAFETY_TOOL_ID',
    legacyEnvironmentVariable: 'HUME_TOOL_ID',
    definition: {
      name: 'get_safety_tips',
      description: 'Returns practical safety tips for the user current situation.',
      fallback_content: 'Safety tips are temporarily unavailable. Offer calm, general safety guidance instead.',
      version_description: 'VeryLoving safety guidance tool.',
      parameters: parameters({
        scenario: {
          type: 'string',
          enum: ['general', 'walking_alone', 'being_followed', 'rideshare', 'meeting_someone'],
          description: 'The safety scenario that best matches the user request.'
        }
      }, ['scenario'])
    }
  },
  {
    environmentVariable: 'HUME_NAVIGATE_ROBO_CANE_TOOL_ID',
    definition: {
      name: 'navigate_robo_cane',
      description: 'Navigates the connected robo-cane to an explicitly requested geographic destination.',
      fallback_content: 'I could not safely start robot navigation. Ask the user to retry.',
      version_description: 'Signed VeryLoving robot navigation action.',
      parameters: parameters({
        latitude: {
          type: 'number',
          minimum: -90,
          maximum: 90,
          description: 'Destination latitude in decimal degrees.'
        },
        longitude: {
          type: 'number',
          minimum: -180,
          maximum: 180,
          description: 'Destination longitude in decimal degrees.'
        },
        speed: {
          type: 'number',
          minimum: 0.1,
          maximum: 2,
          description: 'Optional travel speed in meters per second.'
        },
        reason: reason('Short user-provided reason for starting navigation.')
      }, ['latitude', 'longitude'])
    }
  },
  {
    environmentVariable: 'HUME_ROBOT_STOP_TOOL_ID',
    definition: {
      name: 'robot_stop',
      description: 'Immediately activates the critical STOP safety interlock for the connected robot.',
      fallback_content: 'I could not confirm the emergency robot stop. Tell the user to use the physical stop control.',
      version_description: 'Critical VeryLoving robot STOP action.',
      parameters: parameters({
        reason: reason('Short safety reason for the stop.')
      })
    }
  },
  {
    environmentVariable: 'HUME_STOP_ROBO_CANE_TOOL_ID',
    definition: {
      name: 'stop_robo_cane',
      description: 'Stops the connected robo-cane when the user asks it to stop normal movement.',
      fallback_content: 'I could not confirm that the robo-cane stopped. Tell the user to use the physical stop control.',
      version_description: 'VeryLoving robo-cane stop action.',
      parameters: parameters({
        reason: reason('Short reason for stopping movement.')
      })
    }
  },
  {
    environmentVariable: 'HUME_FIND_ROBOT_TOOL_ID',
    definition: {
      name: 'find_robot',
      description: 'Activates the connected robot audible finder when the user cannot locate it.',
      fallback_content: 'I could not activate the robot finder. Ask the user to check the robot connection.',
      version_description: 'VeryLoving audible robot finder action.',
      parameters: parameters({
        reason: reason('Short reason the user wants to locate the robot.')
      })
    }
  },
  {
    environmentVariable: 'HUME_SET_ROBOT_SPEED_TOOL_ID',
    definition: {
      name: 'set_robot_speed',
      description: 'Changes the connected robot travel speed when the user requests a specific safe speed.',
      fallback_content: 'I could not confirm the robot speed change. Ask the user to retry.',
      version_description: 'VeryLoving robot speed action.',
      parameters: parameters({
        speed: {
          type: 'number',
          minimum: 0.1,
          maximum: 2,
          description: 'Requested speed in meters per second.'
        },
        reason: reason('Short user-provided reason for changing speed.')
      }, ['speed'])
    }
  }
]);

export const ROBOTICS_HUME_TOOL_SPECS = Object.freeze(
  HUME_TOOL_SPECS.filter((spec) => spec.definition.name !== 'get_safety_tips')
);
