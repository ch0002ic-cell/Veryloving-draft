'use strict';

const crypto = require('node:crypto');

const MAX_AUTH_SESSION_EXPORT_ITEMS = 10000;

function refreshHash(jti) {
  return crypto.createHash('sha256').update(String(jti)).digest('base64url');
}

function createDynamoAuthSessionRepository({ tableName, region, client: injectedClient } = {}) {
  if (!tableName) throw new Error('Auth session table is required');
  let client = injectedClient;
  let commands;
  if (!client) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
    commands = { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand };
  } else {
    const { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    commands = { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand };
  }
  const key = (subject, sessionId) => ({ PK: `USER#${subject}`, SK: `SESSION#${sessionId}` });
  const accountStateKey = (subject) => ({ PK: `USER#${subject}`, SK: 'ACCOUNT#STATE' });
  const conditional = (error) => error?.name === 'ConditionalCheckFailedException';

  async function getAccountDeletionState(subject) {
    const result = await client.send(new commands.GetCommand({
      TableName: tableName,
      Key: accountStateKey(subject),
      ProjectionExpression: 'deletion_state, deletion_started_at, deletion_completed_at',
      ConsistentRead: true
    }));
    const state = result.Item?.deletion_state || 'active';
    if (!['active', 'deleting', 'deleted'].includes(state)) {
      throw Object.assign(new Error('Account deletion state is invalid'), {
        statusCode: 503,
        code: 'ACCOUNT_STATE_INVALID'
      });
    }
    return state;
  }

  async function assertAccountActive(subject) {
    const state = await getAccountDeletionState(subject);
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

  function validRecoverySessionId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
  }

  async function deleteSessionKeys(keys) {
    for (let offset = 0; offset < keys.length; offset += 25) {
      let pending = keys.slice(offset, offset + 25).map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } }));
      for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
        const result = await client.send(new commands.BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
        pending = result.UnprocessedItems?.[tableName] || [];
      }
      if (pending.length) throw new Error('Auth sessions could not be fully deleted');
    }
  }

  async function pruneSessionsForFinalization(subject, canonicalSessionId) {
    const canonicalSK = validRecoverySessionId(canonicalSessionId)
      ? `SESSION#${canonicalSessionId}`
      : null;
    let canonical = null;
    if (canonicalSK) {
      const result = await client.send(new commands.GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${subject}`, SK: canonicalSK },
        ProjectionExpression: 'PK, SK',
        ConsistentRead: true
      }));
      if (result.Item?.PK === `USER#${subject}` && result.Item?.SK === canonicalSK) canonical = result.Item;
    }
    const retained = canonical ? [canonical] : [];
    let total = 0;
    let exclusiveStartKey;
    do {
      const result = await client.send(new commands.QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${subject}`, ':prefix': 'SESSION#' },
        ProjectionExpression: 'PK, SK',
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      const page = result.Items || [];
      total += page.length;
      const surplus = [];
      for (const candidate of page) {
        if (canonical && candidate.SK === canonicalSK) continue;
        if (retained.length < 99) retained.push(candidate);
        else surplus.push(candidate);
      }
      if (surplus.length && !canonical) {
        throw Object.assign(new Error('Account deletion recovery session is unavailable'), {
          statusCode: 503,
          code: 'ACCOUNT_DELETION_RECOVERY_UNAVAILABLE'
        });
      }
      await deleteSessionKeys(surplus);
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return { keys: retained, total };
  }

  async function deleteAllSessionKeys(subject) {
    let deleted = 0;
    let exclusiveStartKey;
    do {
      const result = await client.send(new commands.QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${subject}`, ':prefix': 'SESSION#' },
        ProjectionExpression: 'PK, SK',
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      const page = result.Items || [];
      await deleteSessionKeys(page);
      deleted += page.length;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return deleted;
  }

  async function revoke({ subject, sessionId, now = Date.now() }) {
    try {
      await client.send(new commands.UpdateCommand({
        TableName: tableName,
        Key: key(subject, sessionId),
        UpdateExpression: 'SET revoked_at = if_not_exists(revoked_at, :now)',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':now': now }
      }));
      return true;
    } catch (error) {
      if (conditional(error)) return false;
      throw error;
    }
  }

  async function getSessionRecord(subject, sessionId) {
    const result = await client.send(new commands.GetCommand({
      TableName: tableName,
      Key: key(subject, sessionId),
      ProjectionExpression: 'refresh_jti_hash, revoked_at, family_expires_at',
      ConsistentRead: true
    }));
    return result.Item || null;
  }

  return {
    async consumePhoneChallenge({ jti, expiresAt, now = Date.now() }) {
      if (typeof jti !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(jti)
        || !Number.isSafeInteger(expiresAt) || expiresAt <= now) {
        throw Object.assign(new Error('Phone verification challenge is invalid or expired'), {
          statusCode: 401,
          code: 'PHONE_AUTH_INVALID'
        });
      }
      const digest = crypto.createHash('sha256').update(jti).digest('base64url');
      try {
        await client.send(new commands.PutCommand({
          TableName: tableName,
          Item: {
            PK: `PHONE_CHALLENGE#${digest}`,
            SK: 'CONSUMED',
            entity: 'phone-auth-challenge-consumption',
            consumed_at: now,
            expiresAt: Math.floor(expiresAt / 1000)
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }));
      } catch (error) {
        if (!conditional(error)) throw error;
        throw Object.assign(new Error('Phone verification challenge has already been used'), {
          statusCode: 410,
          code: 'PHONE_AUTH_CHALLENGE_USED'
        });
      }
      return true;
    },
    async create({ subject, sessionId, refreshJti, expiresAt }) {
      // The durable account marker prevents a new login/session from being
      // created after deletion begins. The account check and session write must
      // share one transaction; a read followed by Put has a race in which the
      // deletion fence can win between those two calls.
      try {
        await client.send(new commands.TransactWriteCommand({ TransactItems: [
          { ConditionCheck: {
            TableName: tableName,
            Key: accountStateKey(subject),
            ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :active',
            ExpressionAttributeValues: { ':active': 'active' }
          } },
          { Put: {
            TableName: tableName,
            Item: {
              ...key(subject, sessionId),
              entity: 'auth-session',
              subject,
              session_id: sessionId,
              refresh_jti_hash: refreshHash(refreshJti),
              created_at: Date.now(),
              family_expires_at: expiresAt,
              expiresAt: Math.floor(expiresAt / 1000)
            },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          } }
        ] }));
      } catch (error) {
        if (error?.name === 'TransactionCanceledException') await assertAccountActive(subject);
        throw error;
      }
      return true;
    },
    async rotate({ subject, sessionId, currentJti, nextJti, expiresAt, now = Date.now() }) {
      try {
        await client.send(new commands.TransactWriteCommand({ TransactItems: [
          { ConditionCheck: {
            TableName: tableName,
            Key: accountStateKey(subject),
            ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :active',
            ExpressionAttributeValues: { ':active': 'active' }
          } },
          { Update: {
            TableName: tableName,
            Key: key(subject, sessionId),
            UpdateExpression: 'SET refresh_jti_hash = :next, rotated_at = :now, expiresAt = :expiresAt',
            ConditionExpression: 'refresh_jti_hash = :current AND attribute_not_exists(revoked_at) AND family_expires_at >= :familyExpiresAt',
            ExpressionAttributeValues: {
              ':current': refreshHash(currentJti),
              ':next': refreshHash(nextJti),
              ':now': now,
              ':expiresAt': Math.floor(expiresAt / 1000),
              ':familyExpiresAt': expiresAt
            }
          } }
        ] }));
        return true;
      } catch (error) {
        if (!conditional(error) && error?.name !== 'TransactionCanceledException') throw error;
        if (error?.name === 'TransactionCanceledException') await assertAccountActive(subject);
        // TransactionCanceledException is also used for transient conflicts and
        // capacity failures. Revoke a token family only after a consistent read
        // proves that the presented refresh token lost its compare-and-swap (or
        // the family is already revoked/expired); a transport conflict must not
        // log out an otherwise valid session.
        const current = await getSessionRecord(subject, sessionId);
        const presentedHash = refreshHash(currentJti);
        const replayed = !current
          || current.refresh_jti_hash !== presentedHash
          || Number.isFinite(current.revoked_at)
          || Number(current.family_expires_at) < expiresAt;
        if (!replayed) throw error;
        // A failed compare-and-swap means this refresh token was already
        // consumed (or the session was revoked). Revoke the complete token
        // family so a stolen sibling token cannot win a later race.
        // Surface a failed family revocation. Returning a normal replay result
        // would falsely imply the winning sibling token had been invalidated.
        await revoke({ subject, sessionId, now });
        return false;
      }
    },
    revoke,
    getAccountDeletionState,
    async beginAccountDeletion(subject, now = Date.now(), recoverySessionId) {
      if (recoverySessionId !== undefined && !validRecoverySessionId(recoverySessionId)) {
        throw Object.assign(new Error('Account deletion recovery session is invalid'), {
          statusCode: 400,
          code: 'ACCOUNT_DELETION_SESSION_INVALID'
        });
      }
      try {
        await client.send(new commands.UpdateCommand({
          TableName: tableName,
          Key: accountStateKey(subject),
          UpdateExpression: `SET deletion_state = :deleting, deletion_started_at = if_not_exists(deletion_started_at, :now)${recoverySessionId ? ', deletion_recovery_session_id = if_not_exists(deletion_recovery_session_id, :recoverySessionId)' : ''}`,
          ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :deleting',
          ExpressionAttributeValues: {
            ':deleting': 'deleting',
            ':now': now,
            ...(recoverySessionId ? { ':recoverySessionId': recoverySessionId } : {})
          }
        }));
        return true;
      } catch (error) {
        if (!conditional(error)) throw error;
        throw Object.assign(new Error('Account has already been deleted'), {
          statusCode: 410,
          code: 'ACCOUNT_DELETED'
        });
      }
    },
    async completeAccountDeletion(subject, now = Date.now()) {
      await client.send(new commands.UpdateCommand({
        TableName: tableName,
        Key: accountStateKey(subject),
        UpdateExpression: 'SET deletion_state = :deleted, deletion_completed_at = :now',
        ConditionExpression: 'deletion_state = :deleting',
        ExpressionAttributeValues: { ':deleting': 'deleting', ':deleted': 'deleted', ':now': now }
      }));
      return true;
    },
    async finalizeAccountDeletion(subject, { recoverySessionId, now = Date.now() } = {}) {
      if (recoverySessionId !== undefined && !validRecoverySessionId(recoverySessionId)) {
        throw Object.assign(new Error('Account deletion recovery session is invalid'), {
          statusCode: 400,
          code: 'ACCOUNT_DELETION_SESSION_INVALID'
        });
      }
      const marker = await client.send(new commands.GetCommand({
        TableName: tableName,
        Key: accountStateKey(subject),
        ProjectionExpression: 'deletion_state, deletion_recovery_session_id',
        ConsistentRead: true
      }));
      if (marker.Item?.deletion_state === 'deleted') {
        return { deletedItems: 0, completed: true };
      }
      if (marker.Item?.deletion_state !== 'deleting') {
        throw Object.assign(new Error('Account deletion has not started'), {
          statusCode: 409,
          code: 'ACCOUNT_DELETION_NOT_STARTED'
        });
      }

      const { keys: finalKeys, total: sessionCount } = await pruneSessionsForFinalization(
        subject,
        marker.Item.deletion_recovery_session_id || recoverySessionId
      );

      const transactItems = finalKeys.map(({ PK, SK }) => ({ Delete: {
        TableName: tableName,
        Key: { PK, SK }
      } }));
      transactItems.push({ Update: {
        TableName: tableName,
        Key: accountStateKey(subject),
        UpdateExpression: 'SET deletion_state = :deleted, deletion_completed_at = :now REMOVE deletion_recovery_session_id',
        ConditionExpression: 'deletion_state = :deleting',
        ExpressionAttributeValues: { ':deleting': 'deleting', ':deleted': 'deleted', ':now': now }
      } });
      try {
        await client.send(new commands.TransactWriteCommand({ TransactItems: transactItems }));
      } catch (error) {
        if (!conditional(error) && error?.name !== 'TransactionCanceledException') throw error;
        if (await getAccountDeletionState(subject) !== 'deleted') throw error;
      }
      return { deletedItems: sessionCount, completed: true };
    },
    async isActive(subject, sessionId) {
      const result = await client.send(new commands.GetCommand({
        TableName: tableName,
        Key: key(subject, sessionId),
        ProjectionExpression: 'subject, session_id, revoked_at, expiresAt',
        ConsistentRead: true
      }));
      return result.Item?.subject === subject
        && result.Item?.session_id === sessionId
        && !Number.isFinite(result.Item?.revoked_at)
        && Number(result.Item?.expiresAt) > Math.floor(Date.now() / 1000);
    },
    async exportUserData(subject) {
      const sessions = [];
      let exclusiveStartKey;
      do {
        const remaining = MAX_AUTH_SESSION_EXPORT_ITEMS + 1 - sessions.length;
        if (remaining <= 0) break;
        const result = await client.send(new commands.QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `USER#${subject}`, ':prefix': 'SESSION#' },
          ProjectionExpression: 'session_id, created_at, rotated_at, revoked_at, expiresAt',
          Limit: Math.min(100, remaining),
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        sessions.push(...(result.Items || []));
        if (sessions.length > MAX_AUTH_SESSION_EXPORT_ITEMS) {
          throw Object.assign(new Error('Auth session export exceeds the supported account limit'), {
            statusCode: 413,
            code: 'AUTH_SESSION_EXPORT_LIMIT_EXCEEDED'
          });
        }
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return sessions;
    },
    async deleteUserData(subject) {
      return { deletedItems: await deleteAllSessionKeys(subject) };
    }
  };
}

module.exports = { createDynamoAuthSessionRepository, refreshHash };
