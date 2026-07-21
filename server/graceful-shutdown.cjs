'use strict';

function createGracefulShutdown(server, {
  cleanup = async () => undefined,
  logger = console,
  timeoutMs = 5_000
} = {}) {
  if (!server || typeof server.close !== 'function') throw new TypeError('HTTP server is required');
  if (typeof cleanup !== 'function') throw new TypeError('Shutdown cleanup must be a function');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new TypeError('Shutdown timeout is invalid');
  }
  let inFlight;

  return function shutdown(signal = 'SIGTERM') {
    if (inFlight) return inFlight;
    const safeSignal = signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM';
    logger.info?.('[VeryLovingCLM] graceful shutdown started', { signal: safeSignal });
    inFlight = (async () => {
      let closeSettled = false;
      const closePromise = new Promise((resolve, reject) => {
        const done = (error) => {
          if (closeSettled) return;
          closeSettled = true;
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        };
        try {
          server.close(done);
          server.closeIdleConnections?.();
        } catch (error) {
          done(error);
        }
      });
      const operations = Promise.allSettled([closePromise, Promise.resolve().then(cleanup)]);
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          server.closeAllConnections?.();
          const error = Object.assign(new Error('Graceful shutdown timed out'), {
            code: 'SHUTDOWN_TIMEOUT'
          });
          reject(error);
        }, timeoutMs);
      });
      try {
        const results = await Promise.race([operations, timeout]);
        const failed = results.find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
        logger.info?.('[VeryLovingCLM] graceful shutdown completed');
      } finally {
        clearTimeout(timer);
      }
    })();
    // Signal handlers observe this promise, but retaining a rejection observer
    // also prevents an unhandled rejection if a host calls shutdown directly.
    void inFlight.catch(() => {});
    return inFlight;
  };
}

function installProcessSignalHandlers(shutdown, {
  processRef = process,
  logger = console
} = {}) {
  if (typeof shutdown !== 'function') throw new TypeError('Shutdown function is required');
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      void shutdown(signal).catch((error) => {
        processRef.exitCode = 1;
        const code = error?.code === 'SHUTDOWN_TIMEOUT'
          ? 'SHUTDOWN_TIMEOUT'
          : 'SHUTDOWN_FAILED';
        try {
          logger.error?.('[VeryLovingCLM] graceful shutdown failed', { code });
        } catch {}
      });
    };
    handlers.set(signal, handler);
    processRef.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of handlers) processRef.removeListener(signal, handler);
  };
}

module.exports = { createGracefulShutdown, installProcessSignalHandlers };
