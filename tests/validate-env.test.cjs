const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  ROOT_VARIABLES,
  SERVER_VARIABLES,
  endpointProblem,
  parseDotEnv,
  parseArguments,
  validateEnvironment,
  validateServerEnvironment,
  renderReport
} = require('../scripts/validate-env.cjs');
const { PRODUCTION_EXPORT_ENVIRONMENT } = require('../scripts/validate.cjs');

function productionEnvironment(overrides = {}) {
  return {
    EXPO_PUBLIC_API_BASE_URL: 'https://api.example.test',
    EXPO_PUBLIC_ACTION_GATEWAY_URL: 'https://voice.example.test/v1/actions',
    EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'web.apps.googleusercontent.com',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: 'ios.apps.googleusercontent.com',
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    EXPO_PUBLIC_DEMO_AUTH_ENABLED: 'false',
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
  assert.throws(() => parseArguments(['--server-file', '--no-color']), /--server-file requires a value/);
  assert.throws(() => parseArguments(['--profile']), /--profile requires a value/);
  assert.equal(parseArguments(['--profile', 'testflight']).profile, 'testflight');
  assert.equal(parseArguments(['--server-dry-run']).serverFile, 'server/.env.example');
});

test('server environment dry-run validates structure and timing bounds without real credentials', () => {
  const environment = parseDotEnv(readFileSync(resolve(process.cwd(), 'server/.env.example'), 'utf8'));
  const results = validateServerEnvironment(environment, { profile: 'development', dryRun: true });
  assert.equal(results.some((result) => result.level === 'error'), false);
  assert.equal(results.find((result) => result.name === 'SERVER_CONFIG_DRY_RUN')?.level, 'ok');

  const invalid = validateServerEnvironment({
    NODE_ENV: 'development',
    AUTH_EXCHANGE_ENABLED: 'sometimes',
    ACTION_REQUEST_TIMEOUT_MS: '12.5',
    ROBOT_ACK_TIMEOUT_MS: '9007199254740993',
    CLM_UPSTREAM_TIMEOUT_MS: '30001',
    ROBOT_ADAPTER_TIMEOUT_MS: '0',
    ROBOT_ADAPTER_MAX_ATTEMPTS: '6',
    ROBOT_ADAPTER_RETRY_BASE_MS: '30001',
    ROBOT_ADAPTER_RETRY_MAX_MS: '60001',
    MOCK_MANUFACTURER_PORT: '65536',
    MOCK_MANUFACTURER_LATENCY_MIN_MS: '200',
    MOCK_MANUFACTURER_LATENCY_MAX_MS: '100',
    MOCK_MANUFACTURER_FAILURE_RATE: '1.1',
    ROBOT_SOAK_DURATION_MS: '99',
    ROBOT_SOAK_MAX_HEAP_GROWTH_BYTES: '1048575',
    MOCK_MAIN_SERVER_URL: 'http://public.example.test:8787',
    AI_NATIVE_ENABLED: 'true',
    AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'false'
  }, { profile: 'development', dryRun: true });
  const errors = new Set(invalid.filter((result) => result.level === 'error').map((result) => result.name));
  for (const name of [
    'AUTH_EXCHANGE_ENABLED',
    'ACTION_REQUEST_TIMEOUT_MS',
    'ROBOT_ACK_TIMEOUT_MS',
    'CLM_UPSTREAM_TIMEOUT_MS',
    'ROBOT_ADAPTER_TIMEOUT_MS',
    'ROBOT_ADAPTER_MAX_ATTEMPTS',
    'ROBOT_ADAPTER_RETRY_BASE_MS',
    'ROBOT_ADAPTER_RETRY_MAX_MS',
    'MOCK_MANUFACTURER_PORT',
    'MOCK_MANUFACTURER_LATENCY_MAX_MS',
    'MOCK_MANUFACTURER_FAILURE_RATE',
    'ROBOT_SOAK_DURATION_MS',
    'ROBOT_SOAK_MAX_HEAP_GROWTH_BYTES',
    'MOCK_MAIN_SERVER_URL',
    'AI_NATIVE_DATA_LIFECYCLE_ENABLED'
  ]) assert.equal(errors.has(name), true, name);
  assert.doesNotMatch(JSON.stringify(invalid), /9007199254740993|public\.example/);

  const wrongDeploymentMode = validateServerEnvironment({
    NODE_ENV: 'development'
  }, { profile: 'production', dryRun: true });
  assert.equal(
    wrongDeploymentMode.find((result) => result.name === 'NODE_ENV')?.level,
    'error'
  );
});

test('production AI-native state requires an absolute image-owned composition module', () => {
  const enabledProduction = {
    NODE_ENV: 'production',
    AI_NATIVE_ENABLED: 'true',
    AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
    AI_NATIVE_SINGLE_REPLICA: 'true'
  };
  const missing = validateServerEnvironment(enabledProduction, { profile: 'production' });
  assert.equal(
    missing.find((result) => result.name === 'AI_NATIVE_PRODUCTION_MODULE')?.level,
    'error'
  );

  const dryRun = validateServerEnvironment(enabledProduction, {
    profile: 'production',
    dryRun: true
  });
  assert.equal(
    dryRun.find((result) => result.name === 'AI_NATIVE_PRODUCTION_MODULE')?.level,
    'warn'
  );

  const relative = validateServerEnvironment({
    ...enabledProduction,
    AI_NATIVE_PRODUCTION_MODULE: './production-ai-native.cjs'
  }, { profile: 'production' });
  assert.equal(
    relative.find((result) => result.name === 'AI_NATIVE_PRODUCTION_MODULE')?.level,
    'error'
  );

  const configured = validateServerEnvironment({
    ...enabledProduction,
    AI_NATIVE_PRODUCTION_MODULE: '/app/production/ai-native.cjs'
  }, { profile: 'production' });
  assert.equal(
    configured.find((result) => result.name === 'AI_NATIVE_PRODUCTION_MODULE')?.level,
    'ok'
  );

  const productionRuntimeWithDefaultProfile = validateServerEnvironment({
    ...enabledProduction,
    AI_NATIVE_PRODUCTION_MODULE: './production-ai-native.cjs'
  }, { profile: 'development' });
  assert.equal(
    productionRuntimeWithDefaultProfile.find(
      (result) => result.name === 'AI_NATIVE_PRODUCTION_MODULE'
    )?.level,
    'error'
  );

  const development = validateServerEnvironment({
    NODE_ENV: 'development',
    AI_NATIVE_PRODUCTION_MODULE: '/app/production/ai-native.cjs'
  }, { profile: 'development' });
  const developmentResult = development.find(
    (result) => result.name === 'AI_NATIVE_PRODUCTION_MODULE'
  );
  assert.equal(developmentResult?.level, 'warn');
  assert.match(developmentResult?.message || '', /ignored outside production/);
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

test('the server environment template and validator catalog stay synchronized', () => {
  const template = parseDotEnv(readFileSync(resolve(process.cwd(), 'server/.env.example'), 'utf8'));
  assert.deepEqual(Object.keys(template).sort(), [...SERVER_VARIABLES].sort());
});

test('server Hume persona and provisioning contracts accept a complete redacted configuration', () => {
  const voiceId = '00000000-0000-4000-8000-000000000001';
  const results = validateServerEnvironment({
    NODE_ENV: 'development',
    HUME_API_KEY: 'not-printed',
    HUME_CONFIG_ID: '00000000-0000-4000-8000-000000000002',
    HUME_TOOL_ID: '00000000-0000-4000-8000-000000000003',
    HUME_CUSTOM_VOICE_ID: voiceId,
    HUME_ALLOWED_VOICE_IDS: voiceId,
    HUME_PERSONA_MAP_JSON: JSON.stringify({
      capybara: { voice_id: voiceId, instructions: 'Calm and concise.' }
    }),
    HUME_DEFAULT_PERSONA_ID: 'capybara',
    HUME_CLM_URL: 'https://api.example.test/chat/completions',
    HUME_VOICE_NAME: 'Serene Assistant'
  });
  assert.equal(results.some((result) => result.level === 'error'), false);
  assert.doesNotMatch(JSON.stringify(results), /not-printed|api\.example\.test|Calm and concise/);
});

test('server validation rejects malformed Hume and simulator contracts without exposing values', () => {
  const results = validateServerEnvironment({
    NODE_ENV: 'development',
    HUME_CONFIG_ID: 'invalid-config-id',
    HUME_ALLOWED_VOICE_IDS: 'invalid-voice-id',
    HUME_PERSONA_MAP_JSON: '{"unsafe":{"voice_id":"invalid-secret-value"}}',
    HUME_DEFAULT_PERSONA_ID: 'missing persona',
    HUME_CLM_URL: 'https://operator-secret.example.test/wrong-path',
    HUME_VOICE_NAME: ' bad-name',
    MOCK_MANUFACTURER_ACK_CALLBACK_URL: 'http://127.0.0.1:8787/wrong-path'
  });
  const errors = new Set(results.filter((result) => result.level === 'error').map((result) => result.name));
  for (const name of [
    'HUME_CONFIG_ID',
    'HUME_ALLOWED_VOICE_IDS',
    'HUME_PERSONA_MAP_JSON',
    'HUME_DEFAULT_PERSONA_ID',
    'HUME_CLM_URL',
    'HUME_VOICE_NAME',
    'MOCK_MANUFACTURER_ACK_CALLBACK_URL'
  ]) assert.equal(errors.has(name), true, name);
  assert.doesNotMatch(JSON.stringify(results), /invalid-secret-value|operator-secret\.example/);
});

test('production server validation rejects an empty Hume persona registry', () => {
  const voiceId = '00000000-0000-4000-8000-000000000001';
  const results = validateServerEnvironment({
    NODE_ENV: 'production',
    HUME_API_KEY: 'not-printed',
    HUME_CONFIG_ID: '00000000-0000-4000-8000-000000000002',
    HUME_ALLOWED_VOICE_IDS: voiceId,
    HUME_PERSONA_MAP_JSON: '{}',
    HUME_DEFAULT_PERSONA_ID: 'capybara'
  }, { profile: 'production' });
  assert.equal(
    results.some((result) => result.name === 'HUME_PERSONA_MAP_JSON' && result.level === 'error'),
    true
  );
  assert.equal(
    results.some((result) => result.name === 'HUME_DEFAULT_PERSONA_ID' && result.level === 'error'),
    true
  );
  assert.doesNotMatch(JSON.stringify(results), /not-printed/);
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

test('non-release production export fixture is complete, non-routable, and credential-free', () => {
  const results = validateEnvironment(PRODUCTION_EXPORT_ENVIRONMENT, {
    profile: 'production',
    fileEnvironment: PRODUCTION_EXPORT_ENVIRONMENT
  });
  assert.deepEqual(
    results.filter((result) => result.level === 'error'),
    []
  );

  for (const name of [
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_ACTION_GATEWAY_URL',
    'EXPO_PUBLIC_HUME_WS_PROXY_URL',
    'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL'
  ]) {
    assert.equal(new URL(PRODUCTION_EXPORT_ENVIRONMENT[name]).hostname.endsWith('.invalid'), true, name);
  }

  assert.equal(Object.isFrozen(PRODUCTION_EXPORT_ENVIRONMENT), true);
  assert.equal(PRODUCTION_EXPORT_ENVIRONMENT.EAS_BUILD, 'false');
  assert.equal(PRODUCTION_EXPORT_ENVIRONMENT.EXPO_PUBLIC_HUME_API_KEY, '');
  assert.match(PRODUCTION_EXPORT_ENVIRONMENT.RNMAPBOX_MAPS_DOWNLOAD_TOKEN, /not-a-credential$/);
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

test('demo authentication is an explicit development-only environment gate', () => {
  const invalidBoolean = validateEnvironment(productionEnvironment({
    EXPO_PUBLIC_DEMO_AUTH_ENABLED: 'yes'
  }), { profile: 'production' });
  assert.match(
    invalidBoolean.find((result) => result.name === 'EXPO_PUBLIC_DEMO_AUTH_ENABLED')?.message || '',
    /true or false/
  );

  const development = validateEnvironment(productionEnvironment({
    EXPO_PUBLIC_DEMO_AUTH_ENABLED: 'true',
    VERYLOVING_BUILD_PROFILE: 'development'
  }), { profile: 'development' });
  assert.equal(
    development.find((result) => result.name === 'EXPO_PUBLIC_DEMO_AUTH_ENABLED')?.level,
    'ok'
  );

  for (const profile of ['preview', 'production', 'testflight']) {
    const results = validateEnvironment(productionEnvironment({
      EXPO_PUBLIC_DEMO_AUTH_ENABLED: 'true',
      VERYLOVING_BUILD_PROFILE: profile
    }), { profile });
    const issue = results.find((result) => result.name === 'EXPO_PUBLIC_DEMO_AUTH_ENABLED');
    assert.equal(issue?.level, 'error');
    assert.match(issue?.message || '', /outside the development profile/);
  }
});

test('full language catalog flag is limited to development or TestFlight QA and must be an explicit boolean', () => {
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
    assert.match(issue?.message || '', /outside development or the dedicated TestFlight/);
  }

  const development = validateEnvironment(productionEnvironment({
    EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'true',
    VERYLOVING_BUILD_PROFILE: 'development'
  }), { profile: 'development' });
  assert.equal(
    development.find((result) => result.name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES')?.level,
    'ok'
  );

  const testflightEnvironment = productionEnvironment({
    EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'true',
    EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES: 'true',
    VERYLOVING_BUILD_PROFILE: 'testflight'
  });
  const testflight = validateEnvironment(testflightEnvironment, {
    profile: 'testflight',
    fileEnvironment: testflightEnvironment
  });
  assert.equal(
    testflight.find((result) => result.name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES')?.level,
    'ok'
  );
  assert.equal(testflight.some((result) => result.level === 'error'), false);

  const incompleteTestFlight = validateEnvironment({
    EXPO_PUBLIC_SHOW_ALL_LANGUAGES: 'true',
    VERYLOVING_BUILD_PROFILE: 'testflight'
  }, { profile: 'testflight' });
  const incompleteErrors = new Set(
    incompleteTestFlight.filter((result) => result.level === 'error').map((result) => result.name)
  );
  assert.equal(incompleteErrors.has('EXPO_PUBLIC_SHOW_ALL_LANGUAGES'), false);
  assert.equal(incompleteErrors.has('EXPO_PUBLIC_API_BASE_URL'), true);
  assert.equal(incompleteErrors.has('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'), true);
  assert.equal(incompleteErrors.has('EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID'), true);
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
    fileEnvironment: {
      SESSION_JWT_SECRET: 'do-not-print-this-value',
      MOCK_MANUFACTURER_API_KEY: 'simulator-key-must-not-print'
    }
  });
  for (const name of ['SESSION_JWT_SECRET', 'MOCK_MANUFACTURER_API_KEY']) {
    assert.equal(results.find((result) => result.name === name)?.level, 'error');
  }
  assert.doesNotMatch(JSON.stringify(results), /do-not-print-this-value|simulator-key-must-not-print/);
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

test('CLI server dry-run is a credential-free deterministic validation gate', () => {
  const command = resolve(process.cwd(), 'scripts/validate-env.cjs');
  const result = spawnSync(process.execPath, [
    command,
    '--file', '.env.example',
    '--server-file', 'server/.env.example',
    '--server-dry-run',
    '--no-color'
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {}
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /VeryLoving server environment dry-run/);
  assert.match(result.stdout, /SERVER_CONFIG_DRY_RUN/);
  assert.doesNotMatch(result.stdout, /server-only|must-not-print/);
});
