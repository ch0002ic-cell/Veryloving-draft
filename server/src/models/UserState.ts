import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const ISO_DATE_MAX_LENGTH = 40;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_DEVICES = 16;
const MAX_STRING = 128;
const MAX_ENCRYPTED_BYTES = 16 * 1_024 * 1_024;
const STATE_SCHEMA_VERSION = 1 as const;

export class AccountDataValidationError extends Error {
  readonly code = 'ACCOUNT_DATA_VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'AccountDataValidationError';
  }
}

export class AccountDataConflictError extends Error {
  readonly code = 'ACCOUNT_DATA_CONFLICT';

  constructor(message: string) {
    super(message);
    this.name = 'AccountDataConflictError';
  }
}

export class AccountDataIntegrityError extends Error {
  readonly code = 'ACCOUNT_DATA_INTEGRITY';

  constructor(message = 'Encrypted account data failed integrity verification') {
    super(message);
    this.name = 'AccountDataIntegrityError';
  }
}

export interface CiphertextRecord {
  readonly algorithm: 'aes-256-gcm';
  readonly keyVersion: number;
  /** Repository CAS revision. It is authenticated as additional data. */
  readonly revision: number;
  readonly iv: string;
  readonly authTag: string;
  readonly ciphertext: string;
}

/**
 * Versioned encryption material supplied by the deployment secret manager.
 *
 * Version 1 must remain present when `accountIndexKey` is omitted so existing
 * opaque repository keys remain addressable during an in-place key rotation.
 * A separately managed, stable account index key lets deployments retire old
 * data-encryption keys after every record has been rewrapped.
 */
export interface AccountDataKeyring {
  readonly currentVersion: number;
  readonly keys: Readonly<Record<number, Uint8Array>>;
  readonly accountIndexKey?: Uint8Array;
}

/**
 * Minimal persistence boundary. A production implementation can map this to a
 * conditional DynamoDB/SQL write without ever receiving plaintext account data.
 */
export interface CiphertextRepository {
  get(storageKey: string): Promise<CiphertextRecord | null>;
  compareAndSet(
    storageKey: string,
    expectedRevision: number | null,
    next: CiphertextRecord | null
  ): Promise<boolean>;
}

/** Test/development repository. It deliberately retains ciphertext only. */
export class InMemoryCiphertextRepository implements CiphertextRepository {
  private readonly records = new Map<string, CiphertextRecord>();
  private transactionTail: Promise<void> = Promise.resolve();

  async get(storageKey: string): Promise<CiphertextRecord | null> {
    const record = this.records.get(storageKey);
    return record === undefined ? null : { ...record };
  }

  async compareAndSet(
    storageKey: string,
    expectedRevision: number | null,
    next: CiphertextRecord | null
  ): Promise<boolean> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const current = this.records.get(storageKey);
      const actualRevision = current?.revision ?? null;
      if (actualRevision !== expectedRevision) return false;
      if (next === null) this.records.delete(storageKey);
      else this.records.set(storageKey, { ...next });
      return true;
    } finally {
      release();
    }
  }

  /** Returns defensive copies for assertions/diagnostics; account IDs are never keys. */
  inspectCiphertext(): readonly Readonly<{ storageKey: string; record: CiphertextRecord }>[] {
    return [...this.records.entries()].map(([storageKey, record]) => Object.freeze({
      storageKey,
      record: Object.freeze({ ...record })
    }));
  }
}

export type ActivityType = 'walking' | 'running' | 'resting' | 'sleeping' | 'other';
export type Mood = 'very_low' | 'low' | 'neutral' | 'good' | 'very_good' | 'unknown';
export type LocationContext = 'home' | 'away' | 'unknown';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';
export type Connectivity = 'online' | 'offline' | 'degraded' | 'unknown';
export type DeviceType = 'wearable' | 'home_robot';

export interface NumericObservation {
  readonly value: number;
  readonly observedAt: string;
}

export interface SleepObservation {
  readonly minutes: number;
  readonly qualityScore?: number;
  readonly observedAt: string;
}

export interface ActivityObservation {
  readonly type: ActivityType;
  readonly activeMinutes: number;
  readonly observedAt: string;
}

export interface PhysicalHealthState {
  readonly heartRateBpm?: NumericObservation;
  readonly hrvMs?: NumericObservation;
  readonly steps?: NumericObservation;
  readonly sleep?: SleepObservation;
  readonly activity?: ActivityObservation;
  readonly temperatureCelsius?: NumericObservation;
}

export interface MedicationAdherenceObservation {
  readonly scheduled: number;
  readonly taken: number;
  readonly missed: number;
  readonly rate: number;
  readonly observedAt: string;
}

export interface CognitiveHealthState {
  readonly medicationAdherence?: MedicationAdherenceObservation;
  readonly memoryAssessmentScore?: NumericObservation;
  readonly cognitiveEngagementPerWeek?: NumericObservation;
}

export interface EmotionalToneObservation {
  readonly valence: number;
  readonly arousal: number;
  readonly label?: string;
  readonly observedAt: string;
}

export interface EmotionalHealthState {
  readonly mood?: Readonly<{ value: Mood; observedAt: string }>;
  readonly stressScore?: NumericObservation;
  readonly emotionalTone?: EmotionalToneObservation;
}

export interface ContextualState {
  readonly location?: Readonly<{
    context: LocationContext;
    latitude?: number;
    longitude?: number;
    observedAt: string;
  }>;
  readonly timeOfDay?: TimeOfDay;
  readonly socialInteractionsToday?: NumericObservation;
  readonly environment?: Readonly<{
    temperatureCelsius?: number;
    noiseDb?: number;
    lightLux?: number;
    observedAt: string;
  }>;
}

export interface DeviceState {
  readonly deviceId: string;
  readonly type: DeviceType;
  readonly batteryPercent?: number;
  readonly connectivity: Connectivity;
  readonly lastKnownState: string;
  readonly observedAt: string;
}

export interface UserStateSnapshot {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly revision: number;
  readonly recordedAt: string;
  readonly physical: PhysicalHealthState;
  readonly cognitive: CognitiveHealthState;
  readonly emotional: EmotionalHealthState;
  readonly context: ContextualState;
  readonly devices: readonly DeviceState[];
}

type NullableFields<T> = { readonly [K in keyof T]?: T[K] | null };

export interface UserStateUpdate {
  readonly physical?: NullableFields<PhysicalHealthState>;
  readonly cognitive?: NullableFields<CognitiveHealthState>;
  readonly emotional?: NullableFields<EmotionalHealthState>;
  readonly context?: NullableFields<ContextualState>;
  /** Replaces the device collection atomically. */
  readonly devices?: readonly DeviceState[];
}

export type UserStateTrendMetric =
  | 'heart_rate_bpm'
  | 'hrv_ms'
  | 'steps'
  | 'sleep_minutes'
  | 'activity_minutes'
  | 'temperature_celsius'
  | 'medication_adherence_rate'
  | 'memory_assessment_score'
  | 'cognitive_engagement_per_week'
  | 'stress_score'
  | 'emotional_valence'
  | 'social_interactions_today';

export interface TrendQuery {
  readonly metric: UserStateTrendMetric;
  readonly from: string;
  readonly to: string;
  readonly limit?: number;
}

export interface TrendPoint {
  readonly metric: UserStateTrendMetric;
  readonly value: number;
  readonly observedAt: string;
  readonly stateRevision: number;
}

export interface UserStateExport {
  readonly format: 'veryloving-user-state';
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly current: UserStateSnapshot | null;
  readonly history: readonly UserStateSnapshot[];
}

export interface UserStateUpdateOptions {
  readonly idempotencyKey?: string;
  readonly expectedRevision?: number;
  readonly signal?: AbortSignal;
}

interface IdempotencyReceipt {
  readonly fingerprint: string;
  readonly result: UserStateSnapshot;
}

interface UserStateAggregate {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION;
  readonly history: readonly UserStateSnapshot[];
  readonly receipts: Readonly<Record<string, IdempotencyReceipt>>;
  readonly receiptOrder: readonly string[];
}

export interface UserStateModelOptions {
  readonly repository: CiphertextRepository;
  /** Legacy single-key configuration. Exactly 32 bytes and treated as version 1. */
  readonly encryptionKey?: Uint8Array;
  /** Preferred rotation-safe configuration. Mutually exclusive with `encryptionKey`. */
  readonly encryptionKeyring?: AccountDataKeyring;
  readonly clock?: () => Date;
  readonly maxHistory?: number;
  readonly maxIdempotencyRecords?: number;
  readonly maxWriteRetries?: number;
}

function validation(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AccountDataValidationError(message);
}

function plainObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  validation(typeof value === 'object' && value !== null && !Array.isArray(value), `${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  validation(prototype === Object.prototype || prototype === null, `${name} must be a plain object`);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) validation(allowed.includes(key), `${name}.${key} is not supported`);
}

function finite(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
  validation(typeof value === 'number' && Number.isFinite(value), `${name} must be finite`);
  validation(value >= minimum && value <= maximum, `${name} is outside its supported range`);
}

function integer(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
  finite(value, minimum, maximum, name);
  validation(Number.isSafeInteger(value), `${name} must be an integer`);
}

function boundedString(value: unknown, name: string, maximum = MAX_STRING): asserts value is string {
  validation(typeof value === 'string' && value.length > 0 && value.length <= maximum, `${name} is invalid`);
  validation(!/[\u0000-\u001f\u007f]/u.test(value), `${name} contains control characters`);
}

function isoDate(value: unknown, name: string): asserts value is string {
  boundedString(value, name, ISO_DATE_MAX_LENGTH);
  validation(RFC3339.test(value) && Number.isFinite(Date.parse(value)), `${name} must be an RFC 3339 timestamp`);
  const [calendar] = value.split('T');
  const [yearText, monthText, dayText] = calendar!.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  validation(month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0),
    `${name} contains an invalid calendar date`);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): asserts value is T {
  validation(typeof value === 'string' && values.includes(value as T), `${name} is invalid`);
}

function validateNumericObservation(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
  requireInteger = false
): void {
  plainObject(value, name);
  exactKeys(value, ['value', 'observedAt'], name);
  if (requireInteger) integer(value.value, minimum, maximum, `${name}.value`);
  else finite(value.value, minimum, maximum, `${name}.value`);
  isoDate(value.observedAt, `${name}.observedAt`);
}

function validatePhysical(value: unknown): void {
  plainObject(value, 'physical');
  exactKeys(value, ['heartRateBpm', 'hrvMs', 'steps', 'sleep', 'activity', 'temperatureCelsius'], 'physical');
  if (value.heartRateBpm != null) validateNumericObservation(value.heartRateBpm, 'physical.heartRateBpm', 20, 260);
  if (value.hrvMs != null) validateNumericObservation(value.hrvMs, 'physical.hrvMs', 0, 500);
  if (value.steps != null) validateNumericObservation(value.steps, 'physical.steps', 0, 1_000_000, true);
  if (value.temperatureCelsius != null) validateNumericObservation(value.temperatureCelsius, 'physical.temperatureCelsius', 20, 50);
  if (value.sleep != null) {
    plainObject(value.sleep, 'physical.sleep');
    exactKeys(value.sleep, ['minutes', 'qualityScore', 'observedAt'], 'physical.sleep');
    integer(value.sleep.minutes, 0, 1_440, 'physical.sleep.minutes');
    if (value.sleep.qualityScore !== undefined) finite(value.sleep.qualityScore, 0, 100, 'physical.sleep.qualityScore');
    isoDate(value.sleep.observedAt, 'physical.sleep.observedAt');
  }
  if (value.activity != null) {
    plainObject(value.activity, 'physical.activity');
    exactKeys(value.activity, ['type', 'activeMinutes', 'observedAt'], 'physical.activity');
    enumValue(value.activity.type, ['walking', 'running', 'resting', 'sleeping', 'other'], 'physical.activity.type');
    integer(value.activity.activeMinutes, 0, 1_440, 'physical.activity.activeMinutes');
    isoDate(value.activity.observedAt, 'physical.activity.observedAt');
  }
}

function validateCognitive(value: unknown): void {
  plainObject(value, 'cognitive');
  exactKeys(value, ['medicationAdherence', 'memoryAssessmentScore', 'cognitiveEngagementPerWeek'], 'cognitive');
  if (value.memoryAssessmentScore != null) validateNumericObservation(value.memoryAssessmentScore, 'cognitive.memoryAssessmentScore', 0, 100);
  if (value.cognitiveEngagementPerWeek != null) validateNumericObservation(value.cognitiveEngagementPerWeek, 'cognitive.cognitiveEngagementPerWeek', 0, 1_000, true);
  if (value.medicationAdherence != null) {
    plainObject(value.medicationAdherence, 'cognitive.medicationAdherence');
    exactKeys(value.medicationAdherence, ['scheduled', 'taken', 'missed', 'rate', 'observedAt'], 'cognitive.medicationAdherence');
    integer(value.medicationAdherence.scheduled, 0, 10_000, 'cognitive.medicationAdherence.scheduled');
    integer(value.medicationAdherence.taken, 0, 10_000, 'cognitive.medicationAdherence.taken');
    integer(value.medicationAdherence.missed, 0, 10_000, 'cognitive.medicationAdherence.missed');
    finite(value.medicationAdherence.rate, 0, 1, 'cognitive.medicationAdherence.rate');
    validation(value.medicationAdherence.taken + value.medicationAdherence.missed <= value.medicationAdherence.scheduled,
      'cognitive.medicationAdherence counts are inconsistent');
    isoDate(value.medicationAdherence.observedAt, 'cognitive.medicationAdherence.observedAt');
  }
}

function validateEmotional(value: unknown): void {
  plainObject(value, 'emotional');
  exactKeys(value, ['mood', 'stressScore', 'emotionalTone'], 'emotional');
  if (value.stressScore != null) validateNumericObservation(value.stressScore, 'emotional.stressScore', 0, 100);
  if (value.mood != null) {
    plainObject(value.mood, 'emotional.mood');
    exactKeys(value.mood, ['value', 'observedAt'], 'emotional.mood');
    enumValue(value.mood.value, ['very_low', 'low', 'neutral', 'good', 'very_good', 'unknown'], 'emotional.mood.value');
    isoDate(value.mood.observedAt, 'emotional.mood.observedAt');
  }
  if (value.emotionalTone != null) {
    plainObject(value.emotionalTone, 'emotional.emotionalTone');
    exactKeys(value.emotionalTone, ['valence', 'arousal', 'label', 'observedAt'], 'emotional.emotionalTone');
    finite(value.emotionalTone.valence, -1, 1, 'emotional.emotionalTone.valence');
    finite(value.emotionalTone.arousal, 0, 1, 'emotional.emotionalTone.arousal');
    if (value.emotionalTone.label !== undefined) boundedString(value.emotionalTone.label, 'emotional.emotionalTone.label', 64);
    isoDate(value.emotionalTone.observedAt, 'emotional.emotionalTone.observedAt');
  }
}

function validateContext(value: unknown): void {
  plainObject(value, 'context');
  exactKeys(value, ['location', 'timeOfDay', 'socialInteractionsToday', 'environment'], 'context');
  if (value.timeOfDay != null) enumValue(value.timeOfDay, ['morning', 'afternoon', 'evening', 'night'], 'context.timeOfDay');
  if (value.socialInteractionsToday != null) validateNumericObservation(value.socialInteractionsToday, 'context.socialInteractionsToday', 0, 10_000, true);
  if (value.location != null) {
    plainObject(value.location, 'context.location');
    exactKeys(value.location, ['context', 'latitude', 'longitude', 'observedAt'], 'context.location');
    enumValue(value.location.context, ['home', 'away', 'unknown'], 'context.location.context');
    if (value.location.latitude !== undefined) finite(value.location.latitude, -90, 90, 'context.location.latitude');
    if (value.location.longitude !== undefined) finite(value.location.longitude, -180, 180, 'context.location.longitude');
    validation((value.location.latitude === undefined) === (value.location.longitude === undefined),
      'context.location coordinates must be supplied together');
    isoDate(value.location.observedAt, 'context.location.observedAt');
  }
  if (value.environment != null) {
    plainObject(value.environment, 'context.environment');
    exactKeys(value.environment, ['temperatureCelsius', 'noiseDb', 'lightLux', 'observedAt'], 'context.environment');
    if (value.environment.temperatureCelsius !== undefined) finite(value.environment.temperatureCelsius, -80, 80, 'context.environment.temperatureCelsius');
    if (value.environment.noiseDb !== undefined) finite(value.environment.noiseDb, 0, 200, 'context.environment.noiseDb');
    if (value.environment.lightLux !== undefined) finite(value.environment.lightLux, 0, 1_000_000, 'context.environment.lightLux');
    isoDate(value.environment.observedAt, 'context.environment.observedAt');
  }
}

function validateDevices(value: unknown): void {
  validation(Array.isArray(value) && value.length <= MAX_DEVICES, 'devices must be a bounded array');
  const seen = new Set<string>();
  value.forEach((device, index) => {
    const name = `devices[${index}]`;
    plainObject(device, name);
    exactKeys(device, ['deviceId', 'type', 'batteryPercent', 'connectivity', 'lastKnownState', 'observedAt'], name);
    boundedString(device.deviceId, `${name}.deviceId`);
    validation(!seen.has(device.deviceId), 'devices contains a duplicate deviceId');
    seen.add(device.deviceId);
    enumValue(device.type, ['wearable', 'home_robot'], `${name}.type`);
    if (device.batteryPercent !== undefined) finite(device.batteryPercent, 0, 100, `${name}.batteryPercent`);
    enumValue(device.connectivity, ['online', 'offline', 'degraded', 'unknown'], `${name}.connectivity`);
    boundedString(device.lastKnownState, `${name}.lastKnownState`);
    isoDate(device.observedAt, `${name}.observedAt`);
  });
}

function validateUpdate(value: unknown): asserts value is UserStateUpdate {
  plainObject(value, 'update');
  exactKeys(value, ['physical', 'cognitive', 'emotional', 'context', 'devices'], 'update');
  validation(Object.keys(value).length > 0, 'update must contain at least one section');
  rejectUndefined(value, 'update');
  if (value.physical !== undefined) validatePhysical(value.physical);
  if (value.cognitive !== undefined) validateCognitive(value.cognitive);
  if (value.emotional !== undefined) validateEmotional(value.emotional);
  if (value.context !== undefined) validateContext(value.context);
  if (value.devices !== undefined) validateDevices(value.devices);
}

function rejectUndefined(
  value: unknown,
  name: string,
  traversal: { readonly seen: WeakSet<object>; count: number } = {
    seen: new WeakSet<object>(), count: 0
  },
  depth = 0
): void {
  validation(depth <= 20 && traversal.count <= 10_000, `${name} exceeds structural bounds`);
  if (Array.isArray(value)) {
    validation(!traversal.seen.has(value), `${name} must not contain cycles`);
    traversal.seen.add(value);
    traversal.count += value.length;
    value.forEach((child, index) => rejectUndefined(child, `${name}[${index}]`, traversal, depth + 1));
    traversal.seen.delete(value);
    return;
  }
  if (value !== null && typeof value === 'object') {
    validation(!traversal.seen.has(value), `${name} must not contain cycles`);
    traversal.seen.add(value);
    traversal.count += Object.keys(value).length;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      validation(child !== undefined, `${name}.${key} must not be undefined`);
      rejectUndefined(child, `${name}.${key}`, traversal, depth + 1);
    }
    traversal.seen.delete(value);
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function immutable<T>(value: T): T {
  return deepFreeze(clone(value));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeSection<T extends object>(current: T, patch: object | undefined): T {
  if (patch === undefined) return clone(current);
  const next = Object.assign({}, current) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = clone(value);
  }
  return next as T;
}

/** Derives opaque indexes and independent per-account encryption keys. */
export class AccountDataCipher {
  private readonly keys = new Map<number, Buffer>();
  private readonly indexKey: Buffer;
  readonly currentVersion: number;

  constructor(
    configuration: Uint8Array | Readonly<{
      encryptionKey?: Uint8Array;
      encryptionKeyring?: AccountDataKeyring;
    }>
  ) {
    const legacyKey = configuration instanceof Uint8Array
      ? configuration
      : configuration.encryptionKey;
    const keyring = configuration instanceof Uint8Array
      ? undefined
      : configuration.encryptionKeyring;
    validation((legacyKey === undefined) !== (keyring === undefined),
      'Exactly one of encryptionKey or encryptionKeyring is required');

    if (legacyKey !== undefined) {
      this.validateKey(legacyKey, 'encryptionKey');
      this.keys.set(1, Buffer.from(legacyKey));
      this.currentVersion = 1;
      this.indexKey = Buffer.from(legacyKey);
      return;
    }

    validation(keyring !== undefined, 'encryptionKeyring is required');
    plainObject(keyring as unknown, 'encryptionKeyring');
    exactKeys(keyring as unknown as Record<string, unknown>,
      ['currentVersion', 'keys', 'accountIndexKey'], 'encryptionKeyring');
    integer(keyring.currentVersion, 1, 2_147_483_647, 'encryptionKeyring.currentVersion');
    plainObject(keyring.keys as unknown, 'encryptionKeyring.keys');
    const entries = Object.entries(keyring.keys);
    validation(entries.length > 0 && entries.length <= 32, 'encryptionKeyring.keys is invalid');
    for (const [versionText, key] of entries) {
      validation(/^[1-9]\d{0,9}$/.test(versionText), 'encryptionKeyring key version is invalid');
      const version = Number(versionText);
      integer(version, 1, 2_147_483_647, 'encryptionKeyring key version');
      this.validateKey(key, `encryptionKeyring.keys[${versionText}]`);
      this.keys.set(version, Buffer.from(key));
    }
    validation(this.keys.has(keyring.currentVersion),
      'encryptionKeyring.currentVersion is not present in keys');
    if (keyring.accountIndexKey !== undefined) {
      this.validateKey(keyring.accountIndexKey, 'encryptionKeyring.accountIndexKey');
      this.indexKey = Buffer.from(keyring.accountIndexKey);
    } else {
      const versionOneKey = this.keys.get(1);
      validation(versionOneKey !== undefined,
        'encryptionKeyring version 1 is required when accountIndexKey is omitted');
      this.indexKey = Buffer.from(versionOneKey);
    }
    this.currentVersion = keyring.currentVersion;
  }

  storageKey(accountId: string, domain: string): string {
    validateAccountId(accountId);
    validation(typeof domain === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(domain), 'domain is invalid');
    const indexKey = Buffer.from(hkdfSync('sha256', this.indexKey, Buffer.alloc(0), 'veryloving-account-index-v1', 32));
    const digest = createHmac('sha256', indexKey).update(domain).update('\0').update(accountId).digest('base64url');
    indexKey.fill(0);
    return `${domain}_${digest}`;
  }

  encrypt(storageKey: string, domain: string, revision: number, plaintext: unknown): CiphertextRecord {
    integer(revision, 1, Number.MAX_SAFE_INTEGER, 'revision');
    let serialized: string;
    try {
      const candidate = JSON.stringify(plaintext);
      validation(typeof candidate === 'string', 'Encrypted payload is not JSON serializable');
      validation(Buffer.byteLength(candidate, 'utf8') <= MAX_ENCRYPTED_BYTES, 'Encrypted payload exceeds its storage bound');
      serialized = candidate;
    } catch (error) {
      if (error instanceof AccountDataValidationError) throw error;
      throw new AccountDataValidationError('Encrypted payload is not JSON serializable');
    }
    const keyVersion = this.currentVersion;
    const key = this.deriveDataKey(storageKey, domain, keyVersion);
    const iv = randomBytes(12);
    const aad = this.additionalData(storageKey, domain, revision, keyVersion);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
      return Object.freeze({
        algorithm: 'aes-256-gcm',
        keyVersion,
        revision,
        iv: iv.toString('base64url'),
        authTag: cipher.getAuthTag().toString('base64url'),
        ciphertext: ciphertext.toString('base64url')
      });
    } finally {
      key.fill(0);
    }
  }

  decrypt<T>(storageKey: string, domain: string, record: CiphertextRecord): T {
    try {
      validation(record.algorithm === 'aes-256-gcm', 'Unsupported encrypted record');
      integer(record.keyVersion, 1, 2_147_483_647, 'Encrypted key version');
      validation(this.keys.has(record.keyVersion), 'Encrypted key version is unavailable');
      integer(record.revision, 1, Number.MAX_SAFE_INTEGER, 'Encrypted revision');
      validation(typeof record.iv === 'string' && /^[A-Za-z0-9_-]{16}$/.test(record.iv), 'Encrypted IV is invalid');
      validation(typeof record.authTag === 'string' && /^[A-Za-z0-9_-]{22}$/.test(record.authTag), 'Encrypted tag is invalid');
      validation(typeof record.ciphertext === 'string'
        && record.ciphertext.length <= Math.ceil(MAX_ENCRYPTED_BYTES * 4 / 3) + 4
        && /^[A-Za-z0-9_-]*$/.test(record.ciphertext), 'Encrypted ciphertext is invalid');
      const key = this.deriveDataKey(storageKey, domain, record.keyVersion);
      try {
        const iv = Buffer.from(record.iv, 'base64url');
        const tag = Buffer.from(record.authTag, 'base64url');
        validation(iv.length === 12 && tag.length === 16, 'Encrypted record metadata is invalid');
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAAD(this.additionalData(storageKey, domain, record.revision, record.keyVersion));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(record.ciphertext, 'base64url')),
          decipher.final()
        ]);
        return JSON.parse(plaintext.toString('utf8')) as T;
      } finally {
        key.fill(0);
      }
    } catch (error) {
      if (error instanceof AccountDataIntegrityError) throw error;
      throw new AccountDataIntegrityError();
    }
  }

  isCurrentVersion(record: CiphertextRecord): boolean {
    return record.keyVersion === this.currentVersion;
  }

  private additionalData(storageKey: string, domain: string, revision: number, keyVersion: number): Buffer {
    // Version 1 retains the original format for backward decryption. Newer
    // records authenticate the key selector itself to prevent substitution.
    return Buffer.from(keyVersion === 1
      ? `${domain}\0${storageKey}\0${revision}`
      : `${domain}\0${storageKey}\0${revision}\0${keyVersion}`, 'utf8');
  }

  private deriveDataKey(storageKey: string, domain: string, keyVersion: number): Buffer {
    const masterKey = this.keys.get(keyVersion);
    validation(masterKey !== undefined, 'Encrypted key version is unavailable');
    return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(storageKey), `veryloving:${domain}:data-v1`, 32));
  }

  private validateKey(key: unknown, name: string): asserts key is Uint8Array {
    validation(key instanceof Uint8Array && key.byteLength === 32,
      `${name} must contain exactly 32 bytes`);
  }
}

function validateAccountId(accountId: string): void {
  validation(typeof accountId === 'string' && ACCOUNT_ID.test(accountId), 'accountId is invalid');
}

function currentOf(aggregate: UserStateAggregate): UserStateSnapshot | null {
  return aggregate.history.at(-1) ?? null;
}

function emptyAggregate(): UserStateAggregate {
  return { schemaVersion: STATE_SCHEMA_VERSION, history: [], receipts: {}, receiptOrder: [] };
}

function validateSnapshot(snapshot: UserStateSnapshot): void {
  plainObject(snapshot as unknown, 'userStateSnapshot');
  exactKeys(snapshot as unknown as Record<string, unknown>,
    ['schemaVersion', 'revision', 'recordedAt', 'physical', 'cognitive', 'emotional', 'context', 'devices'],
    'userStateSnapshot');
  validation(snapshot.schemaVersion === STATE_SCHEMA_VERSION, 'User state snapshot schema is unsupported');
  integer(snapshot.revision, 1, Number.MAX_SAFE_INTEGER, 'userStateSnapshot.revision');
  isoDate(snapshot.recordedAt, 'userStateSnapshot.recordedAt');
  validation(![snapshot.physical, snapshot.cognitive, snapshot.emotional, snapshot.context]
    .some((section) => Object.values(section).some((entry) => entry === null)),
  'User state snapshots must not contain cleared null fields');
  validatePhysical(snapshot.physical);
  validateCognitive(snapshot.cognitive);
  validateEmotional(snapshot.emotional);
  validateContext(snapshot.context);
  validateDevices(snapshot.devices);
}

function validateAggregate(value: UserStateAggregate, repositoryRevision: number): void {
  plainObject(value as unknown, 'userStateAggregate');
  exactKeys(value as unknown as Record<string, unknown>, ['schemaVersion', 'history', 'receipts', 'receiptOrder'], 'userStateAggregate');
  validation(value.schemaVersion === STATE_SCHEMA_VERSION, 'User state schema is unsupported');
  validation(Array.isArray(value.history) && value.history.length <= 10_000, 'User state history is invalid');
  let priorRevision = 0;
  for (const snapshot of value.history) {
    validateSnapshot(snapshot);
    validation(snapshot.revision > priorRevision, 'User state history is not monotonic');
    priorRevision = snapshot.revision;
  }
  const current = currentOf(value);
  validation(current === null || current.revision === repositoryRevision, 'User state revision does not match repository revision');
  plainObject(value.receipts as unknown, 'userStateReceipts');
  validation(Object.keys(value.receipts).length <= 2_000, 'User state receipts are invalid');
  for (const [key, receipt] of Object.entries(value.receipts)) {
    validation(IDEMPOTENCY_KEY.test(key), 'Stored user state idempotency key is invalid');
    plainObject(receipt as unknown, 'userStateReceipt');
    exactKeys(receipt as unknown as Record<string, unknown>, ['fingerprint', 'result'], 'userStateReceipt');
    validation(typeof receipt.fingerprint === 'string' && /^[A-Za-z0-9_-]{43}$/.test(receipt.fingerprint),
      'Stored user state fingerprint is invalid');
    validateSnapshot(receipt.result);
  }
  validation(Array.isArray(value.receiptOrder) && value.receiptOrder.length <= 2_000,
    'User state receipt order is invalid');
  const receiptKeys = new Set(value.receiptOrder);
  validation(receiptKeys.size === value.receiptOrder.length
    && value.receiptOrder.every((key) => typeof key === 'string' && value.receipts[key] !== undefined)
    && Object.keys(value.receipts).every((key) => receiptKeys.has(key)), 'User state receipts are inconsistent');
}

const TREND_EXTRACTORS: Readonly<Record<UserStateTrendMetric, (state: UserStateSnapshot) => NumericObservation | undefined>> = {
  heart_rate_bpm: (state) => state.physical.heartRateBpm,
  hrv_ms: (state) => state.physical.hrvMs,
  steps: (state) => state.physical.steps,
  sleep_minutes: (state) => state.physical.sleep === undefined ? undefined : ({ value: state.physical.sleep.minutes, observedAt: state.physical.sleep.observedAt }),
  activity_minutes: (state) => state.physical.activity === undefined ? undefined : ({ value: state.physical.activity.activeMinutes, observedAt: state.physical.activity.observedAt }),
  temperature_celsius: (state) => state.physical.temperatureCelsius,
  medication_adherence_rate: (state) => state.cognitive.medicationAdherence === undefined ? undefined : ({ value: state.cognitive.medicationAdherence.rate, observedAt: state.cognitive.medicationAdherence.observedAt }),
  memory_assessment_score: (state) => state.cognitive.memoryAssessmentScore,
  cognitive_engagement_per_week: (state) => state.cognitive.cognitiveEngagementPerWeek,
  stress_score: (state) => state.emotional.stressScore,
  emotional_valence: (state) => state.emotional.emotionalTone === undefined ? undefined : ({ value: state.emotional.emotionalTone.valence, observedAt: state.emotional.emotionalTone.observedAt }),
  social_interactions_today: (state) => state.context.socialInteractionsToday
};

export class UserStateModel {
  private readonly repository: CiphertextRepository;
  private readonly cipher: AccountDataCipher;
  private readonly clock: () => Date;
  private readonly maxHistory: number;
  private readonly maxReceipts: number;
  private readonly maxWriteRetries: number;
  private readonly localTails = new Map<string, Promise<void>>();
  private readonly deletedAccountRefs = new Set<string>();
  private readonly domain = 'user-state';

  constructor(options: UserStateModelOptions) {
    plainObject(options as unknown, 'options');
    integer(options.maxHistory ?? 512, 2, 10_000, 'maxHistory');
    integer(options.maxIdempotencyRecords ?? 256, 1, 2_000, 'maxIdempotencyRecords');
    integer(options.maxWriteRetries ?? 32, 1, 100, 'maxWriteRetries');
    validation(typeof options.repository?.get === 'function' && typeof options.repository?.compareAndSet === 'function',
      'repository must implement the ciphertext persistence contract');
    validation(options.clock === undefined || typeof options.clock === 'function', 'clock must be a function');
    this.repository = options.repository;
    this.cipher = new AccountDataCipher({
      encryptionKey: options.encryptionKey,
      encryptionKeyring: options.encryptionKeyring
    });
    this.clock = options.clock ?? (() => new Date());
    this.maxHistory = options.maxHistory ?? 512;
    this.maxReceipts = options.maxIdempotencyRecords ?? 256;
    this.maxWriteRetries = options.maxWriteRetries ?? 32;
  }

  async getCurrentState(accountId: string): Promise<UserStateSnapshot | null> {
    const { aggregate } = await this.load(accountId);
    const current = currentOf(aggregate);
    return current === null ? null : immutable(current);
  }

  async updateState(
    accountId: string,
    update: UserStateUpdate,
    options: UserStateUpdateOptions = {}
  ): Promise<UserStateSnapshot> {
    validateAccountId(accountId);
    this.assertWritable(accountId);
    validateUpdate(update);
    plainObject(options as unknown, 'updateOptions');
    exactKeys(options as unknown as Record<string, unknown>, ['idempotencyKey', 'expectedRevision', 'signal'], 'updateOptions');
    if (options.idempotencyKey !== undefined) validation(IDEMPOTENCY_KEY.test(options.idempotencyKey), 'idempotencyKey is invalid');
    if (options.expectedRevision !== undefined) integer(options.expectedRevision, 0, Number.MAX_SAFE_INTEGER, 'expectedRevision');
    if (options.signal !== undefined && typeof options.signal.aborted !== 'boolean') {
      throw new AccountDataValidationError('updateOptions.signal is invalid');
    }
    this.throwIfAborted(options.signal);
    const safeUpdate = clone(update);
    const fingerprint = createHash('sha256').update(canonical(safeUpdate)).digest('base64url');
    const idempotencyKey = options.idempotencyKey;

    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        this.throwIfAborted(options.signal);
        const loaded = await this.load(accountId);
        this.throwIfAborted(options.signal);
        const receipt = idempotencyKey === undefined ? undefined : loaded.aggregate.receipts[idempotencyKey];
        if (receipt !== undefined) {
          const left = Buffer.from(receipt.fingerprint);
          const right = Buffer.from(fingerprint);
          validation(left.length === right.length && timingSafeEqual(left, right),
            'idempotencyKey was already used for a different update');
          return immutable(receipt.result);
        }

        const current = currentOf(loaded.aggregate);
        if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
          throw new AccountDataConflictError('User state revision precondition failed');
        }
        const revision = (current?.revision ?? 0) + 1;
        const snapshot: UserStateSnapshot = {
          schemaVersion: STATE_SCHEMA_VERSION,
          revision,
          recordedAt: this.now(),
          physical: mergeSection(current?.physical ?? {}, safeUpdate.physical),
          cognitive: mergeSection(current?.cognitive ?? {}, safeUpdate.cognitive),
          emotional: mergeSection(current?.emotional ?? {}, safeUpdate.emotional),
          context: mergeSection(current?.context ?? {}, safeUpdate.context),
          devices: safeUpdate.devices === undefined ? clone(current?.devices ?? []) : clone(safeUpdate.devices)
        };
        const history = [...loaded.aggregate.history, snapshot].slice(-this.maxHistory);
        const retainedRevisions = new Set(history.map((entry) => entry.revision));
        const receipts: Record<string, IdempotencyReceipt> = Object.fromEntries(
          Object.entries(loaded.aggregate.receipts)
            .filter(([, storedReceipt]) => retainedRevisions.has(storedReceipt.result.revision))
        );
        let receiptOrder = loaded.aggregate.receiptOrder
          .filter((key) => receipts[key] !== undefined);
        if (idempotencyKey !== undefined) {
          receipts[idempotencyKey] = { fingerprint, result: snapshot };
          receiptOrder.push(idempotencyKey);
          while (receiptOrder.length > this.maxReceipts) {
            const evicted = receiptOrder.shift();
            if (evicted !== undefined) delete receipts[evicted];
          }
        }
        const aggregate: UserStateAggregate = {
          schemaVersion: STATE_SCHEMA_VERSION,
          history,
          receipts,
          receiptOrder
        };
        const nextRecord = this.cipher.encrypt(loaded.storageKey, this.domain, revision, aggregate);
        this.throwIfAborted(options.signal);
        if (await this.repository.compareAndSet(loaded.storageKey, loaded.repositoryRevision, nextRecord)) {
          return immutable(snapshot);
        }
      }
      throw new AccountDataConflictError('User state could not be updated after bounded contention retries');
    });
  }

  async queryTrends(accountId: string, query: TrendQuery): Promise<readonly TrendPoint[]> {
    validateAccountId(accountId);
    plainObject(query as unknown, 'trendQuery');
    exactKeys(query as unknown as Record<string, unknown>, ['metric', 'from', 'to', 'limit'], 'trendQuery');
    enumValue(query.metric, Object.keys(TREND_EXTRACTORS) as UserStateTrendMetric[], 'trendQuery.metric');
    isoDate(query.from, 'trendQuery.from');
    isoDate(query.to, 'trendQuery.to');
    validation(Date.parse(query.from) <= Date.parse(query.to), 'trendQuery range is invalid');
    integer(query.limit ?? 1_000, 1, 10_000, 'trendQuery.limit');
    const { aggregate } = await this.load(accountId);
    const points: TrendPoint[] = [];
    let priorSignature: string | undefined;
    for (const state of aggregate.history) {
      const observation = TREND_EXTRACTORS[query.metric](state);
      if (observation === undefined) continue;
      const signature = `${observation.observedAt}\0${observation.value}`;
      if (signature === priorSignature) continue;
      priorSignature = signature;
      const timestamp = Date.parse(observation.observedAt);
      if (timestamp >= Date.parse(query.from) && timestamp <= Date.parse(query.to)) {
        points.push({ metric: query.metric, value: observation.value, observedAt: observation.observedAt, stateRevision: state.revision });
      }
    }
    return immutable(points.slice(-(query.limit ?? 1_000)));
  }

  async exportData(accountId: string): Promise<UserStateExport> {
    const { aggregate } = await this.load(accountId);
    return immutable({
      format: 'veryloving-user-state',
      schemaVersion: STATE_SCHEMA_VERSION,
      exportedAt: this.now(),
      current: currentOf(aggregate),
      history: aggregate.history
    });
  }

  /** Rewraps the account aggregate under the configured current key version. */
  async migrateEncryption(accountId: string): Promise<boolean> {
    validateAccountId(accountId);
    this.assertWritable(accountId);
    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        const storageKey = this.cipher.storageKey(accountId, this.domain);
        const current = await this.repository.get(storageKey);
        if (current === null || this.cipher.isCurrentVersion(current)) return false;
        const aggregate = this.cipher.decrypt<UserStateAggregate>(storageKey, this.domain, current);
        validateAggregate(aggregate, current.revision);
        const rotated = this.cipher.encrypt(storageKey, this.domain, current.revision, aggregate);
        if (await this.repository.compareAndSet(storageKey, current.revision, rotated)) return true;
      }
      throw new AccountDataConflictError('User state encryption migration failed after bounded contention retries');
    });
  }

  async deleteAllData(accountId: string): Promise<boolean> {
    validateAccountId(accountId);
    // Install the fence before joining the per-account mutation chain. Writes
    // that entered earlier complete first and are then erased; later writes fail.
    this.deletedAccountRefs.add(this.cipher.storageKey(accountId, this.domain));
    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        const storageKey = this.cipher.storageKey(accountId, this.domain);
        const current = await this.repository.get(storageKey);
        if (current === null) return false;
        if (await this.repository.compareAndSet(storageKey, current.revision, null)) return true;
      }
      throw new AccountDataConflictError('User state could not be deleted after bounded contention retries');
    });
  }

  private async load(accountId: string): Promise<{
    storageKey: string;
    repositoryRevision: number | null;
    aggregate: UserStateAggregate;
  }> {
    validateAccountId(accountId);
    const storageKey = this.cipher.storageKey(accountId, this.domain);
    const record = await this.repository.get(storageKey);
    if (record === null) return { storageKey, repositoryRevision: null, aggregate: emptyAggregate() };
    const aggregate = this.cipher.decrypt<UserStateAggregate>(storageKey, this.domain, record);
    validateAggregate(aggregate, record.revision);
    return { storageKey, repositoryRevision: record.revision, aggregate };
  }

  private assertWritable(accountId: string): void {
    if (this.deletedAccountRefs.has(this.cipher.storageKey(accountId, this.domain))) {
      throw new AccountDataConflictError('User state account has been deleted');
    }
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw Object.assign(new Error('User state operation was cancelled'), {
        name: 'AbortError',
        code: 'OPERATION_CANCELLED'
      });
    }
  }

  private now(): string {
    const value = this.clock();
    validation(value instanceof Date && Number.isFinite(value.getTime()), 'clock returned an invalid date');
    return value.toISOString();
  }

  private async withLocalLock<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.localTails.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => { release = resolve; });
    const chain = prior.then(() => tail);
    this.localTails.set(accountId, chain);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.localTails.get(accountId) === chain) this.localTails.delete(accountId);
    }
  }
}
