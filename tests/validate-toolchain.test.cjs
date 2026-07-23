'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { npmVersion, validateToolchain } = require('../scripts/validate-toolchain.cjs');

const policy = Object.freeze({ nodeVersion: '24.18.0', npmVersion: '12.0.1' });

test('toolchain contract accepts only the reviewed Node and npm pair', () => {
  assert.deepEqual(validateToolchain({ nodeVersion: '24.18.0', npmVersion: '12.0.1' }, policy), {
    nodeVersion: '24.18.0',
    npmVersion: '12.0.1'
  });
  assert.throws(
    () => validateToolchain({ nodeVersion: '22.23.1', npmVersion: '12.0.1' }, policy),
    /Node 24\.18\.0 is required/
  );
  assert.throws(
    () => validateToolchain({ nodeVersion: '24.18.0', npmVersion: '11.16.0' }, policy),
    /npm 12\.0\.1 is required/
  );
});

test('npm version is read from the executable selected by the active toolchain', () => {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    return { status: 0, stdout: '12.0.1\n' };
  };
  assert.equal(npmVersion(run), '12.0.1');
  assert.deepEqual(calls[0].args, ['--version']);
});
