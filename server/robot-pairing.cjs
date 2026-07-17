'use strict';

const crypto = require('node:crypto');
const { redactSerial } = require('./action-gateway.cjs');

function createDynamoRobotRepository({ tableName, region }) {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
  return {
    async bind(userId, robot) {
      await client.send(new PutCommand({
        TableName: tableName,
        Item: { PK: `USER#${userId}`, SK: `ROBOT#${robot.serialHash}`, entity: 'home-robot', ...robot },
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
      }));
      return robot;
    }
  };
}

async function pairRobot({ userId, qrCode, verifier, repository, logger = console }) {
  if (typeof qrCode !== 'string' || qrCode.length < 20 || qrCode.length > 2048) throw Object.assign(new Error('Pairing code is invalid'), { statusCode: 400 });
  if (typeof verifier !== 'function') throw Object.assign(new Error('Manufacturer pairing verification is unavailable'), { statusCode: 503 });
  const verified = await verifier(qrCode);
  if (!verified?.hardwareSerial || verified.oneTime !== true) throw Object.assign(new Error('Pairing code was rejected'), { statusCode: 403 });
  const serialHash = crypto.createHash('sha256').update(verified.hardwareSerial).digest('base64url');
  const pairingToken = crypto.randomBytes(32).toString('base64url');
  const record = { id: crypto.randomUUID(), serialHash, pairingTokenHash: crypto.createHash('sha256').update(pairingToken).digest('base64url'), pairedAt: Date.now(), online: false };
  await repository.bind(userId, record);
  logger.info('[RobotPairing] Robot bound', { hardwareSerial: redactSerial(verified.hardwareSerial), robotId: record.id });
  return { robot_id: record.id, pairing_token: pairingToken, device_type: 'home_robot' };
}

module.exports = { createDynamoRobotRepository, pairRobot };
