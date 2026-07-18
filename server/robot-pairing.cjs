'use strict';

const crypto = require('node:crypto');
const { redactSerial } = require('./action-gateway.cjs');

function createDynamoRobotRepository({ tableName, region, client: injectedClient } = {}) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
  const client = injectedClient || DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
  async function findBoundRobot(userId, robotId) {
    let exclusiveStartKey;
    do {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'id = :id',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'ROBOT#', ':id': robotId },
        ProjectionExpression: 'id, manufacturerDeviceId, serialHash, pairingClaimHash, pairingTokenHash, pairedAt, SK',
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      const match = result.Items?.find((item) => item.id === robotId);
      if (match) return match;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return null;
  }
  async function queryBoundRobots(userId, projectionExpression = 'id, pairedAt') {
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
  async function list(userId) {
    const robots = await queryBoundRobots(userId);
    return robots.flatMap((item) => (
      typeof item.id === 'string' && item.id
        ? [{
            robot_id: item.id,
            device_type: 'home_robot',
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
    const transactions = [
      { Delete: {
        TableName: tableName,
        Key: { PK: `USER#${userId}`, SK: record.SK || `ROBOT#${serialHash}` },
        ConditionExpression: 'id = :robotId',
        ExpressionAttributeValues: { ':robotId': robotId }
      } },
      { Delete: {
        TableName: tableName,
        Key: { PK: `ROBOT#${serialHash}`, SK: 'OWNER' },
        ConditionExpression: 'bound_to = :userId',
        ExpressionAttributeValues: { ':userId': userId }
      } }
    ];
    if (typeof record.pairingClaimHash === 'string' && /^[A-Za-z0-9_-]{43}$/.test(record.pairingClaimHash)) {
      transactions.push({ Update: {
        TableName: tableName,
        Key: { PK: `PAIRING#${record.pairingClaimHash}`, SK: 'CLAIM' },
        UpdateExpression: 'SET unbound_at = :now REMOVE bound_to, serial_hash',
        ConditionExpression: 'bound_to = :userId',
        ExpressionAttributeValues: { ':now': Date.now(), ':userId': userId }
      } });
    }
    await client.send(new TransactWriteCommand({ TransactItems: transactions }));
    return { manufacturerDeviceId: record.manufacturerDeviceId };
  }
  return {
    async owns(userId, robotId) {
      return Boolean(await findBoundRobot(userId, robotId));
    },
    async resolveManufacturerDeviceId(userId, robotId) {
      const record = await findBoundRobot(userId, robotId);
      return typeof record?.manufacturerDeviceId === 'string' ? record.manufacturerDeviceId : null;
    },
    async verifyPairingToken(userId, robotId, token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const record = await findBoundRobot(userId, robotId);
      if (typeof record?.pairingTokenHash !== 'string') return false;
      const supplied = Buffer.from(crypto.createHash('sha256').update(token).digest('base64url'));
      const expected = Buffer.from(record.pairingTokenHash);
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    },
    list,
    async listManufacturerDeviceIds(userId) {
      const robots = await queryBoundRobots(userId, 'manufacturerDeviceId');
      return [...new Set(robots.map((item) => item.manufacturerDeviceId)
        .filter((id) => typeof id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(id)))];
    },
    async exportUserData(userId) {
      return list(userId);
    },
    unbind,
    async deleteUserData(userId) {
      const robots = await queryBoundRobots(userId, 'id');
      let deleted = 0;
      for (const robot of robots) {
        if (typeof robot.id !== 'string') continue;
        if (await unbind(userId, robot.id)) deleted += 1;
      }
      return { deletedItems: deleted };
    },
    async consumeAndBind(userId, pairingCodeHash, robot, usedAt) {
      const pairingKey = { PK: `PAIRING#${pairingCodeHash}`, SK: 'CLAIM' };
      try {
        await client.send(new TransactWriteCommand({ TransactItems: [
          { Update: {
            TableName: tableName,
            Key: pairingKey,
            UpdateExpression: 'SET used_at = :usedAt, bound_to = :userId, serial_hash = :serialHash',
            ConditionExpression: 'attribute_not_exists(used_at)',
            ExpressionAttributeValues: { ':usedAt': usedAt, ':userId': userId, ':serialHash': robot.serialHash }
          } },
          { Put: {
            TableName: tableName,
            Item: { PK: `ROBOT#${robot.serialHash}`, SK: 'OWNER', entity: 'robot-owner', bound_to: userId, pairedAt: usedAt },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          } },
          { Put: {
            TableName: tableName,
            Item: { PK: `USER#${userId}`, SK: `ROBOT#${robot.serialHash}`, entity: 'home-robot', ...robot },
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
          } }
        ] }));
        return robot;
      } catch (error) {
        if (error?.name !== 'TransactionCanceledException') throw error;
        const claim = await client.send(new GetCommand({ TableName: tableName, Key: pairingKey, ConsistentRead: true }));
        const replay = new Error(claim.Item?.used_at ? 'Pairing code has already been used' : 'Robot is already paired');
        replay.statusCode = 410;
        replay.code = 'ROBOT_PAIRING_REPLAY';
        throw replay;
      }
    }
  };
}

async function pairRobot({ userId, qrCode, verifier, repository, logger = console, now = Date.now }) {
  if (typeof qrCode !== 'string' || qrCode.length < 20 || qrCode.length > 2048) throw Object.assign(new Error('Pairing code is invalid'), { statusCode: 400 });
  if (typeof verifier !== 'function') throw Object.assign(new Error('Manufacturer pairing verification is unavailable'), { statusCode: 503 });
  let verified;
  try {
    verified = await verifier(qrCode);
  } catch (error) {
    if (error?.statusCode === 410) {
      logger.warn('[RobotPairing] Pairing replay rejected', {
        claimFingerprint: crypto.createHash('sha256').update(qrCode).digest('hex').slice(0, 12),
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
  const usedAt = now();
  if (!Number.isFinite(verified.expiresAt)) {
    throw Object.assign(new Error('Pairing code expiry is invalid'), { statusCode: 403, code: 'ROBOT_PAIRING_INVALID' });
  }
  if (verified.expiresAt <= usedAt) {
    throw Object.assign(new Error('Pairing code has expired'), { statusCode: 410, code: 'ROBOT_PAIRING_EXPIRED' });
  }
  const serialHash = crypto.createHash('sha256').update(verified.hardwareSerial).digest('base64url');
  const pairingCodeHash = crypto.createHash('sha256').update(qrCode).digest('base64url');
  const pairingToken = crypto.randomBytes(32).toString('base64url');
  const record = {
    id: crypto.randomUUID(),
    manufacturerDeviceId: verified.manufacturerDeviceId,
    serialHash,
    pairingTokenHash: crypto.createHash('sha256').update(pairingToken).digest('base64url'),
    pairingClaimHash: pairingCodeHash,
    pairedAt: usedAt
  };
  try {
    await repository.consumeAndBind(userId, pairingCodeHash, record, usedAt);
  } catch (error) {
    if (error?.statusCode === 410) logger.warn('[RobotPairing] Pairing replay rejected', {
      hardwareSerial: redactSerial(verified.hardwareSerial), code: error.code || 'ROBOT_PAIRING_REPLAY'
    });
    throw error;
  }
  logger.info('[RobotPairing] Robot bound', { hardwareSerial: redactSerial(verified.hardwareSerial), robotId: record.id });
  return { robot_id: record.id, pairing_token: pairingToken, device_type: 'home_robot' };
}

module.exports = { createDynamoRobotRepository, pairRobot };
