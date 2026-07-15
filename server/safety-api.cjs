'use strict';

const crypto = require('node:crypto');

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const SAFETY_MODES = new Set(['home', 'guardian', 'emergency']);

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
      const key = { PK: `USER#${userId}`, SK: `SOS#${event.idempotencyKey}` };
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: { ...key, entity: 'sos', ...event },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }));
        return event;
      } catch (error) {
        if (error?.name !== 'ConditionalCheckFailedException') throw error;
        const existing = await documentClient.send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }));
        return existing.Item;
      }
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
        sosEvents: items.filter((item) => item.entity === 'sos').map(
          ({ id, status, acceptedAt, occurredAt, source, contactIds, location }) => ({
            id, status, acceptedAt, occurredAt, source, contactIds, location: location || null
          })
        )
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

async function handleSafetyAPI({ req, res, url, body, principal, repository, retentionDays = 30, json }) {
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
      // Configure DynamoDB TTL on this attribute. Contacts and the current
      // safety state remain until user deletion; transient SOS telemetry does
      // not persist indefinitely.
      expiresAt: Math.floor((Date.now() + Math.max(1, retentionDays) * 86400000) / 1000)
    };
    const accepted = await repository.acceptSOS(userId, event);
    json(res, 202, { id: accepted.id, status: accepted.status, acceptedAt: accepted.acceptedAt });
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
    json(res, 200, { data: await repository.exportUserData(userId) });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname === '/v1/privacy/data') {
    requireScope(principal, 'safety:write');
    await repository.deleteUserData(userId);
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
  validateIdempotencyKey,
  validateLocation
};
