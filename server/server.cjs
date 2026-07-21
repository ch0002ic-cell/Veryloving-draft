'use strict';

const http = require('node:http');
const path = require('node:path');
const { createAINativeDemoRuntime } = require('./ai-native-demo.cjs');
const { createHandler } = require('./clm-server.cjs');
const { createGracefulShutdown, installProcessSignalHandlers, parseListenPort } = require('./graceful-shutdown.cjs');

// Node 22 loads the local, untracked server environment without requiring
// every assignment to be prefixed with `export`. Existing process variables
// retain precedence. A deployed server without a local .env is unchanged.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

// Standalone HTTP-only listener for platforms and local probes that capture a
// Node server. Vercel invokes the same handler through api/index.js. The raw
// Hume WebSocket upgrade gateway remains on the container entrypoint in
// clm-server.cjs until that transport is adapted and load-tested for its host.
const aiNativeDemo = createAINativeDemoRuntime();
const clmHandler = createHandler({
  httpOnlyDeployment: true,
  ...(aiNativeDemo?.config ?? {})
});
const handler = aiNativeDemo ? aiNativeDemo.wrapHandler(clmHandler) : clmHandler;
const server = http.createServer(handler);
server.requestTimeout = 35000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
const port = parseListenPort(process.env.PORT, 8787);
if (aiNativeDemo) {
  // The credential-free demo route is intentionally unreachable off-host.
  server.listen(port, '127.0.0.1', () => {
    console.info('[AI-Native] System injected');
  });
} else {
  server.listen(port);
}

const shutdown = createGracefulShutdown(server, {
  cleanup: async () => aiNativeDemo?.close?.()
});
server.shutdown = shutdown;
if (require.main === module) installProcessSignalHandlers(shutdown);

module.exports = server;
