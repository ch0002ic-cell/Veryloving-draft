const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ROOT_VARIABLES,
  endpointProblem,
  parseDotEnv,
  parseArguments,
  validateEnvironment,
  renderReport
} = require('../scripts/validate-env.cjs');

function productionEnvironment(overrides = {}) {
  return {
    EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web.apps.googleusercontent.com',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios.apps.googleusercontent.com',
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    EXPO_PUBLIC_HUME_WS_PROXY_URL: 'wss://voice.example.test/api/voice/hume-ws',
    EXPO_PUBLIC_HUME_CONFIG_ID: '00000000-0000-4000-8000-000000000001',
    EXPO_PUBLIC_HUME_CUSTOMIZATION_URL: 'https://api.example.test',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'true',
    EXPO_PUBLIC_HUME_BRANDED_VOICE_ID: '',
    EXPO_PUBLIC_HUME_API_KEY: '',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.public-placeholder',
    EXPO_PUBLIC_ENABLE_OFFLINE_MODE: 'false',
    EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES: 'false',
    EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'false',
    EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'true',
    EXPO_PUBLIC_VL01_ENABLED: 'true',
    EXPO_PUBLIC_VL01_SERVICE_UUID: '180f',
    EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID: '2a19',
    EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID: '00000001-0000-4000-8000-000000000001',
    EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID: '00000002-0000-4000-8000-000000000001',
    EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID: '00000003-0000-4000-8000-000000000001',
    RNMAPBOX_MAPS_DOWNLOAD_TOKEN: 'sk.download-placeholder',
    VERYLOVING_BUILD_PROFILE: 'production',
    VERYLOVING_CONFIG_DIAGNOSTICS: '1',
    ...overrides
  };
}

test('dotenv parser supports export, quotes, inline comments, and embedded hashes', () => {
  assert.deepEqual(parseDotEnv([
    'export FIRST="hello world"',
    "SECOND='literal # hash'",
    'THIRD=value # comment',
    'FOURTH="https://example.test/#anchor"',
    'FIFTH="pk.quoted" # public token',
    'INVALID LINE'
  ].join('\n')), {
    FIRST: 'hello world',
    SECOND: 'literal # hash',
    THIRD: 'value',
    FOURTH: 'https://example.test/#anchor',
    FIFTH: 'pk.quoted'
  });
});

test('argument parser rejects missing option values', () => {
  assert.throws(() => parseArguments(['--file', '--no-color']), /--file requires a value/);
  assert.throws(() => parseArguments(['--profile']), /--profile requires a value/);
});

test('development endpoints allow only HTTP or WS on loopback, including IPv6', () => {
  assert.equal(endpointProblem('http://localhost:8787', 'https:', { allowLocalDevelopment: true }), null);
  assert.equal(endpointProblem('ws://[::1]:8787', 'wss:', { allowLocalDevelopment: true }), null);
  assert.equal(endpointProblem('ftp://localhost:8787', 'https:', { allowLocalDevelopment: true }), 'must use https');
  assert.equal(endpointProblem('https://api.example.test?region=sg', 'https:'), 'must not contain query parameters or fragments');
  assert.equal(endpointProblem('wss://voice.example.test/socket#fragment', 'wss:'), 'must not contain query parameters or fragments');
});

test('the environment template and validator catalog stay synchronized', () => {
  const template = parseDotEnv(readFileSync(resolve(process.cwd(), '.env.example'), 'utf8'));
  assert.deepEqual(Object.keys(template).sort(), [...ROOT_VARIABLES].sort());
});

test('complete production configuration passes without exposing values', () => {
  const environment = productionEnvironment();
  const results = validateEnvironment(environment, {
    profile: 'production',
    fileEnvironment: environment
  });
  assert.equal(results.some((result) => result.level === 'error'), false);
  const report = renderReport({
    results,
    profile: 'production',
    filePath: '/private/config/.env',
    fileFound: true,
    color: false
  });
  assert.doesNotMatch(report, /pk\.public-placeholder|sk\.download-placeholder|api\.example\.test/);
});

test('production reports missing requirements and rejects public secrets', () => {
  const environment = productionEnvironment({
    EXPO_PUBLIC_API_BASE_URL: '',
    EXPO_PUBLIC_HUME_API_KEY: 'must-not-be-printed',
    EXPO_PUBLIC_ENABLE_OFFLINE_MODE: 'true',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'sk.wrong-kind'
  });
  const results = validateEnvironment(environment, {
    profile: 'production',
    fileEnvironment: environment
  });
  const errors = new Map(results.filter((result) => result.level === 'error').map((result) => [result.name, result.message]));
  assert.equal(errors.has('EXPO_PUBLIC_API_BASE_URL'), true);
  assert.equal(errors.has('EXPO_PUBLIC_HUME_API_KEY'), true);
  assert.equal(errors.has('EXPO_PUBLIC_ENABLE_OFFLINE_MODE'), true);
  assert.equal(errors.has('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN'), true);
  assert.doesNotMatch(JSON.stringify(results), /must-not-be-printed|sk\.wrong-kind/);
});

test('RTL QA locale flag must be an explicit boolean', () => {
  const environment = productionEnvironment({
    EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES: 'yes'
  });
  const results = validateEnvironment(environment, { profile: 'production' });
  const issue = results.find((result) => result.name === 'EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES');
  assert.equal(issue?.level, 'error');
  assert.match(issue?.message || '', /true or false/);
});

test('full language catalog flag is development-only and must be an explicit boolean', () => {
  const invalidBoolean = validateEnvironment(productionEnvironment({
    EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'yes'
  }), { profile: 'production' });
  assert.match(
    invalidBoolean.find((result) => result.name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES')?.message || '',
    /true or false/
  );

  for (const profile of ['preview', 'production']) {
    const results = validateEnvironment(productionEnvironment({
      EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'true',
      VERYLOVING_BUILD_PROFILE: profile
    }), { profile });
    const issue = results.find((result) => result.name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES');
    assert.equal(issue?.level, 'error');
    assert.match(issue?.message || '', /outside development/);
  }

  const development = validateEnvironment(productionEnvironment({
    EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'true',
    VERYLOVING_BUILD_PROFILE: 'development'
  }), { profile: 'development' });
  assert.equal(
    development.find((result) => result.name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES')?.level,
    'ok'
  );
});

test('Hume configuration and voice overrides must be canonical IDs', () => {
  const environment = productionEnvironment({
    EXPO_PUBLIC_HUME_CONFIG_ID: '180f',
    EXPO_PUBLIC_HUME_BRANDED_VOICE_ID: 'capybear'
  });
  const results = validateEnvironment(environment, { profile: 'production' });
  const errors = new Set(results.filter((result) => result.level === 'error').map((result) => result.name));
  assert.equal(errors.has('EXPO_PUBLIC_HUME_CONFIG_ID'), true);
  assert.equal(errors.has('EXPO_PUBLIC_HUME_BRANDED_VOICE_ID'), true);
});

test('production requires the Mapbox download secret only on the remote EAS builder', () => {
  const localEnvironment = productionEnvironment({ RNMAPBOX_MAPS_DOWNLOAD_TOKEN: '' });
  const localResults = validateEnvironment(localEnvironment, { profile: 'production' });
  const localIssue = localResults.find((result) => result.name === 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN');
  assert.equal(localIssue?.level, 'warn');

  const easEnvironment = { ...localEnvironment, EAS_BUILD: 'true' };
  const easResults = validateEnvironment(easEnvironment, { profile: 'production' });
  const easIssue = easResults.find((result) => result.name === 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN');
  assert.equal(easIssue?.level, 'error');
});

test('dotenv interpolation cannot produce a false-green endpoint', () => {
  const results = validateEnvironment({
    EXPO_PUBLIC_API_BASE_URL: 'https://${HOST}',
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'false',
    EXPO_PUBLIC_ENABLE_OFFLINE_MODE: 'false',
    EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'false',
    EXPO_PUBLIC_VL01_ENABLED: 'false',
    VERYLOVING_BUILD_PROFILE: 'development',
    VERYLOVING_CONFIG_DIAGNOSTICS: '0'
  }, { profile: 'development' });
  const issue = results.find((result) => result.name === 'EXPO_PUBLIC_API_BASE_URL');
  assert.equal(issue?.level, 'error');
  assert.match(issue?.message || '', /concrete value/);
});

test('feature flags make their dependencies required outside production', () => {
  const results = validateEnvironment({
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'true',
    EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'true',
    EXPO_PUBLIC_VL01_ENABLED: 'true',
    EXPO_PUBLIC_ENABLE_OFFLINE_MODE: 'false',
    VERYLOVING_BUILD_PROFILE: 'development',
    VERYLOVING_CONFIG_DIAGNOSTICS: '0'
  }, { profile: 'development' });
  const errorNames = new Set(results.filter((result) => result.level === 'error').map((result) => result.name));
  for (const expected of [
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_HUME_WS_PROXY_URL',
    'EXPO_PUBLIC_HUME_CONFIG_ID',
    'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL',
    'EXPO_PUBLIC_VL01_SERVICE_UUID',
    'EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID'
  ]) assert.equal(errorNames.has(expected), true, expected);
});

test('root environment rejects misplaced server secrets without returning them', () => {
  const results = validateEnvironment({}, {
    profile: 'development',
    fileEnvironment: { SESSION_JWT_SECRET: 'do-not-print-this-value' }
  });
  const issue = results.find((result) => result.name === 'SESSION_JWT_SECRET');
  assert.equal(issue?.level, 'error');
  assert.doesNotMatch(JSON.stringify(results), /do-not-print-this-value/);
});

test('preview requires secure endpoint schemes and rejects direct Hume keys', () => {
  const results = validateEnvironment({
    EXPO_PUBLIC_API_BASE_URL: 'http://preview.example.test',
    EXPO_PUBLIC_HUME_WS_PROXY_URL: 'ws://preview.example.test',
    EXPO_PUBLIC_HUME_API_KEY: 'hidden',
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'false',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'false',
    EXPO_PUBLIC_ENABLE_OFFLINE_MODE: 'false',
    EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'false',
    EXPO_PUBLIC_VL01_ENABLED: 'false',
    VERYLOVING_BUILD_PROFILE: 'preview',
    VERYLOVING_CONFIG_DIAGNOSTICS: '1'
  }, { profile: 'preview' });
  const errors = new Set(results.filter((result) => result.level === 'error').map((result) => result.name));
  assert.equal(errors.has('EXPO_PUBLIC_API_BASE_URL'), true);
  assert.equal(errors.has('EXPO_PUBLIC_HUME_WS_PROXY_URL'), true);
  assert.equal(errors.has('EXPO_PUBLIC_HUME_API_KEY'), true);
});

test('CLI process values override the file, return the right status, and remain redacted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'veryloving-env-test-'));
  const filePath = join(directory, '.env');
  writeFileSync(filePath, [
    'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN=sk.file-value-must-not-print',
    'VERYLOVING_BUILD_PROFILE=development'
  ].join('\n'));
  const command = resolve(process.cwd(), 'scripts/validate-env.cjs');

  try {
    const rejected = spawnSync(process.execPath, [command, '--file', filePath, '--no-color'], {
      encoding: 'utf8',
      env: {}
    });
    assert.equal(rejected.status, 1);
    assert.doesNotMatch(rejected.stdout, /sk\.file-value-must-not-print/);

    const overridden = spawnSync(process.execPath, [command, '--file', filePath, '--no-color'], {
      encoding: 'utf8',
      env: { EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.process-value-must-not-print' }
    });
    assert.equal(overridden.status, 0);
    assert.doesNotMatch(overridden.stdout, /file-value-must-not-print|process-value-must-not-print/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI can validate process variables when the environment file is absent', () => {
  const missingPath = join(tmpdir(), 'veryloving-environment-file-that-does-not-exist');
  const command = resolve(process.cwd(), 'scripts/validate-env.cjs');
  const result = spawnSync(process.execPath, [command, '--file', missingPath, '--no-color'], {
    encoding: 'utf8',
    env: { VERYLOVING_BUILD_PROFILE: 'development' }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /not found; process environment only/);
});
