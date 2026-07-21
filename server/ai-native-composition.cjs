'use strict';

const path = require('node:path');
const { createAINativeDemoRuntime } = require('./ai-native-demo.cjs');
const { createRedactedLogger } = require('./redacted-logger.cjs');

const PRODUCTION_CONTRACT_VERSION = 1;
const PRODUCTION_CAPABILITIES = Object.freeze({
  durableCiphertext: true,
  durableScenarios: true,
  externalKeyManagement: true,
  externalProviders: true,
  privacyLifecycle: true
});

function enabled(value) {
  return value === 'true';
}

function plainObject(value) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function loadAINativeModules() {
  try {
    return Object.freeze({
      createAINativeSystem:
        require('./dist-ai-native/orchestration/AINativeSystem.js').createAINativeSystem,
      InMemoryCiphertextRepository:
        require('./dist-ai-native/models/UserState.js').InMemoryCiphertextRepository,
      InMemoryScenarioExecutionRepository:
        require('./dist-ai-native/orchestration/ScenarioEngine.js').InMemoryScenarioExecutionRepository
    });
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    throw new Error('AI-native build is missing; run npm run build:ai-native before server startup');
  }
}

function requireFunctions(target, label, methods) {
  if (!target || methods.some((method) => typeof target[method] !== 'function')) {
    throw new Error(`${label} does not satisfy the production AI-native contract`);
  }
}

function validateCapabilities(capabilities) {
  if (!plainObject(capabilities)) {
    throw new Error('Production AI-native capability declaration is required');
  }
  for (const [name, expected] of Object.entries(PRODUCTION_CAPABILITIES)) {
    if (capabilities[name] !== expected) {
      throw new Error(`Production AI-native capability ${name} is required`);
    }
  }
}

function validateProductionDefinition(definition, modules) {
  if (!plainObject(definition) || definition.contractVersion !== PRODUCTION_CONTRACT_VERSION) {
    throw new Error(`Production AI-native contractVersion must be ${PRODUCTION_CONTRACT_VERSION}`);
  }
  validateCapabilities(definition.capabilities);
  if (!plainObject(definition.systemOptions)) {
    throw new Error('Production AI-native systemOptions are required');
  }

  const options = definition.systemOptions;
  if (options.ciphertextRepository instanceof modules.InMemoryCiphertextRepository
    || options.scenarioRepository instanceof modules.InMemoryScenarioExecutionRepository) {
    throw new Error('In-memory AI-native repositories are forbidden in production composition');
  }
  if (options.encryptionKey !== undefined || !plainObject(options.encryptionKeyring)) {
    throw new Error('Production AI-native composition requires a rotation-safe external encryption keyring');
  }
  requireFunctions(options.ciphertextRepository, 'Production ciphertext repository', [
    'get', 'compareAndSet'
  ]);
  requireFunctions(options.scenarioRepository, 'Production scenario repository', [
    'create', 'put', 'get', 'list', 'listAll', 'deleteAccount'
  ]);
  requireFunctions(options.actionGateway, 'Production AI-native action gateway', [
    'route', 'waitForActionOutcome', 'fenceUserActions'
  ]);
  requireFunctions(options.externalPrivacyProvider, 'Production external privacy provider', [
    'exportUserData', 'deleteUserData'
  ]);
  for (const provider of [
    'beginHumeSession',
    'authorizeHumeContext',
    'waitForSignal',
    'notify',
    'sendSms',
    'recordAnalytics'
  ]) {
    if (typeof options[provider] !== 'function') {
      throw new Error(`Production AI-native provider ${provider} is required`);
    }
  }
  if (!(typeof options.scenarioIdentitySecret === 'string'
    || Buffer.isBuffer(options.scenarioIdentitySecret))) {
    throw new Error('Production AI-native scenario identity secret is required');
  }

  const trust = definition.trust;
  requireFunctions(trust, 'Production AI-native trust boundary', [
    'resolveEdgeDeviceBinding',
    'authenticateRobotEdgeIngress',
    'resolveScenarioDevices',
    'authenticateScenarioIngress'
  ]);
  if (definition.close !== undefined && typeof definition.close !== 'function') {
    throw new Error('Production AI-native close hook must be a function');
  }
}

function releaseFailedDefinition(definition, logger) {
  if (typeof definition?.close !== 'function') return;
  try {
    const cleanup = Promise.resolve(definition.close());
    void cleanup.catch(() => {
      logger.error?.('[AI-Native] Production composition startup cleanup failed', {
        code: 'AI_NATIVE_STARTUP_CLEANUP_FAILED'
      });
    });
  } catch {
    logger.error?.('[AI-Native] Production composition startup cleanup failed', {
      code: 'AI_NATIVE_STARTUP_CLEANUP_FAILED'
    });
  }
}

function loadProductionDefinition({ env, logger, loadModule, modules }) {
  const modulePath = env.AI_NATIVE_PRODUCTION_MODULE || '';
  if (modulePath.length === 0) {
    throw new Error('AI_NATIVE_PRODUCTION_MODULE is required for production AI-native state');
  }
  if (modulePath.length > 1024
    || /[\u0000-\u001f\u007f]/u.test(modulePath)
    || !path.isAbsolute(modulePath)) {
    throw new Error('AI_NATIVE_PRODUCTION_MODULE must be a bounded absolute path');
  }
  let providerModule;
  try {
    providerModule = loadModule(modulePath);
  } catch (error) {
    throw Object.assign(new Error('Production AI-native composition module could not be loaded'), {
      cause: error
    });
  }
  if (typeof providerModule?.createAINativeProductionDependencies !== 'function') {
    throw new Error('Production AI-native module must export createAINativeProductionDependencies');
  }
  const definition = providerModule.createAINativeProductionDependencies(Object.freeze({
    env,
    logger
  }));
  if (definition && typeof definition.then === 'function') {
    // Startup is intentionally synchronous: the HTTP listener must never bind
    // before every durable repository, trust hook, and provider is present.
    void Promise.resolve(definition).then(
      (resolved) => releaseFailedDefinition(resolved, logger),
      () => undefined
    );
    throw new Error('Production AI-native dependency composition must complete synchronously');
  }
  try {
    validateProductionDefinition(definition, modules);
  } catch (error) {
    releaseFailedDefinition(definition, logger);
    throw error;
  }
  return definition;
}

/**
 * Entry-point composition boundary.
 *
 * Development/test can opt into the isolated loopback demo. Production must
 * provide an absolute, image-owned CommonJS module implementing the versioned
 * dependency contract above. The entrypoint, rather than a request handler,
 * constructs the official system before any socket starts listening.
 */
function createAINativeRuntimeComposition({
  env = process.env,
  logger = console,
  loadModule = require,
  modules: injectedModules,
  demoFactory = createAINativeDemoRuntime
} = {}) {
  const safeLogger = createRedactedLogger(logger);
  const runtimeEnabled = enabled(env.AI_NATIVE_ENABLED);
  const lifecycleEnabled = enabled(env.AI_NATIVE_DATA_LIFECYCLE_ENABLED);
  if (!runtimeEnabled && !lifecycleEnabled) return null;
  if (runtimeEnabled && !lifecycleEnabled) {
    throw new Error('AI_NATIVE_ENABLED requires AI_NATIVE_DATA_LIFECYCLE_ENABLED=true');
  }

  if (env.NODE_ENV !== 'production') {
    if (!runtimeEnabled) return null;
    const demo = demoFactory({ env, logger: safeLogger });
    return demo && Object.freeze({
      mode: 'demo',
      config: demo.config,
      wrapHandler: demo.wrapHandler,
      close: demo.close
    });
  }

  if (runtimeEnabled && !enabled(env.AI_NATIVE_SINGLE_REPLICA)) {
    throw new Error(
      'AI_NATIVE_SINGLE_REPLICA=true is required until distributed scenario admission leases are implemented'
    );
  }

  const modules = injectedModules ?? loadAINativeModules();
  if (typeof modules.createAINativeSystem !== 'function'
    || typeof modules.InMemoryCiphertextRepository !== 'function'
    || typeof modules.InMemoryScenarioExecutionRepository !== 'function') {
    throw new Error('Compiled AI-native production factory is incomplete');
  }
  const definition = loadProductionDefinition({
    env: Object.freeze({ ...env }),
    logger: safeLogger,
    loadModule,
    modules
  });
  let system;
  try {
    system = modules.createAINativeSystem(definition.systemOptions);
    if (!system || typeof system !== 'object') {
      throw new Error('Production AI-native factory returned an invalid system');
    }
  } catch (error) {
    releaseFailedDefinition(definition, safeLogger);
    throw error;
  }
  const trust = definition.trust;
  return Object.freeze({
    mode: 'production',
    config: Object.freeze({
      aiNativeSystem: system,
      resolveEdgeDeviceBinding: trust.resolveEdgeDeviceBinding,
      authenticateRobotEdgeIngress: trust.authenticateRobotEdgeIngress,
      resolveScenarioDevices: trust.resolveScenarioDevices,
      authenticateScenarioIngress: trust.authenticateScenarioIngress
    }),
    close: definition.close ?? (async () => undefined)
  });
}

module.exports = {
  PRODUCTION_CAPABILITIES,
  PRODUCTION_CONTRACT_VERSION,
  createAINativeRuntimeComposition,
  validateProductionDefinition
};
