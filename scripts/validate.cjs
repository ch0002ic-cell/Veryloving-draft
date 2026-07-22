const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = resolve(__dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// Deterministic, non-routable public configuration used only to prove that a
// production-profile JavaScript bundle can be generated without Grace's real
// provider credentials. The temporary exports are deleted before this script
// exits and are never release artifacts.
const PRODUCTION_EXPORT_ENVIRONMENT = Object.freeze({
  NODE_ENV: 'production',
  EAS_BUILD: 'false',
  VERYLOVING_BUILD_PROFILE: 'production',
  VERYLOVING_CONFIG_DIAGNOSTICS: '1',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.bundle-validation.invalid',
  EXPO_PUBLIC_ACTION_GATEWAY_URL: 'https://voice.bundle-validation.invalid/v1/actions',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '123-bundle-web.apps.googleusercontent.com',
  EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-bundle-ios.apps.googleusercontent.com',
  EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
  EXPO_PUBLIC_HUME_WS_PROXY_URL: 'wss://voice.bundle-validation.invalid/socket',
  EXPO_PUBLIC_HUME_CONFIG_ID: '123e4567-e89b-42d3-a456-426614174000',
  EXPO_PUBLIC_HUME_CUSTOMIZATION_URL: 'https://voice.bundle-validation.invalid',
  EXPO_PUBLIC_HUME_CLM_ENABLED: 'true',
  EXPO_PUBLIC_HUME_API_KEY: '',
  EXPO_PUBLIC_HUME_BRANDED_VOICE_ID: '',
  EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.bundle-validation-public',
  EXPO_PUBLIC_ENABLE_OFFLINE_MODE: 'false',
  EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES: 'false',
  EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'false',
  EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'true',
  EXPO_PUBLIC_VL01_ENABLED: 'true',
  EXPO_PUBLIC_VL01_SERVICE_UUID: 'fff0',
  EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID: 'fff1',
  EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID: 'fff2',
  EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID: 'fff3',
  EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID: 'fff4',
  RNMAPBOX_MAPS_DOWNLOAD_TOKEN: 'sk.bundle-validation-not-a-credential'
});

function createValidationSteps(exportRoot) {
  return [
    {
      label: 'Development environment',
      command: npmCommand,
      args: ['run', 'validate-env', '--', '--profile', 'development', '--no-color']
    },
    {
      label: 'Server environment dry-run',
      command: npmCommand,
      args: ['run', 'validate-env:server']
    },
    { label: 'ESLint', command: npmCommand, args: ['run', 'lint'] },
    { label: 'Tests', command: npmCommand, args: ['test'] },
    { label: 'Expo Doctor', command: npmCommand, args: ['run', 'doctor'] },
    {
      label: 'Non-release production export configuration',
      command: npmCommand,
      args: ['run', 'validate-env', '--', '--profile', 'production', '--no-color'],
      env: PRODUCTION_EXPORT_ENVIRONMENT
    },
    {
      label: 'iOS production export',
      command: npxCommand,
      args: ['expo', 'export', '--platform', 'ios', '--output-dir', join(exportRoot, 'ios')],
      env: PRODUCTION_EXPORT_ENVIRONMENT
    },
    {
      label: 'Android production export',
      command: npxCommand,
      args: ['expo', 'export', '--platform', 'android', '--output-dir', join(exportRoot, 'android')],
      env: PRODUCTION_EXPORT_ENVIRONMENT
    }
  ];
}

function run() {
  const exportRoot = mkdtempSync(join(tmpdir(), 'veryloving-validate-'));
  let exitCode = 0;

  try {
    for (const step of createValidationSteps(exportRoot)) {
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
  return exitCode;
}

if (require.main === module) process.exitCode = run();

module.exports = { PRODUCTION_EXPORT_ENVIRONMENT, createValidationSteps, run };
