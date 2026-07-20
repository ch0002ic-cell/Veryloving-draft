import {
  InMemoryCiphertextRepository,
  UserStateModel
} from '../../models/UserState';
import {
  WearableEdgeAI,
  createWearableSeededRandom
} from '../../edge/WearableEdgeAI';
import {
  RobotEdgeAI,
  createRobotSeededRandom
} from '../../edge/RobotEdgeAI';
import { TelemetryStateIngestor } from '../TelemetryStateIngestor';

const NOW = 1_750_000_000_000;
const ENCRYPTION_KEY = new Uint8Array(Buffer.alloc(32, 0x41));

describe('TelemetryStateIngestor', () => {
  it('concurrently merges bounded derived wearable and robot state without retaining raw media or sensors', async () => {
    const repository = new InMemoryCiphertextRepository();
    const state = new UserStateModel({ repository, encryptionKey: ENCRYPTION_KEY });
    const ingestor = new TelemetryStateIngestor(state);
    const wearable = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(101) });
    const robot = new RobotEdgeAI({ clockNow: () => NOW, random: createRobotSeededRandom(103) });
    const wearableEnvelope = wearable.infer(wearable.generateFrame({
      deviceRef: 'wearable-edge-source', sequence: 1, profile: 'walking', batteryLevelPercent: 64
    }));
    const robotEnvelope = robot.infer(robot.generateFrame({
      deviceRef: 'robot-edge-source', sequence: 1, profile: 'happy'
    }));

    await Promise.all([
      ingestor.ingestWearable('account-1', 'wearable-command-target', wearableEnvelope, {
        locationContext: 'away'
      }),
      ingestor.ingestRobot('account-1', 'robot-command-target', robotEnvelope, {
        locationContext: 'home'
      })
    ]);

    const current = await state.getCurrentState('account-1');
    expect(current?.physical).toMatchObject({
      heartRateBpm: { value: wearableEnvelope.telemetry.heartRateBpm },
      hrvMs: { value: wearableEnvelope.telemetry.hrvRmssdMs },
      steps: { value: wearableEnvelope.telemetry.stepsToday },
      temperatureCelsius: { value: wearableEnvelope.telemetry.skinTemperatureC },
      activity: { type: 'walking' }
    });
    expect(current?.emotional).toMatchObject({
      stressScore: { value: wearableEnvelope.inference.stressScore },
      emotionalTone: { label: robotEnvelope.inference.vision.facialExpression }
    });
    expect(current?.devices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        deviceId: 'wearable-command-target',
        type: 'wearable',
        batteryPercent: wearableEnvelope.telemetry.batteryPercent,
        connectivity: 'online'
      }),
      expect.objectContaining({
        deviceId: 'robot-command-target',
        type: 'home_robot',
        connectivity: 'online',
        lastKnownState: robotEnvelope.inference.motor.state
      })
    ]));
    const exported = JSON.stringify(await state.exportData('account-1'));
    expect(exported).not.toMatch(/accelerometer|camera|microphone|rawAudio|transcript|faceEmbedding/);
  });

  it('deduplicates replayed telemetry and respects cancellation before persistence', async () => {
    const state = new UserStateModel({
      repository: new InMemoryCiphertextRepository(),
      encryptionKey: ENCRYPTION_KEY
    });
    const ingestor = new TelemetryStateIngestor(state);
    const wearable = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(107) });
    const envelope = wearable.infer(wearable.generateFrame({
      deviceRef: 'wearable-edge-source', sequence: 9, profile: 'resting'
    }));
    await ingestor.ingestWearable('account-1', 'wearable-target', envelope);
    const revision = (await state.getCurrentState('account-1'))?.revision;

    await ingestor.ingestWearable('account-1', 'wearable-target', envelope);
    expect((await state.getCurrentState('account-1'))?.revision).toBe(revision);

    const controller = new AbortController();
    controller.abort();
    await expect(ingestor.ingestWearable(
      'account-2',
      'wearable-target',
      { ...envelope, sequence: 10 },
      {},
      controller.signal
    )).rejects.toMatchObject({ code: 'OPERATION_CANCELLED' });
    await expect(state.getCurrentState('account-2')).resolves.toBeNull();
  });

  it('rejects invalid command-target and authenticated-source identifiers without persisting data', async () => {
    const state = new UserStateModel({
      repository: new InMemoryCiphertextRepository(),
      encryptionKey: ENCRYPTION_KEY
    });
    const ingestor = new TelemetryStateIngestor(state);
    const wearable = new WearableEdgeAI({ clockNow: () => NOW, random: createWearableSeededRandom(109) });
    const envelope = wearable.infer(wearable.generateFrame({
      deviceRef: 'wearable-edge-source', sequence: 11, profile: 'resting'
    }));

    await expect(ingestor.ingestWearable('account-1', '../unsafe-target', envelope)).rejects.toThrow(
      'Telemetry device binding is invalid'
    );
    await expect(ingestor.ingestWearable('account-1', 'wearable-target', {
      ...envelope,
      sourceDeviceRef: '../unsafe-source'
    })).rejects.toThrow('Telemetry device binding is invalid');
    await expect(state.getCurrentState('account-1')).resolves.toBeNull();
  });

  it('prevents field and device timestamp regression while allowing a new-day step reset', async () => {
    const state = new UserStateModel({
      repository: new InMemoryCiphertextRepository(),
      encryptionKey: ENCRYPTION_KEY
    });
    const ingestor = new TelemetryStateIngestor(state);
    const newerWearable = new WearableEdgeAI({
      clockNow: () => NOW,
      random: createWearableSeededRandom(113)
    });
    const olderWearable = new WearableEdgeAI({
      clockNow: () => NOW - 1_000,
      random: createWearableSeededRandom(127)
    });
    const newer = newerWearable.infer(newerWearable.generateFrame({
      deviceRef: 'wearable-source',
      sequence: 1,
      profile: 'walking',
      batteryLevelPercent: 81,
      stepsToday: 9_876
    }));
    const older = olderWearable.infer(olderWearable.generateFrame({
      deviceRef: 'wearable-source',
      sequence: 2,
      profile: 'resting',
      batteryLevelPercent: 12,
      stepsToday: 22
    }));

    await ingestor.ingestWearable('account-1', 'wearable-target', newer, {
      locationContext: 'away'
    });
    await ingestor.ingestWearable('account-1', 'wearable-target', older, {
      locationContext: 'home'
    });
    let current = await state.getCurrentState('account-1');
    expect(current?.physical).toMatchObject({
      heartRateBpm: { value: newer.telemetry.heartRateBpm, observedAt: new Date(NOW).toISOString() },
      steps: { value: 9_876, observedAt: new Date(NOW).toISOString() },
      activity: { type: newer.inference.activity, observedAt: new Date(NOW).toISOString() }
    });
    expect(current?.context.location).toMatchObject({
      context: 'away', observedAt: new Date(NOW).toISOString()
    });
    expect(current?.devices).toContainEqual(expect.objectContaining({
      deviceId: 'wearable-target',
      batteryPercent: 81,
      lastKnownState: newer.inference.activity,
      observedAt: new Date(NOW).toISOString()
    }));

    const sameDayAt = NOW + 1_000;
    const sameDayWearable = new WearableEdgeAI({
      clockNow: () => sameDayAt,
      random: createWearableSeededRandom(129)
    });
    const regressedCounter = sameDayWearable.infer(sameDayWearable.generateFrame({
      deviceRef: 'wearable-source',
      sequence: 3,
      profile: 'resting',
      stepsToday: 9_000
    }));
    await ingestor.ingestWearable('account-1', 'wearable-target', regressedCounter);
    current = await state.getCurrentState('account-1');
    expect(current?.physical.steps).toEqual({
      value: 9_876,
      observedAt: new Date(NOW).toISOString()
    });

    const nextDayAt = NOW + 24 * 60 * 60_000;
    const nextDayWearable = new WearableEdgeAI({
      clockNow: () => nextDayAt,
      random: createWearableSeededRandom(131)
    });
    const reset = nextDayWearable.infer(nextDayWearable.generateFrame({
      deviceRef: 'wearable-source',
      sequence: 4,
      profile: 'resting',
      stepsToday: 4
    }));
    await ingestor.ingestWearable('account-1', 'wearable-target', reset);
    current = await state.getCurrentState('account-1');
    expect(current?.physical.steps).toEqual({
      value: 4,
      observedAt: new Date(nextDayAt).toISOString()
    });
  });

  it('prevents older robot emotion, context, and device state from winning a CAS retry', async () => {
    const state = new UserStateModel({
      repository: new InMemoryCiphertextRepository(),
      encryptionKey: ENCRYPTION_KEY
    });
    const ingestor = new TelemetryStateIngestor(state);
    const newerRobot = new RobotEdgeAI({
      clockNow: () => NOW,
      random: createRobotSeededRandom(137)
    });
    const olderRobot = new RobotEdgeAI({
      clockNow: () => NOW - 2_000,
      random: createRobotSeededRandom(139)
    });
    const newer = newerRobot.infer(newerRobot.generateFrame({
      deviceRef: 'robot-source', sequence: 1, profile: 'happy'
    }));
    const older = olderRobot.infer(olderRobot.generateFrame({
      deviceRef: 'robot-source', sequence: 2, profile: 'distressed'
    }));

    await ingestor.ingestRobot('account-1', 'robot-target', newer, { locationContext: 'home' });
    await ingestor.ingestRobot('account-1', 'robot-target', older, { locationContext: 'away' });

    const current = await state.getCurrentState('account-1');
    expect(current?.emotional.emotionalTone).toMatchObject({
      label: newer.inference.vision.facialExpression,
      observedAt: new Date(NOW).toISOString()
    });
    expect(current?.context.location).toMatchObject({
      context: 'home', observedAt: new Date(NOW).toISOString()
    });
    expect(current?.devices).toContainEqual(expect.objectContaining({
      deviceId: 'robot-target',
      lastKnownState: newer.inference.motor.state,
      observedAt: new Date(NOW).toISOString()
    }));
  });
});
