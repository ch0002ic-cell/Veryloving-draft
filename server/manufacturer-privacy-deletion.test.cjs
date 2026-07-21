'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createDynamoManufacturerPrivacyDeletionRepository,
  createManufacturerPrivacyDeletionCoordinator,
  deletionPlanFingerprint
} = require('./manufacturer-privacy-deletion.cjs');
const { createManufacturerPrivacyClient } = require('./manufacturer-client.cjs');

const OPERATION_ID = 'operationidentity00000000000000000000000000';

function createMemoryCheckpointRepository({ failCheckpointFor } = {}) {
  let record;
  let checkpointFailurePending = Boolean(failCheckpointFor);
  return {
    async begin(_userId, plan) {
      const planFingerprint = deletionPlanFingerprint(plan);
      if (!record) {
        record = {
          operationId: OPERATION_ID,
          planFingerprint,
          adapterIds: plan.map(({ adapterId }) => adapterId),
          completedAdapters: [],
          state: 'in_progress'
        };
      } else if (record.state !== 'completed' && record.planFingerprint !== planFingerprint) {
        throw Object.assign(new Error('plan changed'), { code: 'PRIVACY_DELETE_PLAN_CHANGED' });
      }
      return structuredClone(record);
    },
    async markAdapterCompleted(_userId, operationId, adapterId) {
      assert.equal(operationId, OPERATION_ID);
      if (checkpointFailurePending && adapterId === failCheckpointFor) {
        checkpointFailurePending = false;
        throw new Error('simulated process death before checkpoint commit');
      }
      if (!record.completedAdapters.includes(adapterId)) record.completedAdapters.push(adapterId);
      return structuredClone(record);
    },
    async markCompleted(_userId, operationId, adapterCount) {
      assert.equal(operationId, OPERATION_ID);
      assert.equal(record.completedAdapters.length, adapterCount);
      record.state = 'completed';
      return structuredClone(record);
    },
    snapshot() { return structuredClone(record); }
  };
}

const PLAN = Object.freeze([
  { adapterId: 'jiangzhi-edge', robotIds: ['jiangzhi-1'] },
  { adapterId: 'yongyida-cloud', robotIds: ['yongyida-1'] }
]);

test('durable vendor checkpoints skip completed adapter after later vendor failure', async () => {
  const repository = createMemoryCheckpointRepository();
  const calls = [];
  let failYongyida = true;
  const deleteAdapter = async (adapterId, robotIds, options) => {
    calls.push({ adapterId, robotIds, ...options });
    if (adapterId === 'yongyida-cloud' && failYongyida) {
      failYongyida = false;
      throw new Error('vendor B unavailable');
    }
    return { deleted: robotIds.length };
  };

  const beforeRestart = createManufacturerPrivacyDeletionCoordinator({ repository, deleteAdapter });
  await assert.rejects(beforeRestart.deleteUserData('user-private', PLAN), /vendor B unavailable/);
  assert.deepEqual(repository.snapshot().completedAdapters, ['jiangzhi-edge']);

  // A new coordinator represents a fresh Node.js process using the same
  // durable repository. Vendor A is skipped; Vendor B reuses its first key.
  const afterRestart = createManufacturerPrivacyDeletionCoordinator({ repository, deleteAdapter });
  assert.deepEqual(await afterRestart.deleteUserData('user-private', PLAN), { deleted: 2 });
  assert.deepEqual(calls.map(({ adapterId }) => adapterId), [
    'jiangzhi-edge',
    'yongyida-cloud',
    'yongyida-cloud'
  ]);
  assert.equal(calls[1].idempotencyKey, calls[2].idempotencyKey);
  assert.notEqual(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(repository.snapshot().state, 'completed');
});

test('crash after vendor success safely replays the same adapter idempotency key', async () => {
  const repository = createMemoryCheckpointRepository({ failCheckpointFor: 'jiangzhi-edge' });
  const calls = [];
  const physicalErasure = new Set();
  const deleteAdapter = async (adapterId, robotIds, { idempotencyKey }) => {
    calls.push({ adapterId, idempotencyKey });
    // This models the required manufacturer behavior: duplicate requests with
    // the same key return the prior result without repeating physical work.
    physicalErasure.add(idempotencyKey);
    return { deleted: robotIds.length };
  };

  await assert.rejects(
    createManufacturerPrivacyDeletionCoordinator({ repository, deleteAdapter })
      .deleteUserData('user-private', PLAN),
    /simulated process death/
  );
  assert.deepEqual(repository.snapshot().completedAdapters, []);

  await createManufacturerPrivacyDeletionCoordinator({ repository, deleteAdapter })
    .deleteUserData('user-private', PLAN);
  assert.deepEqual(calls.map(({ adapterId }) => adapterId), [
    'jiangzhi-edge',
    'jiangzhi-edge',
    'yongyida-cloud'
  ]);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(physicalErasure.size, 2);
});

test('manufacturer deletion client forwards only a validated stable idempotency header', async () => {
  const calls = [];
  const client = createManufacturerPrivacyClient({
    exportURL: 'https://manufacturer.test/privacy/export',
    deleteURL: 'https://manufacturer.test/privacy/delete',
    apiKey: 'server-only-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 204, async text() { return ''; } };
    }
  });
  const idempotencyKey = OPERATION_ID;
  await client.deleteRobotData(['manufacturer-r1'], { idempotencyKey });
  assert.equal(calls[0].options.headers['Idempotency-Key'], idempotencyKey);
  assert.doesNotMatch(JSON.stringify(calls[0].options), /user-private/);

  await assert.rejects(
    client.deleteRobotData(['manufacturer-r1'], { idempotencyKey: 'unsafe key' }),
    /idempotency key is invalid/
  );
  assert.equal(calls.length, 1);
});

test('Dynamo checkpoint uses an opaque account key and persists no robot identifiers', async () => {
  let item;
  const client = {
    async send(command) {
      if (command.constructor.name === 'GetCommand') return { Item: item ? structuredClone(item) : undefined };
      if (command.constructor.name === 'PutCommand') {
        item = structuredClone(command.input.Item);
        return {};
      }
      throw new Error(`Unexpected command ${command.constructor.name}`);
    }
  };
  const repository = createDynamoManufacturerPrivacyDeletionRepository({
    tableName: 'devices',
    secret: 'privacy-checkpoint-secret-at-least-32-characters',
    client
  });
  const checkpoint = await repository.begin('user-private', PLAN, 1234);
  assert.match(checkpoint.operationId, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(item.PK, /user-private/);
  assert.doesNotMatch(JSON.stringify(item), /jiangzhi-1|yongyida-1/);
  assert.deepEqual(item.adapter_ids, ['jiangzhi-edge', 'yongyida-cloud']);
  await assert.rejects(
    repository.begin('user-private', [{ adapterId: 'jiangzhi-edge', robotIds: ['different-robot'] }]),
    { code: 'PRIVACY_DELETE_PLAN_CHANGED', statusCode: 409 }
  );
});

test('Dynamo checkpoint rejects duplicate or oversized durable adapter state', async () => {
  const operationId = 'o'.repeat(43);
  const fingerprint = 'f'.repeat(43);
  const client = {
    async send(command) {
      assert.equal(command.constructor.name, 'GetCommand');
      return { Item: {
        operation_id: operationId,
        plan_fingerprint: fingerprint,
        adapter_ids: ['jiangzhi-edge', 'jiangzhi-edge'],
        completed_adapters: [],
        deletion_state: 'in_progress'
      } };
    }
  };
  const repository = createDynamoManufacturerPrivacyDeletionRepository({
    tableName: 'devices',
    secret: 'privacy-checkpoint-secret-at-least-32-characters',
    client
  });
  await assert.rejects(
    repository.begin('user-private', PLAN),
    { code: 'PRIVACY_DELETE_CHECKPOINT_INVALID' }
  );
});
