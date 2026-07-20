import { createHash } from 'node:crypto';
import type { RobotEdgeInferenceEnvelope } from '../edge/RobotEdgeAI';
import type { WearableInferenceEnvelope } from '../edge/WearableEdgeAI';
import {
  AccountDataConflictError,
  UserStateModel,
  type DeviceState,
  type LocationContext,
  type UserStateSnapshot,
  type UserStateUpdate
} from '../models/UserState';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface TelemetryIngestionContext {
  readonly locationContext?: LocationContext;
}

function observedAt(epochMs: number): string {
  if (!Number.isSafeInteger(epochMs) || epochMs <= 0) throw new TypeError('Telemetry timestamp is invalid');
  return new Date(epochMs).toISOString();
}

function idempotencyKey(kind: string, sourceRef: string, sequence: number): string {
  return `telemetry_${createHash('sha256')
    .update(`${kind}\u0000${sourceRef}\u0000${sequence}`)
    .digest('base64url')}`;
}

function mergeDevice(
  devices: readonly DeviceState[],
  replacement: DeviceState
): readonly DeviceState[] {
  const existing = devices.find((device) => device.deviceId === replacement.deviceId);
  if (existing && timestamp(existing.observedAt) > timestamp(replacement.observedAt)) {
    return Object.freeze(devices.map((device) => ({ ...device })));
  }
  return Object.freeze([
    ...devices
      .filter((device) => device.deviceId !== replacement.deviceId)
      .map((device) => ({ ...device })),
    { ...replacement }
  ].slice(-16));
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Telemetry timestamp is invalid');
  return parsed;
}

function isCurrentOrNewer(
  candidate: Readonly<{ observedAt: string }> | null | undefined,
  existing: Readonly<{ observedAt: string }> | null | undefined
): boolean {
  return candidate !== null && candidate !== undefined
    && (existing === null || existing === undefined
      || timestamp(candidate.observedAt) >= timestamp(existing.observedAt));
}

function isValidStepProgression(
  candidate: Readonly<{ value: number; observedAt: string }> | null | undefined,
  existing: Readonly<{ value: number; observedAt: string }> | null | undefined
): boolean {
  if (!isCurrentOrNewer(candidate, existing)) return false;
  if (!existing || !candidate) return true;
  const candidateDay = new Date(timestamp(candidate.observedAt)).toISOString().slice(0, 10);
  const existingDay = new Date(timestamp(existing.observedAt)).toISOString().slice(0, 10);
  // The envelope defines a UTC day-to-date counter: it is monotonic within a
  // day, but a lower value is valid after the UTC day rolls over.
  return candidateDay !== existingDay || candidate.value >= existing.value;
}

/**
 * CAS retries can observe state written by a different device/source. Rebuild
 * each patch from allowlisted fields so an older observation can never replace
 * a newer field even after router restart or cross-source concurrency.
 */
function withoutTimestampRegressions(
  current: UserStateSnapshot | null,
  update: UserStateUpdate
): UserStateUpdate {
  const heartRateBpm = update.physical?.heartRateBpm;
  const hrvMs = update.physical?.hrvMs;
  const steps = update.physical?.steps;
  const activity = update.physical?.activity;
  const temperatureCelsius = update.physical?.temperatureCelsius;
  const stressScore = update.emotional?.stressScore;
  const emotionalTone = update.emotional?.emotionalTone;
  const location = update.context?.location;
  const physical = {
    ...(isCurrentOrNewer(heartRateBpm, current?.physical.heartRateBpm) ? { heartRateBpm } : {}),
    ...(isCurrentOrNewer(hrvMs, current?.physical.hrvMs) ? { hrvMs } : {}),
    ...(isValidStepProgression(steps, current?.physical.steps) ? { steps } : {}),
    ...(isCurrentOrNewer(activity, current?.physical.activity) ? { activity } : {}),
    ...(isCurrentOrNewer(temperatureCelsius, current?.physical.temperatureCelsius)
      ? { temperatureCelsius }
      : {})
  };
  const emotional = {
    ...(isCurrentOrNewer(stressScore, current?.emotional.stressScore) ? { stressScore } : {}),
    ...(isCurrentOrNewer(emotionalTone, current?.emotional.emotionalTone) ? { emotionalTone } : {})
  };
  const contextual = {
    ...(isCurrentOrNewer(location, current?.context.location) ? { location } : {})
  };
  return {
    ...(Object.keys(physical).length > 0 ? { physical } : {}),
    ...(Object.keys(emotional).length > 0 ? { emotional } : {}),
    ...(Object.keys(contextual).length > 0 ? { context: contextual } : {})
  };
}

/**
 * Authenticated inference-to-state bridge. It stores bounded derived values;
 * raw accelerometer, camera, microphone, transcripts and biometric templates
 * are deliberately outside this contract.
 */
export class TelemetryStateIngestor {
  constructor(private readonly userState: UserStateModel) {}

  async ingestWearable(
    accountId: string,
    deviceId: string,
    envelope: WearableInferenceEnvelope,
    context: TelemetryIngestionContext = {},
    signal?: AbortSignal
  ): Promise<void> {
    this.validateDevice(deviceId, envelope.sourceDeviceRef);
    const at = observedAt(envelope.observedAtMs);
    const activity = envelope.inference.activity === 'fall' ? 'other' : envelope.inference.activity;
    await this.updateWithDevice(accountId, {
      physical: {
        heartRateBpm: { value: envelope.telemetry.heartRateBpm, observedAt: at },
        hrvMs: { value: envelope.telemetry.hrvRmssdMs, observedAt: at },
        steps: { value: envelope.telemetry.stepsToday, observedAt: at },
        temperatureCelsius: { value: envelope.telemetry.skinTemperatureC, observedAt: at },
        activity: { type: activity, activeMinutes: 0, observedAt: at }
      },
      emotional: { stressScore: { value: envelope.inference.stressScore, observedAt: at } },
      ...(context.locationContext
        ? { context: { location: { context: context.locationContext, observedAt: at } } }
        : {})
    }, {
      deviceId,
      type: 'wearable',
      batteryPercent: envelope.telemetry.batteryPercent,
      connectivity: 'online',
      lastKnownState: envelope.inference.activity,
      observedAt: at
    }, idempotencyKey('wearable', envelope.sourceDeviceRef, envelope.sequence), signal);
  }

  async ingestRobot(
    accountId: string,
    deviceId: string,
    envelope: RobotEdgeInferenceEnvelope,
    context: TelemetryIngestionContext = {},
    signal?: AbortSignal
  ): Promise<void> {
    this.validateDevice(deviceId, envelope.sourceDeviceRef);
    const at = observedAt(envelope.observedAtMs);
    const expression = envelope.inference.vision.facialExpression;
    const valence = expression === 'positive' ? 0.7
      : expression === 'distressed' ? -0.8
        : expression === 'sad' ? -0.55
          : 0;
    await this.updateWithDevice(accountId, {
      emotional: {
        emotionalTone: {
          valence,
          arousal: envelope.inference.voice.emotion === 'distressed' ? 0.85 : 0.25,
          label: expression,
          observedAt: at
        }
      },
      ...(context.locationContext
        ? { context: { location: { context: context.locationContext, observedAt: at } } }
        : {})
    }, {
      deviceId,
      type: 'home_robot',
      connectivity: 'online',
      lastKnownState: envelope.inference.motor.state,
      observedAt: at
    }, idempotencyKey('robot', envelope.sourceDeviceRef, envelope.sequence), signal);
  }

  private async updateWithDevice(
    accountId: string,
    update: UserStateUpdate,
    device: DeviceState,
    receipt: string,
    signal?: AbortSignal
  ): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (signal?.aborted) throw Object.assign(new Error('Telemetry ingestion was cancelled'), {
        name: 'AbortError', code: 'OPERATION_CANCELLED'
      });
      const current = await this.userState.getCurrentState(accountId);
      const monotonicUpdate = withoutTimestampRegressions(current, update);
      try {
        await this.userState.updateState(accountId, {
          ...monotonicUpdate,
          devices: mergeDevice(current?.devices ?? [], device)
        }, {
          idempotencyKey: receipt,
          expectedRevision: current?.revision ?? 0,
          signal
        });
        return;
      } catch (error) {
        if (!(error instanceof AccountDataConflictError)
          || error.message.includes('deleted')
          || attempt === 3) throw error;
      }
    }
  }

  private validateDevice(deviceId: string, sourceRef: string): void {
    if (!IDENTIFIER.test(deviceId ?? '') || !IDENTIFIER.test(sourceRef ?? '')) {
      throw new TypeError('Telemetry device binding is invalid');
    }
  }
}
