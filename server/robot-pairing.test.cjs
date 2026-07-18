'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDynamoRobotRepository, pairRobot } = require('./robot-pairing.cjs');

test('Dynamo ownership lookup paginates past nonmatching robots without Limit filtering bugs', async () => {
  const inputs = [];
  const responses = [
    { Items: [], LastEvaluatedKey: { PK: 'USER#user-a', SK: 'ROBOT#first' } },
    { Items: [{ id: 'target-robot', manufacturerDeviceId: 'manufacturer-target' }] }
  ];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: { async send(command) { inputs.push(command.input); return responses.shift(); } }
  });
  assert.equal(await repository.owns('user-a', 'target-robot'), true);
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].Limit, undefined);
  assert.deepEqual(inputs[1].ExclusiveStartKey, { PK: 'USER#user-a', SK: 'ROBOT#first' });
});

test('manufacturer routing identity is resolved only through the account binding', async () => {
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: { async send() { return { Items: [{ id: 'robot-1', manufacturerDeviceId: 'manufacturer-opaque-1' }] }; } }
  });
  assert.equal(await repository.resolveManufacturerDeviceId('user-a', 'robot-1'), 'manufacturer-opaque-1');
});

test('robot pairing credential verification is account-bound and timing-safe', async () => {
  const crypto = require('node:crypto');
  const token = 'a'.repeat(43);
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send() {
        return {
          Items: [{
            id: 'robot-1',
            pairingTokenHash: crypto.createHash('sha256').update(token).digest('base64url')
          }]
        };
      }
    }
  });
  assert.equal(await repository.verifyPairingToken('user-a', 'robot-1', token), true);
  assert.equal(await repository.verifyPairingToken('user-a', 'robot-1', 'b'.repeat(43)), false);
  assert.equal(await repository.verifyPairingToken('user-b', 'robot-1', 'short'), false);
});

test('factory reset unbind atomically removes only the authenticated user and matching owner', async () => {
  const inputs = [];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send(command) {
        inputs.push(command.input);
        if (inputs.length === 1) {
          return { Items: [{ id: 'robot-1', manufacturerDeviceId: 'manufacturer-1', serialHash: 'serial-hash', pairingClaimHash: 'A'.repeat(43), SK: 'ROBOT#serial-hash' }] };
        }
        return {};
      }
    }
  });
  assert.deepEqual(await repository.unbind('user-a', 'robot-1'), { manufacturerDeviceId: 'manufacturer-1' });
  const transaction = inputs[1].TransactItems;
  assert.deepEqual(transaction[0].Delete.Key, { PK: 'USER#user-a', SK: 'ROBOT#serial-hash' });
  assert.deepEqual(transaction[1].Delete.Key, { PK: 'ROBOT#serial-hash', SK: 'OWNER' });
  assert.equal(transaction[1].Delete.ExpressionAttributeValues[':userId'], 'user-a');
  assert.equal(transaction[2].Update.UpdateExpression, 'SET unbound_at = :now REMOVE bound_to, serial_hash');
});

test('account robot listing paginates and returns only safe public descriptors', async () => {
  const responses = [
    {
      Items: [{ id: 'robot-1', pairedAt: 100, online: true, manufacturerDeviceId: 'secret-route', serialHash: 'secret-serial-hash', pairingTokenHash: 'secret-token-hash' }],
      LastEvaluatedKey: { PK: 'USER#user-a', SK: 'ROBOT#first' }
    },
    { Items: [{ id: 'robot-2', pairedAt: 200, online: false }] }
  ];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: { async send() { return responses.shift(); } }
  });
  const robots = await repository.list('user-a');
  assert.deepEqual(robots, [
    { robot_id: 'robot-1', device_type: 'home_robot', paired_at: 100 },
    { robot_id: 'robot-2', device_type: 'home_robot', paired_at: 200 }
  ]);
  assert.doesNotMatch(JSON.stringify(robots), /serial|token|secret/i);
});

test('a consumed QR claim persists used_at/bound_to and rejects cross-account replay with 410', async () => {
  const claims = new Map();
  const logs = [];
  const repository = {
    async consumeAndBind(userId, hash, _robot, usedAt) {
      if (claims.has(hash)) throw Object.assign(new Error('used'), { statusCode: 410, code: 'ROBOT_PAIRING_REPLAY' });
      claims.set(hash, { used_at: usedAt, bound_to: userId });
    }
  };
  const options = {
    qrCode: 'manufacturer-one-time-code-12345',
    verifier: async () => ({ hardwareSerial: 'PRIVATE-SERIAL-1', manufacturerDeviceId: 'manufacturer-robot-1', oneTime: true, expiresAt: 10000 }),
    repository,
    logger: { info() {}, warn(message, context) { logs.push({ message, context }); } },
    now: () => 5000
  };
  await pairRobot({ ...options, userId: 'user-a' });
  await assert.rejects(pairRobot({ ...options, userId: 'user-b' }), (error) => error.statusCode === 410);
  assert.deepEqual([...claims.values()], [{ used_at: 5000, bound_to: 'user-a' }]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-SERIAL-1/);
});

test('expired manufacturer claims fail before DynamoDB mutation', async () => {
  let mutations = 0;
  await assert.rejects(pairRobot({
    userId: 'user-a', qrCode: 'manufacturer-expired-code-12345', now: () => 5001,
    verifier: async () => ({ hardwareSerial: 'serial', manufacturerDeviceId: 'manufacturer-robot-1', oneTime: true, expiresAt: 5000 }),
    repository: { async consumeAndBind() { mutations += 1; } }
  }), (error) => error.statusCode === 410);
  assert.equal(mutations, 0);
});
