#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const NATIVE_ACCESS_OPTION = '--enable-native-access=ALL-UNNAMED';

function javaExecutable(environment = process.env) {
  return environment.JAVA_HOME
    ? join(environment.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
}

function parseJavaMajor(versionOutput) {
  const match = String(versionOutput).match(/version\s+"(?:1\.)?(\d+)/i);
  if (!match) throw new Error('Java version could not be parsed from `java -version`');
  return Number.parseInt(match[1], 10);
}

function detectJavaMajor(environment = process.env, run = spawnSync) {
  const result = run(javaExecutable(environment), ['-version'], {
    encoding: 'utf8',
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.error || result.status !== 0) {
    throw new Error('Java could not be started; set JAVA_HOME to an installed JDK');
  }
  return parseJavaMajor(`${result.stdout || ''}\n${result.stderr || ''}`);
}

function appendJavaToolOption(currentValue, option = NATIVE_ACCESS_OPTION) {
  const current = String(currentValue || '').trim();
  const options = current ? current.split(/\s+/) : [];
  return options.includes(option) ? current : [...options, option].join(' ');
}

function androidEnvironment(environment, javaMajor) {
  const next = { ...environment };
  if (javaMajor >= 24) {
    next.JAVA_TOOL_OPTIONS = appendJavaToolOption(next.JAVA_TOOL_OPTIONS);
  }
  return next;
}

function run({ args = process.argv.slice(2), environment = process.env, execute = spawnSync } = {}) {
  try {
    const javaMajor = detectJavaMajor(environment, execute);
    const childEnvironment = androidEnvironment(environment, javaMajor);
    if (javaMajor >= 24) {
      process.stdout.write(
        `[Android] Java ${javaMajor}: enabled native access for Android Prefab child processes.\n`
      );
    }

    const expoRoot = dirname(require.resolve('expo/package.json'));
    const result = execute(process.execPath, [join(expoRoot, 'bin', 'cli'), 'run:android', ...args], {
      env: childEnvironment,
      stdio: 'inherit'
    });
    if (result.error) throw result.error;
    return result.status === null ? 1 : result.status;
  } catch (error) {
    process.stderr.write(`[Android] ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = run();

module.exports = {
  NATIVE_ACCESS_OPTION,
  androidEnvironment,
  appendJavaToolOption,
  detectJavaMajor,
  javaExecutable,
  parseJavaMajor,
  run
};
