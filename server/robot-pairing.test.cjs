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
    client: { async send() { return { Items: [{
      id: 'robot-1', manufacturerDeviceId: 'manufacturer-opaque-1', adapterId: 'jiangzhi-edge',
      bindingEpoch: 3, lifecycleState: 'active'
    }] }; } }
  });
  assert.equal(await repository.resolveManufacturerDeviceId('user-a', 'robot-1'), 'manufacturer-opaque-1');
  assert.deepEqual(await repository.resolveRobotBinding('user-a', 'robot-1'), {
    manufacturerDeviceId: 'manufacturer-opaque-1',
    adapterId: 'jiangzhi-edge',
    bindingEpoch: 3,
    lifecycleState: 'active'
  });
});

test('manufacturer privacy bindings retain adapter identity and deduplicate exact targets', async () => {
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send() {
        return { Items: [
          { manufacturerDeviceId: 'legacy-1' },
          { manufacturerDeviceId: 'yongyida-1', adapterId: 'yongyida-cloud' },
          { manufacturerDeviceId: 'yongyida-1', adapterId: 'yongyida-cloud' },
          { manufacturerDeviceId: 'jiangzhi-1', adapterId: 'jiangzhi-edge' },
          { manufacturerDeviceId: '../invalid', adapterId: 'jiangzhi-edge' }
        ] };
      }
    }
  });
  assert.deepEqual(await repository.listManufacturerRobotBindings('user-a'), [
    { adapterId: 'manufacturer-default', manufacturerDeviceId: 'legacy-1' },
    { adapterId: 'yongyida-cloud', manufacturerDeviceId: 'yongyida-1' },
    { adapterId: 'jiangzhi-edge', manufacturerDeviceId: 'jiangzhi-1' }
  ]);
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

test('Dynamo pairing recovery rotates only the original account binding token', async () => {
  const inputs = [];
  const claimHash = 'C'.repeat(43);
  const serialHash = 'S'.repeat(43);
  const responses = [
    { Item: { used_at: 5000, bound_to: 'user-a', serial_hash: serialHash } },
    { Item: {
      id: 'robot-1', adapterId: 'jiangzhi-edge', pairingClaimHash: claimHash,
      bindingEpoch: 2, lifecycleState: 'active'
    } },
    {},
    { Item: { used_at: 5000, bound_to: 'user-a', serial_hash: serialHash } }
  ];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: { async send(command) { inputs.push(command.input); return responses.shift(); } }
  });
  assert.deepEqual(await repository.resumeBinding('user-a', claimHash, 'T'.repeat(43)), {
    id: 'robot-1',
    adapterId: 'jiangzhi-edge',
    pairingClaimHash: claimHash,
    bindingEpoch: 2,
    lifecycleState: 'active'
  });
  assert.deepEqual(inputs[2].Key, { PK: 'USER#user-a', SK: `ROBOT#${serialHash}` });
  assert.equal(inputs[2].ExpressionAttributeValues[':tokenHash'], 'T'.repeat(43));
  await assert.rejects(
    repository.resumeBinding('user-b', claimHash, 'U'.repeat(43)),
    (error) => error.statusCode === 410 && error.code === 'ROBOT_PAIRING_REPLAY'
  );
  assert.equal(inputs.length, 4);
});

test('pairing transaction atomically loses to an account-deletion fence', async () => {
  const inputs = [];
  let accountState = 'active';
  let transactionAttempts = 0;
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    accountStateTableName: 'auth-state',
    client: {
      async send(command) {
        const input = command.input;
        inputs.push(input);
        if (input.TableName === 'auth-state') {
          return accountState === 'active' ? {} : { Item: { deletion_state: accountState } };
        }
        if (input.TransactItems) {
          transactionAttempts += 1;
          const condition = input.TransactItems[0].ConditionCheck;
          assert.deepEqual(condition.Key, { PK: 'USER#user-a', SK: 'ACCOUNT#STATE' });
          assert.equal(condition.TableName, 'auth-state');
          assert.match(condition.ConditionExpression, /deletion_state = :active/);
          accountState = 'deleting';
          throw Object.assign(new Error('transaction raced account deletion'), {
            name: 'TransactionCanceledException'
          });
        }
        return {};
      }
    }
  });

  await assert.rejects(repository.consumeAndBind('user-a', 'C'.repeat(43), {
    id: 'robot-1',
    adapterId: 'jiangzhi-edge',
    manufacturerDeviceId: 'manufacturer-1',
    vendorNamespace: 'jiangzhi',
    serialHash: 'S'.repeat(43),
    pairingTokenHash: 'T'.repeat(43),
    pairingClaimHash: 'C'.repeat(43),
    pairedAt: 1000
  }, 1000), (error) => (
    error.statusCode === 423 && error.code === 'ACCOUNT_DELETION_IN_PROGRESS'
  ));
  assert.equal(transactionAttempts, 1);
  assert.equal(inputs.at(-1).ConsistentRead, true);
});

test('factory reset unbind atomically removes only the authenticated user and matching owner', async () => {
  const inputs = [];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send(command) {
        inputs.push(command.input);
        if (inputs.length === 1) {
          return { Items: [{
            id: 'robot-1', manufacturerDeviceId: 'manufacturer-1', serialHash: 'serial-hash',
            pairingClaimHash: 'A'.repeat(43), bindingEpoch: 4, lifecycleState: 'active', SK: 'ROBOT#serial-hash'
          }] };
        }
        return {};
      }
    }
  });
  assert.deepEqual(await repository.unbind('user-a', 'robot-1'), {
    manufacturerDeviceId: 'manufacturer-1',
    adapterId: 'manufacturer-default',
    bindingEpoch: 4
  });
  const transaction = inputs[1].TransactItems;
  assert.deepEqual(transaction[0].Delete.Key, { PK: 'USER#user-a', SK: 'ROBOT#serial-hash' });
  const ownerPut = transaction[1].Put;
  assert.equal(ownerPut.ExpressionAttributeValues[':userId'], 'user-a');
  assert.deepEqual(ownerPut.Item, {
    PK: 'ROBOT#serial-hash',
    SK: 'OWNER',
    lifecycleState: 'unbound',
    bindingEpoch: 4,
    bindingEpochHighWater: 4,
    unboundAt: ownerPut.Item.unboundAt
  });
  assert.equal(Number.isFinite(ownerPut.Item.unboundAt), true);
  assert.doesNotMatch(JSON.stringify(ownerPut.Item), /bound_to|user-a|robot-1|manufacturer-1|pairing/i);
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
    { robot_id: 'robot-1', device_type: 'home_robot', adapter_id: 'manufacturer-default', paired_at: 100 },
    { robot_id: 'robot-2', device_type: 'home_robot', adapter_id: 'manufacturer-default', paired_at: 200 }
  ]);
  assert.doesNotMatch(JSON.stringify(robots), /serial|token|secret/i);
});

test('a consumed QR claim persists used_at/bound_to and rejects cross-account replay with 410', async () => {
  const claims = new Map();
  const robots = new Map();
  const logs = [];
  const infoLogs = [];
  let verifierCalls = 0;
  const repository = {
    async resumeBinding(userId, hash, pairingTokenHash) {
      const claim = claims.get(hash);
      if (!claim) return null;
      if (claim.bound_to !== userId) {
        throw Object.assign(new Error('used'), { statusCode: 410, code: 'ROBOT_PAIRING_REPLAY' });
      }
      const robot = robots.get(hash);
      robot.pairingTokenHash = pairingTokenHash;
      return robot;
    },
    async consumeAndBind(userId, hash, robot, usedAt) {
      if (claims.has(hash)) throw Object.assign(new Error('used'), { statusCode: 410, code: 'ROBOT_PAIRING_REPLAY' });
      claims.set(hash, { used_at: usedAt, bound_to: userId });
      robots.set(hash, robot);
      return robot;
    }
  };
  const options = {
    qrCode: 'manufacturer-one-time-code-12345',
    pairingScope: 'yongyida',
    pairingTokenSecret: 'test-robot-pairing-token-secret-at-least-32-characters',
    verifier: async () => {
      verifierCalls += 1;
      return {
        adapterId: 'yongyida-primary',
        hardwareSerial: 'PRIVATE-SERIAL-1',
        manufacturerDeviceId: 'manufacturer-robot-1',
        oneTime: true,
        expiresAt: 10000
      };
    },
    repository,
    logger: {
      info(message, context) { infoLogs.push({ message, context }); },
      warn(message, context) { logs.push({ message, context }); }
    },
    now: () => 5000
  };
  const first = await pairRobot({ ...options, userId: 'user-a' });
  const resumed = await pairRobot({ ...options, userId: 'user-a' });
  await assert.rejects(pairRobot({ ...options, userId: 'user-b' }), (error) => error.statusCode === 410);
  assert.equal(resumed.robot_id, first.robot_id);
  assert.equal(resumed.pairing_token, first.pairing_token);
  assert.equal(verifierCalls, 1);
  assert.deepEqual([...claims.values()], [{ used_at: 5000, bound_to: 'user-a' }]);
  assert.equal(logs.length, 1);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE-SERIAL-1/);
  assert.equal(infoLogs.length, 2);
  assert.doesNotMatch(JSON.stringify(infoLogs), new RegExp(first.robot_id));
  assert.match(infoLogs[0].context.robotReference, /^robot_[a-f0-9]{12}$/);
});

test('expired manufacturer claims fail before DynamoDB mutation', async () => {
  let mutations = 0;
  await assert.rejects(pairRobot({
    userId: 'user-a', qrCode: 'manufacturer-expired-code-12345', now: () => 5001,
    pairingTokenSecret: 'test-robot-pairing-token-secret-at-least-32-characters',
    verifier: async () => ({ hardwareSerial: 'serial', manufacturerDeviceId: 'manufacturer-robot-1', oneTime: true, expiresAt: 5000 }),
    repository: {
      async resumeBinding() { return null; },
      async consumeAndBind() { mutations += 1; }
    }
  }), (error) => error.statusCode === 410);
  assert.equal(mutations, 0);
});

test('hardware serial ownership is namespaced by stable vendor and dual-checks legacy keys', async () => {
  const records = [];
  const repository = {
    async resumeBinding() { return null; },
    async consumeAndBind(_userId, _claimHash, robot) {
      records.push(robot);
      return robot;
    }
  };
  const common = {
    userId: 'user-a',
    pairingTokenSecret: 'test-robot-pairing-token-secret-at-least-32-characters',
    repository,
    now: () => 5000,
    verifier: async () => ({
      hardwareSerial: 'COLLIDING-SERIAL-001',
      manufacturerDeviceId: 'manufacturer-device-1',
      oneTime: true,
      expiresAt: 10000
    })
  };
  await pairRobot({
    ...common, qrCode: 'yongyida-one-time-code-12345', pairingScope: 'yongyida'
  });
  await pairRobot({
    ...common, qrCode: 'jiangzhi-one-time-code-12345', pairingScope: 'jiangzhi'
  });
  assert.notEqual(records[0].serialHash, records[1].serialHash);
  assert.equal(records[0].legacySerialHash, records[1].legacySerialHash);
  assert.deepEqual(records.map(({ vendorNamespace }) => vendorNamespace), ['yongyida', 'jiangzhi']);

  const transactions = [];
  const dynamo = createDynamoRobotRepository({
    tableName: 'devices',
    client: { async send(command) { transactions.push(command.input); return {}; } }
  });
  await dynamo.consumeAndBind('user-a', 'C'.repeat(43), records[0], 5000);
  const items = transactions.find((input) => input.TransactItems).TransactItems;
  const legacyCheck = items.find((item) => item.ConditionCheck)?.ConditionCheck;
  assert.deepEqual(legacyCheck.Key, { PK: `ROBOT#${records[0].legacySerialHash}`, SK: 'OWNER' });
  assert.match(legacyCheck.ConditionExpression, /attribute_not_exists/);
  const userItem = items.find((item) => item.Put?.Item?.entity === 'home-robot').Put.Item;
  assert.equal(userItem.vendorNamespace, 'yongyida');
  assert.equal(userItem.legacySerialHash, undefined);
  assert.equal(userItem.bindingEpoch, 1);
  assert.equal(userItem.lifecycleState, 'active');
});

test('re-pairing allocates the next binding epoch from the durable owner tombstone', async () => {
  const inputs = [];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send(command) {
        inputs.push(command.input);
        if (command.input.Key?.SK === 'OWNER') {
          return { Item: { lifecycleState: 'unbound', bindingEpoch: 7, bindingEpochHighWater: 7 } };
        }
        return {};
      }
    }
  });
  const robot = {
    id: 'robot-new',
    adapterId: 'jiangzhi-edge',
    manufacturerDeviceId: 'manufacturer-new',
    vendorNamespace: 'jiangzhi',
    serialHash: 'S'.repeat(43),
    pairingTokenHash: 'T'.repeat(43),
    pairingClaimHash: 'C'.repeat(43),
    pairedAt: 5000
  };
  const result = await repository.consumeAndBind('user-b', 'C'.repeat(43), robot, 5000);
  assert.equal(result.bindingEpoch, 8);
  const transaction = inputs.find((input) => input.TransactItems).TransactItems;
  const ownerPut = transaction.find((item) => item.Put?.Item?.entity === 'robot-owner').Put;
  assert.equal(ownerPut.Item.bindingEpoch, 8);
  assert.equal(ownerPut.Item.bindingEpochHighWater, 8);
  assert.equal(ownerPut.ExpressionAttributeValues[':expectedHighWater'], 7);
});

test('factory reset begin durably fences routing and same-token retries reuse the reset id', async () => {
  const crypto = require('node:crypto');
  const token = 'x'.repeat(43);
  const tokenHash = crypto.createHash('sha256').update(token).digest('base64url');
  const inputs = [];
  let queryCount = 0;
  const baseRecord = {
    id: 'robot-1', manufacturerDeviceId: 'manufacturer-1', adapterId: 'yongyida-cloud',
    serialHash: 'S'.repeat(43), pairingTokenHash: tokenHash, bindingEpoch: 9,
    lifecycleState: 'active', SK: `ROBOT#${'S'.repeat(43)}`
  };
  let firstResetId;
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send(command) {
        inputs.push(command.input);
        if (command.input.KeyConditionExpression) {
          queryCount += 1;
          if (queryCount === 1) return { Items: [baseRecord] };
          return { Items: [{
            ...baseRecord,
            lifecycleState: 'reset_pending',
            resetId: firstResetId,
            resetRequestedAt: 1000,
            nextResetAttemptAt: 1000,
            resetAttempt: 0
          }] };
        }
        if (command.input.TransactItems) {
          firstResetId = command.input.TransactItems[0].Update.ExpressionAttributeValues[':resetId'];
          return {};
        }
        return {};
      }
    }
  });
  const first = await repository.beginFactoryReset('user-a', 'robot-1', token, 1000);
  const retry = await repository.beginFactoryReset('user-a', 'robot-1', token, 1001);
  assert.equal(first.resetId, retry.resetId);
  assert.equal(first.bindingEpoch, 9);
  assert.equal(retry.lifecycleState, 'reset_pending');
  assert.equal(inputs.filter((input) => input.TransactItems).length, 1);
  const transaction = inputs.find((input) => input.TransactItems).TransactItems;
  assert.match(transaction[0].Update.ConditionExpression, /lifecycleState = :active/);
  assert.match(transaction[1].Update.UpdateExpression, /resetId/);
});

test('only the active binding epoch resolves for command delivery', async () => {
  let state = 'active';
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send() {
        return { Items: [{
          id: 'robot-1', manufacturerDeviceId: 'manufacturer-1', adapterId: 'jiangzhi-edge',
          bindingEpoch: 12, lifecycleState: state, SK: 'ROBOT#serial'
        }] };
      }
    }
  });
  const binding = await repository.resolveRobotBinding('user-a', 'robot-1');
  assert.equal(binding.bindingEpoch, 12);
  assert.equal(await repository.isRobotBindingActive('user-a', 'robot-1', binding), true);
  state = 'reset_pending';
  assert.equal(await repository.resolveRobotBinding('user-a', 'robot-1'), null);
  assert.equal(await repository.isRobotBindingActive('user-a', 'robot-1', binding), false);
});

test('legacy bindings without a durable epoch fail closed instead of inferring ownership order', async () => {
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send() {
        return { Items: [{
          id: 'robot-legacy', manufacturerDeviceId: 'manufacturer-legacy',
          adapterId: 'manufacturer-default', pairingTokenHash: 'H'.repeat(43),
          serialHash: 'S'.repeat(43), SK: `ROBOT#${'S'.repeat(43)}`
        }] };
      }
    }
  });
  assert.equal(await repository.resolveRobotBinding('user-a', 'robot-legacy'), null);
  assert.equal(await repository.resolveManufacturerDeviceId('user-a', 'robot-legacy'), null);
  assert.equal(await repository.isRobotBindingActive('user-a', 'robot-legacy'), false);
  await assert.rejects(
    repository.unbind('user-a', 'robot-legacy'),
    (error) => error.code === 'ROBOT_BINDING_MIGRATION_REQUIRED'
  );
});

test('account deletion removes reset response receipts but preserves physical owner tombstones', async () => {
  const inputs = [];
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send(command) {
        inputs.push(command.input);
        const prefix = command.input.ExpressionAttributeValues?.[':prefix'];
        if (prefix === 'ROBOT#') return { Items: [] };
        if (prefix === 'ROBOT_RESET#') return { Items: [{ SK: 'ROBOT_RESET#robot-private' }] };
        return {};
      }
    }
  });
  assert.deepEqual(await repository.deleteUserData('user-a'), { deletedItems: 1 });
  const deletion = inputs.find((input) => input.Key?.SK === 'ROBOT_RESET#robot-private');
  assert.deepEqual(deletion.Key, { PK: 'USER#user-a', SK: 'ROBOT_RESET#robot-private' });
  assert.equal(deletion.ConditionExpression, 'entity = :entity');
  assert.equal(inputs.some((input) => input.Key?.PK?.startsWith('ROBOT#')), false);
});

test('factory reset completion retains only an identity-free owner epoch tombstone', async () => {
  const inputs = [];
  const serialHash = 'S'.repeat(43);
  const record = {
    id: 'robot-private',
    manufacturerDeviceId: 'manufacturer-private',
    adapterId: 'yongyida-cloud',
    serialHash,
    pairingTokenHash: 'T'.repeat(43),
    pairingClaimHash: 'C'.repeat(43),
    bindingEpoch: 15,
    lifecycleState: 'reset_remote_complete',
    resetId: 'reset-operation-stable-123',
    resetRemoteCompletedAt: 1900,
    SK: `ROBOT#${serialHash}`
  };
  const repository = createDynamoRobotRepository({
    tableName: 'devices',
    client: {
      async send(command) {
        inputs.push(command.input);
        if (command.input.KeyConditionExpression) return { Items: [record] };
        return {};
      }
    }
  });
  const result = await repository.completeFactoryReset(
    'user-private', 'robot-private', record.resetId, 15, 2000
  );
  assert.equal(result.completed, true);
  const transaction = inputs.find((input) => input.TransactItems).TransactItems;
  const ownerPut = transaction.find((item) => item.Put?.Item?.SK === 'OWNER').Put;
  assert.deepEqual(ownerPut.Item, {
    PK: `ROBOT#${serialHash}`,
    SK: 'OWNER',
    lifecycleState: 'unbound',
    bindingEpoch: 15,
    bindingEpochHighWater: 15,
    resetCompletedAt: 2000
  });
  assert.deepEqual(Object.keys(ownerPut.Item).sort(), [
    'PK',
    'SK',
    'bindingEpoch',
    'bindingEpochHighWater',
    'lifecycleState',
    'resetCompletedAt'
  ]);
  assert.doesNotMatch(
    JSON.stringify(ownerPut.Item),
    /user-private|robot-private|manufacturer-private|reset-operation|pairing/i
  );
  const receipt = transaction.find((item) => item.Put?.Item?.entity === 'robot-reset-receipt').Put.Item;
  assert.equal(receipt.resetId, record.resetId);
  assert.equal(receipt.bindingEpoch, 15);
  assert.equal(receipt.manufacturerDeviceId, undefined);
});
