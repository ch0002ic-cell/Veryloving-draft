import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  type DynamoDBDocumentClient
} from '@aws-sdk/lib-dynamodb';
import type { CiphertextRecord, CiphertextRepository } from './UserState';

const STORAGE_KEY = /^[a-z][a-z0-9-]{0,63}_[A-Za-z0-9_-]{43}$/;
const TABLE_NAME = /^[A-Za-z0-9_.-]{3,255}$/;
const MAX_DYNAMODB_ITEM_BYTES = 350_000;

type DocumentClient = Pick<DynamoDBDocumentClient, 'send'>;

export interface DynamoCiphertextRepositoryOptions {
  readonly client: DocumentClient;
  readonly tableName: string;
  /** Namespace permits safe coexistence in a shared single-table deployment. */
  readonly keyPrefix?: string;
  /** Must leave room below DynamoDB's 400 KB item limit for keys and metadata. */
  readonly maxCiphertextBytes?: number;
}

function conditionalFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { readonly name?: unknown }).name === 'ConditionalCheckFailedException';
}

function safeInteger(value: unknown, minimum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as number;
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function parseRecord(value: unknown, maximumBytes: number): CiphertextRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Durable ciphertext record is invalid');
  }
  const item = value as Record<string, unknown>;
  if (item.algorithm !== 'aes-256-gcm') throw new TypeError('Durable ciphertext algorithm is invalid');
  const record: CiphertextRecord = Object.freeze({
    algorithm: 'aes-256-gcm',
    keyVersion: safeInteger(item.keyVersion, 1, 'Durable ciphertext key version'),
    revision: safeInteger(item.revision, 1, 'Durable ciphertext revision'),
    iv: boundedString(item.iv, 64, 'Durable ciphertext IV'),
    authTag: boundedString(item.authTag, 128, 'Durable ciphertext authentication tag'),
    ciphertext: boundedString(item.ciphertext, maximumBytes, 'Durable ciphertext payload')
  });
  if (Buffer.byteLength(record.ciphertext, 'utf8') > maximumBytes) {
    throw new TypeError('Durable ciphertext payload exceeds the DynamoDB item bound');
  }
  return record;
}

/**
 * Conditional, opaque-key DynamoDB persistence for UserState and MemoryNet.
 *
 * Plaintext account identifiers never cross this boundary: callers supply the
 * HMAC-derived storage key produced by AccountDataCipher. The repository uses
 * strongly consistent reads and revision conditions so competing replicas
 * cannot overwrite or delete a newer encrypted aggregate.
 */
export class DynamoCiphertextRepository implements CiphertextRepository {
  private readonly client: DocumentClient;
  private readonly tableName: string;
  private readonly keyPrefix: string;
  private readonly maxCiphertextBytes: number;

  constructor(options: DynamoCiphertextRepositoryOptions) {
    if (!options?.client || typeof options.client.send !== 'function') {
      throw new TypeError('DynamoDB document client is required');
    }
    if (!TABLE_NAME.test(options.tableName ?? '')) throw new TypeError('DynamoDB table name is invalid');
    const keyPrefix = options.keyPrefix ?? 'AI_NATIVE_CIPHERTEXT';
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(keyPrefix)) throw new TypeError('Ciphertext key prefix is invalid');
    const maximum = options.maxCiphertextBytes ?? 300_000;
    if (!Number.isSafeInteger(maximum) || maximum < 1_024 || maximum > MAX_DYNAMODB_ITEM_BYTES) {
      throw new TypeError('Ciphertext item bound is invalid');
    }
    this.client = options.client;
    this.tableName = options.tableName;
    this.keyPrefix = keyPrefix;
    this.maxCiphertextBytes = maximum;
  }

  async get(storageKey: string): Promise<CiphertextRecord | null> {
    const key = this.key(storageKey);
    const response = await this.client.send(new GetCommand({
      TableName: this.tableName,
      Key: key,
      ConsistentRead: true,
      ProjectionExpression: 'algorithm, keyVersion, revision, iv, authTag, ciphertext'
    }));
    const item = (response as { readonly Item?: unknown }).Item;
    return item === undefined ? null : parseRecord(item, this.maxCiphertextBytes);
  }

  async compareAndSet(
    storageKey: string,
    expectedRevision: number | null,
    next: CiphertextRecord | null
  ): Promise<boolean> {
    const key = this.key(storageKey);
    if (expectedRevision !== null) safeInteger(expectedRevision, 1, 'Expected ciphertext revision');
    if (next !== null) {
      const record = parseRecord(next, this.maxCiphertextBytes);
      try {
        await this.client.send(new PutCommand({
          TableName: this.tableName,
          Item: { ...key, entity: 'ai_native_ciphertext', ...record },
          ConditionExpression: expectedRevision === null
            ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
            : '#revision = :expectedRevision',
          ...(expectedRevision === null ? {} : {
            ExpressionAttributeNames: { '#revision': 'revision' },
            ExpressionAttributeValues: { ':expectedRevision': expectedRevision }
          })
        }));
        return true;
      } catch (error) {
        if (conditionalFailure(error)) return false;
        throw error;
      }
    }

    try {
      await this.client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: key,
        ConditionExpression: expectedRevision === null
          ? 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          : '#revision = :expectedRevision',
        ...(expectedRevision === null ? {} : {
          ExpressionAttributeNames: { '#revision': 'revision' },
          ExpressionAttributeValues: { ':expectedRevision': expectedRevision }
        })
      }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      throw error;
    }
  }

  private key(storageKey: string): Readonly<{ PK: string; SK: 'CURRENT' }> {
    if (!STORAGE_KEY.test(storageKey ?? '')) throw new TypeError('Ciphertext storage key is invalid');
    return Object.freeze({ PK: `${this.keyPrefix}#${storageKey}`, SK: 'CURRENT' });
  }
}
