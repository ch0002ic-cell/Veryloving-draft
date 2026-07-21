'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRobotResetCoordinator } = require('./robot-reset.cjs');

function createMemoryResetRepository({ remoteComplete = false } = {}) {
  const state = {
    userId: 'user-private-account',
    robotId: 'robot-private-id',
    manufacturerDeviceId: 'manufacturer-private-route',
    adapterId: 'jiangzhi-edge',
    bindingEpoch: 14,
    lifecycleState: remoteComplete ? 'reset_remote_complete' : 'active',
    resetId: remoteComplete ? 'reset-operation-stable-123' : undefined,
    resetAttempt: 0,
    resetRemoteCompletedAt: remoteComplete ? 900 : undefined,
    nextResetAttemptAt: 0,
    completed: false
  };
  return {
    state,
    async beginFactoryReset(userId, robotId) {
      assert.equal(userId, state.userId);
      assert.equal(robotId, state.robotId);
      if (state.lifecycleState === 'active') {
        state.lifecycleState = 'reset_pending';
        state.resetId = 'reset-operation-stable-123';
      }
      return { ...state };
    },
    async claimFactoryReset(userId, robotId, leaseOwner, now, leaseMs) {
      assert.equal(userId, state.userId);
      assert.equal(robotId, state.robotId);
      if (state.lifecycleState === 'reset_remote_complete') {
        return { ...state, claimed: false, remoteComplete: true };
      }
      if (state.nextResetAttemptAt > now) return { ...state, claimed: false, retryAt: state.nextResetAttemptAt };
      state.lifecycleState = 'reset_in_progress';
      state.resetAttempt += 1;
      state.resetLeaseOwner = leaseOwner;
      state.resetLeaseExpiresAt = now + leaseMs;
      return { ...state, claimed: true };
    },
    async recordFactoryResetFailure(userId, robotId, resetId, epoch, error, failedAt, retryAt, leaseOwner) {
      assert.equal(userId, state.userId);
      assert.equal(robotId, state.robotId);
      assert.equal(resetId, state.resetId);
      assert.equal(epoch, state.bindingEpoch);
      assert.equal(leaseOwner, state.resetLeaseOwner);
      state.lifecycleState = 'reset_pending';
      state.nextResetAttemptAt = retryAt;
      state.lastErrorCode = error.code;
      delete state.resetLeaseOwner;
      return { ...state, failedAt };
    },
    async markFactoryResetRemoteComplete(userId, robotId, resetId, epoch, completedAt) {
      assert.equal(userId, state.userId);
      assert.equal(robotId, state.robotId);
      assert.equal(resetId, state.resetId);
      assert.equal(epoch, state.bindingEpoch);
      state.lifecycleState = 'reset_remote_complete';
      state.resetRemoteCompletedAt = completedAt;
      return { ...state };
    },
    async completeFactoryReset(userId, robotId, resetId, epoch, completedAt) {
      assert.equal(userId, state.userId);
      assert.equal(robotId, state.robotId);
      assert.equal(resetId, state.resetId);
      assert.equal(epoch, state.bindingEpoch);
      assert.equal(state.lifecycleState, 'reset_remote_complete');
      state.lifecycleState = 'unbound';
      state.completed = true;
      return { robotId, resetId, bindingEpoch: epoch, lifecycleState: 'unbound', completed: true, resetCompletedAt: completedAt };
    },
    async listRecoverableFactoryResets({ now }) {
      if (
        state.completed
        || state.lifecycleState === 'active'
        || (state.nextResetAttemptAt && state.nextResetAttemptAt > now)
      ) return [];
      return [{ userId: state.userId, ...state }];
    }
  };
}

test('factory reset retries a stable downstream idempotency key after failure and restart', async () => {
  const repository = createMemoryResetRepository();
  const resetCalls = [];
  const gatewayCalls = [];
  const logs = [];
  let timestamp = 1000;
  let fail = true;
  const createCoordinator = () => createRobotResetCoordinator({
    repository,
    gateway: {
      async fenceRobotBinding(...args) { gatewayCalls.push(args); }
    },
    resetHandler: {
      async resetRobot(adapterId, request) {
        resetCalls.push({ adapterId, request });
        if (fail) throw Object.assign(new Error('private manufacturer failure'), { code: 'API_KEY_SUPER_SECRET' });
      }
    },
    logger: {
      error(message, context) { logs.push({ message, context }); },
      info(message, context) { logs.push({ message, context }); }
    },
    now: () => timestamp,
    leaseOwner: 'reset-worker-test-1',
    leaseMs: 1000,
    retryBaseMs: 100,
    retryMaxMs: 1000
  });

  await assert.rejects(
    createCoordinator().requestReset({
      userId: repository.state.userId,
      robotId: repository.state.robotId,
      pairingToken: 'token'
    }),
    (error) => error.code === 'ROBOT_RESET_REMOTE_FAILED' && error.retryAt === 1100
  );
  assert.equal(repository.state.lifecycleState, 'reset_pending');
  assert.equal(repository.state.resetId, 'reset-operation-stable-123');
  assert.equal(resetCalls.length, 1);

  // Simulate a new process/worker after the persisted retry deadline.
  timestamp = 1100;
  fail = false;
  const recovered = await createCoordinator().recover();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].ok, true);
  assert.equal(repository.state.completed, true);
  assert.equal(resetCalls.length, 2);
  assert.equal(resetCalls[0].request.resetId, resetCalls[1].request.resetId);
  assert.deepEqual(resetCalls[1], {
    adapterId: 'jiangzhi-edge',
    request: {
      resetId: 'reset-operation-stable-123',
      manufacturerDeviceId: 'manufacturer-private-route',
      bindingEpoch: 14
    }
  });
  assert.deepEqual(gatewayCalls[0], ['user-private-account', 'robot-private-id', 14]);
  assert.doesNotMatch(JSON.stringify(logs), /user-private-account|robot-private-id|manufacturer-private-route|private manufacturer failure/);
  assert.doesNotMatch(JSON.stringify(logs), /API_KEY_SUPER_SECRET/);
  assert.equal(logs[0].context.code, 'ROBOT_RESET_REMOTE_FAILED');
});

test('recovery finalizes a remote-complete checkpoint without issuing a second physical reset', async () => {
  const repository = createMemoryResetRepository({ remoteComplete: true });
  let resetCalls = 0;
  const coordinator = createRobotResetCoordinator({
    repository,
    resetHandler: async () => { resetCalls += 1; },
    now: () => 1000,
    leaseOwner: 'reset-worker-test-2'
  });
  const result = await coordinator.resume({ userId: repository.state.userId, robotId: repository.state.robotId });
  assert.equal(result.completed, true);
  assert.equal(resetCalls, 0);
});

test('a live reset lease queues concurrent recovery instead of duplicating the command', async () => {
  const repository = createMemoryResetRepository();
  repository.state.lifecycleState = 'reset_in_progress';
  repository.state.resetId = 'reset-operation-stable-123';
  repository.state.resetLeaseExpiresAt = 2000;
  repository.claimFactoryReset = async () => ({ ...repository.state, claimed: false, retryAt: 2000 });
  let resetCalls = 0;
  const coordinator = createRobotResetCoordinator({
    repository,
    resetHandler: async () => { resetCalls += 1; },
    now: () => 1000,
    leaseOwner: 'reset-worker-test-3'
  });
  const result = await coordinator.resume({ userId: repository.state.userId, robotId: repository.state.robotId });
  assert.equal(result.queued, true);
  assert.equal(result.retryAt, 2000);
  assert.equal(resetCalls, 0);
});

test('recurring recovery retries a reset that was not due during the startup pass', async () => {
  const repository = createMemoryResetRepository();
  let timestamp = 1000;
  let fail = true;
  let resetCalls = 0;
  const scheduled = [];
  const coordinator = createRobotResetCoordinator({
    repository,
    resetHandler: async () => {
      resetCalls += 1;
      if (fail) throw Object.assign(new Error('bridge unavailable'), { code: 'REMOTE_TIMEOUT' });
    },
    now: () => timestamp,
    leaseOwner: 'reset-worker-recurring',
    leaseMs: 1000,
    retryBaseMs: 100,
    retryMaxMs: 1000,
    setTimeoutImpl(callback, delay) {
      const timer = { callback, delay, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimeoutImpl() {}
  });

  await assert.rejects(coordinator.requestReset({
    userId: repository.state.userId,
    robotId: repository.state.robotId,
    pairingToken: 'token'
  }), { code: 'ROBOT_RESET_REMOTE_FAILED' });
  assert.equal(repository.state.nextResetAttemptAt, 1100);

  // This models a restart before nextResetAttemptAt. The initial recovery pass
  // sees no due work, but the recurring worker remains armed.
  assert.deepEqual(await coordinator.startRecoveryWorker({ intervalMs: 100 }), []);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 100);
  timestamp = 1100;
  fail = false;
  scheduled.shift().callback();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  coordinator.stopRecoveryWorker();
  assert.equal(repository.state.completed, true);
  assert.equal(resetCalls, 2);
});

test('each reset claim has a unique generation so an expired attempt cannot demote its successor', async () => {
  const state = {
    userId: 'user-private-account',
    robotId: 'robot-private-id',
    manufacturerDeviceId: 'manufacturer-private-route',
    adapterId: 'jiangzhi-edge',
    bindingEpoch: 14,
    lifecycleState: 'reset_pending',
    resetId: 'reset-operation-stable-123',
    resetAttempt: 0
  };
  const claims = [];
  let currentLease;
  let firstReject;
  let secondResolve;
  let resetCall = 0;
  const repository = {
    async beginFactoryReset() { return { ...state }; },
    async claimFactoryReset(_userId, _robotId, token) {
      claims.push(token);
      currentLease = token;
      state.lifecycleState = 'reset_in_progress';
      state.resetAttempt += 1;
      return { ...state, claimed: true, resetLeaseOwner: token };
    },
    async recordFactoryResetFailure(_userId, _robotId, _resetId, _epoch, _error, _failedAt, _retryAt, token) {
      if (token === currentLease) state.lifecycleState = 'reset_pending';
      return { ...state };
    },
    async markFactoryResetRemoteComplete() {
      state.lifecycleState = 'reset_remote_complete';
      return { ...state };
    },
    async completeFactoryReset() {
      state.lifecycleState = 'unbound';
      return { completed: true, lifecycleState: 'unbound' };
    },
    async listRecoverableFactoryResets() { return []; }
  };
  const coordinator = createRobotResetCoordinator({
    repository,
    resetHandler: async () => {
      resetCall += 1;
      if (resetCall === 1) return new Promise((_, reject) => { firstReject = reject; });
      return new Promise((resolve) => { secondResolve = resolve; });
    },
    leaseOwner: 'reset-worker-concurrent',
    now: () => 1000
  });

  const first = coordinator.resume({ userId: state.userId, robotId: state.robotId });
  await new Promise((resolve) => setImmediate(resolve));
  const second = coordinator.resume({ userId: state.userId, robotId: state.robotId });
  await new Promise((resolve) => setImmediate(resolve));
  assert.notEqual(claims[0], claims[1]);

  firstReject(Object.assign(new Error('expired request failed late'), { code: 'REMOTE_TIMEOUT' }));
  await assert.rejects(first, { code: 'ROBOT_RESET_REMOTE_FAILED' });
  assert.equal(state.lifecycleState, 'reset_in_progress');
  secondResolve();
  assert.equal((await second).completed, true);
});
