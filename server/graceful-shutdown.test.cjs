'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { createGracefulShutdown, installProcessSignalHandlers } = require('./graceful-shutdown.cjs');

const silentLogger = { info() {}, error() {} };

test('graceful shutdown is idempotent and waits for HTTP close plus cleanup', async () => {
  let finishClose;
  let finishCleanup;
  let closeCalls = 0;
  let idleCalls = 0;
  const server = {
    close(callback) { closeCalls += 1; finishClose = callback; },
    closeIdleConnections() { idleCalls += 1; }
  };
  const cleanupGate = new Promise((resolve) => { finishCleanup = resolve; });
  const shutdown = createGracefulShutdown(server, {
    cleanup: () => cleanupGate,
    logger: silentLogger,
    timeoutMs: 1_000
  });

  const first = shutdown('SIGTERM');
  const duplicate = shutdown('SIGINT');
  assert.equal(first, duplicate);
  assert.equal(closeCalls, 1);
  assert.equal(idleCalls, 1);
  finishClose();
  finishCleanup();
  await first;
});

test('graceful shutdown force-closes connections at its bounded deadline', async () => {
  let forceCalls = 0;
  const shutdown = createGracefulShutdown({
    close() {},
    closeAllConnections() { forceCalls += 1; }
  }, {
    cleanup: () => new Promise(() => {}),
    logger: silentLogger,
    timeoutMs: 10
  });

  await assert.rejects(shutdown(), { code: 'SHUTDOWN_TIMEOUT' });
  assert.equal(forceCalls, 1);
});

test('cleanup failure cannot clear the force-close deadline while HTTP close is pending', async () => {
  let forceCalls = 0;
  const shutdown = createGracefulShutdown({
    close() {},
    closeAllConnections() { forceCalls += 1; }
  }, {
    cleanup: async () => { throw Object.assign(new Error('cleanup failed'), { code: 'CLEANUP_FAILED' }); },
    logger: silentLogger,
    timeoutMs: 10
  });

  await assert.rejects(shutdown(), { code: 'SHUTDOWN_TIMEOUT' });
  assert.equal(forceCalls, 1);
});

test('signal handlers set a failure exit code without logging sensitive errors', async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = 0;
  const errors = [];
  const remove = installProcessSignalHandlers(
    async () => { throw Object.assign(new Error('secret detail'), { code: 'API_KEY_SUPER_SECRET' }); },
    { processRef, logger: { error: (...args) => errors.push(args) } }
  );
  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(processRef.exitCode, 1);
  assert.deepEqual(errors, [[
    '[VeryLovingCLM] graceful shutdown failed',
    { code: 'SHUTDOWN_FAILED' }
  ]]);
  assert.equal(JSON.stringify(errors).includes('SUPER_SECRET'), false);
  remove();
});
