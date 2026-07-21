'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDynamoAuthSessionRepository, refreshHash } = require('./auth-session-repository.cjs');

test('phone verification challenges are consumed once with a TTL-backed atomic write', async () => {
  const writes = [];
  let consumed = false;
  const client = {
    async send(command) {
      assert.equal(command.constructor.name, 'PutCommand');
      writes.push(command.input);
      if (consumed) {
        throw Object.assign(new Error('already consumed'), { name: 'ConditionalCheckFailedException' });
      }
      consumed = true;
      return {};
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });
  const request = { jti: 'challenge-jti-0001', expiresAt: 120000, now: 60000 };
  assert.equal(await repository.consumePhoneChallenge(request), true);
  assert.equal(writes[0].Item.expiresAt, 120);
  assert.match(writes[0].Item.PK, /^PHONE_CHALLENGE#[A-Za-z0-9_-]{43}$/);
  assert.equal(writes[0].ConditionExpression, 'attribute_not_exists(PK) AND attribute_not_exists(SK)');
  await assert.rejects(repository.consumePhoneChallenge(request), {
    statusCode: 410,
    code: 'PHONE_AUTH_CHALLENGE_USED'
  });
});

test('session creation and rotation atomically participate in the account-deletion fence', async () => {
  const transactions = [];
  const client = {
    async send(command) {
      assert.equal(command.constructor.name, 'TransactWriteCommand');
      transactions.push(command.input.TransactItems);
      return {};
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });

  await repository.create({
    subject: 'user-a',
    sessionId: 'session-new-0001',
    refreshJti: 'refresh-jti-current',
    expiresAt: 1_900_000_000_000
  });
  assert.equal(transactions[0][0].ConditionCheck.Key.SK, 'ACCOUNT#STATE');
  assert.match(transactions[0][0].ConditionCheck.ConditionExpression, /deletion_state = :active/);
  assert.equal(transactions[0][1].Put.Item.SK, 'SESSION#session-new-0001');

  assert.equal(await repository.rotate({
    subject: 'user-a',
    sessionId: 'session-new-0001',
    currentJti: 'refresh-jti-current',
    nextJti: 'refresh-jti-next',
    expiresAt: 1_900_000_100_000,
    now: 1000
  }), true);
  assert.equal(transactions[1][0].ConditionCheck.Key.SK, 'ACCOUNT#STATE');
  assert.equal(transactions[1][1].Update.Key.SK, 'SESSION#session-new-0001');
});

test('a deletion fence that wins the session transaction returns a stable account error', async () => {
  const client = {
    async send(command) {
      if (command.constructor.name === 'TransactWriteCommand') {
        throw Object.assign(new Error('transaction cancelled'), { name: 'TransactionCanceledException' });
      }
      if (command.constructor.name === 'GetCommand') return { Item: { deletion_state: 'deleting' } };
      throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });
  await assert.rejects(repository.create({
    subject: 'user-a',
    sessionId: 'session-new-0001',
    refreshJti: 'refresh-jti-current',
    expiresAt: 1_900_000_000_000
  }), (error) => error.code === 'ACCOUNT_DELETION_IN_PROGRESS' && error.statusCode === 423);
});

test('a transient refresh transaction conflict does not revoke a valid token family', async () => {
  const updates = [];
  const conflict = Object.assign(new Error('transaction conflict'), { name: 'TransactionCanceledException' });
  const client = {
    async send(command) {
      if (command.constructor.name === 'TransactWriteCommand') throw conflict;
      if (command.constructor.name === 'GetCommand' && command.input.Key.SK === 'ACCOUNT#STATE') {
        return { Item: { deletion_state: 'active' } };
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: {
          refresh_jti_hash: refreshHash('refresh-jti-current'),
          family_expires_at: 1_900_000_100_000
        } };
      }
      if (command.constructor.name === 'UpdateCommand') updates.push(command.input);
      return {};
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });
  await assert.rejects(repository.rotate({
    subject: 'user-a',
    sessionId: 'session-new-0001',
    currentJti: 'refresh-jti-current',
    nextJti: 'refresh-jti-next',
    expiresAt: 1_900_000_000_000,
    now: 1000
  }), conflict);
  assert.deepEqual(updates, []);
});

test('a proven refresh replay still revokes the complete token family', async () => {
  const updates = [];
  const client = {
    async send(command) {
      if (command.constructor.name === 'TransactWriteCommand') {
        throw Object.assign(new Error('compare-and-swap lost'), { name: 'TransactionCanceledException' });
      }
      if (command.constructor.name === 'GetCommand' && command.input.Key.SK === 'ACCOUNT#STATE') {
        return { Item: { deletion_state: 'active' } };
      }
      if (command.constructor.name === 'GetCommand') {
        return { Item: {
          refresh_jti_hash: refreshHash('winning-sibling-jti'),
          family_expires_at: 1_900_000_100_000
        } };
      }
      if (command.constructor.name === 'UpdateCommand') {
        updates.push(command.input);
        return {};
      }
      throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });
  assert.equal(await repository.rotate({
    subject: 'user-a',
    sessionId: 'session-new-0001',
    currentJti: 'refresh-jti-current',
    nextJti: 'refresh-jti-next',
    expiresAt: 1_900_000_000_000,
    now: 1000
  }), false);
  assert.equal(updates.length, 1);
  assert.match(updates[0].UpdateExpression, /revoked_at/);
});

test('account deletion atomically finalizes the marker with its remaining sessions after process death', async () => {
  let deletionState = 'deleting';
  let sessions = [
    { PK: 'USER#user-a', SK: 'SESSION#session-recovery-1' },
    { PK: 'USER#user-a', SK: 'SESSION#session-other-0002' }
  ];
  let failTerminalWrite = true;
  const transactions = [];
  const client = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') {
        return { Item: {
          deletion_state: deletionState,
          deletion_recovery_session_id: 'session-recovery-1'
        } };
      }
      if (name === 'QueryCommand') return { Items: sessions.map((item) => ({ ...item })) };
      if (name === 'TransactWriteCommand') {
        transactions.push(command.input.TransactItems);
        if (failTerminalWrite) throw new Error('simulated process death before commit');
        sessions = [];
        deletionState = 'deleted';
        return {};
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });

  await assert.rejects(repository.finalizeAccountDeletion('user-a', {
    recoverySessionId: 'session-recovery-1',
    now: 1000
  }), /simulated process death/);
  assert.equal(deletionState, 'deleting');
  assert.equal(sessions.length, 2);

  failTerminalWrite = false;
  assert.deepEqual(await repository.finalizeAccountDeletion('user-a', {
    recoverySessionId: 'session-recovery-1',
    now: 1100
  }), { deletedItems: 2, completed: true });
  assert.equal(deletionState, 'deleted');
  assert.equal(sessions.length, 0);
  assert.equal(transactions.at(-1).length, 3);
  assert.equal(transactions.at(-1).at(-1).Update.ConditionExpression, 'deletion_state = :deleting');
});

test('account deletion reconciles a concurrent successful finalizer after transaction cancellation', async () => {
  let deletionState = 'deleting';
  const client = {
    async send(command) {
      const name = command.constructor.name;
      if (name === 'GetCommand') return { Item: { deletion_state: deletionState } };
      if (name === 'QueryCommand') return { Items: [] };
      if (name === 'TransactWriteCommand') {
        deletionState = 'deleted';
        throw Object.assign(new Error('transaction lost to concurrent finalizer'), {
          name: 'TransactionCanceledException'
        });
      }
      throw new Error(`Unexpected command ${name}`);
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });

  assert.deepEqual(await repository.finalizeAccountDeletion('user-a', { now: 1000 }), {
    deletedItems: 0,
    completed: true
  });
});

test('auth session privacy export is bounded across paginated data', async () => {
  let queries = 0;
  const client = {
    async send(command) {
      assert.equal(command.constructor.name, 'QueryCommand');
      assert.ok(command.input.Limit <= 100);
      queries += 1;
      return {
        Items: Array.from({ length: command.input.Limit }, (_, index) => ({
          session_id: `session-${queries}-${index}`
        })),
        LastEvaluatedKey: { PK: 'USER#user-a', SK: `SESSION#page-${queries}` }
      };
    }
  };
  const repository = createDynamoAuthSessionRepository({ tableName: 'auth', client });
  await assert.rejects(repository.exportUserData('user-a'), {
    statusCode: 413,
    code: 'AUTH_SESSION_EXPORT_LIMIT_EXCEEDED'
  });
  assert.equal(queries, 101);
});
