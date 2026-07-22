'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const { beforeEach, test } = require('node:test');
const originalLoad = Module._load;
Module._load = function loadScenarioConfig(request, parent, isMain) {
  if (request === '../utils/config'
    && parent?.filename.endsWith('/src/services/ai-native-scenarios.js')) {
    return { config: { apiBaseUrl: 'https://api.example.test' } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const {
  AI_NATIVE_SCENARIO_INTENTS,
  cancelScenarioExecution,
  createScenarioIntent,
  getScenarioExecution,
  listScenarioExecutions,
  pollScenarioExecution,
  reconcileScenarioExecutions,
  ScenarioClientError,
  startScenario,
  submitInteractionFeedback,
  submitScenarioFeedback
} = require('../src/services/ai-native-scenarios');
Module._load = originalLoad;
const {
  drainScenarioActivityMutations,
  listPendingScenarioIntents,
  loadScenarioActivity,
  SCENARIO_ACTIVITY_KEY,
  SCENARIO_PENDING_INTENT_KEY_PREFIX
} = require('../src/services/scenario-activity-store');
const { storage } = require('../src/services/storage');

const API_BASE_URL = 'https://api.example.test';
const ACCOUNT_ID = 'google:user-1';
const ACCESS_TOKEN = `x.${Buffer.from(JSON.stringify({ sub: ACCOUNT_ID })).toString('base64url')}.y`;

const scenarioStorage = new Map();
storage.getJSON = async (key, fallback) => scenarioStorage.has(key)
  ? structuredClone(scenarioStorage.get(key))
  : fallback;
storage.setJSON = async (key, value) => {
  scenarioStorage.set(key, structuredClone(value));
};
storage.remove = async (key) => {
  scenarioStorage.delete(key);
};
storage.removeMany = async (keys) => keys.forEach((key) => scenarioStorage.delete(key));

beforeEach(() => {
  scenarioStorage.clear();
});

function execution(overrides = {}) {
  return {
    schemaVersion: 1,
    definitionVersion: 1,
    identityKeyVersion: 1,
    executionId: '11111111-1111-4111-8111-111111111111',
    accountRef: 'opaque-account',
    scenarioId: 'ai_angel_auto_dial',
    triggerRef: 'opaque-trigger',
    idempotencyRef: 'opaque-idempotency',
    requestRef: 'opaque-request',
    priority: 'critical',
    state: 'queued',
    createdAt: 1_000,
    updatedAt: 1_000,
    version: 1,
    deviceReferences: {},
    steps: [],
    ...overrides
  };
}

function jsonResponse(payload, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  const text = JSON.stringify(payload);
  return {
    status,
    ok,
    headers: { get: (name) => name === 'content-length' ? String(Buffer.byteLength(text)) : null },
    text: async () => text
  };
}

test('scenario client sends the five exact authenticated user-intent contracts with stable identities', async () => {
  const requests = [];
  for (const [index, [scenarioId, expectedIntent]] of Object.entries(AI_NATIVE_SCENARIO_INTENTS).entries()) {
    const intent = createScenarioIntent(scenarioId, {
      requestId: `request-${scenarioId}`,
      occurredAt: 2_000 + index
    });
    const responseExecution = execution({
      executionId: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
      scenarioId,
      priority: scenarioId === 'ai_angel_auto_dial' || scenarioId === 'fall_detection'
        ? 'critical'
        : scenarioId === 'cognitive_engagement' ? 'background' : 'standard'
    });
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return jsonResponse({
        started: [{ accepted: true, duplicate: false, execution: responseExecution }]
      }, { status: 202 });
    };
    const context = scenarioId === 'emotional_check_in'
      ? { mood_key: 'okay' }
      : scenarioId === 'cognitive_engagement'
        ? { activity: 'memory' }
        : undefined;
    const first = await startScenario({
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      scenarioId,
      scenarioIntent: intent,
      ...(context ? { context } : {})
    }, { apiBaseUrl: API_BASE_URL, fetchImpl });
    assert.equal(first.started[0].execution.scenarioId, scenarioId);

    const body = JSON.parse(requests.at(-1).options.body);
    assert.deepEqual(body, {
      scenario_id: scenarioId,
      request_id: `request-${scenarioId}`,
      occurred_at: 2_000 + index,
      ...(expectedIntent ? { intent: expectedIntent } : {}),
      ...(context ? { context } : {})
    });
    assert.equal(requests.at(-1).url, `${API_BASE_URL}/v1/scenarios`);
    assert.equal(requests.at(-1).options.headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
  }

  const history = await loadScenarioActivity(ACCOUNT_ID);
  assert.equal(history.executions.length, 5);
  assert.deepEqual(new Set(history.executions.map(({ scenarioId }) => scenarioId)),
    new Set(Object.keys(AI_NATIVE_SCENARIO_INTENTS)));
});

test('scenario context is privacy-bounded, scenario-specific, and never accepts unknown fields', async () => {
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return jsonResponse({
      started: [{
        accepted: true,
        duplicate: false,
        execution: execution({
          executionId: `11111111-1111-4111-8111-${String(requests.length + 20).padStart(12, '0')}`,
          scenarioId: body.scenario_id,
          priority: body.scenario_id === 'cognitive_engagement' ? 'background' : 'standard'
        })
      }]
    }, { status: 202 });
  };
  await startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'emotional_check_in',
    context: { mood_key: 'low', reflection_summary: 'A short private summary.' }
  }, { apiBaseUrl: API_BASE_URL, fetchImpl });
  await startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'cognitive_engagement',
    context: { activity: 'memory' }
  }, { apiBaseUrl: API_BASE_URL, fetchImpl });
  assert.deepEqual(requests.map(({ context }) => context), [
    { mood_key: 'low', reflection_summary: 'A short private summary.' },
    { activity: 'memory' }
  ]);

  for (const [scenarioId, context] of [
    ['emotional_check_in', { mood_key: 'unknown' }],
    ['emotional_check_in', { mood_key: 'good', raw_transcript: 'private' }],
    ['emotional_check_in', { mood_key: 'good', reflection_summary: 'x'.repeat(281) }],
    ['emotional_check_in', { mood_key: 'good', reflection_summary: 'line one\nline two' }],
    ['cognitive_engagement', { activity: 'diagnostic_assessment' }],
    ['cognitive_engagement', { activity: 'memory', score: 10 }],
    ['ai_angel_auto_dial', { mood_key: 'good' }]
  ]) {
    await assert.rejects(startScenario({
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      scenarioId,
      context
    }, { apiBaseUrl: API_BASE_URL, fetchImpl }),
    (error) => error.code === 'SCENARIO_CONTEXT_INVALID');
  }
  assert.equal(requests.length, 2);

  for (const scenarioId of ['emotional_check_in', 'cognitive_engagement']) {
    await assert.rejects(startScenario({
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      scenarioId
    }, { apiBaseUrl: API_BASE_URL, fetchImpl }),
    (error) => error.code === 'SCENARIO_CONTEXT_REQUIRED');
  }
  assert.equal(requests.length, 2);
});

test('scenario intents reject forged devices, wrong literals, and cross-account sessions', async () => {
  const intent = createScenarioIntent('fall_detection', {
    requestId: 'fall-practice-1',
    occurredAt: 5_000
  });
  assert.deepEqual(intent, {
    scenarioId: 'fall_detection',
    requestId: 'fall-practice-1',
    occurredAt: 5_000,
    intent: 'practice_drill'
  });
  assert.throws(() => createScenarioIntent('unknown'),
    (error) => error instanceof ScenarioClientError && error.code === 'SCENARIO_ID_INVALID');

  let calls = 0;
  const forbiddenFields = { ...intent, devices: { homeRobotId: 'forged' } };
  await assert.rejects(startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'fall_detection',
    scenarioIntent: forbiddenFields
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => { calls += 1; }
  }), (error) => error.code === 'SCENARIO_INTENT_INVALID');

  const wrongAccountToken = `x.${Buffer.from(JSON.stringify({ sub: 'google:user-2' })).toString('base64url')}.y`;
  await assert.rejects(getScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: wrongAccountToken,
    executionId: execution().executionId
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => { calls += 1; }
  }), (error) => error.code === 'SCENARIO_ACCOUNT_MISMATCH');
  assert.equal(calls, 0);
});

test('a lost response survives reload and reuses the exact durable request identity and context', async () => {
  const firstIntent = createScenarioIntent('emotional_check_in', {
    requestId: 'durable-emotional-1',
    occurredAt: 5_500
  });
  let firstBody;
  await assert.rejects(startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'emotional_check_in',
    scenarioIntent: firstIntent,
    context: { mood_key: 'okay', reflection_summary: 'Quiet morning.' }
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (_url, options) => {
      firstBody = JSON.parse(options.body);
      throw new TypeError('response lost');
    }
  }), (error) => error.code === 'SCENARIO_NETWORK_ERROR');

  const pending = await listPendingScenarioIntents(ACCOUNT_ID);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, 'durable-emotional-1');
  assert.deepEqual(pending[0].context, {
    mood_key: 'okay',
    reflection_summary: 'Quiet morning.'
  });

  const newAfterReload = createScenarioIntent('emotional_check_in', {
    requestId: 'new-id-must-not-replace-uncertain-request',
    occurredAt: 5_600
  });
  let retriedBody;
  const duplicate = await startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'emotional_check_in',
    scenarioIntent: newAfterReload,
    context: { mood_key: 'great', reflection_summary: 'Different input.' }
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (_url, options) => {
      retriedBody = JSON.parse(options.body);
      return jsonResponse({
        started: [{
          accepted: true,
          duplicate: true,
          execution: execution({ scenarioId: 'emotional_check_in', priority: 'standard' })
        }]
      }, { status: 202 });
    }
  });
  assert.equal(duplicate.started[0].duplicate, true);
  assert.deepEqual(retriedBody, firstBody);
  await drainScenarioActivityMutations();
  assert.deepEqual(await listPendingScenarioIntents(ACCOUNT_ID), []);
});

test('authoritative execution listing is strict, bounded, and reconciles pending IDs by replay', async () => {
  const intent = createScenarioIntent('cognitive_engagement', {
    requestId: 'durable-cognitive-1',
    occurredAt: 6_000
  });
  await assert.rejects(startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'cognitive_engagement',
    scenarioIntent: intent,
    context: { activity: 'trivia' }
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => { throw new TypeError('lost response'); }
  }), (error) => error.code === 'SCENARIO_NETWORK_ERROR');

  const listed = execution({
    executionId: '33333333-3333-4333-8333-333333333333',
    state: 'completed',
    updatedAt: 6_100,
    completedAt: 6_100,
    version: 2
  });
  const reconciledExecution = execution({
    executionId: '44444444-4444-4444-8444-444444444444',
    scenarioId: 'cognitive_engagement',
    priority: 'background'
  });
  const requests = [];
  const result = await reconcileScenarioExecutions({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    limit: 25
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'GET') return jsonResponse({ executions: [listed] });
      return jsonResponse({
        started: [{ accepted: true, duplicate: true, execution: reconciledExecution }]
      }, { status: 202 });
    }
  });
  assert.equal(requests[0].url, `${API_BASE_URL}/v1/scenarios/executions?limit=25`);
  assert.equal(result.executions.length, 1);
  assert.equal(result.reconciled[0].executionId, reconciledExecution.executionId);
  assert.equal(JSON.parse(requests[1].options.body).request_id, 'durable-cognitive-1');
  await drainScenarioActivityMutations();
  assert.deepEqual(await listPendingScenarioIntents(ACCOUNT_ID), []);

  await assert.rejects(listScenarioExecutions({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    limit: 0
  }), (error) => error.code === 'SCENARIO_LIST_LIMIT_INVALID');
  await assert.rejects(listScenarioExecutions({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    limit: 2
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse({ executions: [listed], unexpected: true })
  }), (error) => error.code === 'SCENARIO_RESPONSE_INVALID');
  await assert.rejects(listScenarioExecutions({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    limit: 2
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse({ executions: [listed, listed] })
  }), (error) => error.code === 'SCENARIO_RESPONSE_INVALID');
});

test('status polling normalizes and persists queued through completed state without leaking timers', async () => {
  const states = [
    execution({ state: 'queued', updatedAt: 1_000 }),
    execution({ state: 'running', updatedAt: 1_100, version: 2 }),
    execution({ state: 'completed', updatedAt: 1_200, completedAt: 1_200, version: 3 })
  ];
  const updates = [];
  const delays = [];
  let clock = 10_000;
  const result = await pollScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId,
    onUpdate: (value) => updates.push(value.state)
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse(states.shift()),
    intervalMs: 100,
    pollTimeoutMs: 1_000,
    now: () => clock,
    wait: async (delay) => {
      delays.push(delay);
      clock += delay;
    }
  });
  assert.equal(result.state, 'completed');
  assert.deepEqual(updates, ['queued', 'running', 'completed']);
  assert.deepEqual(delays, [100, 100]);
  assert.equal((await loadScenarioActivity(ACCOUNT_ID)).executions[0].state, 'completed');
});

test('scenario polling supports cancellation, bounded deadlines, and exact response errors', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(pollScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, { signal: controller.signal }), (error) => (
    error instanceof ScenarioClientError && error.code === 'SCENARIO_CANCELLED'
  ));

  let clock = 1_000;
  await assert.rejects(pollScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse(execution()),
    intervalMs: 100,
    pollTimeoutMs: 100,
    now: () => clock,
    wait: async (delay) => { clock += delay; }
  }), (error) => error.code === 'SCENARIO_POLL_TIMEOUT');

  const malformed = jsonResponse({ state: 'completed' });
  await assert.rejects(getScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, { apiBaseUrl: API_BASE_URL, fetchImpl: async () => malformed }),
  (error) => error.code === 'SCENARIO_RESPONSE_INVALID');

  await assert.rejects(getScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, {
    apiBaseUrl: API_BASE_URL,
    timeoutMs: 5,
    fetchImpl: async () => new Promise(() => {})
  }), (error) => error.code === 'SCENARIO_TIMEOUT');

  const longMedication = await pollScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, {
    apiBaseUrl: API_BASE_URL,
    pollTimeoutMs: 22 * 60_000,
    intervalMs: 5_000,
    fetchImpl: async () => jsonResponse(execution({
      scenarioId: 'medication_adherence',
      priority: 'standard',
      state: 'completed',
      updatedAt: 1_100,
      completedAt: 1_100
    }))
  });
  assert.equal(longMedication.state, 'completed');
  await assert.rejects(pollScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, { pollTimeoutMs: 30 * 60_000 + 1 }),
  (error) => error.code === 'SCENARIO_POLL_OPTIONS_INVALID');
});

test('HTTP status failures map to stable semantic codes without losing statusCode', async () => {
  for (const [status, code] of [
    [401, 'SCENARIO_AUTHENTICATION_REQUIRED'],
    [403, 'SCENARIO_ACCOUNT_UNAVAILABLE'],
    [404, 'SCENARIO_NOT_FOUND'],
    [503, 'SCENARIO_NOT_CONFIGURED']
  ]) {
    await assert.rejects(getScenarioExecution({
      accountId: ACCOUNT_ID,
      accessToken: ACCESS_TOKEN,
      executionId: execution().executionId
    }, {
      apiBaseUrl: API_BASE_URL,
      fetchImpl: async () => jsonResponse({ error: 'redacted' }, { status })
    }), (error) => error.code === code && error.statusCode === status);
  }

  await assert.rejects(startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'medication_adherence'
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse({ error: 'invalid intent' }, { status: 400 })
  }), (error) => error.code === 'SCENARIO_HTTP_400' && error.statusCode === 400);
  await drainScenarioActivityMutations();
  assert.deepEqual(await listPendingScenarioIntents(ACCOUNT_ID), []);
});

test('scenario cancellation requires explicit identity and persists the server snapshot', async () => {
  let body;
  const cancelled = await cancelScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId,
    occurredAt: 7_000
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return jsonResponse(execution({ state: 'cancelled', updatedAt: 7_000, completedAt: 7_000, version: 2 }));
    }
  });
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual(body, { confirmed: true, occurred_at: 7_000 });
  assert.equal((await loadScenarioActivity(ACCOUNT_ID)).executions[0].state, 'cancelled');
});

test('scenario feedback maps thumbs to the authenticated analytics contract and caches it locally', async () => {
  await getScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse(execution({
      state: 'completed', updatedAt: 8_000, completedAt: 8_000, version: 2
    }))
  });
  let request;
  const result = await submitScenarioFeedback({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: execution().executionId,
    rating: 'down',
    occurredAt: 8_100
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ recorded: true, rating: 'not_helpful' }, { status: 201 });
    }
  });
  assert.deepEqual(result, { recorded: true, rating: 'down' });
  assert.equal(request.url, `${API_BASE_URL}/v1/scenarios/${execution().executionId}/feedback`);
  assert.deepEqual(JSON.parse(request.options.body), {
    rating: 'not_helpful',
    occurred_at: 8_100
  });
  assert.equal((await loadScenarioActivity(ACCOUNT_ID)).feedback[0].rating, 'down');
});

test('voice-call feedback uses the authenticated bounded analytics contract', async () => {
  let request;
  const result = await submitInteractionFeedback({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    interactionType: 'voice_call',
    interactionId: 'voice-session-1',
    rating: 'up',
    occurredAt: 9_100
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ recorded: true, rating: 'helpful' }, { status: 201 });
    }
  });
  assert.deepEqual(result, { recorded: true, rating: 'up' });
  assert.equal(request.url, `${API_BASE_URL}/v1/interaction-feedback`);
  assert.deepEqual(JSON.parse(request.options.body), {
    interaction_type: 'voice_call',
    interaction_id: 'voice-session-1',
    rating: 'helpful',
    occurred_at: 9_100
  });

  await assert.rejects(submitInteractionFeedback({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    interactionType: 'raw_transcript',
    interactionId: 'voice-session-1',
    rating: 'up'
  }), (error) => error.code === 'INTERACTION_FEEDBACK_INVALID');
});

test('hung local lanes never starve AI Angel or delay authoritative server results', async () => {
  const memorySetJSON = storage.setJSON;
  const cognitiveKey = `${SCENARIO_PENDING_INTENT_KEY_PREFIX}cognitive_engagement`;
  storage.setJSON = async (key, value) => {
    if (key === cognitiveKey) return new Promise(() => {});
    return memorySetJSON(key, value);
  };
  let cognitivePosts = 0;
  await assert.rejects(startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'cognitive_engagement',
    context: { activity: 'memory' }
  }, {
    apiBaseUrl: API_BASE_URL,
    reservationTimeoutMs: 5,
    fetchImpl: async () => { cognitivePosts += 1; }
  }), (error) => error.code === 'SCENARIO_INTENT_RESERVATION_TIMEOUT');
  assert.equal(cognitivePosts, 0);

  storage.setJSON = async (key, value) => {
    if (key === cognitiveKey || key === SCENARIO_ACTIVITY_KEY) return new Promise(() => {});
    return memorySetJSON(key, value);
  };

  const criticalExecution = execution();
  const critical = await startScenario({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    scenarioId: 'ai_angel_auto_dial'
  }, {
    apiBaseUrl: API_BASE_URL,
    reservationTimeoutMs: 50,
    fetchImpl: async () => jsonResponse({
      started: [{ accepted: true, duplicate: false, execution: criticalExecution }]
    }, { status: 202 })
  });
  assert.equal(critical.started[0].execution.scenarioId, 'ai_angel_auto_dial');

  async function settlesWithoutLocalStorage(operation) {
    let timeout;
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('authoritative result was delayed')), 100);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  const completed = execution({
    state: 'completed', updatedAt: 12_000, completedAt: 12_000, version: 2
  });
  assert.equal((await settlesWithoutLocalStorage(getScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: completed.executionId
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse(completed)
  }))).state, 'completed');
  assert.equal((await settlesWithoutLocalStorage(cancelScenarioExecution({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: completed.executionId,
    occurredAt: 12_100
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse({
      ...completed, state: 'cancelled', updatedAt: 12_100, completedAt: 12_100, version: 3
    })
  }))).state, 'cancelled');
  assert.deepEqual(await settlesWithoutLocalStorage(submitScenarioFeedback({
    accountId: ACCOUNT_ID,
    accessToken: ACCESS_TOKEN,
    executionId: completed.executionId,
    rating: 'up',
    occurredAt: 12_200
  }, {
    apiBaseUrl: API_BASE_URL,
    fetchImpl: async () => jsonResponse({ recorded: true, rating: 'helpful' }, { status: 201 })
  })), { recorded: true, rating: 'up' });
});
