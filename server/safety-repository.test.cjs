'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDynamoSafetyRepository } = require('./safety-api.cjs');

function transactionCancellation(reasons) {
  return Object.assign(new Error('transaction was cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: reasons
  });
}

test('emergency-contact writes retain atomic constraints without an account-state table', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'QueryCommand') return { Items: [] };
      return {};
    }
  };
  const repository = createDynamoSafetyRepository({ tableName: 'safety', client });
  await repository.createContact('user-1', {
    id: 'contact_123', name: 'Caregiver', phone: '+15555550100', countryCode: 'US', version: 1
  });
  assert.deepEqual(commands, ['QueryCommand', 'TransactWriteCommand']);
});

test('Dynamo safety writes share an atomic account-deletion fence', async () => {
  const transactions = [];
  const deliveryClaims = new Map();
  let contactQueryCount = 0;
  const contact = {
    id: 'contact_123',
    name: 'Caregiver',
    phone: '+15555550100',
    countryCode: 'US',
    version: 1,
    entity: 'contact'
  };
  const client = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'TransactWriteCommand') {
        transactions.push(command.input.TransactItems);
        const update = command.input.TransactItems.find((item) => item.Update)?.Update;
        const claimToken = update?.ExpressionAttributeValues?.[':claimToken'];
        if (claimToken) deliveryClaims.set(update.Key.SK, claimToken);
        return {};
      }
      if (name === 'QueryCommand') {
        contactQueryCount += 1;
        return { Items: contactQueryCount === 1 ? [] : [contact] };
      }
      if (name === 'GetCommand') {
        const sortKey = command.input.Key.SK;
        if (sortKey === `CONTACT#${contact.id}`) return { Item: contact };
        if (sortKey.startsWith('SOS#')) {
          return { Item: {
            status: 'accepted',
            deliveryStatus: 'pending',
            idempotencyKey: 'sos-key',
            deliveryClaimToken: deliveryClaims.get(sortKey)
          } };
        }
        if (sortKey.startsWith('MEDICATION_ESCALATION#')) {
          return { Item: {
            status: 'accepted',
            deliveryStatus: 'pending',
            idempotencyKey: 'med-key',
            deliveryClaimToken: deliveryClaims.get(sortKey)
          } };
        }
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoSafetyRepository({
    tableName: 'safety',
    accountStateTableName: 'auth-sessions',
    client
  });
  await repository.createContact('user-1', contact);
  await repository.updateContact('user-1', contact.id, { ...contact, version: 2, updatedAt: 2 }, 1);
  await repository.deleteContact('user-1', contact.id);
  await repository.acceptSOS('user-1', { idempotencyKey: 'sos-key', status: 'accepted' });
  const sosClaim = await repository.claimSOSDelivery('user-1', 'sos-key');
  await repository.recordSOSDelivery('user-1', 'sos-key', {
    deliveryStatus: 'delivered', eligibleCount: 1, deliveredCount: 1, failedCount: 0,
    claimToken: sosClaim.deliveryClaimToken
  });
  await repository.acceptMedicationEscalation('user-1', { idempotencyKey: 'med-key', status: 'accepted' });
  const medicationClaim = await repository.claimMedicationEscalationDelivery('user-1', 'med-key');
  await repository.recordMedicationEscalationDelivery('user-1', 'med-key', {
    deliveryStatus: 'failed', eligibleCount: 1, deliveredCount: 0, failedCount: 1,
    claimToken: medicationClaim.deliveryClaimToken
  });
  await repository.startSafetySession('user-1', {
    id: 'session-1',
    idempotencyKey: 'safety_session_key_0001',
    requestFingerprint: 'fingerprint',
    mode: 'guardian',
    status: 'active',
    startedAt: 1,
    location: null,
    expiresAt: 2
  });

  assert.equal(transactions.length, 10);
  for (const items of transactions) {
    assert.equal(items[0].ConditionCheck.TableName, 'auth-sessions');
    assert.deepEqual(items[0].ConditionCheck.Key, { PK: 'USER#user-1', SK: 'ACCOUNT#STATE' });
    assert.match(items[0].ConditionCheck.ConditionExpression, /deletion_state = :active/);
  }
  assert.deepEqual(transactions.map((items) => items.length), [4, 3, 4, 2, 2, 2, 2, 2, 2, 3]);
  assert.deepEqual(transactions.slice(3).map((items) => Object.keys(items[1])[0]), [
    'Put', 'Update', 'Update', 'Put', 'Update', 'Update', 'Put'
  ]);
  assert.equal(transactions[0][1].Put.Item.entity, 'contact-phone-reservation');
  assert.equal(transactions[0][3].Update.ExpressionAttributeValues[':limit'], 10);
  assert.equal(transactions[1][1].Put.Item.contactId, contact.id);
  assert.equal(Object.keys(transactions[2][1])[0], 'Delete');
  assert.equal(Object.keys(transactions[2][2])[0], 'Delete');
  const sosClaimUpdate = transactions[4][1].Update;
  assert.match(sosClaimUpdate.ConditionExpression, /deliveryClaimExpiresAt <= :attemptedAt/);
  assert.equal(sosClaimUpdate.ExpressionAttributeValues[':maxAttempts'], 5);
  const sosRecordUpdate = transactions[5][1].Update;
  assert.match(sosRecordUpdate.ConditionExpression, /deliveryClaimToken = :claimToken/);
  assert.match(sosRecordUpdate.UpdateExpression, /REMOVE deliveryClaimToken, deliveryClaimExpiresAt/);
  const safetySessionReceipt = transactions[9][1].Put;
  assert.equal(safetySessionReceipt.Item.SK, 'SAFETY_SESSION#safety_session_key_0001');
  assert.match(safetySessionReceipt.ConditionExpression, /attribute_not_exists/);
  assert.equal(safetySessionReceipt.Item.expiresAt, 2);
  assert.equal(transactions[9][2].Put.Item.SK, 'SAFETY#CURRENT');
  assert.equal(transactions[9][2].Put.Item.expiresAt, undefined);
});

test('Dynamo safety writes fail closed when account deletion wins the transaction', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'TransactWriteCommand') {
        throw transactionCancellation([{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }]);
      }
      if (command.constructor.name === 'GetCommand') return { Item: { deletion_state: 'deleting' } };
      throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  };
  const repository = createDynamoSafetyRepository({
    tableName: 'safety',
    accountStateTableName: 'auth-sessions',
    client
  });

  await assert.rejects(
    repository.startSafetySession('user-1', {
      id: 'session-1',
      idempotencyKey: 'safety_session_key_0001',
      requestFingerprint: 'fingerprint',
      mode: 'guardian',
      status: 'active',
      startedAt: 1,
      location: null
    }),
    { statusCode: 423, code: 'ACCOUNT_DELETION_IN_PROGRESS' }
  );
  assert.deepEqual(commands, ['TransactWriteCommand', 'GetCommand']);
});

test('Dynamo safety session retries return the original receipt without replacing current state', async () => {
  const original = {
    id: 'session-original',
    idempotencyKey: 'safety_session_key_0001',
    requestFingerprint: 'original-fingerprint',
    mode: 'guardian',
    status: 'active',
    startedAt: 100,
    location: null,
    expiresAt: 200
  };
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'TransactWriteCommand') {
        throw transactionCancellation([{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }]);
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: original };
      }
      throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  };
  const repository = createDynamoSafetyRepository({ tableName: 'safety', client });
  const replay = await repository.startSafetySession('user-1', {
    ...original,
    mode: 'home',
    status: 'inactive',
    startedAt: 300
  });

  assert.deepEqual(replay, original);
  assert.deepEqual(commands, ['TransactWriteCommand', 'GetCommand']);
});

test('Dynamo safety export is bounded and deletion processes fixed-size pages', async () => {
  let exportQueries = 0;
  const exportClient = {
    async send(command) {
      assert.equal(command.constructor.name, 'QueryCommand');
      assert.ok(command.input.Limit <= 100);
      exportQueries += 1;
      return {
        Items: Array.from({ length: command.input.Limit }, (_, index) => ({
          PK: 'USER#user-1', SK: `SOS#${exportQueries}-${index}`, entity: 'sos'
        })),
        LastEvaluatedKey: { PK: 'USER#user-1', SK: `SOS#page-${exportQueries}` }
      };
    }
  };
  const exportRepository = createDynamoSafetyRepository({ tableName: 'safety', client: exportClient });
  await assert.rejects(exportRepository.exportUserData('user-1'), {
    statusCode: 413,
    code: 'SAFETY_EXPORT_LIMIT_EXCEEDED'
  });
  assert.equal(exportQueries, 101);

  let queryPage = 0;
  const batchSizes = [];
  const deleteClient = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'QueryCommand') {
        assert.equal(command.input.Limit, 100);
        queryPage += 1;
        const count = queryPage === 1 ? 100 : 30;
        return {
          Items: Array.from({ length: count }, (_, index) => ({
            PK: 'USER#user-1', SK: `SOS#${queryPage}-${index}`
          })),
          ...(queryPage === 1 ? { LastEvaluatedKey: { PK: 'USER#user-1', SK: 'SOS#next' } } : {})
        };
      }
      if (name === 'BatchWriteCommand') {
        batchSizes.push(command.input.RequestItems.safety.length);
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const deleteRepository = createDynamoSafetyRepository({ tableName: 'safety', client: deleteClient });
  assert.deepEqual(await deleteRepository.deleteUserData('user-1'), { deletedItems: 130 });
  assert.deepEqual(batchSizes, [25, 25, 25, 25, 25, 5]);
});
