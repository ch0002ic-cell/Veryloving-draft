import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import {
  cancelScenarioExecution,
  createScenarioIntent,
  getScenarioExecution,
  pollScenarioExecution,
  reconcileScenarioExecutions,
  startScenario,
  submitScenarioFeedback
} from '../services/ai-native-scenarios';
import {
  loadScenarioActivity,
  MAX_SCENARIO_FEEDBACK
} from '../services/scenario-activity-store';
import { withTimeout } from '../utils/async';
import { logger } from '../utils/logger';

const TERMINAL_STATES = new Set(['completed', 'fallback_completed', 'failed', 'cancelled']);
const FEEDBACK_STATES = new Set(['completed', 'fallback_completed']);
const MAX_RESUMED_POLLS = 5;
const LOCAL_ACTIVITY_TIMEOUT_MS = 8_000;
const DEFAULT_POLL_POLICY = Object.freeze({ intervalMs: 1_000, pollTimeoutMs: 2 * 60_000 });
const SCENARIO_POLL_POLICIES = Object.freeze({
  medication_adherence: Object.freeze({ intervalMs: 5_000, pollTimeoutMs: 22 * 60_000 })
});

function newestFirst(left, right) {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
}

function mergeExecution(current, execution) {
  const existing = current.find((item) => item.executionId === execution.executionId);
  if (existing && (
    execution.updatedAt < existing.updatedAt
    || (execution.updatedAt === existing.updatedAt && execution.version < existing.version)
    || (TERMINAL_STATES.has(existing.state) && !TERMINAL_STATES.has(execution.state))
  )) return current;
  return [
    execution,
    ...current.filter((item) => item.executionId !== execution.executionId)
  ].sort(newestFirst);
}

function safeErrorCode(error, fallback) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code)
    ? error.code
    : fallback;
}

function updateServiceFailure(error, setServiceStatus) {
  if (['SCENARIO_NETWORK_ERROR', 'SCENARIO_TIMEOUT'].includes(error?.code)) {
    setServiceStatus('unreachable');
  } else if (error?.code === 'SCENARIO_NOT_CONFIGURED') {
    setServiceStatus('unavailable');
  }
}

/**
 * Owns the mobile lifecycle of a user-started scenario. Polling is bounded,
 * aborts on unmount/account switch, and resumes recent non-terminal work after
 * navigation or process restoration. Device identities never come from UI.
 */
export function useScenarioRunner() {
  const { accessToken, isDemoMode, user } = useAuth();
  const accountId = user?.id || null;
  const [activity, setActivity] = useState({ executions: [], feedback: [] });
  const [loading, setLoading] = useState(true);
  const [startingScenarios, setStartingScenarios] = useState([]);
  const [cancellingExecutions, setCancellingExecutions] = useState([]);
  const [refreshingExecutions, setRefreshingExecutions] = useState([]);
  const [scenarioError, setScenarioError] = useState(null);
  const [feedbackQueue, setFeedbackQueue] = useState([]);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackErrorCode, setFeedbackErrorCode] = useState(null);
  const [serviceStatus, setServiceStatus] = useState('unknown');
  const controllersRef = useRef(new Map());
  const operationControllersRef = useRef(new Set());
  const retryIntentsRef = useRef(new Map());
  const startFlightsRef = useRef(new Map());
  const cancellationFlightsRef = useRef(new Map());
  const statusRefreshFlightsRef = useRef(new Map());
  const feedbackInFlightRef = useRef(null);
  const refreshGenerationRef = useRef(0);
  const focusGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const activityRef = useRef(activity);
  const identityRef = useRef({ accountId, accessToken });
  identityRef.current = { accountId, accessToken };
  const feedbackTarget = feedbackQueue[0] || null;

  const ownsIdentity = useCallback((
    expectedAccountId,
    expectedAccessToken,
    expectedFocusGeneration
  ) => (
    mountedRef.current
    && focusGenerationRef.current === expectedFocusGeneration
    && identityRef.current.accountId === expectedAccountId
    && identityRef.current.accessToken === expectedAccessToken
  ), []);

  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  const publishExecution = useCallback((execution, { inviteFeedback = false } = {}) => {
    if (!mountedRef.current) return;
    const immediate = {
      ...activityRef.current,
      executions: mergeExecution(activityRef.current.executions, execution)
    };
    activityRef.current = immediate;
    setActivity((current) => {
      const next = { ...current, executions: mergeExecution(current.executions, execution) };
      activityRef.current = next;
      return next;
    });
    if (inviteFeedback && FEEDBACK_STATES.has(execution.state)) {
      const alreadyRated = activityRef.current.feedback.some(
        (item) => item.executionId === execution.executionId
      );
      if (!alreadyRated) {
        setFeedbackQueue((current) => current.some(
          (item) => item.executionId === execution.executionId
        ) ? current : [...current, execution].slice(-10));
      }
    } else if (TERMINAL_STATES.has(execution.state)) {
      // A cancellation/failure can race a terminal polling response. Never
      // leave a rating prompt queued for an execution whose authoritative
      // state is no longer eligible for feedback.
      setFeedbackQueue((current) => current.filter(
        (item) => item.executionId !== execution.executionId
      ));
    }
  }, []);

  const pollExecution = useCallback((executionId, {
    inviteFeedback = true,
    scenarioId: requestedScenarioId
  } = {}) => {
    if (!accountId || !accessToken || controllersRef.current.has(executionId)) return;
    const expectedAccountId = accountId;
    const expectedAccessToken = accessToken;
    const expectedFocusGeneration = focusGenerationRef.current;
    const controller = new AbortController();
    controllersRef.current.set(executionId, controller);
    const scenarioId = requestedScenarioId || activityRef.current.executions.find(
      (item) => item.executionId === executionId
    )?.scenarioId;
    const pollPolicy = SCENARIO_POLL_POLICIES[scenarioId] || DEFAULT_POLL_POLICY;
    pollScenarioExecution({
      accountId,
      accessToken,
      executionId,
      onUpdate: (execution) => {
        if (ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
          setServiceStatus('reachable');
          publishExecution(execution);
        }
      }
    }, { ...pollPolicy, signal: controller.signal }).then((execution) => {
      if (ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
        setServiceStatus('reachable');
        publishExecution(execution, { inviteFeedback });
      }
    }).catch((error) => {
      if (error?.code !== 'SCENARIO_CANCELLED'
        && ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
        updateServiceFailure(error, setServiceStatus);
        setScenarioError({
          code: safeErrorCode(error, 'SCENARIO_STATUS_FAILED'),
          executionId,
          scenarioId: scenarioId || null,
          operation: 'status'
        });
      }
    }).finally(() => {
      if (controllersRef.current.get(executionId) === controller) {
        controllersRef.current.delete(executionId);
      }
    });
  }, [accessToken, accountId, ownsIdentity, publishExecution]);

  const refreshActivity = useCallback(async () => {
    const expectedFocusGeneration = focusGenerationRef.current;
    if (!mountedRef.current) return activityRef.current;
    const generation = ++refreshGenerationRef.current;
    if (!accountId) {
      const empty = { executions: [], feedback: [] };
      activityRef.current = empty;
      setActivity(empty);
      setLoading(false);
      return { executions: [], feedback: [] };
    }
    setLoading(true);
    setScenarioError(null);
    let localActivity = { executions: [], feedback: [] };
    try {
      localActivity = await withTimeout(
        loadScenarioActivity(accountId),
        LOCAL_ACTIVITY_TIMEOUT_MS,
        'Scenario activity restoration timed out.'
      );
    } catch (error) {
      if (ownsIdentity(accountId, accessToken, expectedFocusGeneration)
        && generation === refreshGenerationRef.current) {
        setScenarioError({
          code: safeErrorCode(error, 'SCENARIO_HISTORY_FAILED'),
          executionId: null,
          scenarioId: null,
          operation: 'history'
        });
      }
    }
    if (!ownsIdentity(accountId, accessToken, expectedFocusGeneration)
      || generation !== refreshGenerationRef.current) return localActivity;
    activityRef.current = localActivity;
    setActivity(localActivity);
    setLoading(false);
    if (!accessToken) return localActivity;

    const controller = new AbortController();
    operationControllersRef.current.add(controller);
    setServiceStatus((current) => current === 'reachable' ? current : 'checking');
    try {
      const remote = await reconcileScenarioExecutions({ accountId, accessToken }, {
        signal: controller.signal
      });
      if (!ownsIdentity(accountId, accessToken, expectedFocusGeneration)
        || generation !== refreshGenerationRef.current) return localActivity;
      setServiceStatus('reachable');
      setScenarioError(null);
      const authoritative = [...remote.executions, ...remote.reconciled];
      authoritative.forEach((execution) => publishExecution(execution));
      authoritative
        .filter((execution) => !TERMINAL_STATES.has(execution.state))
        .sort(newestFirst)
        .slice(0, MAX_RESUMED_POLLS)
        .forEach((execution) => pollExecution(execution.executionId, {
          scenarioId: execution.scenarioId
        }));
      return { executions: authoritative, feedback: localActivity.feedback };
    } catch (error) {
      if (error?.code !== 'SCENARIO_CANCELLED'
        && ownsIdentity(accountId, accessToken, expectedFocusGeneration)
        && generation === refreshGenerationRef.current) {
        updateServiceFailure(error, setServiceStatus);
        setScenarioError({
          code: safeErrorCode(error, 'SCENARIO_HISTORY_FAILED'),
          executionId: null,
          scenarioId: null,
          operation: 'history'
        });
      }
      return localActivity;
    } finally {
      operationControllersRef.current.delete(controller);
    }
  }, [accessToken, accountId, ownsIdentity, pollExecution, publishExecution]);

  useFocusEffect(useCallback(() => {
    const focusGeneration = ++focusGenerationRef.current;
    mountedRef.current = true;
    setStartingScenarios([]);
    setCancellingExecutions([]);
    setRefreshingExecutions([]);
    setFeedbackQueue([]);
    setFeedbackBusy(false);
    setFeedbackErrorCode(null);
    setServiceStatus(accountId && accessToken ? 'unknown' : 'offline');
    refreshActivity();
    return () => {
      if (focusGenerationRef.current !== focusGeneration) return;
      mountedRef.current = false;
      focusGenerationRef.current += 1;
      setFeedbackQueue([]);
      setFeedbackBusy(false);
      setFeedbackErrorCode(null);
      for (const controller of controllersRef.current.values()) controller.abort();
      controllersRef.current.clear();
      for (const controller of operationControllersRef.current) controller.abort();
      operationControllersRef.current.clear();
      retryIntentsRef.current.clear();
      startFlightsRef.current.clear();
      cancellationFlightsRef.current.clear();
      statusRefreshFlightsRef.current.clear();
      feedbackInFlightRef.current = null;
      refreshGenerationRef.current += 1;
    };
  }, [accessToken, accountId, refreshActivity]));

  const runScenario = useCallback(async (scenarioId, { context } = {}) => {
    if (!accountId || !accessToken) {
      setScenarioError({
        code: isDemoMode ? 'SCENARIO_DEMO_OFFLINE' : 'SCENARIO_AUTHENTICATION_REQUIRED',
        executionId: null,
        scenarioId,
        operation: 'start'
      });
      return null;
    }
    if (startFlightsRef.current.has(scenarioId)) return null;
    if (activityRef.current.executions.some((execution) => (
      execution.scenarioId === scenarioId && !TERMINAL_STATES.has(execution.state)
    ))) return null;
    const expectedAccountId = accountId;
    const expectedAccessToken = accessToken;
    const expectedFocusGeneration = focusGenerationRef.current;
    const controller = new AbortController();
    const flight = { scenarioId, controller };
    operationControllersRef.current.add(controller);
    startFlightsRef.current.set(scenarioId, flight);
    setStartingScenarios((current) => current.includes(scenarioId)
      ? current
      : [...current, scenarioId]);
    setScenarioError(null);
    setServiceStatus((current) => current === 'reachable' ? current : 'checking');
    let contextKey;
    let retryEntry;
    let intent;
    try {
      contextKey = JSON.stringify(context ?? null);
      retryEntry = retryIntentsRef.current.get(scenarioId);
      intent = retryEntry?.contextKey === contextKey ? retryEntry.intent : null;
      if (!intent) {
        intent = createScenarioIntent(scenarioId);
        retryEntry = { contextKey, intent };
        retryIntentsRef.current.set(scenarioId, retryEntry);
      }
      const result = await startScenario({
        accountId,
        accessToken,
        scenarioId,
        scenarioIntent: intent,
        ...(context ? { context } : {})
      }, { signal: controller.signal });
      if (!ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) return null;
      setServiceStatus('reachable');
      retryIntentsRef.current.delete(scenarioId);
      for (const item of result.started) {
        publishExecution(item.execution, {
          inviteFeedback: TERMINAL_STATES.has(item.execution.state)
        });
        if (!TERMINAL_STATES.has(item.execution.state)) {
          pollExecution(item.execution.executionId, { scenarioId: item.execution.scenarioId });
        }
      }
      return result;
    } catch (error) {
      if (error?.code === 'SCENARIO_CANCELLED'
        || !ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) return null;
      logger.recoverable('[Scenarios] User-started scenario request failed', {
        errorCode: safeErrorCode(error, 'SCENARIO_START_FAILED'),
        scenarioId
      });
      updateServiceFailure(error, setServiceStatus);
      setScenarioError({
        code: safeErrorCode(error, 'SCENARIO_START_FAILED'),
        executionId: null,
        scenarioId,
        operation: 'start'
      });
      return null;
    } finally {
      operationControllersRef.current.delete(controller);
      if (startFlightsRef.current.get(scenarioId) === flight) {
        startFlightsRef.current.delete(scenarioId);
        if (ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
          setStartingScenarios((current) => current.filter((item) => item !== scenarioId));
        }
      }
    }
  }, [accessToken, accountId, isDemoMode, ownsIdentity, pollExecution, publishExecution]);

  const cancelExecution = useCallback(async (executionId) => {
    if (!accountId || !accessToken) {
      setScenarioError({
        code: 'SCENARIO_AUTHENTICATION_REQUIRED',
        executionId,
        scenarioId: activityRef.current.executions.find(
          (item) => item.executionId === executionId
        )?.scenarioId || null,
        operation: 'cancel'
      });
      return null;
    }
    if (cancellationFlightsRef.current.has(executionId)) return null;
    const expectedAccountId = accountId;
    const expectedAccessToken = accessToken;
    const expectedFocusGeneration = focusGenerationRef.current;
    const controller = new AbortController();
    const flight = { controller, executionId };
    operationControllersRef.current.add(controller);
    cancellationFlightsRef.current.set(executionId, flight);
    setCancellingExecutions((current) => current.includes(executionId)
      ? current
      : [...current, executionId]);
    setScenarioError(null);
    try {
      const execution = await cancelScenarioExecution(
        { accountId, accessToken, executionId },
        { signal: controller.signal }
      );
      if (!ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) return null;
      // Keep status polling alive while cancellation is in flight so a failed
      // cancellation does not strand the UI. Once cancellation is accepted,
      // stop the redundant poll before publishing the terminal snapshot.
      controllersRef.current.get(executionId)?.abort();
      setServiceStatus('reachable');
      publishExecution(execution);
      return execution;
    } catch (error) {
      if (error?.code !== 'SCENARIO_CANCELLED'
        && ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
        updateServiceFailure(error, setServiceStatus);
        setScenarioError({
          code: safeErrorCode(error, 'SCENARIO_CANCEL_FAILED'),
          executionId,
          scenarioId: activityRef.current.executions.find(
            (item) => item.executionId === executionId
          )?.scenarioId || null,
          operation: 'cancel'
        });
      }
      return null;
    } finally {
      operationControllersRef.current.delete(controller);
      if (cancellationFlightsRef.current.get(executionId) === flight) {
        cancellationFlightsRef.current.delete(executionId);
        if (ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
          setCancellingExecutions((current) => current.filter((item) => item !== executionId));
        }
      }
    }
  }, [accessToken, accountId, ownsIdentity, publishExecution]);

  const retryPolling = useCallback(async (executionId) => {
    if (!accountId || !accessToken || statusRefreshFlightsRef.current.has(executionId)) {
      return null;
    }
    const execution = activityRef.current.executions.find(
      (item) => item.executionId === executionId
    );
    if (!execution) return null;
    const expectedAccountId = accountId;
    const expectedAccessToken = accessToken;
    const expectedFocusGeneration = focusGenerationRef.current;
    const controller = new AbortController();
    const flight = { controller, executionId };
    statusRefreshFlightsRef.current.set(executionId, flight);
    operationControllersRef.current.add(controller);
    setRefreshingExecutions((current) => current.includes(executionId)
      ? current
      : [...current, executionId]);
    setScenarioError(null);
    try {
      const refreshed = await getScenarioExecution({
        accountId,
        accessToken,
        executionId
      }, { signal: controller.signal });
      if (!ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) return null;
      setServiceStatus('reachable');
      if (TERMINAL_STATES.has(refreshed.state)) {
        controllersRef.current.get(executionId)?.abort();
      }
      publishExecution(refreshed, { inviteFeedback: TERMINAL_STATES.has(refreshed.state) });
      if (!TERMINAL_STATES.has(refreshed.state)
        && !controllersRef.current.has(executionId)) {
        pollExecution(executionId, { scenarioId: refreshed.scenarioId });
      }
      return refreshed;
    } catch (error) {
      if (error?.code !== 'SCENARIO_CANCELLED'
        && ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
        updateServiceFailure(error, setServiceStatus);
        setScenarioError({
          code: safeErrorCode(error, 'SCENARIO_STATUS_FAILED'),
          executionId,
          scenarioId: execution.scenarioId,
          operation: 'status'
        });
      }
      return null;
    } finally {
      operationControllersRef.current.delete(controller);
      if (statusRefreshFlightsRef.current.get(executionId) === flight) {
        statusRefreshFlightsRef.current.delete(executionId);
        if (ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
          setRefreshingExecutions((current) => current.filter((item) => item !== executionId));
        }
      }
    }
  }, [accessToken, accountId, ownsIdentity, pollExecution, publishExecution]);

  const sendFeedback = useCallback(async (rating) => {
    if (!feedbackTarget || !accountId || !accessToken || feedbackInFlightRef.current) return false;
    const expectedAccountId = accountId;
    const expectedAccessToken = accessToken;
    const expectedFocusGeneration = focusGenerationRef.current;
    const controller = new AbortController();
    const flight = { controller, executionId: feedbackTarget.executionId };
    operationControllersRef.current.add(controller);
    feedbackInFlightRef.current = flight;
    setFeedbackBusy(true);
    setFeedbackErrorCode(null);
    const recordedAt = Date.now();
    try {
      await submitScenarioFeedback({
        accountId,
        accessToken,
        executionId: feedbackTarget.executionId,
        rating,
        occurredAt: recordedAt
      }, { signal: controller.signal });
      if (!ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) return false;
      setServiceStatus('reachable');
      setActivity((current) => {
        const optimisticFeedback = {
          executionId: feedbackTarget.executionId,
          scenarioId: feedbackTarget.scenarioId,
          rating,
          recordedAt
        };
        const next = {
          ...current,
          feedback: [optimisticFeedback, ...current.feedback.filter(
            (item) => item.executionId !== feedbackTarget.executionId
          )].slice(0, MAX_SCENARIO_FEEDBACK)
        };
        activityRef.current = next;
        return next;
      });
      setFeedbackQueue((current) => current.filter(
        (item) => item.executionId !== feedbackTarget.executionId
      ));
      return true;
    } catch (error) {
      if (error?.code !== 'SCENARIO_CANCELLED'
        && ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
        updateServiceFailure(error, setServiceStatus);
        setFeedbackErrorCode(safeErrorCode(error, 'SCENARIO_FEEDBACK_FAILED'));
      }
      return false;
    } finally {
      operationControllersRef.current.delete(controller);
      if (feedbackInFlightRef.current === flight) {
        feedbackInFlightRef.current = null;
        if (ownsIdentity(expectedAccountId, expectedAccessToken, expectedFocusGeneration)) {
          setFeedbackBusy(false);
        }
      }
    }
  }, [accessToken, accountId, feedbackTarget, ownsIdentity]);

  return {
    loading,
    errorCode: scenarioError?.code || null,
    scenarioError,
    clearError: () => setScenarioError(null),
    executions: activity.executions,
    feedback: activity.feedback,
    startingScenario: startingScenarios[0] || null,
    startingScenarios,
    isStartingScenario: (scenarioId) => startingScenarios.includes(scenarioId),
    cancellingExecutions,
    isCancellingExecution: (executionId) => cancellingExecutions.includes(executionId),
    refreshingExecutions,
    isRefreshingExecution: (executionId) => refreshingExecutions.includes(executionId),
    runScenario,
    cancelExecution,
    retryPolling,
    refreshActivity,
    connected: Boolean(accountId && accessToken),
    serviceStatus,
    isDemoMode,
    feedbackTarget,
    feedbackBusy,
    feedbackErrorCode,
    sendFeedback,
    dismissFeedback: () => {
      if (!feedbackBusy) {
        setFeedbackQueue((current) => current.slice(1));
        setFeedbackErrorCode(null);
      }
    }
  };
}
