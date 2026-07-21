'use strict';

const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { validateServerIntegerConfig } = require('./environment-schema.cjs');

const DEVICE_TYPES = new Set(['wearable', 'home_robot']);
const ACTIONS = Object.freeze({
  deploy_barrier: new Set(['wearable']),
  emit_alarm: new Set(['wearable']),
  trigger_sos: new Set(['wearable']),
  stop: new Set(['wearable']),
  check_medication: new Set(['home_robot']),
  medication_reminder: new Set(['home_robot']),
  cognitive_engagement: new Set(['home_robot']),
  navigate_to_location: new Set(['home_robot']),
  start_two_way_call: new Set(['home_robot']),
  share_camera_view: new Set(['home_robot']),
  play_soothing_audio: new Set(['home_robot']),
  emergency_stop: new Set(['home_robot'])
});
const WEARABLE_ACTION_NAMES = Object.freeze(['deploy_barrier', 'emit_alarm', 'trigger_sos', 'stop']);
const MANUFACTURER_ACK_ERROR_CODES = new Set([
  'ACK_TIMEOUT',
  'AUTHENTICATION_FAILED',
  'COMMAND_UNSUPPORTED',
  'DEVICE_BUSY',
  'DEVICE_OFFLINE',
  'MANUFACTURER_REJECTED',
  'ROBOT_COMMAND_REJECTED',
  'SAFETY_INTERLOCK_ACTIVE'
]);

function normalizeManufacturerAckErrorCode(value, ok) {
  if (ok === true) return undefined;
  return typeof value === 'string' && MANUFACTURER_ACK_ERROR_CODES.has(value)
    ? value
    : 'ROBOT_COMMAND_REJECTED';
}

function boundedIdentifier(value, maxLength = 128) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]+$/.test(value) && value.length <= maxLength
    ? value
    : undefined;
}

function normalizeActionParameters(action, parameters) {
  if (WEARABLE_ACTION_NAMES.includes(action)) {
    if (Object.keys(parameters).length) {
      throw Object.assign(new Error('Wearable action parameters are server-owned'), { statusCode: 400 });
    }
    return {};
  }
  if (action === 'emergency_stop') {
    if (Object.keys(parameters).length) {
      throw Object.assign(new Error('Emergency stop parameters are invalid'), { statusCode: 400 });
    }
    return {};
  }
  if (action === 'check_medication') {
    const allowed = new Set(['medication_id']);
    if (Object.keys(parameters).some((key) => !allowed.has(key))) {
      throw Object.assign(new Error('Medication check parameters are invalid'), { statusCode: 400 });
    }
    const medicationId = parameters.medication_id === undefined
      ? undefined
      : boundedIdentifier(parameters.medication_id);
    if (parameters.medication_id !== undefined && !medicationId) {
      throw Object.assign(new Error('medication_id is invalid'), { statusCode: 400 });
    }
    return medicationId ? { medication_id: medicationId } : {};
  }
  if (action === 'medication_reminder') {
    const allowed = new Set(['reminder_id', 'medication_id', 'scheduled_at']);
    if (Object.keys(parameters).some((key) => !allowed.has(key))) {
      throw Object.assign(new Error('Medication reminder parameters are invalid'), { statusCode: 400 });
    }
    const reminderId = boundedIdentifier(parameters.reminder_id, 80);
    const medicationId = boundedIdentifier(parameters.medication_id);
    const scheduledAt = Number(parameters.scheduled_at);
    if (
      !reminderId
      || !/^[A-Za-z0-9_-]{16,80}$/.test(reminderId)
      || !medicationId
      || !Number.isSafeInteger(scheduledAt)
      || scheduledAt <= 0
    ) {
      throw Object.assign(new Error('Medication reminder parameters are invalid'), { statusCode: 400 });
    }
    return { reminder_id: reminderId, medication_id: medicationId, scheduled_at: scheduledAt };
  }
  if (action === 'cognitive_engagement') {
    if (Object.keys(parameters).some((key) => key !== 'activity') || !['conversation', 'memory_game', 'music'].includes(parameters.activity)) {
      throw Object.assign(new Error('Cognitive engagement parameters are invalid'), { statusCode: 400 });
    }
    return { activity: parameters.activity };
  }
  if (action === 'navigate_to_location') {
    if (Object.keys(parameters).some((key) => key !== 'location_ref')) {
      throw Object.assign(new Error('Navigation parameters are invalid'), { statusCode: 400 });
    }
    const locationRef = boundedIdentifier(parameters.location_ref, 96);
    if (!locationRef) throw Object.assign(new Error('Navigation parameters are invalid'), { statusCode: 400 });
    return { location_ref: locationRef };
  }
  if (action === 'start_two_way_call') {
    if (Object.keys(parameters).some((key) => key !== 'contact_id')) {
      throw Object.assign(new Error('Two-way call parameters are invalid'), { statusCode: 400 });
    }
    const contactId = boundedIdentifier(parameters.contact_id, 96);
    if (!contactId) throw Object.assign(new Error('Two-way call parameters are invalid'), { statusCode: 400 });
    return { contact_id: contactId };
  }
  if (action === 'share_camera_view') {
    if (Object.keys(parameters).some((key) => key !== 'session_id')) {
      throw Object.assign(new Error('Camera sharing parameters are invalid'), { statusCode: 400 });
    }
    const sessionId = boundedIdentifier(parameters.session_id, 128);
    if (!sessionId) throw Object.assign(new Error('Camera sharing parameters are invalid'), { statusCode: 400 });
    return { session_id: sessionId };
  }
  if (action === 'play_soothing_audio') {
    if (Object.keys(parameters).some((key) => !['audio_id', 'volume'].includes(key))) {
      throw Object.assign(new Error('Soothing audio parameters are invalid'), { statusCode: 400 });
    }
    const audioId = boundedIdentifier(parameters.audio_id, 96);
    const volume = Number(parameters.volume);
    if (!audioId || !Number.isSafeInteger(volume) || volume < 0 || volume > 100) {
      throw Object.assign(new Error('Soothing audio parameters are invalid'), { statusCode: 400 });
    }
    return { audio_id: audioId, volume };
  }
  return {};
}

function parseWearableCommandPayloads(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new Error('WEARABLE_COMMAND_PAYLOADS_JSON must be valid JSON'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result = {};
  for (const action of WEARABLE_ACTION_NAMES) {
    const payload = parsed[action];
    if (payload === undefined) continue;
    if (typeof payload !== 'string' || !payload || payload.length > 1024 || payload.length % 4 === 1 || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(payload)) {
      throw new Error(`Wearable command payload for ${action} is invalid`);
    }
    const bytes = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (!bytes.length || bytes.length > 512) throw new Error(`Wearable command payload for ${action} is invalid`);
    result[action] = payload;
  }
  return result;
}

function redactSerial(serial) {
  if (!serial) return '[redacted]';
  return `serial_${crypto.createHash('sha256').update(String(serial)).digest('hex').slice(0, 10)}`;
}

function validateAction(input) {
  const action = typeof input?.action === 'string' ? input.action : '';
  const deviceType = input?.device_type;
  if (!ACTIONS[action] || !DEVICE_TYPES.has(deviceType) || !ACTIONS[action].has(deviceType)) {
    throw Object.assign(new Error('Action is not allowed for this device type'), { statusCode: 400 });
  }
  const deviceId = typeof input.device_id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(input.device_id)
    ? input.device_id : null;
  if (!deviceId) throw Object.assign(new Error('device_id is invalid'), { statusCode: 400 });
  const rawParameters = input.parameters && typeof input.parameters === 'object' && !Array.isArray(input.parameters)
    ? input.parameters : {};
  if (Buffer.byteLength(JSON.stringify(rawParameters)) > 16 * 1024) {
    throw Object.assign(new Error('Action parameters are too large'), { statusCode: 413 });
  }
  const parameters = normalizeActionParameters(action, rawParameters);
  const idempotencyKey = input.idempotency_key === undefined
    ? undefined
    : boundedIdentifier(input.idempotency_key, 160);
  if (input.idempotency_key !== undefined && !idempotencyKey) {
    throw Object.assign(new Error('idempotency_key is invalid'), { statusCode: 400 });
  }
  return {
    action,
    device_type: deviceType,
    device_id: deviceId,
    parameters,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {})
  };
}

function createEd25519PrivateKey(value) {
  if (!value) throw new Error('ACTION_SIGNING_PRIVATE_KEY is not configured');
  let key;
  try {
    if (typeof value !== 'string' || value.includes('BEGIN PRIVATE KEY')) {
      key = crypto.createPrivateKey(typeof value === 'string' ? value.replace(/\\n/g, '\n') : value);
    } else {
      key = crypto.createPrivateKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'pkcs8' });
    }
  } catch {
    throw new Error('ACTION_SIGNING_PRIVATE_KEY must be an Ed25519 PKCS8 key');
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('ACTION_SIGNING_PRIVATE_KEY must be an Ed25519 key');
  return key;
}

function deriveEd25519PublicKey(privateKey) {
  const der = crypto.createPublicKey(createEd25519PrivateKey(privateKey)).export({ format: 'der', type: 'spki' });
  return Buffer.from(der).subarray(-32).toString('base64url');
}

function deterministicActionId(userId, action) {
  if (!action.idempotency_key) return undefined;
  const identity = action.device_type === 'home_robot'
    ? [
        'veryloving-robot-action-id-v2',
        String(userId),
        action.device_type,
        action.device_id,
        action.binding_epoch,
        action.action,
        action.idempotency_key
      ]
    : [String(userId), action.device_type, action.device_id, action.action, action.idempotency_key];
  const bytes = crypto.createHash('sha256').update(JSON.stringify(identity)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function actionRequestFingerprint(userId, action) {
  return crypto.createHash('sha256').update(JSON.stringify([
    'veryloving-action-request-v2',
    String(userId),
    action.device_type,
    action.device_id,
    action.action,
    action.parameters,
    action.manufacturer_device_id || null,
    action.adapter_id || null,
    action.binding_epoch || null,
    action.contract_version || null,
    action.idempotency_key || null
  ])).digest('base64url');
}

function signEnvelope(action, privateKey, now = Date.now, actionId = crypto.randomUUID()) {
  const signingKey = createEd25519PrivateKey(privateKey);
  if (!ACTION_ID_PATTERN.test(actionId)) throw new Error('Action id is invalid');
  const envelope = { version: 1, id: actionId, issued_at: now(), ...action };
  const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(payload, 'ascii'), signingKey).toString('base64url');
  return { envelope, payload, signature, algorithm: 'Ed25519' };
}

const ROBOT_FAILURE_MESSAGE = 'Robot command failed. Please check your robot\'s network connection.';

const DEFAULT_OUTBOX_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ROBOT_ACTION_TTL_MS = 60 * 1000;
const MAX_STRONG_PRIVACY_MUTATION_PASSES = 5;
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPositiveBindingEpoch(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isExplicitlyActiveBinding(binding) {
  return binding?.active === true
    || binding?.state === 'active'
    || binding?.lifecycleState === 'active';
}

function bindingFencedError() {
  return Object.assign(new Error('Robot binding is no longer active'), {
    statusCode: 409,
    code: 'BINDING_FENCED'
  });
}

function accountFencedError() {
  return Object.assign(new Error('Account actions are disabled'), {
    statusCode: 409,
    code: 'ACCOUNT_FENCED'
  });
}

function actionCancelledError(message = 'Action was cancelled', { mayHaveBeenSent = false } = {}) {
  return Object.assign(new Error(message), {
    statusCode: 409,
    code: 'ACTION_CANCELLED',
    // Transport cancellation only stops local work. Once bytes have been
    // written, it cannot retract a command already received by hardware.
    nonRetractable: mayHaveBeenSent
  });
}

function throwIfActionCancelled(signal, message, options) {
  if (signal?.aborted) throw actionCancelledError(message, options);
}

function accountFenceKey(userId) {
  return crypto.createHash('sha256').update('veryloving-action-fence-v1\0').update(String(userId)).digest('base64url');
}

function createDynamoActionOutboxRepository({ tableName, region, client: injectedClient, userIndexName, retentionSeconds = DEFAULT_OUTBOX_RETENTION_SECONDS } = {}) {
  if (!tableName) throw new Error('Action outbox table is required');
  let client = injectedClient;
  let commands;
  if (!client) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
    commands = { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand };
  } else {
    const { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    commands = { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand };
  }

  const key = (actionId) => ({ PK: `ACTION#${actionId}`, SK: 'OUTBOX' });
  const isConditionalFailure = (error) => error?.name === 'ConditionalCheckFailedException';

  async function transition(actionId, state, attributes = {}, expectedStates = [], {
    expectedAdapterId,
    expectedBindingEpoch,
    expectedUserId,
    expectedDeviceId,
    expectedLeaseOwner,
    returnCurrentOnCondition = false
  } = {}) {
    if (!ACTION_ID_PATTERN.test(actionId || '')) throw new Error('Outbox action id is invalid');
    const entries = Object.entries({ state, updated_at: Date.now(), ...attributes })
      .filter(([, value]) => value !== undefined);
    const names = {};
    const values = {};
    const assignments = entries.map(([name, value], index) => {
      names[`#field${index}`] = name;
      values[`:value${index}`] = value;
      return `#field${index} = :value${index}`;
    });
    let condition = 'attribute_exists(PK)';
    if (expectedStates.length) {
      names['#currentState'] = 'state';
      const expected = expectedStates.map((value, index) => {
        values[`:expected${index}`] = value;
        return `:expected${index}`;
      });
      condition += ` AND #currentState IN (${expected.join(', ')})`;
    }
    if (expectedAdapterId !== undefined) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(expectedAdapterId)) {
        throw new Error('Outbox adapter id is invalid');
      }
      names['#expectedAdapterId'] = 'adapter_id';
      values[':expectedAdapterId'] = expectedAdapterId;
      condition += ' AND #expectedAdapterId = :expectedAdapterId';
    }
    if (expectedBindingEpoch !== undefined) {
      if (!isPositiveBindingEpoch(expectedBindingEpoch)) {
        throw new Error('Outbox binding epoch is invalid');
      }
      names['#expectedBindingEpoch'] = 'binding_epoch';
      values[':expectedBindingEpoch'] = expectedBindingEpoch;
      condition += ' AND #expectedBindingEpoch = :expectedBindingEpoch';
    }
    if (expectedUserId !== undefined) {
      names['#expectedUserId'] = 'user_id';
      values[':expectedUserId'] = String(expectedUserId);
      condition += ' AND #expectedUserId = :expectedUserId';
    }
    if (expectedDeviceId !== undefined) {
      names['#expectedDeviceId'] = 'device_id';
      values[':expectedDeviceId'] = String(expectedDeviceId);
      condition += ' AND #expectedDeviceId = :expectedDeviceId';
    }
    if (expectedLeaseOwner !== undefined) {
      if (!boundedIdentifier(expectedLeaseOwner, 128)) throw new Error('Outbox lease owner is invalid');
      names['#expectedLeaseOwner'] = 'lease_owner';
      values[':expectedLeaseOwner'] = expectedLeaseOwner;
      condition += ' AND #expectedLeaseOwner = :expectedLeaseOwner';
    }
    try {
      const result = await client.send(new commands.UpdateCommand({
        TableName: tableName,
        Key: key(actionId),
        UpdateExpression: `SET ${assignments.join(', ')}`,
        ConditionExpression: condition,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW'
      }));
      return result.Attributes || true;
    } catch (error) {
      if (isConditionalFailure(error)) {
        if (!returnCurrentOnCondition) return false;
        const current = await client.send(new commands.GetCommand({
          TableName: tableName,
          Key: key(actionId),
          ConsistentRead: true
        }));
        return current.Item || false;
      }
      throw error;
    }
  }

  async function scanForUser(userId, projectionExpression, expressionAttributeNames, {
    requireStrongBaseTableRead = false
  } = {}) {
    const records = [];
    let exclusiveStartKey;
    do {
      // DynamoDB GSIs are eventually consistent. They are appropriate for
      // exports, but a privacy fence/delete must not miss an action that was
      // committed to the base table before the index caught up.
      const result = userIndexName && !requireStrongBaseTableRead
        ? await client.send(new commands.QueryCommand({
            TableName: tableName,
            IndexName: userIndexName,
            KeyConditionExpression: 'user_index_pk = :userId',
            ExpressionAttributeValues: { ':userId': `USER#${userId}` },
            ProjectionExpression: projectionExpression,
            ...(expressionAttributeNames ? { ExpressionAttributeNames: expressionAttributeNames } : {}),
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
          }))
        : await client.send(new commands.ScanCommand({
            TableName: tableName,
            ...(requireStrongBaseTableRead ? { ConsistentRead: true } : {}),
            FilterExpression: '#entity = :entity AND user_id = :userId',
            ExpressionAttributeNames: { '#entity': 'entity', ...(expressionAttributeNames || {}) },
            ExpressionAttributeValues: { ':entity': 'device-action-outbox', ':userId': userId },
            ProjectionExpression: projectionExpression,
            ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
          }));
      records.push(...(result.Items || []));
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return records;
  }

  return {
    async getAction(actionId) {
      if (!ACTION_ID_PATTERN.test(actionId || '')) throw new Error('Outbox action id is invalid');
      const result = await client.send(new commands.GetCommand({
        TableName: tableName,
        Key: key(actionId),
        ConsistentRead: true
      }));
      return result.Item;
    },
    async enqueue(record) {
      if (!ACTION_ID_PATTERN.test(record?.action_id || '')) throw new Error('Outbox action id is invalid');
      if (record?.device_type === 'home_robot' && !isPositiveBindingEpoch(record.binding_epoch)) {
        throw new Error('Outbox binding epoch is invalid');
      }
      const createdAt = Number.isFinite(record.created_at) ? record.created_at : Date.now();
      try {
        await client.send(new commands.PutCommand({
          TableName: tableName,
          Item: {
            ...key(record.action_id),
            entity: 'device-action-outbox',
            state: 'queued',
            created_at: createdAt,
            updated_at: createdAt,
            expiresAt: Math.floor(createdAt / 1000) + retentionSeconds,
            user_index_pk: `USER#${record.user_id}`,
            user_index_sk: `ACTION#${String(createdAt).padStart(16, '0')}#${record.action_id}`,
            ...record
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }));
        return record;
      } catch (error) {
        if (isConditionalFailure(error)) {
          const existing = await client.send(new commands.GetCommand({
            TableName: tableName,
            Key: key(record.action_id),
            ConsistentRead: true
          }));
          return existing.Item ? { duplicate: true, record: existing.Item } : false;
        }
        throw error;
      }
    },
    async markDelivering(actionId, details = {}) {
      const leaseOwner = boundedIdentifier(details.lease_owner, 128);
      const leaseNow = Number(details.lease_now);
      const leaseExpiresAt = Number(details.lease_expires_at);
      if (!leaseOwner || !Number.isSafeInteger(leaseNow) || !Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt <= leaseNow) {
        throw new Error('Outbox delivery lease is invalid');
      }
      const attributes = Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'lease_now'));
      const entries = Object.entries({ state: 'delivering', updated_at: Date.now(), ...attributes })
        .filter(([, value]) => value !== undefined);
      const names = { '#state': 'state', '#leaseOwner': 'lease_owner', '#leaseExpiresAt': 'lease_expires_at' };
      const values = {
        ':queued': 'queued',
        ':delivering': 'delivering',
        ':leaseOwner': leaseOwner,
        ':leaseNow': leaseNow
      };
      const assignments = entries.map(([name, value], index) => {
        names[`#field${index}`] = name;
        values[`:value${index}`] = value;
        return `#field${index} = :value${index}`;
      });
      try {
        const result = await client.send(new commands.UpdateCommand({
          TableName: tableName,
          Key: key(actionId),
          UpdateExpression: `SET ${assignments.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK) AND (#state = :queued OR (#state = :delivering AND (#leaseOwner = :leaseOwner OR attribute_not_exists(#leaseExpiresAt) OR #leaseExpiresAt < :leaseNow)))',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW'
        }));
        return result.Attributes || true;
      } catch (error) {
        if (isConditionalFailure(error)) return false;
        throw error;
      }
    },
    markPendingAck(actionId, details = {}) {
      const { lease_owner: leaseOwner, ...attributes } = details;
      return transition(actionId, 'pending_ack', attributes, ['delivering'], {
        expectedLeaseOwner: leaseOwner,
        returnCurrentOnCondition: true
      });
    },
    markDelivered(actionId, details = {}) {
      const { lease_owner: leaseOwner, ...attributes } = details;
      return transition(actionId, 'delivered', attributes, ['delivering'], {
        expectedLeaseOwner: leaseOwner
      });
    },
    markFailed(actionId, details = {}) {
      const { lease_owner: leaseOwner, ...attributes } = details;
      return transition(actionId, 'failed', attributes, ['queued', 'delivering', 'pending_ack'], {
        expectedLeaseOwner: leaseOwner
      });
    },
    markQueuedFailed(actionId, details = {}) {
      return transition(actionId, 'failed', details, ['queued']);
    },
    acknowledge(actionId, {
      ok,
      acknowledged_at: acknowledgedAt = Date.now(),
      error_code: errorCode,
      adapter_id: adapterId,
      binding_epoch: bindingEpoch,
      camera_ready: cameraReady,
      camera_session_ref: cameraSessionRef
    } = {}) {
      if (typeof adapterId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)) {
        throw new Error('Outbox adapter id is invalid');
      }
      if (!isPositiveBindingEpoch(bindingEpoch)) throw new Error('Outbox binding epoch is invalid');
      return transition(actionId, ok === true ? 'delivered' : 'failed', {
        acknowledged_at: acknowledgedAt,
        error_code: errorCode,
        ...(typeof cameraReady === 'boolean' ? { camera_ready: cameraReady } : {}),
        ...(boundedIdentifier(cameraSessionRef, 128) ? { camera_session_ref: cameraSessionRef } : {})
      }, ['queued', 'delivering', 'pending_ack'], {
        expectedAdapterId: adapterId,
        expectedBindingEpoch: bindingEpoch
      });
    },
    expirePendingAck(actionId, {
      expired_at: expiredAt = Date.now(),
      error_code: errorCode = 'ACK_TIMEOUT',
      binding_epoch: bindingEpoch
    } = {}) {
      return transition(actionId, 'failed', {
        acknowledged_at: expiredAt,
        error_code: errorCode
      }, ['pending_ack'], { expectedBindingEpoch: bindingEpoch });
    },
    async listPending({ limit = 1000, cursor } = {}) {
      const records = [];
      let exclusiveStartKey = cursor;
      do {
        const result = await client.send(new commands.ScanCommand({
          TableName: tableName,
          FilterExpression: '#entity = :entity AND #state IN (:queued, :delivering, :pendingAck)',
          ExpressionAttributeNames: { '#entity': 'entity', '#state': 'state' },
          ExpressionAttributeValues: {
            ':entity': 'device-action-outbox',
            ':queued': 'queued',
            ':delivering': 'delivering',
            ':pendingAck': 'pending_ack'
          },
          Limit: Math.max(1, limit - records.length),
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        records.push(...(result.Items || []));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey && records.length < limit);
      return { records, nextCursor: exclusiveStartKey };
    },
    async failPendingForBinding(userId, deviceId, bindingEpoch, {
      failed_at: failedAt = Date.now(),
      error_code: errorCode = 'BINDING_FENCED'
    } = {}) {
      if (!isPositiveBindingEpoch(bindingEpoch)) throw new Error('Outbox binding epoch is invalid');
      const records = await scanForUser(
        String(userId),
        'action_id, device_id, binding_epoch, #state',
        { '#state': 'state' }
      );
      let failed = 0;
      for (const record of records) {
        if (
          record.device_id !== deviceId
          || record.binding_epoch !== bindingEpoch
          || !['queued', 'delivering', 'pending_ack'].includes(record.state)
          || !ACTION_ID_PATTERN.test(record.action_id || '')
        ) continue;
        const transitioned = await transition(record.action_id, 'failed', {
          failed_at: failedAt,
          error_code: errorCode
        }, ['queued', 'delivering', 'pending_ack'], {
          expectedBindingEpoch: bindingEpoch,
          expectedUserId: userId,
          expectedDeviceId: deviceId
        });
        if (transitioned !== false) failed += 1;
      }
      return { failed };
    },
    async failPendingForUser(userId, {
      failed_at: failedAt = Date.now(),
      error_code: errorCode = 'ACCOUNT_FENCED'
    } = {}) {
      let failed = 0;
      for (let pass = 0; pass < MAX_STRONG_PRIVACY_MUTATION_PASSES; pass += 1) {
        const records = await scanForUser(
          String(userId),
          'action_id, #state',
          { '#state': 'state' },
          { requireStrongBaseTableRead: true }
        );
        const pending = records.filter((record) => (
          ['queued', 'delivering', 'pending_ack'].includes(record.state)
          && ACTION_ID_PATTERN.test(record.action_id || '')
        ));
        if (!pending.length) return { failed };
        for (const record of pending) {
          const transitioned = await transition(record.action_id, 'failed', {
            failed_at: failedAt,
            error_code: errorCode
          }, ['queued', 'delivering', 'pending_ack'], { expectedUserId: userId });
          if (transitioned !== false) failed += 1;
        }
      }
      throw new Error('Account actions could not be fully fenced');
    },
    async exportUserData(userId) {
      return scanForUser(
        userId,
        'action_id, device_id, device_type, binding_epoch, #action, #state, created_at, updated_at, acknowledged_at, error_code, camera_ready, camera_session_ref',
        { '#action': 'action', '#state': 'state' }
      );
    },
    async deleteUserData(userId) {
      let deletedItems = 0;
      for (let pass = 0; pass < MAX_STRONG_PRIVACY_MUTATION_PASSES; pass += 1) {
        const keys = await scanForUser(
          userId,
          'PK, SK',
          undefined,
          { requireStrongBaseTableRead: true }
        );
        if (!keys.length) return { deletedItems };
        for (let offset = 0; offset < keys.length; offset += 25) {
          let pending = keys.slice(offset, offset + 25).map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } }));
          for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
            const result = await client.send(new commands.BatchWriteCommand({ RequestItems: { [tableName]: pending } }));
            pending = result.UnprocessedItems?.[tableName] || [];
          }
          if (pending.length) throw new Error('Device actions could not be fully deleted');
          deletedItems += keys.slice(offset, offset + 25).length;
        }
      }
      throw new Error('Device actions could not be fully deleted');
    }
  };
}

class ActionGateway {
  constructor({
    signingPrivateKey,
    signingSecret,
    wearableCommandPayloads,
    manufacturerWebhookURL,
    manufacturerApiKey,
    fetchImpl = globalThis.fetch,
    retries = 3,
    retryDelayMs = 500,
    requestTimeoutMs = 5000,
    transportFenceTimeoutMs,
    robotAckTimeoutMs = 30000,
    wearableAckTimeoutMs = 5000,
    maxQueueDepthPerDevice = 25,
    maxPendingRobotCommands = 1000,
    maxPendingWearableAcks = 100,
    sleep,
    notifyUser,
    authorizeDevice,
    resolveManufacturerDeviceId,
    resolveRobotBinding,
    isRobotBindingActive,
    isAccountActionAllowed,
    requireBoundRobotResolver = false,
    getDeviceStatus,
    robotAdapterRuntime,
    scenarioEngine,
    outboxRepository,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    outcomeSetTimeoutImpl = setTimeout,
    outcomeClearTimeoutImpl = clearTimeout,
    monotonicNow = () => performance.now(),
    deliveryWorkerId = crypto.randomUUID(),
    now = Date.now,
    robotActionTTLms = DEFAULT_ROBOT_ACTION_TTL_MS,
    logger = console
  } = {}) {
    this.signingPrivateKey = signingPrivateKey || signingSecret;
    this.wearableCommandPayloads = parseWearableCommandPayloads(wearableCommandPayloads);
    this.manufacturerWebhookURL = manufacturerWebhookURL;
    this.manufacturerApiKey = manufacturerApiKey;
    this.fetchImpl = fetchImpl;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    validateServerIntegerConfig({
      actionRequestTimeoutMs: requestTimeoutMs,
      robotAckTimeoutMs,
      wearableAckTimeoutMs
    });
    this.requestTimeoutMs = requestTimeoutMs;
    const selectedFenceTimeout = transportFenceTimeoutMs === undefined
      ? Math.max(1000, Math.min(30000, Number(requestTimeoutMs) || 5000))
      : Number(transportFenceTimeoutMs);
    if (!Number.isSafeInteger(selectedFenceTimeout) || selectedFenceTimeout < 1 || selectedFenceTimeout > 30000) {
      throw new Error('Transport fence timeout is invalid');
    }
    this.transportFenceTimeoutMs = selectedFenceTimeout;
    this.robotAckTimeoutMs = robotAckTimeoutMs;
    this.wearableAckTimeoutMs = wearableAckTimeoutMs;
    this.maxQueueDepthPerDevice = maxQueueDepthPerDevice;
    this.maxPendingRobotCommands = maxPendingRobotCommands;
    this.maxPendingWearableAcks = maxPendingWearableAcks;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.logger = logger;
    this.notifyUser = notifyUser;
    this.authorizeDevice = authorizeDevice;
    this.resolveManufacturerDeviceId = resolveManufacturerDeviceId;
    this.resolveRobotBinding = resolveRobotBinding;
    this.isRobotBindingActive = isRobotBindingActive;
    this.isAccountActionAllowed = isAccountActionAllowed;
    this.requireBoundRobotResolver = requireBoundRobotResolver;
    this.getDeviceStatus = getDeviceStatus;
    this.robotAdapterRuntime = robotAdapterRuntime;
    this.scenarioEngine = scenarioEngine;
    this.outboxRepository = outboxRepository;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.outcomeSetTimeoutImpl = outcomeSetTimeoutImpl;
    this.outcomeClearTimeoutImpl = outcomeClearTimeoutImpl;
    this.monotonicNow = monotonicNow;
    if (!boundedIdentifier(deliveryWorkerId, 128)) throw new Error('Robot delivery worker id is invalid');
    this.deliveryWorkerId = deliveryWorkerId;
    this.now = now;
    this.robotActionTTLms = Math.max(5_000, Math.min(5 * 60 * 1000, Number(robotActionTTLms) || DEFAULT_ROBOT_ACTION_TTL_MS));
    this.sessions = new Map();
    this.deliveryQueues = new Map();
    this.deliveryQueueDepths = new Map();
    this.totalRobotCommands = 0;
    this.pendingDeliveries = new Set();
    this.pendingRobotDeliveries = new Map();
    this.pendingRobotTransports = new Map();
    this.trackedTransportOperations = new WeakSet();
    this.pendingRobotAcks = new Map();
    this.pendingWearableAcks = new Map();
    this.robotActionOwners = new Map();
    this.robotActionOutcomes = new Map();
    this.robotOutcomeWaiters = new Map();
    this.fencedRobotBindings = new Set();
    this.fencedUserActions = new Set();
    this.recoveryPromise = Promise.resolve({ recovered: 0 });
    this.recoveryStarted = false;
    this.recoveryDeferred = false;
    this.recoveryScheduled = false;
    this.recoveryTimer = undefined;
    this.recoveryDueAt = Number.POSITIVE_INFINITY;
    this.recoveryCursor = undefined;
  }

  registerSession(userId, channel, devices = []) {
    const session = { channel, devices: new Map(devices.map((device) => [device.device_id, device])) };
    const previous = this.sessions.get(userId);
    if (previous && previous !== session) this.rejectWearableAcksForSession(userId, previous.channel, 'Wearable session was replaced');
    this.sessions.set(userId, session);
    return () => {
      if (this.sessions.get(userId) !== session) return;
      this.sessions.delete(userId);
      this.rejectWearableAcksForSession(userId, channel, 'Wearable session disconnected');
    };
  }

  updateSessionDevices(userId, channel, devices = []) {
    const session = this.sessions.get(userId);
    if (!session || session.channel !== channel || !Array.isArray(devices)) return false;
    session.devices = new Map(devices.slice(0, 20).flatMap((device) => (
      typeof device?.device_id === 'string'
      && /^[A-Za-z0-9._:-]{1,128}$/.test(device.device_id)
      && DEVICE_TYPES.has(device.device_type)
        ? [[device.device_id, {
            device_id: device.device_id,
            device_type: device.device_type,
            online: device.online === true
          }]]
        : []
    )));
    return true;
  }

  rejectWearableAcksForSession(userId, channel, message) {
    for (const [actionId, pending] of this.pendingWearableAcks) {
      if (pending.userId !== userId || pending.channel !== channel) continue;
      this.pendingWearableAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      pending.cleanup?.();
      pending.reject(Object.assign(new Error(message), { statusCode: 409, code: 'WEARABLE_SESSION_CLOSED' }));
    }
  }

  rejectWearableAcksForUser(userId) {
    let cancelled = 0;
    for (const [actionId, pending] of this.pendingWearableAcks) {
      if (String(pending.userId) !== String(userId)) continue;
      this.pendingWearableAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      pending.cleanup?.();
      pending.reject(Object.assign(accountFencedError(), {
        nonRetractable: pending.sent === true
      }));
      cancelled += 1;
    }
    return cancelled;
  }

  acknowledgeWearable(userId, channel, acknowledgement = {}) {
    const pending = this.pendingWearableAcks.get(acknowledgement.action_id);
    if (!pending || pending.userId !== userId || pending.channel !== channel || typeof acknowledgement.ok !== 'boolean') return false;
    this.pendingWearableAcks.delete(acknowledgement.action_id);
    this.clearTimeoutImpl(pending.timer);
    pending.cleanup?.();
    if (acknowledgement.ok) {
      pending.resolve({ status: 'delivered', action_id: acknowledgement.action_id });
    } else {
      const errorCode = typeof acknowledgement.error_code === 'string'
        ? acknowledgement.error_code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
        : 'WEARABLE_COMMAND_REJECTED';
      pending.reject(Object.assign(new Error('Wearable rejected the command'), { statusCode: 502, code: errorCode }));
    }
    return true;
  }

  async routeWearable(userId, session, signed, signal) {
    throwIfActionCancelled(signal, 'Wearable command was cancelled before dispatch');
    if (!session.channel || session.channel.readyState !== 1) {
      throw Object.assign(new Error('Wearable channel is unavailable'), { statusCode: 409 });
    }
    if (this.pendingWearableAcks.size >= this.maxPendingWearableAcks) {
      throw Object.assign(new Error('Wearable acknowledgement capacity is full'), { statusCode: 429 });
    }
    let resolveAck;
    let rejectAck;
    const result = new Promise((resolve, reject) => { resolveAck = resolve; rejectAck = reject; });
    const actionId = signed.envelope.id;
    const pending = {
      userId,
      channel: session.channel,
      resolve: resolveAck,
      reject: rejectAck,
      timer: null,
      sent: false,
      cleanup: null
    };
    const onAbort = () => {
      if (this.pendingWearableAcks.get(actionId) !== pending) return;
      this.pendingWearableAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      pending.cleanup?.();
      rejectAck(actionCancelledError('Wearable command wait was cancelled', {
        mayHaveBeenSent: pending.sent
      }));
    };
    pending.cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    pending.timer = this.setTimeoutImpl(() => {
      if (this.pendingWearableAcks.get(actionId) !== pending) return;
      this.pendingWearableAcks.delete(actionId);
      pending.cleanup?.();
      rejectAck(Object.assign(new Error('Wearable acknowledgement timed out'), { statusCode: 504, code: 'WEARABLE_ACK_TIMEOUT' }));
    }, this.wearableAckTimeoutMs);
    this.pendingWearableAcks.set(actionId, pending);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return result;
    }
    try {
      // Set conservatively before invoking the transport: an exception or
      // cancellation cannot prove that no bytes reached the peer.
      pending.sent = true;
      session.channel.send(JSON.stringify({ type: 'device_action', ...signed }));
    } catch (error) {
      if (this.pendingWearableAcks.get(actionId) === pending) {
        this.pendingWearableAcks.delete(actionId);
        this.clearTimeoutImpl(pending.timer);
        pending.cleanup?.();
      }
      if (error?.code === 'ACTION_CANCELLED') throw error;
      throw Object.assign(new Error('Wearable channel send failed'), { statusCode: 409, cause: error });
    }
    return result;
  }

  queueKey(userId, deviceId, bindingEpoch) {
    if (!isPositiveBindingEpoch(bindingEpoch)) throw new Error('Robot binding epoch is invalid');
    return JSON.stringify([String(userId), String(deviceId), bindingEpoch]);
  }

  bindingKey(userId, deviceId, bindingEpoch) {
    return this.queueKey(userId, deviceId, bindingEpoch);
  }

  async assertAccountActionAllowed(userId) {
    if (this.fencedUserActions.has(accountFenceKey(userId))) throw accountFencedError();
    if (!this.isAccountActionAllowed) return true;
    if (await this.isAccountActionAllowed(userId) !== true) throw accountFencedError();
    return true;
  }

  async assertRobotBindingActive(userId, signed) {
    const envelope = signed?.envelope;
    const bindingEpoch = envelope?.binding_epoch;
    const context = {
      adapterId: envelope?.adapter_id,
      manufacturerDeviceId: envelope?.manufacturer_device_id
    };
    if (
      envelope?.version !== 2
      || envelope?.contract_version !== 'vl-robot-action/2'
      || envelope?.device_type !== 'home_robot'
      || !/^[A-Za-z0-9._:-]{1,128}$/.test(envelope?.device_id || '')
      || !boundedIdentifier(context.manufacturerDeviceId)
      || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(context.adapterId || '')
      || !isPositiveBindingEpoch(bindingEpoch)
    ) {
      throw bindingFencedError();
    }
    const key = this.bindingKey(userId, envelope.device_id, bindingEpoch);
    if (this.fencedRobotBindings.has(key)) throw bindingFencedError();

    if (this.isRobotBindingActive) {
      const active = await this.isRobotBindingActive(userId, envelope.device_id, {
        bindingEpoch,
        ...context,
        lifecycleState: 'active'
      });
      if (active !== true) throw bindingFencedError();
      return true;
    }
    if (!this.resolveRobotBinding) {
      throw Object.assign(new Error('Robot binding validator is not configured'), {
        statusCode: 503,
        code: 'ROBOT_BINDING_VALIDATOR_UNAVAILABLE'
      });
    }
    const current = await this.resolveRobotBinding(userId, envelope.device_id);
    if (
      !isExplicitlyActiveBinding(current)
      || current?.bindingEpoch !== bindingEpoch
      || current?.adapterId !== context.adapterId
      || current?.manufacturerDeviceId !== context.manufacturerDeviceId
    ) throw bindingFencedError();
    return true;
  }

  reserveRobotSlot(queueKey) {
    const depth = this.deliveryQueueDepths.get(queueKey) || 0;
    if (depth >= this.maxQueueDepthPerDevice || this.totalRobotCommands >= this.maxPendingRobotCommands) {
      throw Object.assign(new Error('Robot command queue is full'), { statusCode: 429 });
    }
    this.deliveryQueueDepths.set(queueKey, depth + 1);
    this.totalRobotCommands += 1;
  }

  releaseRobotSlot(queueKey) {
    const depth = this.deliveryQueueDepths.get(queueKey) || 0;
    if (depth <= 1) this.deliveryQueueDepths.delete(queueKey);
    else this.deliveryQueueDepths.set(queueKey, depth - 1);
    if (depth > 0) this.totalRobotCommands = Math.max(0, this.totalRobotCommands - 1);
    if (depth > 0 && this.recoveryDeferred) this.scheduleDeferredRecovery();
  }

  scheduleDeferredRecovery(delayMs = 0) {
    if (!this.recoveryDeferred) return;
    const boundedDelay = Math.max(0, Math.min(5 * 60_000, Number(delayMs) || 0));
    const dueAt = this.monotonicNow() + boundedDelay;
    if (this.recoveryScheduled && dueAt >= this.recoveryDueAt) return;
    if (this.recoveryScheduled) this.clearTimeoutImpl(this.recoveryTimer);
    this.recoveryScheduled = true;
    this.recoveryDueAt = dueAt;
    const timer = this.setTimeoutImpl(() => {
      this.recoveryScheduled = false;
      this.recoveryTimer = undefined;
      this.recoveryDueAt = Number.POSITIVE_INFINITY;
      if (!this.recoveryDeferred) return;
      this.recoveryStarted = false;
      const work = this.recoverPendingCommands();
      this.pendingDeliveries.add(work);
      work.catch(() => {}).finally(() => this.pendingDeliveries.delete(work));
    }, boundedDelay);
    this.recoveryTimer = timer;
    timer?.unref?.();
  }

  installRobotQueueBarrier(queueKey) {
    const previous = this.deliveryQueues.get(queueKey) || Promise.resolve();
    let released = false;
    let resolveBarrier;
    const barrier = new Promise((resolve) => { resolveBarrier = resolve; });
    const release = () => {
      if (released) return;
      released = true;
      resolveBarrier();
    };
    const tail = previous.catch(() => {}).then(() => barrier);
    this.deliveryQueues.set(queueKey, tail);
    tail.finally(() => {
      if (this.deliveryQueues.get(queueKey) === tail) this.deliveryQueues.delete(queueKey);
    });
    return { previous, release, tail };
  }

  async transitionOutbox(method, actionId, details) {
    if (!this.outboxRepository || typeof this.outboxRepository[method] !== 'function') return true;
    try {
      return await this.outboxRepository[method](actionId, details);
    } catch (error) {
      this.logger.error('[ActionGateway] Outbox transition failed', {
        actionId,
        transition: method,
        name: error?.name || 'OutboxError'
      });
      return false;
    }
  }

  async readOutboxRecord(actionId) {
    if (!this.outboxRepository?.getAction) return undefined;
    try {
      return await this.outboxRepository.getAction(actionId);
    } catch (error) {
      this.logger.error('[ActionGateway] Outbox read failed', {
        actionId,
        name: error?.name || 'OutboxError'
      });
      return undefined;
    }
  }

  publishTerminalOutboxRecord(actionId, fallbackUserId, record) {
    if (!record || !['delivered', 'failed'].includes(record.state)) return undefined;
    const owner = typeof record.user_id === 'string' ? record.user_id : String(fallbackUserId);
    const outcome = {
      status: record.state,
      action_id: actionId,
      ...(record.error_code ? { error_code: record.error_code } : {}),
      ...(record.state === 'delivered' && typeof record.camera_ready === 'boolean'
        ? { camera_ready: record.camera_ready }
        : {}),
      ...(record.state === 'delivered' && boundedIdentifier(record.camera_session_ref, 128)
        ? { camera_session_ref: record.camera_session_ref }
        : {})
    };
    this.publishRobotOutcome(actionId, owner, outcome);
    return outcome;
  }

  validateDuplicateRobotRecord(existing, expected) {
    if (
      existing?.action_id !== expected.actionId
      || String(existing?.user_id) !== String(expected.userId)
      || existing?.device_id !== expected.action.device_id
      || existing?.adapter_id !== expected.action.adapter_id
      || existing?.binding_epoch !== expected.action.binding_epoch
      || existing?.request_fingerprint !== expected.requestFingerprint
    ) {
      throw Object.assign(new Error('Idempotency key conflicts with another robot command'), {
        statusCode: 409,
        code: 'ROBOT_IDEMPOTENCY_CONFLICT'
      });
    }
    if (!['queued', 'delivering', 'pending_ack', 'delivered', 'failed'].includes(existing.state)) {
      throw Object.assign(new Error('Robot idempotency state is invalid'), {
        statusCode: 503,
        code: 'ROBOT_IDEMPOTENCY_STATE_INVALID'
      });
    }
    this.rememberRobotActionOwner(expected.actionId, expected.userId);
    const outcome = this.publishTerminalOutboxRecord(expected.actionId, expected.userId, existing);
    return {
      status: outcome?.status || 'accepted',
      action_id: expected.actionId,
      duplicate: true,
      ...(outcome?.error_code ? { error_code: outcome.error_code } : {}),
      ...(typeof outcome?.camera_ready === 'boolean' && outcome.camera_session_ref
        ? {
            camera_ready: outcome.camera_ready,
            camera_session_ref: outcome.camera_session_ref
          }
        : {})
    };
  }

  async notifyRobotFailure(userId, actionId, deviceId) {
    try {
      await this.notifyUser?.(userId, {
        title: 'Veryloving robot alert',
        body: ROBOT_FAILURE_MESSAGE,
        data: { type: 'robot_command_failed', action_id: actionId, device_id: deviceId }
      });
    } catch (notifyError) {
      this.logger.error('[ActionGateway] Robot failure notification failed', {
        actionId,
        name: notifyError?.name || 'NotificationError'
      });
    }
  }

  cancelPendingRobotAcknowledgements(predicate) {
    let cancelled = 0;
    for (const [actionId, pending] of this.pendingRobotAcks) {
      if (!predicate(pending) || this.pendingRobotAcks.get(actionId) !== pending) continue;
      this.pendingRobotAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      pending.cleanup?.();
      pending.releaseQueue?.();
      this.releaseRobotSlot(pending.queueKey);
      this.publishRobotOutcome(actionId, pending.userId, {
        status: 'failed',
        action_id: actionId,
        error_code: 'ACTION_CANCELLED'
      });
      cancelled += 1;
    }
    return cancelled;
  }

  async fenceRobotBinding(userId, deviceId, bindingEpoch) {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId || '') || !isPositiveBindingEpoch(bindingEpoch)) {
      throw Object.assign(new Error('Robot binding fence is invalid'), { statusCode: 400 });
    }
    const key = this.bindingKey(userId, deviceId, bindingEpoch);
    this.fencedRobotBindings.add(key);

    const matchesBinding = (pending) => pending.userId === userId
      && pending.deviceId === deviceId
      && pending.bindingEpoch === bindingEpoch;
    let cancelledAcknowledgements = this.cancelPendingRobotAcknowledgements(matchesBinding);

    let failedPending = 0;
    let persistenceError;
    if (this.outboxRepository && typeof this.outboxRepository.failPendingForBinding !== 'function') {
      persistenceError = new Error('Action outbox binding fence is not implemented');
    } else if (this.outboxRepository?.failPendingForBinding) {
      try {
        const result = await this.outboxRepository.failPendingForBinding(
          userId,
          deviceId,
          bindingEpoch,
          { failed_at: this.now(), error_code: 'BINDING_FENCED' }
        );
        failedPending = Number.isSafeInteger(result?.failed) ? result.failed : 0;
      } catch (error) {
        persistenceError = error;
        this.logger.error('[ActionGateway] Durable robot binding fence failed', {
          deviceId,
          name: error?.name || 'OutboxError'
        });
      }
    }
    while (true) {
      const activeDeliveries = [...this.pendingRobotDeliveries.values()]
        .filter((entry) => entry.userId === userId
          && entry.deviceId === deviceId
          && entry.bindingEpoch === bindingEpoch)
        .map((entry) => entry.promise);
      const activeTransports = [...this.pendingRobotTransports.values()]
        .filter((entry) => entry.userId === userId
          && entry.deviceId === deviceId
          && entry.bindingEpoch === bindingEpoch)
        .map((entry) => entry.promise);
      const active = [...activeDeliveries, ...activeTransports];
      if (!active.length) break;
      await this.waitForFenceOperations(active, 'BINDING_FENCE_DRAIN_TIMEOUT');
    }
    cancelledAcknowledgements += this.cancelPendingRobotAcknowledgements(matchesBinding);
    if (persistenceError) {
      throw Object.assign(new Error('Robot binding could not be durably fenced'), {
        statusCode: 503,
        code: 'BINDING_FENCE_PERSISTENCE_FAILED',
        cause: persistenceError
      });
    }
    return { fenced: true, failedPending, cancelledAcknowledgements };
  }

  async fenceUserActions(userId) {
    const normalizedUserId = String(userId);
    this.fencedUserActions.add(accountFenceKey(normalizedUserId));

    const matchesUser = (pending) => String(pending.userId) === normalizedUserId;
    let cancelledAcknowledgements = this.cancelPendingRobotAcknowledgements(matchesUser);
    cancelledAcknowledgements += this.rejectWearableAcksForUser(normalizedUserId);

    let failedPending = 0;
    let persistenceError;
    if (this.outboxRepository && typeof this.outboxRepository.failPendingForUser !== 'function') {
      persistenceError = new Error('Action outbox account fence is not implemented');
    } else if (this.outboxRepository?.failPendingForUser) {
      try {
        const result = await this.outboxRepository.failPendingForUser(normalizedUserId, {
          failed_at: this.now(),
          error_code: 'ACCOUNT_FENCED'
        });
        failedPending = Number.isSafeInteger(result?.failed) ? result.failed : 0;
      } catch (error) {
        persistenceError = error;
        this.logger.error('[ActionGateway] Durable account action fence failed', {
          name: error?.name || 'OutboxError'
        });
      }
    }

    // A request that passed its attempt guard before the fence may already be
    // on the wire. All transports are bounded; wait for those requests before
    // the caller starts manufacturer-side privacy erasure.
    while (true) {
      const activeDeliveries = [...this.pendingRobotDeliveries.values()]
        .filter((entry) => String(entry.userId) === normalizedUserId)
        .map((entry) => entry.promise);
      const activeTransports = [...this.pendingRobotTransports.values()]
        .filter((entry) => String(entry.userId) === normalizedUserId)
        .map((entry) => entry.promise);
      const active = [...activeDeliveries, ...activeTransports];
      if (!active.length) break;
      await this.waitForFenceOperations(active, 'ACCOUNT_FENCE_DRAIN_TIMEOUT');
    }
    cancelledAcknowledgements += this.cancelPendingRobotAcknowledgements(matchesUser);

    if (persistenceError) {
      throw Object.assign(new Error('Account actions could not be durably fenced'), {
        statusCode: 503,
        code: 'ACCOUNT_FENCE_PERSISTENCE_FAILED',
        cause: persistenceError
      });
    }
    this.purgeRobotOutcomeDataForUser(normalizedUserId);
    return { fenced: true, failedPending, cancelledAcknowledgements };
  }

  scheduleRobotAck(userId, action, signed, queueKey, timeoutMs = this.robotAckTimeoutMs, releaseQueue, signal) {
    const actionId = signed.envelope.id;
    const pending = {
      userId,
      deviceId: action.device_id,
      adapterId: signed.envelope.adapter_id,
      bindingEpoch: signed.envelope.binding_epoch,
      leaseOwner: this.deliveryWorkerId,
      actionName: signed.envelope.action,
      expectedCameraSessionRef: signed.envelope.action === 'share_camera_view'
        ? signed.envelope.parameters?.session_id
        : undefined,
      queueKey,
      releaseQueue,
      timer: null,
      cleanup: null
    };
    const onAbort = () => {
      this.trackRobotAcknowledgementWork(
        this.cancelRobotAcknowledgement(actionId, pending),
        'cancel'
      );
    };
    pending.cleanup = () => signal?.removeEventListener?.('abort', onAbort);
    pending.timer = this.setTimeoutImpl(() => {
      this.trackRobotAcknowledgementWork(
        this.expireRobotAcknowledgement(actionId, pending),
        'expire'
      );
    }, Math.max(0, timeoutMs));
    pending.timer?.unref?.();
    this.pendingRobotAcks.set(actionId, pending);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  }

  trackRobotAcknowledgementWork(work, operation) {
    let tracked;
    tracked = Promise.resolve(work).catch(() => {
      // This is deliberately free of account, action, device, serial, message,
      // stack, and repository fields. Observability must not become a PII sink,
      // and a broken log transport must not recreate an unhandled rejection.
      try {
        this.logger.error('[ActionGateway] Robot acknowledgement maintenance failed', {
          operation,
          code: 'ACK_BACKGROUND_FAILED'
        });
      } catch {}
    }).finally(() => {
      this.pendingDeliveries.delete(tracked);
    });
    this.pendingDeliveries.add(tracked);
    return tracked;
  }

  scheduleRobotAcknowledgementExpiryRetry(actionId, pending) {
    if (this.pendingRobotAcks.get(actionId) !== pending) return false;
    pending.expiryAttempts = (pending.expiryAttempts || 0) + 1;
    const retryMs = Math.min(5_000, 100 * 2 ** Math.min(5, pending.expiryAttempts - 1));
    this.clearTimeoutImpl(pending.timer);
    pending.timer = this.setTimeoutImpl(() => {
      this.trackRobotAcknowledgementWork(
        this.expireRobotAcknowledgement(actionId, pending),
        'expire_retry'
      );
    }, retryMs);
    pending.timer?.unref?.();
    return true;
  }

  async cancelRobotAcknowledgement(actionId, expectedContext) {
    if (this.pendingRobotAcks.get(actionId) !== expectedContext) return false;
    const transitioned = this.outboxRepository && typeof this.outboxRepository.markFailed !== 'function'
      ? false
      : await this.transitionOutbox('markFailed', actionId, {
          failed_at: this.now(),
          error_code: 'ACTION_CANCELLED_NON_RETRACTABLE',
          lease_owner: expectedContext.leaseOwner
        });
    const authoritative = transitioned === false
      ? await this.readOutboxRecord(actionId)
      : transitioned;
    if (transitioned === false && !['delivered', 'failed'].includes(authoritative?.state)) {
      // Keep the durable ACK timeout/barrier alive when cancellation could not
      // be persisted. Releasing it would permit a later command while this one
      // can still execute or be replayed after restart.
      expectedContext.cleanup?.();
      return false;
    }
    if (this.pendingRobotAcks.get(actionId) !== expectedContext) return false;
    this.pendingRobotAcks.delete(actionId);
    this.clearTimeoutImpl(expectedContext.timer);
    expectedContext.cleanup?.();
    expectedContext.releaseQueue?.();
    this.releaseRobotSlot(expectedContext.queueKey);
    if (!this.publishTerminalOutboxRecord(actionId, expectedContext.userId, authoritative)) {
      this.publishRobotOutcome(actionId, expectedContext.userId, {
        status: 'failed',
        action_id: actionId,
        error_code: 'ACTION_CANCELLED_NON_RETRACTABLE'
      });
    }
    return true;
  }

  async expireRobotAcknowledgement(actionId, expectedContext) {
    const pending = this.pendingRobotAcks.get(actionId) || expectedContext;
    if (!pending || (expectedContext && this.pendingRobotAcks.get(actionId) !== expectedContext)) return false;
    try {
      const transitioned = this.outboxRepository && typeof this.outboxRepository.expirePendingAck !== 'function'
        ? false
        : await this.transitionOutbox('expirePendingAck', actionId, {
            expired_at: this.now(),
            error_code: 'ACK_TIMEOUT',
            binding_epoch: pending.bindingEpoch
          });
      // An authenticated ACK can win while the durable expiry transition is in
      // flight. Only the path that still owns this exact pending context may
      // release its barrier and queue slot.
      if (this.pendingRobotAcks.get(actionId) !== pending) return false;
      const authoritative = transitioned === false
        ? await this.readOutboxRecord(actionId)
        : transitioned;
      if (this.pendingRobotAcks.get(actionId) !== pending) return false;
      if (transitioned === false && !['delivered', 'failed'].includes(authoritative?.state)) {
        this.scheduleRobotAcknowledgementExpiryRetry(actionId, pending);
        return false;
      }
      this.pendingRobotAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      pending.cleanup?.();
      pending.releaseQueue?.();
      this.releaseRobotSlot(pending.queueKey);
      if (authoritative !== false && authoritative !== undefined) {
        const authoritativeState = typeof authoritative === 'object' ? authoritative.state : 'failed';
        if (authoritativeState === 'delivered' || authoritativeState === 'failed') {
          if (!this.publishTerminalOutboxRecord(actionId, pending.userId, authoritative)) {
            this.publishRobotOutcome(actionId, pending.userId, {
              status: authoritativeState,
              action_id: actionId,
              error_code: authoritativeState === 'failed' ? 'ACK_TIMEOUT' : undefined
            });
          }
        }
        if (authoritativeState !== 'delivered') {
          await this.notifyRobotFailure(pending.userId, actionId, pending.deviceId);
        }
      }
      return transitioned !== false;
    } catch (error) {
      // The timer that led here has already fired. Retain the durable barrier
      // and schedule another bounded expiry attempt instead of stranding it.
      this.scheduleRobotAcknowledgementExpiryRetry(actionId, pending);
      throw error;
    }
  }

  async acknowledgeRobot(actionId, acknowledgement = {}, { adapterId, bindingEpoch } = {}) {
    if (!ACTION_ID_PATTERN.test(actionId || '') || typeof acknowledgement.ok !== 'boolean') return false;
    const pending = this.pendingRobotAcks.get(actionId);
    if (
      typeof adapterId !== 'string'
      || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)
      || !isPositiveBindingEpoch(bindingEpoch)
    ) return false;
    if (pending && (pending.adapterId !== adapterId || pending.bindingEpoch !== bindingEpoch)) return false;
    if (!pending && (!this.outboxRepository || typeof this.outboxRepository.acknowledge !== 'function')) return false;
    const durableContext = pending ? undefined : await this.readOutboxRecord(actionId);
    const expectedActionName = pending?.actionName || durableContext?.action;
    const expectedCameraSessionRef = pending?.expectedCameraSessionRef
      || durableContext?.signed?.envelope?.parameters?.session_id;
    const suppliedCameraSessionRef = boundedIdentifier(acknowledgement.camera_session_ref, 128);
    const cameraMetadata = acknowledgement.ok === true
      && expectedActionName === 'share_camera_view'
      && typeof acknowledgement.camera_ready === 'boolean'
      && suppliedCameraSessionRef === expectedCameraSessionRef
      ? {
          camera_ready: acknowledgement.camera_ready,
          camera_session_ref: suppliedCameraSessionRef
        }
      : {};
    const errorCode = normalizeManufacturerAckErrorCode(
      acknowledgement.error_code,
      acknowledgement.ok
    );
    const transitioned = await this.transitionOutbox('acknowledge', actionId, {
      ok: acknowledgement.ok,
      acknowledged_at: this.now(),
      error_code: errorCode,
      adapter_id: adapterId,
      binding_epoch: bindingEpoch,
      ...cameraMetadata
    });
    if (transitioned === false) return false;
    if (pending) {
      this.pendingRobotAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      pending.cleanup?.();
      pending.releaseQueue?.();
      this.releaseRobotSlot(pending.queueKey);
      if (!this.publishTerminalOutboxRecord(actionId, pending.userId, transitioned)) {
        this.publishRobotOutcome(actionId, pending.userId, {
          status: acknowledgement.ok ? 'delivered' : 'failed',
          action_id: actionId,
          ...(errorCode ? { error_code: errorCode } : {}),
          ...cameraMetadata
        });
      }
      if (!acknowledgement.ok) await this.notifyRobotFailure(pending.userId, actionId, pending.deviceId);
    } else if (typeof transitioned === 'object' && typeof transitioned.user_id === 'string') {
      this.publishTerminalOutboxRecord(actionId, transitioned.user_id, transitioned);
      if (!acknowledgement.ok && typeof transitioned.device_id === 'string') {
        await this.notifyRobotFailure(transitioned.user_id, actionId, transitioned.device_id);
      }
    }
    return true;
  }

  startRobotDelivery(userId, action, signed, queueKey, signal) {
    const { previous, release } = this.installRobotQueueBarrier(queueKey);
    let queueReleased = false;
    const releaseQueue = () => {
      if (queueReleased) return;
      queueReleased = true;
      release();
      this.releaseRobotSlot(queueKey);
    };
    const delivery = previous.catch(() => {}).then(async () => {
      let leaseAcquired = false;
      const acquireOrRenewLease = async (attempt) => {
        throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
        await this.assertAccountActionAllowed(userId);
        await this.assertRobotBindingActive(userId, signed);
        const leaseNow = this.now();
        // A vendor HAL may have a longer retry budget than this gateway.
        // Hold ownership through the signed envelope lifetime; a second
        // replica may observe the row but cannot steal and redeliver a
        // still-valid safety command.
        const delivering = await this.transitionOutbox('markDelivering', signed.envelope.id, {
          attempt,
          lease_owner: this.deliveryWorkerId,
          lease_now: leaseNow,
          lease_expires_at: signed.envelope.expires_at
        });
        if (delivering === false) {
          throw Object.assign(new Error('Robot delivery lease was not acquired'), {
            statusCode: 409,
            code: 'OUTBOX_DELIVERY_LEASE_LOST'
          });
        }
        if (typeof delivering === 'object' && ['delivered', 'failed'].includes(delivering.state)) {
          throw Object.assign(new Error('Robot command is already terminal'), {
            statusCode: 409,
            code: 'OUTBOX_ACTION_TERMINAL',
            durableRecord: delivering
          });
        }
        if (typeof delivering === 'object' && delivering.state !== 'delivering') {
          throw Object.assign(new Error('Robot delivery lease state is invalid'), {
            statusCode: 503,
            code: 'OUTBOX_DELIVERY_LEASE_INVALID'
          });
        }
        leaseAcquired = true;
        throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
      };
      try {
        throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
        // Lease before vendor adapter construction/initialization. The HAL may
        // fail before its first HTTP attempt and must never clobber a lease
        // already held by another replica.
        await acquireOrRenewLease(1);
        const result = await this.deliverRobot(signed, {
          signal,
          transportContext: {
            userId,
            deviceId: action.device_id,
            bindingEpoch: signed.envelope.binding_epoch,
            actionId: signed.envelope.id
          },
          onAttempt: async (attempt) => {
            if (attempt === 1) {
              throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
            } else {
              await acquireOrRenewLease(attempt);
            }
          }
        });
        if (result.status === 202) {
          const ackDeadline = this.now() + this.robotAckTimeoutMs;
          const pendingAckState = await this.transitionOutbox('markPendingAck', signed.envelope.id, {
            manufacturer_status: result.status,
            ack_deadline: ackDeadline,
            lease_owner: this.deliveryWorkerId
          });
          if (pendingAckState === false) {
            throw Object.assign(new Error('Robot ACK state could not be durably recorded'), {
              statusCode: 503,
              code: 'OUTBOX_PENDING_ACK_TRANSITION_FAILED',
              nonRetractable: true
            });
          }
          if (typeof pendingAckState === 'object' && ['delivered', 'failed'].includes(pendingAckState.state)) {
            // An authenticated callback may win the race against this 202
            // response on another replica. Do not leave the per-device queue
            // blocked until an ACK timeout after DynamoDB is already terminal.
            releaseQueue();
            this.publishTerminalOutboxRecord(signed.envelope.id, userId, pendingAckState);
          } else {
            if (typeof pendingAckState === 'object' && pendingAckState.state !== 'pending_ack') {
              throw Object.assign(new Error('Robot ACK state transition returned an invalid state'), {
                statusCode: 503,
                code: 'OUTBOX_PENDING_ACK_STATE_INVALID',
                nonRetractable: true
              });
            }
            throwIfActionCancelled(signal, 'Robot command wait was cancelled', { mayHaveBeenSent: true });
            this.scheduleRobotAck(
              userId,
              action,
              signed,
              queueKey,
              this.robotAckTimeoutMs,
              release,
              signal
            );
          }
        } else {
          const transitioned = await this.transitionOutbox('markDelivered', signed.envelope.id, {
            manufacturer_status: result.status,
            lease_owner: this.deliveryWorkerId
          });
          if (transitioned === false) {
            throw Object.assign(new Error('Robot delivery result could not be durably recorded'), {
              statusCode: 503,
              code: 'OUTBOX_DELIVERED_TRANSITION_FAILED',
              nonRetractable: true
            });
          }
          if (typeof transitioned === 'object' && !['delivered', 'failed'].includes(transitioned.state)) {
            throw Object.assign(new Error('Robot delivery transition returned an invalid state'), {
              statusCode: 503,
              code: 'OUTBOX_DELIVERED_STATE_INVALID',
              nonRetractable: true
            });
          }
          releaseQueue();
          if (!this.publishTerminalOutboxRecord(signed.envelope.id, userId, transitioned)) {
            this.publishRobotOutcome(signed.envelope.id, userId, {
              status: 'delivered',
              action_id: signed.envelope.id
            });
          }
        }
        return result;
      } catch (error) {
        let authoritative = error?.durableRecord;
        const mustNotMutate = [
          'OUTBOX_DELIVERY_LEASE_LOST',
          'OUTBOX_DELIVERY_LEASE_INVALID',
          'OUTBOX_ACTION_TERMINAL'
        ].includes(error?.code);
        let durableFailureRejected = false;
        if (!authoritative && !mustNotMutate) {
          const failureMethod = leaseAcquired ? 'markFailed' : 'markQueuedFailed';
          const transitioned = this.outboxRepository
            && typeof this.outboxRepository[failureMethod] !== 'function'
            ? false
            : await this.transitionOutbox(failureMethod, signed.envelope.id, {
              error_code: error?.nonRetractable === true && error?.code === 'ACTION_CANCELLED'
                ? 'ACTION_CANCELLED_NON_RETRACTABLE'
                : (error?.code || error?.name || 'DELIVERY_FAILED'),
              ...(leaseAcquired ? { lease_owner: this.deliveryWorkerId } : {})
            });
          durableFailureRejected = transitioned === false;
          authoritative = transitioned === false
            ? await this.readOutboxRecord(signed.envelope.id)
            : transitioned;
        } else if (!authoritative) {
          authoritative = await this.readOutboxRecord(signed.envelope.id);
        }
        releaseQueue();
        if (!this.publishTerminalOutboxRecord(signed.envelope.id, userId, authoritative)) {
          if (!mustNotMutate && !durableFailureRejected) {
            this.publishRobotOutcome(signed.envelope.id, userId, {
              status: 'failed',
              action_id: signed.envelope.id,
              error_code: error?.nonRetractable === true && error?.code === 'ACTION_CANCELLED'
                ? 'ACTION_CANCELLED_NON_RETRACTABLE'
                : (typeof error?.code === 'string' ? error.code : 'DELIVERY_FAILED')
            });
          }
        }
        throw error;
      }
    });
    const tracked = delivery.catch(async (error) => {
      this.logger.error('[ActionGateway] Robot delivery exhausted', {
        actionId: signed.envelope.id, name: error?.name || 'DeliveryError'
      });
      const intentionallyFenced = [
        'BINDING_FENCED',
        'ACCOUNT_FENCED',
        'ACTION_CANCELLED',
        'OUTBOX_ACTION_TERMINAL',
        'OUTBOX_DELIVERY_LEASE_LOST',
        'OUTBOX_DELIVERY_LEASE_INVALID'
      ].includes(error?.code)
        || this.fencedUserActions.has(accountFenceKey(userId))
        || this.fencedRobotBindings.has(this.bindingKey(
          userId,
          action.device_id,
          signed.envelope.binding_epoch
        ))
        || this.robotActionOutcomes.get(signed.envelope.id)?.outcome?.status === 'delivered';
      if (!intentionallyFenced) {
        await this.notifyRobotFailure(userId, signed.envelope.id, action.device_id);
      }
    }).finally(() => {
      this.pendingDeliveries.delete(tracked);
      if (this.pendingRobotDeliveries.get(signed.envelope.id)?.promise === tracked) {
        this.pendingRobotDeliveries.delete(signed.envelope.id);
      }
    });
    this.pendingDeliveries.add(tracked);
    this.pendingRobotDeliveries.set(signed.envelope.id, {
      userId,
      deviceId: action.device_id,
      bindingEpoch: signed.envelope.binding_epoch,
      promise: tracked
    });
    return tracked;
  }

  recoverPendingCommands() {
    if (this.recoveryStarted) return this.recoveryPromise;
    this.recoveryStarted = true;
    let recovery;
    recovery = (async () => {
      if (!this.outboxRepository?.listPending) return { recovered: 0 };
      this.recoveryDeferred = false;
      const page = await this.outboxRepository.listPending({
        limit: this.maxPendingRobotCommands,
        cursor: this.recoveryCursor
      });
      const records = Array.isArray(page) ? page : (Array.isArray(page?.records) ? page.records : []);
      const nextCursor = Array.isArray(page) ? undefined : page?.nextCursor;
      let recovered = 0;
      let capacityBlocked = false;
      for (const record of records) {
        const signed = record?.signed;
        const actionId = signed?.envelope?.id;
        const userId = record?.user_id;
        const deviceId = record?.device_id;
        const hasRecoverableIdentity = (
          !ACTION_ID_PATTERN.test(actionId || '')
          || actionId !== record?.action_id
          || typeof userId !== 'string'
          || !/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId || '')
          || signed?.envelope?.device_type !== 'home_robot'
          || signed.envelope.device_id !== deviceId
          || !boundedIdentifier(signed.envelope.manufacturer_device_id)
          || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(signed.envelope.adapter_id || '')
        ) === false;
        if (!hasRecoverableIdentity) continue;
        if (this.pendingRobotDeliveries.has(actionId) || this.pendingRobotAcks.has(actionId)) continue;
        const bindingEpoch = signed.envelope.binding_epoch;
        if (
          signed.envelope.version !== 2
          || signed.envelope.contract_version !== 'vl-robot-action/2'
          || !isPositiveBindingEpoch(bindingEpoch)
          || record.binding_epoch !== bindingEpoch
          || (record.adapter_id !== undefined && record.adapter_id !== signed.envelope.adapter_id)
        ) {
          await this.transitionOutbox('markFailed', actionId, {
            error_code: 'BINDING_FENCED',
            failed_at: this.now()
          });
          continue;
        }
        const expiresAt = Number(signed.envelope.expires_at);
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) {
          await this.transitionOutbox('markFailed', actionId, {
            error_code: 'ACTION_EXPIRED',
            expired_at: this.now()
          });
          continue;
        }
        try {
          await this.assertAccountActionAllowed(userId);
        } catch (error) {
          if (error?.code !== 'ACCOUNT_FENCED') throw error;
          await this.transitionOutbox('markFailed', actionId, {
            error_code: 'ACCOUNT_FENCED',
            failed_at: this.now()
          });
          continue;
        }
        try {
          await this.assertRobotBindingActive(userId, signed);
        } catch (error) {
          if (error?.code !== 'BINDING_FENCED') throw error;
          await this.transitionOutbox('markFailed', actionId, {
            error_code: 'BINDING_FENCED',
            failed_at: this.now()
          });
          continue;
        }
        if (
          record.state === 'delivering'
          && boundedIdentifier(record.lease_owner, 128)
          && record.lease_owner !== this.deliveryWorkerId
          && Number.isSafeInteger(record.lease_expires_at)
          && record.lease_expires_at > this.now()
        ) {
          this.recoveryDeferred = true;
          this.scheduleDeferredRecovery(record.lease_expires_at - this.now() + 1);
          continue;
        }
        const action = {
          action: record.action,
          device_type: 'home_robot',
          device_id: deviceId,
          parameters: signed.envelope.parameters || {}
        };
        const queueKey = this.queueKey(userId, deviceId, bindingEpoch);
        try {
          this.reserveRobotSlot(queueKey);
        } catch {
          this.recoveryDeferred = true;
          capacityBlocked = true;
          break;
        }
        recovered += 1;
        if (record.state === 'pending_ack') {
          const remaining = Number(record.ack_deadline) - this.now();
          const { release } = this.installRobotQueueBarrier(queueKey);
          this.scheduleRobotAck(
            userId,
            action,
            signed,
            queueKey,
            Number.isFinite(remaining) ? remaining : 0,
            release
          );
        } else {
          this.startRobotDelivery(userId, action, signed, queueKey);
        }
      }
      if (!capacityBlocked) {
        this.recoveryCursor = nextCursor;
        if (nextCursor) {
          this.recoveryDeferred = true;
          this.scheduleDeferredRecovery();
        }
      }
      return { recovered };
    })().catch((error) => {
      this.logger.error('[ActionGateway] Durable action recovery failed', { name: error?.name || 'RecoveryError' });
      if (this.recoveryPromise === recovery) {
        this.recoveryStarted = false;
        this.recoveryPromise = Promise.resolve({ recovered: 0 });
      }
      throw error;
    }).finally(() => {
      if (this.recoveryPromise === recovery) this.recoveryStarted = false;
    });
    this.recoveryPromise = recovery;
    return recovery;
  }

  async route(userId, input, { signal } = {}) {
    throwIfActionCancelled(signal, 'Action was cancelled before validation');
    let action = validateAction(input);
    if (this.isAccountActionAllowed || this.fencedUserActions.has(accountFenceKey(userId))) {
      await this.assertAccountActionAllowed(userId);
    }
    throwIfActionCancelled(signal, 'Action was cancelled before device resolution');
    const session = this.sessions.get(userId);
    const device = session?.devices.get(action.device_id);
    if (action.device_type === 'wearable') {
      if (!device || device.device_type !== 'wearable' || device.online !== true) {
        throw Object.assign(new Error('Requested device is offline'), { statusCode: 409 });
      }
    } else {
      if (!this.resolveRobotBinding) {
        throw Object.assign(new Error('Robot binding resolver is not configured'), { statusCode: 503 });
      }
      const binding = await this.resolveRobotBinding(userId, action.device_id);
      const manufacturerDeviceId = binding?.manufacturerDeviceId;
      const adapterId = binding?.adapterId;
      const bindingEpoch = binding?.bindingEpoch;
      if (
        !isExplicitlyActiveBinding(binding)
        || !boundedIdentifier(manufacturerDeviceId)
        || typeof adapterId !== 'string'
        || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)
        || !isPositiveBindingEpoch(bindingEpoch)
      ) {
        throw Object.assign(new Error('Requested device is not bound to an active supported adapter'), { statusCode: 403 });
      }
      action = {
        ...action,
        manufacturer_device_id: manufacturerDeviceId,
        adapter_id: adapterId,
        binding_epoch: bindingEpoch,
        contract_version: 'vl-robot-action/2'
      };
    }
    if (action.device_type === 'wearable') {
      const commandPayload = this.wearableCommandPayloads[action.action];
      if (!commandPayload) {
        throw Object.assign(new Error('Wearable command mapping is not configured'), { statusCode: 503 });
      }
      action = { ...action, parameters: { command_payload: commandPayload } };
    }
    const issuedAt = this.now();
    if (action.device_type === 'home_robot') {
      action = { ...action, version: 2, expires_at: issuedAt + this.robotActionTTLms };
    }
    const actionId = deterministicActionId(userId, action);
    const requestFingerprint = actionRequestFingerprint(userId, action);
    const { idempotency_key: _idempotencyKey, ...actionEnvelope } = action;
    const signed = signEnvelope(actionEnvelope, this.signingPrivateKey, () => issuedAt, actionId);
    if (action.device_type === 'wearable') {
      return this.routeWearable(userId, session, signed, signal);
    }
    await this.assertAccountActionAllowed(userId);
    await this.assertRobotBindingActive(userId, signed);
    throwIfActionCancelled(signal, 'Robot command was cancelled before idempotency lookup');
    if (action.idempotency_key && this.outboxRepository?.getAction) {
      let existing;
      try {
        existing = await this.outboxRepository.getAction(signed.envelope.id);
      } catch (error) {
        throw Object.assign(new Error('Robot idempotency state could not be read'), {
          statusCode: 503,
          code: 'ROBOT_IDEMPOTENCY_STATE_UNAVAILABLE',
          cause: error
        });
      }
      throwIfActionCancelled(signal, 'Robot command was cancelled during idempotency lookup');
      if (existing) {
        return this.validateDuplicateRobotRecord(existing, {
          actionId: signed.envelope.id,
          userId,
          action,
          requestFingerprint
        });
      }
    }
    let online = device?.device_type === 'home_robot' && device.online === true;
    if (!online && this.getDeviceStatus) {
      const status = await this.getDeviceStatus(action.manufacturer_device_id, action.adapter_id);
      throwIfActionCancelled(signal, 'Robot command was cancelled during status lookup');
      online = status?.online === true;
    }
    if (!online) throw Object.assign(new Error('Requested device is offline'), { statusCode: 409 });
    await this.recoverPendingCommands();
    throwIfActionCancelled(signal, 'Robot command was cancelled during recovery');
    await this.assertAccountActionAllowed(userId);
    await this.assertRobotBindingActive(userId, signed);
    const queueKey = this.queueKey(userId, action.device_id, action.binding_epoch);
    this.reserveRobotSlot(queueKey);
    if (this.outboxRepository) {
      if (typeof this.outboxRepository.enqueue !== 'function') {
        this.releaseRobotSlot(queueKey);
        throw new Error('Action outbox repository is invalid');
      }
      try {
        const enqueued = await this.outboxRepository.enqueue({
          action_id: signed.envelope.id,
          user_id: userId,
          device_id: action.device_id,
          device_type: action.device_type,
          action: action.action,
          adapter_id: signed.envelope.adapter_id,
          binding_epoch: signed.envelope.binding_epoch,
          request_fingerprint: requestFingerprint,
          signed,
          created_at: signed.envelope.issued_at
        });
        if (enqueued?.duplicate === true) {
          const existing = enqueued.record;
          if (
            existing?.action_id !== signed.envelope.id
            || existing?.user_id !== userId
            || existing?.device_id !== action.device_id
            || existing?.adapter_id !== signed.envelope.adapter_id
            || existing?.binding_epoch !== signed.envelope.binding_epoch
            || existing?.request_fingerprint !== requestFingerprint
          ) {
            throw Object.assign(new Error('Idempotency key conflicts with another robot command'), {
              statusCode: 409,
              code: 'ROBOT_IDEMPOTENCY_CONFLICT'
            });
          }
          this.releaseRobotSlot(queueKey);
          return this.validateDuplicateRobotRecord(existing, {
            actionId: signed.envelope.id,
            userId,
            action,
            requestFingerprint
          });
        }
        if (enqueued === false) {
          throw Object.assign(new Error('Idempotency state could not be verified'), {
            statusCode: 409,
            code: 'ROBOT_IDEMPOTENCY_CONFLICT'
          });
        }
      } catch (error) {
        this.releaseRobotSlot(queueKey);
        if (error?.code === 'ROBOT_IDEMPOTENCY_CONFLICT') throw error;
        throw Object.assign(new Error('Robot command could not be durably queued'), { statusCode: 503, cause: error });
      }
    }
    this.rememberRobotActionOwner(signed.envelope.id, userId);
    this.startRobotDelivery(userId, action, signed, queueKey, signal);
    return { status: 'accepted', action_id: signed.envelope.id };
  }

  async routeMany(userId, inputs, { mode = 'parallel', signal } = {}) {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 10) {
      throw Object.assign(new Error('Multi-device action count is invalid'), { statusCode: 400 });
    }
    if (!['parallel', 'sequential'].includes(mode)) {
      throw Object.assign(new Error('Multi-device action mode is invalid'), { statusCode: 400 });
    }
    const normalized = inputs.map((input) => validateAction(input));
    if (normalized.some((action) => !action.idempotency_key)) {
      throw Object.assign(new Error('Multi-device actions require idempotency keys'), { statusCode: 400 });
    }
    const identities = new Set(normalized.map((action) => (
      `${action.device_type}:${action.device_id}:${action.action}:${action.idempotency_key}`
    )));
    if (identities.size !== normalized.length) {
      throw Object.assign(new Error('Multi-device action is duplicated'), { statusCode: 409 });
    }
    const execute = async (action, index) => {
      try {
        return {
          index,
          device_type: action.device_type,
          device_id: action.device_id,
          action: action.action,
          status: 'fulfilled',
          value: await this.route(userId, action, { signal })
        };
      } catch (error) {
        return {
          index,
          device_type: action.device_type,
          device_id: action.device_id,
          action: action.action,
          status: 'rejected',
          status_code: Number.isSafeInteger(error?.statusCode) ? error.statusCode : 500,
          error_code: typeof error?.code === 'string'
            ? error.code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
            : 'ACTION_FAILED'
        };
      }
    };
    const results = [];
    if (mode === 'sequential') {
      for (let index = 0; index < normalized.length; index += 1) {
        results.push(await execute(normalized[index], index));
      }
    } else {
      results.push(...await Promise.all(normalized.map(execute)));
    }
    return Object.freeze({ mode, results: Object.freeze(results) });
  }

  async startScenario(userId, request) {
    if (!this.scenarioEngine || typeof this.scenarioEngine.startScenario !== 'function') {
      throw Object.assign(new Error('Scenario engine is not configured'), {
        statusCode: 503,
        code: 'SCENARIO_ENGINE_UNAVAILABLE'
      });
    }
    return this.scenarioEngine.startScenario(userId, request);
  }

  async cancelScenario(userId, executionId) {
    if (!this.scenarioEngine || typeof this.scenarioEngine.cancelScenario !== 'function') {
      throw Object.assign(new Error('Scenario engine is not configured'), {
        statusCode: 503,
        code: 'SCENARIO_ENGINE_UNAVAILABLE'
      });
    }
    return this.scenarioEngine.cancelScenario(userId, executionId);
  }

  async getScenarioExecution(userId, executionId) {
    if (!this.scenarioEngine || typeof this.scenarioEngine.getExecution !== 'function') {
      throw Object.assign(new Error('Scenario engine is not configured'), {
        statusCode: 503,
        code: 'SCENARIO_ENGINE_UNAVAILABLE'
      });
    }
    return this.scenarioEngine.getExecution(userId, executionId);
  }

  rememberRobotActionOwner(actionId, userId) {
    this.robotActionOwners.delete(actionId);
    this.robotActionOwners.set(actionId, String(userId));
    while (this.robotActionOwners.size > this.maxPendingRobotCommands * 2) {
      this.robotActionOwners.delete(this.robotActionOwners.keys().next().value);
    }
  }

  publishRobotOutcome(actionId, userId, outcome) {
    if (!ACTION_ID_PATTERN.test(actionId || '')) return false;
    const normalizedUserId = String(userId);
    if (this.fencedUserActions.has(accountFenceKey(normalizedUserId))) return false;
    this.rememberRobotActionOwner(actionId, normalizedUserId);
    const safeCode = typeof outcome?.error_code === 'string'
      ? outcome.error_code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
      : undefined;
    const cameraSessionRef = boundedIdentifier(outcome?.camera_session_ref, 128);
    const stored = Object.freeze({
      status: outcome?.status === 'delivered' ? 'delivered' : 'failed',
      action_id: actionId,
      ...(safeCode ? { error_code: safeCode } : {}),
      ...(outcome?.status === 'delivered' && typeof outcome?.camera_ready === 'boolean' && cameraSessionRef
        ? { camera_ready: outcome.camera_ready, camera_session_ref: cameraSessionRef }
        : {})
    });
    this.robotActionOutcomes.delete(actionId);
    this.robotActionOutcomes.set(actionId, { userId: normalizedUserId, outcome: stored });
    while (this.robotActionOutcomes.size > this.maxPendingRobotCommands * 2) {
      this.robotActionOutcomes.delete(this.robotActionOutcomes.keys().next().value);
    }
    const waiters = this.robotOutcomeWaiters.get(actionId);
    this.robotOutcomeWaiters.delete(actionId);
    for (const waiter of waiters || []) waiter.resolve();
    return true;
  }

  async readRobotOutcome(userId, actionId) {
    const normalizedUserId = String(userId);
    const cached = this.robotActionOutcomes.get(actionId);
    if (cached) {
      if (cached.userId !== normalizedUserId) return { forbidden: true };
      return cached.outcome;
    }
    if (this.outboxRepository?.getAction) {
      const record = await this.outboxRepository.getAction(actionId);
      if (this.fencedUserActions.has(accountFenceKey(normalizedUserId))) return { fenced: true };
      if (record) {
        if (String(record.user_id) !== normalizedUserId) return { forbidden: true };
        this.rememberRobotActionOwner(actionId, normalizedUserId);
        if (record.state === 'delivered' || record.state === 'failed') {
          this.publishTerminalOutboxRecord(actionId, normalizedUserId, record);
          return this.robotActionOutcomes.get(actionId)?.outcome;
        }
      }
    }
    const owner = this.robotActionOwners.get(actionId);
    if (owner !== undefined && owner !== normalizedUserId) return { forbidden: true };
    return owner === normalizedUserId ? undefined : { unknown: true };
  }

  waitForRobotOutcomeChange(userId, actionId, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        this.outcomeClearTimeoutImpl(timer);
        signal?.removeEventListener?.('abort', onAbort);
        const waiters = this.robotOutcomeWaiters.get(actionId);
        waiters?.delete(waiter);
        if (waiters?.size === 0) this.robotOutcomeWaiters.delete(actionId);
        if (error) reject(error);
        else resolve();
      };
      const onOutcome = () => finish();
      const onAbort = () => finish(Object.assign(new Error('Action outcome wait was cancelled'), {
        statusCode: 409,
        code: 'ACTION_WAIT_CANCELLED'
      }));
      const timer = this.outcomeSetTimeoutImpl(() => finish(), timeoutMs);
      const waiters = this.robotOutcomeWaiters.get(actionId) || new Set();
      const waiter = { userId: String(userId), resolve: onOutcome };
      waiters.add(waiter);
      this.robotOutcomeWaiters.set(actionId, waiters);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener?.('abort', onAbort, { once: true });
    });
  }

  readRobotOutcomeWithin(userId, actionId, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        this.outcomeClearTimeoutImpl(timer);
        signal?.removeEventListener?.('abort', onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(Object.assign(new Error('Action outcome wait was cancelled'), {
        statusCode: 409,
        code: 'ACTION_WAIT_CANCELLED'
      }));
      const timer = this.outcomeSetTimeoutImpl(() => finish(Object.assign(new Error('Action outcome read timed out'), {
        statusCode: 504,
        code: 'ACTION_OUTCOME_READ_TIMEOUT'
      })), Math.max(1, timeoutMs));
      signal?.addEventListener?.('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      Promise.resolve()
        .then(() => this.readRobotOutcome(userId, actionId))
        .then((value) => finish(undefined, value), (error) => finish(error));
    });
  }

  unwrapRobotOutcome(outcome) {
    if (outcome?.fenced) throw accountFencedError();
    if (outcome?.forbidden || outcome?.unknown) {
      throw Object.assign(new Error('Action outcome was not found'), { statusCode: 404, code: 'ACTION_NOT_FOUND' });
    }
    if (outcome?.status === 'delivered') return outcome;
    if (outcome?.status === 'failed') {
      const code = outcome.error_code || 'ROBOT_COMMAND_FAILED';
      throw Object.assign(new Error('Robot command did not complete'), {
        statusCode: code === 'ACK_TIMEOUT' ? 504 : 502,
        code
      });
    }
    return undefined;
  }

  async waitForActionOutcome(userId, actionId, { timeoutMs = this.robotAckTimeoutMs, signal } = {}) {
    if (!ACTION_ID_PATTERN.test(actionId || '')) {
      throw Object.assign(new Error('Action outcome id is invalid'), { statusCode: 400 });
    }
    const boundedTimeout = Math.max(10, Math.min(5 * 60_000, Number(timeoutMs) || this.robotAckTimeoutMs));
    const startedAt = this.monotonicNow();
    const deadline = startedAt + boundedTimeout;
    while (this.monotonicNow() < deadline) {
      if (this.fencedUserActions.has(accountFenceKey(userId))) {
        throw Object.assign(new Error('Account actions are disabled'), {
          statusCode: 409,
          code: 'ACCOUNT_FENCED'
        });
      }
      const remaining = Math.max(1, deadline - this.monotonicNow());
      let outcome;
      try {
        outcome = await this.readRobotOutcomeWithin(userId, actionId, remaining, signal);
      } catch (error) {
        if (error?.code === 'ACTION_OUTCOME_READ_TIMEOUT') break;
        throw error;
      }
      const terminal = this.unwrapRobotOutcome(outcome);
      if (terminal) return terminal;
      const waitMs = Math.min(50, Math.max(1, deadline - this.monotonicNow()));
      await this.waitForRobotOutcomeChange(userId, actionId, waitMs, signal);
    }

    // ACK expiry and this caller's deadline can land in the same event-loop
    // turn. Give the authoritative outbox one short, bounded final read so an
    // ACK_TIMEOUT is not obscured by a generic local wait timeout.
    const finalReadBudgetMs = Math.min(50, Math.max(10, Math.ceil(boundedTimeout / 10)));
    try {
      const finalOutcome = await this.readRobotOutcomeWithin(userId, actionId, finalReadBudgetMs, signal);
      const terminal = this.unwrapRobotOutcome(finalOutcome);
      if (terminal) return terminal;
    } catch (error) {
      if (error?.code !== 'ACTION_OUTCOME_READ_TIMEOUT') throw error;
    }
    throw Object.assign(new Error('Action outcome wait timed out'), {
      statusCode: 504,
      code: 'ACTION_OUTCOME_TIMEOUT'
    });
  }

  purgeRobotOutcomeDataForUser(userId) {
    const normalizedUserId = String(userId);
    for (const [actionId, owner] of this.robotActionOwners) {
      if (owner === normalizedUserId) this.robotActionOwners.delete(actionId);
    }
    for (const [actionId, entry] of this.robotActionOutcomes) {
      if (entry.userId === normalizedUserId) this.robotActionOutcomes.delete(actionId);
    }
    for (const [actionId, waiters] of this.robotOutcomeWaiters) {
      for (const waiter of waiters) {
        if (waiter.userId !== normalizedUserId) continue;
        waiters.delete(waiter);
        waiter.resolve();
      }
      if (waiters.size === 0) this.robotOutcomeWaiters.delete(actionId);
    }
  }

  async waitForDeliveries() { await Promise.allSettled([...this.pendingDeliveries]); }

  async waitForFenceOperations(operations, code) {
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = this.setTimeoutImpl(() => reject(Object.assign(
        new Error('In-flight device transport did not settle before the safety fence deadline'),
        { statusCode: 503, code }
      )), this.transportFenceTimeoutMs);
    });
    try {
      await Promise.race([Promise.allSettled(operations), deadline]);
    } finally {
      this.clearTimeoutImpl(timeout);
    }
  }

  trackNonRetractableTransport(operation, context) {
    if (!context || typeof context.userId !== 'string') return;
    if ((typeof operation === 'object' && operation !== null) || typeof operation === 'function') {
      if (this.trackedTransportOperations.has(operation)) return;
      this.trackedTransportOperations.add(operation);
    }
    const key = Symbol(context.actionId || 'robot-transport');
    const tracked = Promise.resolve(operation).then(async (response) => {
      // A transport that ignored cancellation may eventually yield a streaming
      // response after its caller has moved on. Release it here as well.
      try { await response?.body?.cancel?.(); } catch {}
    }).catch(() => {}).finally(() => {
      this.pendingRobotTransports.delete(key);
    });
    this.pendingRobotTransports.set(key, { ...context, promise: tracked });
  }

  async awaitWithActionAbort(operation, signal, message, {
    mayHaveBeenSent = false,
    transportContext
  } = {}) {
    if (!signal) return operation;
    if (signal.aborted) {
      if (mayHaveBeenSent) this.trackNonRetractableTransport(operation, transportContext);
      throw actionCancelledError(message, { mayHaveBeenSent });
    }
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const onAbort = () => {
      if (mayHaveBeenSent) this.trackNonRetractableTransport(operation, transportContext);
      rejectAbort(actionCancelledError(message, { mayHaveBeenSent }));
    };
    signal.addEventListener?.('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      return await Promise.race([operation, aborted]);
    } finally {
      signal.removeEventListener?.('abort', onAbort);
    }
  }

  async postManufacturer(signed, signal, transportContext) {
    throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
    const controller = new AbortController();
    let timeout;
    let rejectAbort;
    const abortFailure = new Promise((_, reject) => { rejectAbort = reject; });
    let fetchOperation;
    const onAbort = () => {
      controller.abort();
      if (fetchOperation) this.trackNonRetractableTransport(fetchOperation, transportContext);
      rejectAbort(actionCancelledError('Robot command transport was cancelled', { mayHaveBeenSent: true }));
    };
    const timeoutFailure = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        // Some injected/vendor transports do not honor AbortSignal. Keep the
        // underlying operation visible to account/binding fences until it
        // actually settles so reset/deletion cannot race an on-wire command.
        if (fetchOperation) this.trackNonRetractableTransport(fetchOperation, transportContext);
        const error = new Error('Manufacturer webhook timed out');
        error.name = 'TimeoutError';
        reject(error);
      }, this.requestTimeoutMs);
    });
    signal?.addEventListener?.('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', onAbort);
      return abortFailure;
    }
    try {
      fetchOperation = this.fetchImpl(this.manufacturerWebhookURL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-Manufacturer-Api-Key': this.manufacturerApiKey,
          'Idempotency-Key': signed.envelope.id
        },
        body: JSON.stringify(signed),
        signal: controller.signal
      });
      return await Promise.race([
        fetchOperation,
        timeoutFailure,
        abortFailure
      ]);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  async deliverRobot(signed, { onAttempt, signal, transportContext } = {}) {
    const adapterId = signed?.envelope?.adapter_id;
    // Bindings created before the vendor HAL rollout intentionally remain on
    // the legacy manufacturer control plane until an explicit, audited
    // backfill assigns a vendor adapter. Never guess a vendor from a missing
    // historical field.
    if (this.robotAdapterRuntime && adapterId !== 'manufacturer-default') {
      if (typeof adapterId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(adapterId)) {
        throw new Error('Robot adapter is invalid');
      }
      throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
      const delivery = this.robotAdapterRuntime.deliverSignedAction(adapterId, signed, { onAttempt, signal });
      return this.awaitWithActionAbort(
        delivery,
        signal,
        'Robot adapter transport was cancelled',
        { mayHaveBeenSent: true, transportContext }
      );
    }
    if (!this.manufacturerWebhookURL || !this.manufacturerApiKey) throw new Error('Manufacturer gateway is not configured');
    const expiresAt = signed?.envelope?.expires_at;
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now())) {
      throw Object.assign(new Error('Robot action has expired'), { code: 'ACTION_EXPIRED' });
    }
    let lastError;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
        if (expiresAt !== undefined && expiresAt <= this.now()) {
          throw Object.assign(new Error('Robot action has expired'), { code: 'ACTION_EXPIRED' });
        }
        await onAttempt?.(attempt + 1);
        throwIfActionCancelled(signal, 'Robot command was cancelled before dispatch');
        const response = await this.postManufacturer(signed, signal, transportContext);
        try {
          if (response.status !== 202 && !response.ok) throw new Error(`Manufacturer returned ${response.status}`);
          return { acknowledged: response.status !== 202, status: response.status };
        } finally {
          // Command endpoints do not consume response payloads. Cancel the body
          // explicitly so keep-alive sockets and streaming bodies are released.
          try { await response.body?.cancel?.(); } catch {}
        }
      } catch (error) {
        lastError = error;
        if (['BINDING_FENCED', 'ACCOUNT_FENCED', 'ACTION_CANCELLED', 'OUTBOX_DELIVERY_LEASE_LOST', 'OUTBOX_ACTION_TERMINAL'].includes(error?.code)) break;
        if (attempt + 1 < this.retries) {
          await this.awaitWithActionAbort(
            this.sleep(this.retryDelayMs * 2 ** attempt),
            signal,
            'Robot command was cancelled before retry',
            { mayHaveBeenSent: true }
          );
        }
      }
    }
    throw lastError;
  }
}

module.exports = {
  ACTIONS,
  ActionGateway,
  DEFAULT_ROBOT_ACTION_TTL_MS,
  ROBOT_FAILURE_MESSAGE,
  createDynamoActionOutboxRepository,
  deriveEd25519PublicKey,
  deterministicActionId,
  parseWearableCommandPayloads,
  redactSerial,
  signEnvelope,
  validateAction
};
