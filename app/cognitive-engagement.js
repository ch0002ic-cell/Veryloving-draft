import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ActionTile } from '../src/components/ActionTile';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { Header } from '../src/components/Header';
import { InteractionFeedbackModal } from '../src/components/InteractionFeedbackModal';
import { ScenarioStatusCard } from '../src/components/ScenarioStatusCard';
import { Screen } from '../src/components/Screen';
import { SkeletonGroup, SkeletonText } from '../src/components/Skeleton';
import { Snackbar } from '../src/components/Snackbar';
import { colors, radii, spacing, tones, typography } from '../src/constants/theme';
import { useAuth } from '../src/context/AuthContext';
import { useI18n } from '../src/context/I18nContext';
import { useScenarioRunner } from '../src/hooks/useScenarioRunner';

const MEMORY_ROUNDS = Object.freeze([
  Object.freeze({
    sequence: Object.freeze(['🍎', '🌙', '🔑']),
    choices: Object.freeze(['🔑', '🍎', '🌙']),
    answer: '🌙'
  }),
  Object.freeze({
    sequence: Object.freeze(['🐕', '🌵', '🎈']),
    choices: Object.freeze(['🌵', '🎈', '🐕']),
    answer: '🌵'
  }),
  Object.freeze({
    sequence: Object.freeze(['🎵', '☕', '📘']),
    choices: Object.freeze(['📘', '☕', '🎵']),
    answer: '☕'
  })
]);

const TRIVIA_ROUNDS = Object.freeze([
  Object.freeze({ key: 'one', choices: Object.freeze(['blue', 'green', 'red']), answer: 'blue' }),
  Object.freeze({ key: 'two', choices: Object.freeze(['heart', 'lungs', 'skin']), answer: 'skin' }),
  Object.freeze({ key: 'three', choices: Object.freeze(['seven', 'eight', 'nine']), answer: 'seven' })
]);

const CONVERSATION_PROMPTS = Object.freeze(['one', 'two', 'three', 'four']);

function nextIndex(current, length) {
  return (current + 1) % length;
}

export default function CognitiveEngagement() {
  const { accessToken, isDemoMode, user } = useAuth();
  const { isRTL, t } = useI18n();
  const {
    cancelExecution,
    clearError,
    executions,
    feedbackBusy,
    feedbackErrorCode,
    feedbackTarget,
    dismissFeedback,
    loading,
    refreshActivity,
    isCancellingExecution,
    isRefreshingExecution,
    isStartingScenario,
    retryPolling,
    runScenario,
    scenarioError,
    sendFeedback
  } = useScenarioRunner();
  const [activity, setActivity] = useState(null);
  const [memoryRound, setMemoryRound] = useState(0);
  const [memoryPhase, setMemoryPhase] = useState('preview');
  const [memoryResult, setMemoryResult] = useState(null);
  const [triviaRound, setTriviaRound] = useState(0);
  const [triviaResult, setTriviaResult] = useState(null);
  const [conversationPrompt, setConversationPrompt] = useState(0);
  const [snackbar, setSnackbar] = useState(null);
  const accountId = user?.id || null;
  const accountIdRef = useRef(accountId);
  const accountEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const feedbackReturnRef = useRef(null);
  const [screenAccountId, setScreenAccountId] = useState(accountId);
  accountIdRef.current = accountId;
  const accountAligned = screenAccountId === accountId;
  const visibleActivity = accountAligned ? activity : null;
  const connectedCareAvailable = Boolean(user?.id && accessToken && !isDemoMode);
  const latestExecution = useMemo(() => executions.find(
    ({ scenarioId }) => scenarioId === 'cognitive_engagement'
  ), [executions]);
  const scenarioActive = ['queued', 'running'].includes(latestExecution?.state);
  const scopedScenarioError = scenarioError?.operation === 'history'
    || scenarioError?.scenarioId === 'cognitive_engagement'
    ? scenarioError
    : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    accountEpochRef.current += 1;
    setScreenAccountId(accountId);
    setActivity(null);
    setMemoryRound(0);
    setMemoryPhase('preview');
    setMemoryResult(null);
    setTriviaRound(0);
    setTriviaResult(null);
    setConversationPrompt(0);
    setSnackbar(null);
  }, [accountId]);

  const chooseActivity = (nextActivity) => {
    setActivity(nextActivity);
    setMemoryPhase('preview');
    setMemoryResult(null);
    setTriviaResult(null);
  };

  const answerMemory = (answer) => {
    const correct = answer === MEMORY_ROUNDS[memoryRound].answer;
    setMemoryResult(correct ? 'correct' : 'incorrect');
  };

  const nextMemoryRound = () => {
    setMemoryRound((current) => nextIndex(current, MEMORY_ROUNDS.length));
    setMemoryPhase('preview');
    setMemoryResult(null);
  };

  const answerTrivia = (answer) => {
    const correct = answer === TRIVIA_ROUNDS[triviaRound].answer;
    setTriviaResult(correct ? 'correct' : 'incorrect');
  };

  const nextTriviaRound = () => {
    setTriviaRound((current) => nextIndex(current, TRIVIA_ROUNDS.length));
    setTriviaResult(null);
  };

  const startCompanionActivity = async () => {
    if (!connectedCareAvailable || !accountAligned || !visibleActivity) return;
    const operationAccountId = accountId;
    const operationEpoch = accountEpochRef.current;
    try {
      const result = await runScenario('cognitive_engagement', {
        context: { activity: visibleActivity }
      });
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch
        && result?.started?.length) {
        setSnackbar({ tone: 'success', message: t('wellness.scenarioStarted') });
      }
    } catch {
      // The runner logs a redacted diagnostic and publishes a retryable code.
    }
  };

  const rateInteraction = async (rating) => {
    const operationAccountId = accountId;
    const operationEpoch = accountEpochRef.current;
    const recorded = await sendFeedback(rating);
    if (recorded
      && mountedRef.current
      && accountIdRef.current === operationAccountId
      && accountEpochRef.current === operationEpoch) {
      setSnackbar({ tone: 'success', message: t('wellness.feedback.thanks') });
    }
  };

  const retryScenarioError = () => {
    if (scopedScenarioError?.operation === 'history') return refreshActivity();
    if (scopedScenarioError?.operation === 'status'
      && scopedScenarioError.executionId
      && latestExecution?.executionId === scopedScenarioError.executionId) {
      return retryPolling(scopedScenarioError.executionId);
    }
    if (scopedScenarioError?.operation === 'cancel'
      && scopedScenarioError.executionId
      && latestExecution?.executionId === scopedScenarioError.executionId) {
      return cancelExecution(scopedScenarioError.executionId);
    }
    if (scopedScenarioError?.operation === 'start') return startCompanionActivity();
    return refreshActivity();
  };

  const memory = MEMORY_ROUNDS[memoryRound];
  const trivia = TRIVIA_ROUNDS[triviaRound];

  return (
    <Screen>
      <Header
        eyebrow={t('wellness.cognitive.eyebrow')}
        title={t('wellness.cognitive.title')}
        subtitle={t('wellness.cognitive.subtitle')}
        showBack
        backLabel={t('common.back')}
      />

      <Card variant="tinted" style={styles.connectedCard}>
        <View style={styles.sectionCopy}>
          <Text
            accessibilityRole="header"
            ref={feedbackReturnRef}
            style={[styles.sectionTitle, isRTL && styles.rtlText]}
          >
            {t('wellness.cognitive.connectedTitle')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {t('wellness.cognitive.connectedBody')}
          </Text>
        </View>
        {!connectedCareAvailable ? (
          <FeedbackBanner message={t('wellness.connectedCareUnavailable')} tone="info" />
        ) : null}
        {connectedCareAvailable && !visibleActivity ? (
          <FeedbackBanner message={t('wellness.cognitive.activitySubtitle')} tone="info" />
        ) : null}
        {accountAligned && scopedScenarioError ? (
          <FeedbackBanner
            message={t('wellness.scenarioFailed')}
            tone="error"
            actionLabel={connectedCareAvailable ? t('common.retry') : undefined}
            onAction={connectedCareAvailable ? retryScenarioError : undefined}
            dismissLabel={t('common.close')}
            onDismiss={clearError}
          />
        ) : null}
        <Button
          accessibilityHint={t('wellness.cognitive.connectedHint')}
          title={t('wellness.cognitive.startCompanion')}
          icon="sparkles-outline"
          variant="orange"
          disabled={!connectedCareAvailable || !accountAligned || !visibleActivity || scenarioActive}
          loading={isStartingScenario('cognitive_engagement')}
          loadingLabel={t('wellness.scenarioStarting')}
          onPress={startCompanionActivity}
        />
        {loading || !accountAligned ? (
          <SkeletonGroup label={t('common.loading')}>
            <SkeletonText lines={2} />
          </SkeletonGroup>
        ) : latestExecution ? (
          <ScenarioStatusCard
            execution={latestExecution}
            cancelling={isCancellingExecution(latestExecution.executionId)}
            refreshing={isRefreshingExecution(latestExecution.executionId)}
            onCancel={cancelExecution}
            onRetryStatus={retryPolling}
          />
        ) : (
          <EmptyState
            compact
            title={t('wellness.scenarios.emptyTitle')}
            message={t('wellness.scenarios.emptyMessage')}
          />
        )}
      </Card>

      <View style={styles.sectionCopy}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
          {t('wellness.cognitive.activityTitle')}
        </Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {t('wellness.cognitive.activitySubtitle')}
        </Text>
      </View>

      <View style={[styles.activityGrid, isRTL && styles.rtlRow]}>
        {['memory', 'trivia', 'conversation'].map((mode) => (
          <ActionTile
            key={mode}
            accessibilityLabel={t(`wellness.cognitive.modes.${mode}.title`)}
            accessibilityHint={t(`wellness.cognitive.modes.${mode}.description`)}
            title={t(`wellness.cognitive.modes.${mode}.title`)}
            description={t(`wellness.cognitive.modes.${mode}.description`)}
            icon={mode === 'memory' ? 'albums-outline' : mode === 'trivia' ? 'bulb-outline' : 'chatbubbles-outline'}
            tone={visibleActivity === mode ? 'safety' : 'default'}
            selected={visibleActivity === mode}
            disabled={!accountAligned}
            onPress={() => chooseActivity(mode)}
            style={styles.activityTile}
          />
        ))}
      </View>

      {!visibleActivity ? (
        <Card padding="sm">
          <EmptyState
            compact
            title={t('wellness.cognitive.emptyTitle')}
            message={t('wellness.cognitive.emptyMessage')}
          />
        </Card>
      ) : null}

      {visibleActivity === 'memory' ? (
        <Card style={styles.exerciseCard}>
          <Text accessibilityRole="header" style={[styles.exerciseTitle, isRTL && styles.rtlText]}>
            {t('wellness.cognitive.memory.title')}
          </Text>
          {memoryPhase === 'preview' ? (
            <>
              <Text style={[styles.body, isRTL && styles.rtlText]}>
                {t('wellness.cognitive.memory.instruction')}
              </Text>
              <Text
                accessibilityLabel={t('wellness.cognitive.memory.sequenceLabel', {
                  sequence: memory.sequence.join(', ')
                })}
                style={styles.memorySequence}
              >
                {memory.sequence.join('   ')}
              </Text>
              <Button
                title={t('wellness.cognitive.memory.ready')}
                variant="secondary"
                onPress={() => setMemoryPhase('question')}
              />
            </>
          ) : (
            <>
              <Text style={[styles.body, isRTL && styles.rtlText]}>
                {t('wellness.cognitive.memory.question')}
              </Text>
              <View style={styles.answerGrid}>
                {memory.choices.map((choice) => (
                  <Button
                    key={choice}
                    accessibilityLabel={`${t('wellness.cognitive.memory.answerLabel', { answer: choice })}${memoryResult && choice === memory.answer
                      ? `, ${t('wellness.cognitive.memory.correct')}`
                      : ''}`}
                    title={choice}
                    icon={memoryResult && choice === memory.answer ? 'checkmark-circle-outline' : undefined}
                    variant={memoryResult && choice === memory.answer ? 'success' : 'ghost'}
                    disabled={Boolean(memoryResult)}
                    onPress={() => answerMemory(choice)}
                    style={styles.answerButton}
                  />
                ))}
              </View>
              <FeedbackBanner
                message={memoryResult ? t(`wellness.cognitive.memory.${memoryResult}`) : null}
                tone={memoryResult === 'correct' ? 'success' : 'info'}
              />
              {memoryResult ? (
                <Button
                  title={t('wellness.cognitive.nextRound')}
                  icon="arrow-forward-outline"
                  iconPosition="trailing"
                  onPress={nextMemoryRound}
                />
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {visibleActivity === 'trivia' ? (
        <Card style={styles.exerciseCard}>
          <Text accessibilityRole="header" style={[styles.exerciseTitle, isRTL && styles.rtlText]}>
            {t('wellness.cognitive.trivia.title')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {t(`wellness.cognitive.trivia.questions.${trivia.key}.prompt`)}
          </Text>
          <View style={styles.answerStack}>
            {trivia.choices.map((choice) => (
              <Button
                key={choice}
                accessibilityLabel={`${t(`wellness.cognitive.trivia.questions.${trivia.key}.choices.${choice}`)}${triviaResult && choice === trivia.answer
                  ? `, ${t('wellness.cognitive.trivia.correct')}`
                  : ''}`}
                title={t(`wellness.cognitive.trivia.questions.${trivia.key}.choices.${choice}`)}
                icon={triviaResult && choice === trivia.answer ? 'checkmark-circle-outline' : undefined}
                variant={triviaResult && choice === trivia.answer ? 'success' : 'ghost'}
                disabled={Boolean(triviaResult)}
                onPress={() => answerTrivia(choice)}
              />
            ))}
          </View>
          <FeedbackBanner
            message={triviaResult ? t(`wellness.cognitive.trivia.${triviaResult}`) : null}
            tone={triviaResult === 'correct' ? 'success' : 'info'}
          />
          {triviaResult ? (
            <Button
              title={t('wellness.cognitive.nextRound')}
              icon="arrow-forward-outline"
              iconPosition="trailing"
              onPress={nextTriviaRound}
            />
          ) : null}
        </Card>
      ) : null}

      {visibleActivity === 'conversation' ? (
        <Card variant="raised" style={styles.exerciseCard}>
          <Text accessibilityRole="header" style={[styles.exerciseTitle, isRTL && styles.rtlText]}>
            {t('wellness.cognitive.conversation.title')}
          </Text>
          <View style={styles.promptCard}>
            <Text style={[styles.prompt, isRTL && styles.rtlText]}>
              {t(`wellness.cognitive.conversation.prompts.${CONVERSATION_PROMPTS[conversationPrompt]}`)}
            </Text>
          </View>
          <Button
            title={t('wellness.cognitive.conversation.another')}
            icon="refresh-outline"
            variant="secondary"
            onPress={() => setConversationPrompt((current) => (
              nextIndex(current, CONVERSATION_PROMPTS.length)
            ))}
          />
        </Card>
      ) : null}

      <Snackbar
        message={accountAligned ? snackbar?.message : null}
        tone={snackbar?.tone}
        onDismiss={() => setSnackbar(null)}
      />
      <InteractionFeedbackModal
        visible={accountAligned && feedbackTarget?.scenarioId === 'cognitive_engagement'}
        interactionName={feedbackTarget?.scenarioId === 'cognitive_engagement'
          ? t(`wellness.scenarios.names.${feedbackTarget.scenarioId}`)
          : t('wellness.cognitive.title')}
        busy={feedbackBusy}
        error={Boolean(feedbackErrorCode)}
        onRate={rateInteraction}
        onDismiss={dismissFeedback}
        returnFocusRef={feedbackReturnRef}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  connectedCard: { gap: spacing.md },
  sectionCopy: { gap: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.textPrimary },
  exerciseTitle: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  rtlText: { textAlign: 'right' },
  rtlRow: { flexDirection: 'row-reverse' },
  activityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activityTile: { minWidth: 208, flexBasis: '31%', flexGrow: 1 },
  exerciseCard: { gap: spacing.md },
  memorySequence: {
    ...typography.displayLarge,
    color: colors.textPrimary,
    letterSpacing: spacing.xs,
    textAlign: 'center',
    paddingVertical: spacing.lg
  },
  answerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  answerButton: { minWidth: 88, flex: 1 },
  answerStack: { gap: spacing.sm },
  promptCard: {
    padding: spacing.lg,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: tones.info.border,
    backgroundColor: tones.info.background
  },
  prompt: { ...typography.titleLarge, color: tones.info.foreground, textAlign: 'center' }
});
