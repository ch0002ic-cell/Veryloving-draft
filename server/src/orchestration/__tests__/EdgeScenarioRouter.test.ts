import {
  EdgeScenarioRouter,
  EdgeScenarioRouterError,
  type EdgeDeviceBinding
} from '../EdgeScenarioRouter';
import { RobotEdgeAI, createRobotSeededRandom } from '../../edge/RobotEdgeAI';
import { WearableEdgeAI, createWearableSeededRandom } from '../../edge/WearableEdgeAI';
import type { ScenarioStartResult } from '../ScenarioEngine';

const NOW = 1_750_000_000_000;
const BINDING: EdgeDeviceBinding = {
  targets: { wearableId: 'wearable-1', homeRobotId: 'robot-1' },
  wearableSourceRef: 'wearable-1',
  homeRobotSourceRef: 'robot-1'
};

function accepted(index: number): ScenarioStartResult {
  return {
    accepted: true,
    duplicate: false,
    execution: {
      schemaVersion: 1,
      definitionVersion: 1,
      identityKeyVersion: 1,
      executionId: `execution-${index}`,
      accountRef: 'opaque-account',
      scenarioId: 'fall_detection',
      triggerRef: 'opaque-trigger',
      idempotencyRef: 'opaque-idempotency',
      requestRef: 'opaque-request',
      priority: 'critical',
      state: 'queued',
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
      deviceReferences: {},
      steps: []
    }
  };
}

function createHarness() {
  const requests: Array<Record<string, unknown>> = [];
  const cancellations: string[] = [];
  const executions: Array<{ executionId: string; priority: 'critical'; state: string }> = [];
  const scenarioEngine = {
    startScenario: jest.fn(async (_accountId: string, scenarioRequest: Record<string, unknown>) => {
      requests.push(scenarioRequest);
      return accepted(requests.length);
    }),
    listExecutions: jest.fn(async () => executions),
    getExecution: jest.fn(async (_accountId: string, executionId: string) => (
      executions.find((execution) => execution.executionId === executionId)
    )),
    cancelScenario: jest.fn(async (_accountId: string, executionId: string) => {
      cancellations.push(executionId);
      return { executionId };
    })
  };
  const router = new EdgeScenarioRouter({ scenarioEngine, now: () => NOW });
  return { router, requests, cancellations, executions, scenarioEngine };
}

describe('EdgeScenarioRouter', () => {
  it('turns a wearable fall inference into exactly one stable critical workflow', async () => {
    const { router, requests } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(7) });
    const inference = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 10, profile: 'fall' }));

    const first = await router.ingestWearableInference('account-1', inference, BINDING, {
      locationRef: 'bedroom-zone', contactId: 'caregiver-1'
    });
    await router.ingestWearableInference('account-1', inference, BINDING);

    expect(first.started).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      scenarioId: 'fall_detection',
      trigger: { type: 'wearable_fall', occurredAt: NOW },
      devices: BINDING.targets,
      input: { locationRef: 'bedroom-zone', contactId: 'caregiver-1' }
    });
    expect(requests).toHaveLength(1);
    expect(first).toEqual(await router.ingestWearableInference('account-1', inference, BINDING));
  });

  it('suppresses a wellness check during a fall and otherwise routes elevated stress', async () => {
    const { router, requests } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(11) });
    const stressed = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 11, profile: 'stressed' }));
    await router.ingestWearableInference('account-1', stressed, BINDING);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      scenarioId: 'emotional_check_in',
      trigger: { type: 'wearable_stress' },
      input: { stressScore: stressed.inference.stressScore }
    });
  });

  it('does nothing for a normal wearable inference', async () => {
    const { router, requests } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(13) });
    const normal = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 12, profile: 'resting' }));

    await expect(router.ingestWearableInference('account-1', normal, BINDING)).resolves.toEqual({ started: [] });
    expect(requests).toHaveLength(0);
  });

  it.each([
    ['fall', 'fall_detection', 'robot_fall'],
    ['help_request', 'ai_angel_auto_dial', 'robot_help_request']
  ] as const)('routes robot %s inference to %s', async (profile, scenarioId, triggerType) => {
    const { router, requests } = createHarness();
    const edge = new RobotEdgeAI({ clockNow: () => NOW, random: createRobotSeededRandom(17) });
    const inference = edge.infer(edge.generateFrame({ deviceRef: 'robot-1', sequence: 20, profile }));

    await router.ingestRobotInference('account-1', inference, BINDING);

    expect(requests[0]).toMatchObject({ scenarioId, trigger: { type: triggerType } });
  });

  it('prioritizes a simultaneous robot fall over an unauthenticated local cancel intent', async () => {
    const { router, requests } = createHarness();
    const edge = new RobotEdgeAI({ clockNow: () => NOW, random: createRobotSeededRandom(181) });
    const frame = edge.generateFrame({ deviceRef: 'robot-1', sequence: 22, profile: 'fall' });
    const inference = edge.infer({
      ...frame,
      audio: { ...frame.audio, voiceActivity: true, keyword: 'stop' }
    });
    expect(inference.inference).toMatchObject({
      vision: { fallDetected: true },
      voice: { intent: 'cancel' }
    });

    await expect(router.ingestRobotInference('account-1', inference, BINDING)).resolves.toMatchObject({
      started: [expect.objectContaining({ accepted: true })]
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ scenarioId: 'fall_detection', trigger: { type: 'robot_fall' } });
  });

  it('requires explicit authenticated confirmation before a local cancel intent stops a workflow', async () => {
    const { router, cancellations, executions } = createHarness();
    executions.push(
      { executionId: 'active-critical', priority: 'critical', state: 'running' },
      { executionId: 'terminal-critical', priority: 'critical', state: 'completed' }
    );
    const edge = new RobotEdgeAI({ clockNow: () => NOW, random: createRobotSeededRandom(19) });
    const frame = edge.generateFrame({ deviceRef: 'robot-1', sequence: 21, profile: 'help_request' });
    const cancelFrame = {
      ...frame,
      audio: { ...frame.audio, voiceActivity: true as const, keyword: 'stop' as const }
    };
    const cancellation = edge.infer(cancelFrame);

    await expect(router.ingestRobotInference('account-1', cancellation, BINDING)).resolves.toMatchObject({
      started: [], cancellationRequested: true
    });
    expect(cancellations).toEqual([]);
    await expect(router.confirmCancellation('account-1', 'active-critical', {
      confirmed: true,
      source: 'authenticated_user',
      occurredAt: NOW
    })).resolves.toMatchObject({ executionId: 'active-critical' });
    expect(cancellations).toEqual(['active-critical']);
  });

  it('keeps wearable and robot episode sources distinct when vendor identifiers collide', async () => {
    let now = NOW;
    const { scenarioEngine } = createHarness();
    const router = new EdgeScenarioRouter({
      scenarioEngine,
      now: () => now,
      fallEpisodeCooldownMs: 5_000,
      episodeSourceStaleMs: 30_000
    });
    const robotEdge = new RobotEdgeAI({
      clockNow: () => now,
      random: createRobotSeededRandom(191)
    });
    const wearableEdge = new WearableEdgeAI({
      clockNow: () => now,
      random: createWearableSeededRandom(193)
    });
    const binding: EdgeDeviceBinding = {
      targets: BINDING.targets,
      wearableSourceRef: 'shared-vendor-id',
      homeRobotSourceRef: 'shared-vendor-id'
    };

    await router.ingestRobotInference('account-1', robotEdge.infer(robotEdge.generateFrame({
      deviceRef: 'shared-vendor-id', sequence: 1, profile: 'fall'
    })), binding);
    now += 5_001;
    await router.ingestWearableInference('account-1', wearableEdge.infer(wearableEdge.generateFrame({
      deviceRef: 'shared-vendor-id', sequence: 1, profile: 'resting'
    })), binding);
    await router.ingestRobotInference('account-1', robotEdge.infer(robotEdge.generateFrame({
      deviceRef: 'shared-vendor-id', sequence: 2, profile: 'fall'
    })), binding);

    expect(scenarioEngine.startScenario).toHaveBeenCalledTimes(1);
  });

  it('allows an identical safety envelope to retry after transient scenario admission failure', async () => {
    const { router, scenarioEngine } = createHarness();
    scenarioEngine.startScenario.mockRejectedValueOnce(Object.assign(new Error('temporary store failure'), {
      code: 'SCENARIO_STORE_UNAVAILABLE'
    }));
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(29) });
    const fall = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 40, profile: 'fall' }));

    await expect(router.ingestWearableInference('account-1', fall, BINDING)).rejects.toMatchObject({
      code: 'SCENARIO_STORE_UNAVAILABLE'
    });
    await expect(router.ingestWearableInference('account-1', fall, BINDING)).resolves.toMatchObject({
      started: [expect.objectContaining({ accepted: true })]
    });
    expect(scenarioEngine.startScenario).toHaveBeenCalledTimes(2);
    expect(scenarioEngine.startScenario.mock.calls[1]?.[1]).toEqual(
      scenarioEngine.startScenario.mock.calls[0]?.[1]
    );
  });

  it('keeps safety routing independent from telemetry observability failures', async () => {
    const { scenarioEngine, requests } = createHarness();
    const persistenceFailure = jest.fn(() => {
      throw new Error('metrics sink failed');
    });
    const router = new EdgeScenarioRouter({
      scenarioEngine,
      now: () => NOW,
      telemetryStateIngestor: {
        ingestWearable: async () => { throw new Error('state store failed'); },
        ingestRobot: async () => { throw new Error('state store failed'); }
      },
      onTelemetryPersistenceFailure: persistenceFailure
    });
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(30) });
    const fall = edge.infer(edge.generateFrame({
      deviceRef: 'wearable-1', sequence: 41, profile: 'fall'
    }));

    await expect(router.ingestWearableInference('account-1', fall, BINDING)).resolves.toMatchObject({
      started: [expect.objectContaining({ accepted: true })]
    });
    expect(persistenceFailure).toHaveBeenCalledWith('TELEMETRY_STATE_PERSIST_FAILED');
    expect(requests).toHaveLength(1);
  });

  it('serializes increasing sequences per source and rejects stale or mutated sequence reuse', async () => {
    const { scenarioEngine } = createHarness();
    const order: string[] = [];
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    const telemetryStateIngestor = {
      ingestWearable: jest.fn(async (_accountId: string, _deviceId: string, envelope: { sequence: number }) => {
        order.push(`start-${envelope.sequence}`);
        if (envelope.sequence === 1) {
          enteredFirst();
          await firstGate;
        }
        order.push(`end-${envelope.sequence}`);
      }),
      ingestRobot: jest.fn(async () => undefined)
    };
    const router = new EdgeScenarioRouter({ scenarioEngine, telemetryStateIngestor, now: () => NOW });
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(31) });
    const firstEnvelope = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 1, profile: 'resting' }));
    const secondEnvelope = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 2, profile: 'resting' }));
    const first = router.ingestWearableInference('account-1', firstEnvelope, BINDING);
    await firstEntered;
    const second = router.ingestWearableInference('account-1', secondEnvelope, BINDING);

    await expect(router.ingestWearableInference('account-1', {
      ...firstEnvelope,
      sequence: 0
    }, BINDING)).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
    await expect(router.ingestWearableInference('account-1', {
      ...secondEnvelope,
      inference: { ...secondEnvelope.inference, stressScore: secondEnvelope.inference.stressScore + 1 }
    }, BINDING)).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
    expect(order).toEqual(['start-1']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('rejects a higher sequence when its observation timestamp regresses', async () => {
    const { router } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(33) });
    const first = edge.infer(edge.generateFrame({
      deviceRef: 'wearable-1', sequence: 1, profile: 'resting'
    }));
    const second = edge.infer(edge.generateFrame({
      deviceRef: 'wearable-1', sequence: 2, profile: 'resting'
    }));
    await router.ingestWearableInference('account-1', first, BINDING);

    await expect(router.ingestWearableInference('account-1', {
      ...second,
      observedAtMs: NOW - 1
    }, BINDING)).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
    await expect(router.ingestWearableInference('account-1', second, BINDING)).resolves.toEqual({
      started: []
    });
  });

  it('registers every positive source while one shared episode admission is in flight', async () => {
    let now = NOW;
    const { scenarioEngine } = createHarness();
    let release!: (result: ScenarioStartResult) => void;
    let admissionStarted!: () => void;
    const started = new Promise<void>((resolve) => { admissionStarted = resolve; });
    scenarioEngine.startScenario.mockImplementationOnce(async () => {
      admissionStarted();
      return new Promise<ScenarioStartResult>((resolve) => { release = resolve; });
    });
    const router = new EdgeScenarioRouter({
      scenarioEngine,
      now: () => now,
      fallEpisodeCooldownMs: 1_000
    });
    const firstEdge = new WearableEdgeAI({
      clockNow: () => now, random: createWearableSeededRandom(151)
    });
    const secondEdge = new WearableEdgeAI({
      clockNow: () => now, random: createWearableSeededRandom(157)
    });
    const firstBinding = { ...BINDING, wearableSourceRef: 'wearable-a' };
    const secondBinding = { ...BINDING, wearableSourceRef: 'wearable-b' };
    const firstFall = firstEdge.infer(firstEdge.generateFrame({
      deviceRef: 'wearable-a', sequence: 1, profile: 'fall'
    }));
    const secondFall = secondEdge.infer(secondEdge.generateFrame({
      deviceRef: 'wearable-b', sequence: 1, profile: 'fall'
    }));

    const firstResult = router.ingestWearableInference('account-1', firstFall, firstBinding);
    await started;
    const secondResult = router.ingestWearableInference('account-1', secondFall, secondBinding);
    await Promise.resolve();
    expect(scenarioEngine.startScenario).toHaveBeenCalledTimes(1);
    release(accepted(1));
    await Promise.all([firstResult, secondResult]);

    now += 1_001;
    const firstNormal = firstEdge.infer(firstEdge.generateFrame({
      deviceRef: 'wearable-a', sequence: 2, profile: 'resting'
    }));
    await router.ingestWearableInference('account-1', firstNormal, firstBinding);
    const firstPositiveAgain = firstEdge.infer(firstEdge.generateFrame({
      deviceRef: 'wearable-a', sequence: 3, profile: 'fall'
    }));
    await router.ingestWearableInference('account-1', firstPositiveAgain, firstBinding);

    expect(scenarioEngine.startScenario).toHaveBeenCalledTimes(1);
  });

  it('rolls back failed admission without discarding concurrent positive sources', async () => {
    const { scenarioEngine } = createHarness();
    let rejectAdmission!: (error: Error) => void;
    let admissionStarted!: () => void;
    const started = new Promise<void>((resolve) => { admissionStarted = resolve; });
    scenarioEngine.startScenario.mockImplementationOnce(async () => {
      admissionStarted();
      return new Promise<ScenarioStartResult>((_resolve, reject) => { rejectAdmission = reject; });
    });
    const router = new EdgeScenarioRouter({ scenarioEngine, now: () => NOW });
    const firstEdge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(163) });
    const secondEdge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(167) });
    const first = router.ingestWearableInference('account-1', firstEdge.infer(firstEdge.generateFrame({
      deviceRef: 'wearable-a', sequence: 1, profile: 'fall'
    })), { ...BINDING, wearableSourceRef: 'wearable-a' });
    await started;
    const second = router.ingestWearableInference('account-1', secondEdge.infer(secondEdge.generateFrame({
      deviceRef: 'wearable-b', sequence: 1, profile: 'fall'
    })), { ...BINDING, wearableSourceRef: 'wearable-b' });
    await Promise.resolve();
    rejectAdmission(Object.assign(new Error('store unavailable'), { code: 'SCENARIO_STORE_UNAVAILABLE' }));
    await expect(first).rejects.toMatchObject({ code: 'SCENARIO_STORE_UNAVAILABLE' });
    await expect(second).rejects.toMatchObject({ code: 'SCENARIO_STORE_UNAVAILABLE' });

    const episodes = (router as unknown as {
      episodes: Map<string, { positiveSources: Map<string, number>; triggeredForEpisode: boolean }>;
    }).episodes;
    const episode = [...episodes.values()][0];
    expect(episode?.positiveSources.size).toBe(2);
    expect(episode?.triggeredForEpisode).toBe(false);
  });

  it('makes a failed admission retryable after an earlier episode became stale', async () => {
    let now = NOW;
    const { scenarioEngine } = createHarness();
    const router = new EdgeScenarioRouter({
      scenarioEngine,
      now: () => now,
      fallEpisodeCooldownMs: 1_000,
      episodeSourceStaleMs: 1_000
    });
    const firstEdge = new WearableEdgeAI({
      clockNow: () => now, random: createWearableSeededRandom(169)
    });
    await router.ingestWearableInference('account-1', firstEdge.infer(firstEdge.generateFrame({
      deviceRef: 'wearable-a', sequence: 1, profile: 'fall'
    })), { ...BINDING, wearableSourceRef: 'wearable-a' });

    now += 1_001;
    const secondEdge = new WearableEdgeAI({
      clockNow: () => now, random: createWearableSeededRandom(171)
    });
    const nextEpisode = secondEdge.infer(secondEdge.generateFrame({
      deviceRef: 'wearable-b', sequence: 1, profile: 'fall'
    }));
    scenarioEngine.startScenario.mockRejectedValueOnce(Object.assign(new Error('store unavailable'), {
      code: 'SCENARIO_STORE_UNAVAILABLE'
    }));
    await expect(router.ingestWearableInference('account-1', nextEpisode, {
      ...BINDING, wearableSourceRef: 'wearable-b'
    })).rejects.toMatchObject({ code: 'SCENARIO_STORE_UNAVAILABLE' });
    await expect(router.ingestWearableInference('account-1', nextEpisode, {
      ...BINDING, wearableSourceRef: 'wearable-b'
    })).resolves.toMatchObject({ started: [expect.objectContaining({ accepted: true })] });
    expect(scenarioEngine.startScenario).toHaveBeenCalledTimes(3);
  });

  it('rejects extra keys, accessors, non-plain records, and raw media at every edge-envelope level', async () => {
    const { router } = createHarness();
    const wearable = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(173) });
    const robot = new RobotEdgeAI({ clockNow: () => NOW, random: createRobotSeededRandom(179) });
    const wearableEnvelope = wearable.infer(wearable.generateFrame({
      deviceRef: 'wearable-1', sequence: 1, profile: 'resting'
    }));
    const robotEnvelope = robot.infer(robot.generateFrame({
      deviceRef: 'robot-1', sequence: 1, profile: 'idle'
    }));
    const wearableAttacks = [
      { ...wearableEnvelope, rawPpgSamples: [1, 2, 3] },
      { ...wearableEnvelope, model: { ...wearableEnvelope.model, secret: 'value' } },
      { ...wearableEnvelope, inference: { ...wearableEnvelope.inference, rawAccelerometer: [1] } },
      { ...wearableEnvelope, telemetry: { ...wearableEnvelope.telemetry, location: [1, 2] } },
      { ...wearableEnvelope, batteryEstimate: { ...wearableEnvelope.batteryEstimate, serial: 'private' } },
      Object.assign(Object.create({ inherited: true }), wearableEnvelope)
    ];
    const robotAttacks = [
      { ...robotEnvelope, rawCamera: 'base64' },
      { ...robotEnvelope, model: { ...robotEnvelope.model, apiKey: 'secret' } },
      { ...robotEnvelope, inference: { ...robotEnvelope.inference, transcript: 'private' } },
      {
        ...robotEnvelope,
        inference: {
          ...robotEnvelope.inference,
          vision: { ...robotEnvelope.inference.vision, frame: 'raw' }
        }
      },
      {
        ...robotEnvelope,
        inference: {
          ...robotEnvelope.inference,
          voice: { ...robotEnvelope.inference.voice, transcript: 'private' }
        }
      },
      {
        ...robotEnvelope,
        inference: {
          ...robotEnvelope.inference,
          motor: { ...robotEnvelope.inference.motor, route: ['bedroom'] }
        }
      }
    ];
    const accessorEnvelope = { ...wearableEnvelope } as Record<string, unknown>;
    Object.defineProperty(accessorEnvelope, 'sourceDeviceRef', {
      enumerable: true,
      get: () => 'wearable-1'
    });
    wearableAttacks.push(accessorEnvelope);

    for (const attack of wearableAttacks) {
      await expect(router.ingestWearableInference(
        'account-1', attack as typeof wearableEnvelope, BINDING
      )).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
    }
    for (const attack of robotAttacks) {
      await expect(router.ingestRobotInference(
        'account-1', attack as typeof robotEnvelope, BINDING
      )).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
    }
  });

  it('routes an immutable canonical snapshot even when the caller mutates its object after admission', async () => {
    const { router, requests } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(181) });
    const envelope = structuredClone(edge.infer(edge.generateFrame({
      deviceRef: 'wearable-1', sequence: 1, profile: 'stressed'
    })));
    const originalStress = envelope.inference.stressScore;

    const routed = router.ingestWearableInference('account-1', envelope, BINDING);
    (envelope.inference as { stressScore: number }).stressScore = 0;
    await routed;

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      scenarioId: 'emotional_check_in',
      input: { stressScore: originalStress }
    });
  });

  it('accepts account identifiers up to 256 characters including @ and rejects longer ones', async () => {
    const { router } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(191) });
    const normal = edge.infer(edge.generateFrame({
      deviceRef: 'wearable-1', sequence: 1, profile: 'resting'
    }));
    const maximum = `u@${'a'.repeat(254)}`;
    await expect(router.ingestWearableInference(maximum, normal, BINDING)).resolves.toEqual({
      started: []
    });
    await expect(router.ingestWearableInference(`${maximum}a`, {
      ...normal,
      sequence: 2
    }, BINDING)).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
  });

  it('authorizes wearable-triggered robot movement only from fresh positive robot safety telemetry', async () => {
    let now = NOW;
    const { scenarioEngine, requests } = createHarness();
    const router = new EdgeScenarioRouter({ scenarioEngine, now: () => now, robotSafetyMaxAgeMs: 5_000 });
    const robotEdge = new RobotEdgeAI({ clockNow: () => now, random: createRobotSeededRandom(37) });
    const wearableEdge = new WearableEdgeAI({ clockNow: () => now, random: createWearableSeededRandom(37) });

    for (const accountId of ['fresh-account', 'stale-account']) {
      const idle = robotEdge.infer(robotEdge.generateFrame({ deviceRef: 'robot-1', sequence: 1, profile: 'idle' }));
      expect(idle.inference.motor.safeToMove).toBe(true);
      await router.ingestRobotInference(accountId, idle, BINDING);
    }
    const freshFall = wearableEdge.infer(wearableEdge.generateFrame({
      deviceRef: 'wearable-1', sequence: 1, profile: 'fall'
    }));
    await router.ingestWearableInference('fresh-account', freshFall, BINDING);
    now += 5_001;
    const staleFall = wearableEdge.infer(wearableEdge.generateFrame({
      deviceRef: 'wearable-1', sequence: 2, profile: 'fall'
    }));
    await router.ingestWearableInference('stale-account', staleFall, BINDING);

    expect(requests.at(-2)).toMatchObject({ input: { robotSafeToMove: true } });
    expect(requests.at(-1)).toMatchObject({ input: { robotSafeToMove: false } });
  });

  it.each([
    ['medication_due', 'medication_adherence'],
    ['bedroom_inactivity', 'cognitive_engagement'],
    ['panic_button', 'ai_angel_auto_dial'],
    ['voice_emergency', 'ai_angel_auto_dial']
  ] as const)('routes authenticated %s context events to %s', async (type, scenarioId) => {
    const { router, requests } = createHarness();
    await router.ingestContextEvent('account-1', {
      eventId: `event-${type}`,
      type,
      occurredAt: NOW,
      data: type === 'medication_due' ? { medicationId: 'medication-1', scheduledAt: NOW } : { stepsToday: 100 }
    }, BINDING);

    expect(requests[0]).toMatchObject({ scenarioId, trigger: { type }, devices: BINDING.targets });
  });

  it('rejects stale, malformed, mismatched, and unsafe telemetry without leaking identifiers', async () => {
    const { router } = createHarness();
    const edge = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(23) });
    const inference = edge.infer(edge.generateFrame({ deviceRef: 'wearable-1', sequence: 30, profile: 'fall' }));

    await expect(router.ingestWearableInference('account-1', inference, {
      ...BINDING, wearableSourceRef: 'another-wearable'
    })).rejects.toMatchObject({ code: 'EDGE_SOURCE_MISMATCH' });
    await expect(router.ingestWearableInference('account-1', {
      ...inference, observedAtMs: NOW - 31_000
    }, BINDING)).rejects.toMatchObject({ code: 'EDGE_EVENT_STALE' });
    await expect(router.ingestWearableInference('account-1', {
      ...inference, inference: { ...inference.inference, stressScore: Number.NaN }
    }, BINDING)).rejects.toMatchObject({ code: 'EDGE_EVENT_INVALID' });
    expect(() => new EdgeScenarioRouter({
      scenarioEngine: createHarness().scenarioEngine,
      fallConfidenceThreshold: 2
    })).toThrow(EdgeScenarioRouterError);
    try {
      await router.ingestWearableInference('account-1', inference, {
        ...BINDING, wearableSourceRef: 'private-device-reference'
      });
    } catch (error) {
      expect(String(error)).not.toContain('private-device-reference');
    }
  });
});
