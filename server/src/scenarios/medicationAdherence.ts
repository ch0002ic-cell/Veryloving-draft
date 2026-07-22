import type {
  ScenarioConditionContext,
  ScenarioDefinition,
  ScenarioOperationResult,
  ScenarioStartRequest,
  ScenarioStepDefinition
} from '../orchestration/ScenarioEngine';

function safeIdentifier(value: unknown, fallback: string, maxLength = 128): string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value) && value.length <= maxLength
    ? value
    : fallback;
}

function confirmed(context: ScenarioConditionContext, key: string): boolean {
  const result: ScenarioOperationResult | undefined = context.results.get(key);
  return result?.status === 'succeeded' && result.data?.confirmed === true;
}

function fallbackExecuted(context: ScenarioConditionContext, key: string): boolean {
  return context.results.get(key)?.data?.fallbackExecuted === true;
}

export const medicationAdherenceScenario: ScenarioDefinition = Object.freeze({
  id: 'medication_adherence',
  version: 2,
  priority: 'standard',
  description: 'Robot reminder is correlated with wearable movement and bounded caregiver escalation.',
  allowedTriggerTypes: Object.freeze(['medication_due', 'user_medication_reminder']),
  buildSteps(request: ScenarioStartRequest) {
    const medicationId = safeIdentifier(request.input?.medicationId, 'scheduled-medication');
    const reminderId = `medication-reminder-${request.trigger.eventId}`.slice(0, 80).padEnd(16, '0');
    const requestedTime = Number(request.input?.scheduledAt);
    const scheduledAt = Number.isSafeInteger(requestedTime)
      && requestedTime > 0
      && Math.abs(requestedTime - request.trigger.occurredAt) <= 5 * 60_000
      ? requestedTime
      : request.trigger.occurredAt;
    const adherenceDeadline = scheduledAt + 15 * 60_000;
    const observedAt = new Date(request.trigger.occurredAt).toISOString();
    const adherenceConfirmed = (context: ScenarioConditionContext): boolean => (
      confirmed(context, 'await_medication_confirmation') || confirmed(context, 'await_late_confirmation')
    );
    const steps: readonly ScenarioStepDefinition[] = [
      {
        id: 'robot_medication_reminder',
        operation: {
          id: 'robot_medication_reminder_action',
          kind: 'device_action',
          target: 'home_robot',
          action: 'medication_reminder',
          parameters: {
            reminder_id: reminderId,
            medication_id: medicationId,
            scheduled_at: scheduledAt
          },
          timeoutMs: 5_000
        },
        fallback: [{
          id: 'reminder_device_failure_push',
          kind: 'notification',
          audience: 'caregiver',
          template: 'medication_robot_unavailable',
          timeoutMs: 2_000
        }],
        continueOnFailure: true
      },
      {
        id: 'await_medication_confirmation',
        operation: {
          id: 'wait_medication_taken',
          kind: 'wait_for_signal',
          signal: 'medication_taken',
          observe: ['pillbox_approach'],
          deadlineAt: adherenceDeadline,
          timeoutMs: 15 * 60_000
        },
        continueOnFailure: true
      },
      {
        id: 'caregiver_push',
        when: (context) => !confirmed(context, 'await_medication_confirmation'),
        operation: {
          id: 'medication_caregiver_push',
          kind: 'notification',
          audience: 'caregiver',
          template: 'medication_not_confirmed',
          timeoutMs: 2_000
        },
        fallback: [{
          id: 'medication_push_failure_sms',
          idempotencyScope: 'medication-escalation-sms',
          kind: 'sms',
          audience: 'caregiver',
          template: 'medication_escalation',
          timeoutMs: 3_000
        }],
        continueOnFailure: true
      },
      {
        id: 'await_late_confirmation',
        when: (context) => !confirmed(context, 'await_medication_confirmation'),
        operation: {
          id: 'wait_late_medication_taken',
          kind: 'wait_for_signal',
          signal: 'medication_taken',
          replayFrom: 'operation_start',
          timeoutMs: 5 * 60_000
        },
        continueOnFailure: true
      },
      {
        id: 'caregiver_sms',
        when: (context) => (
          !confirmed(context, 'await_medication_confirmation')
          && !confirmed(context, 'await_late_confirmation')
          && !fallbackExecuted(context, 'caregiver_push')
        ),
        operation: {
          id: 'medication_caregiver_sms',
          idempotencyScope: 'medication-escalation-sms',
          kind: 'sms',
          audience: 'caregiver',
          template: 'medication_escalation',
          timeoutMs: 3_000
        },
        continueOnFailure: true
      },
      {
        id: 'store_adherence_outcome',
        operation: {
          id: 'update_medication_adherence',
          kind: 'update_state',
          update: (context) => {
            const taken = adherenceConfirmed(context) ? 1 : 0;
            return {
              cognitive: {
                medicationAdherence: {
                  scheduled: 1,
                  taken,
                  missed: 1 - taken,
                  rate: taken,
                  observedAt
                }
              }
            };
          },
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_medication_memory',
        operation: {
          id: 'append_medication_summary',
          kind: 'append_memory',
          memory: (context) => ({
            id: `medication-${request.trigger.eventId}`.slice(0, 128),
            kind: 'health_trend',
            source: 'system',
            metric: 'medication_adherence',
            period: 'weekly',
            periodStart: observedAt,
            periodEnd: observedAt,
            direction: 'stable',
            summary: adherenceConfirmed(context)
              ? 'The scheduled medication was confirmed in the simulated adherence window.'
              : 'The scheduled medication was not confirmed after simulated caregiver escalation.'
          }),
          timeoutMs: 2_000
        },
        continueOnFailure: true
      },
      {
        id: 'record_medication_analytics',
        alwaysRun: true,
        operation: {
          id: 'medication_scenario_analytics',
          kind: 'analytics',
          event: 'medication_adherence_completed',
          timeoutMs: 1_000
        },
        continueOnFailure: true
      }
    ];
    return Object.freeze(steps);
  }
});
