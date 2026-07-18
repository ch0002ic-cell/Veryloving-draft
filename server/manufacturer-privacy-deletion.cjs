'use strict';

const crypto = require('node:crypto');

const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ROBOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_ADAPTERS = 32;
const MAX_ROBOTS = 1000;

function privacyDeletionError(message, code, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function normalizeDeletionPlan(plan) {
  if (!Array.isArray(plan) || plan.length > MAX_ADAPTERS) {
    throw new TypeError('Manufacturer deletion plan is invalid');
  }
  let robotCount = 0;
  const adapters = new Map();
  for (const entry of plan) {
    const adapterId = entry?.adapterId;
    if (typeof adapterId !== 'string' || !ADAPTER_ID_PATTERN.test(adapterId) || adapters.has(adapterId)) {
      throw new TypeError('Manufacturer deletion plan is invalid');
    }
    if (!Array.isArray(entry.robotIds)) throw new TypeError('Manufacturer deletion plan is invalid');
    const robotIds = [...new Set(entry.robotIds)].sort();
    if (robotIds.some((robotId) => typeof robotId !== 'string' || !ROBOT_ID_PATTERN.test(robotId))) {
      throw new TypeError('Manufacturer deletion plan is invalid');
    }
    robotCount += robotIds.length;
    if (robotCount > MAX_ROBOTS) throw new TypeError('Manufacturer deletion plan is invalid');
    adapters.set(adapterId, Object.freeze({ adapterId, robotIds: Object.freeze(robotIds) }));
  }
  return Object.freeze([...adapters.values()].sort((left, right) => left.adapterId.localeCompare(right.adapterId)));
}

function deletionPlanFingerprint(plan) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(normalizeDeletionPlan(plan).map(({ adapterId, robotIds }) => [adapterId, robotIds])))
    .digest('base64url');
}

function opaqueAccountKey(secret, userId) {
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify(['veryloving-privacy-account-v1', userId]))
    .digest('base64url');
}

function stableOperationId(secret, userId) {
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify(['veryloving-manufacturer-erasure-v1', userId]))
    .digest('base64url');
}

function adapterIdempotencyKey(operationId, adapterId) {
  if (!OPERATION_ID_PATTERN.test(operationId || '') || !ADAPTER_ID_PATTERN.test(adapterId || '')) {
    throw new TypeError('Manufacturer deletion operation identity is invalid');
  }
  return crypto.createHash('sha256')
    .update(JSON.stringify(['veryloving-manufacturer-adapter-erasure-v1', operationId, adapterId]))
    .digest('base64url');
}

function normalizeRecord(item, expected = {}) {
  const completedAdapters = Array.isArray(item?.completed_adapters)
    ? [...new Set(item.completed_adapters)]
    : [];
  if (
    !item
    || !OPERATION_ID_PATTERN.test(item.operation_id || '')
    || !OPERATION_ID_PATTERN.test(item.plan_fingerprint || '')
    || !Array.isArray(item.adapter_ids)
    || item.adapter_ids.some((adapterId) => !ADAPTER_ID_PATTERN.test(adapterId))
    || completedAdapters.some((adapterId) => !item.adapter_ids.includes(adapterId))
    || !['in_progress', 'completed'].includes(item.deletion_state)
  ) {
    throw privacyDeletionError(
      'Manufacturer deletion checkpoint is invalid',
      'PRIVACY_DELETE_CHECKPOINT_INVALID'
    );
  }
  if (expected.operationId && item.operation_id !== expected.operationId) {
    throw privacyDeletionError(
      'Manufacturer deletion operation conflicts with durable state',
      'PRIVACY_DELETE_OPERATION_CONFLICT',
      409
    );
  }
  if (
    expected.planFingerprint
    && item.deletion_state !== 'completed'
    && item.plan_fingerprint !== expected.planFingerprint
  ) {
    // Once deletion has started, silently accepting a different target set
    // could omit a processor or delete a newly-added device without review.
    throw privacyDeletionError(
      'Manufacturer deletion target plan changed during execution',
      'PRIVACY_DELETE_PLAN_CHANGED',
      409
    );
  }
  return Object.freeze({
    operationId: item.operation_id,
    planFingerprint: item.plan_fingerprint,
    adapterIds: Object.freeze([...item.adapter_ids]),
    completedAdapters: Object.freeze(completedAdapters),
    state: item.deletion_state
  });
}

function createDynamoManufacturerPrivacyDeletionRepository({
  tableName,
  region,
  secret,
  client: injectedClient
} = {}) {
  if (typeof tableName !== 'string' || !tableName) throw new Error('Manufacturer deletion table is required');
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('Manufacturer deletion checkpoint secret must contain at least 32 characters');
  }
  let client = injectedClient;
  let commands;
  if (!client) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true }
    });
    commands = { GetCommand, PutCommand, UpdateCommand };
  } else {
    const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    commands = { GetCommand, PutCommand, UpdateCommand };
  }
  const conditional = (error) => error?.name === 'ConditionalCheckFailedException';
  const key = (userId) => ({
    PK: `PRIVACY_DELETE#${opaqueAccountKey(secret, userId)}`,
    SK: 'MANUFACTURER#ERASURE'
  });

  async function get(userId) {
    const result = await client.send(new commands.GetCommand({
      TableName: tableName,
      Key: key(userId),
      ConsistentRead: true
    }));
    return result.Item || null;
  }

  return {
    async begin(userId, plan, now = Date.now()) {
      if (typeof userId !== 'string' || !userId) throw new TypeError('A user is required for privacy deletion');
      const normalizedPlan = normalizeDeletionPlan(plan);
      const operationId = stableOperationId(secret, userId);
      const planFingerprint = deletionPlanFingerprint(normalizedPlan);
      const expected = { operationId, planFingerprint };
      const existing = await get(userId);
      if (existing) return normalizeRecord(existing, expected);
      const item = {
        ...key(userId),
        entity: 'manufacturer-privacy-erasure',
        operation_id: operationId,
        plan_fingerprint: planFingerprint,
        adapter_ids: normalizedPlan.map(({ adapterId }) => adapterId),
        completed_adapters: [],
        deletion_state: 'in_progress',
        created_at: now,
        updated_at: now
      };
      try {
        await client.send(new commands.PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }));
        return normalizeRecord(item, expected);
      } catch (error) {
        if (!conditional(error)) throw error;
        const raced = await get(userId);
        return normalizeRecord(raced, expected);
      }
    },

    async markAdapterCompleted(userId, operationId, adapterId, now = Date.now()) {
      if (!OPERATION_ID_PATTERN.test(operationId || '') || !ADAPTER_ID_PATTERN.test(adapterId || '')) {
        throw new TypeError('Manufacturer deletion checkpoint identity is invalid');
      }
      try {
        const result = await client.send(new commands.UpdateCommand({
          TableName: tableName,
          Key: key(userId),
          UpdateExpression: 'SET completed_adapters = list_append(completed_adapters, :adapter), updated_at = :now',
          ConditionExpression: 'operation_id = :operationId AND deletion_state = :inProgress AND contains(adapter_ids, :adapterId) AND NOT contains(completed_adapters, :adapterId)',
          ExpressionAttributeValues: {
            ':adapter': [adapterId],
            ':adapterId': adapterId,
            ':operationId': operationId,
            ':inProgress': 'in_progress',
            ':now': now
          },
          ReturnValues: 'ALL_NEW'
        }));
        return normalizeRecord(result.Attributes, { operationId });
      } catch (error) {
        if (!conditional(error)) throw error;
        const current = normalizeRecord(await get(userId), { operationId });
        if (current.completedAdapters.includes(adapterId) || current.state === 'completed') return current;
        throw privacyDeletionError(
          'Manufacturer deletion adapter checkpoint could not be committed',
          'PRIVACY_DELETE_CHECKPOINT_CONFLICT',
          409
        );
      }
    },

    async markCompleted(userId, operationId, adapterCount, now = Date.now()) {
      if (!OPERATION_ID_PATTERN.test(operationId || '')
        || !Number.isSafeInteger(adapterCount) || adapterCount < 0 || adapterCount > MAX_ADAPTERS) {
        throw new TypeError('Manufacturer deletion checkpoint identity is invalid');
      }
      try {
        const result = await client.send(new commands.UpdateCommand({
          TableName: tableName,
          Key: key(userId),
          UpdateExpression: 'SET deletion_state = :completed, completed_at = :now, updated_at = :now',
          ConditionExpression: 'operation_id = :operationId AND (deletion_state = :completed OR (deletion_state = :inProgress AND size(completed_adapters) = :adapterCount))',
          ExpressionAttributeValues: {
            ':operationId': operationId,
            ':completed': 'completed',
            ':inProgress': 'in_progress',
            ':adapterCount': adapterCount,
            ':now': now
          },
          ReturnValues: 'ALL_NEW'
        }));
        return normalizeRecord(result.Attributes, { operationId });
      } catch (error) {
        if (!conditional(error)) throw error;
        const current = normalizeRecord(await get(userId), { operationId });
        if (current.state === 'completed') return current;
        throw privacyDeletionError(
          'Manufacturer deletion operation is incomplete',
          'PRIVACY_DELETE_CHECKPOINT_INCOMPLETE'
        );
      }
    }
  };
}

function createManufacturerPrivacyDeletionCoordinator({ repository, deleteAdapter } = {}) {
  for (const method of ['begin', 'markAdapterCompleted', 'markCompleted']) {
    if (typeof repository?.[method] !== 'function') {
      throw new Error(`Manufacturer deletion repository is missing ${method}`);
    }
  }
  if (typeof deleteAdapter !== 'function') throw new Error('Manufacturer adapter deletion handler is required');

  return {
    async deleteUserData(userId, plan) {
      const normalizedPlan = normalizeDeletionPlan(plan);
      let checkpoint = await repository.begin(userId, normalizedPlan);
      if (checkpoint.state === 'completed') {
        return { deleted: normalizedPlan.reduce((total, entry) => total + entry.robotIds.length, 0) };
      }
      const completed = new Set(checkpoint.completedAdapters);
      for (const { adapterId, robotIds } of normalizedPlan) {
        if (completed.has(adapterId)) continue;
        await deleteAdapter(adapterId, robotIds, {
          idempotencyKey: adapterIdempotencyKey(checkpoint.operationId, adapterId)
        });
        checkpoint = await repository.markAdapterCompleted(userId, checkpoint.operationId, adapterId);
        completed.add(adapterId);
      }
      await repository.markCompleted(userId, checkpoint.operationId, normalizedPlan.length);
      return { deleted: normalizedPlan.reduce((total, entry) => total + entry.robotIds.length, 0) };
    }
  };
}

module.exports = {
  adapterIdempotencyKey,
  createDynamoManufacturerPrivacyDeletionRepository,
  createManufacturerPrivacyDeletionCoordinator,
  deletionPlanFingerprint,
  normalizeDeletionPlan
};
