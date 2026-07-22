'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const runner = readFileSync(
  path.resolve(process.cwd(), 'src/hooks/useScenarioRunner.js'),
  'utf8'
);

function section(start, end) {
  const startIndex = runner.indexOf(start);
  const endIndex = runner.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return runner.slice(startIndex, endIndex);
}

test('scenario operations are fenced to the focus generation that started them', () => {
  assert.match(runner, /const focusGenerationRef = useRef\(0\)/);
  assert.match(
    runner,
    /mountedRef\.current[\s\S]*focusGenerationRef\.current === expectedFocusGeneration[\s\S]*identityRef\.current\.accountId === expectedAccountId/
  );

  const focusLifecycle = section(
    'useFocusEffect(useCallback(() => {',
    '\n\n  const runScenario'
  );
  assert.match(focusLifecycle, /const focusGeneration = \+\+focusGenerationRef\.current/);
  assert.match(
    focusLifecycle,
    /if \(focusGenerationRef\.current !== focusGeneration\) return;[\s\S]*mountedRef\.current = false;[\s\S]*focusGenerationRef\.current \+= 1/
  );

  for (const operation of [
    section('const pollExecution', '\n\n  const refreshActivity'),
    section('const refreshActivity', '\n\n  useFocusEffect'),
    section('const runScenario', '\n\n  const cancelExecution'),
    section('const cancelExecution', '\n\n  const retryPolling'),
    section('const retryPolling', '\n\n  const sendFeedback'),
    section('const sendFeedback', '\n\n  return {')
  ]) {
    assert.match(operation, /const expectedFocusGeneration = focusGenerationRef\.current/);
    assert.match(
      operation,
      /ownsIdentity\([^)]*expectedFocusGeneration\)/,
      'each async operation must reject results from an earlier focus lifetime'
    );
  }
});

test('stale operation finalizers cannot clear a newer flight busy state', () => {
  const startFlow = section('const runScenario', '\n\n  const cancelExecution');
  assert.match(
    startFlow,
    /if \(startFlightsRef\.current\.get\(scenarioId\) === flight\) \{[\s\S]*setStartingScenarios/
  );

  const cancelFlow = section('const cancelExecution', '\n\n  const retryPolling');
  assert.match(
    cancelFlow,
    /if \(cancellationFlightsRef\.current\.get\(executionId\) === flight\) \{[\s\S]*setCancellingExecutions/
  );

  const refreshFlow = section('const retryPolling', '\n\n  const sendFeedback');
  assert.match(
    refreshFlow,
    /if \(statusRefreshFlightsRef\.current\.get\(executionId\) === flight\) \{[\s\S]*setRefreshingExecutions/
  );

  const feedbackFlow = section('const sendFeedback', '\n\n  return {');
  assert.match(
    feedbackFlow,
    /if \(feedbackInFlightRef\.current === flight\) \{[\s\S]*setFeedbackBusy\(false\)/
  );
});
