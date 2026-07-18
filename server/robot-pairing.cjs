'use strict';

const crypto = require('node:crypto');
const { redactSerial } = require('./action-gateway.cjs');

function createDynamoRobotRepository({
  tableName,
  region,
  client: injectedClient,
  resetRecoveryIndexName,
  accountStateTableName
} = {}) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    DynamoDBDocumentClient,
    DeleteCommand,
    GetCommand,
    QueryCommand,
    ScanCommand,
    TransactWriteCommand,
    UpdateCommand
  } = require('@aws-sdk/lib-dynamodb');
  const client = injectedClient || DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
  async function findBoundRobot(userId, robotId) {
    let exclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'ROBOT#', ':id': robotId },
        ProjectionExpression: 'id, manufacturerDeviceId, adapterId, serialHash, pairingClaimHash, pairingTokenHash, pairedAt, bindingEpoch, lifecycleState, resetId, resetRequestedAt, resetRemoteCompletedAt, resetAttempt, resetLeaseOwner, resetLeaseExpiresAt, nextResetAttemptAt, SK',
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      const match = result.Items?.find((item) => item.id === robotId);
      if (match) return match;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return null;
  }

  function validBindingEpoch(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function effectiveLifecycleState(record) {
    return typeof record?.lifecycleState === 'string' ? record.lifecycleState : 'migration_required';
  }

  function publicBinding(record) {
    if (typeof record?.manufacturerDeviceId !== 'string' || !validBindingEpoch(record.bindingEpoch)) return null;
    return {
      manufacturerDeviceId: record.manufacturerDeviceId,
      adapterId: typeof record.adapterId === 'string' ? record.adapterId : 'manufacturer-default',
      bindingEpoch: record.bindingEpoch,
      lifecycleState: effectiveLifecycleState(record)
    };
  }

  function resetCheckpoint(record) {
    const binding = publicBinding(record);
    if (!binding || typeof record.resetId !== 'string') return null;
    return {
      ...binding,
      robotId: record.id,
      resetId: record.resetId,
      resetRequestedAt: record.resetRequestedAt,
      resetRemoteCompletedAt: record.resetRemoteCompletedAt,
      resetAttempt: Number.isSafeInteger(record.resetAttempt) ? record.resetAttempt : 0,
      resetLeaseOwner: record.resetLeaseOwner,
      resetLeaseExpiresAt: record.resetLeaseExpiresAt,
      nextResetAttemptAt: record.nextResetAttemptAt
    };
  }

  function validateResetId(value, name = 'Reset identifier') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) {
      throw Object.assign(new Error(`${name} is invalid`), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    }
  }

  function validateTimestamp(value, name = 'Reset timestamp') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw Object.assign(new Error(`${name} is invalid`), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    }
  }

  function timingSafeTokenMatches(token, expectedHash) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof expectedHash !== 'string') return false;
    const supplied = Buffer.from(crypto.createHash('sha256').update(token).digest('base64url'));
    const expected = Buffer.from(expectedHash);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }

  async function accountDeletionState(userId) {
    if (!accountStateTableName) return 'active';
    const result = await client.send(new GetCommand({
      TableName: accountStateTableName,
      Key: { PK: `USER#${userId}`, SK: 'ACCOUNT#STATE' },
      ProjectionExpression: 'deletion_state',
      ConsistentRead: true
    }));
    const state = result.Item?.deletion_state || 'active';
    if (!['active', 'deleting', 'deleted'].includes(state)) {
      throw Object.assign(new Error('Account pairing state is invalid'), {
        statusCode: 503,
        code: 'ACCOUNT_STATE_INVALID'
      });
    }
    return state;
  }

  async function assertAccountCanPair(userId) {
    const state = await accountDeletionState(userId);
    if (state === 'deleting') {
      throw Object.assign(new Error('Account deletion is in progress'), {
        statusCode: 423,
        code: 'ACCOUNT_DELETION_IN_PROGRESS'
      });
    }
    if (state === 'deleted') {
      throw Object.assign(new Error('Account has been deleted'), {
        statusCode: 410,
        code: 'ACCOUNT_DELETED'
      });
    }
  }

  function accountPairingCondition(userId) {
    if (!accountStateTableName) return null;
    return { ConditionCheck: {
      TableName: accountStateTableName,
      Key: { PK: `USER#${userId}`, SK: 'ACCOUNT#STATE' },
      ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :active',
      ExpressionAttributeValues: { ':active': 'active' }
    } };
  }

  async function readResetReceipt(userId, robotId) {
    const result = await client.send(new GetCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `ROBOT_RESET#${robotId}` },
      ConsistentRead: true
    }));
    return result.Item || null;
  }

  async function queryBoundRobots(userId, projectionExpression = 'id, adapterId, pairedAt') {
    const robots = [];
    let exclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'ROBOT#' },
        ProjectionExpression: projectionExpression,
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      robots.push(...(result.Items || []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return robots;
  }
  async function deleteResetReceipts(userId) {
    let deleted = 0;
    let exclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'ROBOT_RESET#' },
        ProjectionExpression: 'SK',
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      for (const receipt of result.Items || []) {
        if (typeof receipt.SK !== 'string' || !receipt.SK.startsWith('ROBOT_RESET#')) continue;
        await client.send(new DeleteCommand({
          TableName: tableName,
          Key: { PK: `USER#${userId}`, SK: receipt.SK },
          ConditionExpression: 'entity = :entity',
          ExpressionAttributeValues: { ':entity': 'robot-reset-receipt' }
        }));
        deleted += 1;
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return deleted;
  }
  async function list(userId) {
    const robots = await queryBoundRobots(userId);
    return robots.flatMap((item) => (
      typeof item.id === 'string' && item.id
          ? [{
            robot_id: item.id,
            device_type: 'home_robot',
            adapter_id: typeof item.adapterId === 'string' ? item.adapterId : 'manufacturer-default',
            ...(Number.isFinite(item.pairedAt) ? { paired_at: item.pairedAt } : {})
          }]
        : []
    ));
  }
  async function unbind(userId, robotId) {
    const record = await findBoundRobot(userId, robotId);
    if (!record) return null;
    const serialHash = typeof record.serialHash === 'string' && record.serialHash
      ? record.serialHash
      : typeof record.SK === 'string' && record.SK.startsWith('ROBOT#') ? record.SK.slice(6) : null;
    if (!serialHash || !record.manufacturerDeviceId) return null;
    if (!validBindingEpoch(record.bindingEpoch) || effectiveLifecycleState(record) === 'migration_required') {
      throw Object.assign(new Error('Robot binding requires an epoch migration before it can be unbound'), {
        statusCode: 409,
        code: 'ROBOT_BINDING_MIGRATION_REQUIRED'
      });
    }
    if (effectiveLifecycleState(record) !== 'active') {
      throw Object.assign(new Error('Robot binding has a lifecycle operation in progress'), {
        statusCode: 409,
        code: 'ROBOT_BINDING_NOT_ACTIVE'
      });
    }
    const now = Date.now();
    const transactions = [
      { Delete: {
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: record.SK || `ROBOT#${serialHash}` },
        ConditionExpression: 'id = :robotId AND bindingEpoch = :epoch',
        ExpressionAttributeValues: { ':robotId': robotId, ':epoch': record.bindingEpoch }
      } },
      { Put: {
        TableName: tableName,
        Item: {
          PK: `ROBOT#${serialHash}`,
          SK: 'OWNER',
          lifecycleState: 'unbound',
          bindingEpoch: record.bindingEpoch,
          bindingEpochHighWater: record.bindingEpoch,
          unboundAt: now
        },
        ConditionExpression: 'bound_to = :userId AND bindingEpoch = :epoch',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':epoch': record.bindingEpoch
        }
      } }
    ];
    if (typeof record.pairingClaimHash === 'string' && /^[A-Za-z0-9_-]{43}$/.test(record.pairingClaimHash)) {
      transactions.push({ Update: {
        TableName: tableName,
        Key: { PK: `PAIRING#${record.pairingClaimHash}`, SK: 'CLAIM' },
        UpdateExpression: 'SET unbound_at = :now REMOVE bound_to, serial_hash',
        ConditionExpression: 'bound_to = :userId',
        ExpressionAttributeValues: { ':now': now, ':userId': userId }
      } });
    }
    await client.send(new TransactWriteCommand({ TransactItems: transactions }));
    return {
      manufacturerDeviceId: record.manufacturerDeviceId,
      adapterId: record.adapterId || 'manufacturer-default',
      bindingEpoch: record.bindingEpoch
    };
  }
  async function resumeBinding(userId, pairingCodeHash, pairingTokenHash) {
    await assertAccountCanPair(userId);
    const pairingKey = { PK: `PAIRING#${pairingCodeHash}`, SK: 'CLAIM' };
    const claim = await client.send(new GetCommand({
      TableName: tableName,
      Key: pairingKey,
      ConsistentRead: true
    }));
    if (!claim.Item?.used_at) return null;
    if (
      claim.Item.bound_to !== userId
      || typeof claim.Item.serial_hash !== 'string'
      || !/^[A-Za-z0-9_-]{43}$/.test(claim.Item.serial_hash)
    ) {
      const replay = new Error('Pairing code has already been used');
      replay.statusCode = 410;
      replay.code = 'ROBOT_PAIRING_REPLAY';
      throw replay;
    }
    const robotKey = { PK: `USER#${userId}`, SK: `ROBOT#${claim.Item.serial_hash}` };
    const bound = await client.send(new GetCommand({
      TableName: tableName,
      Key: robotKey,
      ConsistentRead: true
    }));
    if (
      typeof bound.Item?.id !== 'string'
      || bound.Item.pairingClaimHash !== pairingCodeHash
    ) {
      const inconsistent = new Error('Robot pairing state is incomplete');
      inconsistent.statusCode = 409;
      inconsistent.code = 'ROBOT_PAIRING_STATE_INCOMPLETE';
      throw inconsistent;
    }
    if (!validBindingEpoch(bound.Item.bindingEpoch) || effectiveLifecycleState(bound.Item) !== 'active') {
      throw Object.assign(new Error('Robot binding is not active'), {
        statusCode: 409,
        code: validBindingEpoch(bound.Item.bindingEpoch)
          ? 'ROBOT_BINDING_NOT_ACTIVE'
          : 'ROBOT_BINDING_MIGRATION_REQUIRED'
      });
    }
    // A same-account retry is deliberately idempotent. Rewriting the hash
    // supports key rotation while preserving the one-time claim's owner;
    // another account is rejected above before this mutation is possible.
    await client.send(new UpdateCommand({
      TableName: tableName,
      Key: robotKey,
      UpdateExpression: 'SET pairingTokenHash = :tokenHash',
      ConditionExpression: 'id = :robotId AND pairingClaimHash = :claimHash',
      ExpressionAttributeValues: {
        ':tokenHash': pairingTokenHash,
        ':robotId': bound.Item.id,
        ':claimHash': pairingCodeHash
      }
    }));
    return bound.Item;
  }

  async function beginFactoryReset(userId, robotId, pairingToken, requestedAt = Date.now()) {
    validateTimestamp(requestedAt);
    const record = await findBoundRobot(userId, robotId);
    if (!record) {
      const receipt = await readResetReceipt(userId, robotId);
      if (!receipt || !timingSafeTokenMatches(pairingToken, receipt.pairingTokenHash)) return null;
      return {
        robotId,
        resetId: receipt.resetId,
        bindingEpoch: receipt.bindingEpoch,
        lifecycleState: 'unbound',
        resetRemoteCompletedAt: receipt.resetRemoteCompletedAt,
        resetCompletedAt: receipt.resetCompletedAt,
        completed: true
      };
    }
    if (!validBindingEpoch(record.bindingEpoch) || effectiveLifecycleState(record) === 'migration_required') {
      throw Object.assign(new Error('Robot binding requires an epoch migration before factory reset'), {
        statusCode: 409,
        code: 'ROBOT_BINDING_MIGRATION_REQUIRED'
      });
    }
    if (!timingSafeTokenMatches(pairingToken, record.pairingTokenHash)) {
      throw Object.assign(new Error('Robot pairing token is invalid'), {
        statusCode: 403,
        code: 'ROBOT_PAIRING_TOKEN_INVALID'
      });
    }
    const state = effectiveLifecycleState(record);
    if (state !== 'active') {
      const checkpoint = resetCheckpoint(record);
      if (checkpoint && ['reset_pending', 'reset_in_progress', 'reset_remote_complete'].includes(state)) return checkpoint;
      throw Object.assign(new Error('Robot binding is not active'), {
        statusCode: 409,
        code: 'ROBOT_BINDING_NOT_ACTIVE'
      });
    }
    const resetId = crypto.randomUUID();
    const serialHash = record.serialHash || record.SK?.slice(6);
    const userValues = {
      ':active': 'active',
      ':pending': 'reset_pending',
      ':resetId': resetId,
      ':epoch': record.bindingEpoch,
      ':robotId': robotId,
      ':requestedAt': requestedAt,
      ':zero': 0,
      ':recoveryPk': 'ROBOT_RESET'
    };
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [
        { Update: {
          TableName: tableName,
          Key: { PK: `USER#${userId}`, SK: record.SK || `ROBOT#${serialHash}` },
          UpdateExpression: 'SET lifecycleState = :pending, resetId = :resetId, resetRequestedAt = :requestedAt, resetAttempt = :zero, nextResetAttemptAt = :requestedAt, resetRecoveryPk = :recoveryPk, resetRecoveryAt = :requestedAt',
          ConditionExpression: 'id = :robotId AND bindingEpoch = :epoch AND lifecycleState = :active',
          ExpressionAttributeValues: userValues
        } },
        { Update: {
          TableName: tableName,
          Key: { PK: `ROBOT#${serialHash}`, SK: 'OWNER' },
          UpdateExpression: 'SET lifecycleState = :pending, resetId = :resetId, resetRequestedAt = :requestedAt',
          ConditionExpression: 'bound_to = :userId AND bindingEpoch = :epoch AND lifecycleState = :active',
          ExpressionAttributeValues: {
            ':active': 'active',
            ':pending': 'reset_pending',
            ':resetId': resetId,
            ':epoch': record.bindingEpoch,
            ':userId': userId,
            ':requestedAt': requestedAt
          }
        } }
      ] }));
      return resetCheckpoint({
        ...record,
        lifecycleState: 'reset_pending',
        resetId,
        resetRequestedAt: requestedAt,
        resetAttempt: 0,
        nextResetAttemptAt: requestedAt
      });
    } catch (error) {
      if (error?.name !== 'TransactionCanceledException') throw error;
      const latest = await findBoundRobot(userId, robotId);
      const checkpoint = resetCheckpoint(latest);
      if (checkpoint && ['reset_pending', 'reset_in_progress', 'reset_remote_complete'].includes(checkpoint.lifecycleState)) {
        return checkpoint;
      }
      throw Object.assign(new Error('Robot reset could not be started'), {
        statusCode: 409,
        code: 'ROBOT_RESET_CONFLICT'
      });
    }
  }

  async function claimFactoryReset(userId, robotId, leaseOwner, claimedAt = Date.now(), leaseMs = 30000) {
    validateResetId(leaseOwner, 'Reset lease owner');
    validateTimestamp(claimedAt);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) {
      throw Object.assign(new Error('Reset lease duration is invalid'), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    }
    const record = await findBoundRobot(userId, robotId);
    const checkpoint = resetCheckpoint(record);
    if (!checkpoint) return null;
    if (checkpoint.lifecycleState === 'reset_remote_complete') return { ...checkpoint, claimed: false, remoteComplete: true };
    if (!['reset_pending', 'reset_in_progress'].includes(checkpoint.lifecycleState)) return { ...checkpoint, claimed: false };
    if (Number.isSafeInteger(record.nextResetAttemptAt) && record.nextResetAttemptAt > claimedAt) {
      return { ...checkpoint, claimed: false, retryAt: record.nextResetAttemptAt };
    }
    if (
      checkpoint.lifecycleState === 'reset_in_progress'
      && Number.isSafeInteger(record.resetLeaseExpiresAt)
      && record.resetLeaseExpiresAt > claimedAt
    ) {
      return { ...checkpoint, claimed: false, retryAt: record.resetLeaseExpiresAt };
    }
    const leaseExpiresAt = claimedAt + leaseMs;
    try {
      const result = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: record.SK },
        UpdateExpression: 'SET lifecycleState = :inProgress, resetLeaseOwner = :leaseOwner, resetLeaseExpiresAt = :leaseExpiresAt, resetAttempt = if_not_exists(resetAttempt, :zero) + :one, resetRecoveryPk = :recoveryPk, resetRecoveryAt = :leaseExpiresAt REMOVE nextResetAttemptAt, lastResetErrorCode',
        ConditionExpression: 'id = :robotId AND resetId = :resetId AND bindingEpoch = :epoch AND (lifecycleState = :pending OR (lifecycleState = :inProgress AND resetLeaseExpiresAt <= :claimedAt)) AND (attribute_not_exists(nextResetAttemptAt) OR nextResetAttemptAt <= :claimedAt)',
        ExpressionAttributeValues: {
          ':robotId': robotId,
          ':resetId': checkpoint.resetId,
          ':epoch': checkpoint.bindingEpoch,
          ':pending': 'reset_pending',
          ':inProgress': 'reset_in_progress',
          ':leaseOwner': leaseOwner,
          ':leaseExpiresAt': leaseExpiresAt,
          ':claimedAt': claimedAt,
          ':zero': 0,
          ':one': 1,
          ':recoveryPk': 'ROBOT_RESET'
        },
        ReturnValues: 'ALL_NEW'
      }));
      const claimedRecord = result.Attributes || {
        ...record,
        lifecycleState: 'reset_in_progress',
        resetLeaseOwner: leaseOwner,
        resetLeaseExpiresAt: leaseExpiresAt,
        resetAttempt: (checkpoint.resetAttempt || 0) + 1
      };
      return { ...resetCheckpoint(claimedRecord), claimed: true };
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
      const latest = resetCheckpoint(await findBoundRobot(userId, robotId));
      return latest ? { ...latest, claimed: false, retryAt: latest.resetLeaseExpiresAt || latest.nextResetAttemptAt } : null;
    }
  }

  async function markFactoryResetRemoteComplete(
    userId,
    robotId,
    resetId,
    bindingEpoch,
    completedAt = Date.now()
  ) {
    validateResetId(resetId);
    validateTimestamp(completedAt);
    if (!validBindingEpoch(bindingEpoch)) throw Object.assign(new Error('Binding epoch is invalid'), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    const record = await findBoundRobot(userId, robotId);
    const checkpoint = resetCheckpoint(record);
    if (!checkpoint) return null;
    if (checkpoint.resetId !== resetId || checkpoint.bindingEpoch !== bindingEpoch) {
      throw Object.assign(new Error('Robot reset checkpoint does not match'), { statusCode: 409, code: 'ROBOT_RESET_STALE' });
    }
    if (checkpoint.lifecycleState === 'reset_remote_complete') return checkpoint;
    if (checkpoint.lifecycleState !== 'reset_in_progress') {
      throw Object.assign(new Error('Robot reset is not claimed'), { statusCode: 409, code: 'ROBOT_RESET_NOT_CLAIMED' });
    }
    const serialHash = record.serialHash || record.SK?.slice(6);
    const userValues = {
      ':robotId': robotId,
      ':resetId': resetId,
      ':epoch': bindingEpoch,
      ':inProgress': 'reset_in_progress',
      ':remoteComplete': 'reset_remote_complete',
      ':completedAt': completedAt,
      ':recoveryPk': 'ROBOT_RESET'
    };
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [
        { Update: {
          TableName: tableName,
          Key: { PK: `USER#${userId}`, SK: record.SK },
          UpdateExpression: 'SET lifecycleState = :remoteComplete, resetRemoteCompletedAt = :completedAt, resetRecoveryPk = :recoveryPk, resetRecoveryAt = :completedAt REMOVE resetLeaseOwner, resetLeaseExpiresAt, nextResetAttemptAt, lastResetErrorCode',
          ConditionExpression: 'id = :robotId AND resetId = :resetId AND bindingEpoch = :epoch AND lifecycleState = :inProgress',
          ExpressionAttributeValues: userValues
        } },
        { Update: {
          TableName: tableName,
          Key: { PK: `ROBOT#${serialHash}`, SK: 'OWNER' },
          UpdateExpression: 'SET lifecycleState = :remoteComplete, resetRemoteCompletedAt = :completedAt',
          ConditionExpression: 'bound_to = :userId AND resetId = :resetId AND bindingEpoch = :epoch',
          ExpressionAttributeValues: {
            ':userId': userId,
            ':resetId': resetId,
            ':epoch': bindingEpoch,
            ':remoteComplete': 'reset_remote_complete',
            ':completedAt': completedAt
          }
        } }
      ] }));
      return {
        ...checkpoint,
        lifecycleState: 'reset_remote_complete',
        resetRemoteCompletedAt: completedAt
      };
    } catch (error) {
      if (error?.name !== 'TransactionCanceledException') throw error;
      const latest = resetCheckpoint(await findBoundRobot(userId, robotId));
      if (latest?.resetId === resetId && latest.bindingEpoch === bindingEpoch && latest.lifecycleState === 'reset_remote_complete') return latest;
      throw Object.assign(new Error('Robot reset checkpoint is stale'), { statusCode: 409, code: 'ROBOT_RESET_STALE' });
    }
  }

  async function recordFactoryResetFailure(
    userId,
    robotId,
    resetId,
    bindingEpoch,
    error,
    failedAt = Date.now(),
    nextAttemptAt = failedAt,
    leaseOwner
  ) {
    validateResetId(resetId);
    validateTimestamp(failedAt);
    validateTimestamp(nextAttemptAt, 'Next reset attempt');
    const errorCode = typeof error?.code === 'string' && /^[A-Z0-9_:-]{1,64}$/.test(error.code)
      ? error.code
      : 'ROBOT_RESET_REMOTE_FAILED';
    const record = await findBoundRobot(userId, robotId);
    const checkpoint = resetCheckpoint(record);
    if (!checkpoint || checkpoint.resetId !== resetId || checkpoint.bindingEpoch !== bindingEpoch) return null;
    if (checkpoint.lifecycleState === 'reset_remote_complete') return checkpoint;
    try {
      const result = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: record.SK },
        UpdateExpression: 'SET lifecycleState = :pending, lastResetErrorCode = :errorCode, lastResetFailedAt = :failedAt, nextResetAttemptAt = :nextAttemptAt, resetRecoveryPk = :recoveryPk, resetRecoveryAt = :nextAttemptAt REMOVE resetLeaseOwner, resetLeaseExpiresAt',
        ConditionExpression: `id = :robotId AND resetId = :resetId AND bindingEpoch = :epoch AND lifecycleState = :inProgress${leaseOwner ? ' AND resetLeaseOwner = :leaseOwner' : ''}`,
        ExpressionAttributeValues: {
          ':robotId': robotId,
          ':resetId': resetId,
          ':epoch': bindingEpoch,
          ':inProgress': 'reset_in_progress',
          ':pending': 'reset_pending',
          ':errorCode': errorCode,
          ':failedAt': failedAt,
          ':nextAttemptAt': nextAttemptAt,
          ':recoveryPk': 'ROBOT_RESET',
          ...(leaseOwner ? { ':leaseOwner': leaseOwner } : {})
        },
        ReturnValues: 'ALL_NEW'
      }));
      return resetCheckpoint(result.Attributes || {
        ...record,
        lifecycleState: 'reset_pending',
        nextResetAttemptAt: nextAttemptAt
      });
    } catch (updateError) {
      if (updateError?.name !== 'ConditionalCheckFailedException') throw updateError;
      return resetCheckpoint(await findBoundRobot(userId, robotId));
    }
  }

  async function completeFactoryReset(
    userId,
    robotId,
    resetId,
    bindingEpoch,
    completedAt = Date.now()
  ) {
    validateResetId(resetId);
    validateTimestamp(completedAt);
    if (!validBindingEpoch(bindingEpoch)) throw Object.assign(new Error('Binding epoch is invalid'), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    const record = await findBoundRobot(userId, robotId);
    if (!record) {
      const receipt = await readResetReceipt(userId, robotId);
      if (receipt?.resetId === resetId && receipt.bindingEpoch === bindingEpoch) {
        return { robotId, resetId, bindingEpoch, lifecycleState: 'unbound', completed: true, resetCompletedAt: receipt.resetCompletedAt };
      }
      return null;
    }
    const checkpoint = resetCheckpoint(record);
    if (
      !checkpoint
      || checkpoint.resetId !== resetId
      || checkpoint.bindingEpoch !== bindingEpoch
      || checkpoint.lifecycleState !== 'reset_remote_complete'
    ) {
      throw Object.assign(new Error('Robot reset is not ready to complete'), { statusCode: 409, code: 'ROBOT_RESET_NOT_READY' });
    }
    const serialHash = record.serialHash || record.SK?.slice(6);
    const transactions = [
      { Delete: {
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: record.SK },
        ConditionExpression: 'id = :robotId AND resetId = :resetId AND bindingEpoch = :epoch AND lifecycleState = :remoteComplete',
        ExpressionAttributeValues: {
          ':robotId': robotId,
          ':resetId': resetId,
          ':epoch': bindingEpoch,
          ':remoteComplete': 'reset_remote_complete'
        }
      } },
      { Put: {
        TableName: tableName,
        Item: {
          PK: `ROBOT#${serialHash}`,
          SK: 'OWNER',
          lifecycleState: 'unbound',
          bindingEpoch,
          bindingEpochHighWater: bindingEpoch,
          resetCompletedAt: completedAt
        },
        ConditionExpression: 'bound_to = :userId AND resetId = :resetId AND bindingEpoch = :epoch AND lifecycleState = :remoteComplete',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':resetId': resetId,
          ':epoch': bindingEpoch,
          ':remoteComplete': 'reset_remote_complete'
        }
      } },
      { Put: {
        TableName: tableName,
        Item: {
          PK: `USER#${userId}`,
          SK: `ROBOT_RESET#${robotId}`,
          entity: 'robot-reset-receipt',
          resetId,
          bindingEpoch,
          pairingTokenHash: record.pairingTokenHash,
          resetRemoteCompletedAt: record.resetRemoteCompletedAt,
          resetCompletedAt: completedAt,
          expiresAt: Math.floor(completedAt / 1000) + 86400 * 30
        },
        ConditionExpression: 'attribute_not_exists(PK) OR (resetId = :resetId AND bindingEpoch = :epoch)',
        ExpressionAttributeValues: { ':resetId': resetId, ':epoch': bindingEpoch }
      } }
    ];
    if (typeof record.pairingClaimHash === 'string' && /^[A-Za-z0-9_-]{43}$/.test(record.pairingClaimHash)) {
      transactions.push({ Update: {
        TableName: tableName,
        Key: { PK: `PAIRING#${record.pairingClaimHash}`, SK: 'CLAIM' },
        UpdateExpression: 'SET unbound_at = :completedAt REMOVE bound_to, serial_hash',
        ConditionExpression: 'bound_to = :userId',
        ExpressionAttributeValues: { ':completedAt': completedAt, ':userId': userId }
      } });
    }
    try {
      await client.send(new TransactWriteCommand({ TransactItems: transactions }));
    } catch (error) {
      if (error?.name !== 'TransactionCanceledException') throw error;
      const receipt = await readResetReceipt(userId, robotId);
      if (receipt?.resetId !== resetId || receipt.bindingEpoch !== bindingEpoch) throw error;
    }
    return { robotId, resetId, bindingEpoch, lifecycleState: 'unbound', completed: true, resetCompletedAt: completedAt };
  }

  async function listRecoverableFactoryResets({ now = Date.now(), limit = 25 } = {}) {
    validateTimestamp(now);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw Object.assign(new Error('Reset recovery limit is invalid'), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    }
    const projection = 'PK, id, manufacturerDeviceId, adapterId, bindingEpoch, lifecycleState, resetId, resetRequestedAt, resetRemoteCompletedAt, resetAttempt, resetLeaseOwner, resetLeaseExpiresAt, nextResetAttemptAt, resetRecoveryAt, SK';
    const items = [];
    if (resetRecoveryIndexName) {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        IndexName: resetRecoveryIndexName,
        KeyConditionExpression: 'resetRecoveryPk = :pk AND resetRecoveryAt <= :now',
        ExpressionAttributeValues: { ':pk': 'ROBOT_RESET', ':now': now },
        ProjectionExpression: projection,
        Limit: limit,
        ConsistentRead: false,
        ScanIndexForward: true
      }));
      items.push(...(result.Items || []));
    } else {
      let exclusiveStartKey;
      // A recovery GSI is the production path. The bounded scan exists only
      // for migrations and small test deployments, and never loops forever.
      for (let page = 0; page < 8 && items.length < limit; page += 1) {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          FilterExpression: 'entity = :entity AND resetRecoveryAt <= :now AND (lifecycleState = :pending OR lifecycleState = :inProgress OR lifecycleState = :remoteComplete)',
          ExpressionAttributeValues: {
            ':entity': 'home-robot',
            ':now': now,
            ':pending': 'reset_pending',
            ':inProgress': 'reset_in_progress',
            ':remoteComplete': 'reset_remote_complete'
          },
          ProjectionExpression: projection,
          Limit: limit,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        items.push(...(result.Items || []));
        exclusiveStartKey = result.LastEvaluatedKey;
        if (!exclusiveStartKey) break;
      }
    }
    return items.slice(0, limit).flatMap((item) => {
      const userId = typeof item.PK === 'string' && item.PK.startsWith('USER#') ? item.PK.slice(5) : null;
      const checkpoint = resetCheckpoint(item);
      return userId && checkpoint ? [{ userId, ...checkpoint }] : [];
    });
  }

  async function isRobotBindingActive(userId, robotId, expectedBinding) {
    const record = await findBoundRobot(userId, robotId);
    if (!record) return false;
    if (effectiveLifecycleState(record) !== 'active' || !validBindingEpoch(record.bindingEpoch)) return false;
    if (!expectedBinding) return true;
    return (
      expectedBinding.bindingEpoch === record.bindingEpoch
      && expectedBinding.manufacturerDeviceId === record.manufacturerDeviceId
      && (expectedBinding.adapterId || 'manufacturer-default') === (record.adapterId || 'manufacturer-default')
    );
  }
  return {
    async owns(userId, robotId) {
      return Boolean(await findBoundRobot(userId, robotId));
    },
    async resolveManufacturerDeviceId(userId, robotId) {
      const record = await findBoundRobot(userId, robotId);
      return effectiveLifecycleState(record) === 'active'
        && validBindingEpoch(record?.bindingEpoch)
        && typeof record?.manufacturerDeviceId === 'string'
        ? record.manufacturerDeviceId
        : null;
    },
    async resolveRobotBinding(userId, robotId) {
      const record = await findBoundRobot(userId, robotId);
      if (effectiveLifecycleState(record) !== 'active') return null;
      return publicBinding(record);
    },
    async verifyPairingToken(userId, robotId, token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const record = await findBoundRobot(userId, robotId);
      return timingSafeTokenMatches(token, record?.pairingTokenHash);
    },
    list,
    async listManufacturerDeviceIds(userId) {
      const robots = await queryBoundRobots(userId, 'manufacturerDeviceId');
      return [...new Set(robots.map((item) => item.manufacturerDeviceId)
        .filter((id) => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id)))];
    },
    async listManufacturerRobotBindings(userId) {
      const robots = await queryBoundRobots(userId, 'manufacturerDeviceId, adapterId');
      const bindings = new Map();
      for (const item of robots) {
        const manufacturerDeviceId = item.manufacturerDeviceId;
        const adapterId = typeof item.adapterId === 'string' ? item.adapterId : 'manufacturer-default';
        if (!/^[A-Za-z0-9._:-]{1,128}$/.test(manufacturerDeviceId || '')
          || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)) continue;
        bindings.set(JSON.stringify([adapterId, manufacturerDeviceId]), { adapterId, manufacturerDeviceId });
      }
      return [...bindings.values()];
    },
    async exportUserData(userId) {
      return list(userId);
    },
    unbind,
    beginFactoryReset,
    claimFactoryReset,
    markFactoryResetRemoteComplete,
    recordFactoryResetFailure,
    completeFactoryReset,
    listRecoverableFactoryResets,
    isRobotBindingActive,
    async deleteUserData(userId) {
      const robots = await queryBoundRobots(userId, 'id');
      let deleted = 0;
      for (const robot of robots) {
        if (typeof robot.id !== 'string') continue;
        if (await unbind(userId, robot.id)) deleted += 1;
      }
      deleted += await deleteResetReceipts(userId);
      return { deletedItems: deleted };
    },
    resumeBinding,
    async consumeAndBind(userId, pairingCodeHash, robot, usedAt) {
      await assertAccountCanPair(userId);
      const pairingKey = { PK: `PAIRING#${pairingCodeHash}`, SK: 'CLAIM' };
      const { legacySerialHash, ...storedRobot } = robot;
      const ownerKey = { PK: `ROBOT#${robot.serialHash}`, SK: 'OWNER' };
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const ownerResult = await client.send(new GetCommand({ TableName: tableName, Key: ownerKey, ConsistentRead: true }));
        const owner = ownerResult.Item;
        if (typeof owner?.bound_to === 'string' && owner.bound_to) {
          const replay = new Error('Robot is already paired');
          replay.statusCode = 410;
          replay.code = 'ROBOT_PAIRING_REPLAY';
          throw replay;
        }
        if (owner && owner.lifecycleState !== 'unbound') {
          throw Object.assign(new Error('Robot ownership state requires migration'), {
            statusCode: 409,
            code: 'ROBOT_BINDING_MIGRATION_REQUIRED'
          });
        }
        if (owner && !validBindingEpoch(owner.bindingEpochHighWater)) {
          throw Object.assign(new Error('Robot ownership epoch requires migration'), {
            statusCode: 409,
            code: 'ROBOT_BINDING_MIGRATION_REQUIRED'
          });
        }
        const highWater = validBindingEpoch(owner?.bindingEpochHighWater)
          ? owner.bindingEpochHighWater
          : validBindingEpoch(owner?.bindingEpoch) ? owner.bindingEpoch : 0;
        if (highWater >= Number.MAX_SAFE_INTEGER) {
          throw Object.assign(new Error('Robot binding epoch is exhausted'), {
            statusCode: 503,
            code: 'ROBOT_BINDING_EPOCH_EXHAUSTED'
          });
        }
        const bindingEpoch = highWater + 1;
        const persistedRobot = { ...storedRobot, bindingEpoch, lifecycleState: 'active' };
        const transactItems = [
          { Update: {
            TableName: tableName,
            Key: pairingKey,
            UpdateExpression: 'SET used_at = :usedAt, bound_to = :userId, serial_hash = :serialHash, robot_id = :robotId, binding_epoch = :bindingEpoch',
            ConditionExpression: 'attribute_not_exists(used_at)',
            ExpressionAttributeValues: {
              ':usedAt': usedAt,
              ':userId': userId,
              ':serialHash': robot.serialHash,
              ':robotId': robot.id,
              ':bindingEpoch': bindingEpoch
            }
          } }
        ];
        const accountCondition = accountPairingCondition(userId);
        if (accountCondition) transactItems.unshift(accountCondition);
        // Before vendor namespaces existed, ownership used SHA256(serial) as a
        // global key. A live legacy owner still fences the namespaced record;
        // an unbound tombstone is safe to pass because it retains no owner.
        if (typeof legacySerialHash === 'string'
          && /^[A-Za-z0-9_-]{43}$/.test(legacySerialHash)
          && legacySerialHash !== robot.serialHash) {
          transactItems.push({ ConditionCheck: {
            TableName: tableName,
            Key: { PK: `ROBOT#${legacySerialHash}`, SK: 'OWNER' },
            ConditionExpression: 'attribute_not_exists(bound_to)'
          } });
        }
        const ownerConditionValues = owner
          ? { ':expectedHighWater': highWater }
          : undefined;
        transactItems.push(
          { Put: {
            TableName: tableName,
            Item: {
              PK: ownerKey.PK,
              SK: ownerKey.SK,
              entity: 'robot-owner',
              bound_to: userId,
              adapterId: robot.adapterId,
              vendorNamespace: robot.vendorNamespace,
              pairedAt: usedAt,
              bindingEpoch,
              bindingEpochHighWater: bindingEpoch,
              lifecycleState: 'active'
            },
            ConditionExpression: owner
              ? 'attribute_not_exists(bound_to) AND (bindingEpochHighWater = :expectedHighWater OR (attribute_not_exists(bindingEpochHighWater) AND :expectedHighWater = :zero))'
              : 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
            ...(ownerConditionValues ? {
              ExpressionAttributeValues: { ...ownerConditionValues, ':zero': 0 }
            } : {})
          } },
          { Put: {
            TableName: tableName,
            Item: { PK: `USER#${userId}`, SK: `ROBOT#${robot.serialHash}`, entity: 'home-robot', ...persistedRobot },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          } }
        );
        try {
          await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
          Object.assign(robot, { bindingEpoch, lifecycleState: 'active' });
          return { ...robot, bindingEpoch, lifecycleState: 'active' };
        } catch (error) {
          if (error?.name !== 'TransactionCanceledException') throw error;
          // The account state participates in the same DynamoDB transaction as
          // the ownership writes. A slow manufacturer verifier therefore cannot
          // bind a robot after account deletion wins the race.
          await assertAccountCanPair(userId);
          const resumed = await resumeBinding(userId, pairingCodeHash, robot.pairingTokenHash);
          if (resumed) return resumed;
          // An ownership tombstone may have advanced between our read and the
          // transaction. Re-read and retry a bounded number of times.
          if (attempt < 3) continue;
          const replay = new Error('Robot pairing is busy or already paired');
          replay.statusCode = 409;
          replay.code = 'ROBOT_PAIRING_CONFLICT';
          throw replay;
        }
      }
      throw Object.assign(new Error('Robot pairing is busy'), { statusCode: 503, code: 'ROBOT_PAIRING_BUSY' });
    }
  };
}

function derivePairingToken({ userId, pairingCodeHash, pairingScope, secret }) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw Object.assign(new Error('Robot pairing token service is unavailable'), {
      statusCode: 503,
      code: 'ROBOT_PAIRING_TOKEN_UNAVAILABLE'
    });
  }
  return crypto.createHmac('sha256', secret)
    .update(JSON.stringify(['veryloving-robot-pairing-v1', userId, pairingScope, pairingCodeHash]))
    .digest('base64url');
}

function robotLogReference(robotId) {
  return `robot_${crypto.createHash('sha256').update(String(robotId || '')).digest('hex').slice(0, 12)}`;
}

async function pairRobot({
  userId,
  qrCode,
  pairingScope = 'manufacturer-default',
  pairingTokenSecret,
  verifier,
  repository,
  logger = console,
  now = Date.now
}) {
  if (typeof qrCode !== 'string' || qrCode.length < 20 || qrCode.length > 2048) throw Object.assign(new Error('Pairing code is invalid'), { statusCode: 400 });
  if (typeof verifier !== 'function') throw Object.assign(new Error('Manufacturer pairing verification is unavailable'), { statusCode: 503 });
  if (typeof repository?.resumeBinding !== 'function' || typeof repository?.consumeAndBind !== 'function') {
    throw Object.assign(new Error('Robot pairing repository is unavailable'), { statusCode: 503 });
  }
  if (typeof pairingScope !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(pairingScope)) {
    throw Object.assign(new Error('Pairing scope is invalid'), { statusCode: 400 });
  }
  const pairingCodeHash = crypto.createHash('sha256')
    .update(JSON.stringify(['veryloving-robot-claim-v1', pairingScope, qrCode]))
    .digest('base64url');
  const pairingToken = derivePairingToken({
    userId,
    pairingCodeHash,
    pairingScope,
    secret: pairingTokenSecret
  });
  const pairingTokenHash = crypto.createHash('sha256').update(pairingToken).digest('base64url');
  try {
    const resumed = await repository.resumeBinding(userId, pairingCodeHash, pairingTokenHash);
    if (resumed) {
      logger.info('[RobotPairing] Same-account pairing retry resumed', {
        claimFingerprint: pairingCodeHash.slice(0, 12),
        robotReference: robotLogReference(resumed.id),
        adapterId: resumed.adapterId || 'manufacturer-default'
      });
      return { robot_id: resumed.id, pairing_token: pairingToken, device_type: 'home_robot' };
    }
  } catch (error) {
    if (error?.statusCode === 410) logger.warn('[RobotPairing] Pairing replay rejected', {
      claimFingerprint: pairingCodeHash.slice(0, 12),
      code: error.code || 'ROBOT_PAIRING_REPLAY'
    });
    throw error;
  }
  let verified;
  try {
    verified = await verifier(qrCode);
  } catch (error) {
    if (error?.statusCode === 410) {
      logger.warn('[RobotPairing] Pairing replay rejected', {
        claimFingerprint: pairingCodeHash.slice(0, 12),
        code: error.code || 'ROBOT_PAIRING_REPLAY'
      });
    }
    throw error;
  }
  if (
    typeof verified?.hardwareSerial !== 'string'
    || verified.hardwareSerial.length < 4
    || verified.hardwareSerial.length > 256
    || verified.oneTime !== true
    || typeof verified.manufacturerDeviceId !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(verified.manufacturerDeviceId)
  ) throw Object.assign(new Error('Pairing code was rejected'), { statusCode: 403 });
  const adapterId = verified.adapterId === undefined ? 'manufacturer-default' : verified.adapterId;
  if (typeof adapterId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)) {
    throw Object.assign(new Error('Pairing code adapter is invalid'), { statusCode: 403 });
  }
  const usedAt = now();
  if (!Number.isFinite(verified.expiresAt)) {
    throw Object.assign(new Error('Pairing code expiry is invalid'), { statusCode: 403, code: 'ROBOT_PAIRING_INVALID' });
  }
  if (verified.expiresAt <= usedAt) {
    throw Object.assign(new Error('Pairing code has expired'), { statusCode: 410, code: 'ROBOT_PAIRING_EXPIRED' });
  }
  const legacySerialHash = crypto.createHash('sha256').update(verified.hardwareSerial).digest('base64url');
  const serialHash = crypto.createHash('sha256').update(JSON.stringify([
    'veryloving-robot-serial-v2', pairingScope, verified.hardwareSerial
  ])).digest('base64url');
  const record = {
    id: crypto.randomUUID(),
    adapterId,
    manufacturerDeviceId: verified.manufacturerDeviceId,
    vendorNamespace: pairingScope,
    serialHash,
    legacySerialHash,
    pairingTokenHash,
    pairingClaimHash: pairingCodeHash,
    pairedAt: usedAt
  };
  try {
    const stored = await repository.consumeAndBind(userId, pairingCodeHash, record, usedAt);
    if (stored?.id) record.id = stored.id;
    if (Number.isSafeInteger(stored?.bindingEpoch)) record.bindingEpoch = stored.bindingEpoch;
  } catch (error) {
    if (error?.statusCode === 410) logger.warn('[RobotPairing] Pairing replay rejected', {
      hardwareSerial: redactSerial(verified.hardwareSerial), code: error.code || 'ROBOT_PAIRING_REPLAY'
    });
    throw error;
  }
  logger.info('[RobotPairing] Robot bound', {
    hardwareSerial: redactSerial(verified.hardwareSerial),
    robotReference: robotLogReference(record.id),
    adapterId
  });
  return { robot_id: record.id, pairing_token: pairingToken, device_type: 'home_robot' };
}

module.exports = { createDynamoRobotRepository, derivePairingToken, pairRobot };
