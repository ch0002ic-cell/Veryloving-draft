import { describe, expect, test } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import {
  createRobotSeededRandom,
  ROBOT_EDGE_CONTRACT,
  RobotEdgeAI,
  RobotEdgeAIError,
  type RobotEdgeFeatureFrame
} from '../RobotEdgeAI';

const NOW = 1_753_000_000_000;

function createSimulator(seed = 23): RobotEdgeAI {
  return new RobotEdgeAI({
    clockNow: () => NOW,
    random: createRobotSeededRandom(seed)
  });
}

describe('RobotEdgeAI', () => {
  test('seeded feature generation and inference are deterministic', () => {
    const first = createSimulator(44);
    const second = createSimulator(44);
    const firstFrame = first.generateFrame({ sequence: 5, profile: 'navigating' });
    const secondFrame = second.generateFrame({ sequence: 5, profile: 'navigating' });

    expect(firstFrame).toEqual(secondFrame);
    expect(first.infer(firstFrame)).toEqual(second.infer(secondFrame));
  });

  test('classifies fall, expression, offline intent, voice emotion, and motor state', () => {
    const fallAI = createSimulator(1);
    const fall = fallAI.infer(fallAI.generateFrame({ sequence: 1, profile: 'fall' }));
    const helpAI = createSimulator(2);
    const help = helpAI.infer(helpAI.generateFrame({ sequence: 2, profile: 'help_request' }));
    const happyAI = createSimulator(3);
    const happy = happyAI.infer(happyAI.generateFrame({ sequence: 3, profile: 'happy' }));
    const navigationAI = createSimulator(4);
    const navigation = navigationAI.infer(navigationAI.generateFrame({ sequence: 4, profile: 'navigating' }));
    const distressAI = createSimulator(5);
    const distress = distressAI.infer(distressAI.generateFrame({ sequence: 5, profile: 'distressed' }));

    expect(fall.inference.vision).toMatchObject({ fallDetected: true, facialExpression: 'calm' });
    expect(fall.inference.vision.fallConfidence).toBeGreaterThan(0.8);
    const lowQualityFallFrame = fallAI.generateFrame({ sequence: 12, profile: 'fall' });
    const lowQualityFall = fallAI.infer({
      ...lowQualityFallFrame,
      vision: { ...lowQualityFallFrame.vision, frameQuality: 0.1 }
    });
    expect(lowQualityFall.inference.vision.fallDetected).toBe(false);
    expect(lowQualityFall.inference.vision.facialExpression).toBe('not_observed');
    expect(help.inference.voice).toMatchObject({
      intent: 'request_help',
      emotion: 'distressed',
      processedOffline: true
    });
    expect(help.inference.vision.facialExpression).toBe('distressed');
    expect(happy.inference.voice).toMatchObject({ intent: 'greeting', emotion: 'positive' });
    expect(happy.inference.vision.facialExpression).toBe('positive');
    expect(navigation.inference.motor).toMatchObject({ state: 'navigating', safeToMove: true });
    expect(distress.inference.voice.intent).toBe('report_discomfort');
  });

  test('handles absent people and the remaining bounded offline speech branches', () => {
    const simulator = createSimulator();
    const idle = simulator.generateFrame({ sequence: 6, profile: 'idle' });
    const cancellation: RobotEdgeFeatureFrame = {
      ...idle,
      vision: { ...idle.vision, personDetected: false },
      audio: {
        ...idle.audio,
        voiceActivity: true,
        keyword: 'stop',
        prosody: { valence: 0, arousal: 0.2, confidence: 0.9 }
      }
    };
    const cancellationResult = simulator.infer(cancellation);
    expect(cancellationResult.inference.vision.facialExpression).toBe('not_observed');
    expect(cancellationResult.inference.vision.expressionConfidence).toBe(0);
    expect(cancellationResult.inference.voice).toMatchObject({ intent: 'cancel', emotion: 'calm' });

    const ambiguous: RobotEdgeFeatureFrame = {
      ...idle,
      vision: {
        ...idle.vision,
        expression: { valence: -0.6, arousal: 0.2, confidence: 0.9 }
      },
      audio: {
        ...idle.audio,
        voiceActivity: true,
        keyword: 'none',
        prosody: { valence: 0, arousal: 0.5, confidence: 0.9 }
      }
    };
    const ambiguousResult = simulator.infer(ambiguous);
    expect(ambiguousResult.inference.vision.facialExpression).toBe('sad');
    expect(ambiguousResult.inference.voice).toMatchObject({ intent: 'none', emotion: 'neutral' });
  });

  test('serializes only a bounded versioned feature result, never raw media', () => {
    const simulator = createSimulator();
    const envelope = simulator.infer(simulator.generateFrame({
      deviceRef: 'robot-ref-1',
      sequence: 7,
      profile: 'help_request'
    }));
    const serialized = simulator.serializeOutbound(envelope);

    expect(JSON.parse(serialized)).toEqual(envelope);
    expect(envelope).toMatchObject({
      contractVersion: 'vl-robot-edge-inference/1',
      sourceDeviceRef: 'robot-ref-1',
      model: {
        mode: 'deterministic-simulation',
        clinicallyValidated: false,
        rawMediaRetained: false
      }
    });
    expect(serialized).not.toMatch(/bitmap|transcript|voiceprint|embedding|audioData|imageData/i);
    expect(envelope.inference.vision.fallConfidence).toBeGreaterThanOrEqual(0);
    expect(envelope.inference.vision.fallConfidence).toBeLessThanOrEqual(1);

    const untypedWithRawMedia = { ...envelope, rawAudio: 'private-audio', bitmap: 'private-image' };
    expect(simulator.serializeOutbound(untypedWithRawMedia)).not.toMatch(/rawAudio|bitmap|private-/);
  });

  test('fails closed for stale, future, malformed, and unbounded feature frames', () => {
    const simulator = createSimulator();
    const valid = simulator.generateFrame({
      deviceRef: 'private-robot-ref',
      sequence: 8,
      profile: 'idle'
    });
    const stale = { ...valid, capturedAtMs: NOW - 5_001 };
    const future = { ...valid, capturedAtMs: NOW + 1_001 };
    const malformed = {
      ...valid,
      vision: { ...valid.vision, frameQuality: Number.NaN }
    };
    const unbounded = {
      ...valid,
      motor: { ...valid.motor, linearVelocityMetersPerSecond: 2.1 }
    };

    expect(() => simulator.infer(stale)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_STALE' }));
    expect(() => simulator.infer(future)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_STALE' }));
    expect(() => simulator.infer(malformed)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));
    expect(() => simulator.infer(unbounded)).toThrow(expect.objectContaining({ code: 'EDGE_INPUT_INVALID' }));

    try {
      simulator.infer(malformed);
    } catch (error) {
      expect(error).toBeInstanceOf(RobotEdgeAIError);
      expect((error as Error).message).not.toContain('private-robot-ref');
    }
  });

  test('honors local motor fail-safety inputs', () => {
    const simulator = createSimulator();
    const valid = simulator.generateFrame({ sequence: 9, profile: 'navigating' });
    const emergencyStopped: RobotEdgeFeatureFrame = {
      ...valid,
      motor: {
        ...valid.motor,
        mode: 'stopped',
        linearVelocityMetersPerSecond: 0,
        emergencyStopEngaged: true
      }
    };

    expect(simulator.infer(emergencyStopped).inference.motor).toEqual({
      state: 'stopped',
      safeToMove: false
    });
  });

  test('rejects invalid random sources and envelopes modified after inference', () => {
    const invalidRandom = new RobotEdgeAI({ clockNow: () => NOW, random: () => -0.01 });
    expect(() => invalidRandom.generateFrame({ sequence: 1 })).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => createRobotSeededRandom(Number.POSITIVE_INFINITY)).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => new RobotEdgeAI({ maxFutureSkewMs: -1 })).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
    expect(() => createSimulator().generateFrame({ sequence: -1 })).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));

    const simulator = createSimulator();
    const valid = simulator.infer(simulator.generateFrame({ sequence: 10 }));
    const invalid = {
      ...valid,
      inference: {
        ...valid.inference,
        vision: { ...valid.inference.vision, fallConfidence: 1.2 }
      }
    };
    expect(() => simulator.serializeOutbound(invalid)).toThrow(expect.objectContaining({
      code: 'EDGE_INPUT_INVALID'
    }));
  });

  test('runs one local feature inference below the vision latency target', () => {
    const simulator = createSimulator();
    const frame = simulator.generateFrame({ sequence: 11, profile: 'fall' });
    const startedAt = performance.now();
    const result = simulator.infer(frame);
    const elapsedMs = performance.now() - startedAt;

    expect(result.inference.vision.fallDetected).toBe(true);
    expect(elapsedMs).toBeLessThan(ROBOT_EDGE_CONTRACT.targetHardware.maximumVisionInferenceLatencyMs);
  });

  test('publishes the serial/GPIO, media, and accelerator integration contract', () => {
    expect(ROBOT_EDGE_CONTRACT).toMatchObject({
      inputVersion: 'vl-robot-edge-features/1',
      outputVersion: 'vl-robot-edge-inference/1',
      targetHardware: {
        minimumRamMiB: 4096,
        minimumAvailableStorageGiB: 16
      }
    });
    expect(ROBOT_EDGE_CONTRACT.moduleLink.protocol).toContain('UART');
    expect(ROBOT_EDGE_CONTRACT.moduleLink.gpioEmergencyStop).toContain('manufacturer-approved');
    expect(ROBOT_EDGE_CONTRACT.mediaFormats.privacyBoundary).toContain('No raw camera frame');
    expect(ROBOT_EDGE_CONTRACT.productionModelCandidates.visionFall).toContain('temporal');
  });
});
