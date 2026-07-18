const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = resolve(__dirname, '..');
const exportRoot = mkdtempSync(join(tmpdir(), 'veryloving-validate-'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const steps = [
  {
    label: 'Development environment',
    command: npmCommand,
    args: ['run', 'validate-env', '--', '--profile', 'development', '--no-color']
  },
  { label: 'ESLint', command: npmCommand, args: ['run', 'lint'] },
  { label: 'Tests', command: npmCommand, args: ['test'] },
  { label: 'Expo Doctor', command: npmCommand, args: ['run', 'doctor'] },
  {
    label: 'iOS production export',
    command: npxCommand,
    args: ['expo', 'export', '--platform', 'ios', '--output-dir', join(exportRoot, 'ios')],
    env: { VERYLOVING_BUILD_PROFILE: 'production', VERYLOVING_CONFIG_DIAGNOSTICS: '1' }
  },
  {
    label: 'Android production export',
    command: npxCommand,
    args: ['expo', 'export', '--platform', 'android', '--output-dir', join(exportRoot, 'android')],
    env: { VERYLOVING_BUILD_PROFILE: 'production', VERYLOVING_CONFIG_DIAGNOSTICS: '1' }
  }
];

let exitCode = 0;

try {
  for (const step of steps) {
    process.stdout.write(`\n==> ${step.label}\n`);
    const result = spawnSync(step.command, step.args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        CI: process.env.CI || '1',
        EXPO_NO_TELEMETRY: '1',
        ...(step.env || {})
      },
      stdio: 'inherit'
    });

    if (result.error) {
      process.stderr.write(`${step.label} could not start: ${result.error.message}\n`);
      exitCode = 1;
      break;
    }

    if (result.status !== 0) {
      process.stderr.write(`${step.label} failed${result.signal ? ` (${result.signal})` : ''}.\n`);
      exitCode = result.status || 1;
      break;
    }
  }
} finally {
  rmSync(exportRoot, { recursive: true, force: true });
}

if (exitCode === 0) process.stdout.write('\nValidation passed.\n');
process.exitCode = exitCode;
