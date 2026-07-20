import { describe, expect, test } from '@jest/globals';
import {
  AccountDataConflictError,
  AccountDataIntegrityError,
  AccountDataValidationError,
  InMemoryCiphertextRepository,
  UserStateModel,
  type UserStateUpdate
} from '../UserState';

const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');
const ROTATED_KEY = Buffer.from('fedcba9876543210fedcba9876543210', 'utf8');
const ACCOUNT_A = 'account-user-state-a';
const ACCOUNT_B = 'account-user-state-b';
const T0 = '2026-07-20T01:00:00.000Z';

function model(
  repository = new InMemoryCiphertextRepository(),
  overrides: Partial<ConstructorParameters<typeof UserStateModel>[0]> = {}
): UserStateModel {
  return new UserStateModel({
    repository,
    encryptionKey: KEY,
    clock: () => new Date(T0),
    ...overrides
  });
}

function completeUpdate(): UserStateUpdate {
  return {
    physical: {
      heartRateBpm: { value: 72, observedAt: T0 },
      hrvMs: { value: 48, observedAt: T0 },
      steps: { value: 4_321, observedAt: T0 },
      sleep: { minutes: 440, qualityScore: 82, observedAt: T0 },
      activity: { type: 'walking', activeMinutes: 35, observedAt: T0 },
      temperatureCelsius: { value: 36.7, observedAt: T0 }
    },
    cognitive: {
      medicationAdherence: { scheduled: 4, taken: 3, missed: 1, rate: 0.75, observedAt: T0 },
      memoryAssessmentScore: { value: 88, observedAt: T0 },
      cognitiveEngagementPerWeek: { value: 5, observedAt: T0 }
    },
    emotional: {
      mood: { value: 'good', observedAt: T0 },
      stressScore: { value: 24, observedAt: T0 },
      emotionalTone: { valence: 0.7, arousal: 0.3, label: 'calm', observedAt: T0 }
    },
    context: {
      location: { context: 'home', latitude: 1.3, longitude: 103.8, observedAt: T0 },
      timeOfDay: 'morning',
      socialInteractionsToday: { value: 2, observedAt: T0 },
      environment: { temperatureCelsius: 25, noiseDb: 34, lightLux: 280, observedAt: T0 }
    },
    devices: [
      { deviceId: 'wearable-private-1', type: 'wearable', batteryPercent: 81, connectivity: 'online', lastKnownState: 'monitoring', observedAt: T0 },
      { deviceId: 'robot-private-1', type: 'home_robot', batteryPercent: 64, connectivity: 'degraded', lastKnownState: 'docked', observedAt: T0 }
    ]
  };
}

describe('UserStateModel', () => {
  test('stores the complete dual-product state and returns immutable snapshots', async () => {
    const store = model();
    const saved = await store.updateState(ACCOUNT_A, completeUpdate());
    expect(saved).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      physical: { heartRateBpm: { value: 72 }, sleep: { minutes: 440 } },
      cognitive: { medicationAdherence: { rate: 0.75 } },
      emotional: { mood: { value: 'good' }, stressScore: { value: 24 } },
      context: { location: { context: 'home' } }
    });
    expect(saved.devices).toHaveLength(2);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.devices)).toBe(true);
    await expect(store.getCurrentState(ACCOUNT_A)).resolves.toEqual(saved);
  });

  test('merges field updates, supports explicit clearing and enforces optimistic revisions', async () => {
    const store = model();
    await store.updateState(ACCOUNT_A, completeUpdate());
    const second = await store.updateState(ACCOUNT_A, {
      physical: { heartRateBpm: { value: 74, observedAt: '2026-07-20T02:00:00.000Z' }, sleep: null },
      emotional: { mood: null }
    }, { expectedRevision: 1 });
    expect(second.revision).toBe(2);
    expect(second.physical.hrvMs?.value).toBe(48);
    expect(second.physical.sleep).toBeUndefined();
    expect(second.emotional.mood).toBeUndefined();
    await expect(store.updateState(ACCOUNT_A, { context: { timeOfDay: 'night' } }, { expectedRevision: 1 }))
      .rejects.toBeInstanceOf(AccountDataConflictError);
  });

  test('persists idempotency receipts and rejects key reuse with different content', async () => {
    const repository = new InMemoryCiphertextRepository();
    const firstProcess = model(repository);
    const request = { physical: { steps: { value: 5, observedAt: T0 } } } as const;
    const first = await firstProcess.updateState(ACCOUNT_A, request, { idempotencyKey: 'state-request-0001' });
    const restarted = model(repository, { clock: () => new Date('2026-07-21T00:00:00.000Z') });
    const replay = await restarted.updateState(ACCOUNT_A, request, { idempotencyKey: 'state-request-0001' });
    expect(replay).toEqual(first);
    expect((await restarted.getCurrentState(ACCOUNT_A))?.revision).toBe(1);
    await expect(restarted.updateState(ACCOUNT_A, {
      physical: { steps: { value: 6, observedAt: T0 } }
    }, { idempotencyKey: 'state-request-0001' })).rejects.toBeInstanceOf(AccountDataValidationError);
  });

  test('does not retain idempotency payloads beyond the exported history boundary', async () => {
    const repository = new InMemoryCiphertextRepository();
    const store = model(repository, { maxHistory: 2 });
    const oldUpdate = { emotional: { emotionalTone: {
      valence: -0.5, arousal: 0.8, label: 'old-sensitive-summary', observedAt: T0
    } } } as const;
    await store.updateState(ACCOUNT_A, oldUpdate, { idempotencyKey: 'bounded-state-0001' });
    await store.updateState(ACCOUNT_A, { emotional: { emotionalTone: null } });
    await store.updateState(ACCOUNT_A, { context: { timeOfDay: 'night' } });
    expect(JSON.stringify(await store.exportData(ACCOUNT_A))).not.toContain('old-sensitive-summary');
    const reapplied = await store.updateState(ACCOUNT_A, oldUpdate, { idempotencyKey: 'bounded-state-0001' });
    expect(reapplied.revision).toBe(4);
  });

  test('serializes concurrent writes across separate model instances with repository CAS', async () => {
    const repository = new InMemoryCiphertextRepository();
    const first = model(repository);
    const second = model(repository);
    const writes = Array.from({ length: 20 }, (_, index) => {
      const store = index % 2 === 0 ? first : second;
      return store.updateState(ACCOUNT_A, {
        physical: { steps: { value: index, observedAt: `2026-07-20T01:${String(index).padStart(2, '0')}:00.000Z` } }
      }, { idempotencyKey: `concurrent-state-${String(index).padStart(4, '0')}` });
    });
    const results = await Promise.all(writes);
    expect(new Set(results.map((entry) => entry.revision)).size).toBe(20);
    expect((await first.getCurrentState(ACCOUNT_A))?.revision).toBe(20);
    expect((await first.exportData(ACCOUNT_A)).history).toHaveLength(20);
  });

  test('survives process restart using only the shared ciphertext repository', async () => {
    const repository = new InMemoryCiphertextRepository();
    await model(repository).updateState(ACCOUNT_A, completeUpdate());
    const restarted = model(repository);
    await expect(restarted.getCurrentState(ACCOUNT_A)).resolves.toMatchObject({
      revision: 1,
      devices: [{ type: 'wearable' }, { type: 'home_robot' }]
    });
  });

  test('uses opaque per-account keys and never stores plaintext or cross-account data', async () => {
    const repository = new InMemoryCiphertextRepository();
    const store = model(repository);
    await store.updateState(ACCOUNT_A, completeUpdate());
    await store.updateState(ACCOUNT_B, {
      emotional: { mood: { value: 'neutral', observedAt: T0 } }
    });
    const records = repository.inspectCiphertext();
    expect(records).toHaveLength(2);
    expect(records[0]?.storageKey).not.toContain(ACCOUNT_A);
    expect(records[1]?.storageKey).not.toContain(ACCOUNT_B);
    const persisted = JSON.stringify(records);
    expect(persisted).not.toContain('wearable-private-1');
    expect(persisted).not.toContain('robot-private-1');
    expect(persisted).not.toContain('monitoring');
    expect((await store.getCurrentState(ACCOUNT_B))?.physical).toEqual({});
    expect((await store.getCurrentState(ACCOUNT_A))?.emotional.mood?.value).toBe('good');
  });

  test('authenticates ciphertext and fails closed after tampering', async () => {
    const repository = new InMemoryCiphertextRepository();
    const store = model(repository);
    await store.updateState(ACCOUNT_A, completeUpdate());
    const inspected = repository.inspectCiphertext()[0]!;
    const firstCharacter = inspected.record.ciphertext[0] === 'A' ? 'B' : 'A';
    const tampered = {
      ...inspected.record,
      ciphertext: firstCharacter + inspected.record.ciphertext.slice(1)
    };
    await repository.compareAndSet(inspected.storageKey, inspected.record.revision, tampered);
    await expect(store.getCurrentState(ACCOUNT_A)).rejects.toBeInstanceOf(AccountDataIntegrityError);
  });

  test('decrypts legacy records, rewraps them under the current key and permits old-key retirement', async () => {
    const repository = new InMemoryCiphertextRepository();
    await model(repository).updateState(ACCOUNT_A, completeUpdate());
    expect(repository.inspectCiphertext()[0]?.record.keyVersion).toBe(1);

    const rotating = model(repository, {
      encryptionKey: undefined,
      encryptionKeyring: {
        currentVersion: 2,
        keys: { 1: KEY, 2: ROTATED_KEY }
      }
    });
    await expect(rotating.getCurrentState(ACCOUNT_A)).resolves.toMatchObject({ revision: 1 });
    await expect(rotating.migrateEncryption(ACCOUNT_A)).resolves.toBe(true);
    expect(repository.inspectCiphertext()[0]?.record.keyVersion).toBe(2);
    await expect(rotating.migrateEncryption(ACCOUNT_A)).resolves.toBe(false);

    const retired = model(repository, {
      encryptionKey: undefined,
      encryptionKeyring: {
        currentVersion: 2,
        keys: { 2: ROTATED_KEY },
        accountIndexKey: KEY
      }
    });
    await expect(retired.getCurrentState(ACCOUNT_A)).resolves.toMatchObject({
      revision: 1,
      physical: { heartRateBpm: { value: 72 } }
    });
  });

  test('uses the current key for new records and authenticates the key version selector', async () => {
    const repository = new InMemoryCiphertextRepository();
    const rotating = model(repository, {
      encryptionKey: undefined,
      // Deliberately reuse material so this test isolates AAD authentication of
      // the version selector rather than merely failing with a different key.
      encryptionKeyring: { currentVersion: 2, keys: { 1: KEY, 2: KEY } }
    });
    await rotating.updateState(ACCOUNT_A, completeUpdate());
    const inspected = repository.inspectCiphertext()[0]!;
    expect(inspected.record.keyVersion).toBe(2);
    await repository.compareAndSet(inspected.storageKey, inspected.record.revision, {
      ...inspected.record,
      keyVersion: 1
    });
    await expect(rotating.getCurrentState(ACCOUNT_A)).rejects.toBeInstanceOf(AccountDataIntegrityError);
  });

  test('accepts bounded account identifiers containing @ through 256 characters', async () => {
    const accountId = `a@${'x'.repeat(254)}`;
    expect(accountId).toHaveLength(256);
    await expect(model().updateState(accountId, {
      emotional: { mood: { value: 'neutral', observedAt: T0 } }
    })).resolves.toMatchObject({ revision: 1 });
    await expect(model().getCurrentState(`${accountId}x`)).rejects
      .toBeInstanceOf(AccountDataValidationError);
  });

  test('queries bounded historical trends without duplicating inherited observations', async () => {
    const store = model(undefined, { maxHistory: 3 });
    await store.updateState(ACCOUNT_A, { physical: { heartRateBpm: { value: 70, observedAt: '2026-07-18T01:00:00.000Z' } } });
    await store.updateState(ACCOUNT_A, { context: { timeOfDay: 'morning' } });
    await store.updateState(ACCOUNT_A, { physical: { heartRateBpm: { value: 72, observedAt: '2026-07-19T01:00:00.000Z' } } });
    await store.updateState(ACCOUNT_A, { physical: { heartRateBpm: { value: 74, observedAt: T0 } } });
    const trend = await store.queryTrends(ACCOUNT_A, {
      metric: 'heart_rate_bpm',
      from: '2026-07-18T00:00:00.000Z',
      to: '2026-07-21T00:00:00.000Z',
      limit: 2
    });
    expect(trend.map((point) => point.value)).toEqual([72, 74]);
    expect((await store.exportData(ACCOUNT_A)).history).toHaveLength(3);
  });

  test('exposes every supported numeric trend without leaking nonnumeric context', async () => {
    const store = model();
    await store.updateState(ACCOUNT_A, completeUpdate());
    const metrics = [
      'heart_rate_bpm', 'hrv_ms', 'steps', 'sleep_minutes', 'activity_minutes',
      'temperature_celsius', 'medication_adherence_rate', 'memory_assessment_score',
      'cognitive_engagement_per_week', 'stress_score', 'emotional_valence',
      'social_interactions_today'
    ] as const;
    const results = await Promise.all(metrics.map((metric) => store.queryTrends(ACCOUNT_A, {
      metric,
      from: '2026-07-20T00:00:00.000Z',
      to: '2026-07-21T00:00:00.000Z'
    })));
    expect(results.every((points) => points.length === 1)).toBe(true);
    expect(results.map((points) => points[0]?.metric)).toEqual(metrics);
  });

  test('exports all retained versions and deletes the complete account record', async () => {
    const repository = new InMemoryCiphertextRepository();
    const store = model(repository);
    await store.updateState(ACCOUNT_A, completeUpdate());
    await store.updateState(ACCOUNT_A, { context: { timeOfDay: 'afternoon' } });
    const exported = await store.exportData(ACCOUNT_A);
    expect(exported).toMatchObject({ format: 'veryloving-user-state', schemaVersion: 1 });
    expect(exported.history).toHaveLength(2);
    expect(await store.deleteAllData(ACCOUNT_A)).toBe(true);
    expect(await store.deleteAllData(ACCOUNT_A)).toBe(false);
    await expect(store.getCurrentState(ACCOUNT_A)).resolves.toBeNull();
    expect(repository.inspectCiphertext()).toHaveLength(0);
  });

  test.each([
    ['bad account', () => model().getCurrentState('../account')],
    ['short key', () => new UserStateModel({ repository: new InMemoryCiphertextRepository(), encryptionKey: Buffer.alloc(31) })],
    ['ambiguous key configuration', () => new UserStateModel({
      repository: new InMemoryCiphertextRepository(),
      encryptionKey: KEY,
      encryptionKeyring: { currentVersion: 1, keys: { 1: KEY } }
    })],
    ['keyring without current key', () => new UserStateModel({
      repository: new InMemoryCiphertextRepository(),
      encryptionKeyring: { currentVersion: 2, keys: { 1: KEY } }
    })],
    ['empty update', () => model().updateState(ACCOUNT_A, {})],
    ['unknown field', () => model().updateState(ACCOUNT_A, { physical: { unknown: 1 } } as never)],
    ['bad heart rate', () => model().updateState(ACCOUNT_A, { physical: { heartRateBpm: { value: 500, observedAt: T0 } } })],
    ['bad timestamp', () => model().updateState(ACCOUNT_A, { physical: { steps: { value: 1, observedAt: 'July 20' } } })],
    ['invalid calendar date', () => model().updateState(ACCOUNT_A, { physical: { steps: { value: 1, observedAt: '2026-02-31T00:00:00.000Z' } } })],
    ['inconsistent medication', () => model().updateState(ACCOUNT_A, { cognitive: { medicationAdherence: { scheduled: 1, taken: 1, missed: 1, rate: 1, observedAt: T0 } } })],
    ['orphan coordinate', () => model().updateState(ACCOUNT_A, { context: { location: { context: 'home', latitude: 1, observedAt: T0 } } })],
    ['duplicate device', () => model().updateState(ACCOUNT_A, { devices: [
      { deviceId: 'same', type: 'wearable', connectivity: 'online', lastKnownState: 'ok', observedAt: T0 },
      { deviceId: 'same', type: 'home_robot', connectivity: 'online', lastKnownState: 'ok', observedAt: T0 }
    ] })],
    ['bad trend range', () => model().queryTrends(ACCOUNT_A, { metric: 'steps', from: '2026-07-21T00:00:00.000Z', to: T0 })],
    ['cyclic update', () => {
      const update: Record<string, unknown> = {};
      update.physical = update;
      return model().updateState(ACCOUNT_A, update as never);
    }]
  ])('rejects invalid or unbounded input: %s', async (_name, operation) => {
    await expect((async () => { await operation(); })()).rejects.toBeInstanceOf(AccountDataValidationError);
  });
});
