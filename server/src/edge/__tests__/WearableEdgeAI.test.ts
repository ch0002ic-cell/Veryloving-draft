import { describe, expect, test } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import {
  createWearableSeededRandom,
  WEARABLE_EDGE_CONTRACT,
  WearableEdgeAI,
  WearableEdgeAIError,
  type WearableSensorFrame
} from '../WearableEdgeAI';

const NOW = 1_753_000_000_000;

function createSimulator(seed = 17): WearableEdgeAI {
  return new WearableEdgeAI({
    clockNow: () => NOW,
    random: createWearableSeededRandom(seed)
  });
}

describe('WearableEdgeAI', () => {
  test('seeded frame generation and inference are deterministic', () => {
    const first = createSimulator(42);
    const second = createSimulator(42);
    const firstFrame = first.generateFrame({ sequence: 8, profile: 'walking' });
    const secondFrame = second.generateFrame({ sequence: 8, profile: 'walking' });

    expect(firstFrame).toEqual(secondFrame);
    expect(first.infer(firstFrame)).toEqual(second.infer(secondFrame));
  });

  test('classifies the simulated activity, fall, and stress profiles', () => {
    const profiles = ['resting', 'walking', 'running', 'fall', 'stressed'] as const;
    const results = Object.fromEntries(profiles.map((profile, sequence) => {
      const simulator = createSimulator(100 + sequence);
      const frame = simulator.generateFrame({ sequence, profile });
      return [profile, simulator.infer(frame)];
    })) as Record<(typeof profiles)[number], ReturnType<WearableEdgeAI['infer']>>;

    expect(results.resting.inference.activity).toBe('resting');
    expect(results.walking.inference.activity).toBe('walking');
    expect(results.running.inference.activity).toBe('running');
    expect(results.fall.inference).toMatchObject({ activity: 'fall', fallDetected: true });
    expect(results.fall.inference.fallConfidence).toBeGreaterThan(0.8);
    expect(results.stressed.inference.stressScore).toBeGreaterThanOrEqual(80);
    expect(results.resting.inference.stressScore).toBeLessThan(50);
  });

  test('emits a bounded, versioned, serializable cloud relay envelope', () => {
    const simulator = createSimulator();
    const envelope = simulator.infer(simulator.generateFrame({
      deviceRef: 'wearable-ref-1',
      sequence: 4,
      profile: 'stressed',
      batteryLevelPercent: 64,
      stepsToday: 5_432
    }));
    const serialized = simulator.serializeOutbound(envelope);

    expect(JSON.parse(serialized)).toEqual(envelope);
    expect(envelope).toMatchObject({
      contractVersion: 'vl-wearable-inference/1',
      sourceDeviceRef: 'wearable-ref-1',
      model: {
        mode: 'deterministic-simulation',
        clinicallyValidated: false
      }
    });
    expect(envelope.inference.stressScore).toBeGreaterThanOrEqual(0);
    expect(envelope.inference.stressScore).toBeLessThanOrEqual(100);
    expect(envelope.inference.fallConfidence).toBeGreaterThanOrEqual(0);
    expect(envelope.inference.fallConfidence).toBeLessThanOrEqual(1);
    expect(envelope.batteryEstimate.estimatedAdditionalDrainPercentPerDay).toBeLessThanOrEqual(10);
    expect(envelope.telemetry.stepsToday).toBe(5_432);

    const untypedWithRawSamples = { ...envelope, rawPpgSamples: [1, 2, 3] };
    expect(simulator.serializeOutbound(untypedWithRawSamples)).not.toContain('rawPpgSamples');
  });

  test('fails closed for stale, future, malformed, and unbounded frames', () => {
    const simulator = createSimulator();
    const valid = simulator.generateFrame({
      deviceRef: 'private-device-ref',
      sequence: 1,
      profile: 'resting'
    });
    const stale = { ...valid, capturedAtMs: NOW - 30_001 };
    const future = { ...valid, capturedAtMs: NOW + 2_001 };
    const malformed = {
      ...valid,
      ppg: { ...valid.ppg, heartRateBpm: Number.NaN }
    };
    const oversized = {
      ...valid,
      accelerometer: Array.from({ length: 129 }, (_, index) => ({
        atOffsetMs: index,
        xG: 0,
        yG: 0,
        zG: 1
      })),
      sampleWindowMs: 129
    };

    expect(() => simulator.infer(stale)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_STALE' }));
    expect(() => simulator.infer(future)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_STALE' }));
    expect(() => simulator.infer(malformed)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));
    expect(() => simulator.infer(oversized)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));

    try {
      simulator.infer(malformed);
    } catch (error) {
      expect(error).toBeInstanceOf(WearableEdgeAIError);
      expect((error as Error).message).not.toContain('private-device-ref');
    }
  });

  test('rejects duplicate/non-monotonic offsets and invalid random sources', () => {
    const simulator = createSimulator();
    const valid = simulator.generateFrame({ sequence: 2 });
    const accelerometer = valid.accelerometer.map((sample) => ({ ...sample }));
    accelerometer[2] = { ...accelerometer[2]!, atOffsetMs: accelerometer[1]!.atOffsetMs };
    const nonMonotonic: WearableSensorFrame = { ...valid, accelerometer };

    expect(() => simulator.infer(nonMonotonic)).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    const invalidRandom = new WearableEdgeAI({ clockNow: () => NOW, random: () => 1 });
    expect(() => invalidRandom.generateFrame({ sequence: 1 })).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => createWearableSeededRandom(Number.NaN)).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => new WearableEdgeAI({ staleAfterMs: 0 })).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => simulator.generateFrame({ sequence: -1 })).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => simulator.generateFrame({ sequence: 1, batteryLevelPercent: 101 }))
      .toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));
    expect(() => simulator.generateFrame({ sequence: 1, stepsToday: -1 }))
      .toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));
    expect(() => simulator.generateFrame({ sequence: 1, stepsToday: 1_000_001 }))
      .toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));
  });

  test('models steps as a bounded UTC day-to-date counter that may reset on a later day', () => {
    let now = Date.parse('2026-07-20T23:59:59.000Z');
    const simulator = new WearableEdgeAI({
      clockNow: () => now,
      random: createWearableSeededRandom(23)
    });
    const beforeMidnight = simulator.infer(simulator.generateFrame({
      sequence: 1,
      profile: 'walking',
      stepsToday: 12_345
    }));
    now = Date.parse('2026-07-21T00:00:01.000Z');
    const afterMidnight = simulator.infer(simulator.generateFrame({
      sequence: 2,
      profile: 'resting',
      stepsToday: 3
    }));

    expect(beforeMidnight.telemetry.stepsToday).toBe(12_345);
    expect(afterMidnight.telemetry.stepsToday).toBe(3);
    expect(afterMidnight.observedAtMs).toBeGreaterThan(beforeMidnight.observedAtMs);
  });

  test('runs one local inference well below the 100ms simulator acceptance bound', () => {
    const simulator = createSimulator();
    const frame = simulator.generateFrame({ sequence: 3, profile: 'fall' });
    const startedAt = performance.now();
    const result = simulator.infer(frame);
    const elapsedMs = performance.now() - startedAt;

    expect(result.inference.fallDetected).toBe(true);
    expect(elapsedMs).toBeLessThan(WEARABLE_EDGE_CONTRACT.targetHardware.maximumInferenceLatencyMs);
  });

  test('publishes the bounded firmware and Cortex-M integration contract', () => {
    expect(WEARABLE_EDGE_CONTRACT).toMatchObject({
      inputVersion: 'vl-wearable-sensors/1',
      outputVersion: 'vl-wearable-inference/1',
      targetHardware: {
        minimumRamKiB: 256,
        minimumFlashKiB: 1024,
        quantization: 'int8',
        maximumAdditionalBatteryDrainPercentPerDay: 10
      }
    });
    expect(WEARABLE_EDGE_CONTRACT.frameBounds.maximumAccelerometerSamples).toBe(128);
    expect(WEARABLE_EDGE_CONTRACT.productionModelCandidate.architecture).toContain('CNN');
    expect(WEARABLE_EDGE_CONTRACT.productionModelCandidate.maximumParameterCount).toBe(120_000);
  });
});
