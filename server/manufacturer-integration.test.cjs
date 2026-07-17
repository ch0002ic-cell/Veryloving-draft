'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ActionGateway, signEnvelope } = require('./action-gateway.cjs');
const { createManufacturerMockServer } = require('../tests/integration/manufacturer-mock-server.js');

test('manufacturer mock receives the signed production webhook contract', async (t) => {
  const signingPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
  const server = createManufacturerMockServer({ apiKey: 'integration-test-key' });
  t.after(() => server.close());
  const requestHandler = server.listeners('request')[0];
  const fetchImpl = async (url, options) => new Promise((resolve) => {
    const parsed = new URL(url);
    const req = { method: options.method, url: parsed.pathname, headers: { 'x-manufacturer-api-key': options.headers['X-Manufacturer-Api-Key'] } };
    const res = {
      statusCode: 200,
      writeHead(statusCode) { this.statusCode = statusCode; return this; },
      end() { resolve({ ok: this.statusCode >= 200 && this.statusCode < 300, status: this.statusCode }); }
    };
    requestHandler(req, res);
  });
  const gateway = new ActionGateway({
    signingPrivateKey,
    manufacturerWebhookURL: 'http://manufacturer.test/v1/manufacturer/robot/command',
    manufacturerApiKey: 'integration-test-key',
    fetchImpl
  });
  const result = await gateway.deliverRobot(signEnvelope({
    action: 'check_medication',
    device_type: 'home_robot',
    device_id: 'r1',
    manufacturer_device_id: 'manufacturer-r1',
    parameters: {}
  }, signingPrivateKey));
  assert.equal(result.status, 202);
});
