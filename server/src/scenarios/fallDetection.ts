import type {
  ScenarioConditionContext,
  ScenarioDefinition,
  ScenarioJson,
  ScenarioOperationResult,
  ScenarioStartRequest,
  ScenarioStepDefinition
} from '../orchestration/ScenarioEngine';

function stringInput(request: ScenarioStartRequest, key: string, fallback: string, maxLength = 96): string {
  const value = request.input?.[key];
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value) && value.length <= maxLength
    ? value
    : fallback;
}

function userResponded(context: ScenarioConditionContext): boolean {
  const result: ScenarioOperationResult | undefined = context.results.get('await_user_response');
  const responded: ScenarioJson | undefined = result?.data?.responded;
  return result?.status === 'succeeded' && responded === true;
}

function fanoutDelivered(context: ScenarioConditionContext, target: 'wearable' | 'robot'): boolean {
  const result = context.results.get('emergency_device_fanout');
  const key = target === 'wearable' ? 'wearableDelivered' : 'robotDelivered';
  return result?.status === 'succeeded' && result.data?.[key] === true;
}

function operationFailed(context: ScenarioConditionContext, id: string): boolean {
  return context.results.get(id)?.status === 'failed';
}

function operationSucceeded(context: ScenarioConditionContext, id: string): boolean {
  return context.results.get(id)?.status === 'succeeded';
}

export const fallDetectionScenario: ScenarioDefinition = Object.freeze({
  id: 'fall_detection',
  version: 1,
  priority: 'critical',
  description: 'Wearable fall event routes a robot check and escalates when no safe response is confirmed.',
  allowedTriggerTypes: Object.freeze(['wearable_fall', 'robot_fall']),
  buildSteps(request: ScenarioStartRequest) {
    const locationRef = stringInput(request, 'locationRef', 'last-known-location');
    const contactId = stringInput(request, 'contactId', 'primary-emergency-contact');
    // Navigation is a physical safety action. Missing or stale safety telemetry
    // must fail closed; only an explicitly authenticated, fresh positive signal
    // may authorize motion.
    const robotSafeToMove = request.input?.robotSafeToMove === true;
    const steps: readonly ScenarioStepDefinition[] = [
      {
        id: 'robot_navigate',
        when: () => robotSafeToMove,
        operation: {
          id: 'robot_navigate_action',
          kind: 'device_action',
          target: 'home_robot',
          action: 'navigate_to_location',
          parameters: { location_ref: locationRef },
          timeoutMs: 5_000
        },
        fallback: [{
          id: 'navigation_failure_alert',
          kind: 'notification',
          audience: 'emergency_contacts',
          template: 'fall_robot_unavailable',
          includeLocation: true,
          timeoutMs: 2_000
        }],
        continueOnFailure: true,
        stopAfterFallback: true
      },
      {
        id: 'unsafe_navigation_alert',
        when: () => !robotSafeToMove,
        operation: {
          id: 'unsafe_navigation_immediate_alert',
          kind: 'notification',
          audience: 'emergency_contacts',
          template: 'fall_robot_unsafe_to_move',
          includeLocation: true,
          timeoutMs: 2_000
        },
        fallback: [{
          id: 'unsafe_navigation_alert_sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'fall_robot_unsafe_to_move',
          includeLocation: true,
          timeoutMs: 3_000
        }],
        continueOnFailure: true,
        stopAfterFallback: true,
        stopAfterSuccess: true
      },
      {
        id: 'navigation_alert_transport_fallback',
        when: (context) => operationFailed(context, 'robot_navigate')
          && context.results.get('robot_navigate')?.data?.fallbackExecuted !== true,
        operation: {
          id: 'navigation_alert_transport_sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'fall_robot_unavailable',
          includeLocation: true,
          timeoutMs: 3_000
        },
        continueOnFailure: true,
        stopAfterSuccess: true
      },
      {
        id: 'empathetic_voice_check',
        operation: {
          id: 'hume_fall_voice_check',
          kind: 'hume_session',
          target: 'home_robot',
          mode: 'voice_check',
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'await_user_response',
        when: (context) => operationSucceeded(context, 'empathetic_voice_check'),
        operation: {
          id: 'wait_fall_user_response',
          kind: 'wait_for_signal',
          signal: 'user_response',
          timeoutMs: 30_000
        },
        continueOnFailure: true
      },
      {
        id: 'emergency_contact_call',
        when: (context) => !userResponded(context),
        operation: {
          id: 'robot_emergency_contact_call',
          kind: 'device_action',
          target: 'home_robot',
          action: 'start_two_way_call',
          parameters: { contact_id: contactId },
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'emergency_device_fanout',
        when: (context) => !userResponded(context),
        operation: {
          id: 'fall_emergency_device_fanout',
          kind: 'device_action_batch',
          actions: [{
            id: 'fall_wearable_sos',
            kind: 'device_action',
            target: 'wearable',
            action: 'trigger_sos',
            parameters: {}
          }, {
            id: 'share_fall_camera',
            kind: 'device_action',
            target: 'home_robot',
            action: 'share_camera_view',
            cameraSessionScope: 'fall-camera-session',
            parameters: {}
          }],
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'emergency_transport_fallback',
        when: (context) => !userResponded(context)
          && (!operationSucceeded(context, 'emergency_contact_call')
            || !fanoutDelivered(context, 'wearable')
            || !fanoutDelivered(context, 'robot')),
        operation: {
          id: 'fall_emergency_transport_sms',
          idempotencyScope: 'fall-emergency-sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'fall_no_response',
          includeLocation: true,
          timeoutMs: 3_000
        },
        continueOnFailure: true
      },
      {
        id: 'escalate_emergency_contacts_with_camera',
        when: (context) => !userResponded(context) && fanoutDelivered(context, 'robot'),
        operation: {
          id: 'fall_emergency_notification',
          kind: 'notification',
          audience: 'emergency_contacts',
          template: 'fall_no_response',
          includeLocation: true,
          includeCameraLink: true,
          cameraSessionScope: 'fall-camera-session',
          timeoutMs: 2_000
        },
        fallback: [{
          id: 'fall_notification_failure_sms',
          idempotencyScope: 'fall-emergency-sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'fall_no_response',
          includeLocation: true,
          timeoutMs: 3_000
        }]
      },
      {
        id: 'escalate_emergency_contacts_without_camera',
        when: (context) => !userResponded(context) && !fanoutDelivered(context, 'robot'),
        operation: {
          id: 'fall_emergency_notification_without_camera',
          kind: 'notification',
          audience: 'emergency_contacts',
          template: 'fall_no_response',
          includeLocation: true,
          includeCameraLink: false,
          timeoutMs: 2_000
        },
        fallback: [{
          id: 'fall_notification_without_camera_failure_sms',
          idempotencyScope: 'fall-emergency-sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'fall_no_response',
          includeLocation: true,
          timeoutMs: 3_000
        }]
      },
      {
        id: 'record_fall_execution',
        alwaysRun: true,
        operation: {
          id: 'fall_scenario_analytics',
          kind: 'analytics',
          event: 'fall_scenario_completed',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      }
    ];
    return Object.freeze(steps);
  }
});
