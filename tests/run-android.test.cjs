'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  NATIVE_ACCESS_OPTION,
  androidEnvironment,
  appendJavaToolOption,
  detectJavaMajor,
  javaExecutable,
  parseJavaMajor,
  run
} = require('../scripts/run-android.cjs');

test('Android launcher parses modern and legacy Java version output', () => {
  assert.equal(parseJavaMajor('openjdk version "24.0.2" 2025-07-15'), 24);
  assert.equal(parseJavaMajor('java version "1.8.0_402"'), 8);
  assert.throws(() => parseJavaMajor('unknown runtime'), /could not be parsed/);
});

test('Android launcher resolves Java from JAVA_HOME and reports startup failures', () => {
  assert.match(javaExecutable({ JAVA_HOME: '/opt/jdk-24' }), /opt\/jdk-24\/bin\/java$/);
  assert.equal(
    detectJavaMajor({}, () => ({ status: 0, stdout: '', stderr: 'openjdk version "24"' })),
    24
  );
  assert.throws(
    () => detectJavaMajor({}, () => ({ status: 1, stdout: '', stderr: 'failed' })),
    /Java could not be started/
  );
});

test('Android launcher propagates native access exactly once on Java 24 and newer', () => {
  assert.equal(appendJavaToolOption(''), NATIVE_ACCESS_OPTION);
  assert.equal(
    appendJavaToolOption(`-Xmx2g ${NATIVE_ACCESS_OPTION}`),
    `-Xmx2g ${NATIVE_ACCESS_OPTION}`
  );
  assert.equal(androidEnvironment({ JAVA_TOOL_OPTIONS: '-Xmx2g' }, 24).JAVA_TOOL_OPTIONS,
    `-Xmx2g ${NATIVE_ACCESS_OPTION}`);
  assert.equal(androidEnvironment({}, 25).JAVA_TOOL_OPTIONS, NATIVE_ACCESS_OPTION);
});

test('Android launcher leaves older supported JDK environments unchanged', () => {
  const environment = { JAVA_TOOL_OPTIONS: '-Xmx2g', MARKER: 'preserved' };
  assert.deepEqual(androidEnvironment(environment, 17), environment);
  assert.notEqual(androidEnvironment(environment, 17), environment);
});

test('Android launcher forwards Expo arguments and the Java 24 child environment', () => {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return calls.length === 1
      ? { status: 0, stdout: '', stderr: 'openjdk version "24"' }
      : { status: 0 };
  };

  assert.equal(run({
    args: ['--device', 'Pixel_9'],
    environment: { JAVA_HOME: '/jdk-24', JAVA_TOOL_OPTIONS: '-Xmx2g', MARKER: 'yes' },
    execute
  }), 0);
  assert.match(calls[0].command, /jdk-24\/bin\/java$/);
  assert.deepEqual(calls[0].args, ['-version']);
  assert.equal(calls[1].command, process.execPath);
  assert.deepEqual(calls[1].args.slice(-3), ['run:android', '--device', 'Pixel_9']);
  assert.equal(calls[1].options.env.MARKER, 'yes');
  assert.equal(
    calls[1].options.env.JAVA_TOOL_OPTIONS,
    `-Xmx2g ${NATIVE_ACCESS_OPTION}`
  );
});

test('Android launcher propagates child failures', () => {
  const javaVersion = { status: 0, stdout: '', stderr: 'openjdk version "24"' };
  let calls = 0;
  assert.equal(run({
    execute: () => (++calls === 1 ? javaVersion : { status: 7 })
  }), 7);

  calls = 0;
  assert.equal(run({
    execute: () => (++calls === 1
      ? javaVersion
      : { status: null, error: new Error('spawn failed') })
  }), 1);
});
