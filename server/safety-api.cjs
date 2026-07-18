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

function validateLocation(value) {
  if (value === undefined || value === null) return null;
  const latitude = Number(value.latitude ?? value.coords?.latitude);
  const longitude = Number(value.longitude ?? value.coords?.longitude);
  const capturedAt = Number(value.capturedAt ?? value.timestamp ?? value.cachedAt);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw Object.assign(new Error('location is invalid'), { statusCode: 400 });
  }
  if (!Number.isFinite(capturedAt) || Math.abs(Date.now() - capturedAt) > 5 * 60 * 1000) {
    throw Object.assign(new Error('location is stale'), { statusCode: 400 });
  }
  return { latitude, longitude, capturedAt };
}

function validateMedicalAttachment(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1) {
    throw Object.assign(new Error('medicalAttachment is invalid'), { statusCode: 400 });
  }
  const generatedAt = Number(value.generatedAt);
  const consentRecordedAt = Number(value.consentRecordedAt);
  const profileVersion = Number(value.profileVersion);
  if (!Number.isSafeInteger(generatedAt)
    || Math.abs(Date.now() - generatedAt) > 5 * 60 * 1000
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

function createDynamoSafetyRepository({ tableName, region }) {
  if (!tableName) throw new Error('SAFETY_TABLE_NAME is required');
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    BatchWriteCommand,
    DeleteCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
    QueryCommand,
    UpdateCommand
  } = require('@aws-sdk/lib-dynamodb');
  const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
    marshallOptions: { removeUndefinedValues: true }
  });

  async function queryAllUserItems(userId, projectionExpression) {
    const items = [];
    let exclusiveStartKey;
    do {
      const result = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': `USER#${userId}` },
        ...(projectionExpression ? { ProjectionExpression: projectionExpression } : {}),
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      items.push(...(result.Items || []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async function acceptDeliveryEvent(userId, sortPrefix, entity, event) {
    const key = { PK: `USER#${userId}`, SK: `${sortPrefix}#${event.idempotencyKey}` };
    try {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: { ...key, entity, ...event },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      }));
      return event;
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
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
    try {
      const result = await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: `${sortPrefix}#${idempotencyKey}` },
        UpdateExpression: 'SET deliveryAttemptedAt = :attemptedAt',
        ConditionExpression: [
          'attribute_exists(PK)',
          'attribute_exists(SK)',
          '#status = :accepted',
          'deliveryStatus = :pending',
          'attribute_not_exists(deliveryAttemptedAt)'
        ].join(' AND '),
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':accepted': 'accepted',
          ':pending': 'pending',
          ':attemptedAt': Date.now()
        },
        ReturnValues: 'ALL_NEW'
      }));
      return result.Attributes || null;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
  }

  async function recordDeliveryEvent(userId, sortPrefix, idempotencyKey, delivery) {
    if (!CONTACT_DELIVERY_STATUSES.has(delivery?.deliveryStatus) || delivery.deliveryStatus === 'pending') {
      throw new Error('Contact delivery status is invalid');
    }
    const count = (value) => Math.min(10, Math.max(0, Number.isSafeInteger(value) ? value : 0));
    const recordedAt = Date.now();
    const result = await documentClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: `USER#${userId}`, SK: `${sortPrefix}#${idempotencyKey}` },
      UpdateExpression: [
        'SET deliveryStatus = :deliveryStatus',
        'deliveryRecordedAt = :recordedAt',
        'deliveryEligibleCount = :eligibleCount',
        'deliveryDeliveredCount = :deliveredCount',
        'deliveryFailedCount = :failedCount'
      ].join(', '),
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #status = :accepted',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':accepted': 'accepted',
        ':deliveryStatus': delivery.deliveryStatus,
        ':recordedAt': recordedAt,
        ':eligibleCount': count(delivery.eligibleCount),
        ':deliveredCount': count(delivery.deliveredCount),
        ':failedCount': count(delivery.failedCount)
      },
      ReturnValues: 'ALL_NEW'
    }));
    return result.Attributes || null;
  }

  return {
    async listContacts(userId) {
      const result = await documentClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'CONTACT#' },
        ConsistentRead: true
      }));
      return (result.Items || []).map(({ id, name, phone, countryCode, version }) => ({ id, name, phone, countryCode, version }));
    },
    async createContact(userId, contact) {
      const key = { PK: `USER#${userId}`, SK: `CONTACT#${contact.id}` };
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: { ...key, entity: 'contact', ...contact },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }));
        return contact;
      } catch (error) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
        const existing = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
        if (!existing.Item) throw error;
        const { id, name, phone, countryCode, version } = existing.Item;
        return { id, name, phone, countryCode, version };
      }
    },
    async updateContact(userId, contactId, contact, expectedVersion) {
      const key = { PK: `USER#${userId}`, SK: `CONTACT#${contactId}` };
      try {
        const result = await documentClient.send(new UpdateCommand({
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
          },
          ReturnValues: 'ALL_NEW'
        }));
        const { id, name, phone, countryCode, version } = result.Attributes || {};
        return { id, name, phone, countryCode, version };
      } catch (error) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
        const current = await documentClient.send(new GetCommand({
          TableName: tableName,
          Key: key,
          ConsistentRead: true
        }));
        throw Object.assign(
          new Error(current.Item ? 'Emergency contact changed; refresh and try again' : 'Emergency contact not found'),
          { statusCode: current.Item ? 409 : 404 }
        );
      }
    },
    async deleteContact(userId, contactId) {
      await documentClient.send(new DeleteCommand({
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: `CONTACT#${contactId}` }
      }));
    },
    async acceptSOS(userId, event) {
      return acceptDeliveryEvent(userId, 'SOS', 'sos', event);
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
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: { PK: `USER#${userId}`, SK: 'SAFETY#CURRENT', entity: 'safety-state', ...session }
      }));
      return session;
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
      const keys = await queryAllUserItems(userId, 'PK, SK');
      for (let index = 0; index < keys.length; index += 25) {
        let pending = keys.slice(index, index + 25).map((key) => ({
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
      return { deletedItems: keys.length };
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
      await repository[recordMethod]?.(userId, accepted.idempotencyKey, delivery);
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
    const occurredAt = Number(body?.occurredAt);
    if (!Number.isFinite(occurredAt) || Math.abs(Date.now() - occurredAt) > 5 * 60 * 1000) {
      throw Object.assign(new Error('occurredAt is invalid or stale'), { statusCode: 400 });
    }
    const contactIds = Array.isArray(body?.contactIds)
      ? [...new Set(body.contactIds.filter((id) => /^contact_[A-Za-z0-9_-]{24}$/.test(id)))].slice(0, 10)
      : [];
    if (!contactIds.length) throw Object.assign(new Error('At least one emergency contact is required'), { statusCode: 400 });
    const ownedContactIds = new Set((await repository.listContacts(userId)).map((contact) => contact.id));
    if (contactIds.some((contactId) => !ownedContactIds.has(contactId))) {
      throw Object.assign(new Error('An emergency contact is unavailable'), { statusCode: 400 });
    }
    const event = {
      id: opaqueId('sos', `${userId}:${idempotencyKey}`),
      idempotencyKey,
      status: 'accepted',
      acceptedAt: Date.now(),
      occurredAt,
      source: body?.source === 'vl01' ? 'vl01' : 'app',
      contactIds,
      location: validateLocation(body?.location),
      medicalAttachment: validateMedicalAttachment(body?.medicalAttachment),
      deliveryStatus: typeof notifyEmergencyContacts === 'function' ? 'pending' : 'not_configured',
      // Configure DynamoDB TTL on this attribute. Contacts and the current
      // safety state remain until user deletion; transient SOS telemetry does
      // not persist indefinitely.
      expiresAt: safetyEventExpiry(retentionDays)
    };
    const accepted = await repository.acceptSOS(userId, event);
    const deliveryStatus = await deliverContactAlert({
      repository,
      userId,
      accepted,
      contactIds,
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
    const session = {
      id: opaqueId('session', `${userId}:${idempotencyKey}`),
      idempotencyKey,
      mode: body.mode,
      status: body.mode === 'home' ? 'inactive' : 'active',
      startedAt: Date.now(),
      location: validateLocation(body?.location)
    };
    json(res, 201, await repository.startSafetySession(userId, session));
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/v1/safety-sessions/current') {
    requireScope(principal, 'safety:read');
    json(res, 200, { session: await repository.getSafetySession(userId) });
    return true;
  }
  if (req.method === 'GET' && url.pathname === '/v1/privacy/export') {
    requireScope(principal, 'safety:read');
    json(res, 200, {
      data: privacyCoordinator
        ? await privacyCoordinator.exportUserData(userId)
        : await repository.exportUserData(userId)
    });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname === '/v1/privacy/data') {
    requireScope(principal, 'safety:write');
    if (privacyCoordinator) await privacyCoordinator.deleteUserData(userId);
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
