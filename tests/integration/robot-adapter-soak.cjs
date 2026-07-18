'use strict';

process.env.NODE_ENV = 'test';

const { performance } = require('node:perf_hooks');
const { JiangzhiAdapter } = require('../../server/dist/adapters');

const DEFAULT_DURATION_MS = 60_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const MAX_SAMPLES = 50_000;

function boundedInteger(raw, fallback, minimum, maximum, name) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} is invalid`);
  return value;
}

function activeHandleCount() {
  return typeof process._getActiveHandles === 'function'
    ? process._getActiveHandles().filter((handle) => ![process.stdin, process.stdout, process.stderr].includes(handle)).length
    : 0;
}

async function runSoak({
  durationMs = DEFAULT_DURATION_MS,
  maximumHeapGrowthBytes = 32 * 1024 * 1024,
  now = performance.now.bind(performance)
} = {}) {
  durationMs = boundedInteger(durationMs, DEFAULT_DURATION_MS, 100, MAX_DURATION_MS, 'Soak duration');
  maximumHeapGrowthBytes = boundedInteger(
    maximumHeapGrowthBytes,
    32 * 1024 * 1024,
    1024 * 1024,
    512 * 1024 * 1024,
    'Heap-growth threshold'
  );
  let commandId = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/session')) return new Response(JSON.stringify({ authenticated: true }));
    return new Response(JSON.stringify({
      success: true,
      command_id: `soak-command-${++commandId}`,
      state: 'completed'
    }));
  };
  const adapter = new JiangzhiAdapter({
    adapterId: 'soak-edge',
    baseUrl: 'https://soak.invalid',
    apiKey: 'test-only-api-key',
    fetchImpl,
    logger: { info() {}, warn() {}, error() {} },
    maxAttempts: 1,
    // This in-process transport benchmark intentionally exercises the direct
    // provisional HAL surface. Deployed orchestration leaves this false and
    // uses only binding-epoch-scoped signed actions.
    allowProvisionalUnsignedCommands: true
  });
  await adapter.initialize({ deviceId: 'soak-device-1' });
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const handlesBefore = activeHandleCount();
  const latencies = [];
  let commands = 0;
  const deadline = now() + durationMs;
  while (now() < deadline) {
    const startedAt = now();
    await adapter.activateAlarm();
    const latency = now() - startedAt;
    if (latencies.length < MAX_SAMPLES) latencies.push(latency);
    else latencies[commands % MAX_SAMPLES] = latency;
    commands += 1;
    if (commands % 1000 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  global.gc?.();
  const heapAfter = process.memoryUsage().heapUsed;
  const handlesAfter = activeHandleCount();
  latencies.sort((left, right) => left - right);
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] || 0;
  const heapGrowthBytes = heapAfter - heapBefore;
  if (commands < 1) throw new Error('Soak test executed no commands');
  if (heapGrowthBytes > maximumHeapGrowthBytes) throw new Error('Robot adapter heap growth exceeded the configured threshold');
  if (handlesAfter > handlesBefore + 2) throw new Error('Robot adapter active-handle count grew unexpectedly');
  return Object.freeze({
    durationMs,
    commands,
    p95AcceptanceMs: Math.round(p95 * 1000) / 1000,
    heapGrowthBytes,
    handlesBefore,
    handlesAfter,
    sampledLatencies: latencies.length
  });
}

if (require.main === module) {
  runSoak({
    durationMs: process.env.ROBOT_SOAK_DURATION_MS,
    maximumHeapGrowthBytes: process.env.ROBOT_SOAK_MAX_HEAP_GROWTH_BYTES
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { MAX_DURATION_MS, runSoak };
