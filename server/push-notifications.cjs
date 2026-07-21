'use strict';

const crypto = require('node:crypto');
const { cancelResponseBody, readBoundedJSONResponse } = require('./bounded-response.cjs');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN_PATTERN = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]$/;
const MAX_EXPO_BATCH_SIZE = 100;
const MAX_EXPO_TOKENS_PER_ACCOUNT = 1000;
const MAX_NOTIFICATION_BYTES = 4096;
const MAX_EXPO_RESPONSE_BYTES = 256 * 1024;
const PUSH_UNREGISTER_RECEIPT_PATTERN = /^[A-Za-z0-9_-]{80,1024}$/;
const PUSH_RECEIPT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUSH_TOKEN_FINGERPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/;
const DEVELOPMENT_PUSH_RECEIPT_SECRET = crypto.randomBytes(32);

function validatePushToken(value) {
  if (typeof value !== 'string' || !EXPO_TOKEN_PATTERN.test(value)) {
    throw Object.assign(new Error('Push token is invalid'), { statusCode: 400 });
  }
  return value;
}

function encodeUnregisterReceipt(userId, tokenFingerprint, secret) {
  return Buffer.from(JSON.stringify({ v: 1, u: userId, t: tokenFingerprint, s: secret })).toString('base64url');
}

function parseUnregisterReceipt(value) {
  if (typeof value !== 'string' || !PUSH_UNREGISTER_RECEIPT_PATTERN.test(value)) {
    throw Object.assign(new Error('Push unregistration receipt is invalid'), { statusCode: 400 });
  }
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch {
    throw Object.assign(new Error('Push unregistration receipt is invalid'), { statusCode: 400 });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).sort().join(',') !== 's,t,u,v'
    || parsed.v !== 1
    || !ACCOUNT_ID_PATTERN.test(parsed.u || '')
    || !PUSH_TOKEN_FINGERPRINT_PATTERN.test(parsed.t || '')
    || !PUSH_RECEIPT_SECRET_PATTERN.test(parsed.s || '')) {
    throw Object.assign(new Error('Push unregistration receipt is invalid'), { statusCode: 400 });
  }
  return { userId: parsed.u, tokenFingerprint: parsed.t, secret: parsed.s };
}

function createDynamoPushRepository({
  tableName,
  region,
  client: injectedClient,
  accountStateTableName,
  unregisterReceiptSecret
} = {}) {
  if (!tableName) throw new Error('Push registration table is required');
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    BatchGetCommand,
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    TransactWriteCommand
  } = require('@aws-sdk/lib-dynamodb');
  const client = injectedClient || DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
  const configuredReceiptSecret = typeof unregisterReceiptSecret === 'string'
    ? Buffer.from(unregisterReceiptSecret)
    : DEVELOPMENT_PUSH_RECEIPT_SECRET;
  if (configuredReceiptSecret.length < 32) throw new Error('Push unregistration receipt signing is not configured');
  const counterKey = (userId) => ({ PK: `USER#${userId}`, SK: 'META#PUSH_REGISTRATION_COUNT' });
  const registrationKey = (userId, tokenFingerprint) => ({
    PK: `USER#${userId}`,
    SK: `PUSH#${tokenFingerprint}`
  });
  const tokenOwnerKey = (tokenFingerprint) => ({
    PK: `PUSH_TOKEN#${tokenFingerprint}`,
    SK: 'OWNER'
  });
  const conditional = (error) => error?.name === 'ConditionalCheckFailedException';
  const transactionCanceled = (error) => error?.name === 'TransactionCanceledException';

  function accountActiveCondition(userId) {
    return {
      ConditionCheck: {
        TableName: accountStateTableName,
        Key: { PK: `USER#${userId}`, SK: 'ACCOUNT#STATE' },
        ConditionExpression: 'attribute_not_exists(deletion_state) OR deletion_state = :active',
        ExpressionAttributeValues: { ':active': 'active' }
      }
    };
  }

  async function assertAccountActive(userId) {
    if (!accountStateTableName) return;
    const result = await client.send(new GetCommand({
      TableName: accountStateTableName,
      Key: { PK: `USER#${userId}`, SK: 'ACCOUNT#STATE' },
      ProjectionExpression: 'deletion_state',
      ConsistentRead: true
    }));
    const state = result.Item?.deletion_state || 'active';
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
    if (state !== 'active') {
      throw Object.assign(new Error('Account deletion state is invalid'), {
        statusCode: 503,
        code: 'ACCOUNT_STATE_INVALID'
      });
    }
  }

  async function sendAccountGuardedTransaction(userId, mutationItems) {
    try {
      return await client.send(new TransactWriteCommand({
        TransactItems: accountStateTableName
          ? [accountActiveCondition(userId), ...mutationItems]
          : mutationItems
      }));
    } catch (error) {
      if (accountStateTableName && transactionCanceled(error)) await assertAccountActive(userId);
      throw error;
    }
  }

  async function sendAccountGuardedMutation(userId, legacyCommand, transactionItem) {
    if (!accountStateTableName) return client.send(legacyCommand);
    return sendAccountGuardedTransaction(userId, [transactionItem]);
  }

  function transactionMutationConditionFailed(error, mutationIndexes) {
    if (!transactionCanceled(error)) return false;
    if (!accountStateTableName) return true;
    const reasons = error.CancellationReasons || error.cancellationReasons;
    return mutationIndexes.some((index) => reasons?.[index + 1]?.Code === 'ConditionalCheckFailed');
  }

  async function queryRegistrations(userId, projectionExpression, expressionAttributeNames, maxItems) {
    const registrations = [];
    let exclusiveStartKey;
    do {
      const remaining = Number.isSafeInteger(maxItems) ? maxItems + 1 - registrations.length : undefined;
      if (remaining !== undefined && remaining <= 0) break;
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'PUSH#' },
        ProjectionExpression: projectionExpression,
        ...(expressionAttributeNames ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
        ConsistentRead: true,
        ...(remaining === undefined ? {} : { Limit: remaining }),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      registrations.push(...(result.Items || []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return registrations;
  }

  async function getTokenOwner(tokenFingerprint) {
    const result = await client.send(new GetCommand({
      TableName: tableName,
      Key: tokenOwnerKey(tokenFingerprint),
      ProjectionExpression: 'owner_user_id',
      ConsistentRead: true
    }));
    const owner = result.Item?.owner_user_id;
    return typeof owner === 'string' && ACCOUNT_ID_PATTERN.test(owner) ? owner : null;
  }

  function tokenOwnerPut(userId, tokenFingerprint, updatedAt = Date.now()) {
    return { Put: {
      TableName: tableName,
      Item: {
        ...tokenOwnerKey(tokenFingerprint),
        entity: 'push-token-owner',
        owner_user_id: userId,
        updatedAt
      },
      ConditionExpression: 'attribute_not_exists(PK) OR owner_user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    } };
  }

  function tokenOwnerDelete(userId, tokenFingerprint) {
    return { Delete: {
      TableName: tableName,
      Key: tokenOwnerKey(tokenFingerprint),
      ConditionExpression: 'owner_user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId }
    } };
  }

  async function tokenOwners(tokenFingerprints) {
    const unique = [...new Set(tokenFingerprints.filter((fingerprint) => (
      PUSH_TOKEN_FINGERPRINT_PATTERN.test(fingerprint || '')
    )))];
    const owners = new Map();
    for (let offset = 0; offset < unique.length; offset += 100) {
      let pending = unique.slice(offset, offset + 100).map(tokenOwnerKey);
      for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
        const result = await client.send(new BatchGetCommand({
          RequestItems: {
            [tableName]: { Keys: pending, ConsistentRead: true }
          }
        }));
        for (const item of result.Responses?.[tableName] || []) {
          const fingerprint = typeof item.PK === 'string'
            ? item.PK.replace(/^PUSH_TOKEN#/, '')
            : '';
          if (PUSH_TOKEN_FINGERPRINT_PATTERN.test(fingerprint)
            && typeof item.owner_user_id === 'string'
            && ACCOUNT_ID_PATTERN.test(item.owner_user_id)) {
            owners.set(fingerprint, item.owner_user_id);
          }
        }
        pending = result.UnprocessedKeys?.[tableName]?.Keys || [];
      }
      if (pending.length) throw new Error('Push token ownership could not be verified');
    }
    return owners;
  }

  async function registrationCount(userId) {
    const result = await client.send(new GetCommand({
      TableName: tableName,
      Key: counterKey(userId),
      ProjectionExpression: 'registration_count',
      ConsistentRead: true
    }));
    const count = result.Item?.registration_count;
    if (count === undefined) return null;
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_EXPO_TOKENS_PER_ACCOUNT) {
      throw new Error('Push registration counter is invalid');
    }
    return count;
  }

  async function ensureRegistrationCounter(userId) {
    const existing = await registrationCount(userId);
    if (existing !== null) return existing;
    const registrations = await queryRegistrations(userId, 'PK, SK', undefined, MAX_EXPO_TOKENS_PER_ACCOUNT);
    if (registrations.length > MAX_EXPO_TOKENS_PER_ACCOUNT) throw new Error('Push registration limit exceeded');
    const putInput = {
      TableName: tableName,
      Item: {
        ...counterKey(userId),
        entity: 'push-registration-count',
        registration_count: registrations.length,
        updatedAt: Date.now()
      },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
    };
    try {
      await sendAccountGuardedMutation(userId, new PutCommand(putInput), { Put: putInput });
      return registrations.length;
    } catch (error) {
      const racedCounter = conditional(error)
        || transactionMutationConditionFailed(error, [0]);
      if (!racedCounter) throw error;
      const raced = await registrationCount(userId);
      if (raced === null) throw new Error('Push registration counter is unavailable');
      return raced;
    }
  }

  async function deleteAllRegistrations(userId) {
    let deletedItems = 0;
    let exclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'PUSH#' },
        ProjectionExpression: 'PK, SK',
        ConsistentRead: true,
        Limit: 100,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      const keys = result.Items || [];
      for (let offset = 0; offset < keys.length; offset += 25) {
        const batch = keys.slice(offset, offset + 25);
        let deleted = false;
        for (let attempt = 0; !deleted && attempt < 5; attempt += 1) {
          const fingerprints = batch.map(({ SK }) => (
            typeof SK === 'string' ? SK.replace(/^PUSH#/, '') : ''
          ));
          if (fingerprints.some((fingerprint) => !PUSH_TOKEN_FINGERPRINT_PATTERN.test(fingerprint))) {
            throw new Error('Push registration key is invalid');
          }
          const owners = await tokenOwners(fingerprints);
          try {
            await client.send(new TransactWriteCommand({
              TransactItems: batch.flatMap(({ PK, SK }, index) => {
                const fingerprint = fingerprints[index];
                return [
                  { Delete: { TableName: tableName, Key: { PK, SK } } },
                  ...(owners.get(fingerprint) === userId
                    ? [tokenOwnerDelete(userId, fingerprint)]
                    : [])
                ];
              })
            }));
            deleted = true;
          } catch (error) {
            if (!transactionCanceled(error)) throw error;
          }
        }
        if (!deleted) throw new Error('Push registrations could not be fully deleted');
      }
      deletedItems += keys.length;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return deletedItems;
  }
  return {
    async register(userId, token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('base64url');
      const tokenKey = registrationKey(userId, tokenHash);
      // Derive a stable account/token-scoped capability. Re-registering after
      // a lost HTTP response returns the same receipt instead of rotating away
      // the only durable capability held by the device.
      const unregisterSecret = crypto
        .createHmac('sha256', configuredReceiptSecret)
        .update(`veryloving-push-unregister:v1:${userId}:${tokenHash}`)
        .digest('base64url');
      const unregisterSecretHash = crypto.createHash('sha256').update(unregisterSecret).digest('base64url');
      const receipt = encodeUnregisterReceipt(userId, tokenHash, unregisterSecret);
      await ensureRegistrationCounter(userId);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const updatedAt = Date.now();
        const counterUpdate = { Update: {
          TableName: tableName,
          Key: counterKey(userId),
          UpdateExpression: 'SET registration_count = registration_count + :one, updatedAt = :updatedAt',
          ConditionExpression: 'registration_count < :limit',
          ExpressionAttributeValues: {
            ':one': 1,
            ':limit': MAX_EXPO_TOKENS_PER_ACCOUNT,
            ':updatedAt': updatedAt
          }
        } };
        const tokenPut = { Put: {
          TableName: tableName,
          Item: {
            ...tokenKey,
            entity: 'push-token',
            token,
            unregister_secret_hash: unregisterSecretHash,
            updatedAt
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        } };
        try {
          await sendAccountGuardedTransaction(userId, [
            counterUpdate,
            tokenPut,
            tokenOwnerPut(userId, tokenHash, updatedAt)
          ]);
          return { unregisterReceipt: receipt };
        } catch (error) {
          if (!transactionMutationConditionFailed(error, [0, 1, 2])) throw error;
        }
        const currentOwner = await getTokenOwner(tokenHash);
        if (currentOwner && currentOwner !== userId) {
          throw Object.assign(new Error('Push token is already registered to another account'), {
            statusCode: 409,
            code: 'PUSH_TOKEN_ACCOUNT_CONFLICT'
          });
        }
        // A duplicate registration must remain a cheap idempotent update and
        // must not consume another slot in the account counter.
        const duplicateUpdateInput = {
          TableName: tableName,
          Key: tokenKey,
          UpdateExpression: 'SET #token = :token, unregister_secret_hash = :unregisterSecretHash, updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
          ExpressionAttributeNames: { '#token': 'token' },
          ExpressionAttributeValues: {
            ':token': token,
            ':unregisterSecretHash': unregisterSecretHash,
            ':updatedAt': Date.now()
          }
        };
        try {
          await sendAccountGuardedTransaction(userId, [
            { Update: duplicateUpdateInput },
            tokenOwnerPut(userId, tokenHash)
          ]);
          return { unregisterReceipt: receipt };
        } catch (error) {
          const missingToken = conditional(error) || transactionMutationConditionFailed(error, [0, 1]);
          if (!missingToken) throw error;
        }
        const racedOwner = await getTokenOwner(tokenHash);
        if (racedOwner && racedOwner !== userId) {
          throw Object.assign(new Error('Push token is already registered to another account'), {
            statusCode: 409,
            code: 'PUSH_TOKEN_ACCOUNT_CONFLICT'
          });
        }
        if (await registrationCount(userId) >= MAX_EXPO_TOKENS_PER_ACCOUNT) {
          throw Object.assign(new Error('Push registration limit exceeded'), { statusCode: 409 });
        }
      }
      throw Object.assign(new Error('Push registration is busy'), { statusCode: 503 });
    },
    async unregister(userId, token) {
      const tokenFingerprint = crypto.createHash('sha256').update(token).digest('base64url');
      const key = registrationKey(userId, tokenFingerprint);
      const current = await client.send(new GetCommand({
        TableName: tableName,
        Key: key,
        ProjectionExpression: 'unregister_secret_hash',
        ConsistentRead: true
      }));
      if (!current.Item) return false;
      await ensureRegistrationCounter(userId);
      const currentOwner = await getTokenOwner(tokenFingerprint);
      try {
        await sendAccountGuardedTransaction(userId, [
          { Update: {
            TableName: tableName,
            Key: counterKey(userId),
            UpdateExpression: 'SET registration_count = registration_count - :one, updatedAt = :updatedAt',
            ConditionExpression: 'registration_count > :zero',
            ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':updatedAt': Date.now() }
          } },
          { Delete: {
            TableName: tableName,
            Key: key,
            ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)'
          } },
          ...(currentOwner === userId ? [tokenOwnerDelete(userId, tokenFingerprint)] : [])
        ]);
        return true;
      } catch (error) {
        if (!transactionCanceled(error)) throw error;
        await assertAccountActive(userId);
        const raced = await client.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
        if (!raced.Item) return false;
        throw error;
      }
    },
    async unregisterByReceipt(rawReceipt) {
      const receipt = parseUnregisterReceipt(rawReceipt);
      const key = registrationKey(receipt.userId, receipt.tokenFingerprint);
      const expectedSecretHash = crypto.createHash('sha256').update(receipt.secret).digest('base64url');
      const current = await client.send(new GetCommand({
        TableName: tableName,
        Key: key,
        ProjectionExpression: 'unregister_secret_hash',
        ConsistentRead: true
      }));
      if (!current.Item) return false;
      const storedHash = String(current.Item.unregister_secret_hash || '');
      const expected = Buffer.from(expectedSecretHash);
      const stored = Buffer.from(storedHash);
      if (stored.length !== expected.length || !crypto.timingSafeEqual(stored, expected)) {
        return false;
      }
      const currentOwner = await getTokenOwner(receipt.tokenFingerprint);
      try {
        await client.send(new TransactWriteCommand({ TransactItems: [
          { Update: {
            TableName: tableName,
            Key: counterKey(receipt.userId),
            UpdateExpression: 'SET registration_count = registration_count - :one, updatedAt = :updatedAt',
            ConditionExpression: 'registration_count > :zero',
            ExpressionAttributeValues: { ':one': 1, ':zero': 0, ':updatedAt': Date.now() }
          } },
          { Delete: {
            TableName: tableName,
            Key: key,
            ConditionExpression: 'unregister_secret_hash = :unregisterSecretHash',
            ExpressionAttributeValues: { ':unregisterSecretHash': expectedSecretHash }
          } },
          ...(currentOwner === receipt.userId
            ? [tokenOwnerDelete(receipt.userId, receipt.tokenFingerprint)]
            : [])
        ] }));
        return true;
      } catch (error) {
        if (!transactionCanceled(error)) throw error;
        const raced = await client.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
        if (!raced.Item) return false;
        return false;
      }
    },
    async list(userId) {
      const registrations = await queryRegistrations(
        userId,
        'SK, #token',
        { '#token': 'token' },
        MAX_EXPO_TOKENS_PER_ACCOUNT
      );
      if (registrations.length > MAX_EXPO_TOKENS_PER_ACCOUNT) throw new Error('Push registration limit exceeded');
      const fingerprints = registrations.map((item) => (
        typeof item.SK === 'string' ? item.SK.replace(/^PUSH#/, '') : ''
      ));
      const owners = await tokenOwners(fingerprints);
      // Legacy rows created before the global owner fence are deliberately
      // inactive until their authenticated account re-registers. This avoids
      // delivering one physical token from two account partitions during a
      // rolling migration.
      return registrations
        .filter((item) => {
          const fingerprint = typeof item.SK === 'string' ? item.SK.replace(/^PUSH#/, '') : '';
          return owners.get(fingerprint) === userId;
        })
        .map((item) => item.token)
        .filter((token) => EXPO_TOKEN_PATTERN.test(token));
    },
    async exportUserData(userId) {
      const registrations = await queryRegistrations(
        userId,
        'SK, updatedAt',
        undefined,
        MAX_EXPO_TOKENS_PER_ACCOUNT
      );
      if (registrations.length > MAX_EXPO_TOKENS_PER_ACCOUNT) {
        throw new Error('Push registration limit exceeded');
      }
      return registrations.map(({ SK, updatedAt }) => ({
        tokenFingerprint: typeof SK === 'string' ? SK.replace(/^PUSH#/, '') : null,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : null
      }));
    },
    async deleteUserData(userId) {
      const deletedItems = await deleteAllRegistrations(userId);
      await client.send(new DeleteCommand({ TableName: tableName, Key: counterKey(userId) }));
      return { deletedItems };
    }
  };
}

function createExpoPushNotifier({ repository, fetchImpl = globalThis.fetch, endpoint = EXPO_PUSH_URL, timeoutMs = 5000 } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Push notification delivery is not configured');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new TypeError('Push provider timeout is invalid');
  }
  return async function notifyUser(userId, notification) {
    if (typeof repository?.list !== 'function') {
      throw new TypeError('Push notification delivery is not configured');
    }
    if (!notification || typeof notification !== 'object' || Array.isArray(notification)) {
      throw new TypeError('Push notification is invalid');
    }
    let notificationBytes;
    try { notificationBytes = Buffer.byteLength(JSON.stringify(notification)); } catch {
      throw new TypeError('Push notification is invalid');
    }
    if (notificationBytes > MAX_NOTIFICATION_BYTES) throw new TypeError('Push notification is too large');
    const registrations = await repository.list(userId);
    if (!Array.isArray(registrations)) throw new Error('Push registrations are invalid');
    const tokens = [...new Set(registrations.filter((token) => EXPO_TOKEN_PATTERN.test(token)))];
    if (tokens.length > MAX_EXPO_TOKENS_PER_ACCOUNT) throw new Error('Push registration limit exceeded');
    if (!tokens.length) return { sent: 0 };
    let sent = 0;
    const failures = [];
    let firstTransportFailure = null;
    for (let offset = 0; offset < tokens.length; offset += MAX_EXPO_BATCH_SIZE) {
      const batch = tokens.slice(offset, offset + MAX_EXPO_BATCH_SIZE);
      const controller = new AbortController();
      let providerResponse;
      let timeout;
      const timeoutFailure = new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          void cancelResponseBody(providerResponse);
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
              redirect: 'error',
              signal: controller.signal
            });
            providerResponse = response;
            if (controller.signal.aborted) {
              await cancelResponseBody(response);
              throw new Error('Push provider timed out');
            }
            if (!response.ok) {
              await cancelResponseBody(response);
              throw new Error(`Push provider returned ${response.status}`);
            }
            return readBoundedJSONResponse(response, {
              context: 'Push provider',
              maxBytes: MAX_EXPO_RESPONSE_BYTES,
              signal: controller.signal
            });
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
      } catch (error) {
        firstTransportFailure ||= error;
        failures.push(...batch.map(() => ({ code: 'PUSH_PROVIDER_FAILED' })));
      } finally {
        clearTimeout(timeout);
      }
    }
    if (firstTransportFailure && sent === 0) throw firstTransportFailure;
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
  MAX_EXPO_TOKENS_PER_ACCOUNT,
  createDynamoPushRepository,
  createEmergencyContactPushNotifier,
  createExpoPushNotifier,
  validatePushToken
};
