'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const { URLSearchParams } = require('node:url');

const serverRoot = path.resolve(process.cwd(), 'server');
const railwaySource = fs.readFileSync(path.resolve(process.cwd(), 'railway.toml'), 'utf8');
const entrypointSource = fs.readFileSync(path.join(serverRoot, 'server.cjs'), 'utf8');
const clmServerSource = fs.readFileSync(path.join(serverRoot, 'clm-server.cjs'), 'utf8');
const functionSource = fs.readFileSync(path.join(serverRoot, 'api', 'index.js'), 'utf8');
const vercelConfig = JSON.parse(fs.readFileSync(path.join(serverRoot, 'vercel.json'), 'utf8'));
const packageConfig = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));
const INTERNAL_ROUTE_PARAMETER = '__veryloving_route';
const TEST_CLM_TOKEN = 'vercel-adapter-test-token';

const previousCLMToken = process.env.HUME_CLM_BEARER_TOKEN;
process.env.HUME_CLM_BEARER_TOKEN = TEST_CLM_TOKEN;
const vercelHandler = require('./api/index.js');
if (previousCLMToken === undefined) delete process.env.HUME_CLM_BEARER_TOKEN;
else process.env.HUME_CLM_BEARER_TOKEN = previousCLMToken;

async function invokeVercel({
  method = 'GET',
  route = 'health',
  query = [],
  url,
  headers = {},
  rawBody
} = {}) {
  const parameters = new URLSearchParams([[INTERNAL_ROUTE_PARAMETER, route], ...query]);
  const request = Readable.from(rawBody === undefined ? [] : [Buffer.from(rawBody)]);
  request.method = method;
  request.url = url || `/api/index?${parameters}`;
  request.query = { [INTERNAL_ROUTE_PARAMETER]: 'request-query-object-is-not-trusted' };
  request.headers = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  const chunks = [];
  const response = {
    headersSent: false,
    statusCode: null,
    headers: {},
    writeHead(statusCode, responseHeaders = {}) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
      this.headersSent = true;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.from(chunk));
      this.finished = true;
    }
  };

  await vercelHandler(request, response);
  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = response.headers['Content-Type'] || response.headers['content-type'] || '';
  return {
    request,
    status: response.statusCode,
    headers: response.headers,
    text,
    json: text && contentType.includes('application/json') ? JSON.parse(text) : null
  };
}

test('standalone HTTP listener starts the existing handler without mounting raw WebSocket upgrades', () => {
  assert.match(entrypointSource, /require\(['"]node:http['"]\)/);
  assert.match(entrypointSource, /require\(['"]\.\/clm-server\.cjs['"]\)/);
  assert.match(entrypointSource, /require\(['"]\.\/ai-native-demo\.cjs['"]\)/);
  assert.match(entrypointSource, /process\.loadEnvFile\(/);
  // The standalone entrypoint may compose the CLM handler with local-only
  // middleware (for example, the AI-native demo injector). Keep this guard
  // focused on the deployment boundary instead of requiring one exact source
  // expression.
  assert.match(entrypointSource, /httpOnlyDeployment:\s*true/);
  assert.match(entrypointSource, /createHandler\(/);
  assert.match(entrypointSource, /http\.createServer\(/);
  assert.match(entrypointSource, /server\.listen\(/);
  assert.match(entrypointSource, /\[AI-Native\] System injected/);
  assert.doesNotMatch(entrypointSource, /attachVoiceGateway|createVeryLovingCLMServer|\.on\(['"]upgrade['"]\)/);
});

test('HTTP-only imports do not eagerly load the raw voice gateway', () => {
  assert.equal(require.cache[require.resolve('./voice-gateway.cjs')], undefined);
  assert.match(
    clmServerSource,
    /function createVeryLovingCLMServer[\s\S]*require\(['"]\.\/voice-gateway\.cjs['"]\)/
  );
  assert.doesNotMatch(
    clmServerSource.slice(0, clmServerSource.indexOf('function createVeryLovingCLMServer')),
    /require\(['"]\.\/voice-gateway\.cjs['"]\)/
  );
});

test('Vercel uses one HTTP-only function behind a namespaced catch-all rewrite', () => {
  assert.match(functionSource, /require\(['"]\.\.\/clm-server\.cjs['"]\)/);
  assert.match(functionSource, /createHandler\(\{ httpOnlyDeployment: true \}\)/);
  assert.doesNotMatch(functionSource, /attachVoiceGateway|createVeryLovingCLMServer|\.on\(['"]upgrade['"]\)/);
  assert.equal(vercelConfig.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.deepEqual(vercelConfig.functions, {
    'api/index.js': { maxDuration: 60 }
  });
  assert.deepEqual(vercelConfig.rewrites, [{
    source: '/:path*',
    destination: '/api/index?__veryloving_route=:path*'
  }]);
  assert.equal(packageConfig.type, 'commonjs');
  assert.equal(packageConfig.engines.node, '22.x');
  assert.equal(typeof packageConfig.dependencies['@aws-sdk/client-dynamodb'], 'string');
  assert.equal(typeof packageConfig.dependencies.ws, 'string');
});

test('Railway deploys the long-lived server Dockerfile with a health gate', () => {
  assert.match(railwaySource, /builder = "DOCKERFILE"/);
  assert.match(railwaySource, /dockerfilePath = "server\/Dockerfile"/);
  assert.match(railwaySource, /healthcheckPath = "\/health"/);
  assert.match(railwaySource, /restartPolicyType = "ON_FAILURE"/);
});

test('Vercel rewrite adapter restores a route and preserves legitimate repeated query parameters', async () => {
  const result = await invokeVercel({
    query: [['path', 'client-value'], ['tag', 'one'], ['tag', 'two']]
  });

  assert.equal(result.request.url, '/health?path=client-value&tag=one&tag=two');
  assert.equal(result.status, 200);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.deepEqual(result.json, { status: 'ok', service: 'veryloving-hume-clm' });
});

test('Vercel rewrite adapter rejects missing, duplicate, traversal, malformed, and oversized route metadata', async () => {
  const invalidURLs = [
    '/api/index?probe=missing',
    `/api/index?${INTERNAL_ROUTE_PARAMETER}=health&${INTERNAL_ROUTE_PARAMETER}=v1%2Fauth%2Fexchange`,
    `/api/index?${INTERNAL_ROUTE_PARAMETER}=..%2Fhealth`,
    `/api/index?${INTERNAL_ROUTE_PARAMETER}=%2F%2Fevil.example`,
    `/api/index?${INTERNAL_ROUTE_PARAMETER}=v1%2F%2Fauth`,
    `/api/index?${INTERNAL_ROUTE_PARAMETER}=${'a'.repeat(1025)}`,
    'http://%'
  ];

  for (const url of invalidURLs) {
    const result = await invokeVercel({ url });
    assert.equal(result.status, 400, url);
    assert.deepEqual(result.json, { error: 'Invalid internal route metadata' }, url);
    assert.equal(result.headers['Cache-Control'], 'no-store', url);
  }
});

test('Vercel adapter streams an authenticated CLM response and retains the session query', async () => {
  const body = JSON.stringify({
    model: 'veryloving-test',
    messages: [{ role: 'user', content: 'I feel uneasy walking home.' }]
  });
  const result = await invokeVercel({
    method: 'POST',
    route: 'chat/completions',
    query: [['custom_session_id', 'opaque-session-1']],
    headers: {
      Authorization: `Bearer ${TEST_CLM_TOKEN}`,
      'Content-Type': 'application/vnd.openai+json; charset=utf-8'
    },
    rawBody: body
  });

  assert.equal(result.request.url, '/chat/completions?custom_session_id=opaque-session-1');
  assert.equal(result.status, 200);
  assert.match(result.headers['Content-Type'], /text\/event-stream/);
  assert.match(result.text, /opaque-session-1/);
  assert.match(result.text, /data: \[DONE\]/);
});

test('Vercel adapter rejects unsupported, invalid, and oversized JSON request bodies', async () => {
  const base = {
    method: 'POST',
    route: 'chat/completions',
    headers: { Authorization: `Bearer ${TEST_CLM_TOKEN}`, 'Content-Type': 'application/json' }
  };

  const unsupported = await invokeVercel({
    ...base,
    headers: { ...base.headers, 'Content-Type': 'text/plain' },
    rawBody: JSON.stringify({ messages: [] })
  });
  assert.equal(unsupported.status, 415);
  assert.deepEqual(unsupported.json, { error: 'Content-Type must be application/json' });

  const invalid = await invokeVercel({ ...base, rawBody: '{"messages":' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.json, { error: 'Request body must be valid JSON' });

  const oversized = await invokeVercel({
    ...base,
    rawBody: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(256 * 1024) }] })
  });
  assert.equal(oversized.status, 413);
  assert.deepEqual(oversized.json, { error: 'Request body is too large' });
});

test('Vercel HTTP surface does not expose the container WebSocket route', async () => {
  const result = await invokeVercel({ route: 'api/voice/hume-ws' });
  assert.equal(result.status, 404);
  assert.deepEqual(result.json, { error: 'Not found' });
});
