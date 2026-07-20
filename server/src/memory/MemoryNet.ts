import { createHash, timingSafeEqual } from 'node:crypto';
import {
  AccountDataCipher,
  AccountDataConflictError,
  AccountDataValidationError,
  type AccountDataKeyring,
  type CiphertextRepository
} from '../models/UserState';

const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const MEMORY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MEMORY_SCHEMA_VERSION = 1 as const;

export type MemorySource = 'user' | 'wearable' | 'home_robot' | 'system';
export type MemoryKind = 'conversation_summary' | 'health_trend' | 'life_event' | 'preference';
export type TrendDirection = 'increasing' | 'decreasing' | 'stable' | 'mixed';

interface MemoryBase {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly source: MemorySource;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly recordRevision: number;
}

export interface ConversationSummaryMemory extends MemoryBase {
  readonly kind: 'conversation_summary';
  /** Privacy-preserving summary; raw transcripts are intentionally unsupported. */
  readonly summary: string;
  readonly occurredAt: string;
  readonly topics: readonly string[];
  readonly emotionalTone?: string;
}

export interface HealthTrendMemory extends MemoryBase {
  readonly kind: 'health_trend';
  readonly metric: string;
  readonly period: 'weekly' | 'monthly';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly direction: TrendDirection;
  readonly summary: string;
}

export interface LifeEventMemory extends MemoryBase {
  readonly kind: 'life_event';
  readonly summary: string;
  readonly occurredAt: string;
  readonly salience: number;
  readonly tags: readonly string[];
}

export interface PreferenceMemory extends MemoryBase {
  readonly kind: 'preference';
  readonly category: string;
  readonly value: string;
  readonly preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
}

export type MemoryEntry =
  | ConversationSummaryMemory
  | HealthTrendMemory
  | LifeEventMemory
  | PreferenceMemory;

type StoredFields = 'createdAt' | 'updatedAt' | 'recordRevision';
export type MemoryInput =
  | Omit<ConversationSummaryMemory, StoredFields>
  | Omit<HealthTrendMemory, StoredFields>
  | Omit<LifeEventMemory, StoredFields>
  | Omit<PreferenceMemory, StoredFields>;

export interface RelationshipMetadata {
  readonly interactingSince: string;
  readonly interactionCount: number;
  /** User-controlled personalization signal, not an authentication decision. */
  readonly trustLevel: number;
  readonly lastInteractionAt?: string;
  readonly updatedAt: string;
  readonly recordRevision: number;
}

export interface RelationshipUpdate {
  readonly interactingSince?: string;
  readonly interactionCount?: number;
  readonly trustLevel?: number;
  readonly lastInteractionAt?: string | null;
}

export interface RecallQuery {
  readonly query?: string;
  readonly kinds?: readonly MemoryKind[];
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

export interface MemoryListQuery {
  readonly kind?: MemoryKind;
  readonly offset?: number;
  readonly limit?: number;
}

export interface RecalledMemory {
  readonly memory: MemoryEntry;
  /** Deterministic local relevance/recency score in [0, 1]. */
  readonly score: number;
}

export interface TrendSummaryQuery {
  readonly metric?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface MemoryExport {
  readonly format: 'veryloving-memory-net';
  readonly schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly relationship: RelationshipMetadata | null;
  readonly memories: readonly MemoryEntry[];
}

export interface MemoryMutationOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

interface MemoryReceipt {
  readonly fingerprint: string;
  readonly result: MemoryEntry | RelationshipMetadata;
}

interface MemoryAggregate {
  readonly schemaVersion: typeof MEMORY_SCHEMA_VERSION;
  readonly revision: number;
  readonly memories: readonly MemoryEntry[];
  readonly relationship: RelationshipMetadata | null;
  readonly receipts: Readonly<Record<string, MemoryReceipt>>;
  readonly receiptOrder: readonly string[];
}

export interface MemoryNetOptions {
  readonly repository: CiphertextRepository;
  /** Legacy single-key configuration. Exactly 32 bytes and treated as version 1. */
  readonly encryptionKey?: Uint8Array;
  /** Preferred rotation-safe configuration. Mutually exclusive with `encryptionKey`. */
  readonly encryptionKeyring?: AccountDataKeyring;
  readonly clock?: () => Date;
  readonly maxMemories?: number;
  readonly maxIdempotencyRecords?: number;
  readonly maxWriteRetries?: number;
  readonly recencyHalfLifeDays?: number;
}

function validation(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AccountDataValidationError(message);
}

function validateAccountId(accountId: string): void {
  validation(typeof accountId === 'string' && ACCOUNT_ID.test(accountId), 'accountId is invalid');
}

function plainObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  validation(typeof value === 'object' && value !== null && !Array.isArray(value), `${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  validation(prototype === Object.prototype || prototype === null, `${name} must be a plain object`);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) validation(allowed.includes(key), `${name}.${key} is not supported`);
}

function boundedString(value: unknown, name: string, maximum: number): asserts value is string {
  validation(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, `${name} is invalid`);
  validation(!/[\u0000-\u001f\u007f]/u.test(value), `${name} contains control characters`);
}

function isoDate(value: unknown, name: string): asserts value is string {
  boundedString(value, name, 40);
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

function finite(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
  validation(typeof value === 'number' && Number.isFinite(value), `${name} must be finite`);
  validation(value >= minimum && value <= maximum, `${name} is outside its supported range`);
}

function integer(value: unknown, minimum: number, maximum: number, name: string): asserts value is number {
  finite(value, minimum, maximum, name);
  validation(Number.isSafeInteger(value), `${name} must be an integer`);
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): asserts value is T {
  validation(typeof value === 'string' && values.includes(value as T), `${name} is invalid`);
}

function stringList(value: unknown, name: string): void {
  validation(Array.isArray(value) && value.length <= 24, `${name} must be a bounded array`);
  const normalized = new Set<string>();
  value.forEach((item, index) => {
    boundedString(item, `${name}[${index}]`, 64);
    const key = item.trim().toLocaleLowerCase('en-US');
    validation(!normalized.has(key), `${name} contains duplicate values`);
    normalized.add(key);
  });
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

function validateMemoryInput(value: unknown): asserts value is MemoryInput {
  plainObject(value, 'memory');
  rejectUndefined(value, 'memory');
  boundedString(value.id, 'memory.id', 128);
  validation(MEMORY_ID.test(value.id), 'memory.id is invalid');
  enumValue(value.source, ['user', 'wearable', 'home_robot', 'system'], 'memory.source');
  enumValue(value.kind, ['conversation_summary', 'health_trend', 'life_event', 'preference'], 'memory.kind');

  switch (value.kind) {
    case 'conversation_summary':
      exactKeys(value, ['id', 'kind', 'source', 'summary', 'occurredAt', 'topics', 'emotionalTone'], 'memory');
      boundedString(value.summary, 'memory.summary', 2_000);
      isoDate(value.occurredAt, 'memory.occurredAt');
      stringList(value.topics, 'memory.topics');
      if (value.emotionalTone !== undefined) boundedString(value.emotionalTone, 'memory.emotionalTone', 64);
      break;
    case 'health_trend':
      exactKeys(value, ['id', 'kind', 'source', 'metric', 'period', 'periodStart', 'periodEnd', 'direction', 'summary'], 'memory');
      boundedString(value.metric, 'memory.metric', 96);
      enumValue(value.period, ['weekly', 'monthly'], 'memory.period');
      isoDate(value.periodStart, 'memory.periodStart');
      isoDate(value.periodEnd, 'memory.periodEnd');
      validation(Date.parse(value.periodStart) <= Date.parse(value.periodEnd), 'memory trend period is invalid');
      enumValue(value.direction, ['increasing', 'decreasing', 'stable', 'mixed'], 'memory.direction');
      boundedString(value.summary, 'memory.summary', 2_000);
      break;
    case 'life_event':
      exactKeys(value, ['id', 'kind', 'source', 'summary', 'occurredAt', 'salience', 'tags'], 'memory');
      boundedString(value.summary, 'memory.summary', 2_000);
      isoDate(value.occurredAt, 'memory.occurredAt');
      finite(value.salience, 0, 1, 'memory.salience');
      stringList(value.tags, 'memory.tags');
      break;
    case 'preference':
      exactKeys(value, ['id', 'kind', 'source', 'category', 'value', 'preferredTimeOfDay'], 'memory');
      boundedString(value.category, 'memory.category', 96);
      boundedString(value.value, 'memory.value', 512);
      if (value.preferredTimeOfDay !== undefined) {
        enumValue(value.preferredTimeOfDay, ['morning', 'afternoon', 'evening', 'night'], 'memory.preferredTimeOfDay');
      }
      break;
  }
}

function validateStoredMemory(value: unknown): asserts value is MemoryEntry {
  plainObject(value, 'storedMemory');
  const { createdAt, updatedAt, recordRevision, ...input } = value;
  isoDate(createdAt, 'storedMemory.createdAt');
  isoDate(updatedAt, 'storedMemory.updatedAt');
  integer(recordRevision, 1, Number.MAX_SAFE_INTEGER, 'storedMemory.recordRevision');
  validateMemoryInput(input);
}

function validateRelationshipUpdate(value: unknown): asserts value is RelationshipUpdate {
  plainObject(value, 'relationshipUpdate');
  exactKeys(value, ['interactingSince', 'interactionCount', 'trustLevel', 'lastInteractionAt'], 'relationshipUpdate');
  rejectUndefined(value, 'relationshipUpdate');
  validation(Object.keys(value).length > 0, 'relationshipUpdate must not be empty');
  if (value.interactingSince !== undefined) isoDate(value.interactingSince, 'relationshipUpdate.interactingSince');
  if (value.interactionCount !== undefined) integer(value.interactionCount, 0, 1_000_000_000, 'relationshipUpdate.interactionCount');
  if (value.trustLevel !== undefined) finite(value.trustLevel, 0, 100, 'relationshipUpdate.trustLevel');
  if (value.lastInteractionAt !== undefined && value.lastInteractionAt !== null) isoDate(value.lastInteractionAt, 'relationshipUpdate.lastInteractionAt');
}

function validateRelationship(value: unknown): asserts value is RelationshipMetadata {
  plainObject(value, 'relationship');
  exactKeys(value, ['interactingSince', 'interactionCount', 'trustLevel', 'lastInteractionAt', 'updatedAt', 'recordRevision'], 'relationship');
  isoDate(value.interactingSince, 'relationship.interactingSince');
  integer(value.interactionCount, 0, 1_000_000_000, 'relationship.interactionCount');
  finite(value.trustLevel, 0, 100, 'relationship.trustLevel');
  if (value.lastInteractionAt !== undefined) isoDate(value.lastInteractionAt, 'relationship.lastInteractionAt');
  isoDate(value.updatedAt, 'relationship.updatedAt');
  integer(value.recordRevision, 1, Number.MAX_SAFE_INTEGER, 'relationship.recordRevision');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
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

function emptyAggregate(): MemoryAggregate {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    revision: 0,
    memories: [],
    relationship: null,
    receipts: {},
    receiptOrder: []
  };
}

function validateAggregate(value: MemoryAggregate, repositoryRevision: number): void {
  plainObject(value as unknown, 'memoryAggregate');
  exactKeys(value as unknown as Record<string, unknown>,
    ['schemaVersion', 'revision', 'memories', 'relationship', 'receipts', 'receiptOrder'],
    'memoryAggregate');
  validation(value.schemaVersion === MEMORY_SCHEMA_VERSION, 'Memory schema is unsupported');
  integer(value.revision, 1, Number.MAX_SAFE_INTEGER, 'memoryAggregate.revision');
  validation(value.revision === repositoryRevision, 'Memory revision does not match repository revision');
  validation(Array.isArray(value.memories) && value.memories.length <= 100_000, 'Stored memories are invalid');
  value.memories.forEach(validateStoredMemory);
  if (value.relationship !== null) validateRelationship(value.relationship);
  plainObject(value.receipts as unknown, 'memoryReceipts');
  validation(Object.keys(value.receipts).length <= 2_000, 'Memory receipts are invalid');
  for (const [key, receipt] of Object.entries(value.receipts)) {
    validation(IDEMPOTENCY_KEY.test(key), 'Stored memory idempotency key is invalid');
    plainObject(receipt as unknown, 'memoryReceipt');
    exactKeys(receipt as unknown as Record<string, unknown>, ['fingerprint', 'result'], 'memoryReceipt');
    validation(typeof receipt.fingerprint === 'string' && /^[A-Za-z0-9_-]{43}$/.test(receipt.fingerprint),
      'Stored memory fingerprint is invalid');
    plainObject(receipt.result as unknown, 'memoryReceipt.result');
    if ('kind' in receipt.result) validateStoredMemory(receipt.result);
    else validateRelationship(receipt.result);
  }
  validation(Array.isArray(value.receiptOrder) && value.receiptOrder.length <= 2_000,
    'Memory receipt order is invalid');
  const receiptKeys = new Set(value.receiptOrder);
  validation(receiptKeys.size === value.receiptOrder.length
    && value.receiptOrder.every((key) => typeof key === 'string' && value.receipts[key] !== undefined)
    && Object.keys(value.receipts).every((key) => receiptKeys.has(key)), 'Memory receipts are inconsistent');
}

function searchable(memory: MemoryEntry): string {
  switch (memory.kind) {
    case 'conversation_summary': return `${memory.summary} ${memory.topics.join(' ')} ${memory.emotionalTone ?? ''}`;
    case 'health_trend': return `${memory.metric} ${memory.direction} ${memory.summary}`;
    case 'life_event': return `${memory.summary} ${memory.tags.join(' ')}`;
    case 'preference': return `${memory.category} ${memory.value} ${memory.preferredTimeOfDay ?? ''}`;
  }
}

function tokenize(value: string): ReadonlySet<string> {
  return new Set(value.toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

function memoryTime(memory: MemoryEntry): number {
  switch (memory.kind) {
    case 'conversation_summary': return Date.parse(memory.occurredAt);
    case 'health_trend': return Date.parse(memory.periodEnd);
    case 'life_event': return Date.parse(memory.occurredAt);
    case 'preference': return Date.parse(memory.updatedAt);
  }
}

export class MemoryNet {
  private readonly repository: CiphertextRepository;
  private readonly cipher: AccountDataCipher;
  private readonly clock: () => Date;
  private readonly maxMemories: number;
  private readonly maxReceipts: number;
  private readonly maxWriteRetries: number;
  private readonly halfLifeMs: number;
  private readonly localTails = new Map<string, Promise<void>>();
  private readonly deletedAccountRefs = new Set<string>();
  private readonly domain = 'memory-net';

  constructor(options: MemoryNetOptions) {
    plainObject(options as unknown, 'options');
    validation(typeof options.repository?.get === 'function' && typeof options.repository?.compareAndSet === 'function',
      'repository must implement the ciphertext persistence contract');
    integer(options.maxMemories ?? 2_000, 1, 100_000, 'maxMemories');
    integer(options.maxIdempotencyRecords ?? 256, 1, 2_000, 'maxIdempotencyRecords');
    integer(options.maxWriteRetries ?? 32, 1, 100, 'maxWriteRetries');
    finite(options.recencyHalfLifeDays ?? 30, 1, 3_650, 'recencyHalfLifeDays');
    validation(options.clock === undefined || typeof options.clock === 'function', 'clock must be a function');
    this.repository = options.repository;
    this.cipher = new AccountDataCipher({
      encryptionKey: options.encryptionKey,
      encryptionKeyring: options.encryptionKeyring
    });
    this.clock = options.clock ?? (() => new Date());
    this.maxMemories = options.maxMemories ?? 2_000;
    this.maxReceipts = options.maxIdempotencyRecords ?? 256;
    this.maxWriteRetries = options.maxWriteRetries ?? 32;
    this.halfLifeMs = (options.recencyHalfLifeDays ?? 30) * 86_400_000;
  }

  async storeMemory(
    accountId: string,
    memory: MemoryInput,
    options: MemoryMutationOptions = {}
  ): Promise<MemoryEntry> {
    validateAccountId(accountId);
    this.assertWritable(accountId);
    validateMemoryInput(memory);
    this.validateMutationOptions(options);
    const safeMemory = clone(memory);
    const fingerprint = this.fingerprint({ operation: 'store', memory: safeMemory });

    return this.mutate(accountId, options.idempotencyKey, fingerprint, options.signal, (aggregate, revision, now) => {
      const existingIndex = aggregate.memories.findIndex((entry) => entry.id === safeMemory.id);
      const existing = existingIndex < 0 ? undefined : aggregate.memories[existingIndex];
      const entry = {
        ...safeMemory,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        recordRevision: revision
      } as MemoryEntry;
      const memories = aggregate.memories.filter((_, index) => index !== existingIndex);
      memories.push(entry);
      return { result: entry, memories: memories.slice(-this.maxMemories), relationship: aggregate.relationship };
    });
  }

  async listMemories(
    accountId: string,
    query: MemoryListQuery = {}
  ): Promise<readonly MemoryEntry[]> {
    validateAccountId(accountId);
    plainObject(query as unknown, 'memoryListQuery');
    exactKeys(query as unknown as Record<string, unknown>, ['kind', 'offset', 'limit'], 'memoryListQuery');
    if (query.kind !== undefined) {
      enumValue(query.kind, ['conversation_summary', 'health_trend', 'life_event', 'preference'], 'memoryListQuery.kind');
    }
    integer(query.offset ?? 0, 0, 100_000, 'memoryListQuery.offset');
    integer(query.limit ?? 100, 1, 500, 'memoryListQuery.limit');
    const { aggregate } = await this.load(accountId);
    const matching = query.kind === undefined
      ? aggregate.memories
      : aggregate.memories.filter((entry) => entry.kind === query.kind);
    return immutable(matching.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100)));
  }

  async recall(accountId: string, query: RecallQuery = {}): Promise<readonly RecalledMemory[]> {
    validateAccountId(accountId);
    plainObject(query as unknown, 'recallQuery');
    exactKeys(query as unknown as Record<string, unknown>, ['query', 'kinds', 'since', 'until', 'limit'], 'recallQuery');
    if (query.query !== undefined) boundedString(query.query, 'recallQuery.query', 500);
    if (query.kinds !== undefined) {
      validation(Array.isArray(query.kinds) && query.kinds.length > 0 && query.kinds.length <= 4, 'recallQuery.kinds is invalid');
      query.kinds.forEach((kind) => enumValue(kind, ['conversation_summary', 'health_trend', 'life_event', 'preference'], 'recallQuery.kind'));
    }
    if (query.since !== undefined) isoDate(query.since, 'recallQuery.since');
    if (query.until !== undefined) isoDate(query.until, 'recallQuery.until');
    validation(query.since === undefined || query.until === undefined || Date.parse(query.since) <= Date.parse(query.until),
      'recallQuery range is invalid');
    integer(query.limit ?? 10, 1, 100, 'recallQuery.limit');
    const queryTokens = tokenize(query.query ?? '');
    const hasTextQuery = query.query !== undefined;
    const kinds = query.kinds;
    const since = query.since === undefined ? undefined : Date.parse(query.since);
    const until = query.until === undefined ? undefined : Date.parse(query.until);
    const limit = query.limit ?? 10;
    const now = this.clock().getTime();
    validation(Number.isFinite(now), 'clock returned an invalid date');
    const { aggregate } = await this.load(accountId);

    const results = aggregate.memories
      .filter((memory) => kinds === undefined || kinds.includes(memory.kind))
      .filter((memory) => since === undefined || memoryTime(memory) >= since)
      .filter((memory) => until === undefined || memoryTime(memory) <= until)
      .map((memory): RecalledMemory & { readonly tokenOverlap: number } => {
        const memoryTokens = tokenize(searchable(memory));
        let overlap = 0;
        queryTokens.forEach((token) => { if (memoryTokens.has(token)) overlap += 1; });
        const relevance = queryTokens.size === 0 ? 1 : overlap / queryTokens.size;
        const age = Math.max(0, now - memoryTime(memory));
        const recency = 2 ** (-age / this.halfLifeMs);
        const salience = memory.kind === 'life_event' ? memory.salience : 0.5;
        const score = Math.min(1, Math.max(0, relevance * 0.65 + recency * 0.25 + salience * 0.1));
        return { memory, score: Number(score.toFixed(6)), tokenOverlap: overlap };
      })
      .filter((result) => !hasTextQuery || (queryTokens.size > 0 && result.tokenOverlap > 0))
      .sort((left, right) => right.score - left.score || memoryTime(right.memory) - memoryTime(left.memory))
      .slice(0, limit);
    return immutable(results.map(({ memory, score }) => ({ memory, score })));
  }

  async getTrendSummaries(
    accountId: string,
    query: TrendSummaryQuery = {}
  ): Promise<readonly HealthTrendMemory[]> {
    validateAccountId(accountId);
    plainObject(query as unknown, 'trendSummaryQuery');
    exactKeys(query as unknown as Record<string, unknown>, ['metric', 'from', 'to', 'limit'], 'trendSummaryQuery');
    if (query.metric !== undefined) boundedString(query.metric, 'trendSummaryQuery.metric', 96);
    if (query.from !== undefined) isoDate(query.from, 'trendSummaryQuery.from');
    if (query.to !== undefined) isoDate(query.to, 'trendSummaryQuery.to');
    validation(query.from === undefined || query.to === undefined || Date.parse(query.from) <= Date.parse(query.to),
      'trendSummaryQuery range is invalid');
    integer(query.limit ?? 52, 1, 1_000, 'trendSummaryQuery.limit');
    const { aggregate } = await this.load(accountId);
    const normalizedMetric = query.metric?.trim().toLocaleLowerCase('en-US');
    const from = query.from === undefined ? undefined : Date.parse(query.from);
    const to = query.to === undefined ? undefined : Date.parse(query.to);
    const limit = query.limit ?? 52;
    const trends = aggregate.memories
      .filter((memory): memory is HealthTrendMemory => memory.kind === 'health_trend')
      .filter((memory) => normalizedMetric === undefined || memory.metric.trim().toLocaleLowerCase('en-US') === normalizedMetric)
      .filter((memory) => from === undefined || Date.parse(memory.periodEnd) >= from)
      .filter((memory) => to === undefined || Date.parse(memory.periodStart) <= to)
      .sort((left, right) => Date.parse(right.periodEnd) - Date.parse(left.periodEnd))
      .slice(0, limit);
    return immutable(trends);
  }

  async updateRelationship(
    accountId: string,
    update: RelationshipUpdate,
    options: MemoryMutationOptions = {}
  ): Promise<RelationshipMetadata> {
    validateAccountId(accountId);
    this.assertWritable(accountId);
    validateRelationshipUpdate(update);
    this.validateMutationOptions(options);
    const safeUpdate = clone(update);
    const fingerprint = this.fingerprint({ operation: 'relationship', update: safeUpdate });
    return this.mutate(accountId, options.idempotencyKey, fingerprint, options.signal, (aggregate, revision, now) => {
      const current = aggregate.relationship;
      const lastInteractionAt = safeUpdate.lastInteractionAt === null
        ? undefined
        : safeUpdate.lastInteractionAt ?? current?.lastInteractionAt;
      const relationship: RelationshipMetadata = {
        interactingSince: safeUpdate.interactingSince ?? current?.interactingSince ?? now,
        interactionCount: safeUpdate.interactionCount ?? current?.interactionCount ?? 0,
        trustLevel: safeUpdate.trustLevel ?? current?.trustLevel ?? 0,
        ...(lastInteractionAt === undefined ? {} : { lastInteractionAt }),
        updatedAt: now,
        recordRevision: revision
      };
      return { result: relationship, memories: aggregate.memories, relationship };
    });
  }

  async getRelationshipMetadata(accountId: string): Promise<RelationshipMetadata | null> {
    const { aggregate } = await this.load(accountId);
    return aggregate.relationship === null ? null : immutable(aggregate.relationship);
  }

  async deleteMemory(accountId: string, memoryId: string): Promise<boolean> {
    validateAccountId(accountId);
    this.assertWritable(accountId);
    validation(typeof memoryId === 'string' && MEMORY_ID.test(memoryId), 'memoryId is invalid');
    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        const loaded = await this.load(accountId);
        if (!loaded.aggregate.memories.some((entry) => entry.id === memoryId)) return false;
        const revision = loaded.aggregate.revision + 1;
        const retainedReceipts = Object.fromEntries(Object.entries(loaded.aggregate.receipts)
          .filter(([, receipt]) => !('id' in receipt.result) || receipt.result.id !== memoryId));
        const retainedReceiptOrder = loaded.aggregate.receiptOrder
          .filter((key) => retainedReceipts[key] !== undefined);
        const aggregate: MemoryAggregate = {
          ...loaded.aggregate,
          revision,
          memories: loaded.aggregate.memories.filter((entry) => entry.id !== memoryId),
          receipts: retainedReceipts,
          receiptOrder: retainedReceiptOrder
        };
        const record = this.cipher.encrypt(loaded.storageKey, this.domain, revision, aggregate);
        if (await this.repository.compareAndSet(loaded.storageKey, loaded.repositoryRevision, record)) return true;
      }
      throw new AccountDataConflictError('Memory could not be deleted after bounded contention retries');
    });
  }

  /**
   * User-requested memory reset. This is deliberately distinct from
   * `deleteAllData`, which installs the non-reopenable account-erasure fence.
   * The versioned empty aggregate makes the reset linearizable under CAS while
   * allowing a later, explicitly new memory to be created.
   */
  async clearAllMemories(
    accountId: string,
    options: Readonly<{ signal?: AbortSignal }> = {}
  ): Promise<boolean> {
    validateAccountId(accountId);
    this.assertWritable(accountId);
    plainObject(options as unknown, 'clearOptions');
    exactKeys(options as unknown as Record<string, unknown>, ['signal'], 'clearOptions');
    validation(options.signal === undefined || typeof options.signal.aborted === 'boolean',
      'clearOptions.signal is invalid');
    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        this.throwIfAborted(options.signal);
        const loaded = await this.load(accountId);
        this.throwIfAborted(options.signal);
        if (loaded.repositoryRevision === null) return false;
        const hasData = loaded.aggregate.memories.length > 0
          || loaded.aggregate.relationship !== null
          || loaded.aggregate.receiptOrder.length > 0;
        if (!hasData) return false;
        const revision = loaded.aggregate.revision + 1;
        const aggregate: MemoryAggregate = {
          schemaVersion: MEMORY_SCHEMA_VERSION,
          revision,
          memories: [],
          relationship: null,
          receipts: {},
          receiptOrder: []
        };
        const record = this.cipher.encrypt(loaded.storageKey, this.domain, revision, aggregate);
        this.throwIfAborted(options.signal);
        if (await this.repository.compareAndSet(loaded.storageKey, loaded.repositoryRevision, record)) return true;
      }
      throw new AccountDataConflictError('Memories could not be cleared after bounded contention retries');
    });
  }

  async exportData(accountId: string): Promise<MemoryExport> {
    const { aggregate } = await this.load(accountId);
    return immutable({
      format: 'veryloving-memory-net',
      schemaVersion: MEMORY_SCHEMA_VERSION,
      exportedAt: this.now(),
      relationship: aggregate.relationship,
      memories: aggregate.memories
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
        const aggregate = this.cipher.decrypt<MemoryAggregate>(storageKey, this.domain, current);
        validateAggregate(aggregate, current.revision);
        const rotated = this.cipher.encrypt(storageKey, this.domain, current.revision, aggregate);
        if (await this.repository.compareAndSet(storageKey, current.revision, rotated)) return true;
      }
      throw new AccountDataConflictError('Memory encryption migration failed after bounded contention retries');
    });
  }

  async deleteAllData(accountId: string): Promise<boolean> {
    validateAccountId(accountId);
    this.deletedAccountRefs.add(this.cipher.storageKey(accountId, this.domain));
    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        const storageKey = this.cipher.storageKey(accountId, this.domain);
        const current = await this.repository.get(storageKey);
        if (current === null) return false;
        if (await this.repository.compareAndSet(storageKey, current.revision, null)) return true;
      }
      throw new AccountDataConflictError('Memory data could not be deleted after bounded contention retries');
    });
  }

  private async mutate<T extends MemoryEntry | RelationshipMetadata>(
    accountId: string,
    idempotencyKey: string | undefined,
    fingerprint: string,
    signal: AbortSignal | undefined,
    mutation: (
      aggregate: MemoryAggregate,
      revision: number,
      now: string
    ) => { result: T; memories: readonly MemoryEntry[]; relationship: RelationshipMetadata | null }
  ): Promise<T> {
    return this.withLocalLock(accountId, async () => {
      for (let attempt = 0; attempt < this.maxWriteRetries; attempt += 1) {
        this.throwIfAborted(signal);
        const loaded = await this.load(accountId);
        this.throwIfAborted(signal);
        const receipt = idempotencyKey === undefined ? undefined : loaded.aggregate.receipts[idempotencyKey];
        if (receipt !== undefined) {
          const left = Buffer.from(receipt.fingerprint);
          const right = Buffer.from(fingerprint);
          validation(left.length === right.length && timingSafeEqual(left, right),
            'idempotencyKey was already used for a different memory mutation');
          return immutable(receipt.result as T);
        }
        const revision = loaded.aggregate.revision + 1;
        const changed = mutation(loaded.aggregate, revision, this.now());
        const retainedMemoryRevisions = new Map(changed.memories
          .map((entry) => [entry.id, entry.recordRevision] as const));
        const receipts: Record<string, MemoryReceipt> = Object.fromEntries(
          Object.entries(loaded.aggregate.receipts).filter(([, storedReceipt]) => {
            if ('kind' in storedReceipt.result) {
              return retainedMemoryRevisions.get(storedReceipt.result.id) === storedReceipt.result.recordRevision;
            }
            return changed.relationship?.recordRevision === storedReceipt.result.recordRevision;
          })
        );
        let receiptOrder = loaded.aggregate.receiptOrder
          .filter((key) => receipts[key] !== undefined);
        if (idempotencyKey !== undefined) {
          receipts[idempotencyKey] = { fingerprint, result: changed.result };
          receiptOrder.push(idempotencyKey);
          while (receiptOrder.length > this.maxReceipts) {
            const evicted = receiptOrder.shift();
            if (evicted !== undefined) delete receipts[evicted];
          }
        }
        const aggregate: MemoryAggregate = {
          schemaVersion: MEMORY_SCHEMA_VERSION,
          revision,
          memories: changed.memories,
          relationship: changed.relationship,
          receipts,
          receiptOrder
        };
        const record = this.cipher.encrypt(loaded.storageKey, this.domain, revision, aggregate);
        this.throwIfAborted(signal);
        if (await this.repository.compareAndSet(loaded.storageKey, loaded.repositoryRevision, record)) {
          return immutable(changed.result);
        }
      }
      throw new AccountDataConflictError('Memory mutation failed after bounded contention retries');
    });
  }

  private async load(accountId: string): Promise<{
    storageKey: string;
    repositoryRevision: number | null;
    aggregate: MemoryAggregate;
  }> {
    validateAccountId(accountId);
    const storageKey = this.cipher.storageKey(accountId, this.domain);
    const record = await this.repository.get(storageKey);
    if (record === null) return { storageKey, repositoryRevision: null, aggregate: emptyAggregate() };
    const aggregate = this.cipher.decrypt<MemoryAggregate>(storageKey, this.domain, record);
    validateAggregate(aggregate, record.revision);
    return { storageKey, repositoryRevision: record.revision, aggregate };
  }

  private validateMutationOptions(options: MemoryMutationOptions): void {
    plainObject(options as unknown, 'mutationOptions');
    exactKeys(options as unknown as Record<string, unknown>, ['idempotencyKey', 'signal'], 'mutationOptions');
    if (options.idempotencyKey !== undefined) validation(IDEMPOTENCY_KEY.test(options.idempotencyKey), 'idempotencyKey is invalid');
    validation(options.signal === undefined || typeof options.signal.aborted === 'boolean', 'mutationOptions.signal is invalid');
    this.throwIfAborted(options.signal);
  }

  private assertWritable(accountId: string): void {
    if (this.deletedAccountRefs.has(this.cipher.storageKey(accountId, this.domain))) {
      throw new AccountDataConflictError('Memory account has been deleted');
    }
  }

  private throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw Object.assign(new Error('Memory operation was cancelled'), {
        name: 'AbortError',
        code: 'OPERATION_CANCELLED'
      });
    }
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(canonical(value)).digest('base64url');
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
