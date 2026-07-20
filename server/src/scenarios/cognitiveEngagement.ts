import type {
  ScenarioConditionContext,
  ScenarioDefinition,
  ScenarioStartRequest,
  ScenarioStepDefinition
} from '../orchestration/ScenarioEngine';

function userResponded(context: ScenarioConditionContext): boolean {
  const result = context.results.get('await_cognitive_response');
  return result?.status === 'succeeded' && result.data?.responded === true;
}

function observerConfirmedNoResponse(context: ScenarioConditionContext): boolean {
  const result = context.results.get('await_cognitive_response');
  return (result?.status === 'succeeded' || result?.status === 'not_found')
    && result.data?.responded === false;
}

function responseObserverUnavailable(context: ScenarioConditionContext): boolean {
  const result = context.results.get('await_cognitive_response');
  return result !== undefined
    && result.status !== 'succeeded'
    && !(result.status === 'not_found' && result.data?.responded === false);
}

function observedSteps(context: ScenarioConditionContext): number | undefined {
  const result = context.results.get('read_step_state');
  const value = result?.data?.value;
  return result?.status === 'succeeded' && typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(200_000, Math.round(value))
    : undefined;
}

function lowActivity(context: ScenarioConditionContext): boolean {
  const steps = observedSteps(context);
  return steps !== undefined && steps < 500;
}

function operationSucceeded(context: ScenarioConditionContext, stepId: string): boolean {
  return context.results.get(stepId)?.status === 'succeeded';
}

export const cognitiveEngagementScenario: ScenarioDefinition = Object.freeze({
  id: 'cognitive_engagement',
  version: 1,
  priority: 'background',
  description: 'Low morning movement prompts a gentle activity or game and records only a bounded response summary.',
  allowedTriggerTypes: Object.freeze(['bedroom_inactivity']),
  buildSteps(request: ScenarioStartRequest) {
    const observedAt = new Date(request.trigger.occurredAt).toISOString();
    const scenarioSteps: readonly ScenarioStepDefinition[] = [
      {
        id: 'read_step_state',
        operation: {
          id: 'query_steps_today',
          kind: 'read_state',
          selector: 'steps_today',
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'suggest_activity',
        when: lowActivity,
        operation: {
          id: 'robot_cognitive_engagement',
          kind: 'device_action',
          target: 'home_robot',
          action: 'cognitive_engagement',
          parameters: { activity: 'memory_game' },
          timeoutMs: 5_000
        },
        fallback: [{
          id: 'activity_prompt_later',
          kind: 'notification',
          audience: 'user',
          template: 'cognitive_activity_later',
          timeoutMs: 2_000
        }],
        continueOnFailure: true
      },
      {
        id: 'start_cognitive_game',
        when: lowActivity,
        operation: {
          id: 'hume_cognitive_game',
          kind: 'hume_session',
          target: 'home_robot',
          mode: 'cognitive_game',
          timeoutMs: 5_000
        },
        continueOnFailure: true
      },
      {
        id: 'await_cognitive_response',
        when: (context) => lowActivity(context)
          && operationSucceeded(context, 'suggest_activity')
          && operationSucceeded(context, 'start_cognitive_game'),
        operation: {
          id: 'wait_cognitive_engagement_response',
          kind: 'wait_for_signal',
          signal: 'user_response',
          timeoutMs: 30_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_cognitive_typical_pattern',
        when: (context) => observedSteps(context) !== undefined && !lowActivity(context),
        operation: {
          id: 'append_cognitive_summary',
          kind: 'append_memory',
          memory: {
            id: `cognitive-${request.trigger.eventId}`.slice(0, 128),
            kind: 'health_trend',
            source: 'home_robot',
            metric: 'cognitive_engagement',
            period: 'weekly',
            periodStart: observedAt,
            periodEnd: observedAt,
            direction: 'stable',
            summary: 'Simulated morning activity was within the configured engagement band.'
          },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_cognitive_response',
        when: (context) => lowActivity(context)
          && operationSucceeded(context, 'suggest_activity')
          && operationSucceeded(context, 'start_cognitive_game')
          && userResponded(context),
        operation: {
          id: 'append_cognitive_response_summary',
          kind: 'append_memory',
          memory: {
            id: `cognitive-response-${request.trigger.eventId}`.slice(0, 128),
            kind: 'health_trend',
            source: 'home_robot',
            metric: 'cognitive_engagement',
            period: 'weekly',
            periodStart: observedAt,
            periodEnd: observedAt,
            direction: 'stable',
            summary: 'Low simulated activity prompted a cognitive engagement and received a response.'
          },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_cognitive_no_response',
        when: (context) => lowActivity(context)
          && operationSucceeded(context, 'suggest_activity')
          && operationSucceeded(context, 'start_cognitive_game')
          && observerConfirmedNoResponse(context),
        operation: {
          id: 'append_cognitive_no_response_summary',
          kind: 'append_memory',
          memory: {
            id: `cognitive-no-response-${request.trigger.eventId}`.slice(0, 128),
            kind: 'health_trend',
            source: 'home_robot',
            metric: 'cognitive_engagement',
            period: 'weekly',
            periodStart: observedAt,
            periodEnd: observedAt,
            // One observation is not a clinical trend. Trend direction is only
            // derived by the longitudinal analysis layer across multiple windows.
            direction: 'stable',
            summary: 'Low simulated activity prompted engagement and the observer explicitly reported no response.'
          },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_cognitive_observer_unavailable',
        when: (context) => lowActivity(context)
          && operationSucceeded(context, 'suggest_activity')
          && operationSucceeded(context, 'start_cognitive_game')
          && responseObserverUnavailable(context),
        operation: {
          id: 'cognitive_response_observer_unavailable_analytics',
          kind: 'analytics',
          event: 'cognitive_response_observer_unavailable',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_cognitive_signal_unavailable',
        when: (context) => observedSteps(context) === undefined,
        operation: {
          id: 'cognitive_signal_unavailable_analytics',
          kind: 'analytics',
          event: 'cognitive_steps_unavailable',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_cognitive_analytics',
        alwaysRun: true,
        operation: {
          id: 'cognitive_scenario_analytics',
          kind: 'analytics',
          event: 'cognitive_engagement_completed',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      }
    ];
    return Object.freeze(scenarioSteps);
  }
});
