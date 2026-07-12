export const SAFETY_TIPS_TOOL_NAME = 'get_safety_tips';
export const VALID_SAFETY_SCENARIOS = new Set(['general', 'walking_alone', 'being_followed', 'rideshare', 'meeting_someone']);

const LOCAL_TIPS = {
  general: ['Move toward a well-lit public place.', 'Keep a trusted contact informed.', 'Call local emergency services if danger is immediate.'],
  walking_alone: ['Use populated, well-lit streets.', 'Share your route with someone you trust.', 'Keep your phone easy to reach.'],
  being_followed: ['Do not go home; enter a staffed public place.', 'Call someone you trust and describe your location.', 'Call local emergency services if the person approaches.'],
  rideshare: ['Match the driver, plate, and vehicle.', 'Share the trip status with a trusted contact.', 'Leave in a safe public place if the route feels wrong.'],
  meeting_someone: ['Meet in public.', 'Keep control of your transportation and phone.', 'Leave if your boundaries are ignored.']
};

export function parseSafetyToolParameters(raw) {
  let parameters;
  try {
    parameters = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    throw new Error('Safety tool parameters were invalid.');
  }
  return { scenario: VALID_SAFETY_SCENARIOS.has(parameters?.scenario) ? parameters.scenario : 'general' };
}

export function localSafetyToolResult(scenario) {
  const normalized = VALID_SAFETY_SCENARIOS.has(scenario) ? scenario : 'general';
  return {
    scenario: normalized,
    tips: LOCAL_TIPS[normalized],
    emergencyReminder: 'If danger is immediate, call local emergency services.',
    source: 'offline_curated'
  };
}
