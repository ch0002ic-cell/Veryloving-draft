'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pcmBytesToBase64 } = require('../src/utils/pcm');

test('PCM16 buffers are encoded as headerless base64 without changing bytes', () => {
  const pcm = Uint8Array.from([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]);
  assert.equal(pcmBytesToBase64(pcm), 'AAD/fwCA');
  assert.deepEqual(Buffer.from(pcmBytesToBase64(pcm), 'base64'), Buffer.from(pcm));
});

test('PCM encoder rejects partial 16-bit samples and accepts empty buffers', () => {
  assert.equal(pcmBytesToBase64(new ArrayBuffer(0)), '');
  assert.throws(() => pcmBytesToBase64(Uint8Array.from([0x00])), /complete 16-bit samples/);
});
