import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactGetCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb';
import type {
  ScenarioExecutionRepository,
  ScenarioExecutionSnapshot,
  ScenarioExecutionState,
  ScenarioPriority,
  ScenarioStepState
} from './ScenarioEngine';

type DocumentClient = Pick<DynamoDBDocumentClient, 'send'>;
type DynamoKey = Readonly<Record<string, unknown>>;

const TABLE_NAME = /^[A-Za-z0-9_.-]{3,255}$/;
const OPAQUE_REF = /^[A-Za-z0-9_-]{16,128}$/;
const EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATES: ReadonlySet<ScenarioExecutionState> = new Set([
  'queued', 'running', 'completed', 'fallback_completed', 'failed', 'cancelled'
]);
const PRIORITIES: ReadonlySet<ScenarioPriority> = new Set(['critical', 'standard', 'background']);
const STEP_STATES: ReadonlySet<ScenarioStepState> = new Set([
  'pending', 'running', 'succeeded', 'failed', 'fallback_succeeded', 'cancelled', 'skipped'
]);

export interface DynamoScenarioExecutionRepositoryOptions {
  readonly client: DocumentClient;
  readonly tableName: string;
  /** GSI with partition `GSI1PK` and sort `GSI1SK`, projected as ALL. */
  readonly createdAtIndexName?: string;
  readonly keyPrefix?: string;
  readonly pageSize?: number;
  readonly maxAccountRecords?: number;
  readonly maxPaginationPages?: number;
  readonly maxBatchRetries?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function string(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function optionalTime(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : integer(value, 0, Number.MAX_SAFE_INTEGER, label);
}

function boundedOptionalString(value: unknown, maximum: number, label: string): string | undefined {
  return value === undefined ? undefined : string(value, maximum, label);
}

function cloneSnapshot(value: ScenarioExecutionSnapshot): ScenarioExecutionSnapshot {
  return Object.freeze({
    ...value,
    deviceReferences: Object.freeze({ ...value.deviceReferences }),
    ...(value.cancellation ? {
      cancellation: Object.freeze({
        ...value.cancellation,
        ...(value.cancellation.robotEmergencyStop
          ? { robotEmergencyStop: Object.freeze({ ...value.cancellation.robotEmergencyStop }) }
          : {}),
        nonRetractable: Object.freeze([...value.cancellation.nonRetractable])
      })
    } : {}),
    steps: Object.freeze(value.steps.map((step) => Object.freeze({
      ...step,
      ...(step.fallbacks
        ? { fallbacks: Object.freeze(step.fallbacks.map((fallback) => Object.freeze({ ...fallback }))) }
        : {}),
      ...(step.children
        ? { children: Object.freeze(step.children.map((child) => Object.freeze({ ...child }))) }
        : {})
    })))
  });
}

function parseSnapshot(
  value: unknown,
  expectedAccountRef?: string,
  expectedExecutionId?: string
): ScenarioExecutionSnapshot {
  const record = plainObject(value, 'Durable scenario execution');
  const serialized = JSON.stringify(record);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > 350_000) {
    throw new TypeError('Durable scenario execution exceeds its storage bound');
  }
  if (record.schemaVersion !== 1) throw new TypeError('Durable scenario schema version is invalid');
  const accountRef = string(record.accountRef, 128, 'Durable scenario account reference');
  const executionId = string(record.executionId, 128, 'Durable scenario execution identifier');
  if (!OPAQUE_REF.test(accountRef) || !EXECUTION_ID.test(executionId)
    || (expectedAccountRef !== undefined && accountRef !== expectedAccountRef)
    || (expectedExecutionId !== undefined && executionId !== expectedExecutionId)) {
    throw new TypeError('Durable scenario identity is invalid');
  }
  if (!STATES.has(record.state as ScenarioExecutionState)
    || !PRIORITIES.has(record.priority as ScenarioPriority)) {
    throw new TypeError('Durable scenario state is invalid');
  }
  if (!Array.isArray(record.steps) || record.steps.length === 0 || record.steps.length > 50) {
    throw new TypeError('Durable scenario steps are invalid');
  }
  for (const candidate of record.steps) {
    const step = plainObject(candidate, 'Durable scenario step');
    string(step.id, 128, 'Durable scenario step identifier');
    string(step.operation, 64, 'Durable scenario step operation');
    if (!STEP_STATES.has(step.state as ScenarioStepState)) throw new TypeError('Durable scenario step state is invalid');
    boundedOptionalString(step.target, 32, 'Durable scenario step target');
    boundedOptionalString(step.action, 128, 'Durable scenario step action');
    boundedOptionalString(step.errorCode, 128, 'Durable scenario step error');
    boundedOptionalString(step.outcomeCode, 128, 'Durable scenario step outcome');
    optionalTime(step.startedAt, 'Durable scenario step start');
    optionalTime(step.completedAt, 'Durable scenario step completion');
    optionalTime(step.latencyMs, 'Durable scenario step latency');
    if (step.fallbacks !== undefined && (!Array.isArray(step.fallbacks) || step.fallbacks.length > 50)) {
      throw new TypeError('Durable scenario fallbacks are invalid');
    }
    if (step.children !== undefined && (!Array.isArray(step.children) || step.children.length > 50)) {
      throw new TypeError('Durable scenario children are invalid');
    }
  }
  const deviceReferences = plainObject(record.deviceReferences, 'Durable scenario device references');
  boundedOptionalString(deviceReferences.wearable, 128, 'Durable wearable reference');
  boundedOptionalString(deviceReferences.homeRobot, 128, 'Durable robot reference');
  integer(record.definitionVersion, 1, Number.MAX_SAFE_INTEGER, 'Durable scenario definition version');
  integer(record.identityKeyVersion, 1, Number.MAX_SAFE_INTEGER, 'Durable scenario identity key version');
  integer(record.version, 1, Number.MAX_SAFE_INTEGER, 'Durable scenario version');
  integer(record.createdAt, 0, Number.MAX_SAFE_INTEGER, 'Durable scenario creation time');
  integer(record.updatedAt, 0, Number.MAX_SAFE_INTEGER, 'Durable scenario update time');
  optionalTime(record.completedAt, 'Durable scenario completion time');
  string(record.scenarioId, 128, 'Durable scenario identifier');
  for (const field of ['triggerRef', 'idempotencyRef', 'requestRef'] as const) {
    if (!OPAQUE_REF.test(string(record[field], 128, `Durable scenario ${field}`))) {
      throw new TypeError(`Durable scenario ${field} is invalid`);
    }
  }
  boundedOptionalString(record.errorCode, 128, 'Durable scenario error');
  return cloneSnapshot(record as unknown as ScenarioExecutionSnapshot);
}

function conditionalFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as {
    readonly name?: unknown;
    readonly CancellationReasons?: readonly Readonly<{ Code?: unknown }>[];
  };
  if (candidate.name === 'ConditionalCheckFailedException') return true;
  return candidate.name === 'TransactionCanceledException'
    && candidate.CancellationReasons !== undefined
    && candidate.CancellationReasons.some((reason) => reason.Code === 'ConditionalCheckFailed');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/**
 * Durable scenario persistence with account-partition isolation, atomic
 * idempotency admission, monotonic version writes, and deletion tombstones.
 *
 * The configured GSI must use `GSI1PK` (partition) and `GSI1SK` (sort), with
 * ALL projection. Tombstoning precedes bounded batch deletion, so a concurrent
 * create either commits before the tombstone and is deleted, or fails closed.
 */
export class DynamoScenarioExecutionRepository implements ScenarioExecutionRepository {
  private readonly client: DocumentClient;
  private readonly tableName: string;
  private readonly createdAtIndexName: string;
  private readonly keyPrefix: string;
  private readonly pageSize: number;
  private readonly maxAccountRecords: number;
  private readonly maxPaginationPages: number;
  private readonly maxBatchRetries: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: DynamoScenarioExecutionRepositoryOptions) {
    if (!options?.client || typeof options.client.send !== 'function') {
      throw new TypeError('DynamoDB document client is required');
    }
    if (!TABLE_NAME.test(options.tableName ?? '')) throw new TypeError('DynamoDB table name is invalid');
    const indexName = options.createdAtIndexName ?? 'AI_NATIVE_CREATED_AT_INDEX';
    if (!TABLE_NAME.test(indexName)) throw new TypeError('Scenario created-at index name is invalid');
    const keyPrefix = options.keyPrefix ?? 'AI_NATIVE_SCENARIO';
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(keyPrefix)) throw new TypeError('Scenario key prefix is invalid');
    this.client = options.client;
    this.tableName = options.tableName;
    this.createdAtIndexName = indexName;
    this.keyPrefix = keyPrefix;
    this.pageSize = integer(options.pageSize ?? 100, 1, 500, 'Scenario page size');
    this.maxAccountRecords = integer(options.maxAccountRecords ?? 10_000, 1, 100_000, 'Scenario account capacity');
    this.maxPaginationPages = integer(options.maxPaginationPages ?? 1_000, 1, 10_000, 'Scenario pagination bound');
    this.maxBatchRetries = integer(options.maxBatchRetries ?? 5, 0, 20, 'Scenario batch retry bound');
    if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('Scenario clock is invalid');
    if (options.sleep !== undefined && typeof options.sleep !== 'function') throw new TypeError('Scenario sleep function is invalid');
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async create(execution: ScenarioExecutionSnapshot): Promise<{
    readonly created: boolean;
    readonly execution: ScenarioExecutionSnapshot;
  }> {
    const snapshot = parseSnapshot(execution);
    const accountPk = this.accountPk(snapshot.accountRef);
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        {
          ConditionCheck: {
            TableName: this.tableName,
            Key: { PK: accountPk, SK: 'META' },
            ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :active',
            ExpressionAttributeValues: { ':active': 'active' }
          }
        },
        {
          Put: {
            TableName: this.tableName,
            Item: this.executionItem(snapshot),
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          }
        },
        {
          Put: {
            TableName: this.tableName,
            Item: {
              PK: accountPk,
              SK: `IDEMP#${snapshot.idempotencyRef}`,
              entity: 'ai_native_scenario_idempotency',
              account_ref: snapshot.accountRef,
              execution_id: snapshot.executionId,
              request_ref: snapshot.requestRef,
              created_at: snapshot.createdAt
            },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          }
        }
      ] }));
      return Object.freeze({ created: true, execution: snapshot });
    } catch (error) {
      if (!conditionalFailure(error)) throw error;
      if (await this.accountDeleted(snapshot.accountRef)) {
        throw Object.assign(new Error('Scenario account data has been deleted'), {
          code: 'ACCOUNT_DATA_DELETED'
        });
      }
      const mapping = await this.getItem({ PK: accountPk, SK: `IDEMP#${snapshot.idempotencyRef}` });
      const existingId = mapping && typeof mapping.execution_id === 'string' ? mapping.execution_id : undefined;
      if (!existingId) throw new Error('Scenario conditional admission failed without an idempotency record');
      const existing = await this.get(snapshot.accountRef, existingId);
      if (!existing) throw new Error('Scenario idempotency index is inconsistent');
      return Object.freeze({ created: false, execution: existing });
    }
  }

  async put(execution: ScenarioExecutionSnapshot): Promise<void> {
    const snapshot = parseSnapshot(execution);
    const item = this.executionItem(snapshot);
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        {
          ConditionCheck: {
            TableName: this.tableName,
            Key: { PK: item.PK, SK: 'META' },
            ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :active',
            ExpressionAttributeValues: { ':active': 'active' }
          }
        },
        {
          Update: {
            TableName: this.tableName,
            Key: { PK: item.PK, SK: item.SK },
            UpdateExpression: [
              'SET #snapshot = :snapshot',
              '#version = :version',
              '#state = :state',
              'updated_at = :updatedAt',
              'created_at = :createdAt',
              'GSI1PK = :gsiPk',
              'GSI1SK = :gsiSk'
            ].join(', '),
            ConditionExpression: [
              'attribute_exists(PK)',
              'attribute_exists(SK)',
              'account_ref = :accountRef',
              'execution_id = :executionId',
              '#version < :version'
            ].join(' AND '),
            ExpressionAttributeNames: {
              '#snapshot': 'snapshot',
              '#version': 'version',
              '#state': 'state'
            },
            ExpressionAttributeValues: {
              ':snapshot': snapshot,
              ':version': snapshot.version,
              ':state': snapshot.state,
              ':updatedAt': snapshot.updatedAt,
              ':createdAt': snapshot.createdAt,
              ':accountRef': snapshot.accountRef,
              ':executionId': snapshot.executionId,
              ':gsiPk': item.GSI1PK,
              ':gsiSk': item.GSI1SK
            }
          }
        }
      ] }));
    } catch (error) {
      // A response can be lost after DynamoDB commits. Exact durable equality
      // makes that outcome success without accepting another writer's version.
      let durable: ScenarioExecutionSnapshot | undefined;
      try {
        durable = await this.get(snapshot.accountRef, snapshot.executionId);
      } catch {}
      if (durable && canonical(durable) === canonical(snapshot)) return;
      if (conditionalFailure(error)) {
        if (await this.accountDeleted(snapshot.accountRef)) {
          throw Object.assign(new Error('Scenario account data has been deleted'), {
            code: 'ACCOUNT_DATA_DELETED',
            cause: error
          });
        }
        throw Object.assign(new Error(durable
          ? 'Scenario execution version is stale'
          : 'Scenario execution does not exist'), {
          code: durable ? 'SCENARIO_EXECUTION_STALE' : 'SCENARIO_EXECUTION_NOT_FOUND',
          cause: error
        });
      }
      throw error;
    }
  }

  async get(accountRef: string, executionId: string): Promise<ScenarioExecutionSnapshot | undefined> {
    const key = this.executionKey(accountRef, executionId);
    const response = await this.client.send(new TransactGetCommand({ TransactItems: [
      { Get: { TableName: this.tableName, Key: { PK: key.PK, SK: 'META' } } },
      { Get: { TableName: this.tableName, Key: key } }
    ] })) as { readonly Responses?: readonly Readonly<{ Item?: unknown }>[] };
    const meta = response.Responses?.[0]?.Item;
    if (meta !== undefined && plainObject(meta, 'Durable scenario account').deletion_state === 'deleted') {
      return undefined;
    }
    const item = response.Responses?.[1]?.Item;
    const execution = item === undefined ? undefined : plainObject(item, 'Durable scenario record');
    return execution?.snapshot === undefined
      ? undefined
      : parseSnapshot(execution.snapshot, accountRef, executionId);
  }

  async list(accountRef: string, limit = 100): Promise<readonly ScenarioExecutionSnapshot[]> {
    this.validateAccountRef(accountRef);
    const boundedLimit = integer(limit, 1, 500, 'Scenario list limit');
    if (await this.accountDeleted(accountRef)) return Object.freeze([]);
    const results: ScenarioExecutionSnapshot[] = [];
    let cursor: DynamoKey | undefined;
    const seenCursors = new Set<string>();
    for (let page = 0; page < this.maxPaginationPages && results.length < boundedLimit; page += 1) {
      const response = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: this.createdAtIndexName,
        KeyConditionExpression: 'GSI1PK = :accountPk',
        ExpressionAttributeValues: { ':accountPk': this.accountPk(accountRef) },
        ScanIndexForward: true,
        Limit: Math.min(this.pageSize, boundedLimit - results.length),
        ...(cursor ? { ExclusiveStartKey: cursor } : {})
      })) as { readonly Items?: readonly Record<string, unknown>[]; readonly LastEvaluatedKey?: DynamoKey };
      for (const item of response.Items ?? []) {
        if (item.snapshot !== undefined) results.push(parseSnapshot(item.snapshot, accountRef));
        if (results.length >= boundedLimit) break;
      }
      cursor = response.LastEvaluatedKey;
      if (!cursor) return await this.accountDeleted(accountRef) ? Object.freeze([]) : Object.freeze(results);
      this.assertNewCursor(cursor, seenCursors);
    }
    if (cursor && results.length < boundedLimit) throw new Error('Scenario list pagination bound exceeded');
    return await this.accountDeleted(accountRef) ? Object.freeze([]) : Object.freeze(results);
  }

  async listAll(accountRef: string): Promise<readonly ScenarioExecutionSnapshot[]> {
    this.validateAccountRef(accountRef);
    if (await this.accountDeleted(accountRef)) return Object.freeze([]);
    const results: ScenarioExecutionSnapshot[] = [];
    let cursor: DynamoKey | undefined;
    const seenCursors = new Set<string>();
    for (let page = 0; page < this.maxPaginationPages; page += 1) {
      const response = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :accountPk AND begins_with(SK, :executionPrefix)',
        ExpressionAttributeValues: {
          ':accountPk': this.accountPk(accountRef),
          ':executionPrefix': 'EXEC#'
        },
        ConsistentRead: true,
        Limit: this.pageSize,
        ...(cursor ? { ExclusiveStartKey: cursor } : {})
      })) as { readonly Items?: readonly Record<string, unknown>[]; readonly LastEvaluatedKey?: DynamoKey };
      for (const item of response.Items ?? []) {
        if (item.snapshot === undefined) continue;
        if (results.length >= this.maxAccountRecords) throw new Error('Scenario account export bound exceeded');
        results.push(parseSnapshot(item.snapshot, accountRef));
      }
      cursor = response.LastEvaluatedKey;
      if (!cursor) {
        results.sort((left, right) => right.createdAt - left.createdAt || left.executionId.localeCompare(right.executionId));
        return await this.accountDeleted(accountRef) ? Object.freeze([]) : Object.freeze(results);
      }
      this.assertNewCursor(cursor, seenCursors);
    }
    throw new Error('Scenario account export pagination bound exceeded');
  }

  async deleteAccount(accountRef: string): Promise<number> {
    this.validateAccountRef(accountRef);
    const accountPk = this.accountPk(accountRef);
    await this.client.send(new PutCommand({
      TableName: this.tableName,
      Item: {
        PK: accountPk,
        SK: 'META',
        entity: 'ai_native_scenario_account',
        account_ref: accountRef,
        deletion_state: 'deleted',
        deleted_at: integer(this.now(), 0, Number.MAX_SAFE_INTEGER, 'Scenario deletion time')
      }
    }));

    let deleted = 0;
    let cursor: DynamoKey | undefined;
    const seenCursors = new Set<string>();
    for (let page = 0; page < this.maxPaginationPages; page += 1) {
      const response = await this.client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :accountPk',
        ExpressionAttributeValues: { ':accountPk': accountPk },
        ConsistentRead: true,
        Limit: this.pageSize,
        ...(cursor ? { ExclusiveStartKey: cursor } : {})
      })) as { readonly Items?: readonly Record<string, unknown>[]; readonly LastEvaluatedKey?: DynamoKey };
      const items = (response.Items ?? []).filter((item) => item.SK !== 'META');
      for (let offset = 0; offset < items.length; offset += 25) {
        const batch = items.slice(offset, offset + 25).map((item) => ({
          DeleteRequest: { Key: { PK: item.PK, SK: item.SK } }
        }));
        await this.deleteBatch(batch);
      }
      deleted += items.filter((item) => typeof item.SK === 'string' && item.SK.startsWith('EXEC#')).length;
      cursor = response.LastEvaluatedKey;
      if (!cursor) return deleted;
      this.assertNewCursor(cursor, seenCursors);
    }
    throw new Error('Scenario account deletion pagination bound exceeded');
  }

  private async deleteBatch(requests: readonly Readonly<Record<string, unknown>>[]): Promise<void> {
    let pending = [...requests];
    for (let attempt = 0; pending.length > 0 && attempt <= this.maxBatchRetries; attempt += 1) {
      const response = await this.client.send(new BatchWriteCommand({
        RequestItems: { [this.tableName]: pending }
      })) as { readonly UnprocessedItems?: Readonly<Record<string, readonly Record<string, unknown>[]>> };
      pending = [...(response.UnprocessedItems?.[this.tableName] ?? [])];
      if (pending.length > 0 && attempt < this.maxBatchRetries) await this.sleep(Math.min(1_000, 25 * (2 ** attempt)));
    }
    if (pending.length > 0) throw new Error('Scenario account deletion left unprocessed DynamoDB records');
  }

  private async accountDeleted(accountRef: string): Promise<boolean> {
    const meta = await this.getItem({ PK: this.accountPk(accountRef), SK: 'META' });
    return meta?.deletion_state === 'deleted';
  }

  private async getItem(key: DynamoKey): Promise<Record<string, unknown> | undefined> {
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: key,
      ConsistentRead: true
    }));
    const item = (response as { readonly Item?: unknown }).Item;
    return item === undefined ? undefined : plainObject(item, 'Durable scenario record');
  }

  private executionItem(snapshot: ScenarioExecutionSnapshot): Record<string, unknown> {
    const key = this.executionKey(snapshot.accountRef, snapshot.executionId);
    return {
      ...key,
      entity: 'ai_native_scenario_execution',
      account_ref: snapshot.accountRef,
      execution_id: snapshot.executionId,
      idempotency_ref: snapshot.idempotencyRef,
      request_ref: snapshot.requestRef,
      created_at: snapshot.createdAt,
      updated_at: snapshot.updatedAt,
      version: snapshot.version,
      state: snapshot.state,
      GSI1PK: this.accountPk(snapshot.accountRef),
      GSI1SK: `${String(Number.MAX_SAFE_INTEGER - snapshot.createdAt).padStart(16, '0')}#${snapshot.executionId}`,
      snapshot
    };
  }

  private executionKey(accountRef: string, executionId: string): Readonly<{ PK: string; SK: string }> {
    this.validateAccountRef(accountRef);
    if (!EXECUTION_ID.test(executionId ?? '')) throw new TypeError('Scenario execution identifier is invalid');
    return Object.freeze({ PK: this.accountPk(accountRef), SK: `EXEC#${executionId}` });
  }

  private accountPk(accountRef: string): string {
    this.validateAccountRef(accountRef);
    return `${this.keyPrefix}#${accountRef}`;
  }

  private validateAccountRef(accountRef: string): void {
    if (!OPAQUE_REF.test(accountRef ?? '')) throw new TypeError('Scenario account reference is invalid');
  }

  private assertNewCursor(cursor: DynamoKey, seen: Set<string>): void {
    const key = canonical(cursor);
    if (seen.has(key)) throw new Error('DynamoDB returned a repeated scenario pagination cursor');
    seen.add(key);
  }
}
