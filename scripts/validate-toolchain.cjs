#!/usr/bin/env node

'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = resolve(__dirname, '..');

function npmVersion(run = spawnSync) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = run(executable, ['--version'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    throw new Error('npm version could not be determined');
  }
  return String(result.stdout).trim();
}

function validateToolchain(actual, policy) {
  if (actual.nodeVersion !== policy.nodeVersion) {
    throw new Error(`Node ${policy.nodeVersion} is required; found ${actual.nodeVersion}`);
  }
  if (actual.npmVersion !== policy.npmVersion) {
    throw new Error(`npm ${policy.npmVersion} is required; found ${actual.npmVersion}`);
  }
  return actual;
}

function run() {
  try {
    const policy = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'release-policy.json'), 'utf8'));
    const actual = validateToolchain({
      nodeVersion: process.versions.node,
      npmVersion: npmVersion()
    }, policy);
    process.stdout.write(`Toolchain passed: Node ${actual.nodeVersion}; npm ${actual.npmVersion}.\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Toolchain validation failed: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = run();

module.exports = { npmVersion, run, validateToolchain };
