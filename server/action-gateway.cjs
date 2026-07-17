'use strict';

const crypto = require('node:crypto');

const DEVICE_TYPES = new Set(['wearable', 'home_robot']);
const ACTIONS = Object.freeze({
  deploy_barrier: new Set(['wearable']),
  emit_alarm: new Set(['wearable']),
  trigger_sos: new Set(['wearable']),
  check_medication: new Set(['home_robot']),
  medication_reminder: new Set(['home_robot']),
  cognitive_engagement: new Set(['home_robot'])
});
const WEARABLE_ACTION_NAMES = Object.freeze(['deploy_barrier', 'emit_alarm', 'trigger_sos']);

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
    const allowed = new Set(['medication_id', 'scheduled_at']);
    if (Object.keys(parameters).some((key) => !allowed.has(key))) {
      throw Object.assign(new Error('Medication reminder parameters are invalid'), { statusCode: 400 });
    }
    const medicationId = boundedIdentifier(parameters.medication_id);
    const scheduledAt = Number(parameters.scheduled_at);
    if (!medicationId || !Number.isSafeInteger(scheduledAt) || scheduledAt <= 0) {
      throw Object.assign(new Error('Medication reminder parameters are invalid'), { statusCode: 400 });
    }
    return { medication_id: medicationId, scheduled_at: scheduledAt };
  }
  if (action === 'cognitive_engagement') {
    if (Object.keys(parameters).some((key) => key !== 'activity') || !['conversation', 'memory_game', 'music'].includes(parameters.activity)) {
      throw Object.assign(new Error('Cognitive engagement parameters are invalid'), { statusCode: 400 });
    }
    return { activity: parameters.activity };
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
  const bytes = crypto.createHash('sha256').update(JSON.stringify([
    String(userId),
    action.device_type,
    action.device_id,
    action.action,
    action.idempotency_key
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
const ACTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createDynamoActionOutboxRepository({ tableName, region, client: injectedClient, retentionSeconds = DEFAULT_OUTBOX_RETENTION_SECONDS } = {}) {
  if (!tableName) throw new Error('Action outbox table is required');
  let client = injectedClient;
  let commands;
  if (!client) {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
    commands = { PutCommand, ScanCommand, UpdateCommand };
  } else {
    const { PutCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    commands = { PutCommand, ScanCommand, UpdateCommand };
  }

  const key = (actionId) => ({ PK: `ACTION#${actionId}`, SK: 'OUTBOX' });
  const isConditionalFailure = (error) => error?.name === 'ConditionalCheckFailedException';

  async function transition(actionId, state, attributes = {}, expectedStates = []) {
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
      if (isConditionalFailure(error)) return false;
      throw error;
    }
  }

  return {
    async enqueue(record) {
      if (!ACTION_ID_PATTERN.test(record?.action_id || '')) throw new Error('Outbox action id is invalid');
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
            ...record
          },
          ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
        }));
        return record;
      } catch (error) {
        if (isConditionalFailure(error)) return false;
        throw error;
      }
    },
    markDelivering(actionId, details = {}) {
      return transition(actionId, 'delivering', details, ['queued', 'delivering']);
    },
    markPendingAck(actionId, details = {}) {
      return transition(actionId, 'pending_ack', details, ['queued', 'delivering']);
    },
    markDelivered(actionId, details = {}) {
      return transition(actionId, 'delivered', details, ['queued', 'delivering', 'pending_ack']);
    },
    markFailed(actionId, details = {}) {
      return transition(actionId, 'failed', details, ['queued', 'delivering', 'pending_ack']);
    },
    acknowledge(actionId, { ok, acknowledged_at: acknowledgedAt = Date.now(), error_code: errorCode } = {}) {
      return transition(actionId, ok === true ? 'delivered' : 'failed', {
        acknowledged_at: acknowledgedAt,
        error_code: errorCode
      }, ['queued', 'delivering', 'pending_ack']);
    },
    expirePendingAck(actionId, { expired_at: expiredAt = Date.now(), error_code: errorCode = 'ACK_TIMEOUT' } = {}) {
      return transition(actionId, 'failed', {
        acknowledged_at: expiredAt,
        error_code: errorCode
      }, ['pending_ack']);
    },
    async listPending({ limit = 1000 } = {}) {
      const records = [];
      let exclusiveStartKey;
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
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        records.push(...(result.Items || []).slice(0, Math.max(0, limit - records.length)));
        exclusiveStartKey = records.length < limit ? result.LastEvaluatedKey : undefined;
      } while (exclusiveStartKey);
      return records;
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
    robotAckTimeoutMs = 30000,
    wearableAckTimeoutMs = 5000,
    maxQueueDepthPerDevice = 25,
    maxPendingRobotCommands = 1000,
    maxPendingWearableAcks = 100,
    sleep,
    notifyUser,
    authorizeDevice,
    resolveManufacturerDeviceId,
    getDeviceStatus,
    outboxRepository,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    logger = console
  } = {}) {
    this.signingPrivateKey = signingPrivateKey || signingSecret;
    this.wearableCommandPayloads = parseWearableCommandPayloads(wearableCommandPayloads);
    this.manufacturerWebhookURL = manufacturerWebhookURL;
    this.manufacturerApiKey = manufacturerApiKey;
    this.fetchImpl = fetchImpl;
    this.retries = retries;
    this.retryDelayMs = retryDelayMs;
    this.requestTimeoutMs = requestTimeoutMs;
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
    this.getDeviceStatus = getDeviceStatus;
    this.outboxRepository = outboxRepository;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.sessions = new Map();
    this.deliveryQueues = new Map();
    this.deliveryQueueDepths = new Map();
    this.totalRobotCommands = 0;
    this.pendingDeliveries = new Set();
    this.pendingRobotAcks = new Map();
    this.pendingWearableAcks = new Map();
    this.recoveryPromise = Promise.resolve({ recovered: 0 });
    this.recoveryStarted = false;
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
      pending.reject(Object.assign(new Error(message), { statusCode: 409, code: 'WEARABLE_SESSION_CLOSED' }));
    }
  }

  acknowledgeWearable(userId, channel, acknowledgement = {}) {
    const pending = this.pendingWearableAcks.get(acknowledgement.action_id);
    if (!pending || pending.userId !== userId || pending.channel !== channel || typeof acknowledgement.ok !== 'boolean') return false;
    this.pendingWearableAcks.delete(acknowledgement.action_id);
    this.clearTimeoutImpl(pending.timer);
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

  async routeWearable(userId, session, signed) {
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
    const pending = { userId, channel: session.channel, resolve: resolveAck, reject: rejectAck, timer: null };
    pending.timer = this.setTimeoutImpl(() => {
      if (this.pendingWearableAcks.get(actionId) !== pending) return;
      this.pendingWearableAcks.delete(actionId);
      rejectAck(Object.assign(new Error('Wearable acknowledgement timed out'), { statusCode: 504, code: 'WEARABLE_ACK_TIMEOUT' }));
    }, this.wearableAckTimeoutMs);
    this.pendingWearableAcks.set(actionId, pending);
    try {
      session.channel.send(JSON.stringify({ type: 'device_action', ...signed }));
    } catch (error) {
      this.pendingWearableAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      throw Object.assign(new Error('Wearable channel send failed'), { statusCode: 409, cause: error });
    }
    return result;
  }

  queueKey(userId, deviceId) {
    return JSON.stringify([String(userId), String(deviceId)]);
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

  scheduleRobotAck(userId, action, signed, queueKey, timeoutMs = this.robotAckTimeoutMs) {
    const actionId = signed.envelope.id;
    const pending = { userId, deviceId: action.device_id, queueKey, timer: null };
    pending.timer = this.setTimeoutImpl(() => {
      const work = this.expireRobotAcknowledgement(actionId, pending);
      this.pendingDeliveries.add(work);
      work.finally(() => this.pendingDeliveries.delete(work));
    }, Math.max(0, timeoutMs));
    pending.timer?.unref?.();
    this.pendingRobotAcks.set(actionId, pending);
  }

  async expireRobotAcknowledgement(actionId, expectedContext) {
    const pending = this.pendingRobotAcks.get(actionId) || expectedContext;
    if (!pending || (expectedContext && this.pendingRobotAcks.get(actionId) !== expectedContext)) return false;
    const transitioned = await this.transitionOutbox('expirePendingAck', actionId, {
      expired_at: Date.now(),
      error_code: 'ACK_TIMEOUT'
    });
    this.pendingRobotAcks.delete(actionId);
    this.clearTimeoutImpl(pending.timer);
    this.releaseRobotSlot(pending.queueKey);
    if (transitioned !== false) await this.notifyRobotFailure(pending.userId, actionId, pending.deviceId);
    return transitioned !== false;
  }

  async acknowledgeRobot(actionId, acknowledgement = {}) {
    if (!ACTION_ID_PATTERN.test(actionId || '') || typeof acknowledgement.ok !== 'boolean') return false;
    const pending = this.pendingRobotAcks.get(actionId);
    const errorCode = typeof acknowledgement.error_code === 'string'
      ? acknowledgement.error_code.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
      : (acknowledgement.ok ? undefined : 'ROBOT_COMMAND_REJECTED');
    const transitioned = await this.transitionOutbox('acknowledge', actionId, {
      ok: acknowledgement.ok,
      acknowledged_at: Date.now(),
      error_code: errorCode
    });
    if (transitioned === false) return false;
    if (pending) {
      this.pendingRobotAcks.delete(actionId);
      this.clearTimeoutImpl(pending.timer);
      this.releaseRobotSlot(pending.queueKey);
      if (!acknowledgement.ok) await this.notifyRobotFailure(pending.userId, actionId, pending.deviceId);
    }
    return true;
  }

  startRobotDelivery(userId, action, signed, queueKey) {
    const previous = this.deliveryQueues.get(queueKey) || Promise.resolve();
    const delivery = previous.catch(() => {}).then(async () => {
      await this.transitionOutbox('markDelivering', signed.envelope.id, { attempt: 1 });
      try {
        const result = await this.deliverRobot(signed, {
          onAttempt: (attempt) => this.transitionOutbox('markDelivering', signed.envelope.id, { attempt })
        });
        if (result.status === 202) {
          const ackDeadline = Date.now() + this.robotAckTimeoutMs;
          this.scheduleRobotAck(userId, action, signed, queueKey);
          await this.transitionOutbox('markPendingAck', signed.envelope.id, {
            manufacturer_status: result.status,
            ack_deadline: ackDeadline
          });
        } else {
          await this.transitionOutbox('markDelivered', signed.envelope.id, { manufacturer_status: result.status });
          this.releaseRobotSlot(queueKey);
        }
        return result;
      } catch (error) {
        await this.transitionOutbox('markFailed', signed.envelope.id, {
          error_code: error?.name || 'DELIVERY_FAILED'
        });
        this.releaseRobotSlot(queueKey);
        throw error;
      }
    });
    const tail = delivery.then(() => undefined, () => undefined);
    this.deliveryQueues.set(queueKey, tail);
    const tracked = delivery.catch(async (error) => {
      this.logger.error('[ActionGateway] Robot delivery exhausted', {
        actionId: signed.envelope.id, name: error?.name || 'DeliveryError'
      });
      await this.notifyRobotFailure(userId, signed.envelope.id, action.device_id);
    }).finally(() => {
      this.pendingDeliveries.delete(tracked);
      if (this.deliveryQueues.get(queueKey) === tail) this.deliveryQueues.delete(queueKey);
    });
    this.pendingDeliveries.add(tracked);
    return tracked;
  }

  recoverPendingCommands() {
    if (this.recoveryStarted) return this.recoveryPromise;
    this.recoveryStarted = true;
    let recovery;
    recovery = (async () => {
      if (!this.outboxRepository?.listPending) return { recovered: 0 };
      const records = await this.outboxRepository.listPending({ limit: this.maxPendingRobotCommands });
      let recovered = 0;
      for (const record of records) {
        const signed = record?.signed;
        const actionId = signed?.envelope?.id;
        const userId = record?.user_id;
        const deviceId = record?.device_id;
        if (
          !ACTION_ID_PATTERN.test(actionId || '')
          || actionId !== record?.action_id
          || typeof userId !== 'string'
          || !/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId || '')
          || signed?.envelope?.device_type !== 'home_robot'
          || signed.envelope.device_id !== deviceId
          || !boundedIdentifier(signed.envelope.manufacturer_device_id)
        ) continue;
        const action = {
          action: record.action,
          device_type: 'home_robot',
          device_id: deviceId,
          parameters: signed.envelope.parameters || {}
        };
        const queueKey = this.queueKey(userId, deviceId);
        try { this.reserveRobotSlot(queueKey); } catch { break; }
        recovered += 1;
        if (record.state === 'pending_ack') {
          const remaining = Number(record.ack_deadline) - Date.now();
          this.scheduleRobotAck(userId, action, signed, queueKey, Number.isFinite(remaining) ? remaining : 0);
        } else {
          this.startRobotDelivery(userId, action, signed, queueKey);
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
    });
    this.recoveryPromise = recovery;
    return recovery;
  }

  async route(userId, input) {
    let action = validateAction(input);
    const session = this.sessions.get(userId);
    const device = session?.devices.get(action.device_id);
    if (action.device_type === 'wearable') {
      if (!device || device.device_type !== 'wearable' || device.online !== true) {
        throw Object.assign(new Error('Requested device is offline'), { statusCode: 409 });
      }
    } else {
      let manufacturerDeviceId;
      if (this.resolveManufacturerDeviceId) {
        manufacturerDeviceId = await this.resolveManufacturerDeviceId(userId, action.device_id);
        if (!boundedIdentifier(manufacturerDeviceId)) {
          throw Object.assign(new Error('Requested device is not bound to this account'), { statusCode: 403 });
        }
      } else {
        if (this.authorizeDevice && !await this.authorizeDevice(userId, action.device_id)) {
          throw Object.assign(new Error('Requested device is not bound to this account'), { statusCode: 403 });
        }
        manufacturerDeviceId = action.device_id;
      }
      let online = device?.device_type === 'home_robot' && device.online === true;
      if (!online && this.getDeviceStatus) {
        const status = await this.getDeviceStatus(manufacturerDeviceId);
        online = status?.online === true;
      }
      if (!online) throw Object.assign(new Error('Requested device is offline'), { statusCode: 409 });
      action = { ...action, manufacturer_device_id: manufacturerDeviceId };
    }
    if (action.device_type === 'wearable') {
      const commandPayload = this.wearableCommandPayloads[action.action];
      if (!commandPayload) {
        throw Object.assign(new Error('Wearable command mapping is not configured'), { statusCode: 503 });
      }
      action = { ...action, parameters: { command_payload: commandPayload } };
    }
    const actionId = deterministicActionId(userId, action);
    const { idempotency_key: _idempotencyKey, ...actionEnvelope } = action;
    const signed = signEnvelope(actionEnvelope, this.signingPrivateKey, Date.now, actionId);
    if (action.device_type === 'wearable') {
      return this.routeWearable(userId, session, signed);
    }
    await this.recoverPendingCommands();
    const queueKey = this.queueKey(userId, action.device_id);
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
          signed,
          created_at: signed.envelope.issued_at
        });
        if (enqueued === false) {
          this.releaseRobotSlot(queueKey);
          return { status: 'accepted', action_id: signed.envelope.id, duplicate: true };
        }
      } catch (error) {
        this.releaseRobotSlot(queueKey);
        throw Object.assign(new Error('Robot command could not be durably queued'), { statusCode: 503, cause: error });
      }
    }
    this.startRobotDelivery(userId, action, signed, queueKey);
    return { status: 'accepted', action_id: signed.envelope.id };
  }

  async waitForDeliveries() { await Promise.allSettled([...this.pendingDeliveries]); }

  async postManufacturer(signed) {
    const controller = new AbortController();
    let timeout;
    const timeoutFailure = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        const error = new Error('Manufacturer webhook timed out');
        error.name = 'TimeoutError';
        reject(error);
      }, this.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        this.fetchImpl(this.manufacturerWebhookURL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': this.manufacturerApiKey },
          body: JSON.stringify(signed),
          signal: controller.signal
        }),
        timeoutFailure
      ]);
    } finally { clearTimeout(timeout); }
  }

  async deliverRobot(signed, { onAttempt } = {}) {
    if (!this.manufacturerWebhookURL || !this.manufacturerApiKey) throw new Error('Manufacturer gateway is not configured');
    let lastError;
    for (let attempt = 0; attempt < this.retries; attempt += 1) {
      try {
        await onAttempt?.(attempt + 1);
        const response = await this.postManufacturer(signed);
        if (response.status !== 202 && !response.ok) throw new Error(`Manufacturer returned ${response.status}`);
        return { acknowledged: response.status !== 202, status: response.status };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < this.retries) await this.sleep(this.retryDelayMs * 2 ** attempt);
      }
    }
    throw lastError;
  }
}

module.exports = {
  ACTIONS,
  ActionGateway,
  ROBOT_FAILURE_MESSAGE,
  createDynamoActionOutboxRepository,
  deriveEd25519PublicKey,
  deterministicActionId,
  parseWearableCommandPayloads,
  redactSerial,
  signEnvelope,
  validateAction
};
