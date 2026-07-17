'use strict';

const http = require('node:http');

if (process.env.NODE_ENV !== 'test') throw new Error('Manufacturer mock server is test-only');

export function createManufacturerMockServer({ apiKey = 'integration-test-key' } = {}) {
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/manufacturer/robot/command' || req.headers['x-manufacturer-api-key'] !== apiKey) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted' }));
  });
}
