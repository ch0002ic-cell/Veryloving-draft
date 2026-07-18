'use strict';

const crypto = require('node:crypto');

function refreshHash(jti) {
  return crypto.createHash('sha256').update(String(jti)).digest('base64url');
}

function createDynamoAuthSessionRepository({ tableName, region, client: injectedClient } = {}) {
  if (!tableName) throw new Error('Auth session table is required');
  let client = injectedClient;
  let commands;
  if (!client) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
    commands = { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand };
  } else {
    const { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    commands = { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand };
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
    return result.Item?.deletion_state || 'active';
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

  return {
    async create({ subject, sessionId, refreshJti, expiresAt }) {
      // The durable account marker prevents a new login/session from being
      // created after deletion begins. HTTP handlers also check this state;
      // this repository check closes service-to-service call paths.
      await assertAccountActive(subject);
      await client.send(new commands.PutCommand({
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
      }));
      return true;
    },
    async rotate({ subject, sessionId, currentJti, nextJti, expiresAt, now = Date.now() }) {
      await assertAccountActive(subject);
      try {
        await client.send(new commands.UpdateCommand({
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
        }));
        return true;
      } catch (error) {
        if (!conditional(error)) throw error;
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
    async beginAccountDeletion(subject, now = Date.now()) {
      try {
        await client.send(new commands.UpdateCommand({
          TableName: tableName,
          Key: accountStateKey(subject),
          UpdateExpression: 'SET deletion_state = :deleting, deletion_started_at = if_not_exists(deletion_started_at, :now)',
          ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :deleting',
          ExpressionAttributeValues: { ':deleting': 'deleting', ':now': now }
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
        const result = await client.send(new commands.QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `USER#${subject}`, ':prefix': 'SESSION#' },
          ProjectionExpression: 'session_id, created_at, rotated_at, revoked_at, expiresAt',
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        sessions.push(...(result.Items || []));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return sessions;
    },
    async deleteUserData(subject) {
      const keys = [];
      let exclusiveStartKey;
      do {
        const result = await client.send(new commands.QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `USER#${subject}`, ':prefix': 'SESSION#' },
          ProjectionExpression: 'PK, SK',
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        keys.push(...(result.Items || []));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      for (let offset = 0; offset < keys.length; offset += 25) {
        let pending = keys.slice(offset, offset + 25).map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } }));
        for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
          const result = await client.send(new commands.BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
          pending = result.UnprocessedItems?.[tableName] || [];
        }
        if (pending.length) throw new Error('Auth sessions could not be fully deleted');
      }
      return { deletedItems: keys.length };
    }
  };
}

module.exports = { createDynamoAuthSessionRepository, refreshHash };
