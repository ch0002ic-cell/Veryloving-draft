'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = (relativePath) => readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('cognitive engagement offers three local exercises and an honest connected scenario', () => {
  const screen = source('app/cognitive-engagement.js');

  assert.match(screen, /const MEMORY_ROUNDS = Object\.freeze/);
  assert.match(screen, /choices: Object\.freeze/);
  assert.match(screen, /memory\.choices\.map/);
  assert.match(screen, /const TRIVIA_ROUNDS = Object\.freeze/);
  assert.match(screen, /const CONVERSATION_PROMPTS = Object\.freeze/);
  assert.match(screen, /\['memory', 'trivia', 'conversation'\]\.map/);
  assert.match(screen, /runScenario\('cognitive_engagement', \{[\s\S]*context: \{ activity: visibleActivity \}/);
  assert.match(screen, /connectedCareAvailable = Boolean\(user\?\.id && accessToken && !isDemoMode\)/);
  assert.match(screen, /scenarioActive = \['queued', 'running'\]\.includes/);
  assert.match(screen, /disabled=\{!connectedCareAvailable \|\| !accountAligned \|\| !visibleActivity \|\| scenarioActive\}/);
  assert.match(screen, /wellness\.connectedCareUnavailable/);
  assert.match(screen, /<ScenarioStatusCard/);
  assert.match(screen, /<InteractionFeedbackModal/);
  assert.match(screen, /selected=\{visibleActivity === mode\}/);
  assert.match(screen, /mountedRef\.current = true;[\s\S]*mountedRef\.current = false/);
  assert.match(screen, /accountEpochRef\.current \+= 1/);
  assert.match(screen, /accountIdRef\.current === operationAccountId/);
  assert.match(screen, /scenarioError\?\.scenarioId === 'cognitive_engagement'/);
  assert.match(screen, /isStartingScenario\('cognitive_engagement'\)/);
  assert.match(screen, /isCancellingExecution\(latestExecution\.executionId\)/);
  assert.match(screen, /spacing\.|typography\.|colors\.|tones\.|radii\./);
  assert.doesNotMatch(screen, /#[0-9A-Fa-f]{3,8}|rgba?\(/);
});

test('emotional check-in stores bounded private summaries and supports Hume scenario status', () => {
  const screen = source('app/emotional-check-in.js');

  assert.match(screen, /MOOD_OPTIONS\.map/);
  assert.match(screen, /MAX_REFLECTION_SUMMARY_LENGTH/);
  assert.match(screen, /saveMoodCheckIn\(operationAccountId/);
  assert.match(screen, /listMoodCheckIns\(operationAccountId\)/);
  assert.match(screen, /deleteMoodCheckIn\(operationAccountId, checkInId\)/);
  assert.match(screen, /runScenario\('emotional_check_in', \{ context: consentedContext \}\)/);
  assert.match(screen, /connectedCareAvailable = Boolean\(user\?\.id && accessToken && !isDemoMode\)/);
  assert.match(screen, /scenarioActive = \['queued', 'running'\]\.includes/);
  assert.match(screen, /disabled=\{!connectedCareAvailable \|\| !accountAligned \|\| !consentedContext \|\| scenarioActive\}/);
  assert.match(screen, /<SkeletonGroup/);
  assert.match(screen, /<EmptyState/);
  assert.match(screen, /<ScenarioStatusCard/);
  assert.match(screen, /<InteractionFeedbackModal/);
  assert.match(screen, /history\.slice\(0, visibleHistoryCount\)/);
  assert.match(screen, /Math\.min\(history\.length, current \+ HISTORY_PAGE_SIZE\)/);
  assert.match(screen, /actionLabel=\{t\('common\.retry'\)\}/);
  assert.match(screen, /accessibilityRole="radiogroup"/);
  assert.match(screen, /accessibilityState=\{\{ checked: selected, disabled: saving \|\| !accountAligned \}\}/);
  assert.match(screen, /mountedRef\.current = true;[\s\S]*mountedRef\.current = false/);
  assert.match(screen, /accountEpochRef\.current \+= 1/);
  assert.match(screen, /accountIdRef\.current === operationAccountId/);
  assert.match(screen, /saveFlightRef\.current/);
  assert.match(screen, /deleteFlightRef\.current/);
  assert.match(screen, /scenarioError\?\.scenarioId === 'emotional_check_in'/);
  assert.match(screen, /mood_key: selectedMood\.key/);
  assert.match(screen, /reflection_summary: normalizedReflectionSummary/);
  assert.match(screen, /wellness\.emotional\.humeContextNotice/);
  assert.match(screen, /isStartingScenario\('emotional_check_in'\)/);
  assert.match(screen, /isCancellingExecution\(latestExecution\.executionId\)/);
  assert.doesNotMatch(screen, /#[0-9A-Fa-f]{3,8}|rgba?\(/);
});

test('scenario and voice feedback remain reachable, bounded, and race-safe', () => {
  const runner = source('src/hooks/useScenarioRunner.js');
  const statusCard = source('src/components/ScenarioStatusCard.js');
  const feedbackModal = source('src/components/InteractionFeedbackModal.js');
  const safetyCall = source('app/safety-call.js');

  assert.match(runner, /startFlightsRef\.current/);
  assert.match(runner, /startFlightsRef\.current\.has\(scenarioId\)/);
  assert.doesNotMatch(runner, /if \(startingScenario\)/);
  assert.match(runner, /feedbackInFlightRef\.current/);
  assert.match(runner, /refreshGenerationRef\.current/);
  assert.match(runner, /identityRef\.current = \{ accountId, accessToken \}/);
  assert.match(
    runner,
    /ownsIdentity\(expectedAccountId, expectedAccessToken, expectedFocusGeneration\)/
  );
  assert.match(runner, /controllersRef\.current\.values\(\)/);
  assert.match(runner, /operationControllersRef\.current/);
  assert.match(runner, /statusRefreshFlightsRef\.current/);
  assert.match(runner, /await getScenarioExecution/);
  assert.match(runner, /setRefreshingExecutions/);
  assert.match(runner, /MAX_RESUMED_POLLS = 5/);
  assert.match(runner, /medication_adherence:[\s\S]*pollTimeoutMs: 22 \* 60_000/);
  assert.match(runner, /SCENARIO_POLL_POLICIES\[scenarioId\] \|\| DEFAULT_POLL_POLICY/);
  assert.match(runner, /occurredAt: recordedAt/);
  assert.match(runner, /TERMINAL_STATES\.has\(execution\.state\)[\s\S]*setFeedbackQueue[\s\S]*item\.executionId !== execution\.executionId/);
  const cancelFlow = runner.slice(
    runner.indexOf('const cancelExecution'),
    runner.indexOf('\n\n  const retryPolling')
  );
  assert.ok(
    cancelFlow.indexOf('await cancelScenarioExecution')
      < cancelFlow.indexOf('controllersRef.current.get(executionId)?.abort()'),
    'polling must stay alive until cancellation is accepted'
  );
  assert.doesNotMatch(
    runner.slice(runner.indexOf('const sendFeedback'), runner.indexOf('\n\n  return {', runner.indexOf('const sendFeedback'))),
    /await loadScenarioActivity/
  );
  assert.match(statusCard, /<Card padding="sm" style=\{style\}>/);
  assert.match(statusCard, /accessibilityRole="summary"/);
  assert.match(statusCard, /<Button[\s\S]*onCancel/);
  assert.match(statusCard, /loading=\{refreshing\}/);
  assert.match(statusCard, /disabled=\{cancelling \|\| refreshing\}/);
  assert.doesNotMatch(statusCard, /<Card\s+accessible/);
  assert.match(feedbackModal, /pendingRating === 'up'/);
  assert.match(feedbackModal, /pendingRating === 'down'/);
  assert.match(safetyCall, /submitInteractionFeedback/);
  assert.match(safetyCall, /<InteractionFeedbackModal/);
  assert.match(safetyCall, /completion\?\.interactionFeedbackEligible/);
  assert.match(safetyCall, /accountId: expectedIdentity\.accountId,[\s\S]*interactionId: completion\.interactionId/);
  assert.match(safetyCall, /feedbackInteraction\?\.accountId !== user\.id/);
  assert.match(safetyCall, /interactionId: feedbackInteraction\.interactionId/);
  assert.match(safetyCall, /endCallInFlightRef\.current/);
  assert.match(safetyCall, /feedbackFlightRef\.current/);
  assert.match(safetyCall, /authIdentityRef\.current\.accountId === expectedIdentity\.accountId/);
  assert.match(safetyCall, /\{ signal: controller\.signal \}/);
  assert.match(safetyCall, /controller\.abort\(\)/);
  assert.match(safetyCall, /mountedRef\.current = true;[\s\S]*mountedRef\.current = false/);
  assert.match(safetyCall, /loading=\{endingCall\}/);
  assert.match(safetyCall, /closeAfterCompletionRef\.current/);
  assert.match(safetyCall, /useFocusEffect/);
  assert.match(safetyCall, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(safetyCall, /onPress=\{requestClose\}/);
});

test('voice feedback is gated by a server-acknowledged interaction completion', () => {
  const hook = source('src/hooks/useHumeVoiceCall.js');
  const transport = source('src/services/websocket/hume-evi.js');
  const stop = hook.slice(hook.indexOf('const stop = useCallback'), hook.indexOf('\n\n  const sendText'));

  assert.match(stop, /service\.stopMicrophone\(\)/);
  assert.match(stop, /await service\.completeInteraction\(completedInteractionId\) === true/);
  assert.match(stop, /await service\.disconnect\(\)/);
  assert.match(stop, /interactionFeedbackEligible/);
  assert.match(stop, /interactionIdRef\.current = createConversationSessionId\(\)/);
  assert.match(stop, /interactionId: interactionFeedbackEligible \? completedInteractionId : null/);
  assert.match(hook, /customSessionId: config\.humeWSProxyURL[\s\S]*interactionIdRef\.current[\s\S]*sessionIdRef\.current/);
  assert.match(hook, /loadConversationSession\(sessionIdRef\.current\)/);
  assert.ok(stop.indexOf('completeInteraction') < stop.indexOf('disconnect'));
  assert.match(transport, /pendingInteractionCompletion/);
  assert.match(transport, /type: 'interaction_complete'/);
  assert.match(transport, /case 'interaction_completed'/);
  assert.match(transport, /VOICE_INTERACTION_COMPLETION_TIMEOUT/);
  assert.match(transport, /cancelPendingInteractionCompletion\(\)/);
});
