import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
import { TextField } from '../src/components/TextField';
import { colors, motion, radii, sizes, spacing, tones, typography } from '../src/constants/theme';
import { useAuth } from '../src/context/AuthContext';
import { useI18n } from '../src/context/I18nContext';
import { useScenarioRunner } from '../src/hooks/useScenarioRunner';
import {
  deleteMoodCheckIn,
  listMoodCheckIns,
  MAX_REFLECTION_SUMMARY_LENGTH,
  MOOD_OPTIONS,
  saveMoodCheckIn
} from '../src/services/mood-checkin-store';
import {
  formatLocalizedDateTime,
  formatLocalizedNumber
} from '../src/utils/localized-format';

const MOOD_EMOJI = Object.freeze({
  very_low: '😞',
  low: '😕',
  okay: '😐',
  good: '🙂',
  great: '😄'
});
const HISTORY_PAGE_SIZE = 10;

export default function EmotionalCheckIn() {
  const { accessToken, isDemoMode, user } = useAuth();
  const { isRTL, locale, t } = useI18n();
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
  const [moodKey, setMoodKey] = useState(null);
  const [reflectionSummary, setReflectionSummary] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(HISTORY_PAGE_SIZE);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [lastConsentedContext, setLastConsentedContext] = useState(null);
  const [snackbar, setSnackbar] = useState(null);
  const accountId = user?.id || null;
  const accountIdRef = useRef(accountId);
  const accountEpochRef = useRef(0);
  const historyRequestRef = useRef(0);
  const saveFlightRef = useRef(null);
  const deleteFlightRef = useRef(null);
  const mountedRef = useRef(true);
  const feedbackReturnRef = useRef(null);
  const [screenAccountId, setScreenAccountId] = useState(accountId);
  accountIdRef.current = accountId;
  const accountAligned = screenAccountId === accountId;
  const connectedCareAvailable = Boolean(user?.id && accessToken && !isDemoMode);
  const selectedMood = accountAligned ? MOOD_OPTIONS.find(({ key }) => key === moodKey) : null;
  const normalizedReflectionSummary = reflectionSummary.replace(/\s+/g, ' ').trim();
  const draftContext = selectedMood ? {
    mood_key: selectedMood.key,
    ...(normalizedReflectionSummary ? { reflection_summary: normalizedReflectionSummary } : {})
  } : null;
  const consentedContext = accountAligned
    ? draftContext || (!normalizedReflectionSummary ? lastConsentedContext : null)
    : null;
  const latestExecution = useMemo(() => executions.find(
    ({ scenarioId }) => scenarioId === 'emotional_check_in'
  ), [executions]);
  const scenarioActive = ['queued', 'running'].includes(latestExecution?.state);
  const scopedScenarioError = scenarioError?.operation === 'history'
    || scenarioError?.scenarioId === 'emotional_check_in'
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
    historyRequestRef.current += 1;
    setScreenAccountId(accountId);
    setMoodKey(null);
    setReflectionSummary('');
    setHistory([]);
    setHistoryLoading(true);
    setHistoryError(false);
    setVisibleHistoryCount(HISTORY_PAGE_SIZE);
    setSaving(false);
    setDeletingId(null);
    saveFlightRef.current = null;
    deleteFlightRef.current = null;
    setLastConsentedContext(null);
    setSnackbar(null);
  }, [accountId]);

  const loadHistory = useCallback(async () => {
    const operationAccountId = accountId;
    const operationEpoch = accountEpochRef.current;
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(false);
    try {
      const nextHistory = await listMoodCheckIns(operationAccountId);
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch
        && requestId === historyRequestRef.current) {
        setHistory(nextHistory);
        setVisibleHistoryCount(HISTORY_PAGE_SIZE);
      }
    } catch {
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch
        && requestId === historyRequestRef.current) setHistoryError(true);
    } finally {
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch
        && requestId === historyRequestRef.current) setHistoryLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadHistory();
    return () => {
      historyRequestRef.current += 1;
    };
  }, [loadHistory]);

  const saveCheckIn = async () => {
    if (!selectedMood || !accountId || !accountAligned || saveFlightRef.current) return;
    const operationAccountId = accountId;
    const operationEpoch = accountEpochRef.current;
    const flight = { accountId: operationAccountId, epoch: operationEpoch };
    saveFlightRef.current = flight;
    setSaving(true);
    try {
      const nextHistory = await saveMoodCheckIn(operationAccountId, {
        moodKey: selectedMood.key,
        score: selectedMood.score,
        reflectionSummary
      });
      if (!mountedRef.current
        || accountIdRef.current !== operationAccountId
        || accountEpochRef.current !== operationEpoch) return;
      setHistory(nextHistory);
      setLastConsentedContext({
        mood_key: selectedMood.key,
        ...(normalizedReflectionSummary
          ? { reflection_summary: normalizedReflectionSummary }
          : {})
      });
      setMoodKey(null);
      setReflectionSummary('');
      setSnackbar({ tone: 'success', messageKey: 'wellness.emotional.saved' });
    } catch {
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch) {
        setSnackbar({ tone: 'error', messageKey: 'wellness.emotional.saveFailed' });
      }
    } finally {
      if (saveFlightRef.current === flight) saveFlightRef.current = null;
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch) setSaving(false);
    }
  };

  const removeCheckIn = async (checkInId) => {
    if (!accountId || !accountAligned || deleteFlightRef.current) return;
    const operationAccountId = accountId;
    const operationEpoch = accountEpochRef.current;
    const flight = { accountId: operationAccountId, epoch: operationEpoch, checkInId };
    deleteFlightRef.current = flight;
    setDeletingId(checkInId);
    try {
      const nextHistory = await deleteMoodCheckIn(operationAccountId, checkInId);
      if (!mountedRef.current
        || accountIdRef.current !== operationAccountId
        || accountEpochRef.current !== operationEpoch) return;
      setHistory(nextHistory);
      setLastConsentedContext(null);
      setSnackbar({ tone: 'success', messageKey: 'wellness.emotional.deleted' });
    } catch {
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch) {
        setSnackbar({ tone: 'error', messageKey: 'wellness.emotional.deleteFailed' });
      }
    } finally {
      if (deleteFlightRef.current === flight) deleteFlightRef.current = null;
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch) setDeletingId(null);
    }
  };

  const confirmDelete = (checkInId) => {
    Alert.alert(t('wellness.emotional.deleteTitle'), t('wellness.emotional.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => removeCheckIn(checkInId)
      }
    ]);
  };

  const startAIReflection = async () => {
    if (!connectedCareAvailable || !accountAligned || !consentedContext) return;
    const operationAccountId = accountId;
    const operationEpoch = accountEpochRef.current;
    try {
      const result = await runScenario('emotional_check_in', { context: consentedContext });
      if (mountedRef.current
        && accountIdRef.current === operationAccountId
        && accountEpochRef.current === operationEpoch
        && result?.started?.length) {
        setSnackbar({ tone: 'success', messageKey: 'wellness.scenarioStarted' });
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
      setSnackbar({ tone: 'success', messageKey: 'wellness.feedback.thanks' });
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
    if (scopedScenarioError?.operation === 'start') return startAIReflection();
    return refreshActivity();
  };

  return (
    <Screen>
      <Header
        eyebrow={t('wellness.emotional.eyebrow')}
        title={t('wellness.emotional.title')}
        subtitle={t('wellness.emotional.subtitle')}
        showBack
        backLabel={t('common.back')}
      />

      <Card style={styles.form}>
        <View style={styles.sectionCopy}>
          <Text
            accessibilityRole="header"
            ref={feedbackReturnRef}
            style={[styles.sectionTitle, isRTL && styles.rtlText]}
          >
            {t('wellness.emotional.moodQuestion')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {t('wellness.emotional.moodHint')}
          </Text>
        </View>
        <View
          accessibilityLabel={t('wellness.emotional.moodPickerLabel')}
          accessibilityRole="radiogroup"
          style={[styles.moodGrid, isRTL && styles.rtlRow]}
        >
          {MOOD_OPTIONS.map((mood) => {
            const selected = accountAligned && mood.key === moodKey;
            const moodLabel = t(`wellness.emotional.moods.${mood.key}`);
            return (
              <Pressable
                key={mood.key}
                accessibilityLabel={`${MOOD_EMOJI[mood.key]} ${moodLabel}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected, disabled: saving || !accountAligned }}
                android_ripple={{ color: colors.borderSubtle }}
                disabled={saving || !accountAligned}
                onPress={() => setMoodKey(mood.key)}
                style={({ pressed }) => [
                  styles.moodChoice,
                  selected && styles.moodSelected,
                  pressed && !saving && styles.pressed
                ]}
              >
                <Text accessible={false} style={styles.emoji}>{MOOD_EMOJI[mood.key]}</Text>
                <Text style={[styles.moodLabel, selected && styles.moodLabelSelected]}>{moodLabel}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextField
          label={t('wellness.emotional.reflectionLabel')}
          hint={t('wellness.emotional.reflectionHint')}
          accessibilityLabel={t('wellness.emotional.reflectionLabel')}
          accessibilityHint={t('wellness.emotional.reflectionHint')}
          multiline
          editable={!saving && accountAligned}
          maxLength={MAX_REFLECTION_SUMMARY_LENGTH}
          onChangeText={setReflectionSummary}
          placeholder={t('wellness.emotional.reflectionPlaceholder')}
          value={accountAligned ? reflectionSummary : ''}
        />
        <Text style={[styles.characterCount, isRTL && styles.rtlText]}>
          {t('wellness.emotional.characterCount', {
            count: formatLocalizedNumber(
              accountAligned ? reflectionSummary.length : 0,
              locale
            ),
            max: formatLocalizedNumber(MAX_REFLECTION_SUMMARY_LENGTH, locale)
          })}
        </Text>
        <FeedbackBanner message={t('wellness.emotional.privacyNote')} tone="info" />
        <Button
          title={t('wellness.emotional.save')}
          icon="heart-outline"
          variant="orange"
          disabled={!selectedMood || !accountId || !accountAligned}
          loading={saving}
          loadingLabel={t('wellness.emotional.saving')}
          onPress={saveCheckIn}
        />
      </Card>

      <Card variant="tinted" style={styles.form}>
        <View style={styles.sectionCopy}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
            {t('wellness.emotional.connectedTitle')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {t('wellness.emotional.connectedBody')}
          </Text>
        </View>
        {!connectedCareAvailable ? (
          <FeedbackBanner message={t('wellness.connectedCareUnavailable')} tone="info" />
        ) : null}
        <FeedbackBanner message={t('wellness.emotional.humeContextNotice')} tone="info" />
        {connectedCareAvailable && !consentedContext ? (
          <FeedbackBanner message={t('wellness.emotional.moodHint')} tone="warning" />
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
          accessibilityHint={t('wellness.emotional.connectedHint')}
          title={t('wellness.emotional.startReflection')}
          icon="chatbubbles-outline"
          variant="secondary"
          disabled={!connectedCareAvailable || !accountAligned || !consentedContext || scenarioActive}
          loading={isStartingScenario('emotional_check_in')}
          loadingLabel={t('wellness.scenarioStarting')}
          onPress={startAIReflection}
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
          {t('wellness.emotional.historyTitle')}
        </Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {t('wellness.emotional.historySubtitle')}
        </Text>
      </View>

      {historyLoading || !accountAligned ? (
        <Card>
          <SkeletonGroup label={t('common.loading')}>
            <SkeletonText lines={3} />
          </SkeletonGroup>
        </Card>
      ) : null}
      {accountAligned && !historyLoading && historyError ? (
        <FeedbackBanner
          message={t('wellness.emotional.historyLoadFailed')}
          tone="error"
          actionLabel={t('common.retry')}
          onAction={loadHistory}
        />
      ) : null}
      {accountAligned && !historyLoading && !historyError && !history.length ? (
        <Card padding="sm">
          <EmptyState
            compact
            title={t('wellness.emotional.historyEmptyTitle')}
            message={t('wellness.emotional.historyEmptyMessage')}
          />
        </Card>
      ) : null}
      {accountAligned && !historyLoading && !historyError ? history
        .slice(0, visibleHistoryCount)
        .map((checkIn) => {
          const occurredAt = formatLocalizedDateTime(checkIn.occurredAt, locale)
            || t('common.unknown');
          return (
            <Card
              key={checkIn.id}
              style={styles.historyCard}
            >
              <View style={[styles.historyHeader, isRTL && styles.rtlRow]}>
                <View
                  accessible
                  accessibilityLabel={`${t(`wellness.emotional.moods.${checkIn.moodKey}`)}, ${occurredAt}`}
                  accessibilityRole="summary"
                  style={[styles.historyMood, isRTL && styles.rtlRow]}
                >
                  <Text accessible={false} style={styles.historyEmoji}>{MOOD_EMOJI[checkIn.moodKey]}</Text>
                  <View style={styles.historyCopy}>
                    <Text style={[styles.historyTitle, isRTL && styles.rtlText]}>
                      {t(`wellness.emotional.moods.${checkIn.moodKey}`)}
                    </Text>
                    <Text style={[styles.timestamp, isRTL && styles.rtlText]}>
                      {occurredAt}
                    </Text>
                  </View>
                </View>
                <Button
                  title={t('common.delete')}
                  accessibilityLabel={`${t('common.delete')} · ${t(`wellness.emotional.moods.${checkIn.moodKey}`)}`}
                  variant="ghost"
                  compact
                  disabled={Boolean(deletingId)}
                  loading={deletingId === checkIn.id}
                  onPress={() => confirmDelete(checkIn.id)}
                />
              </View>
              {checkIn.reflectionSummary ? (
                <Text style={[styles.reflection, isRTL && styles.rtlText]}>{checkIn.reflectionSummary}</Text>
              ) : null}
            </Card>
          );
        }) : null}
      {accountAligned && !historyLoading && !historyError && history.length > visibleHistoryCount ? (
        <Button
          title={t('wellness.emotional.showMore')}
          icon="chevron-down-outline"
          variant="ghost"
          onPress={() => setVisibleHistoryCount((current) => (
            Math.min(history.length, current + HISTORY_PAGE_SIZE)
          ))}
        />
      ) : null}

      <Snackbar
        message={accountAligned && snackbar?.messageKey
          ? t(snackbar.messageKey, snackbar.messageOptions)
          : null}
        tone={snackbar?.tone}
        onDismiss={() => setSnackbar(null)}
      />
      <InteractionFeedbackModal
        visible={accountAligned && feedbackTarget?.scenarioId === 'emotional_check_in'}
        interactionName={feedbackTarget?.scenarioId === 'emotional_check_in'
          ? t(`wellness.scenarios.names.${feedbackTarget.scenarioId}`)
          : t('wellness.emotional.title')}
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
  form: { gap: spacing.md },
  sectionCopy: { gap: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  rtlText: { textAlign: 'right' },
  rtlRow: { flexDirection: 'row-reverse' },
  moodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  moodChoice: {
    minWidth: 92,
    minHeight: sizes.controlLarge + spacing.md,
    flex: 1,
    flexBasis: '30%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderControl,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceRaised
  },
  moodSelected: { borderWidth: 2, borderColor: tones.accent.foreground, backgroundColor: tones.accent.background },
  pressed: { opacity: 0.9, transform: [{ scale: motion.pressedScale }] },
  emoji: { ...typography.emojiLarge },
  moodLabel: { ...typography.label, color: colors.textPrimary, textAlign: 'center' },
  moodLabelSelected: { color: tones.accent.foreground },
  characterCount: { ...typography.caption, color: colors.textSecondary, marginTop: -spacing.sm },
  historyCard: { gap: spacing.mdSm },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.mdSm },
  historyMood: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  historyCopy: { flex: 1, minWidth: 0 },
  historyEmoji: { ...typography.emoji },
  historyTitle: { ...typography.label, color: colors.textPrimary },
  timestamp: { ...typography.caption, color: colors.textSecondary },
  reflection: { ...typography.bodySmall, color: colors.textPrimary }
});
