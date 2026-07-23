import type { ScenarioExecutionSnapshot } from '../ScenarioEngine';
import { DynamoScenarioExecutionRepository } from '../DynamoScenarioExecutionRepository';

const ACCOUNT_A = 'A'.repeat(32);
const ACCOUNT_B = 'B'.repeat(32);

function snapshot(
  sequence: number,
  accountRef = ACCOUNT_A,
  overrides: Partial<ScenarioExecutionSnapshot> = {}
): ScenarioExecutionSnapshot {
  const suffix = String(sequence).padStart(12, '0');
  return {
    schemaVersion: 1,
    definitionVersion: 1,
    identityKeyVersion: 1,
    executionId: `00000000-0000-5000-a000-${suffix}`,
    accountRef,
    scenarioId: 'fall_detection',
    triggerRef: `trigger${String(sequence).padStart(25, '0')}`,
    idempotencyRef: `idempotency${String(sequence).padStart(21, '0')}`,
    requestRef: `request${String(sequence).padStart(25, '0')}`,
    priority: 'critical',
    state: 'queued',
    createdAt: 1_000 + sequence,
    updatedAt: 1_000 + sequence,
    version: 1,
    deviceReferences: { wearable: `wearable${String(sequence).padStart(24, '0')}` },
    steps: [{
      id: 'navigate',
      operation: 'device_action',
      target: 'home_robot',
      action: 'navigate_to_user',
      state: 'pending'
    }],
    ...overrides
  };
}

function transactionConflict(): Error {
  return Object.assign(new Error('transaction conflict'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }]
  });
}

class FakeScenarioDocumentClient {
  readonly records = new Map<string, Record<string, unknown>>();
  readonly commands: unknown[] = [];
  failUpdateAfterCommit = false;
  returnUnprocessedOnce = false;

  private key(value: Record<string, unknown>): string {
    return `${value.PK}|${value.SK}`;
  }

  async send(command: unknown): Promise<Record<string, unknown>> {
    this.commands.push(command);
    const candidate = command as { constructor: { name: string }; input: Record<string, unknown> };
    const input = candidate.input;
    switch (candidate.constructor.name) {
      case 'TransactGetCommand': {
        const transaction = input.TransactItems as readonly Readonly<{ Get: { Key: Record<string, unknown> } }>[];
        return {
          Responses: transaction.map(({ Get }) => {
            const item = this.records.get(this.key(Get.Key));
            return item ? { Item: { ...item } } : {};
          })
        };
      }
      case 'GetCommand': {
        const item = this.records.get(this.key(input.Key as Record<string, unknown>));
        return item ? { Item: { ...item } } : {};
      }
      case 'TransactWriteCommand': {
        const transaction = input.TransactItems as readonly Record<string, Record<string, unknown>>[];
        const condition = transaction[0]?.ConditionCheck;
        const meta = condition && this.records.get(this.key(condition.Key as Record<string, unknown>));
        const update = transaction[1]?.Update;
        if (update) {
          const key = this.key(update.Key as Record<string, unknown>);
          const existing = this.records.get(key);
          const values = update.ExpressionAttributeValues as Record<string, unknown>;
          if (meta?.deletion_state === 'deleted'
            || !existing
            || existing.account_ref !== values[':accountRef']
            || existing.execution_id !== values[':executionId']
            || (existing.version as number) >= (values[':version'] as number)) {
            throw transactionConflict();
          }
          this.records.set(key, {
            ...existing,
            snapshot: values[':snapshot'],
            version: values[':version'],
            state: values[':state'],
            updated_at: values[':updatedAt'],
            created_at: values[':createdAt'],
            GSI1PK: values[':gsiPk'],
            GSI1SK: values[':gsiSk']
          });
          if (this.failUpdateAfterCommit) {
            this.failUpdateAfterCommit = false;
            throw Object.assign(new Error('response lost'), { name: 'TimeoutError' });
          }
          return {};
        }
        const puts = transaction
          .slice(1)
          .map((entry) => entry.Put)
          .filter((put): put is Record<string, unknown> => put !== undefined);
        if (meta?.deletion_state === 'deleted'
          || puts.some((put) => this.records.has(this.key(put.Item as Record<string, unknown>)))) {
          throw transactionConflict();
        }
        for (const put of puts) {
          const item = put.Item as Record<string, unknown>;
          this.records.set(this.key(item), { ...item });
        }
        return {};
      }
      case 'PutCommand': {
        const item = input.Item as Record<string, unknown>;
        this.records.set(this.key(item), { ...item });
        return {};
      }
      case 'QueryCommand': {
        const values = input.ExpressionAttributeValues as Record<string, unknown>;
        const accountPk = (values[':accountPk'] ?? values[':pk']) as string;
        const index = typeof input.IndexName === 'string';
        const cursor = input.ExclusiveStartKey as Record<string, unknown> | undefined;
        const sortField = index ? 'GSI1SK' : 'SK';
        const prefix = values[':executionPrefix'] as string | undefined;
        let items = [...this.records.values()]
          .filter((item) => index ? item.GSI1PK === accountPk : item.PK === accountPk)
          .filter((item) => prefix === undefined || String(item.SK).startsWith(prefix))
          .sort((left, right) => String(left[sortField]).localeCompare(String(right[sortField])));
        if (cursor) {
          const cursorSort = String(cursor[sortField] ?? cursor.SK);
          items = items.filter((item) => String(item[sortField]).localeCompare(cursorSort) > 0);
        }
        const limit = input.Limit as number;
        const selected = items.slice(0, limit);
        const last = selected.at(-1);
        return {
          Items: selected.map((item) => ({ ...item })),
          ...(items.length > selected.length && last ? {
            LastEvaluatedKey: {
              PK: last.PK,
              SK: last.SK,
              ...(index ? { GSI1PK: last.GSI1PK, GSI1SK: last.GSI1SK } : {})
            }
          } : {})
        };
      }
      case 'BatchWriteCommand': {
        const requestItems = input.RequestItems as Record<string, readonly Readonly<{
          DeleteRequest?: Readonly<{ Key: Record<string, unknown> }>;
        }>[]>;
        const table = Object.keys(requestItems)[0] as string;
        const requests = requestItems[table] ?? [];
        if (this.returnUnprocessedOnce) {
          this.returnUnprocessedOnce = false;
          return { UnprocessedItems: { [table]: requests } };
        }
        for (const request of requests) {
          if (request.DeleteRequest) this.records.delete(this.key(request.DeleteRequest.Key));
        }
        return { UnprocessedItems: {} };
      }
      default:
        throw new Error(`Unexpected command: ${candidate.constructor.name}`);
    }
  }
}

function repository(
  client = new FakeScenarioDocumentClient(),
  overrides: Partial<ConstructorParameters<typeof DynamoScenarioExecutionRepository>[0]> = {}
): DynamoScenarioExecutionRepository {
  return new DynamoScenarioExecutionRepository({
    client: client as never,
    tableName: 'VerylovingData',
    pageSize: 2,
    sleep: async () => undefined,
    ...overrides
  });
}

describe('DynamoScenarioExecutionRepository', () => {
  it('atomically admits one execution per account idempotency reference', async () => {
    const client = new FakeScenarioDocumentClient();
    const durable = repository(client);
    const first = snapshot(1);

    await expect(durable.create(first)).resolves.toMatchObject({ created: true, execution: first });
    await expect(durable.create(first)).resolves.toMatchObject({ created: false, execution: first });
    await expect(durable.create(snapshot(1, ACCOUNT_B))).resolves.toMatchObject({ created: true });

    const transaction = client.commands.find((command) => (
      (command as { constructor: { name: string } }).constructor.name === 'TransactWriteCommand'
    )) as { input: { TransactItems: readonly Record<string, Record<string, unknown>>[] } };
    expect(transaction.input.TransactItems).toHaveLength(3);
    expect(transaction.input.TransactItems[0]?.ConditionCheck?.ConditionExpression).toContain('deletion_state');
    expect(JSON.stringify(transaction)).not.toContain('test-user');
  });

  it('uses monotonic conditional updates and recognizes a committed response-loss retry', async () => {
    const client = new FakeScenarioDocumentClient();
    const durable = repository(client);
    const first = snapshot(2);
    await durable.create(first);
    const running = snapshot(2, ACCOUNT_A, { state: 'running', version: 2, updatedAt: 2_000 });
    await expect(durable.put(running)).resolves.toBeUndefined();
    await expect(durable.get(ACCOUNT_A, first.executionId)).resolves.toEqual(running);
    await expect(durable.put(first)).rejects.toMatchObject({ code: 'SCENARIO_EXECUTION_STALE' });

    const completed = snapshot(2, ACCOUNT_A, {
      state: 'completed', version: 3, updatedAt: 3_000, completedAt: 3_000,
      steps: [{ ...first.steps[0]!, state: 'succeeded', startedAt: 2_000, completedAt: 3_000, latencyMs: 1_000 }]
    });
    client.failUpdateAfterCommit = true;
    await expect(durable.put(completed)).resolves.toBeUndefined();
    await expect(durable.get(ACCOUNT_A, first.executionId)).resolves.toEqual(completed);
    await expect(durable.put(snapshot(99, ACCOUNT_A, { version: 2 }))).rejects.toMatchObject({
      code: 'SCENARIO_EXECUTION_NOT_FOUND'
    });
  });

  it('lists newest executions through the GSI and exhaustively paginates account recovery', async () => {
    const client = new FakeScenarioDocumentClient();
    const durable = repository(client, { pageSize: 1 });
    await durable.create(snapshot(3));
    await durable.create(snapshot(4));
    await durable.create(snapshot(5));

    await expect(durable.list(ACCOUNT_A, 2)).resolves.toEqual([snapshot(5), snapshot(4)]);
    await expect(durable.listAll(ACCOUNT_A)).resolves.toEqual([snapshot(5), snapshot(4), snapshot(3)]);
    await expect(durable.list(ACCOUNT_B)).resolves.toEqual([]);
    const queries = client.commands.filter((command) => (
      (command as { constructor: { name: string } }).constructor.name === 'QueryCommand'
    )) as { input: { IndexName?: string; ConsistentRead?: boolean } }[];
    expect(queries.some((query) => query.input.IndexName === 'AI_NATIVE_CREATED_AT_INDEX')).toBe(true);
    expect(queries.some((query) => query.input.ConsistentRead === true)).toBe(true);
  });

  it('tombstones before bounded batch deletion and permanently fences recreation', async () => {
    const client = new FakeScenarioDocumentClient();
    const durable = repository(client, { pageSize: 2, maxBatchRetries: 2 });
    await durable.create(snapshot(6));
    await durable.create(snapshot(7));
    await durable.create(snapshot(6, ACCOUNT_B));
    client.returnUnprocessedOnce = true;

    await expect(durable.deleteAccount(ACCOUNT_A)).resolves.toBe(2);
    await expect(durable.listAll(ACCOUNT_A)).resolves.toEqual([]);
    await expect(durable.get(ACCOUNT_B, snapshot(6, ACCOUNT_B).executionId)).resolves.toBeDefined();
    await expect(durable.create(snapshot(8))).rejects.toMatchObject({ code: 'ACCOUNT_DATA_DELETED' });
    await expect(durable.put(snapshot(6, ACCOUNT_A, {
      state: 'running', version: 2, updatedAt: 2_000
    }))).rejects.toMatchObject({ code: 'ACCOUNT_DATA_DELETED' });
    const names = client.commands.map((command) => (command as { constructor: { name: string } }).constructor.name);
    expect(names.indexOf('PutCommand')).toBeLessThan(names.indexOf('BatchWriteCommand'));
  });

  it('fails closed on malformed durable data and account export overflow', async () => {
    const client = new FakeScenarioDocumentClient();
    const durable = repository(client, { maxAccountRecords: 1 });
    await expect(durable.create(snapshot(9, ACCOUNT_A, { steps: [] }))).rejects.toThrow('steps');
    await durable.create(snapshot(10));
    await durable.create(snapshot(11));
    await expect(durable.listAll(ACCOUNT_A)).rejects.toThrow('export bound');
    await expect(durable.get('raw-account-id', snapshot(10).executionId)).rejects.toThrow('account reference');
  });

  it.each([
    [{ tableName: 'x' }, 'table name'],
    [{ tableName: 'ValidTable', createdAtIndexName: 'x' }, 'index name'],
    [{ tableName: 'ValidTable', keyPrefix: 'bad-prefix' }, 'key prefix'],
    [{ tableName: 'ValidTable', pageSize: 0 }, 'page size'],
    [{ tableName: 'ValidTable', maxBatchRetries: 21 }, 'retry bound']
  ])('validates constructor option %p', (overrides, message) => {
    expect(() => new DynamoScenarioExecutionRepository({
      client: new FakeScenarioDocumentClient() as never,
      ...overrides
    })).toThrow(message);
  });
});
