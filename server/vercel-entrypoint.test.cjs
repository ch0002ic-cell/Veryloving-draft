'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const serverRoot = path.resolve(process.cwd(), 'server');
const entrypointSource = fs.readFileSync(path.join(serverRoot, 'server.cjs'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(serverRoot, 'vercel.json'), 'utf8'));
const packageConfig = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));

test('Vercel entrypoint starts the existing HTTP handler without mounting raw WebSocket upgrades', () => {
  assert.match(entrypointSource, /require\(['"]node:http['"]\)/);
  assert.match(entrypointSource, /require\(['"]\.\/clm-server\.cjs['"]\)/);
  assert.match(entrypointSource, /http\.createServer\(createHandler\(\{ httpOnlyDeployment: true \}\)\)/);
  assert.match(entrypointSource, /server\.listen\(/);
  assert.doesNotMatch(entrypointSource, /attachVoiceGateway|createVeryLovingCLMServer|\.on\(['"]upgrade['"]\)/);
});

test('Vercel project config targets the Node server entrypoint with a bounded duration', () => {
  assert.equal(vercelConfig.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.deepEqual(vercelConfig.functions, {
    'server.cjs': { maxDuration: 60 }
  });
  assert.equal(packageConfig.type, 'commonjs');
  assert.match(packageConfig.engines.node, /22/);
  assert.equal(typeof packageConfig.dependencies['@aws-sdk/client-dynamodb'], 'string');
  assert.equal(typeof packageConfig.dependencies.ws, 'string');
});
