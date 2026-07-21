'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readBoundedJSONResponse } = require('./bounded-response.cjs');

test('bounded provider reads release a locked reader when abort wins a stalled read', async () => {
  const controller = new AbortController();
  let cancellations = 0;
  let releases = 0;
  const reader = {
    read: () => new Promise(() => {}),
    cancel: async () => { cancellations += 1; },
    releaseLock: () => { releases += 1; }
  };
  const operation = readBoundedJSONResponse({
    headers: { get: () => null },
    body: { getReader: () => reader }
  }, {
    context: 'Test provider',
    maxBytes: 1024,
    signal: controller.signal
  });
  controller.abort();

  await assert.rejects(operation, (error) => error?.name === 'AbortError');
  assert.equal(cancellations, 1);
  assert.equal(releases, 1);
});

test('bounded provider reads contain non-Promise cancellation and count actual chunk bytes', async () => {
  let releases = 0;
  const reader = {
    async read() { return { done: false, value: 'oversized' }; },
    cancel() {},
    releaseLock() { releases += 1; }
  };

  await assert.rejects(readBoundedJSONResponse({
    headers: { get: () => null },
    body: { getReader: () => reader }
  }, {
    context: 'Test provider',
    maxBytes: 4
  }), (error) => error?.code === 'UPSTREAM_RESPONSE_TOO_LARGE');
  assert.equal(releases, 1);
});
