'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDynamoAuthSessionRepository } = require('./auth-session-repository.cjs');

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

