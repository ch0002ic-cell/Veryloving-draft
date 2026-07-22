import {
  ScenarioEngine,
  type ScenarioOperation,
  type ScenarioOperationResult,
  type ScenarioRuntime,
  type ScenarioRuntimeContext,
  type ScenarioStartRequest
} from '../../orchestration/ScenarioEngine';
import { createDefaultScenarioDefinitions } from '..';

const NOW = 1_750_000_000_000;
const SECRET = 'user-initiated-scenario-tests-need-a-long-secret';

class RecordingRuntime implements ScenarioRuntime {
  readonly calls: ScenarioOperation[] = [];

  async execute(
    operation: ScenarioOperation,
    _context: ScenarioRuntimeContext
  ): Promise<ScenarioOperationResult> {
    this.calls.push(operation);
    if (operation.kind === 'wait_for_signal') {
      return {
        status: 'succeeded',
        data: operation.signal === 'user_response'
          ? { responded: true }
          : { confirmed: true, pillboxApproached: true }
      };
    }
    if (operation.kind === 'device_action') {
      return { status: 'succeeded', data: { delivered: true } };
    }
    return { status: 'succeeded' };
  }
}

function request(
  scenarioId: ScenarioStartRequest['scenarioId'],
  triggerType: string,
  input: Readonly<Record<string, string | number | boolean>> = {}
): ScenarioStartRequest {
  return {
    scenarioId,
    trigger: {
      eventId: `event-${scenarioId}`,
      type: triggerType,
      occurredAt: NOW
    },
    devices: { wearableId: 'wearable-1', homeRobotId: 'robot-1' },
    idempotencyKey: `idempotency-${scenarioId}`,
    input: { userInitiated: true, ...input }
  };
}

function engine(runtime: ScenarioRuntime): ScenarioEngine {
  return new ScenarioEngine({
    definitions: createDefaultScenarioDefinitions(),
    runtime,
    identitySecret: SECRET,
    now: () => NOW
  });
}

describe('user-initiated scenario variants', () => {
  it('keeps a fall practice drill analytics-only and cannot alert or move either device', async () => {
    const runtime = new RecordingRuntime();

    const execution = await engine(runtime).executeScenario(
      'account-1',
      request('fall_detection', 'user_fall_drill')
    );

    expect(execution).toMatchObject({ state: 'completed', definitionVersion: 2 });
    expect(runtime.calls).toEqual([
      expect.objectContaining({
        id: 'fall_practice_analytics',
        kind: 'analytics',
        event: 'fall_practice_completed'
      })
    ]);
    expect(runtime.calls.some((operation) => [
      'device_action',
      'device_action_batch',
      'hume_session',
      'notification',
      'sms'
    ].includes(operation.kind))).toBe(false);
  });

  it('starts a Hume emotional check-in without fabricating wearable health observations', async () => {
    const runtime = new RecordingRuntime();

    const execution = await engine(runtime).executeScenario(
      'account-1',
      request('emotional_check_in', 'user_emotional_check_in', {
        moodKey: 'low',
        reflectionSummary: 'I felt unsettled after lunch.'
      })
    );
    const callIds = runtime.calls.map(({ id }) => id);

    expect(execution).toMatchObject({ state: 'completed', definitionVersion: 3 });
    expect(callIds).toEqual(expect.arrayContaining([
      'hume_calming_session',
      'wait_emotional_checkin_response',
      'play_breathing_audio',
      'emotional_scenario_analytics'
    ]));
    expect(runtime.calls.some(({ kind }) => kind === 'update_state')).toBe(false);
    expect(runtime.calls.some(({ kind }) => kind === 'append_memory')).toBe(false);
    expect(runtime.calls).toContainEqual(expect.objectContaining({
      id: 'hume_calming_session',
      kind: 'hume_session',
      interactionContext: {
        source: 'user_reported',
        mood_key: 'low',
        reflection_summary: 'I felt unsettled after lunch.'
      }
    }));
  });

  it('bypasses wearable step reads and starts robot plus Hume cognitive engagement', async () => {
    const runtime = new RecordingRuntime();

    const execution = await engine(runtime).executeScenario(
      'account-1',
      request('cognitive_engagement', 'user_cognitive_engagement', { activity: 'trivia' })
    );
    const callIds = runtime.calls.map(({ id }) => id);

    expect(execution).toMatchObject({ state: 'completed', definitionVersion: 3 });
    expect(callIds).toEqual(expect.arrayContaining([
      'robot_cognitive_engagement',
      'hume_cognitive_game',
      'wait_cognitive_engagement_response',
      'append_cognitive_response_summary',
      'cognitive_scenario_analytics'
    ]));
    expect(runtime.calls.some(({ kind }) => kind === 'read_state')).toBe(false);
    expect(callIds).not.toContain('query_steps_today');
    expect(runtime.calls).toContainEqual(expect.objectContaining({
      id: 'robot_cognitive_engagement',
      kind: 'device_action',
      parameters: { activity: 'trivia' }
    }));
    expect(runtime.calls).toContainEqual(expect.objectContaining({
      id: 'hume_cognitive_game',
      kind: 'hume_session',
      interactionContext: { source: 'user_selected', activity: 'trivia' }
    }));
  });

  it('rejects unbounded emotional context and unsupported cognitive activities', async () => {
    await expect(engine(new RecordingRuntime()).executeScenario(
      'account-1',
      request('emotional_check_in', 'user_emotional_check_in')
    )).rejects.toThrow('User emotional check-in mood is invalid');

    await expect(engine(new RecordingRuntime()).executeScenario(
      'account-1',
      request('emotional_check_in', 'user_emotional_check_in', { moodKey: 'stressed' })
    )).rejects.toThrow('User emotional check-in mood is invalid');

    await expect(engine(new RecordingRuntime()).executeScenario(
      'account-1',
      request('emotional_check_in', 'user_emotional_check_in', {
        moodKey: 'okay',
        reflectionSummary: 'x'.repeat(281)
      })
    )).rejects.toThrow('User emotional check-in summary is invalid');

    await expect(engine(new RecordingRuntime()).executeScenario(
      'account-1',
      request('cognitive_engagement', 'user_cognitive_engagement', { activity: 'diagnostic_test' })
    )).rejects.toThrow('User cognitive activity is invalid');

    await expect(engine(new RecordingRuntime()).executeScenario(
      'account-1',
      request('cognitive_engagement', 'user_cognitive_engagement')
    )).rejects.toThrow('User cognitive activity is invalid');
  });

  it('does not synthesize a stress value when wearable input is missing', async () => {
    const runtime = new RecordingRuntime();
    await engine(runtime).executeScenario('account-1', {
      ...request('emotional_check_in', 'wearable_stress'),
      input: {}
    });

    expect(runtime.calls.some(({ kind }) => kind === 'update_state')).toBe(false);
    expect(runtime.calls.some(({ kind }) => kind === 'append_memory')).toBe(false);
    expect(runtime.calls).toContainEqual(expect.objectContaining({
      id: 'emotional_signal_unavailable_analytics',
      kind: 'analytics'
    }));
  });

  it('accepts an explicit medication reminder and runs the adherence workflow', async () => {
    const runtime = new RecordingRuntime();

    const execution = await engine(runtime).executeScenario(
      'account-1',
      request('medication_adherence', 'user_medication_reminder')
    );
    const callIds = runtime.calls.map(({ id }) => id);

    expect(execution).toMatchObject({ state: 'completed', definitionVersion: 2 });
    expect(callIds).toEqual(expect.arrayContaining([
      'robot_medication_reminder_action',
      'wait_medication_taken',
      'update_medication_adherence',
      'append_medication_summary',
      'medication_scenario_analytics'
    ]));
    expect(callIds).not.toContain('medication_caregiver_push');
    expect(callIds).not.toContain('medication_caregiver_sms');
  });

  it('increments durable definition versions for every changed workflow', () => {
    const versions = Object.fromEntries(
      createDefaultScenarioDefinitions().map(({ id, version }) => [id, version])
    );

    expect(versions).toMatchObject({
      fall_detection: 2,
      medication_adherence: 2,
      emotional_check_in: 3,
      cognitive_engagement: 3
    });
  });
});
