/**
 * Deterministic Product 2 edge-AI simulator.
 *
 * Camera and microphone inputs are represented only as bounded, synthetic
 * feature vectors. No image, voiceprint, raw audio, transcript, or facial
 * embedding is retained. The heuristic outputs are not clinically validated.
 */

export type RobotSimulationProfile =
  | 'idle'
  | 'navigating'
  | 'fall'
  | 'distressed'
  | 'help_request'
  | 'happy';

export type RobotFacialExpression =
  | 'not_observed'
  | 'calm'
  | 'positive'
  | 'neutral'
  | 'sad'
  | 'distressed';

export type RobotSpeechIntent =
  | 'none'
  | 'greeting'
  | 'request_help'
  | 'cancel'
  | 'report_discomfort';

export type RobotSpeechEmotion = 'not_observed' | 'calm' | 'positive' | 'neutral' | 'distressed';
export type RobotKeyword = 'none' | 'hello' | 'help' | 'stop' | 'pain';
export type RobotMotorMode = 'idle' | 'navigating' | 'docked' | 'stopped';

export interface RobotEdgeFeatureFrame {
  readonly contractVersion: 'vl-robot-edge-features/1';
  /** Account-bound opaque reference. It must never be written to logs. */
  readonly deviceRef: string;
  readonly sequence: number;
  readonly capturedAtMs: number;
  readonly vision: {
    readonly personDetected: boolean;
    /** Derived pose features only; no bitmap or biometric template. */
    readonly torsoAngleDegrees: number;
    readonly centerYNormalized: number;
    readonly floorProximity: number;
    readonly motionScore: number;
    readonly frameQuality: number;
    readonly expression: {
      readonly valence: number;
      readonly arousal: number;
      readonly confidence: number;
    };
  };
  readonly audio: {
    /** Derived acoustic features only; raw microphone samples are not retained. */
    readonly voiceActivity: boolean;
    readonly rmsDbfs: number;
    readonly spectralCentroidHz: number;
    readonly zeroCrossingRate: number;
    readonly keyword: RobotKeyword;
    readonly prosody: {
      readonly valence: number;
      readonly arousal: number;
      readonly confidence: number;
    };
  };
  readonly motor: {
    readonly mode: RobotMotorMode;
    readonly linearVelocityMetersPerSecond: number;
    readonly obstacleDistanceMeters: number;
    readonly controllerTemperatureC: number;
    readonly emergencyStopEngaged: boolean;
  };
}

export interface RobotEdgeInferenceEnvelope {
  readonly contractVersion: 'vl-robot-edge-inference/1';
  readonly sourceDeviceRef: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly emittedAtMs: number;
  readonly model: {
    readonly name: 'robot-edge-sim';
    readonly version: '1.0.0';
    readonly mode: 'deterministic-simulation';
    readonly clinicallyValidated: false;
    readonly rawMediaRetained: false;
  };
  readonly inference: {
    readonly vision: {
      readonly fallDetected: boolean;
      readonly fallConfidence: number;
      readonly facialExpression: RobotFacialExpression;
      readonly expressionConfidence: number;
    };
    readonly voice: {
      readonly intent: RobotSpeechIntent;
      readonly emotion: RobotSpeechEmotion;
      readonly confidence: number;
      readonly processedOffline: true;
    };
    readonly motor: {
      readonly state: RobotMotorMode;
      readonly safeToMove: boolean;
    };
  };
}

export interface RobotEdgeAIOptions {
  readonly clockNow?: () => number;
  readonly random?: () => number;
  readonly staleAfterMs?: number;
  readonly maxFutureSkewMs?: number;
}

export interface GenerateRobotFrameOptions {
  readonly deviceRef?: string;
  readonly sequence: number;
  readonly profile?: RobotSimulationProfile;
}

export type RobotEdgeErrorCode = 'EDGE_INPUT_INVALID' | 'EDGE_INPUT_STALE';

export class RobotEdgeAIError extends Error {
  readonly code: RobotEdgeErrorCode;

  constructor(code: RobotEdgeErrorCode) {
    // Keep error text free of sensor values, speech features, and identity.
    super(code === 'EDGE_INPUT_STALE'
      ? 'Robot edge input is outside the accepted time window'
      : 'Robot edge input failed validation');
    this.name = 'RobotEdgeAIError';
    this.code = code;
  }
}

/**
 * Provisional edge-module boundary. The manufacturer must approve the final
 * connector, voltage, UART speed, GPIO polarity, and thermal envelope before
 * this contract is used on physical hardware.
 */
export const ROBOT_EDGE_CONTRACT = Object.freeze({
  inputVersion: 'vl-robot-edge-features/1' as const,
  outputVersion: 'vl-robot-edge-inference/1' as const,
  mediaFormats: Object.freeze({
    cameraCapture: 'RGB or NV12, 720p minimum, 15 frames/second minimum; features leave camera process',
    microphoneCapture: 'PCM signed 16-bit little-endian, mono, 16 kHz; derived features leave audio process',
    privacyBoundary: 'No raw camera frame, raw audio, transcript, voiceprint, or face embedding in cloud envelope'
  }),
  moduleLink: Object.freeze({
    protocol: 'versioned CBOR frames over UART or USB CDC; JSON-equivalent simulator shape',
    framing: 'COBS frame + uint32 sequence + uint64 timestamp + payload + CRC32',
    defaultSerialBaud: 921_600,
    maximumEncodedFrameBytes: 16_384,
    gpioEmergencyStop: 'dedicated fail-safe input; manufacturer-approved active polarity required',
    gpioInferenceReady: 'optional edge-triggered output; manufacturer-approved voltage required'
  }),
  targetHardware: Object.freeze({
    cpu: '64-bit ARM, 4 cores minimum',
    accelerator: 'NPU at least 2 TOPS or equivalent GPU inference throughput',
    minimumRamMiB: 4096,
    minimumAvailableStorageGiB: 16,
    recommendedRuntime: 'TensorFlow Lite, ONNX Runtime, or manufacturer NPU runtime',
    maximumVisionInferenceLatencyMs: 100,
    maximumOfflineVoiceIntentLatencyMs: 250
  }),
  productionModelCandidates: Object.freeze({
    visionFall: 'quantized pose-estimation features plus temporal 1D CNN',
    facialExpression: 'quantized MobileNetV3-Small feature classifier; no embedding retention',
    offlineVoice: 'small-footprint keyword/intent classifier plus prosody classifier',
    note: 'Candidate architectures only; vendor runtime profiling and safety validation remain external gates'
  }),
  featureBounds: Object.freeze({
    maximumTorsoAngleDegrees: 180,
    maximumSpectralCentroidHz: 12_000,
    maximumLinearVelocityMetersPerSecond: 2,
    maximumObstacleDistanceMeters: 50
  })
});

const MAX_DEVICE_REF_LENGTH = 128;
const DEFAULT_STALE_AFTER_MS = 5_000;
const DEFAULT_FUTURE_SKEW_MS = 1_000;
const VALID_PROFILES: readonly RobotSimulationProfile[] = [
  'idle', 'navigating', 'fall', 'distressed', 'help_request', 'happy'
];
const VALID_KEYWORDS: readonly RobotKeyword[] = ['none', 'hello', 'help', 'stop', 'pain'];
const VALID_MOTOR_MODES: readonly RobotMotorMode[] = ['idle', 'navigating', 'docked', 'stopped'];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBounded(value: unknown, minimum: number, maximum: number): value is number {
  return isFiniteNumber(value) && value >= minimum && value <= maximum;
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 3): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** Mulberry32: deterministic and suitable for simulation, never cryptography. */
export function createRobotSeededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed)) {
    throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
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

export class RobotEdgeAI {
  private readonly clockNow: () => number;
  private readonly random: () => number;
  private readonly staleAfterMs: number;
  private readonly maxFutureSkewMs: number;

  constructor(options: RobotEdgeAIOptions = {}) {
    this.clockNow = options.clockNow ?? Date.now;
    this.random = options.random ?? Math.random;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
    if (!isFiniteNumber(this.staleAfterMs) || this.staleAfterMs <= 0
      || !isFiniteNumber(this.maxFutureSkewMs) || this.maxFutureSkewMs < 0) {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }
  }

  /** Generate bounded feature vectors without producing or retaining media. */
  generateFrame(options: GenerateRobotFrameOptions): RobotEdgeFeatureFrame {
    const profile = options.profile ?? 'idle';
    const deviceRef = options.deviceRef ?? 'simulated-home-robot';
    if (!VALID_PROFILES.includes(profile)
      || !this.isValidDeviceRef(deviceRef)
      || !isBoundedInteger(options.sequence, 0, Number.MAX_SAFE_INTEGER)) {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }

    const noise = (amplitude: number) => (this.nextRandom() - 0.5) * amplitude;
    const isFall = profile === 'fall';
    const isDistressed = profile === 'distressed' || profile === 'help_request';
    const isHappy = profile === 'happy';
    const isNavigating = profile === 'navigating';
    const keyword: RobotKeyword = profile === 'help_request'
      ? 'help'
      : profile === 'distressed'
        ? 'pain'
        : profile === 'happy'
          ? 'hello'
          : 'none';

    return {
      contractVersion: 'vl-robot-edge-features/1',
      deviceRef,
      sequence: options.sequence,
      capturedAtMs: this.readClock(),
      vision: {
        personDetected: true,
        torsoAngleDegrees: round(isFall ? 87 + noise(2) : 7 + noise(3)),
        centerYNormalized: round(isFall ? 0.88 + noise(0.02) : 0.5 + noise(0.04)),
        floorProximity: round(isFall ? 0.94 + noise(0.02) : 0.14 + noise(0.04)),
        motionScore: round(isFall ? 0.04 + noise(0.02) : isNavigating ? 0.46 + noise(0.05) : 0.12 + noise(0.03)),
        frameQuality: round(0.94 + noise(0.04)),
        expression: {
          valence: round(isDistressed ? -0.72 + noise(0.05) : isHappy ? 0.7 + noise(0.05) : 0.12 + noise(0.06)),
          arousal: round(isDistressed ? 0.84 + noise(0.05) : isHappy ? 0.58 + noise(0.05) : 0.24 + noise(0.05)),
          confidence: round(0.91 + noise(0.04))
        }
      },
      audio: {
        voiceActivity: keyword !== 'none',
        rmsDbfs: round(keyword === 'none' ? -64 + noise(4) : -22 + noise(4)),
        spectralCentroidHz: round(keyword === 'none' ? 750 + noise(100) : 1_850 + noise(250), 1),
        zeroCrossingRate: round(keyword === 'none' ? 0.05 + noise(0.01) : 0.13 + noise(0.03)),
        keyword,
        prosody: {
          valence: round(isDistressed ? -0.76 + noise(0.04) : isHappy ? 0.67 + noise(0.05) : 0.05 + noise(0.04)),
          arousal: round(isDistressed ? 0.9 + noise(0.04) : isHappy ? 0.58 + noise(0.05) : 0.18 + noise(0.04)),
          confidence: round(keyword === 'none' ? 0 : 0.89 + noise(0.04))
        }
      },
      motor: {
        mode: isNavigating ? 'navigating' : 'idle',
        linearVelocityMetersPerSecond: round(isNavigating ? 0.35 + noise(0.05) : 0),
        obstacleDistanceMeters: round(isNavigating ? 1.8 + noise(0.2) : 3 + noise(0.3)),
        controllerTemperatureC: round(39 + noise(2), 1),
        emergencyStopEngaged: false
      }
    };
  }

  /** Run deterministic feature inference and create a cloud relay payload. */
  infer(frame: RobotEdgeFeatureFrame): RobotEdgeInferenceEnvelope {
    const now = this.readClock();
    this.validateFrame(frame, now);

    const fallDetected = frame.vision.personDetected
      && frame.vision.frameQuality >= 0.45
      && frame.vision.torsoAngleDegrees >= 65
      && frame.vision.floorProximity >= 0.78
      && frame.vision.motionScore <= 0.18;
    const fallConfidence = fallDetected
      ? clamp(
        0.68
          + (frame.vision.torsoAngleDegrees - 65) / 180
          + (frame.vision.floorProximity - 0.78) * 0.3
          + (0.18 - frame.vision.motionScore) * 0.25,
        0,
        0.99
      )
      : clamp((frame.vision.floorProximity + frame.vision.torsoAngleDegrees / 180) * 0.25, 0.01, 0.68);

    const facialExpression = this.classifyFacialExpression(frame);
    const intent = this.classifyIntent(frame.audio.keyword, frame.audio.voiceActivity);
    const voiceEmotion = this.classifyVoiceEmotion(frame);
    const voiceConfidence = frame.audio.voiceActivity
      ? clamp((frame.audio.prosody.confidence + (frame.audio.keyword === 'none' ? 0.4 : 0.95)) / 2, 0, 1)
      : 0;
    const safeToMove = !frame.motor.emergencyStopEngaged
      && frame.motor.controllerTemperatureC <= 80
      && frame.motor.obstacleDistanceMeters >= 0.35;

    return {
      contractVersion: 'vl-robot-edge-inference/1',
      sourceDeviceRef: frame.deviceRef,
      sequence: frame.sequence,
      observedAtMs: frame.capturedAtMs,
      emittedAtMs: now,
      model: {
        name: 'robot-edge-sim',
        version: '1.0.0',
        mode: 'deterministic-simulation',
        clinicallyValidated: false,
        rawMediaRetained: false
      },
      inference: {
        vision: {
          fallDetected,
          fallConfidence: round(fallConfidence),
          facialExpression,
          expressionConfidence: frame.vision.personDetected
            ? round(frame.vision.expression.confidence)
            : 0
        },
        voice: {
          intent,
          emotion: voiceEmotion,
          confidence: round(voiceConfidence),
          processedOffline: true
        },
        motor: {
          state: frame.motor.mode,
          safeToMove
        }
      }
    };
  }

  serializeOutbound(envelope: RobotEdgeInferenceEnvelope): string {
    this.validateEnvelope(envelope);
    // Canonical allowlist: untyped callers cannot attach raw media, transcripts,
    // biometric templates, or unrelated private data to this relay payload.
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
        clinicallyValidated: envelope.model.clinicallyValidated,
        rawMediaRetained: envelope.model.rawMediaRetained
      },
      inference: {
        vision: {
          fallDetected: envelope.inference.vision.fallDetected,
          fallConfidence: envelope.inference.vision.fallConfidence,
          facialExpression: envelope.inference.vision.facialExpression,
          expressionConfidence: envelope.inference.vision.expressionConfidence
        },
        voice: {
          intent: envelope.inference.voice.intent,
          emotion: envelope.inference.voice.emotion,
          confidence: envelope.inference.voice.confidence,
          processedOffline: envelope.inference.voice.processedOffline
        },
        motor: {
          state: envelope.inference.motor.state,
          safeToMove: envelope.inference.motor.safeToMove
        }
      }
    });
  }

  private classifyFacialExpression(frame: RobotEdgeFeatureFrame): RobotFacialExpression {
    if (!frame.vision.personDetected
      || frame.vision.frameQuality < 0.45
      || frame.vision.expression.confidence < 0.45) {
      return 'not_observed';
    }
    const { valence, arousal } = frame.vision.expression;
    if (valence <= -0.35 && arousal >= 0.55) return 'distressed';
    if (valence <= -0.35) return 'sad';
    if (valence >= 0.35) return 'positive';
    if (arousal <= 0.3) return 'calm';
    return 'neutral';
  }

  private classifyIntent(keyword: RobotKeyword, voiceActivity: boolean): RobotSpeechIntent {
    if (!voiceActivity) return 'none';
    if (keyword === 'help') return 'request_help';
    if (keyword === 'stop') return 'cancel';
    if (keyword === 'pain') return 'report_discomfort';
    if (keyword === 'hello') return 'greeting';
    return 'none';
  }

  private classifyVoiceEmotion(frame: RobotEdgeFeatureFrame): RobotSpeechEmotion {
    if (!frame.audio.voiceActivity || frame.audio.prosody.confidence < 0.45) return 'not_observed';
    if (frame.audio.prosody.valence <= -0.3 && frame.audio.prosody.arousal >= 0.55) return 'distressed';
    if (frame.audio.prosody.valence >= 0.3) return 'positive';
    if (frame.audio.prosody.arousal <= 0.3) return 'calm';
    return 'neutral';
  }

  private nextRandom(): number {
    const value = this.random();
    if (!isFiniteNumber(value) || value < 0 || value >= 1) {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }
    return value;
  }

  private readClock(): number {
    const value = this.clockNow();
    if (!isBoundedInteger(value, 0, Number.MAX_SAFE_INTEGER)) {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }
    return value;
  }

  private isValidDeviceRef(value: unknown): value is string {
    return typeof value === 'string' && value.length >= 1 && value.length <= MAX_DEVICE_REF_LENGTH
      && /^[A-Za-z0-9._:-]+$/.test(value);
  }

  private validateFrame(frame: RobotEdgeFeatureFrame, now: number): void {
    if (!frame || typeof frame !== 'object'
      || frame.contractVersion !== 'vl-robot-edge-features/1'
      || !this.isValidDeviceRef(frame.deviceRef)
      || !isBoundedInteger(frame.sequence, 0, Number.MAX_SAFE_INTEGER)
      || !isBoundedInteger(frame.capturedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || !frame.vision || typeof frame.vision !== 'object'
      || !frame.vision.expression || typeof frame.vision.expression !== 'object'
      || !frame.audio || typeof frame.audio !== 'object'
      || !frame.audio.prosody || typeof frame.audio.prosody !== 'object'
      || !frame.motor || typeof frame.motor !== 'object') {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }
    if (frame.capturedAtMs < now - this.staleAfterMs
      || frame.capturedAtMs > now + this.maxFutureSkewMs) {
      throw new RobotEdgeAIError('EDGE_INPUT_STALE');
    }

    const vision = frame.vision;
    const audio = frame.audio;
    const motor = frame.motor;
    if (typeof vision.personDetected !== 'boolean'
      || !isBounded(vision.torsoAngleDegrees, 0, 180)
      || !isBounded(vision.centerYNormalized, 0, 1)
      || !isBounded(vision.floorProximity, 0, 1)
      || !isBounded(vision.motionScore, 0, 1)
      || !isBounded(vision.frameQuality, 0, 1)
      || !isBounded(vision.expression.valence, -1, 1)
      || !isBounded(vision.expression.arousal, 0, 1)
      || !isBounded(vision.expression.confidence, 0, 1)
      || typeof audio.voiceActivity !== 'boolean'
      || !isBounded(audio.rmsDbfs, -120, 0)
      || !isBounded(audio.spectralCentroidHz, 0, 12_000)
      || !isBounded(audio.zeroCrossingRate, 0, 1)
      || !VALID_KEYWORDS.includes(audio.keyword)
      || !isBounded(audio.prosody.valence, -1, 1)
      || !isBounded(audio.prosody.arousal, 0, 1)
      || !isBounded(audio.prosody.confidence, 0, 1)
      || !VALID_MOTOR_MODES.includes(motor.mode)
      || !isBounded(motor.linearVelocityMetersPerSecond, 0, 2)
      || !isBounded(motor.obstacleDistanceMeters, 0, 50)
      || !isBounded(motor.controllerTemperatureC, -20, 100)
      || typeof motor.emergencyStopEngaged !== 'boolean') {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }
  }

  private validateEnvelope(envelope: RobotEdgeInferenceEnvelope): void {
    const visionExpressions: readonly RobotFacialExpression[] = [
      'not_observed', 'calm', 'positive', 'neutral', 'sad', 'distressed'
    ];
    const intents: readonly RobotSpeechIntent[] = [
      'none', 'greeting', 'request_help', 'cancel', 'report_discomfort'
    ];
    const voiceEmotions: readonly RobotSpeechEmotion[] = [
      'not_observed', 'calm', 'positive', 'neutral', 'distressed'
    ];
    if (!envelope || typeof envelope !== 'object'
      || envelope.contractVersion !== 'vl-robot-edge-inference/1'
      || !this.isValidDeviceRef(envelope.sourceDeviceRef)
      || !isBoundedInteger(envelope.sequence, 0, Number.MAX_SAFE_INTEGER)
      || !isBoundedInteger(envelope.observedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || !isBoundedInteger(envelope.emittedAtMs, 0, Number.MAX_SAFE_INTEGER)
      || envelope.model?.name !== 'robot-edge-sim'
      || envelope.model?.version !== '1.0.0'
      || envelope.model?.mode !== 'deterministic-simulation'
      || envelope.model?.clinicallyValidated !== false
      || envelope.model?.rawMediaRetained !== false
      || typeof envelope.inference?.vision?.fallDetected !== 'boolean'
      || !isBounded(envelope.inference?.vision?.fallConfidence, 0, 1)
      || !visionExpressions.includes(envelope.inference?.vision?.facialExpression)
      || !isBounded(envelope.inference?.vision?.expressionConfidence, 0, 1)
      || !intents.includes(envelope.inference?.voice?.intent)
      || !voiceEmotions.includes(envelope.inference?.voice?.emotion)
      || !isBounded(envelope.inference?.voice?.confidence, 0, 1)
      || envelope.inference?.voice?.processedOffline !== true
      || !VALID_MOTOR_MODES.includes(envelope.inference?.motor?.state)
      || typeof envelope.inference?.motor?.safeToMove !== 'boolean') {
      throw new RobotEdgeAIError('EDGE_INPUT_INVALID');
    }
  }
}
