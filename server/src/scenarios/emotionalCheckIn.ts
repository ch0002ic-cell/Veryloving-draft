import type {
  ScenarioConditionContext,
  ScenarioDefinition,
  ScenarioStartRequest,
  ScenarioStepDefinition
} from '../orchestration/ScenarioEngine';

function userResponded(context: ScenarioConditionContext): boolean {
  const result = context.results.get('await_checkin_response');
  return result?.status === 'succeeded' && result.data?.responded === true;
}

function conversationStarted(context: ScenarioConditionContext): boolean {
  return context.results.get('start_calming_conversation')?.status === 'succeeded';
}

function observerConfirmedNoResponse(context: ScenarioConditionContext): boolean {
  const result = context.results.get('await_checkin_response');
  return (result?.status === 'succeeded' || result?.status === 'not_found')
    && result.data?.responded === false;
}

function stressScore(request: ScenarioStartRequest): number {
  const value = Number(request.input?.stressScore);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 70;
}

export const emotionalCheckInScenario: ScenarioDefinition = Object.freeze({
  id: 'emotional_check_in',
  version: 1,
  priority: 'standard',
  description: 'Elevated wearable stress signal starts a consent-aware Hume check-in and records a bounded trend event.',
  allowedTriggerTypes: Object.freeze(['wearable_stress']),
  buildSteps(request: ScenarioStartRequest) {
    const score = stressScore(request);
    const observedAt = new Date(request.trigger.occurredAt).toISOString();
    const memoryId = `stress-${request.trigger.eventId}`.slice(0, 128);
    const steps: readonly ScenarioStepDefinition[] = [
      {
        id: 'start_calming_conversation',
        operation: {
          id: 'hume_calming_session',
          kind: 'hume_session',
          target: 'home_robot',
          mode: 'calming',
          timeoutMs: 5_000
        },
        fallback: [{
          id: 'schedule_later_checkin',
          kind: 'notification',
          audience: 'user',
          template: 'emotional_checkin_later',
          timeoutMs: 2_000
        }],
        continueOnFailure: true
      },
      {
        id: 'await_checkin_response',
        when: conversationStarted,
        operation: {
          id: 'wait_emotional_checkin_response',
          kind: 'wait_for_signal',
          signal: 'user_response',
          timeoutMs: 30_000
        },
        continueOnFailure: true
      },
      {
        id: 'schedule_unanswered_checkin',
        when: (context) => conversationStarted(context) && observerConfirmedNoResponse(context),
        operation: {
          id: 'schedule_unanswered_emotional_checkin',
          kind: 'notification',
          audience: 'user',
          template: 'emotional_checkin_later',
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'breathing_audio',
        when: userResponded,
        operation: {
          id: 'play_breathing_audio',
          kind: 'device_action',
          target: 'home_robot',
          action: 'play_soothing_audio',
          parameters: { audio_id: 'guided-breathing', volume: 35 },
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'update_emotional_state',
        operation: {
          id: 'store_stress_checkin',
          kind: 'update_state',
          update: { emotional: { stressScore: { value: score, observedAt } } },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_emotional_memory',
        operation: {
          id: 'append_emotional_summary',
          kind: 'append_memory',
          memory: {
            id: memoryId,
            kind: 'health_trend',
            source: 'wearable',
            metric: 'stress_score',
            period: 'weekly',
            periodStart: observedAt,
            periodEnd: observedAt,
            direction: 'stable',
            summary: score >= 80
              ? 'A high simulated stress signal prompted an emotional check-in.'
              : 'An elevated simulated stress signal prompted an emotional check-in.'
          },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_emotional_analytics',
        alwaysRun: true,
        operation: {
          id: 'emotional_scenario_analytics',
          kind: 'analytics',
          event: 'emotional_checkin_completed',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      }
    ];
    return Object.freeze(steps);
  }
});
