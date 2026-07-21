'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  MAX_EXPO_BATCH_SIZE,
  createDynamoPushRepository,
  createEmergencyContactPushNotifier,
  createExpoPushNotifier
} = require('./push-notifications.cjs');
const { handleSafetyAPI } = require('./safety-api.cjs');

function token(index) {
  return `ExpoPushToken[token_${String(index).padStart(8, '0')}]`;
}

test('push re-registration recovers the same durable unregistration receipt after response loss', async () => {
  let registration = null;
  let owner = null;
  let count = 0;
  const client = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        if (command.input.Key.SK === 'META#PUSH_REGISTRATION_COUNT') {
          return { Item: { registration_count: count } };
        }
        if (command.input.Key.SK === 'OWNER') {
          return owner ? { Item: { owner_user_id: owner } } : {};
        }
        return registration ? { Item: { unregister_secret_hash: registration.unregister_secret_hash } } : {};
      }
      if (name === 'TransactWriteCommand') {
        const items = command.input.TransactItems;
        const tokenPut = items.find((item) => item.Put?.Item?.entity === 'push-token')?.Put;
        const ownerPut = items.find((item) => item.Put?.Item?.entity === 'push-token-owner')?.Put;
        const tokenUpdate = items.find((item) => item.Update?.Key?.SK?.startsWith('PUSH#'))?.Update;
        const deletion = items.find((item) => item.Delete?.Key?.SK?.startsWith('PUSH#'))?.Delete;
        if (tokenPut) {
          if (registration) {
            throw Object.assign(new Error('duplicate token'), { name: 'TransactionCanceledException' });
          }
          registration = { ...tokenPut.Item };
          owner = ownerPut.Item.owner_user_id;
          count += 1;
          return {};
        }
        if (tokenUpdate) {
          registration.unregister_secret_hash = tokenUpdate.ExpressionAttributeValues[':unregisterSecretHash'];
          owner = ownerPut.Item.owner_user_id;
          return {};
        }
        if (deletion) {
          assert.equal(
            deletion.ExpressionAttributeValues[':unregisterSecretHash'],
            registration.unregister_secret_hash
          );
          registration = null;
          owner = null;
          count -= 1;
          return {};
        }
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoPushRepository({
    tableName: 'devices',
    client,
    unregisterReceiptSecret: 'test-push-unregister-secret-at-least-32-characters'
  });
  const first = await repository.register('user-1', token(1));
  // Simulate losing the first response before the client can persist it.
  const recovered = await repository.register('user-1', token(1));
  assert.equal(recovered.unregisterReceipt, first.unregisterReceipt);
  assert.equal(await repository.unregisterByReceipt(recovered.unregisterReceipt), true);
  assert.equal(registration, null);
  assert.equal(owner, null);
  assert.equal(count, 0);
  assert.equal(await repository.unregisterByReceipt(recovered.unregisterReceipt), false);
});

test('a physical push token has one global account owner and transfers only after unregister', async () => {
  const registrations = new Map();
  const owners = new Map();
  const counts = new Map([['user-a', 0], ['user-b', 0]]);
  const fingerprint = crypto.createHash('sha256').update(token(7)).digest('base64url');
  const registrationMapKey = (key) => `${key.PK}:${key.SK}`;
  const ownerFingerprint = (key) => key.PK.replace(/^PUSH_TOKEN#/, '');
  const cancelled = () => Object.assign(new Error('conditional conflict'), {
    name: 'TransactionCanceledException'
  });
  const client = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        const { Key } = command.input;
        if (Key.SK === 'META#PUSH_REGISTRATION_COUNT') {
          return { Item: { registration_count: counts.get(Key.PK.replace(/^USER#/, '')) || 0 } };
        }
        if (Key.SK === 'OWNER') {
          const owner = owners.get(ownerFingerprint(Key));
          return owner ? { Item: { owner_user_id: owner } } : {};
        }
        const item = registrations.get(registrationMapKey(Key));
        return item ? { Item: item } : {};
      }
      if (name === 'QueryCommand') {
        const userId = command.input.ExpressionAttributeValues[':pk'].replace(/^USER#/, '');
        return {
          Items: [...registrations.values()].filter((item) => item.PK === `USER#${userId}`)
        };
      }
      if (name === 'BatchGetCommand') {
        return {
          Responses: {
            devices: command.input.RequestItems.devices.Keys.flatMap((key) => {
              const owner = owners.get(ownerFingerprint(key));
              return owner ? [{ ...key, owner_user_id: owner }] : [];
            })
          }
        };
      }
      if (name === 'TransactWriteCommand') {
        const items = command.input.TransactItems;
        const tokenPut = items.find((item) => item.Put?.Item?.entity === 'push-token')?.Put;
        const ownerPut = items.find((item) => item.Put?.Item?.entity === 'push-token-owner')?.Put;
        const tokenUpdate = items.find((item) => item.Update?.Key?.SK?.startsWith('PUSH#'))?.Update;
        const tokenDelete = items.find((item) => item.Delete?.Key?.SK?.startsWith('PUSH#'))?.Delete;
        const ownerDelete = items.find((item) => item.Delete?.Key?.SK === 'OWNER')?.Delete;
        if (ownerPut) {
          const currentOwner = owners.get(ownerFingerprint(ownerPut.Item));
          if (currentOwner && currentOwner !== ownerPut.Item.owner_user_id) throw cancelled();
        }
        if (tokenPut && registrations.has(registrationMapKey(tokenPut.Item))) throw cancelled();
        if (tokenUpdate && !registrations.has(registrationMapKey(tokenUpdate.Key))) throw cancelled();
        if (tokenDelete && !registrations.has(registrationMapKey(tokenDelete.Key))) throw cancelled();

        if (tokenPut) registrations.set(registrationMapKey(tokenPut.Item), { ...tokenPut.Item });
        if (tokenUpdate) Object.assign(
          registrations.get(registrationMapKey(tokenUpdate.Key)),
          { unregister_secret_hash: tokenUpdate.ExpressionAttributeValues[':unregisterSecretHash'] }
        );
        if (ownerPut) owners.set(ownerFingerprint(ownerPut.Item), ownerPut.Item.owner_user_id);
        if (tokenDelete) registrations.delete(registrationMapKey(tokenDelete.Key));
        if (ownerDelete) owners.delete(ownerFingerprint(ownerDelete.Key));
        const counterUpdate = items.find((item) => item.Update?.Key?.SK === 'META#PUSH_REGISTRATION_COUNT')?.Update;
        if (counterUpdate) {
          const userId = counterUpdate.Key.PK.replace(/^USER#/, '');
          counts.set(userId, (counts.get(userId) || 0)
            + (counterUpdate.UpdateExpression.includes('+ :one') ? 1 : -1));
        }
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoPushRepository({
    tableName: 'devices',
    client,
    unregisterReceiptSecret: 'test-push-unregister-secret-at-least-32-characters'
  });

  await repository.register('user-a', token(7));
  await assert.rejects(repository.register('user-b', token(7)), (error) => (
    error.statusCode === 409 && error.code === 'PUSH_TOKEN_ACCOUNT_CONFLICT'
  ));
  assert.deepEqual(await repository.list('user-a'), [token(7)]);
  assert.deepEqual(await repository.list('user-b'), []);

  assert.equal(await repository.unregister('user-a', token(7)), true);
  await repository.register('user-b', token(7));
  assert.deepEqual(await repository.list('user-a'), []);
  assert.deepEqual(await repository.list('user-b'), [token(7)]);
  assert.equal(owners.get(fingerprint), 'user-b');
});

test('push repository bounds registration reads and atomically enforces the account cap', async () => {
  let queryCalls = 0;
  const listClient = {
    async send(command) {
      assert.equal(command.constructor.name, 'QueryCommand');
      queryCalls += 1;
      if (queryCalls === 1) {
        return {
          Items: Array.from({ length: 1000 }, (_, index) => ({ token: token(index) })),
          LastEvaluatedKey: { PK: 'next', SK: 'next' }
        };
      }
      return { Items: [{ token: token(1000) }] };
    }
  };
  const bounded = createDynamoPushRepository({ tableName: 'devices', client: listClient });
  await assert.rejects(bounded.list('user-1'), /registration limit exceeded/);
  assert.equal(queryCalls, 2);

  const capClient = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') return { Item: { registration_count: 1000 } };
      if (name === 'TransactWriteCommand') {
        throw Object.assign(new Error('counter condition failed'), { name: 'TransactionCanceledException' });
      }
      if (name === 'UpdateCommand') {
        throw Object.assign(new Error('token does not exist'), { name: 'ConditionalCheckFailedException' });
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const capped = createDynamoPushRepository({ tableName: 'devices', client: capClient });
  await assert.rejects(capped.register('user-1', token(1001)), (error) => (
    error.statusCode === 409 && /registration limit exceeded/.test(error.message)
  ));
});

test('push counter creation and token registration share the account-deletion transaction fence', async () => {
  const transactions = [];
  const client = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') return {};
      if (name === 'QueryCommand') return { Items: [] };
      if (name === 'TransactWriteCommand') {
        transactions.push(command.input.TransactItems);
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoPushRepository({
    tableName: 'devices',
    accountStateTableName: 'auth-sessions',
    client
  });
  await repository.register('user-1', token(1));

  assert.equal(transactions.length, 2);
  for (const items of transactions) {
    assert.equal(items[0].ConditionCheck.TableName, 'auth-sessions');
    assert.deepEqual(items[0].ConditionCheck.Key, { PK: 'USER#user-1', SK: 'ACCOUNT#STATE' });
    assert.match(items[0].ConditionCheck.ConditionExpression, /deletion_state = :active/);
  }
  assert.deepEqual(transactions.map((items) => items.slice(1).map((item) => Object.keys(item)[0])), [
    ['Put'],
    ['Update', 'Put', 'Put']
  ]);
  assert.equal(transactions[1][3].Put.Item.entity, 'push-token-owner');
  assert.equal(transactions[1][3].Put.Item.owner_user_id, 'user-1');
});

test('push registration fails closed when account deletion wins counter creation', async () => {
  const commands = [];
  const client = {
    async send(command) {
      commands.push(command.constructor.name);
      if (command.constructor.name === 'GetCommand') {
        if (command.input.TableName === 'auth-sessions') return { Item: { deletion_state: 'deleted' } };
        return {};
      }
      if (command.constructor.name === 'QueryCommand') return { Items: [] };
      if (command.constructor.name === 'TransactWriteCommand') {
        throw Object.assign(new Error('account fence failed'), {
          name: 'TransactionCanceledException',
          CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }]
        });
      }
      throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  };
  const repository = createDynamoPushRepository({
    tableName: 'devices',
    accountStateTableName: 'auth-sessions',
    client
  });

  await assert.rejects(repository.register('user-1', token(1)), {
    statusCode: 410,
    code: 'ACCOUNT_DELETED'
  });
  assert.deepEqual(commands, ['GetCommand', 'QueryCommand', 'TransactWriteCommand', 'GetCommand']);
});

test('push privacy deletion processes bounded registration pages before deleting the counter', async () => {
  let queryPage = 0;
  const transactionSizes = [];
  let ownerDeletes = 0;
  const commands = [];
  const client = {
    async send(command) {
      const name = command.constructor.name;
      commands.push(name);
      if (name === 'QueryCommand') {
        assert.equal(command.input.Limit, 100);
        queryPage += 1;
        const count = queryPage === 1 ? 100 : 3;
        return {
          Items: Array.from({ length: count }, (_, index) => ({
            PK: 'USER#user-1',
            SK: `PUSH#${`${queryPage}${index}`.padEnd(43, 'a')}`
          })),
          ...(queryPage === 1 ? { LastEvaluatedKey: { PK: 'USER#user-1', SK: 'PUSH#next' } } : {})
        };
      }
      if (name === 'BatchGetCommand') {
        return {
          Responses: {
            devices: command.input.RequestItems.devices.Keys.map((key) => ({
              ...key,
              owner_user_id: 'user-1'
            }))
          }
        };
      }
      if (name === 'TransactWriteCommand') {
        transactionSizes.push(command.input.TransactItems.length);
        for (const item of command.input.TransactItems.filter((entry) => entry.Delete?.Key?.SK === 'OWNER')) {
          assert.equal(item.Delete.ConditionExpression, 'owner_user_id = :userId');
          assert.equal(item.Delete.ExpressionAttributeValues[':userId'], 'user-1');
          ownerDeletes += 1;
        }
        return {};
      }
      if (name === 'DeleteCommand') return {};
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoPushRepository({ tableName: 'devices', client });

  assert.deepEqual(await repository.deleteUserData('user-1'), { deletedItems: 103 });
  assert.deepEqual(transactionSizes, [50, 50, 50, 50, 6]);
  assert.equal(ownerDeletes, 103);
  assert.equal(commands.at(-1), 'DeleteCommand');
});

test('Expo notifier sends at most 100 messages per request and inspects tickets', async () => {
  const tokens = Array.from({ length: 205 }, (_, index) => token(index));
  const batches = [];
  const notify = createExpoPushNotifier({
    repository: { async list() { return tokens; } },
    fetchImpl: async (_url, options) => {
      const messages = JSON.parse(options.body);
      batches.push(messages);
      return { ok: true, status: 200, async json() { return { data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }; } };
    }
  });
  const result = await notify('user-1', { title: 'Alert', body: 'Network failure' });
  assert.deepEqual(batches.map((batch) => batch.length), [MAX_EXPO_BATCH_SIZE, MAX_EXPO_BATCH_SIZE, 5]);
  assert.ok(batches.flat().every((message, index) => message.to === tokens[index]));
  assert.deepEqual(result, { sent: 205, failed: 0 });
});

test('Expo notifier reports per-ticket rejection and preserves partial delivery', async () => {
  const notify = createExpoPushNotifier({
    repository: { async list() { return [token(1), token(2)]; } },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { data: [{ status: 'ok', id: 'ticket' }, { status: 'error', details: { error: 'DeviceNotRegistered' } }] };
      }
    })
  });
  assert.deepEqual(await notify('user-1', { body: 'Warning' }), { sent: 1, failed: 1 });

  const rejected = createExpoPushNotifier({
    repository: { async list() { return [token(3)]; } },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }; }
    })
  });
  await assert.rejects(rejected('user-1', { body: 'Warning' }), (error) => (
    error.name === 'PushDeliveryError'
    && error.failures[0].code === 'DeviceNotRegistered'
    && !JSON.stringify(error).includes(token(3))
  ));
});

test('Expo notifier deduplicates registrations and preserves delivery across a later batch failure', async () => {
  const tokens = Array.from({ length: 101 }, (_, index) => token(index));
  let calls = 0;
  const notify = createExpoPushNotifier({
    repository: { async list() { return [tokens[0], ...tokens]; } },
    fetchImpl: async (_url, options) => {
      calls += 1;
      const messages = JSON.parse(options.body);
      if (calls === 2) throw new Error('provider connection failed');
      return {
        ok: true,
        status: 200,
        async json() { return { data: messages.map(() => ({ status: 'ok', id: 'ticket' })) }; }
      };
    }
  });
  assert.deepEqual(await notify('user-1', { body: 'Warning' }), { sent: 100, failed: 1 });
  assert.equal(calls, 2);
});

test('Expo notifier bounds a hung provider request', async () => {
  const notify = createExpoPushNotifier({
    repository: { async list() { return [token(1)]; } },
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  });
  await assert.rejects(notify('user-1', { body: 'Warning' }), (error) => error.name === 'TimeoutError');
});

test('Expo notifier rejects and cancels an oversized provider response', async () => {
  let cancelled = 0;
  const notify = createExpoPushNotifier({
    repository: { async list() { return [token(1)]; } },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(300 * 1024) },
      body: { async cancel() { cancelled += 1; } },
      async json() { throw new Error('oversized body must not be parsed'); }
    })
  });
  await assert.rejects(notify('user-1', { body: 'Warning' }), /too large/);
  assert.equal(cancelled, 1);
});

test('emergency-contact notifier awaits verified account resolution and deduplicates recipients', async () => {
  const notification = { title: 'Safety alert', body: 'Open the app.' };
  const calls = [];
  const notify = createEmergencyContactPushNotifier({
    safetyRepository: {
      async listContacts() {
        return [
          { id: 'selected-1', phone: '+6591111111' },
          { id: 'selected-2', phone: '+6592222222' },
          { id: 'selected-3', phone: '+6593333333' },
          { id: 'not-selected', phone: '+6594444444' }
        ];
      }
    },
    async resolvePhoneAccountId(phone) {
      await Promise.resolve();
      if (phone === '+6591111111' || phone === '+6592222222') return 'contact-account';
      if (phone === '+6593333333') return 'sos-owner';
      return 'unselected-account';
    },
    async notifyUser(recipientId, payload) {
      calls.push({ recipientId, payload });
      return { sent: 2, failed: 0 };
    }
  });

  const result = await notify(
    'sos-owner',
    ['selected-1', 'selected-2', 'selected-3'],
    notification
  );

  assert.deepEqual(result, {
    eligible: 1,
    delivered: 1,
    failedRecipients: 0,
    sentNotifications: 2
  });
  assert.deepEqual(calls, [{ recipientId: 'contact-account', payload: notification }]);
});

test('emergency-contact notifier records linked accounts with no successful push as failed recipients', async () => {
  const notify = createEmergencyContactPushNotifier({
    safetyRepository: {
      async listContacts() {
        return [
          { id: 'contact-1', phone: '+6591111111' },
          { id: 'contact-2', phone: '+6592222222' },
          { id: 'contact-3', phone: '+6593333333' }
        ];
      }
    },
    async resolvePhoneAccountId(phone) { return `account:${phone}`; },
    async notifyUser(recipientId) {
      if (recipientId.endsWith('1111111')) return { sent: 3, failed: 1 };
      if (recipientId.endsWith('2222222')) return { sent: 0 };
      throw new Error('provider unavailable');
    }
  });

  assert.deepEqual(await notify('sos-owner', ['contact-1', 'contact-2', 'contact-3'], { body: 'Alert' }), {
    eligible: 3,
    delivered: 1,
    failedRecipients: 2,
    sentNotifications: 3
  });
});

test('SOS acceptance remains accepted when emergency-contact push delivery fails', async () => {
  const now = Date.now();
  const contactId = 'contact_abcdefghijklmnopqrstuvwx';
  const recordedDeliveries = [];
  let response;
  const repository = {
    async listContacts() { return [{ id: contactId, phone: '+6591111111' }]; },
    async acceptSOS(_userId, event) { return event; },
    async claimSOSDelivery(_userId, _idempotencyKey) { return { claimed: true }; },
    async recordSOSDelivery(userId, idempotencyKey, delivery) {
      recordedDeliveries.push({ userId, idempotencyKey, delivery });
    }
  };

  await handleSafetyAPI({
    req: { method: 'POST' },
    res: {},
    url: new URL('https://api.example.test/v1/sos-events'),
    body: {
      idempotencyKey: 'sos_1234567890abcdefg',
      occurredAt: now,
      source: 'app',
      contactIds: [contactId]
    },
    principal: { sub: 'sos-owner', scope: 'safety:write' },
    repository,
    async notifyEmergencyContacts() {
      return { eligible: 2, delivered: 0, failedRecipients: 2 };
    },
    json(_res, statusCode, body) { response = { statusCode, body }; }
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.body.status, 'accepted');
  assert.equal(response.body.deliveryStatus, 'failed');
  assert.deepEqual(recordedDeliveries, [{
    userId: 'sos-owner',
    idempotencyKey: 'sos_1234567890abcdefg',
    delivery: {
      deliveryStatus: 'failed',
      eligibleCount: 2,
      deliveredCount: 0,
      failedCount: 2
    }
  }]);
});

test('SOS retries cannot reuse an idempotency key with a different payload', async () => {
  const contacts = [
    { id: 'contact_abcdefghijklmnopqrstuvwx', phone: '+6591111111' },
    { id: 'contact_zyxwvutsrqponmlkjihgfedc', phone: '+6592222222' }
  ];
  let accepted;
  const repository = {
    async listContacts() { return contacts; },
    async acceptSOS(_userId, event) {
      if (!accepted) accepted = event;
      return accepted;
    }
  };
  const invoke = (body) => handleSafetyAPI({
    req: { method: 'POST' },
    res: {},
    url: new URL('https://api.example.test/v1/sos-events'),
    body,
    principal: { sub: 'sos-owner', scope: 'safety:write' },
    repository,
    json() {}
  });
  const occurredAt = Date.now();
  const base = {
    idempotencyKey: 'sos_payload_binding_0001',
    occurredAt,
    source: 'app',
    contactIds: [contacts[0].id]
  };
  await invoke(base);
  await assert.rejects(invoke({ ...base, contactIds: [contacts[1].id] }), (error) => (
    error.statusCode === 409 && /different SOS event/.test(error.message)
  ));
  assert.deepEqual(accepted.contactIds, [contacts[0].id]);
});

test('a durable SOS receipt remains retrievable after the new-event freshness window', async () => {
  const occurredAt = Date.now() - 6 * 60 * 1000;
  const contactId = 'contact_abcdefghijklmnopqrstuvwx';
  const accepted = {
    id: 'sos_existing_receipt_0001',
    idempotencyKey: 'sos_durable_retry_0001',
    status: 'accepted',
    acceptedAt: occurredAt + 1000,
    occurredAt,
    source: 'app',
    contactIds: [contactId],
    location: null,
    medicalAttachment: null,
    deliveryStatus: 'not_configured'
  };
  let response;
  await handleSafetyAPI({
    req: { method: 'POST' },
    res: {},
    url: new URL('https://api.example.test/v1/sos-events'),
    body: {
      idempotencyKey: accepted.idempotencyKey,
      occurredAt,
      source: 'app',
      contactIds: [contactId]
    },
    principal: { sub: 'sos-owner', scope: 'safety:write' },
    repository: {
      async getSOS() { return accepted; },
      async listContacts() { throw new Error('historical retry must not re-resolve mutable contacts'); },
      async acceptSOS() { throw new Error('historical retry must not create another receipt'); }
    },
    json(_res, statusCode, body) { response = { statusCode, body }; }
  });
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.id, accepted.id);
  assert.equal(response.body.status, 'accepted');
});
