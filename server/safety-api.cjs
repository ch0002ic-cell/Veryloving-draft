'use strict';

const crypto = require('node:crypto');

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const MEDICATION_REFERENCE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const SAFETY_MODES = new Set(['home', 'guardian', 'emergency']);
const MEDICATION_ESCALATION_REASONS = new Set([
  'missed_dose',
  'reminder_unacknowledged',
  'care_recipient_unresponsive'
]);
const CONTACT_DELIVERY_STATUSES = new Set([
  'pending',
  'delivered',
  'partially_delivered',
  'failed',
  'no_eligible_recipients',
  'not_configured'
]);
const MAX_SAFETY_RETENTION_DAYS = 365;
const MAX_MEDICATION_ESCALATION_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SAFETY_EXPORT_ITEMS = 10000;
const MAX_PRIVACY_EXPORT_BYTES = 16 * 1024 * 1024;
const DELIVERY_CLAIM_LEASE_MS = 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 5;
const DELIVERY_CLAIM_TOKEN_PATTERN = /^[0-9a-f-]{36}$/i;

function validateContactInput(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const countryCode = typeof body?.countryCode === 'string' ? body.countryCode.trim().toUpperCase() : '';
  if (!name || name.length > 100) throw Object.assign(new Error('name is invalid'), { statusCode: 400 });
  if (!E164_PATTERN.test(phone)) throw Object.assign(new Error('phone must be a valid E.164 number'), { statusCode: 400 });
  if (!/^[A-Z]{2}$/.test(countryCode)) throw Object.assign(new Error('countryCode is invalid'), { statusCode: 400 });
  return { name, phone, countryCode };
}

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_PATTERN.test(value)) {
    throw Object.assign(new Error('idempotencyKey is invalid'), { statusCode: 400 });
  }
  return value;
}

function safetyEventExpiry(retentionDays) {
  const parsed = Number(retentionDays);
  const days = Number.isFinite(parsed)
    ? Math.max(1, Math.min(MAX_SAFETY_RETENTION_DAYS, Math.floor(parsed)))
    : 30;
  return Math.floor((Date.now() + days * 86400000) / 1000);
}

function validateMedicationEscalationInput(body, { allowHistorical = false } = {}) {
  const medicationReference = typeof body?.medicationReference === 'string'
    ? body.medicationReference.trim()
    : '';
  if (!MEDICATION_REFERENCE_PATTERN.test(medicationReference)) {
    throw Object.assign(new Error('medicationReference is invalid'), { statusCode: 400 });
  }
  if (!MEDICATION_ESCALATION_REASONS.has(body?.reason)) {
    throw Object.assign(new Error('reason is invalid'), { statusCode: 400 });
  }
  const occurredAt = Number(body?.occurredAt);
  const now = Date.now();
  if (!Number.isSafeInteger(occurredAt)
    || (!allowHistorical && occurredAt < now - MAX_MEDICATION_ESCALATION_AGE_MS)
    || (!allowHistorical && occurredAt > now + 5 * 60 * 1000)) {
    throw Object.assign(new Error('occurredAt is invalid or stale'), { statusCode: 400 });
  }
  if (body?.contactIds !== undefined && !Array.isArray(body.contactIds)) {
    throw Object.assign(new Error('contactIds is invalid'), { statusCode: 400 });
  }
  if (Array.isArray(body?.contactIds) && body.contactIds.length > 10) {
    throw Object.assign(new Error('contactIds exceeds the emergency contact limit'), { statusCode: 400 });
  }
  const source = body?.source === 'home_robot' ? 'home_robot' : body?.source === 'app' ? 'app' : null;
  if (!source) throw Object.assign(new Error('source is invalid'), { statusCode: 400 });
  return {
    medicationReference,
    reason: body.reason,
    occurredAt,
    source,
    requestedContactIds: body.contactIds
  };
}

function validateLocation(value, { allowHistorical = false } = {}) {
  if (value === undefined || value === null) return null;
  const latitude = Number(value.latitude ?? value.coords?.latitude);
  const longitude = Number(value.longitude ?? value.coords?.longitude);
  const capturedAt = Number(value.capturedAt ?? value.timestamp ?? value.cachedAt);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw Object.assign(new Error('location is invalid'), { statusCode: 400 });
  }
  if (!Number.isSafeInteger(capturedAt)
    || (!allowHistorical && Math.abs(Date.now() - capturedAt) > 5 * 60 * 1000)) {
    throw Object.assign(new Error('location is stale'), { statusCode: 400 });
  }
  return { latitude, longitude, capturedAt };
}

function validateMedicalAttachment(value, { allowHistorical = false } = {}) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) {
    throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
  }
  const generatedAt = Number(value.generatedAt);
  const consentRecordedAt = Number(value.consentRecordedAt);
  const profileVersion = Number(value.profileVersion);
  if (!Number.isSafeInteger(generatedAt)
    || (!allowHistorical && Math.abs(Date.now() - generatedAt) > 5 * 60 * 1000)
    || !Number.isSafeInteger(consentRecordedAt)
    || consentRecordedAt > generatedAt
    || !Number.isSafeInteger(profileVersion)
    || profileVersion < 1) {
    throw Object.assign(new Error('medicalAttachment is stale or invalid'), { statusCode: 400 });
  }
  const cleanString = (input, maxLength) => {
    if (input === null || input === undefined || input === '') return null;
    if (typeof input !== 'string' || input.trim().length > maxLength) {
      throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
    }
    return input.trim();
  };
  const cleanList = (input) => {
    if (!Array.isArray(input) || input.length > 20) {
      throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
    }
    return input.map((item) => cleanString(item, 160)).filter(Boolean);
  };
  if (!Array.isArray(value.medications) || value.medications.length > 20) {
    throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
  }
  const medications = value.medications.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
    }
    const name = cleanString(item.name, 160);
    if (!name) throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
    return {
      name,
      dose: cleanString(item.dose, 160),
      instructions: cleanString(item.instructions, 160)
    };
  });
  const bloodType = cleanString(value.bloodType, 7) || 'unknown';
  if (!new Set(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown']).has(bloodType)) {
    throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
  }
  return {
    schemaVersion: 1,
    profileVersion,
    consentRecordedAt,
    generatedAt,
    bloodType,
    conditions: cleanList(value.conditions),
    allergies: cleanList(value.allergies),
    medications,
    emergencyNotes: cleanString(value.emergencyNotes, 500)
  };
}

function opaqueId(prefix, input) {
  return `${prefix}_${crypto.createHash('sha256').update(input).digest('base64url').slice(0, 24)}`;
}

function sosRequestFingerprint({ occurredAt, source, contactIds, location, medicalAttachment }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    occurredAt,
    source,
    contactIds: [...contactIds].sort(),
    location: location || null,
    medicalAttachment: medicalAttachment || null
  })).digest('base64url');
}

function safetySessionRequestFingerprint({ mode, location }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    mode,
    location: location || null
  })).digest('base64url');
}

function createDynamoSafetyRepository({
  tableName,
  region,
  client: injectedClient,
  accountStateTableName
} = {}) {
  if (!tableName) throw new Error('SAFETY_TABLE_NAME is required');
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    BatchWriteCommand,
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    TransactWriteCommand,
    UpdateCommand
  } = require('@aws-sdk/lib-dynamodb');
  const documentClient = injectedClient || DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true }
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
    const result = await documentClient.send(new GetCommand({
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

  async function sendAccountGuardedMutation(userId, legacyCommand, transactionItem) {
    if (!accountStateTableName) return documentClient.send(legacyCommand);
    try {
      await documentClient.send(new TransactWriteCommand({
        TransactItems: [accountActiveCondition(userId), transactionItem]
      }));
      return null;
    } catch (error) {
      if (transactionCanceled(error)) await assertAccountActive(userId);
      throw error;
    }
  }

  async function sendAccountGuardedTransaction(userId, transactionItems) {
    const offset = accountStateTableName ? 1 : 0;
    try {
      await documentClient.send(new TransactWriteCommand({
        TransactItems: [
          ...(accountStateTableName ? [accountActiveCondition(userId)] : []),
          ...transactionItems
        ]
      }));
      return { offset };
    } catch (error) {
      if (transactionCanceled(error) && accountStateTableName) await assertAccountActive(userId);
      throw error;
    }
  }

  const contactPhoneKey = (userId, phone) => ({
    PK: `USER#${userId}`,
    SK: `CONTACT_PHONE#${crypto.createHash('sha256').update(phone).digest('base64url')}`
  });

  async function listContactRecords(userId) {
    const result = await documentClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'CONTACT#' },
      ConsistentRead: true,
      Limit: 11
    }));
    return (result.Items || []).filter((item) => item.entity === 'contact');
  }

  function mutationConditionFailed(error) {
    if (conditional(error)) return true;
    if (!transactionCanceled(error) || !accountStateTableName) return false;
    const reasons = error.CancellationReasons || error.cancellationReasons;
    return reasons?.[1]?.Code === 'ConditionalCheckFailed';
  }

  async function queryAllUserItems(userId, projectionExpression, maxItems = MAX_SAFETY_EXPORT_ITEMS) {
    const items = [];
    let exclusiveStartKey;
    do {
      const remaining = maxItems + 1 - items.length;
      if (remaining <= 0) break;
      const result = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        Limit: Math.min(100, remaining),
        ...(projectionExpression ? { ProjectionExpression: projectionExpression } : {}),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      items.push(...(result.Items || []));
      if (items.length > maxItems) {
        throw Object.assign(new Error('Safety data export exceeds the supported account limit'), {
          statusCode: 413,
          code: 'SAFETY_EXPORT_LIMIT_EXCEEDED'
        });
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async function deleteKeyBatch(keys) {
    for (let offset = 0; offset < keys.length; offset += 25) {
      let pending = keys.slice(offset, offset + 25).map((key) => ({
        DeleteRequest: { Key: { PK: key.PK, SK: key.SK } }
      }));
      for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
        const result = await documentClient.send(new BatchWriteCommand({
          RequestItems: { [tableName]: pending }
        }));
        pending = result.UnprocessedItems?.[tableName] || [];
        if (pending.length) await new Promise((resolve) => setTimeout(resolve, 50 * Math.pow(2, attempt)));
      }
      if (pending.length) throw new Error('DynamoDB could not delete all user data');
    }
  }

  async function acceptDeliveryEvent(userId, sortPrefix, entity, event) {
    const key = { PK: `USER#${userId}`, SK: `${sortPrefix}#${event.idempotencyKey}` };
    const putInput = {
      TableName: tableName,
      Item: { ...key, entity, ...event },
      ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
    };
    try {
      await sendAccountGuardedMutation(userId, new PutCommand(putInput), { Put: putInput });
      return event;
    } catch (error) {
      if (!mutationConditionFailed(error)) throw error;
      const existing = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: key,
        ConsistentRead: true
      }));
      if (!existing.Item) throw error;
      return existing.Item;
    }
  }

  async function claimDeliveryEvent(userId, sortPrefix, idempotencyKey) {
    const key = { PK: `USER#${userId}`, SK: `${sortPrefix}#${idempotencyKey}` };
    const attemptedAt = Date.now();
    const claimToken = crypto.randomUUID();
    const updateInput = {
      TableName: tableName,
      Key: key,
      UpdateExpression: [
        'SET deliveryAttemptedAt = :attemptedAt',
        'deliveryClaimToken = :claimToken',
        'deliveryClaimExpiresAt = :claimExpiresAt',
        'deliveryAttemptCount = if_not_exists(deliveryAttemptCount, :zero) + :one',
        'deliveryStatus = :pending'
      ].join(', '),
      ConditionExpression: [
        'attribute_exists(PK)',
        'attribute_exists(SK)',
        '#status = :accepted',
        '(deliveryStatus = :pending OR deliveryStatus = :failed)',
        '(attribute_not_exists(deliveryClaimExpiresAt) OR deliveryClaimExpiresAt <= :attemptedAt)',
        '(attribute_not_exists(deliveryAttemptCount) OR deliveryAttemptCount < :maxAttempts)'
      ].join(' AND '),
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':accepted': 'accepted',
        ':pending': 'pending',
        ':failed': 'failed',
        ':attemptedAt': attemptedAt,
        ':claimToken': claimToken,
        ':claimExpiresAt': attemptedAt + DELIVERY_CLAIM_LEASE_MS,
        ':zero': 0,
        ':one': 1,
        ':maxAttempts': MAX_DELIVERY_ATTEMPTS
      }
    };
    try {
      const result = await sendAccountGuardedMutation(
        userId,
        new UpdateCommand({ ...updateInput, ReturnValues: 'ALL_NEW' }),
        { Update: updateInput }
      );
      if (!accountStateTableName) return result.Attributes || null;
      const current = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      return current.Item || null;
    } catch (error) {
      if (mutationConditionFailed(error)) return null;
      throw error;
    }
  }

  async function recordDeliveryEvent(userId, sortPrefix, idempotencyKey, delivery) {
    if (!CONTACT_DELIVERY_STATUSES.has(delivery?.deliveryStatus) || delivery.deliveryStatus === 'pending') {
      throw new Error('Contact delivery status is invalid');
    }
    if (!DELIVERY_CLAIM_TOKEN_PATTERN.test(delivery?.claimToken || '')) {
      throw new Error('Contact delivery claim is invalid');
    }
    const count = (value) => Math.min(10, Math.max(0, Number.isSafeInteger(value) ? value : 0));
    const recordedAt = Date.now();
    const key = { PK: `USER#${userId}`, SK: `${sortPrefix}#${idempotencyKey}` };
    const updateInput = {
      TableName: tableName,
      Key: key,
      UpdateExpression: `${[
        'SET deliveryStatus = :deliveryStatus',
        'deliveryRecordedAt = :recordedAt',
        'deliveryEligibleCount = :eligibleCount',
        'deliveryDeliveredCount = :deliveredCount',
        'deliveryFailedCount = :failedCount'
      ].join(', ')} REMOVE deliveryClaimToken, deliveryClaimExpiresAt`,
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :accepted AND deliveryClaimToken = :claimToken',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':accepted': 'accepted',
        ':claimToken': delivery.claimToken,
        ':deliveryStatus': delivery.deliveryStatus,
        ':recordedAt': recordedAt,
        ':eligibleCount': count(delivery.eligibleCount),
        ':deliveredCount': count(delivery.deliveredCount),
        ':failedCount': count(delivery.failedCount)
      }
    };
    const result = await sendAccountGuardedMutation(
      userId,
      new UpdateCommand({ ...updateInput, ReturnValues: 'ALL_NEW' }),
      { Update: updateInput }
    );
    if (!accountStateTableName) return result.Attributes || null;
    const current = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
    return current.Item || null;
  }

  return {
    async listContacts(userId) {
      return (await listContactRecords(userId))
        .map(({ id, name, phone, countryCode, version }) => ({ id, name, phone, countryCode, version }));
    },
    async createContact(userId, contact) {
      const key = { PK: `USER#${userId}`, SK: `CONTACT#${contact.id}` };
      const existingContacts = await listContactRecords(userId);
      const putInput = {
        TableName: tableName,
        Item: { ...key, entity: 'contact', ...contact },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      };
      const phoneKey = contactPhoneKey(userId, contact.phone);
      const phonePut = {
        TableName: tableName,
        Item: { ...phoneKey, entity: 'contact-phone-reservation', contactId: contact.id },
        ConditionExpression: 'attribute_not_exists(PK) OR contactId = :contactId',
        ExpressionAttributeValues: { ':contactId': contact.id }
      };
      const countUpdate = {
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: 'CONTACT#META' },
        UpdateExpression: 'SET entity = if_not_exists(entity, :entity), contactCount = if_not_exists(contactCount, :seed) + :one, updatedAt = :updatedAt',
        ConditionExpression: 'attribute_not_exists(contactCount) OR contactCount < :limit',
        ExpressionAttributeValues: {
          ':entity': 'contact-metadata',
          ':seed': existingContacts.length,
          ':one': 1,
          ':limit': 10,
          ':updatedAt': Date.now()
        }
      };
      try {
        await sendAccountGuardedTransaction(userId, [
          { Put: phonePut },
          { Put: putInput },
          { Update: countUpdate }
        ]);
        return contact;
      } catch (error) {
        if (!transactionCanceled(error)) throw error;
        const existing = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
        if (!existing.Item) {
          throw Object.assign(new Error('Emergency contact limit reached or phone number is already in use'), {
            statusCode: 409,
            code: 'CONTACT_CONSTRAINT_CONFLICT'
          });
        }
        const { id, name, phone, countryCode, version } = existing.Item;
        return { id, name, phone, countryCode, version };
      }
    },
    async updateContact(userId, contactId, contact, expectedVersion) {
      const key = { PK: `USER#${userId}`, SK: `CONTACT#${contactId}` };
      const current = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      if (!current.Item) {
        throw Object.assign(new Error('Emergency contact not found'), { statusCode: 404 });
      }
      if (current.Item.version !== expectedVersion) {
        throw Object.assign(new Error('Emergency contact changed; refresh and try again'), { statusCode: 409 });
      }
      const updateInput = {
        TableName: tableName,
        Key: key,
        UpdateExpression: 'SET #name = :name, phone = :phone, countryCode = :countryCode, #version = :nextVersion, updatedAt = :updatedAt',
        ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #version = :expectedVersion',
        ExpressionAttributeNames: {
          '#name': 'name',
          '#version': 'version'
        },
        ExpressionAttributeValues: {
          ':name': contact.name,
          ':phone': contact.phone,
          ':countryCode': contact.countryCode,
          ':expectedVersion': expectedVersion,
          ':nextVersion': contact.version,
          ':updatedAt': contact.updatedAt
        }
      };
      const nextPhoneKey = contactPhoneKey(userId, contact.phone);
      const previousPhoneKey = contactPhoneKey(userId, current.Item.phone);
      const reservationPut = {
        TableName: tableName,
        Item: { ...nextPhoneKey, entity: 'contact-phone-reservation', contactId },
        ConditionExpression: 'attribute_not_exists(PK) OR contactId = :contactId',
        ExpressionAttributeValues: { ':contactId': contactId }
      };
      const transactionItems = [{ Put: reservationPut }, { Update: updateInput }];
      if (previousPhoneKey.SK !== nextPhoneKey.SK) {
        transactionItems.push({
          Delete: {
            TableName: tableName,
            Key: previousPhoneKey,
            ConditionExpression: 'attribute_not_exists(PK) OR contactId = :contactId',
            ExpressionAttributeValues: { ':contactId': contactId }
          }
        });
      }
      try {
        await sendAccountGuardedTransaction(userId, transactionItems);
        const { id, name, phone, countryCode, version } = contact;
        return { id, name, phone, countryCode, version };
      } catch (error) {
        if (!transactionCanceled(error)) throw error;
        const latest = await documentClient.send(new GetCommand({
          TableName: tableName,
          Key: key,
          ConsistentRead: true
        }));
        throw Object.assign(
          new Error(latest.Item ? 'Emergency contact changed or phone number is already in use' : 'Emergency contact not found'),
          { statusCode: latest.Item ? 409 : 404, code: latest.Item ? 'CONTACT_CONSTRAINT_CONFLICT' : 'CONTACT_NOT_FOUND' }
        );
      }
    },
    async deleteContact(userId, contactId) {
      const key = { PK: `USER#${userId}`, SK: `CONTACT#${contactId}` };
      const current = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
      if (!current.Item) return;
      const existingContacts = await listContactRecords(userId);
      const deleteInput = {
        TableName: tableName,
        Key: key,
        ConditionExpression: '#version = :version AND phone = :phone',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':version': current.Item.version, ':phone': current.Item.phone }
      };
      const countUpdate = {
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: 'CONTACT#META' },
        UpdateExpression: 'SET entity = if_not_exists(entity, :entity), contactCount = if_not_exists(contactCount, :seed) - :one, updatedAt = :updatedAt',
        ConditionExpression: '(attribute_not_exists(contactCount) AND :seed > :zero) OR contactCount > :zero',
        ExpressionAttributeValues: {
          ':entity': 'contact-metadata',
          ':seed': existingContacts.length,
          ':zero': 0,
          ':one': 1,
          ':updatedAt': Date.now()
        }
      };
      try {
        await sendAccountGuardedTransaction(userId, [
          { Delete: deleteInput },
          {
            Delete: {
              TableName: tableName,
              Key: contactPhoneKey(userId, current.Item.phone),
              ConditionExpression: 'attribute_not_exists(PK) OR contactId = :contactId',
              ExpressionAttributeValues: { ':contactId': contactId }
            }
          },
          { Update: countUpdate }
        ]);
      } catch (error) {
        if (!transactionCanceled(error)) throw error;
        const latest = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
        if (!latest.Item) return;
        throw Object.assign(new Error('Emergency contact changed; refresh and try again'), {
          statusCode: 409,
          code: 'CONTACT_CONSTRAINT_CONFLICT'
        });
      }
    },
    async acceptSOS(userId, event) {
      return acceptDeliveryEvent(userId, 'SOS', 'sos', event);
    },
    async getSOS(userId, idempotencyKey) {
      const result = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: `SOS#${idempotencyKey}` },
        ConsistentRead: true
      }));
      return result.Item || null;
    },
    async claimSOSDelivery(userId, idempotencyKey) {
      return claimDeliveryEvent(userId, 'SOS', idempotencyKey);
    },
    async recordSOSDelivery(userId, idempotencyKey, delivery) {
      return recordDeliveryEvent(userId, 'SOS', idempotencyKey, delivery);
    },
    async acceptMedicationEscalation(userId, event) {
      return acceptDeliveryEvent(userId, 'MEDICATION_ESCALATION', 'medication-escalation', event);
    },
    async getMedicationEscalation(userId, idempotencyKey) {
      const result = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: `MEDICATION_ESCALATION#${idempotencyKey}` },
        ConsistentRead: true
      }));
      return result.Item || null;
    },
    async claimMedicationEscalationDelivery(userId, idempotencyKey) {
      return claimDeliveryEvent(userId, 'MEDICATION_ESCALATION', idempotencyKey);
    },
    async recordMedicationEscalationDelivery(userId, idempotencyKey, delivery) {
      return recordDeliveryEvent(userId, 'MEDICATION_ESCALATION', idempotencyKey, delivery);
    },
    async startSafetySession(userId, session) {
      const { expiresAt, ...currentSession } = session;
      const receiptKey = {
        PK: `USER#${userId}`,
        SK: `SAFETY_SESSION#${session.idempotencyKey}`
      };
      const receiptPut = {
        TableName: tableName,
        Item: { ...receiptKey, entity: 'safety-session-receipt', ...currentSession, expiresAt },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      };
      const currentPut = {
        TableName: tableName,
        Item: { PK: `USER#${userId}`, SK: 'SAFETY#CURRENT', entity: 'safety-state', ...currentSession }
      };
      try {
        await sendAccountGuardedTransaction(userId, [
          { Put: receiptPut },
          { Put: currentPut }
        ]);
        return session;
      } catch (error) {
        if (!transactionCanceled(error)) throw error;
        const existing = await documentClient.send(new GetCommand({
          TableName: tableName,
          Key: receiptKey,
          ConsistentRead: true
        }));
        if (!existing.Item) throw error;
        const {
          id,
          idempotencyKey,
          requestFingerprint,
          mode,
          status,
          startedAt,
          location,
          expiresAt
        } = existing.Item;
        return {
          id,
          idempotencyKey,
          requestFingerprint,
          mode,
          status,
          startedAt,
          location: location || null,
          expiresAt
        };
      }
    },
    async getSafetySession(userId) {
      const result = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: 'SAFETY#CURRENT' },
        ConsistentRead: true
      }));
      if (!result.Item) return null;
      const { id, mode, status, startedAt, location } = result.Item;
      return { id, mode, status, startedAt, location: location || null };
    },
    async exportUserData(userId) {
      const items = await queryAllUserItems(userId);
      const safetyState = items.find((item) => item.entity === 'safety-state');
      return {
        contacts: items.filter((item) => item.entity === 'contact').map(
          ({ id, name, phone, countryCode, version, createdAt }) => ({ id, name, phone, countryCode, version, createdAt })
        ),
        safetyState: safetyState ? {
          id: safetyState.id,
          mode: safetyState.mode,
          status: safetyState.status,
          startedAt: safetyState.startedAt,
          location: safetyState.location || null
        } : null,
        sosEvents: items.filter((item) => item.entity === 'sos').map(({
          id,
          status,
          acceptedAt,
          occurredAt,
          source,
          contactIds,
          location,
          medicalAttachment,
          deliveryStatus,
          deliveryAttemptedAt,
          deliveryRecordedAt,
          deliveryEligibleCount,
          deliveryDeliveredCount,
          deliveryFailedCount
        }) => ({
          id,
          status,
          acceptedAt,
          occurredAt,
          source,
          contactIds,
          location: location || null,
          medicalAttachment: medicalAttachment || null,
          deliveryStatus: CONTACT_DELIVERY_STATUSES.has(deliveryStatus) ? deliveryStatus : 'not_configured',
          deliveryAttemptedAt: Number.isFinite(deliveryAttemptedAt) ? deliveryAttemptedAt : null,
          deliveryRecordedAt: Number.isFinite(deliveryRecordedAt) ? deliveryRecordedAt : null,
          deliveryEligibleCount: Number.isSafeInteger(deliveryEligibleCount) ? deliveryEligibleCount : 0,
          deliveryDeliveredCount: Number.isSafeInteger(deliveryDeliveredCount) ? deliveryDeliveredCount : 0,
          deliveryFailedCount: Number.isSafeInteger(deliveryFailedCount) ? deliveryFailedCount : 0
        })),
        medicationEscalations: items
          .filter((item) => item.entity === 'medication-escalation')
          .map(({
            id,
            status,
            acceptedAt,
            occurredAt,
            source,
            reason,
            medicationReference,
            contactIds,
            deliveryStatus,
            deliveryAttemptedAt,
            deliveryRecordedAt,
            deliveryEligibleCount,
            deliveryDeliveredCount,
            deliveryFailedCount,
            expiresAt
          }) => ({
            id,
            status,
            acceptedAt,
            occurredAt,
            source,
            reason,
            medicationReference,
            contactIds,
            deliveryStatus: CONTACT_DELIVERY_STATUSES.has(deliveryStatus) ? deliveryStatus : 'not_configured',
            deliveryAttemptedAt: Number.isFinite(deliveryAttemptedAt) ? deliveryAttemptedAt : null,
            deliveryRecordedAt: Number.isFinite(deliveryRecordedAt) ? deliveryRecordedAt : null,
            deliveryEligibleCount: Number.isSafeInteger(deliveryEligibleCount) ? deliveryEligibleCount : 0,
            deliveryDeliveredCount: Number.isSafeInteger(deliveryDeliveredCount) ? deliveryDeliveredCount : 0,
            deliveryFailedCount: Number.isSafeInteger(deliveryFailedCount) ? deliveryFailedCount : 0,
            expiresAt: Number.isSafeInteger(expiresAt) ? expiresAt : null
          }))
      };
    },
    async deleteUserData(userId) {
      let deletedItems = 0;
      let exclusiveStartKey;
      do {
        const result = await documentClient.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': `USER#${userId}` },
          ProjectionExpression: 'PK, SK',
          ConsistentRead: true,
          Limit: 100,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        const keys = result.Items || [];
        await deleteKeyBatch(keys);
        deletedItems += keys.length;
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return { deletedItems };
    }
  };
}

function hasScope(principal, required) {
  return new Set(String(principal?.scope || '').split(/\s+/).filter(Boolean)).has(required);
}

function requireScope(principal, required) {
  if (!hasScope(principal, required)) {
    throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
  }
}

async function deliverContactAlert({
  repository,
  userId,
  accepted,
  contactIds,
  notifyEmergencyContacts,
  claimMethod,
  recordMethod,
  notification,
  initialDeliveryStatus
}) {
  let deliveryStatus = CONTACT_DELIVERY_STATUSES.has(accepted.deliveryStatus)
    ? accepted.deliveryStatus
    : initialDeliveryStatus;
  if (typeof notifyEmergencyContacts !== 'function') return deliveryStatus;

  const recordDelivery = async (delivery) => {
    try {
      await repository[recordMethod]?.(userId, accepted.idempotencyKey, {
        ...delivery,
        ...(typeof claimed?.deliveryClaimToken === 'string'
          ? { claimToken: claimed.deliveryClaimToken }
          : {})
      });
    } catch {
      // Delivery-state storage is deliberately isolated from durable event
      // acceptance. An alert provider failure cannot rewrite acceptance.
    }
  };
  let claimed = null;
  try {
    claimed = typeof repository[claimMethod] === 'function'
      ? await repository[claimMethod](userId, accepted.idempotencyKey)
      : (deliveryStatus === 'pending' ? accepted : null);
  } catch {
    deliveryStatus = 'failed';
    await recordDelivery({
      deliveryStatus,
      eligibleCount: 0,
      deliveredCount: 0,
      failedCount: 0
    });
  }
  if (!claimed) return deliveryStatus;

  let delivery = null;
  try {
    delivery = await notifyEmergencyContacts(userId, contactIds, notification);
  } catch {
    deliveryStatus = 'failed';
    await recordDelivery({
      deliveryStatus,
      eligibleCount: 0,
      deliveredCount: 0,
      failedCount: 0
    });
  }
  if (!delivery) return deliveryStatus;

  deliveryStatus = delivery.delivered > 0
    ? (delivery.failedRecipients > 0 ? 'partially_delivered' : 'delivered')
    : delivery.eligible > 0 ? 'failed' : 'no_eligible_recipients';
  await recordDelivery({
    deliveryStatus,
    eligibleCount: delivery.eligible,
    deliveredCount: delivery.delivered,
    failedCount: delivery.failedRecipients
  });
  return deliveryStatus;
}

async function handleSafetyAPI({
  req,
  res,
  url,
  body,
  principal,
  repository,
  privacyCoordinator,
  notifyEmergencyContacts,
  retentionDays = 30,
  privacyExportMaxBytes = MAX_PRIVACY_EXPORT_BYTES,
  json
}) {
  if (!principal?.sub) {
    json(res, 401, { error: 'Unauthorized' });
    return true;
  }
  const userId = principal.sub;

  if (req.method === 'GET' && url.pathname === '/v1/emergency-contacts') {
    requireScope(principal, 'safety:read');
    json(res, 200, { contacts: await repository.listContacts(userId) });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/emergency-contacts') {
    requireScope(principal, 'safety:write');
    const input = validateContactInput(body);
    const existingContacts = await repository.listContacts(userId);
    const existing = existingContacts.find((contact) => contact.phone === input.phone);
    if (existing) {
      json(res, 200, existing);
      return true;
    }
    if (existingContacts.length >= 10) {
      throw Object.assign(new Error('Emergency contact limit reached'), { statusCode: 409 });
    }
    // A per-account/per-phone identifier makes migration and retries
    // idempotent without accepting a client-selected database key.
    const contact = {
      id: opaqueId('contact', `${userId}:${input.phone}`),
      ...input,
      version: 1,
      createdAt: Date.now()
    };
    json(res, 201, await repository.createContact(userId, contact));
    return true;
  }
  const contactMatch = /^\/v1\/emergency-contacts\/(contact_[A-Za-z0-9_-]{24})$/.exec(url.pathname);
  if (req.method === 'PATCH' && contactMatch) {
    requireScope(principal, 'safety:write');
    const input = validateContactInput(body);
    const expectedVersion = Number(body?.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw Object.assign(new Error('version is invalid'), { statusCode: 400 });
    }
    const existingContacts = await repository.listContacts(userId);
    const existing = existingContacts.find((contact) => contact.id === contactMatch[1]);
    if (!existing) throw Object.assign(new Error('Emergency contact not found'), { statusCode: 404 });
    if (existing.version !== expectedVersion) {
      throw Object.assign(new Error('Emergency contact changed; refresh and try again'), { statusCode: 409 });
    }
    if (existingContacts.some((contact) => contact.id !== existing.id && contact.phone === input.phone)) {
      throw Object.assign(new Error('An emergency contact already uses this phone number'), { statusCode: 409 });
    }
    const updated = {
      id: existing.id,
      ...input,
      version: expectedVersion + 1,
      updatedAt: Date.now()
    };
    json(res, 200, await repository.updateContact(userId, existing.id, updated, expectedVersion));
    return true;
  }
  if (req.method === 'DELETE' && contactMatch) {
    requireScope(principal, 'safety:write');
    await repository.deleteContact(userId, contactMatch[1]);
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/sos-events') {
    requireScope(principal, 'safety:write');
    const idempotencyKey = validateIdempotencyKey(body?.idempotencyKey);
    const existingSOS = typeof repository.getSOS === 'function'
      ? await repository.getSOS(userId, idempotencyKey)
      : null;
    const occurredAt = Number(body?.occurredAt);
    if (!Number.isSafeInteger(occurredAt)
      || (!existingSOS && Math.abs(Date.now() - occurredAt) > 5 * 60 * 1000)) {
      throw Object.assign(new Error('occurredAt is invalid or stale'), { statusCode: 400 });
    }
    if (!Array.isArray(body?.contactIds)
      || body.contactIds.length < 1
      || body.contactIds.length > 10
      || body.contactIds.some((id) => typeof id !== 'string' || !/^contact_[A-Za-z0-9_-]{24}$/.test(id))) {
      throw Object.assign(new Error('contactIds is invalid'), { statusCode: 400 });
    }
    const contactIds = [...new Set(body.contactIds)];
    const source = ['app', 'vl01'].includes(body?.source) ? body.source : null;
    if (!source) throw Object.assign(new Error('source is invalid'), { statusCode: 400 });
    if (!existingSOS) {
      const ownedContactIds = new Set((await repository.listContacts(userId)).map((contact) => contact.id));
      if (contactIds.some((contactId) => !ownedContactIds.has(contactId))) {
        throw Object.assign(new Error('An emergency contact is unavailable'), { statusCode: 400 });
      }
    }
    const location = validateLocation(body?.location, { allowHistorical: Boolean(existingSOS) });
    const medicalAttachment = validateMedicalAttachment(body?.medicalAttachment, { allowHistorical: Boolean(existingSOS) });
    const requestFingerprint = sosRequestFingerprint({
      occurredAt,
      source,
      contactIds,
      location,
      medicalAttachment
    });
    const event = {
      id: opaqueId('sos', `${userId}:${idempotencyKey}`),
      idempotencyKey,
      requestFingerprint,
      status: 'accepted',
      acceptedAt: Date.now(),
      occurredAt,
      source,
      contactIds,
      location,
      medicalAttachment,
      deliveryStatus: typeof notifyEmergencyContacts === 'function' ? 'pending' : 'not_configured',
      // Configure DynamoDB TTL on this attribute. Contacts and the current
      // safety state remain until user deletion; transient SOS telemetry does
      // not persist indefinitely.
      expiresAt: safetyEventExpiry(retentionDays)
    };
    const accepted = existingSOS || await repository.acceptSOS(userId, event);
    const acceptedFingerprint = accepted.requestFingerprint || sosRequestFingerprint(accepted);
    if (acceptedFingerprint !== requestFingerprint) {
      throw Object.assign(new Error('idempotencyKey was already used for a different SOS event'), { statusCode: 409 });
    }
    const deliveryStatus = await deliverContactAlert({
      repository,
      userId,
      accepted,
      contactIds: accepted.contactIds,
      notifyEmergencyContacts,
      claimMethod: 'claimSOSDelivery',
      recordMethod: 'recordSOSDelivery',
      notification: {
        title: 'VeryLoving safety alert',
        body: 'A trusted contact activated SOS. Open VeryLoving and check on them now.',
        data: { type: 'emergency_contact_sos', sos_id: accepted.id }
      },
      initialDeliveryStatus: event.deliveryStatus
    });
    json(res, 202, {
      id: accepted.id,
      status: accepted.status,
      acceptedAt: accepted.acceptedAt,
      deliveryStatus
    });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/medication-escalations') {
    requireScope(principal, 'safety:write');
    const idempotencyKey = validateIdempotencyKey(body?.idempotencyKey);
    const input = validateMedicationEscalationInput(body, { allowHistorical: true });
    const selectedContactIds = input.requestedContactIds === undefined
      ? null
      : [...new Set(input.requestedContactIds)];
    if (selectedContactIds && (
      selectedContactIds.length === 0
      || selectedContactIds.some((id) => typeof id !== 'string' || !/^contact_[A-Za-z0-9_-]{24}$/.test(id))
    )) {
      throw Object.assign(new Error('contactIds is invalid'), { statusCode: 400 });
    }
    const requestFingerprint = crypto.createHash('sha256').update(JSON.stringify({
      medicationReference: input.medicationReference,
      reason: input.reason,
      occurredAt: input.occurredAt,
      source: input.source,
      contacts: selectedContactIds ? [...selectedContactIds].sort() : 'all'
    })).digest('base64url');

    let accepted = typeof repository.getMedicationEscalation === 'function'
      ? await repository.getMedicationEscalation(userId, idempotencyKey)
      : null;
    if (!accepted) {
      validateMedicationEscalationInput(body);
      const contacts = (await repository.listContacts(userId)).slice(0, 10);
      const ownedContactIds = new Set(contacts.map((contact) => contact.id));
      if (selectedContactIds?.some((contactId) => !ownedContactIds.has(contactId))) {
        throw Object.assign(new Error('An emergency contact is unavailable'), { statusCode: 400 });
      }
      const contactIds = selectedContactIds || [...ownedContactIds];
      const event = {
        id: opaqueId('medication_escalation', `${userId}:${idempotencyKey}`),
        idempotencyKey,
        requestFingerprint,
        status: 'accepted',
        acceptedAt: Date.now(),
        occurredAt: input.occurredAt,
        source: input.source,
        reason: input.reason,
        medicationReference: input.medicationReference,
        contactIds,
        deliveryStatus: typeof notifyEmergencyContacts === 'function' ? 'pending' : 'not_configured',
        expiresAt: safetyEventExpiry(retentionDays)
      };
      accepted = await repository.acceptMedicationEscalation(userId, event);
    }
    if (accepted.requestFingerprint !== requestFingerprint) {
      throw Object.assign(new Error('idempotencyKey was already used for a different escalation'), { statusCode: 409 });
    }
    const deliveryStatus = await deliverContactAlert({
      repository,
      userId,
      accepted,
      contactIds: accepted.contactIds,
      notifyEmergencyContacts,
      claimMethod: 'claimMedicationEscalationDelivery',
      recordMethod: 'recordMedicationEscalationDelivery',
      notification: {
        title: 'VeryLoving caregiver alert',
        body: 'Someone who selected you as an emergency contact may need help with a care task. Open VeryLoving and check on them.',
        data: { type: 'medication_caregiver_escalation', escalation_id: accepted.id }
      },
      initialDeliveryStatus: accepted.deliveryStatus || 'not_configured'
    });
    json(res, 202, {
      id: accepted.id,
      status: accepted.status,
      acceptedAt: accepted.acceptedAt,
      deliveryStatus
    });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/safety-sessions') {
    requireScope(principal, 'safety:write');
    const idempotencyKey = validateIdempotencyKey(body?.idempotencyKey);
    if (!SAFETY_MODES.has(body?.mode)) throw Object.assign(new Error('mode is invalid'), { statusCode: 400 });
    const location = validateLocation(body?.location);
    const requestFingerprint = safetySessionRequestFingerprint({ mode: body.mode, location });
    const session = {
      id: opaqueId('session', `${userId}:${idempotencyKey}`),
      idempotencyKey,
      requestFingerprint,
      mode: body.mode,
      status: body.mode === 'home' ? 'inactive' : 'active',
      startedAt: Date.now(),
      location,
      expiresAt: safetyEventExpiry(retentionDays)
    };
    const accepted = await repository.startSafetySession(userId, session);
    const acceptedFingerprint = accepted.requestFingerprint
      || safetySessionRequestFingerprint(accepted);
    if (acceptedFingerprint !== requestFingerprint) {
      throw Object.assign(new Error('idempotencyKey was already used for a different safety session'), {
        statusCode: 409
      });
    }
    json(res, 201, {
      id: accepted.id,
      idempotencyKey: accepted.idempotencyKey,
      mode: accepted.mode,
      status: accepted.status,
      startedAt: accepted.startedAt,
      location: accepted.location || null
    });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/v1/safety-sessions/current') {
    requireScope(principal, 'safety:read');
    json(res, 200, { session: await repository.getSafetySession(userId) });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/v1/privacy/export') {
    requireScope(principal, 'safety:read');
    const payload = {
      data: privacyCoordinator
        ? await privacyCoordinator.exportUserData(userId)
        : await repository.exportUserData(userId)
    };
    if (!Number.isSafeInteger(privacyExportMaxBytes) || privacyExportMaxBytes < 1024
      || Buffer.byteLength(JSON.stringify(payload)) > privacyExportMaxBytes) {
      throw Object.assign(new Error('Account data export exceeds the synchronous download limit'), {
        statusCode: 413,
        code: 'PRIVACY_EXPORT_DOWNLOAD_LIMIT_EXCEEDED'
      });
    }
    json(res, 200, payload);
    return true;
  }
  if (req.method === 'DELETE' && url.pathname === '/v1/privacy/data') {
    requireScope(principal, 'safety:write');
    if (privacyCoordinator) {
      await privacyCoordinator.deleteUserData(userId, {
        ...(typeof principal?.sid === 'string' ? { recoverySessionId: principal.sid } : {})
      });
    }
    else await repository.deleteUserData(userId);
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }
  return false;
}

module.exports = {
  createDynamoSafetyRepository,
  handleSafetyAPI,
  opaqueId,
  validateContactInput,
  validateMedicalAttachment,
  validateMedicationEscalationInput,
  validateIdempotencyKey,
  validateLocation
};
