import type { CiphertextRecord } from '../UserState';
import { DynamoCiphertextRepository } from '../DynamoCiphertextRepository';

const STORAGE_KEY = `user-state_${'A'.repeat(43)}`;

function ciphertext(revision: number, payload = 'encrypted-payload'): CiphertextRecord {
  return Object.freeze({
    algorithm: 'aes-256-gcm',
    keyVersion: 1,
    revision,
    iv: 'aXY',
    authTag: 'dGFn',
    ciphertext: payload
  });
}

function conditionFailed(): Error {
  return Object.assign(new Error('conditional'), { name: 'ConditionalCheckFailedException' });
}

class FakeDocumentClient {
  readonly records = new Map<string, Record<string, unknown>>();
  readonly commands: unknown[] = [];
  failNext?: Error;

  async send(command: unknown): Promise<Record<string, unknown>> {
    this.commands.push(command);
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    const candidate = command as { constructor: { name: string }; input: Record<string, unknown> };
    const input = candidate.input;
    const keyOf = (value: Record<string, unknown>) => `${value.PK}|${value.SK}`;
    if (candidate.constructor.name === 'GetCommand') {
      const item = this.records.get(keyOf(input.Key as Record<string, unknown>));
      return item ? { Item: { ...item } } : {};
    }
    if (candidate.constructor.name === 'PutCommand') {
      const item = input.Item as Record<string, unknown>;
      const key = keyOf(item);
      const existing = this.records.get(key);
      if (String(input.ConditionExpression).includes('attribute_not_exists') && existing) throw conditionFailed();
      const expected = (input.ExpressionAttributeValues as Record<string, unknown> | undefined)?.[':expectedRevision'];
      if (expected !== undefined && existing?.revision !== expected) throw conditionFailed();
      this.records.set(key, { ...item });
      return {};
    }
    if (candidate.constructor.name === 'DeleteCommand') {
      const key = keyOf(input.Key as Record<string, unknown>);
      const existing = this.records.get(key);
      if (String(input.ConditionExpression).includes('attribute_not_exists') && existing) throw conditionFailed();
      const expected = (input.ExpressionAttributeValues as Record<string, unknown> | undefined)?.[':expectedRevision'];
      if (expected !== undefined && existing?.revision !== expected) throw conditionFailed();
      this.records.delete(key);
      return {};
    }
    throw new Error(`Unexpected command: ${candidate.constructor.name}`);
  }
}

function repository(client = new FakeDocumentClient(), maximum = 300_000): DynamoCiphertextRepository {
  return new DynamoCiphertextRepository({
    client: client as never,
    tableName: 'VerylovingData',
    maxCiphertextBytes: maximum
  });
}

describe('DynamoCiphertextRepository', () => {
  it('performs strongly consistent opaque-key CAS writes and revision-fenced deletion', async () => {
    const client = new FakeDocumentClient();
    const durable = repository(client);

    await expect(durable.get(STORAGE_KEY)).resolves.toBeNull();
    await expect(durable.compareAndSet(STORAGE_KEY, null, ciphertext(1))).resolves.toBe(true);
    await expect(durable.compareAndSet(STORAGE_KEY, null, ciphertext(1))).resolves.toBe(false);
    await expect(durable.compareAndSet(STORAGE_KEY, 2, ciphertext(3))).resolves.toBe(false);
    await expect(durable.compareAndSet(STORAGE_KEY, 1, ciphertext(2))).resolves.toBe(true);

    const loaded = await durable.get(STORAGE_KEY);
    expect(loaded).toEqual(ciphertext(2));
    expect(Object.isFrozen(loaded)).toBe(true);
    expect((client.commands[0] as { input: { ConsistentRead: boolean } }).input.ConsistentRead).toBe(true);
    expect(JSON.stringify(client.commands)).not.toContain('account-1');

    await expect(durable.compareAndSet(STORAGE_KEY, 1, null)).resolves.toBe(false);
    await expect(durable.compareAndSet(STORAGE_KEY, 2, null)).resolves.toBe(true);
    await expect(durable.compareAndSet(STORAGE_KEY, null, null)).resolves.toBe(true);
    await expect(durable.get(STORAGE_KEY)).resolves.toBeNull();
  });

  it('fails closed on malformed keys, revisions, records, and DynamoDB-sized payloads', async () => {
    const durable = repository(new FakeDocumentClient(), 1_024);
    await expect(durable.get('account-1')).rejects.toThrow('storage key');
    await expect(durable.compareAndSet(STORAGE_KEY, 0, null)).rejects.toThrow('revision');
    await expect(durable.compareAndSet(STORAGE_KEY, null, {
      ...ciphertext(1),
      algorithm: 'aes-256-gcm',
      ciphertext: 'x'.repeat(1_025)
    })).rejects.toThrow('payload');
    await expect(durable.compareAndSet(STORAGE_KEY, null, {
      ...ciphertext(1),
      algorithm: 'aes-256-gcm',
      keyVersion: 0
    })).rejects.toThrow('key version');

    const client = new FakeDocumentClient();
    client.records.set(`AI_NATIVE_CIPHERTEXT#${STORAGE_KEY}|CURRENT`, {
      ...ciphertext(1),
      algorithm: 'unknown'
    });
    await expect(repository(client).get(STORAGE_KEY)).rejects.toThrow('algorithm');
  });

  it('propagates transport failures instead of misreporting a CAS conflict', async () => {
    const client = new FakeDocumentClient();
    const transport = Object.assign(new Error('network unavailable'), { name: 'TimeoutError' });
    client.failNext = transport;
    await expect(repository(client).compareAndSet(STORAGE_KEY, null, ciphertext(1))).rejects.toBe(transport);
  });

  it.each([
    [{ tableName: 'x' }, 'table name'],
    [{ tableName: 'ValidTable', keyPrefix: 'bad-prefix' }, 'key prefix'],
    [{ tableName: 'ValidTable', maxCiphertextBytes: 400_000 }, 'item bound']
  ])('validates constructor option %p', (overrides, message) => {
    expect(() => new DynamoCiphertextRepository({
      client: new FakeDocumentClient() as never,
      ...overrides
    })).toThrow(message);
  });
});
