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
        ProjectionExpression: 'id, manufacturerDeviceId',
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
      }));
      const match = result.Items?.find((item) => item.id === robotId);
      if (match) return match;
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return null;
  }
  return {
    async owns(userId, robotId) {
      return Boolean(await findBoundRobot(userId, robotId));
    },
    async resolveManufacturerDeviceId(userId, robotId) {
      const record = await findBoundRobot(userId, robotId);
      return typeof record?.manufacturerDeviceId === 'string' ? record.manufacturerDeviceId : null;
    },
    async list(userId) {
      const robots = [];
      let exclusiveStartKey;
      do {
        const result = await client.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'ROBOT#' },
          ProjectionExpression: 'id, pairedAt',
          ConsistentRead: true,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {})
        }));
        robots.push(...(result.Items || []).flatMap((item) => (
          typeof item.id === 'string' && item.id
            ? [{
                robot_id: item.id,
                device_type: 'home_robot',
                ...(Number.isFinite(item.pairedAt) ? { paired_at: item.pairedAt } : {})
              }]
            : []
        )));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return robots;
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
  const verified = await verifier(qrCode);
  if (
    !verified?.hardwareSerial
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
