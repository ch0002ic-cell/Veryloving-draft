import { describe, expect, test } from '@jest/globals';
import {
  AccountDataValidationError,
  InMemoryCiphertextRepository
} from '../../models/UserState';
import {
  MemoryNet,
  type MemoryInput
} from '../MemoryNet';

const KEY = Buffer.from('abcdef0123456789abcdef0123456789', 'utf8');
const ROTATED_KEY = Buffer.from('9876543210fedcba9876543210fedcba', 'utf8');
const ACCOUNT_A = 'memory-account-a';
const ACCOUNT_B = 'memory-account-b';
const NOW = '2026-07-20T12:00:00.000Z';

function net(
  repository = new InMemoryCiphertextRepository(),
  overrides: Partial<ConstructorParameters<typeof MemoryNet>[0]> = {}
): MemoryNet {
  return new MemoryNet({
    repository,
    encryptionKey: KEY,
    clock: () => new Date(NOW),
    ...overrides
  });
}

const conversation: MemoryInput = {
  id: 'conversation-granddaughter',
  kind: 'conversation_summary',
  source: 'home_robot',
  summary: 'The user enjoyed a visit from their granddaughter and discussed the garden.',
  occurredAt: '2026-07-19T08:00:00.000Z',
  topics: ['family', 'garden'],
  emotionalTone: 'joyful'
};

const trend: MemoryInput = {
  id: 'weekly-steps-2026-29',
  kind: 'health_trend',
  source: 'system',
  metric: 'daily steps',
  period: 'weekly',
  periodStart: '2026-07-13T00:00:00.000Z',
  periodEnd: '2026-07-19T23:59:59.000Z',
  direction: 'decreasing',
  summary: 'Average daily steps declined relative to the prior week.'
};

const lifeEvent: MemoryInput = {
  id: 'life-event-garden-club',
  kind: 'life_event',
  source: 'user',
  summary: 'Joined a local garden club.',
  occurredAt: '2026-07-18T09:00:00.000Z',
  salience: 0.9,
  tags: ['garden', 'community']
};

const preference: MemoryInput = {
  id: 'preference-morning-music',
  kind: 'preference',
  source: 'user',
  category: 'music',
  value: 'classical music',
  preferredTimeOfDay: 'morning'
};

describe('MemoryNet', () => {
  test('stores bounded summaries, life events, preferences and health trends', async () => {
    const memory = net();
    await memory.storeMemory(ACCOUNT_A, conversation);
    await memory.storeMemory(ACCOUNT_A, trend);
    await memory.storeMemory(ACCOUNT_A, lifeEvent);
    await memory.storeMemory(ACCOUNT_A, preference);
    const entries = await memory.listMemories(ACCOUNT_A);
    expect(entries.map((entry) => entry.kind)).toEqual([
      'conversation_summary', 'health_trend', 'life_event', 'preference'
    ]);
    expect(entries.every((entry) => entry.recordRevision >= 1)).toBe(true);
    expect(Object.isFrozen(entries)).toBe(true);
    expect(Object.isFrozen(entries[0])).toBe(true);
  });

  test('recalls by relevance and recency without storing raw conversation logs', async () => {
    const memory = net();
    await Promise.all([
      memory.storeMemory(ACCOUNT_A, conversation),
      memory.storeMemory(ACCOUNT_A, preference),
      memory.storeMemory(ACCOUNT_A, lifeEvent)
    ]);
    const family = await memory.recall(ACCOUNT_A, { query: 'granddaughter garden', limit: 2 });
    expect(family[0]?.memory.id).toBe('conversation-granddaughter');
    expect(family[0]?.score).toBeGreaterThan(0.5);
    const music = await memory.recall(ACCOUNT_A, { query: 'classical music morning' });
    expect(music[0]?.memory).toMatchObject({ kind: 'preference', value: 'classical music' });
    const recent = await memory.recall(ACCOUNT_A, { kinds: ['life_event'], limit: 1 });
    expect(recent).toHaveLength(1);
    await expect(memory.recall(ACCOUNT_A, { query: 'unrelated astronomy' })).resolves.toEqual([]);
    await expect(memory.recall(ACCOUNT_A, { query: 'I a' })).resolves.toEqual([]);
  });

  test('returns filtered weekly and monthly trend summaries', async () => {
    const memory = net();
    await memory.storeMemory(ACCOUNT_A, trend);
    await memory.storeMemory(ACCOUNT_A, {
      ...trend,
      id: 'monthly-hrv-2026-06',
      metric: 'HRV',
      period: 'monthly',
      periodStart: '2026-06-01T00:00:00.000Z',
      periodEnd: '2026-06-30T23:59:59.000Z',
      direction: 'stable'
    });
    await expect(memory.getTrendSummaries(ACCOUNT_A, {
      metric: 'daily steps',
      from: '2026-07-01T00:00:00.000Z',
      to: NOW
    })).resolves.toMatchObject([{ id: 'weekly-steps-2026-29', direction: 'decreasing' }]);
  });

  test('stores relationship duration, trust and interaction metadata', async () => {
    const repository = new InMemoryCiphertextRepository();
    const memory = net(repository);
    const first = await memory.updateRelationship(ACCOUNT_A, {
      interactingSince: '2026-01-01T00:00:00.000Z',
      interactionCount: 40,
      trustLevel: 72,
      lastInteractionAt: NOW
    });
    expect(first).toMatchObject({ interactionCount: 40, trustLevel: 72, recordRevision: 1 });
    const second = await memory.updateRelationship(ACCOUNT_A, {
      interactionCount: 41,
      trustLevel: 74,
      lastInteractionAt: null
    });
    expect(second.interactingSince).toBe('2026-01-01T00:00:00.000Z');
    expect(second.lastInteractionAt).toBeUndefined();
    await expect(memory.getRelationshipMetadata(ACCOUNT_A)).resolves.toEqual(second);
    const idempotent = await memory.updateRelationship(ACCOUNT_A, { interactionCount: 42 }, {
      idempotencyKey: 'relationship-request-0001'
    });
    await expect(net(repository).updateRelationship(ACCOUNT_A, { interactionCount: 42 }, {
      idempotencyKey: 'relationship-request-0001'
    })).resolves.toEqual(idempotent);
  });

  test('makes stores idempotent across restart and rejects conflicting key reuse', async () => {
    const repository = new InMemoryCiphertextRepository();
    const firstProcess = net(repository);
    const saved = await firstProcess.storeMemory(ACCOUNT_A, conversation, {
      idempotencyKey: 'memory-request-0001'
    });
    const restarted = net(repository, { clock: () => new Date('2026-07-22T00:00:00.000Z') });
    const replay = await restarted.storeMemory(ACCOUNT_A, conversation, {
      idempotencyKey: 'memory-request-0001'
    });
    expect(replay).toEqual(saved);
    expect(await restarted.listMemories(ACCOUNT_A)).toHaveLength(1);
    await expect(restarted.storeMemory(ACCOUNT_A, preference, {
      idempotencyKey: 'memory-request-0001'
    })).rejects.toBeInstanceOf(AccountDataValidationError);
  });

  test('serializes concurrent mutations across process-like instances', async () => {
    const repository = new InMemoryCiphertextRepository();
    const first = net(repository);
    const second = net(repository);
    await Promise.all(Array.from({ length: 24 }, (_, index) => {
      const memory = index % 2 === 0 ? first : second;
      return memory.storeMemory(ACCOUNT_A, {
        id: `event-${index}`,
        kind: 'life_event',
        source: 'system',
        summary: `Bounded event summary ${index}`,
        occurredAt: `2026-07-20T10:${String(index).padStart(2, '0')}:00.000Z`,
        salience: 0.5,
        tags: ['simulation']
      }, { idempotencyKey: `concurrent-memory-${String(index).padStart(4, '0')}` });
    }));
    const entries = await first.listMemories(ACCOUNT_A);
    expect(entries).toHaveLength(24);
    expect(new Set(entries.map((entry) => entry.recordRevision)).size).toBe(24);
    await expect(first.listMemories(ACCOUNT_A, { offset: 10, limit: 5 })).resolves.toHaveLength(5);
  });

  test('recovers after restart and enforces bounded memory retention', async () => {
    const repository = new InMemoryCiphertextRepository();
    const first = net(repository, { maxMemories: 2 });
    await first.storeMemory(ACCOUNT_A, conversation);
    await first.storeMemory(ACCOUNT_A, lifeEvent);
    await first.storeMemory(ACCOUNT_A, preference);
    const restarted = net(repository, { maxMemories: 2 });
    expect((await restarted.listMemories(ACCOUNT_A)).map((entry) => entry.id)).toEqual([
      'life-event-garden-club', 'preference-morning-music'
    ]);
  });

  test('purges hidden idempotency copies when a memory is evicted or replaced', async () => {
    const repository = new InMemoryCiphertextRepository();
    const memory = net(repository, { maxMemories: 1 });
    await memory.storeMemory(ACCOUNT_A, conversation, { idempotencyKey: 'bounded-memory-0001' });
    await memory.storeMemory(ACCOUNT_A, preference);
    const reapplied = await memory.storeMemory(ACCOUNT_A, conversation, {
      idempotencyKey: 'bounded-memory-0001'
    });
    expect(reapplied.recordRevision).toBe(3);
    await memory.storeMemory(ACCOUNT_A, { ...conversation, summary: 'A replacement summary.' }, {
      idempotencyKey: 'bounded-memory-0002'
    });
    const oldReplay = await memory.storeMemory(ACCOUNT_A, conversation, {
      idempotencyKey: 'bounded-memory-0001'
    });
    expect(oldReplay.recordRevision).toBe(5);
  });

  test('encrypts content under opaque account-specific keys and prevents cross-account recall', async () => {
    const repository = new InMemoryCiphertextRepository();
    const memory = net(repository);
    await memory.storeMemory(ACCOUNT_A, conversation);
    await memory.storeMemory(ACCOUNT_B, preference);
    const raw = repository.inspectCiphertext();
    expect(raw).toHaveLength(2);
    expect(raw.some((item) => item.storageKey.includes(ACCOUNT_A))).toBe(false);
    const persisted = JSON.stringify(raw);
    expect(persisted).not.toContain('granddaughter');
    expect(persisted).not.toContain('classical music');
    expect((await memory.recall(ACCOUNT_B, { query: 'granddaughter' }))).toEqual([]);
    expect((await memory.recall(ACCOUNT_A, { query: 'granddaughter' }))[0]?.memory.id)
      .toBe('conversation-granddaughter');
  });

  test('reads legacy ciphertext and supports explicit key rotation followed by old-key retirement', async () => {
    const repository = new InMemoryCiphertextRepository();
    await net(repository).storeMemory(ACCOUNT_A, conversation);
    const rotating = net(repository, {
      encryptionKey: undefined,
      encryptionKeyring: { currentVersion: 2, keys: { 1: KEY, 2: ROTATED_KEY } }
    });
    await expect(rotating.listMemories(ACCOUNT_A)).resolves.toMatchObject([
      { id: 'conversation-granddaughter' }
    ]);
    await expect(rotating.migrateEncryption(ACCOUNT_A)).resolves.toBe(true);
    expect(repository.inspectCiphertext()[0]?.record.keyVersion).toBe(2);
    await expect(rotating.migrateEncryption(ACCOUNT_A)).resolves.toBe(false);

    const retired = net(repository, {
      encryptionKey: undefined,
      encryptionKeyring: {
        currentVersion: 2,
        keys: { 2: ROTATED_KEY },
        accountIndexKey: KEY
      }
    });
    await expect(retired.recall(ACCOUNT_A, { query: 'granddaughter' })).resolves.toMatchObject([
      { memory: { id: 'conversation-granddaughter' } }
    ]);
  });

  test('accepts bounded account identifiers containing @ through 256 characters', async () => {
    const accountId = `a@${'m'.repeat(254)}`;
    await expect(net().storeMemory(accountId, preference)).resolves.toMatchObject({
      id: 'preference-morning-music'
    });
    await expect(net().listMemories(`${accountId}m`)).rejects
      .toBeInstanceOf(AccountDataValidationError);
  });

  test('exports user-visible memory and supports specific and complete deletion', async () => {
    const repository = new InMemoryCiphertextRepository();
    const memory = net(repository);
    await memory.storeMemory(ACCOUNT_A, conversation, { idempotencyKey: 'delete-receipt-0001' });
    await memory.storeMemory(ACCOUNT_A, preference);
    await memory.updateRelationship(ACCOUNT_A, { interactionCount: 1, trustLevel: 10 });
    const exported = await memory.exportData(ACCOUNT_A);
    expect(exported).toMatchObject({ format: 'veryloving-memory-net', schemaVersion: 1 });
    expect(exported.memories).toHaveLength(2);
    expect(await memory.deleteMemory(ACCOUNT_A, 'conversation-granddaughter')).toBe(true);
    expect(await memory.deleteMemory(ACCOUNT_A, 'conversation-granddaughter')).toBe(false);
    expect((await memory.exportData(ACCOUNT_A)).memories.map((entry) => entry.id))
      .toEqual(['preference-morning-music']);
    // A deleted memory must not be resurrected by its former idempotency receipt.
    const restored = await memory.storeMemory(ACCOUNT_A, conversation, { idempotencyKey: 'delete-receipt-0001' });
    expect(restored.recordRevision).toBeGreaterThan(1);
    expect(await memory.deleteAllData(ACCOUNT_A)).toBe(true);
    expect(await memory.deleteAllData(ACCOUNT_A)).toBe(false);
    await expect(memory.listMemories(ACCOUNT_A)).resolves.toEqual([]);
    await expect(memory.getRelationshipMetadata(ACCOUNT_A)).resolves.toBeNull();
  });

  test('clears all user memories without permanently deleting the account memory space', async () => {
    const memory = net();
    await memory.storeMemory(ACCOUNT_A, preference, { idempotencyKey: 'clear-memory-receipt-01' });
    await memory.updateRelationship(ACCOUNT_A, { interactionCount: 2, trustLevel: 10 });
    await expect(memory.clearAllMemories(ACCOUNT_A)).resolves.toBe(true);
    await expect(memory.clearAllMemories(ACCOUNT_A)).resolves.toBe(false);
    await expect(memory.listMemories(ACCOUNT_A)).resolves.toEqual([]);
    await expect(memory.getRelationshipMetadata(ACCOUNT_A)).resolves.toBeNull();
    await expect(memory.storeMemory(ACCOUNT_A, {
      ...preference,
      value: 'folk'
    }, { idempotencyKey: 'clear-memory-receipt-02' })).resolves.toMatchObject({ value: 'folk' });
  });

  test('upserts a stable preference ID without duplicating the memory', async () => {
    const memory = net();
    const original = await memory.storeMemory(ACCOUNT_A, preference);
    const updated = await memory.storeMemory(ACCOUNT_A, { ...preference, value: 'jazz' });
    expect(updated.createdAt).toBe(original.createdAt);
    expect(updated.recordRevision).toBeGreaterThan(original.recordRevision);
    await expect(memory.listMemories(ACCOUNT_A)).resolves.toHaveLength(1);
  });

  test.each([
    ['invalid account', () => net().listMemories('../account')],
    ['short encryption key', () => new MemoryNet({ repository: new InMemoryCiphertextRepository(), encryptionKey: Buffer.alloc(8) })],
    ['raw transcript field', () => net().storeMemory(ACCOUNT_A, { ...conversation, rawTranscript: 'private raw text' } as never)],
    ['oversized summary', () => net().storeMemory(ACCOUNT_A, { ...conversation, summary: 'x'.repeat(2_001) })],
    ['duplicate topic', () => net().storeMemory(ACCOUNT_A, { ...conversation, topics: ['Family', 'family'] })],
    ['invalid date', () => net().storeMemory(ACCOUNT_A, { ...conversation, occurredAt: 'yesterday' })],
    ['invalid calendar date', () => net().storeMemory(ACCOUNT_A, { ...conversation, occurredAt: '2026-02-31T00:00:00.000Z' })],
    ['bad trend range', () => net().storeMemory(ACCOUNT_A, { ...trend, periodStart: NOW, periodEnd: '2026-07-01T00:00:00.000Z' })],
    ['bad salience', () => net().storeMemory(ACCOUNT_A, { ...lifeEvent, salience: 2 })],
    ['bad trust', () => net().updateRelationship(ACCOUNT_A, { trustLevel: 101 })],
    ['empty relationship', () => net().updateRelationship(ACCOUNT_A, {})],
    ['bad recall limit', () => net().recall(ACCOUNT_A, { limit: 101 })],
    ['bad recall dates', () => net().recall(ACCOUNT_A, { since: NOW, until: '2026-07-01T00:00:00.000Z' })],
    ['cyclic memory', () => {
      const entry = { ...conversation } as Record<string, unknown>;
      entry.topics = [entry];
      return net().storeMemory(ACCOUNT_A, entry as never);
    }]
  ])('rejects invalid, raw or unbounded memory data: %s', async (_name, operation) => {
    await expect((async () => { await operation(); })()).rejects.toBeInstanceOf(AccountDataValidationError);
  });
});
