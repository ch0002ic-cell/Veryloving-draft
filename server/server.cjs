'use strict';

const http = require('node:http');
const { createHandler } = require('./clm-server.cjs');

// Vercel's Node server entrypoint captures a server that begins listening at
// module startup and forwards requests as standard IncomingMessage/
// ServerResponse objects. This entrypoint intentionally mounts only the HTTP
// handler. The raw Hume WebSocket upgrade gateway remains on the container
// entrypoint in clm-server.cjs until that transport is adapted and load-tested
// for its eventual host.
const server = http.createServer(createHandler({ httpOnlyDeployment: true }));
server.requestTimeout = 35000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(Number(process.env.PORT || 8787));

module.exports = server;
