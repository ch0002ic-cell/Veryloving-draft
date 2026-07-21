'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const {
  PRODUCTION_CAPABILITIES,
  PRODUCTION_CONTRACT_VERSION,
  createAINativeRuntimeComposition
} = require('./ai-native-composition.cjs');

class InMemoryCiphertextRepository {
  async get() { return null; }
  async compareAndSet() { return true; }
}

class InMemoryScenarioExecutionRepository {
  async create(value) { return { created: true, execution: value }; }
  async put() {}
  async get() { return undefined; }
  async list() { return []; }
  async listAll() { return []; }
  async deleteAccount() { return 0; }
}

class DurableCiphertextRepository {
  async get() { return null; }
  async compareAndSet() { return true; }
}

class DurableScenarioExecutionRepository {
  async create(value) { return { created: true, execution: value }; }
  async put() {}
  async get() { return undefined; }
  async list() { return []; }
  async listAll() { return []; }
  async deleteAccount() { return 0; }
}

function methods(names, value = {}) {
  return Object.fromEntries(names.map((name) => [name, async () => value]));
}

function productionDefinition(overrides = {}) {
  const systemOptions = {
    actionGateway: methods(['route', 'waitForActionOutcome', 'fenceUserActions']),
    ciphertextRepository: new DurableCiphertextRepository(),
    scenarioRepository: new DurableScenarioExecutionRepository(),
    encryptionKeyring: {
      currentVersion: 2,
      keys: { 1: Buffer.alloc(32, 1), 2: Buffer.alloc(32, 2) },
      accountIndexKey: Buffer.alloc(32, 3)
    },
    scenarioIdentitySecret: Buffer.alloc(32, 4),
    externalPrivacyProvider: methods(['exportUserData', 'deleteUserData']),
    ...methods([
      'beginHumeSession',
      'authorizeHumeContext',
      'waitForSignal',
      'notify',
      'sendSms',
      'recordAnalytics'
    ]),
    ...(overrides.systemOptions ?? {})
  };
  return {
    contractVersion: PRODUCTION_CONTRACT_VERSION,
    capabilities: { ...PRODUCTION_CAPABILITIES },
    systemOptions,
    trust: methods([
      'resolveEdgeDeviceBinding',
      'authenticateRobotEdgeIngress',
      'resolveScenarioDevices',
      'authenticateScenarioIngress'
    ]),
    close: async () => undefined,
    ...overrides,
    systemOptions
  };
}

function productionOptions(definition = productionDefinition()) {
  let receivedOptions;
  const system = Object.freeze({ productionSystem: true });
  return {
    env: {
      NODE_ENV: 'production',
      AI_NATIVE_ENABLED: 'true',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
      AI_NATIVE_SINGLE_REPLICA: 'true',
      AI_NATIVE_PRODUCTION_MODULE: '/app/production/ai-native.cjs'
    },
    modules: {
      createAINativeSystem(options) {
        receivedOptions = options;
        return system;
      },
      InMemoryCiphertextRepository,
      InMemoryScenarioExecutionRepository
    },
    loadModule(modulePath) {
      assert.equal(modulePath, '/app/production/ai-native.cjs');
      return {
        createAINativeProductionDependencies({ env }) {
          assert.equal(env.NODE_ENV, 'production');
          return definition;
        }
      };
    },
    system,
    definition,
    receivedOptions: () => receivedOptions
  };
}

test('AI-native composition is inert when runtime and lifecycle are disabled', () => {
  assert.equal(createAINativeRuntimeComposition({
    env: {
      NODE_ENV: 'production',
      AI_NATIVE_ENABLED: 'false',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'false'
    },
    loadModule() { assert.fail('disabled composition loaded a module'); }
  }), null);
});

test('non-production composition delegates only enabled runtime to the isolated demo', () => {
  const demo = {
    config: { aiNativeSystem: {} },
    wrapHandler: () => undefined,
    close: async () => undefined
  };
  let calls = 0;
  const composition = createAINativeRuntimeComposition({
    env: {
      NODE_ENV: 'test',
      AI_NATIVE_ENABLED: 'true',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true'
    },
    demoFactory() { calls += 1; return demo; }
  });
  assert.equal(calls, 1);
  assert.equal(composition.mode, 'demo');
  assert.equal(composition.config, demo.config);

  assert.equal(createAINativeRuntimeComposition({
    env: {
      NODE_ENV: 'test',
      AI_NATIVE_ENABLED: 'false',
      AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true'
    },
    demoFactory() { assert.fail('lifecycle-only development started the demo'); }
  }), null);
});

test('production composition requires a bounded absolute provider module path', () => {
  const base = productionOptions();
  for (const modulePath of ['', './ai-native.cjs', `/app/${'x'.repeat(1024)}`]) {
    assert.throws(() => createAINativeRuntimeComposition({
      ...base,
      env: { ...base.env, AI_NATIVE_PRODUCTION_MODULE: modulePath }
    }), /AI_NATIVE_PRODUCTION_MODULE/);
  }
});

test('production composition rejects asynchronous or incomplete provider modules', () => {
  const base = productionOptions();
  assert.throws(() => createAINativeRuntimeComposition({
    ...base,
    loadModule: () => ({
      createAINativeProductionDependencies: async () => productionDefinition()
    })
  }), /must complete synchronously/);
  assert.throws(() => createAINativeRuntimeComposition({
    ...base,
    loadModule: () => ({})
  }), /must export createAINativeProductionDependencies/);
  assert.throws(() => createAINativeRuntimeComposition({
    ...base,
    loadModule: () => ({
      createAINativeProductionDependencies: () => ({
        ...productionDefinition(),
        capabilities: { ...PRODUCTION_CAPABILITIES, externalProviders: false }
      })
    })
  }), /externalProviders/);
});

test('production composition releases provider resources when validation or construction fails', () => {
  let validationCloses = 0;
  const invalidDefinition = productionDefinition({
    capabilities: { ...PRODUCTION_CAPABILITIES, durableScenarios: false },
    close() { validationCloses += 1; }
  });
  assert.throws(
    () => createAINativeRuntimeComposition(productionOptions(invalidDefinition)),
    /durableScenarios/
  );
  assert.equal(validationCloses, 1);

  let constructionCloses = 0;
  const validDefinition = productionDefinition({
    close() { constructionCloses += 1; }
  });
  const options = productionOptions(validDefinition);
  options.modules.createAINativeSystem = () => {
    throw new Error('factory rejected dependencies');
  };
  assert.throws(
    () => createAINativeRuntimeComposition(options),
    /factory rejected dependencies/
  );
  assert.equal(constructionCloses, 1);
});

test('production composition rejects demo repositories and legacy raw encryption keys', () => {
  const inMemoryCiphertext = productionOptions(productionDefinition({
    systemOptions: { ciphertextRepository: new InMemoryCiphertextRepository() }
  }));
  assert.throws(
    () => createAINativeRuntimeComposition(inMemoryCiphertext),
    /In-memory AI-native repositories are forbidden/
  );

  const inMemoryScenarios = productionOptions(productionDefinition({
    systemOptions: { scenarioRepository: new InMemoryScenarioExecutionRepository() }
  }));
  assert.throws(
    () => createAINativeRuntimeComposition(inMemoryScenarios),
    /In-memory AI-native repositories are forbidden/
  );

  const legacyKey = productionOptions(productionDefinition({
    systemOptions: { encryptionKey: Buffer.alloc(32) }
  }));
  assert.throws(
    () => createAINativeRuntimeComposition(legacyKey),
    /rotation-safe external encryption keyring/
  );
});

test('production composition constructs the official system and exposes only trust hooks', async () => {
  const options = productionOptions();
  const composition = createAINativeRuntimeComposition(options);
  assert.equal(composition.mode, 'production');
  assert.equal(composition.config.aiNativeSystem, options.system);
  assert.equal(options.receivedOptions(), options.definition.systemOptions);
  assert.deepEqual(Object.keys(composition.config).sort(), [
    'aiNativeSystem',
    'authenticateRobotEdgeIngress',
    'authenticateScenarioIngress',
    'resolveEdgeDeviceBinding',
    'resolveScenarioDevices'
  ]);
  await composition.close();
});

test('both long-lived entrypoints use the fail-closed AI-native composition boundary', () => {
  const serverRoot = __dirname;
  for (const file of ['server.cjs', 'clm-server.cjs']) {
    const source = fs.readFileSync(path.join(serverRoot, file), 'utf8');
    assert.match(source, /createAINativeRuntimeComposition/);
    assert.match(source, /aiNativeRuntime\?\.config/);
  }
});

test('both production entrypoints exit before listening when composition is absent', () => {
  for (const file of ['server.cjs', 'clm-server.cjs']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 2_000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        AI_NATIVE_ENABLED: 'true',
        AI_NATIVE_DATA_LIFECYCLE_ENABLED: 'true',
        AI_NATIVE_SINGLE_REPLICA: 'true',
        AI_NATIVE_PRODUCTION_MODULE: ''
      }
    });
    assert.notEqual(result.status, 0, `${file} unexpectedly started`);
    assert.match(`${result.stdout}\n${result.stderr}`, /AI_NATIVE_PRODUCTION_MODULE is required/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /listening on|System injected/);
  }
});
