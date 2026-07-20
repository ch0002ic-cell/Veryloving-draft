import type {
  ScenarioConditionContext,
  ScenarioDefinition,
  ScenarioStartRequest,
  ScenarioStepDefinition
} from '../orchestration/ScenarioEngine';

function fanoutDelivered(context: ScenarioConditionContext, target: 'wearable' | 'robot'): boolean {
  const result = context.results.get('emergency_device_fanout');
  const key = target === 'wearable' ? 'wearableDelivered' : 'robotDelivered';
  return result?.status === 'succeeded' && result.data?.[key] === true;
}

function safeContact(request: ScenarioStartRequest): string {
  const value = request.input?.contactId;
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(value)
    ? value
    : 'primary-emergency-contact';
}

export const aiAngelAutoDialScenario: ScenarioDefinition = Object.freeze({
  id: 'ai_angel_auto_dial',
  version: 1,
  priority: 'critical',
  description: 'Emergency trigger coordinates wearable SOS, robot room context, and an SMS location fallback.',
  allowedTriggerTypes: Object.freeze(['panic_button', 'voice_emergency', 'robot_help_request']),
  buildSteps(request: ScenarioStartRequest) {
    const contactId = safeContact(request);
    const steps: readonly ScenarioStepDefinition[] = [
      {
        id: 'emergency_device_fanout',
        operation: {
          id: 'ai_angel_emergency_device_fanout',
          kind: 'device_action_batch',
          actions: [{
            id: 'wearable_trigger_sos',
            kind: 'device_action',
            target: 'wearable',
            action: 'trigger_sos',
            parameters: {}
          }, {
            id: 'robot_share_camera',
            kind: 'device_action',
            target: 'home_robot',
            action: 'share_camera_view',
            cameraSessionScope: 'ai-angel-camera-session',
            parameters: {}
          }],
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'emergency_transport_fallback',
        when: (context) => !fanoutDelivered(context, 'wearable') || !fanoutDelivered(context, 'robot'),
        operation: {
          id: 'ai_angel_transport_sms',
          idempotencyScope: 'ai-angel-emergency-sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'ai_angel_wifi_unavailable',
          includeLocation: true,
          timeoutMs: 3_000
        },
        continueOnFailure: true
      },
      {
        id: 'robot_two_way_call',
        operation: {
          id: 'robot_emergency_call',
          kind: 'device_action',
          target: 'home_robot',
          action: 'start_two_way_call',
          parameters: { contact_id: contactId },
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'hume_emergency_session',
        operation: {
          id: 'hume_emergency_call',
          kind: 'hume_session',
          target: 'home_robot',
          mode: 'emergency_call',
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'emergency_contact_alert_with_camera',
        when: (context) => fanoutDelivered(context, 'robot'),
        operation: {
          id: 'ai_angel_contact_notification',
          kind: 'notification',
          audience: 'emergency_contacts',
          template: 'ai_angel_emergency_active',
          includeLocation: true,
          includeCameraLink: true,
          cameraSessionScope: 'ai-angel-camera-session',
          timeoutMs: 2_000
        },
        fallback: [{
          id: 'ai_angel_push_failure_sms',
          idempotencyScope: 'ai-angel-emergency-sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'ai_angel_emergency_active',
          includeLocation: true,
          timeoutMs: 3_000
        }]
      },
      {
        id: 'emergency_contact_alert_without_camera',
        when: (context) => !fanoutDelivered(context, 'robot'),
        operation: {
          id: 'ai_angel_contact_notification_without_camera',
          kind: 'notification',
          audience: 'emergency_contacts',
          template: 'ai_angel_emergency_active',
          includeLocation: true,
          includeCameraLink: false,
          timeoutMs: 2_000
        },
        fallback: [{
          id: 'ai_angel_push_without_camera_failure_sms',
          idempotencyScope: 'ai-angel-emergency-sms',
          kind: 'sms',
          audience: 'emergency_contacts',
          template: 'ai_angel_emergency_active',
          includeLocation: true,
          timeoutMs: 3_000
        }]
      },
      {
        id: 'record_ai_angel_analytics',
        alwaysRun: true,
        operation: {
          id: 'ai_angel_scenario_analytics',
          kind: 'analytics',
          event: 'ai_angel_auto_dial_completed',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      }
    ];
    return Object.freeze(steps);
  }
});
