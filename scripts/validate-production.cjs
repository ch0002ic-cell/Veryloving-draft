#!/usr/bin/env node

'use strict';

const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  validateSupplyChain,
  writeProductionSboms
} = require('./release-supply-chain.cjs');

const PROJECT_ROOT = resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const AbortSignalClass = globalThis.AbortSignal;

function execute(command, args, { expectedStatus = 0, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: capture ? 'utf8' : undefined,
    env: { ...process.env, CI: process.env.CI || '1' },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== expectedStatus) {
    const detail = capture ? String(result.stderr || result.stdout || '').trim().slice(0, 500) : '';
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return capture ? String(result.stdout || '').trim() : '';
}

function runAudit({ offline }) {
  const args = ['audit', '--audit-level=high'];
  if (offline) args.push('--offline');
  execute(npmCommand, args);
  execute(npmCommand, ['--prefix', 'server', ...args]);
}

function validateSourceProductionGates() {
  process.stdout.write('Validating the reviewed Node and npm toolchain.\n');
  execute(process.execPath, ['scripts/validate-toolchain.cjs']);
  process.stdout.write('Building and testing the production AI-native composition boundary.\n');
  execute(npmCommand, ['run', 'build:ai-native']);
  execute(npmCommand, ['run', 'test:ai-native', '--', '--coverage=false']);
  execute(process.execPath, [
    '--test',
    'server/ai-native-composition.test.cjs',
    'server/vercel-entrypoint.test.cjs',
    'tests/release-supply-chain.test.cjs',
    'tests/validate-env.test.cjs'
  ]);
}

function validateSbomFiles(written) {
  for (const artifact of written) {
    const bom = JSON.parse(readFileSync(artifact.outputPath, 'utf8'));
    if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.5') {
      throw new Error(`${artifact.outputPath} is not a CycloneDX 1.5 SBOM`);
    }
    if (!Array.isArray(bom.components) || bom.components.length !== artifact.components) {
      throw new Error(`${artifact.outputPath} has an invalid component inventory`);
    }
  }
}

async function validateContainer() {
  execute('docker', ['version'], { capture: true });
  const imageTag = 'veryloving-clm:production-validation';
  const containerName = `veryloving-production-validation-${process.pid}`;
  execute('docker', [
    'buildx', 'build', '--pull', '--load',
    '--tag', imageTag, '--file', 'server/Dockerfile', '.'
  ]);
  const user = execute('docker', ['image', 'inspect', '--format', '{{.Config.User}}', imageTag], { capture: true });
  const health = execute('docker', ['image', 'inspect', '--format', '{{if .Config.Healthcheck}}configured{{end}}', imageTag], { capture: true });
  const command = execute('docker', ['image', 'inspect', '--format', '{{json .Config.Cmd}}', imageTag], { capture: true });
  if (user !== 'node' || health !== 'configured' || command !== '["node","clm-server.cjs"]') {
    throw new Error('Container runtime policy does not match the reviewed non-root health-checked entrypoint');
  }
  execute('docker', [
    'run', '--rm', '--network', 'none', '--entrypoint', 'sh', imageTag, '-c',
    'test ! -d /usr/local/lib/node_modules/npm'
      + ' && test ! -e /usr/local/bin/npm && test ! -L /usr/local/bin/npm'
      + ' && test ! -e /usr/local/bin/npx && test ! -L /usr/local/bin/npx'
  ]);

  // A credentials-free production container must fail closed before binding.
  const failClosed = spawnSync('docker', ['run', '--rm', '--network', 'none', imageTag], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (failClosed.error || failClosed.status === 0) {
    throw new Error('Credentials-free production container did not fail closed');
  }

  let started = false;
  try {
    execute('docker', [
      'run', '--detach', '--name', containerName,
      '--env', 'NODE_ENV=development', '--env', 'PORT=8787',
      '--publish', '127.0.0.1::8787', imageTag
    ], { capture: true });
    started = true;
    const portMapping = execute('docker', ['port', containerName, '8787/tcp'], { capture: true });
    const portMatch = /:(\d+)\s*$/.exec(portMapping);
    if (!portMatch) throw new Error('Docker did not publish the health-check port');
    const healthURL = `http://127.0.0.1:${portMatch[1]}/health`;
    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(healthURL, { signal: AbortSignalClass.timeout(1000) });
        if (response.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    }
    if (!healthy) throw new Error('Container health endpoint did not become ready');
    execute('docker', ['stop', '--time', '20', containerName]);
    started = false;
    const exitCode = execute('docker', ['inspect', '--format', '{{.State.ExitCode}}', containerName], { capture: true });
    if (exitCode !== '0') throw new Error(`Container did not shut down cleanly (exit ${exitCode})`);
  } finally {
    if (started) spawnSync('docker', ['stop', '--time', '5', containerName], { cwd: PROJECT_ROOT, stdio: 'ignore' });
    spawnSync('docker', ['rm', containerName], { cwd: PROJECT_ROOT, stdio: 'ignore' });
  }
}

async function run(argv = process.argv.slice(2)) {
  const release = argv.includes('--release');
  if (argv.some((argument) => argument !== '--release')) {
    process.stderr.write('Usage: validate-production.cjs [--release]\n');
    return 2;
  }
  const temporaryOutput = release ? null : mkdtempSync(join(tmpdir(), 'veryloving-production-sbom-'));
  const output = release ? resolve(PROJECT_ROOT, 'release-artifacts/sbom') : temporaryOutput;
  try {
    const policy = validateSupplyChain(PROJECT_ROOT);
    process.stdout.write(`Immutable policy: ${policy.nodeImage}; EAS CLI ${policy.easCliVersion}.\n`);
    validateSourceProductionGates();
    process.stdout.write(`Running ${release ? 'live' : 'offline cached'} dependency audits.\n`);
    runAudit({ offline: !release });
    const written = writeProductionSboms(output, PROJECT_ROOT);
    validateSbomFiles(written);
    process.stdout.write(`Validated ${written.length} CycloneDX 1.5 production SBOMs.\n`);
    if (release) await validateContainer();
    process.stdout.write(release
      ? 'Live production release validation passed.\n'
      : 'Local production source validation passed. Live registry/container evidence is intentionally deferred to validate:production:release.\n');
    return 0;
  } catch (error) {
    process.stderr.write(`Production validation failed: ${error.message}\n`);
    return 1;
  } finally {
    if (temporaryOutput) rmSync(temporaryOutput, { recursive: true, force: true });
  }
}

if (require.main === module) {
  run().then((code) => { process.exitCode = code; });
}

module.exports = { run, runAudit, validateSbomFiles, validateSourceProductionGates };
