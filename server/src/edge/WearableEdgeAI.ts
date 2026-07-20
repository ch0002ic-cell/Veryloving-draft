/**
 * Deterministic Product 1 edge-AI simulator.
 *
 * This module is an engineering test double, not a medical device or a
 * clinically validated model. Its classifications must never be used as the
 * sole basis for diagnosis, treatment, or emergency dispatch.
 */

export type WearableActivity = 'resting' | 'walking' | 'running' | 'fall';
export type WearableSimulationProfile = WearableActivity | 'stressed';

export interface AccelerometerSample {
  /** Offset from the beginning of the frame. */
  readonly atOffsetMs: number;
  readonly xG: number;
  readonly yG: number;
  readonly zG: number;
}

export interface WearableSensorFrame {
  readonly contractVersion: 'vl-wearable-sensors/1';
  /** Account-bound opaque reference. It must never be written to logs. */
  readonly deviceRef: string;
  readonly sequence: number;
  readonly capturedAtMs: number;
  readonly sampleWindowMs: number;
  readonly accelerometer: readonly AccelerometerSample[];
  readonly ppg: {
    readonly heartRateBpm: number;
    readonly hrvRmssdMs: number;
    readonly signalQuality: number;
  };
  readonly skinTemperatureC: number;
  readonly battery: {
    readonly levelPercent: number;
    readonly voltageV: number;
  };
  /** UTC calendar-day pedometer total at capturedAtMs. */
  readonly stepsToday: number;
}

export interface WearableInferenceEnvelope {
  readonly contractVersion: 'vl-wearable-inference/1';
  readonly sourceDeviceRef: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly emittedAtMs: number;
  readonly model: {
    readonly name: 'wearable-edge-sim';
    readonly version: '1.0.0';
    readonly mode: 'deterministic-simulation';
    readonly clinicallyValidated: false;
  };
  readonly inference: {
    readonly fallDetected: boolean;
    readonly fallConfidence: number;
    readonly stressScore: number;
    readonly activity: WearableActivity;
  };
  /** Bounded derived telemetry relayed to the encrypted User State Model. */
  readonly telemetry: {
    readonly heartRateBpm: number;
    readonly hrvRmssdMs: number;
    readonly skinTemperatureC: number;
    readonly batteryPercent: number;
    /** UTC calendar-day pedometer total at observedAtMs. */
    readonly stepsToday: number;
  };
  readonly batteryEstimate: {
    /** Engineering simulation only; hardware measurement is still required. */
    readonly estimatedAdditionalDrainPercentPerDay: number;
    readonly estimatedEnergyMilliJoulesPerInference: number;
  };
}

export interface WearableEdgeAIOptions {
  readonly clockNow?: () => number;
  readonly random?: () => number;
  readonly staleAfterMs?: number;
  readonly maxFutureSkewMs?: number;
}

export interface GenerateWearableFrameOptions {
  readonly deviceRef?: string;
  readonly sequence: number;
  readonly profile?: WearableSimulationProfile;
  readonly batteryLevelPercent?: number;
  /** Override the simulated UTC calendar-day pedometer total. */
  readonly stepsToday?: number;
}

export type WearableEdgeErrorCode = 'EDGE_INPUT_INVALID' | 'EDGE_INPUT_STALE';

export class WearableEdgeAIError extends Error {
  readonly code: WearableEdgeErrorCode;

  constructor(code: WearableEdgeErrorCode) {
    // Do not include sensor values or device references in an error that a
    // caller may subsequently log.
    super(code === 'EDGE_INPUT_STALE'
      ? 'Wearable edge input is outside the accepted time window'
      : 'Wearable edge input failed validation');
    this.name = 'WearableEdgeAIError';
    this.code = code;
  }
}

/**
 * Provisional firmware boundary. Manufacturer-specific UUIDs and electrical
 * values remain external dependencies; the versioned payload shapes are owned
 * by Veryloving and can be implemented before hardware arrives.
 */
export const WEARABLE_EDGE_CONTRACT = Object.freeze({
  inputVersion: 'vl-wearable-sensors/1' as const,
  outputVersion: 'vl-wearable-inference/1' as const,
  transport: Object.freeze({
    encoding: 'CBOR on firmware; structurally equivalent JSON in simulation',
    framing: 'uint16 length + uint32 sequence + payload + CRC32',
    delivery: 'BLE GATT notification from firmware; mobile app relays output to cloud',
    maximumEncodedFrameBytes: 4096
  }),
  sensorFormats: Object.freeze({
    accelerometer: 'signed float32, g, x/y/z, monotonic millisecond offset',
    ppgHeartRate: 'unsigned float32 beats/minute',
    ppgHrvRmssd: 'unsigned float32 milliseconds',
    ppgSignalQuality: 'float32 normalized 0..1',
    stepsToday: 'unsigned uint32 UTC calendar-day pedometer total, 0..1,000,000',
    skinTemperature: 'signed float32 degrees Celsius',
    timestamp: 'UTC Unix epoch milliseconds'
  }),
  frameBounds: Object.freeze({
    minimumAccelerometerSamples: 8,
    maximumAccelerometerSamples: 128,
    maximumSampleWindowMs: 5_000,
    accelerometerRangeG: 16,
    minimumHeartRateBpm: 25,
    maximumHeartRateBpm: 240,
    minimumSkinTemperatureC: 25,
    maximumSkinTemperatureC: 45
  }),
  targetHardware: Object.freeze({
    cpu: 'ARM Cortex-M4F or Cortex-M33 with DSP/FPU',
    minimumCpuMHz: 80,
    minimumRamKiB: 256,
    minimumFlashKiB: 1024,
    recommendedFramework: 'TensorFlow Lite Micro or equivalent integer-only runtime',
    quantization: 'int8',
    maximumInferenceLatencyMs: 100,
    maximumAdditionalBatteryDrainPercentPerDay: 10
  }),
  productionModelCandidate: Object.freeze({
    architecture: 'int8 1D depthwise-separable CNN with three temporal blocks',
    inputTensor: '[1, 128, 5]: accelerometer x/y/z, normalized PPG, temperature delta',
    outputHeads: 'fall probability, stress regression, activity softmax',
    maximumParameterCount: 120_000,
    note: 'Candidate architecture only; training, clinical validation, and hardware profiling are external gates'
  })
});

const MIN_ACCEL_SAMPLES = WEARABLE_EDGE_CONTRACT.frameBounds.minimumAccelerometerSamples;
const MAX_ACCEL_SAMPLES = WEARABLE_EDGE_CONTRACT.frameBounds.maximumAccelerometerSamples;
const MAX_WINDOW_MS = WEARABLE_EDGE_CONTRACT.frameBounds.maximumSampleWindowMs;
const MAX_DEVICE_REF_LENGTH = 128;
const DEFAULT_STALE_AFTER_MS = 30_000;
const DEFAULT_FUTURE_SKEW_MS = 2_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 2): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function magnitude(sample: AccelerometerSample): number {
  return Math.sqrt(sample.xG ** 2 + sample.yG ** 2 + sample.zG ** 2);
}

function requireBoundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

/** Mulberry32: deterministic and suitable for simulation, never cryptography. */
export function createWearableSeededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) {
    throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export class WearableEdgeAI {
  private readonly clockNow: () => number;
  private readonly random: () => number;
  private readonly staleAfterMs: number;
  private readonly maxFutureSkewMs: number;

  constructor(options: WearableEdgeAIOptions = {}) {
    this.clockNow = options.clockNow ?? Date.now;
    this.random = options.random ?? Math.random;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;

    if (!isFiniteNumber(this.staleAfterMs) || this.staleAfterMs <= 0
      || !isFiniteNumber(this.maxFutureSkewMs) || this.maxFutureSkewMs < 0) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }
  }

  /** Generate a bounded, synthetic frame. No real sensor or user data is read. */
  generateFrame(options: GenerateWearableFrameOptions): WearableSensorFrame {
    const profile = options.profile ?? 'resting';
    const validProfiles: readonly WearableSimulationProfile[] = [
      'resting', 'walking', 'running', 'fall', 'stressed'
    ];
    if (!validProfiles.includes(profile)
      || !requireBoundedInteger(options.sequence, 0, Number.MAX_SAFE_INTEGER)) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }

    const deviceRef = options.deviceRef ?? 'simulated-wearable';
    const batteryLevelPercent = options.batteryLevelPercent ?? 82;
    const defaultSteps = profile === 'running'
      ? 7_600
      : profile === 'walking'
        ? 4_200
        : 1_824;
    const stepsToday = options.stepsToday
      ?? Math.min(1_000_000, defaultSteps + (options.sequence % 1_000));
    if (!this.isValidDeviceRef(deviceRef)
      || !isFiniteNumber(batteryLevelPercent)
      || batteryLevelPercent < 0 || batteryLevelPercent > 100
      || !requireBoundedInteger(stepsToday, 0, 1_000_000)) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }

    const sampleCount = 32;
    const sampleIntervalMs = 40;
    const accelerometer: AccelerometerSample[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const phase = (index / sampleCount) * Math.PI * 2;
      const noise = () => (this.nextRandom() - 0.5) * 0.03;
      let xG = noise();
      let yG = noise();
      let zG = 1 + noise();

      if (profile === 'walking') {
        xG += Math.sin(phase * 2) * 0.18;
        yG += Math.cos(phase * 2) * 0.12;
        zG += Math.sin(phase * 4) * 0.35;
      } else if (profile === 'running') {
        xG += Math.sin(phase * 3) * 0.65;
        yG += Math.cos(phase * 3) * 0.45;
        zG += Math.sin(phase * 6) * 1.05;
      } else if (profile === 'fall') {
        if (index === 11) {
          xG = 0.9;
          yG = 0.5;
          zG = 3.4;
        } else if (index > 15) {
          xG = noise() * 0.3;
          yG = 0.96 + noise() * 0.3;
          zG = 0.22 + noise() * 0.3;
        }
      }

      accelerometer.push({
        atOffsetMs: index * sampleIntervalMs,
        xG: round(xG, 4),
        yG: round(yG, 4),
        zG: round(zG, 4)
      });
    }

    const vitalProfile = profile === 'stressed'
      ? { heartRateBpm: 104, hrvRmssdMs: 16, temperatureC: 36.9 }
      : profile === 'running'
        ? { heartRateBpm: 142, hrvRmssdMs: 28, temperatureC: 37.2 }
        : { heartRateBpm: 68, hrvRmssdMs: 54, temperatureC: 36.5 };

    return {
      contractVersion: 'vl-wearable-sensors/1',
      deviceRef,
      sequence: options.sequence,
      capturedAtMs: this.readClock(),
      sampleWindowMs: (sampleCount - 1) * sampleIntervalMs,
      accelerometer,
      ppg: {
        heartRateBpm: round(vitalProfile.heartRateBpm + (this.nextRandom() - 0.5) * 2),
        hrvRmssdMs: round(vitalProfile.hrvRmssdMs + (this.nextRandom() - 0.5) * 2),
        signalQuality: round(0.94 + this.nextRandom() * 0.04, 3)
      },
      skinTemperatureC: round(vitalProfile.temperatureC + (this.nextRandom() - 0.5) * 0.1),
      battery: {
        levelPercent: round(batteryLevelPercent, 1),
        voltageV: round(3.3 + (batteryLevelPercent / 100) * 0.9, 3)
      },
      stepsToday
    };
  }

  /** Run the local deterministic heuristic model and create the cloud relay payload. */
  infer(frame: WearableSensorFrame): WearableInferenceEnvelope {
    const now = this.readClock();
    this.validateFrame(frame, now);

    const magnitudes = frame.accelerometer.map(magnitude);
    const peakG = Math.max(...magnitudes);
    const peakIndex = magnitudes.indexOf(peakG);
    const postImpact = frame.accelerometer.slice(Math.min(peakIndex + 3, frame.accelerometer.length - 1));
    const postImpactDynamicRms = Math.sqrt(postImpact.reduce((sum, sample) => {
      const delta = magnitude(sample) - 1;
      return sum + delta ** 2;
    }, 0) / postImpact.length);
    const fallDetected = peakG >= 2.7 && postImpact.length >= 6 && postImpactDynamicRms <= 0.16;
    const fallConfidence = fallDetected
      ? clamp(0.72 + (peakG - 2.7) * 0.08 + (0.16 - postImpactDynamicRms), 0, 0.99)
      : clamp((peakG - 1.5) / 2.5, 0.01, 0.69);

    const dynamicRms = Math.sqrt(magnitudes.reduce((sum, value) => {
      return sum + (value - 1) ** 2;
    }, 0) / magnitudes.length);
    const activity: WearableActivity = fallDetected
      ? 'fall'
      : dynamicRms < 0.08
        ? 'resting'
        : dynamicRms < 0.45
          ? 'walking'
          : 'running';

    // A non-clinical synthetic score used solely for orchestration testing.
    // Activity-adjusted references avoid treating expected exercise physiology
    // as emotional stress in the simulator.
    const expectedHeartRate = activity === 'running' ? 135 : activity === 'walking' ? 90 : 70;
    const expectedHrv = activity === 'running' ? 30 : 40;
    const lowHrvContribution = (expectedHrv - frame.ppg.hrvRmssdMs) * 1.25;
    const elevatedHeartRateContribution = (frame.ppg.heartRateBpm - expectedHeartRate) * 0.55;
    const temperatureContribution = Math.max(0, frame.skinTemperatureC - 37) * 8;
    const stressScore = clamp(Math.round(
      42 + lowHrvContribution + elevatedHeartRateContribution + temperatureContribution
    ), 0, 100);

    const sampleRateHz = frame.accelerometer.length / (frame.sampleWindowMs / 1_000);
    const estimatedDrain = clamp(0.45 + sampleRateHz * 0.035, 0, 10);

    return {
      contractVersion: 'vl-wearable-inference/1',
      sourceDeviceRef: frame.deviceRef,
      sequence: frame.sequence,
      observedAtMs: frame.capturedAtMs,
      emittedAtMs: now,
      model: {
        name: 'wearable-edge-sim',
        version: '1.0.0',
        mode: 'deterministic-simulation',
        clinicallyValidated: false
      },
      inference: {
        fallDetected,
        fallConfidence: round(fallConfidence, 3),
        stressScore,
        activity
      },
      telemetry: {
        heartRateBpm: frame.ppg.heartRateBpm,
        hrvRmssdMs: frame.ppg.hrvRmssdMs,
        skinTemperatureC: frame.skinTemperatureC,
        batteryPercent: frame.battery.levelPercent,
        stepsToday: frame.stepsToday
      },
      batteryEstimate: {
        estimatedAdditionalDrainPercentPerDay: round(estimatedDrain, 2),
        estimatedEnergyMilliJoulesPerInference: round(0.75 + sampleRateHz * 0.018, 3)
      }
    };
  }

  serializeOutbound(envelope: WearableInferenceEnvelope): string {
    this.validateEnvelope(envelope);
    // Rebuild the payload from an allowlist so an untyped caller cannot append
    // raw sensor samples or unrelated private data to the cloud relay frame.
    return JSON.stringify({
      contractVersion: envelope.contractVersion,
      sourceDeviceRef: envelope.sourceDeviceRef,
      sequence: envelope.sequence,
      observedAtMs: envelope.observedAtMs,
      emittedAtMs: envelope.emittedAtMs,
      model: {
        name: envelope.model.name,
        version: envelope.model.version,
        mode: envelope.model.mode,
        clinicallyValidated: envelope.model.clinicallyValidated
      },
      inference: {
        fallDetected: envelope.inference.fallDetected,
        fallConfidence: envelope.inference.fallConfidence,
        stressScore: envelope.inference.stressScore,
        activity: envelope.inference.activity
      },
      telemetry: {
        heartRateBpm: envelope.telemetry.heartRateBpm,
        hrvRmssdMs: envelope.telemetry.hrvRmssdMs,
        skinTemperatureC: envelope.telemetry.skinTemperatureC,
        batteryPercent: envelope.telemetry.batteryPercent,
        stepsToday: envelope.telemetry.stepsToday
      },
      batteryEstimate: {
        estimatedAdditionalDrainPercentPerDay:
          envelope.batteryEstimate.estimatedAdditionalDrainPercentPerDay,
        estimatedEnergyMilliJoulesPerInference:
          envelope.batteryEstimate.estimatedEnergyMilliJoulesPerInference
      }
    });
  }

  private nextRandom(): number {
    const value = this.random();
    if (!isFiniteNumber(value) || value < 0 || value >= 1) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }
    return value;
  }

  private readClock(): number {
    const value = this.clockNow();
    if (!requireBoundedInteger(value, 0, Number.MAX_SAFE_INTEGER)) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }
    return value;
  }

  private isValidDeviceRef(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= MAX_DEVICE_REF_LENGTH
      && /^[A-Za-z0-9._:-]+$/.test(value);
  }

  private validateFrame(frame: WearableSensorFrame, now: number): void {
    if (!frame || typeof frame !== 'object'
      || frame.contractVersion !== 'vl-wearable-sensors/1'
      || !this.isValidDeviceRef(frame.deviceRef)
      || !requireBoundedInteger(frame.sequence, 0, Number.MAX_SAFE_INTEGER)
      || !requireBoundedInteger(frame.capturedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || !isFiniteNumber(frame.sampleWindowMs)
      || frame.sampleWindowMs <= 0 || frame.sampleWindowMs > MAX_WINDOW_MS
      || !Array.isArray(frame.accelerometer)
      || frame.accelerometer.length < MIN_ACCEL_SAMPLES
      || frame.accelerometer.length > MAX_ACCEL_SAMPLES
      || !frame.ppg || typeof frame.ppg !== 'object'
      || !frame.battery || typeof frame.battery !== 'object') {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }

    if (frame.capturedAtMs < now - this.staleAfterMs
      || frame.capturedAtMs > now + this.maxFutureSkewMs) {
      throw new WearableEdgeAIError('EDGE_INPUT_STALE');
    }

    let previousOffset = -1;
    for (const sample of frame.accelerometer) {
      if (!sample || typeof sample !== 'object'
        || !isFiniteNumber(sample.atOffsetMs) || sample.atOffsetMs < 0
        || sample.atOffsetMs > frame.sampleWindowMs || sample.atOffsetMs <= previousOffset
        || !isFiniteNumber(sample.xG) || Math.abs(sample.xG) > 16
        || !isFiniteNumber(sample.yG) || Math.abs(sample.yG) > 16
        || !isFiniteNumber(sample.zG) || Math.abs(sample.zG) > 16) {
        throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
      }
      previousOffset = sample.atOffsetMs;
    }

    if (!isFiniteNumber(frame.ppg.heartRateBpm)
      || frame.ppg.heartRateBpm < 25 || frame.ppg.heartRateBpm > 240
      || !isFiniteNumber(frame.ppg.hrvRmssdMs)
      || frame.ppg.hrvRmssdMs < 1 || frame.ppg.hrvRmssdMs > 300
      || !isFiniteNumber(frame.ppg.signalQuality)
      || frame.ppg.signalQuality < 0 || frame.ppg.signalQuality > 1
      || !isFiniteNumber(frame.skinTemperatureC)
      || frame.skinTemperatureC < 25 || frame.skinTemperatureC > 45
      || !isFiniteNumber(frame.battery.levelPercent)
      || frame.battery.levelPercent < 0 || frame.battery.levelPercent > 100
      || !isFiniteNumber(frame.battery.voltageV)
      || frame.battery.voltageV < 2.5 || frame.battery.voltageV > 5
      || !requireBoundedInteger(frame.stepsToday, 0, 1_000_000)) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }
  }

  private validateEnvelope(envelope: WearableInferenceEnvelope): void {
    if (!envelope || typeof envelope !== 'object'
      || envelope.contractVersion !== 'vl-wearable-inference/1'
      || !this.isValidDeviceRef(envelope.sourceDeviceRef)
      || !requireBoundedInteger(envelope.sequence, 0, Number.MAX_SAFE_INTEGER)
      || !requireBoundedInteger(envelope.observedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || !requireBoundedInteger(envelope.emittedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || envelope.model?.name !== 'wearable-edge-sim'
      || envelope.model?.version !== '1.0.0'
      || envelope.model?.mode !== 'deterministic-simulation'
      || envelope.model?.clinicallyValidated !== false
      || typeof envelope.inference?.fallDetected !== 'boolean'
      || !isFiniteNumber(envelope.inference?.fallConfidence)
      || envelope.inference.fallConfidence < 0 || envelope.inference.fallConfidence > 1
      || !isFiniteNumber(envelope.inference?.stressScore)
      || envelope.inference.stressScore < 0 || envelope.inference.stressScore > 100
      || !(['resting', 'walking', 'running', 'fall'] as const).includes(envelope.inference?.activity)
      || !isFiniteNumber(envelope.telemetry?.heartRateBpm)
      || envelope.telemetry.heartRateBpm < 25 || envelope.telemetry.heartRateBpm > 240
      || !isFiniteNumber(envelope.telemetry?.hrvRmssdMs)
      || envelope.telemetry.hrvRmssdMs < 1 || envelope.telemetry.hrvRmssdMs > 300
      || !isFiniteNumber(envelope.telemetry?.skinTemperatureC)
      || envelope.telemetry.skinTemperatureC < 25 || envelope.telemetry.skinTemperatureC > 45
      || !isFiniteNumber(envelope.telemetry?.batteryPercent)
      || envelope.telemetry.batteryPercent < 0 || envelope.telemetry.batteryPercent > 100
      || !requireBoundedInteger(envelope.telemetry?.stepsToday, 0, 1_000_000)
      || !isFiniteNumber(envelope.batteryEstimate?.estimatedAdditionalDrainPercentPerDay)
      || envelope.batteryEstimate.estimatedAdditionalDrainPercentPerDay < 0
      || envelope.batteryEstimate.estimatedAdditionalDrainPercentPerDay > 10
      || !isFiniteNumber(envelope.batteryEstimate?.estimatedEnergyMilliJoulesPerInference)
      || envelope.batteryEstimate.estimatedEnergyMilliJoulesPerInference < 0
      || envelope.batteryEstimate.estimatedEnergyMilliJoulesPerInference > 100) {
      throw new WearableEdgeAIError('EDGE_INPUT_INVALID');
    }
  }
}
