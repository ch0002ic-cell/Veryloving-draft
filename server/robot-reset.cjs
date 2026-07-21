'use strict';

const crypto = require('node:crypto');

function resetLogReference(value, prefix) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 12)}`;
}

function createRobotResetCoordinator({
  repository,
  gateway,
  resetHandler,
  logger = console,
  now = Date.now,
  leaseOwner = `reset-worker-${crypto.randomUUID()}`,
  leaseMs = 30000,
  retryBaseMs = 1000,
  retryMaxMs = 60000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const requiredRepositoryMethods = [
    'beginFactoryReset',
    'claimFactoryReset',
    'markFactoryResetRemoteComplete',
    'recordFactoryResetFailure',
    'completeFactoryReset',
    'listRecoverableFactoryResets'
  ];
  for (const method of requiredRepositoryMethods) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`Robot reset repository must implement ${method}()`);
    }
  }
  if (typeof resetHandler !== 'function' && typeof resetHandler?.resetRobot !== 'function') {
    throw new TypeError('Robot reset handler is unavailable');
  }
  if (typeof now !== 'function') throw new TypeError('Robot reset clock must be a function');
  if (typeof leaseOwner !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(leaseOwner)) {
    throw new TypeError('Robot reset lease owner is invalid');
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300000) {
    throw new TypeError('Robot reset lease duration is invalid');
  }
  if (
    !Number.isSafeInteger(retryBaseMs)
    || retryBaseMs < 100
    || !Number.isSafeInteger(retryMaxMs)
    || retryMaxMs < retryBaseMs
    || retryMaxMs > 3600000
  ) throw new TypeError('Robot reset retry policy is invalid');
  if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
    throw new TypeError('Robot reset timer implementation is invalid');
  }

  let recoveryWorkerTimer = null;
  let recoveryWorkerStopped = true;
  let recoveryWorkerPromise = Promise.resolve([]);

  async function fenceAndDrain(checkpoint) {
    const context = {
      userId: checkpoint.userId,
      robotId: checkpoint.robotId,
      bindingEpoch: checkpoint.bindingEpoch,
      resetId: checkpoint.resetId
    };
    if (typeof gateway?.beginRobotReset === 'function') {
      await gateway.beginRobotReset(context.userId, context.robotId, context.bindingEpoch, context.resetId);
      return;
    }
    if (typeof gateway?.fenceRobotBinding === 'function') {
      await gateway.fenceRobotBinding(context.userId, context.robotId, context.bindingEpoch);
    }
    if (typeof gateway?.drainRobotBinding === 'function') {
      await gateway.drainRobotBinding(context.userId, context.robotId, context.bindingEpoch);
    }
  }

  async function invokeResetHandler(checkpoint) {
    const command = {
      adapterId: checkpoint.adapterId,
      manufacturerDeviceId: checkpoint.manufacturerDeviceId,
      resetId: checkpoint.resetId,
      bindingEpoch: checkpoint.bindingEpoch
    };
    if (typeof resetHandler === 'function') return resetHandler(command);
    return resetHandler.resetRobot(
      checkpoint.adapterId,
      {
        resetId: checkpoint.resetId,
        manufacturerDeviceId: checkpoint.manufacturerDeviceId,
        bindingEpoch: checkpoint.bindingEpoch
      }
    );
  }

  function retryAtFor(checkpoint, failedAt) {
    const attempt = Math.max(1, Number.isSafeInteger(checkpoint.resetAttempt) ? checkpoint.resetAttempt : 1);
    const exponent = Math.min(20, attempt - 1);
    return failedAt + Math.min(retryMaxMs, retryBaseMs * (2 ** exponent));
  }

  async function resume({ userId, robotId } = {}) {
    if (typeof userId !== 'string' || !userId || typeof robotId !== 'string' || !robotId) {
      throw Object.assign(new Error('Robot reset target is invalid'), { statusCode: 400, code: 'ROBOT_RESET_INVALID' });
    }
    const claimedAt = now();
    // A worker identity is not a lease generation. Every claim gets an
    // independent token so a late failure from an expired attempt cannot mutate
    // a newer attempt running in the same process.
    const claimToken = crypto.createHash('sha256')
      .update(JSON.stringify(['veryloving-reset-claim-v1', leaseOwner, crypto.randomUUID()]))
      .digest('base64url');
    const claimed = await repository.claimFactoryReset(userId, robotId, claimToken, claimedAt, leaseMs);
    if (!claimed) return null;
    const checkpoint = { ...claimed, userId, robotId };
    await fenceAndDrain(checkpoint);
    if (checkpoint.remoteComplete || checkpoint.lifecycleState === 'reset_remote_complete') {
      return repository.completeFactoryReset(
        userId,
        robotId,
        checkpoint.resetId,
        checkpoint.bindingEpoch,
        now()
      );
    }
    if (!checkpoint.claimed) {
      return {
        robotId,
        resetId: checkpoint.resetId,
        bindingEpoch: checkpoint.bindingEpoch,
        lifecycleState: checkpoint.lifecycleState,
        queued: true,
        retryAt: checkpoint.retryAt
      };
    }
    try {
      // resetId is the downstream idempotency key. A crash after the physical
      // reset but before the checkpoint write may repeat this call safely.
      await invokeResetHandler(checkpoint);
    } catch (error) {
      const failedAt = now();
      const retryAt = retryAtFor(checkpoint, failedAt);
      await repository.recordFactoryResetFailure(
        userId,
        robotId,
        checkpoint.resetId,
        checkpoint.bindingEpoch,
        error,
        failedAt,
        retryAt,
        claimToken
      );
      logger.error?.('[RobotReset] Manufacturer reset failed', {
        robotReference: resetLogReference(robotId, 'robot'),
        resetReference: resetLogReference(checkpoint.resetId, 'reset'),
        code: 'ROBOT_RESET_REMOTE_FAILED'
      });
      throw Object.assign(new Error('Robot factory reset could not reach the manufacturer'), {
        statusCode: 502,
        code: 'ROBOT_RESET_REMOTE_FAILED',
        retryAt
      });
    }
    const remoteComplete = await repository.markFactoryResetRemoteComplete(
      userId,
      robotId,
      checkpoint.resetId,
      checkpoint.bindingEpoch,
      now()
    );
    const result = await repository.completeFactoryReset(
      userId,
      robotId,
      checkpoint.resetId,
      checkpoint.bindingEpoch,
      now()
    );
    logger.info?.('[RobotReset] Factory reset completed', {
      robotReference: resetLogReference(robotId, 'robot'),
      resetReference: resetLogReference(checkpoint.resetId, 'reset'),
      bindingEpoch: checkpoint.bindingEpoch,
      remoteCompletedAt: remoteComplete?.resetRemoteCompletedAt
    });
    return result;
  }

  async function requestReset({ userId, robotId, pairingToken } = {}) {
    const checkpoint = await repository.beginFactoryReset(userId, robotId, pairingToken, now());
    if (!checkpoint) {
      throw Object.assign(new Error('Robot binding was not found'), { statusCode: 404, code: 'ROBOT_NOT_FOUND' });
    }
    if (checkpoint.completed) return checkpoint;
    await fenceAndDrain({ ...checkpoint, userId, robotId });
    return resume({ userId, robotId });
  }

  async function recover({ limit = 25 } = {}) {
    const recoverable = await repository.listRecoverableFactoryResets({ now: now(), limit });
    const results = [];
    for (const checkpoint of recoverable) {
      try {
        results.push({
          userId: checkpoint.userId,
          robotId: checkpoint.robotId,
          ok: true,
          result: await resume({ userId: checkpoint.userId, robotId: checkpoint.robotId })
        });
      } catch (error) {
        results.push({
          userId: checkpoint.userId,
          robotId: checkpoint.robotId,
          ok: false,
          code: 'ROBOT_RESET_RECOVERY_FAILED'
        });
      }
    }
    return results;
  }

  function startRecoveryWorker({ intervalMs = 1000, limit = 25 } = {}) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
      throw new TypeError('Robot reset recovery interval is invalid');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new TypeError('Robot reset recovery limit is invalid');
    }
    if (!recoveryWorkerStopped) return recoveryWorkerPromise;
    recoveryWorkerStopped = false;

    const schedule = () => {
      if (recoveryWorkerStopped) return;
      recoveryWorkerTimer = setTimeoutImpl(() => {
        recoveryWorkerTimer = null;
        recoveryWorkerPromise = runPass(false);
      }, intervalMs);
      recoveryWorkerTimer?.unref?.();
    };
    const runPass = async (propagateFailure) => {
      try {
        return await recover({ limit });
      } catch (error) {
        logger.error?.('[RobotReset] Recovery pass failed', {
          code: 'ROBOT_RESET_RECOVERY_FAILED'
        });
        if (propagateFailure) throw error;
        return [];
      } finally {
        schedule();
      }
    };
    recoveryWorkerPromise = runPass(true);
    return recoveryWorkerPromise;
  }

  function stopRecoveryWorker() {
    recoveryWorkerStopped = true;
    if (recoveryWorkerTimer) clearTimeoutImpl(recoveryWorkerTimer);
    recoveryWorkerTimer = null;
  }

  return { requestReset, resume, recover, startRecoveryWorker, stopRecoveryWorker };
}

module.exports = { createRobotResetCoordinator };
