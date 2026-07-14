'use strict';

const http = require('node:http');
const { createHandler } = require('./clm-server.cjs');

// Standalone HTTP-only listener for platforms and local probes that capture a
// Node server. Vercel invokes the same handler through api/index.js. The raw
// Hume WebSocket upgrade gateway remains on the container entrypoint in
// clm-server.cjs until that transport is adapted and load-tested for its host.
const server = http.createServer(createHandler({ httpOnlyDeployment: true }));
server.requestTimeout = 35000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(Number(process.env.PORT || 8787));

module.exports = server;
