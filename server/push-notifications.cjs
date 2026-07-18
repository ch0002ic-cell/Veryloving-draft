'use strict';

const crypto = require('node:crypto');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_PATTERN = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]$/;
const MAX_EXPO_BATCH_SIZE = 100;

function validatePushToken(value) {
  if (typeof value !== 'string' || !EXPO_TOKEN_PATTERN.test(value)) {
    throw Object.assign(new Error('Push token is invalid'), { statusCode: 400 });
  }
  return value;
}

function createDynamoPushRepository({ tableName, region }) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { BatchWriteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
  async function queryRegistrations(userId, projectionExpression, expressionAttributeNames) {
    const registrations = [];
    let exclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'PUSH#' },
        ProjectionExpression: projectionExpression,
        ...(expressionAttributeNames ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      registrations.push(...(result.Items || []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return registrations;
  }
  return {
    async register(userId, token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('base64url');
      await client.send(new PutCommand({
        TableName: tableName,
        Item: { PK: `USER#${userId}`, SK: `PUSH#${tokenHash}`, entity: 'push-token', token, updatedAt: Date.now() }
      }));
    },
    async list(userId) {
      const registrations = await queryRegistrations(userId, '#token', { '#token': 'token' });
      return registrations.map((item) => item.token).filter((token) => EXPO_TOKEN_PATTERN.test(token));
    },
    async exportUserData(userId) {
      const registrations = await queryRegistrations(userId, 'SK, updatedAt');
      return registrations.map(({ SK, updatedAt }) => ({
        tokenFingerprint: typeof SK === 'string' ? SK.replace(/^PUSH#/, '') : null,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : null
      }));
    },
    async deleteUserData(userId) {
      const keys = await queryRegistrations(userId, 'PK, SK');
      for (let offset = 0; offset < keys.length; offset += 25) {
        let pending = keys.slice(offset, offset + 25).map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } }));
        for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
          const result = await client.send(new BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
          pending = result.UnprocessedItems?.[tableName] || [];
        }
        if (pending.length) throw new Error('Push registrations could not be fully deleted');
      }
      return { deletedItems: keys.length };
    }
  };
}

function createExpoPushNotifier({ repository, fetchImpl = globalThis.fetch, endpoint = EXPO_PUSH_URL, timeoutMs = 5000 } = {}) {
  return async function notifyUser(userId, notification) {
    const tokens = await repository.list(userId);
    if (!tokens.length) return { sent: 0 };
    let sent = 0;
    const failures = [];
    for (let offset = 0; offset < tokens.length; offset += MAX_EXPO_BATCH_SIZE) {
      const batch = tokens.slice(offset, offset + MAX_EXPO_BATCH_SIZE);
      const controller = new AbortController();
      let timeout;
      const timeoutFailure = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          const error = new Error('Push provider timed out');
          error.name = 'TimeoutError';
          reject(error);
        }, timeoutMs);
      });
      try {
        const providerResult = await Promise.race([
          (async () => {
            const response = await fetchImpl(endpoint, {
              method: 'POST',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(batch.map((to) => ({ sound: 'default', priority: 'high', ...notification, to }))),
              signal: controller.signal
            });
            if (!response.ok) throw new Error(`Push provider returned ${response.status}`);
            if (typeof response.json !== 'function') throw new Error('Push provider returned an invalid response');
            return response.json();
          })(),
          timeoutFailure
        ]);
        const tickets = Array.isArray(providerResult?.data) ? providerResult.data : null;
        if (!tickets || tickets.length !== batch.length) throw new Error('Push provider returned invalid tickets');
        tickets.forEach((ticket, index) => {
          if (ticket?.status === 'ok') sent += 1;
          else failures.push({
            token: batch[index],
            code: typeof ticket?.details?.error === 'string' ? ticket.details.error.slice(0, 64) : 'PUSH_REJECTED'
          });
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    if (failures.length && sent === 0) {
      const error = new Error('Push provider rejected all notifications');
      error.name = 'PushDeliveryError';
      error.failures = failures.map(({ code }) => ({ code }));
      throw error;
    }
    return { sent, failed: failures.length };
  };
}

function createEmergencyContactPushNotifier({
  safetyRepository,
  notifyUser,
  resolvePhoneAccountId
} = {}) {
  if (typeof safetyRepository?.listContacts !== 'function'
    || typeof notifyUser !== 'function'
    || typeof resolvePhoneAccountId !== 'function') {
    throw new Error('Emergency-contact push delivery is not configured');
  }
  return async function notifyEmergencyContacts(userId, contactIds, notification) {
    const requested = new Set(Array.isArray(contactIds) ? contactIds : []);
    const contacts = (await safetyRepository.listContacts(userId))
      .filter((contact) => requested.has(contact.id));
    const resolvedAccounts = await Promise.all(contacts.map(async (contact) => {
      const accountId = await resolvePhoneAccountId(contact.phone);
      if (typeof accountId !== 'string') return null;
      const normalized = accountId.trim();
      return normalized && normalized.length <= 512 && normalized !== userId ? normalized : null;
    }));
    // A person can be present more than once in an imported address book. Fan
    // out per verified account so one SOS never produces duplicate alerts.
    const recipients = [...new Set(resolvedAccounts.filter(Boolean))];
    const results = await Promise.allSettled(recipients.map((recipientId) => notifyUser(recipientId, notification)));
    const delivered = results.filter((result) => (
      result.status === 'fulfilled' && Number(result.value?.sent) > 0
    )).length;
    return {
      eligible: recipients.length,
      delivered,
      failedRecipients: recipients.length - delivered,
      sentNotifications: results.reduce((count, result) => count
        + (result.status === 'fulfilled' ? Math.max(0, Number(result.value?.sent) || 0) : 0), 0)
    };
  };
}

module.exports = {
  EXPO_PUSH_URL,
  MAX_EXPO_BATCH_SIZE,
  createDynamoPushRepository,
  createEmergencyContactPushNotifier,
  createExpoPushNotifier,
  validatePushToken
};
