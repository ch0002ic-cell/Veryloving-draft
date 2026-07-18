#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { URL } = require('node:url');

const PROJECT_ROOT = resolve(__dirname, '..');
const VALID_PROFILES = new Set(['development', 'preview', 'production', 'testflight']);
const BOOLEAN_VARIABLES = new Set([
  'EXPO_PUBLIC_PHONE_AUTH_ENABLED',
  'EXPO_PUBLIC_HUME_CLM_ENABLED',
  'EXPO_PUBLIC_ENABLE_OFFLINE_MODE',
  'EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES',
  'EXPO_PUBLIC_SHOW_ALL_LANGUAGES',
  'EXPO_PUBLIC_SAFETY_BACKEND_ENABLED',
  'EXPO_PUBLIC_VL01_ENABLED'
]);
const ROOT_VARIABLES = [
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_ACTION_GATEWAY_URL',
  'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
  'EXPO_PUBLIC_PHONE_AUTH_ENABLED',
  'EXPO_PUBLIC_HUME_WS_PROXY_URL',
  'EXPO_PUBLIC_HUME_CONFIG_ID',
  'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL',
  'EXPO_PUBLIC_HUME_CLM_ENABLED',
  'EXPO_PUBLIC_HUME_BRANDED_VOICE_ID',
  'EXPO_PUBLIC_HUME_API_KEY',
  'EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY',
  'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN',
  'EXPO_PUBLIC_ENABLE_OFFLINE_MODE',
  'EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES',
  'EXPO_PUBLIC_SHOW_ALL_LANGUAGES',
  'EXPO_PUBLIC_SAFETY_BACKEND_ENABLED',
  'EXPO_PUBLIC_VL01_ENABLED',
  'EXPO_PUBLIC_VL01_SERVICE_UUID',
  'EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID',
  'EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID',
  'EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID',
  'EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID',
  'RNMAPBOX_MAPS_DOWNLOAD_TOKEN',
  'VERYLOVING_BUILD_PROFILE',
  'VERYLOVING_CONFIG_DIAGNOSTICS'
];
const SERVER_SECRET_NAMES = new Set([
  'HUME_API_KEY',
  'HUME_SECRET_KEY',
  'HUME_CLM_BEARER_TOKEN',
  'SESSION_JWT_SECRET',
  'PHONE_AUTH_CHALLENGE_SECRET',
  'PHONE_AUTH_SUBJECT_SECRET',
  'TWILIO_AUTH_TOKEN',
  'CLM_UPSTREAM_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'ACTION_SIGNING_PRIVATE_KEY',
  'ROBOT_PAIRING_TOKEN_SECRET',
  'MANUFACTURER_API_KEY',
  'YONGYIDA_BRIDGE_API_KEY',
  'YONGYIDA_CALLBACK_API_KEY',
  'JIANGZHI_BRIDGE_API_KEY',
  'JIANGZHI_CALLBACK_API_KEY'
]);
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PATTERN = /^(?:[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SENSITIVE_QUERY_PATTERN = /token|secret|password|api[_-]?key/i;

function parseDotEnv(source) {
  const parsed = {};
  for (const originalLine of String(source).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    let line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trimStart();
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(separator + 1).trim();
    const quote = value[0];
    let closingQuote = -1;
    if (quote === '"' || quote === "'") {
      for (let index = 1; index < value.length; index += 1) {
        if (value[index] !== quote) continue;
        let precedingSlashes = 0;
        for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) precedingSlashes += 1;
        if (quote === '"' && precedingSlashes % 2 === 1) continue;
        closingQuote = index;
        break;
      }
    }
    const quoteSuffix = closingQuote >= 0 ? value.slice(closingQuote + 1).trim() : '';
    if (closingQuote >= 0 && (!quoteSuffix || quoteSuffix.startsWith('#'))) {
      value = value.slice(1, closingQuote);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    } else {
      // Match Expo/dotenv semantics: an unquoted # starts a comment even when
      // it directly follows the value. Literal hashes must be quoted.
      value = value.replace(/#.*$/, '').trimEnd();
    }
    parsed[key] = value;
  }
  return parsed;
}

function isConfigured(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  return !(
    /^<[^>]+>$/.test(normalized)
    || /^(?:replace|your)[-_]/i.test(normalized)
    || /^(?:todo|tbd|changeme)$/i.test(normalized)
  );
}

function enabled(env, key) {
  return env[key] === 'true';
}

function endpointProblem(value, requiredProtocol, { allowLocalDevelopment = false } = {}) {
  try {
    const endpoint = new URL(value);
    const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    const localHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const localProtocol = requiredProtocol === 'https:' ? 'http:' : requiredProtocol === 'wss:' ? 'ws:' : null;
    const allowedLocalEndpoint = allowLocalDevelopment
      && localHost
      && endpoint.protocol === localProtocol;
    if (endpoint.protocol !== requiredProtocol && !allowedLocalEndpoint) {
      return `must use ${requiredProtocol.replace(':', '')}`;
    }
    if (endpoint.username || endpoint.password) return 'must not contain embedded credentials';
    if ([...endpoint.searchParams.keys()].some((key) => SENSITIVE_QUERY_PATTERN.test(key))) {
      return 'must not contain credential-like query parameters';
    }
    if (endpoint.search || endpoint.hash) return 'must not contain query parameters or fragments';
    return null;
  } catch {
    return 'must be a valid URL';
  }
}

function makeResult(name, level, message) {
  return { name, level, message };
}

function validateEnvironment(env, { profile = 'development', fileEnvironment = {} } = {}) {
  const results = [];
  const production = profile === 'production' || profile === 'testflight';
  const preview = profile === 'preview';
  const fullCatalogLanguagesAllowed = profile === 'development' || profile === 'testflight';
  const remoteEASBuild = env.EAS_BUILD === '1' || env.EAS_BUILD === 'true';
  const strictTransport = production || preview;
  const required = new Map();

  if (production) {
    for (const [name, reason] of [
      ['EXPO_PUBLIC_API_BASE_URL', 'required by production auth, safety, and privacy flows'],
      ['EXPO_PUBLIC_ACTION_GATEWAY_URL', 'required for production robot action delivery'],
      ['EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID', 'required for production Google token validation'],
      ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'required for production iOS Google Sign-In'],
      ['EXPO_PUBLIC_HUME_WS_PROXY_URL', 'required for production live voice'],
      ['EXPO_PUBLIC_HUME_CONFIG_ID', 'required for the production EVI configuration'],
      ['EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN', 'required for production maps']
    ]) required.set(name, reason);
    if (remoteEASBuild) {
      required.set('RNMAPBOX_MAPS_DOWNLOAD_TOKEN', 'required on the remote production native builder');
    }
  }

  if (enabled(env, 'EXPO_PUBLIC_PHONE_AUTH_ENABLED')) {
    required.set('EXPO_PUBLIC_API_BASE_URL', 'required when phone authentication is enabled');
  }
  if (enabled(env, 'EXPO_PUBLIC_SAFETY_BACKEND_ENABLED')) {
    required.set('EXPO_PUBLIC_API_BASE_URL', 'required when the safety backend is enabled');
  }
  if (production || enabled(env, 'EXPO_PUBLIC_HUME_CLM_ENABLED')) {
    required.set('EXPO_PUBLIC_HUME_WS_PROXY_URL', 'required when custom Hume CLM is enabled');
    required.set('EXPO_PUBLIC_HUME_CONFIG_ID', 'required when custom Hume CLM is enabled');
    if (!isConfigured(env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL) && !isConfigured(env.EXPO_PUBLIC_API_BASE_URL)) {
      required.set('EXPO_PUBLIC_HUME_CUSTOMIZATION_URL', 'required when custom Hume CLM is enabled and no API-base fallback exists');
    }
  }
  if (production || enabled(env, 'EXPO_PUBLIC_VL01_ENABLED')) {
    required.set('EXPO_PUBLIC_VL01_SERVICE_UUID', 'required when the VL01 protocol is enabled');
    required.set('EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID', 'required when the VL01 protocol is enabled');
    required.set('EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY', 'required to verify wearable command signatures');
    if (production) {
      required.set('EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID', 'required by the production VL01 registry');
      required.set('EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID', 'required by the production VL01 registry');
      required.set('EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID', 'required by the production VL01 registry');
    }
  }

  if (production) {
    for (const [name, description] of [
      ['EXPO_PUBLIC_PHONE_AUTH_ENABLED', 'must be true for production phone authentication'],
      ['EXPO_PUBLIC_HUME_CLM_ENABLED', 'must be true for the production custom voice path'],
      ['EXPO_PUBLIC_SAFETY_BACKEND_ENABLED', 'must be true for durable production safety flows'],
      ['EXPO_PUBLIC_VL01_ENABLED', 'must be true after the production firmware registry is approved']
    ]) {
      if (!enabled(env, name)) results.push(makeResult(name, 'error', description));
    }
  }

  for (const name of ROOT_VARIABLES) {
    if (results.some((result) => result.name === name && result.level === 'error')) continue;
    const value = env[name];
    const configured = isConfigured(value);

    if (required.has(name) && !configured) {
      results.push(makeResult(name, 'error', required.get(name)));
      continue;
    }

    if (name === 'EXPO_PUBLIC_HUME_API_KEY') {
      if (configured && (production || preview)) {
        results.push(makeResult(name, 'error', 'must be absent outside controlled development because public values are bundled'));
      } else if (configured) {
        results.push(makeResult(name, 'warn', 'configured for development; prefer the server gateway and never ship this value'));
      } else {
        results.push(makeResult(name, 'ok', 'absent as recommended'));
      }
      continue;
    }

    if (!configured) {
      if (name === 'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL' && isConfigured(env.EXPO_PUBLIC_API_BASE_URL)) {
        results.push(makeResult(name, 'ok', 'uses the configured API-base fallback'));
      } else if (name === 'VERYLOVING_BUILD_PROFILE') {
        results.push(makeResult(name, 'ok', `uses the ${profile} command/default profile`));
      } else if (name === 'VERYLOVING_CONFIG_DIAGNOSTICS') {
        results.push(makeResult(name, 'ok', 'optional redacted diagnostics remain disabled'));
      } else if (name === 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN' && production) {
        results.push(makeResult(name, 'warn', 'build-only secret is not locally verifiable; confirm it on the EAS builder'));
      } else {
        results.push(makeResult(name, 'warn', 'optional for this profile and currently missing'));
      }
      continue;
    }

    if (/(^|[^\\])\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/.test(value)) {
      results.push(makeResult(name, 'error', 'must be a concrete value; dotenv interpolation is not accepted by this validator'));
      continue;
    }

    if (BOOLEAN_VARIABLES.has(name) && !/^(?:true|false)$/.test(value)) {
      results.push(makeResult(name, 'error', 'must be exactly true or false'));
      continue;
    }

    if (name === 'VERYLOVING_BUILD_PROFILE' && !VALID_PROFILES.has(value)) {
      results.push(makeResult(name, 'error', 'must be development, preview, or production'));
      continue;
    }

    if (name === 'VERYLOVING_CONFIG_DIAGNOSTICS' && !/^(?:0|1|true|false)$/.test(value)) {
      results.push(makeResult(name, 'error', 'must be 0, 1, true, or false'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_ENABLE_OFFLINE_MODE' && production && enabled(env, name)) {
      results.push(makeResult(name, 'error', 'must be false for a production release'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_SHOW_ALL_LANGUAGES' && !fullCatalogLanguagesAllowed && enabled(env, name)) {
      results.push(makeResult(name, 'error', 'must be false outside development or the dedicated TestFlight catalog-QA profile'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN' && !value.startsWith('pk.')) {
      results.push(makeResult(name, 'error', 'must be a Mapbox public pk.* runtime token'));
      continue;
    }

    if (name === 'RNMAPBOX_MAPS_DOWNLOAD_TOKEN' && !value.startsWith('sk.')) {
      results.push(makeResult(name, 'error', 'must be a Mapbox secret sk.* downloads token'));
      continue;
    }

    if ((name === 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID' || name === 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID')
      && !value.endsWith('.apps.googleusercontent.com')) {
      results.push(makeResult(name, 'error', 'must be a Google OAuth client ID'));
      continue;
    }

    if ((name === 'EXPO_PUBLIC_HUME_CONFIG_ID' || name === 'EXPO_PUBLIC_HUME_BRANDED_VOICE_ID')
      && !CANONICAL_UUID_PATTERN.test(value)) {
      results.push(makeResult(name, 'error', 'must be a canonical Hume UUID'));
      continue;
    }

    if (name === 'EXPO_PUBLIC_ACTION_SIGNING_PUBLIC_KEY' && !/^[A-Za-z0-9_-]{43}$/.test(value)) {
      results.push(makeResult(name, 'error', 'must be a base64url-encoded 32-byte Ed25519 public key'));
      continue;
    }

    if (name.startsWith('EXPO_PUBLIC_VL01_') && name.endsWith('_UUID') && !UUID_PATTERN.test(value)) {
      results.push(makeResult(name, 'error', 'must be a 4-, 8-, or canonical 128-bit hexadecimal UUID'));
      continue;
    }

    let problem = null;
    if (name === 'EXPO_PUBLIC_API_BASE_URL' || name === 'EXPO_PUBLIC_ACTION_GATEWAY_URL' || name === 'EXPO_PUBLIC_HUME_CUSTOMIZATION_URL') {
      problem = endpointProblem(value, 'https:', { allowLocalDevelopment: !strictTransport });
    } else if (name === 'EXPO_PUBLIC_HUME_WS_PROXY_URL') {
      problem = endpointProblem(value, 'wss:', { allowLocalDevelopment: !strictTransport });
    }
    if (problem) {
      results.push(makeResult(name, 'error', problem));
      continue;
    }

    results.push(makeResult(name, 'ok', 'configured'));
  }

  if (strictTransport && isConfigured(env.EXPO_PUBLIC_ACTION_GATEWAY_URL) && isConfigured(env.EXPO_PUBLIC_HUME_WS_PROXY_URL)) {
    try {
      if (new URL(env.EXPO_PUBLIC_ACTION_GATEWAY_URL).host !== new URL(env.EXPO_PUBLIC_HUME_WS_PROXY_URL).host) {
        results.push(makeResult('EXPO_PUBLIC_ACTION_GATEWAY_URL', 'error', 'must share the long-lived voice gateway host'));
      }
    } catch {}
  }

  for (const name of SERVER_SECRET_NAMES) {
    if (isConfigured(fileEnvironment[name])) {
      results.push(makeResult(name, 'error', 'server secret is misplaced in the root environment file'));
    }
  }

  return results;
}

function parseArguments(argv) {
  const options = { file: '.env', profile: undefined, color: !process.env.NO_COLOR };
  const optionValue = (index, option) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') {
      options.file = optionValue(index, '--file');
      index += 1;
    } else if (argument === '--profile') {
      options.profile = optionValue(index, '--profile');
      index += 1;
    } else if (argument === '--no-color') {
      options.color = false;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.file) throw new Error('--file requires a path');
  if (options.profile && !VALID_PROFILES.has(options.profile)) {
    throw new Error('--profile must be development, preview, production, or testflight');
  }
  return options;
}

function colors(enabledColor) {
  const wrap = (code) => (text) => enabledColor ? `\u001b[${code}m${text}\u001b[0m` : text;
  return {
    green: wrap('32'),
    yellow: wrap('33'),
    red: wrap('31'),
    cyan: wrap('36'),
    bold: wrap('1')
  };
}

function renderReport({ results, profile, filePath, fileFound, color = true }) {
  const paint = colors(color);
  const lines = [
    paint.bold('VeryLoving environment validation'),
    `Profile: ${paint.cyan(profile)}`,
    `Source: ${fileFound ? filePath : `${filePath} (not found; process environment only)`}`,
    ''
  ];
  if (!fileFound) lines.push(paint.yellow('⚠ Environment file not found; validating process variables only.'), '');

  for (const result of results) {
    if (result.level === 'ok') {
      const label = result.message === 'configured' ? '✓ SET' : '✓ OK';
      lines.push(`${paint.green(label)}${label === '✓ SET' ? '   ' : '    '}${result.name} — ${result.message}`);
    }
    if (result.level === 'warn') lines.push(`${paint.yellow('⚠ WARN')}  ${result.name} — ${result.message}`);
    if (result.level === 'error') lines.push(`${paint.red('✖ ERROR')} ${result.name} — ${result.message}`);
  }

  const counts = results.reduce((summary, result) => {
    summary[result.level] += 1;
    return summary;
  }, { ok: 0, warn: 0, error: 0 });
  lines.push('', `Summary: ${paint.green(`${counts.ok} ok`)} · ${paint.yellow(`${counts.warn} warnings`)} · ${paint.red(`${counts.error} errors`)}`);
  lines.push(counts.error ? paint.red('Environment validation failed.') : paint.green('Environment validation passed.'));
  return lines.join('\n');
}

function usage() {
  return [
    'Usage: npm run validate-env -- [--file <path>] [--profile development|preview|production|testflight] [--no-color]',
    '',
    'The environment file is loaded first and explicit process variables override it.',
    'Only variable names and validation states are printed; values are never printed.'
  ].join('\n');
}

function run(argv = process.argv.slice(2), processEnvironment = process.env) {
  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const filePath = resolve(PROJECT_ROOT, options.file);
  const fileFound = existsSync(filePath);
  const fileEnvironment = fileFound ? parseDotEnv(readFileSync(filePath, 'utf8')) : {};
  const environment = { ...fileEnvironment, ...processEnvironment };
  const profile = options.profile || environment.VERYLOVING_BUILD_PROFILE || 'development';
  if (!VALID_PROFILES.has(profile)) {
    process.stderr.write('Effective profile must be development, preview, production, or testflight.\n');
    return 2;
  }
  environment.VERYLOVING_BUILD_PROFILE = profile;
  const results = validateEnvironment(environment, { profile, fileEnvironment });
  process.stdout.write(`${renderReport({ results, profile, filePath, fileFound, color: options.color })}\n`);
  return results.some((result) => result.level === 'error') ? 1 : 0;
}

if (require.main === module) process.exitCode = run();

module.exports = {
  ROOT_VARIABLES,
  parseDotEnv,
  isConfigured,
  endpointProblem,
  validateEnvironment,
  parseArguments,
  renderReport,
  run
};
