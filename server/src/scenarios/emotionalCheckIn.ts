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

const USER_MOODS = new Set(['very_low', 'low', 'okay', 'good', 'great']);
const MAX_REFLECTION_SUMMARY_LENGTH = 280;

function stressScore(request: ScenarioStartRequest): number | undefined {
  const value = Number(request.input?.stressScore);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : undefined;
}

function validateUserContext(request: ScenarioStartRequest): void {
  if (request.trigger.type !== 'user_emotional_check_in') return;
  const moodKey = request.input?.moodKey;
  const summary = request.input?.reflectionSummary;
  if (typeof moodKey !== 'string' || !USER_MOODS.has(moodKey)) {
    throw new TypeError('User emotional check-in mood is invalid');
  }
  if (summary !== undefined && (
    typeof summary !== 'string'
    || !summary.trim()
    || summary !== summary.replace(/\s+/g, ' ').trim()
    || summary.length > MAX_REFLECTION_SUMMARY_LENGTH
  )) {
    throw new TypeError('User emotional check-in summary is invalid');
  }
}

export const emotionalCheckInScenario: ScenarioDefinition = Object.freeze({
  id: 'emotional_check_in',
  version: 3,
  priority: 'standard',
  description: 'A wearable stress signal or explicit user request starts a consent-aware Hume check-in.',
  allowedTriggerTypes: Object.freeze(['wearable_stress', 'user_emotional_check_in']),
  buildSteps(request: ScenarioStartRequest) {
    const userInitiated = request.trigger.type === 'user_emotional_check_in';
    validateUserContext(request);
    const moodKey = typeof request.input?.moodKey === 'string' ? request.input.moodKey : undefined;
    const reflectionSummary = typeof request.input?.reflectionSummary === 'string'
      ? request.input.reflectionSummary
      : undefined;
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
          ...(userInitiated && (moodKey || reflectionSummary) ? {
            interactionContext: {
              source: 'user_reported',
              ...(moodKey ? { mood_key: moodKey } : {}),
              ...(reflectionSummary ? { reflection_summary: reflectionSummary } : {})
            }
          } : {}),
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
      ...(score === undefined || userInitiated ? [] : [{
        id: 'update_emotional_state',
        operation: {
          id: 'store_stress_checkin',
          kind: 'update_state',
          update: { emotional: { stressScore: { value: score, observedAt } } },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      } as const]),
      ...(score === undefined || userInitiated ? [] : [{
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
      } as const]),
      ...(score !== undefined || userInitiated ? [] : [{
        id: 'record_emotional_signal_unavailable',
        operation: {
          id: 'emotional_signal_unavailable_analytics',
          kind: 'analytics',
          event: 'emotional_stress_signal_unavailable',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      } as const]),
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
