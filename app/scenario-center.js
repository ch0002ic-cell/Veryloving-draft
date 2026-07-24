import { useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ActionTile } from '../src/components/ActionTile';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { Header } from '../src/components/Header';
import { InteractionFeedbackModal } from '../src/components/InteractionFeedbackModal';
import { ScenarioStatusCard } from '../src/components/ScenarioStatusCard';
import { Screen } from '../src/components/Screen';
import { Skeleton, SkeletonGroup } from '../src/components/Skeleton';
import { Snackbar } from '../src/components/Snackbar';
import { StatusPill } from '../src/components/StatusPill';
import { colors, radii, sizes, spacing, tones, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { useScenarioRunner } from '../src/hooks/useScenarioRunner';

const SCENARIOS = Object.freeze([
  Object.freeze({ id: 'fall_detection', icon: 'walk-outline', tone: 'wearable', confirmation: 'practice' }),
  Object.freeze({ id: 'medication_adherence', icon: 'medkit-outline', tone: 'robot', confirmation: 'medication' }),
  Object.freeze({ id: 'emotional_check_in', icon: 'heart-outline', tone: 'safety', destination: '/emotional-check-in' }),
  Object.freeze({ id: 'cognitive_engagement', icon: 'extension-puzzle-outline', tone: 'default', destination: '/cognitive-engagement' }),
  Object.freeze({ id: 'ai_angel_auto_dial', icon: 'call-outline', tone: 'danger', confirmation: 'emergency' })
]);

function localizedScenarioError(t, errorCode) {
  if (!errorCode) return null;
  if (errorCode === 'SCENARIO_DEMO_OFFLINE') return t('wellness.scenarios.demoOffline');
  if (['SCENARIO_AUTHENTICATION_REQUIRED', 'SCENARIO_ACCOUNT_MISMATCH',
    'SCENARIO_ACCOUNT_UNAVAILABLE'].includes(errorCode)) {
    return t('wellness.scenarios.signInRequired');
  }
  if (['SCENARIO_CONFIGURATION_MISSING', 'SCENARIO_CONFIGURATION_INVALID',
    'SCENARIO_NOT_CONFIGURED'].includes(errorCode)) {
    return t('wellness.scenarios.notConfigured');
  }
  if (errorCode === 'SCENARIO_NETWORK_ERROR' || errorCode === 'SCENARIO_TIMEOUT') {
    return t('wellness.scenarios.networkError');
  }
  if (errorCode === 'SCENARIO_POLL_TIMEOUT') return t('wellness.scenarios.stillRunning');
  return t('wellness.scenarios.genericError');
}

export default function ScenarioCenter() {
  const { isRTL, t } = useI18n();
  const [snackbar, setSnackbar] = useState(null);
  const feedbackReturnRef = useRef(null);
  const scenario = useScenarioRunner();
  const latestExecutions = useMemo(() => scenario.executions.slice(0, 10), [scenario.executions]);
  const activeScenarioIds = useMemo(() => new Set(scenario.executions
    .filter(({ state }) => ['queued', 'running'].includes(state))
    .map(({ scenarioId }) => scenarioId)), [scenario.executions]);
  const errorMessage = localizedScenarioError(t, scenario.errorCode);
  const serviceReachable = scenario.serviceStatus === 'reachable';
  const serviceChecking = scenario.serviceStatus === 'checking';
  const serviceLabel = scenario.serviceStatus === 'unavailable'
    ? t('wellness.scenarios.notConfigured')
    : !scenario.connected || scenario.serviceStatus === 'unreachable'
    ? t('wellness.scenarios.offline')
    : serviceReachable
      ? t('wellness.scenarios.connected')
      : serviceChecking
        ? t('common.connecting')
        : t('safetyCall.ready');
  const serviceTone = serviceReachable
    ? 'ok'
    : serviceChecking
      ? 'active'
      : scenario.connected && scenario.serviceStatus === 'unknown'
        ? 'idle'
        : 'warn';

  const trigger = async (scenarioId) => {
    const result = await scenario.runScenario(scenarioId);
    if (result?.started?.length) setSnackbar({ messageKey: 'wellness.scenarios.started' });
  };

  const confirmAndTrigger = (definition) => {
    if (definition.destination) {
      router.push(definition.destination);
      return;
    }
    if (!definition.confirmation) {
      trigger(definition.id);
      return;
    }
    Alert.alert(
      t(`wellness.scenarios.confirmations.${definition.confirmation}Title`),
      t(`wellness.scenarios.confirmations.${definition.confirmation}Body`),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t(`wellness.scenarios.confirmations.${definition.confirmation}Action`),
          style: definition.confirmation === 'emergency' ? 'destructive' : 'default',
          onPress: () => trigger(definition.id)
        }
      ]
    );
  };

  const confirmCancellation = (executionId) => {
    const execution = scenario.executions.find((item) => item.executionId === executionId);
    if (!execution || execution.priority !== 'critical') {
      scenario.cancelExecution(executionId);
      return;
    }
    Alert.alert(
      t('wellness.scenarios.confirmations.cancelCriticalTitle'),
      t('wellness.scenarios.confirmations.cancelCriticalBody'),
      [
        { text: t('common.back'), style: 'cancel' },
        {
          text: t('wellness.scenarios.confirmations.cancelCriticalAction'),
          style: 'destructive',
          onPress: () => scenario.cancelExecution(executionId)
        }
      ]
    );
  };

  const feedbackName = scenario.feedbackTarget
    ? t(`wellness.scenarios.names.${scenario.feedbackTarget.scenarioId}`)
    : '';

  const retryScenarioError = () => {
    const error = scenario.scenarioError;
    if (!error || error.operation === 'history' || error.code === 'SCENARIO_NOT_FOUND') {
      return scenario.refreshActivity();
    }
    if (error.operation === 'status' && error.executionId) {
      return scenario.retryPolling(error.executionId);
    }
    if (error.operation === 'cancel' && error.executionId) {
      confirmCancellation(error.executionId);
      return undefined;
    }
    if (error.operation === 'start' && error.scenarioId) {
      const definition = SCENARIOS.find(({ id }) => id === error.scenarioId);
      if (definition) return confirmAndTrigger(definition);
    }
    return scenario.refreshActivity();
  };

  return (
    <Screen>
      <Header
        backLabel={t('common.back')}
        eyebrow={t('wellness.eyebrow')}
        showBack
        subtitle={t('wellness.scenarios.subtitle')}
        title={t('wellness.scenarios.title')}
      />

      <Card variant="tinted" style={styles.intro}>
        <View style={[styles.introRow, isRTL && styles.rtlRow]}>
          <View style={styles.introIcon}>
            <Ionicons accessible={false} color={colors.orangeAccessible} name="git-network-outline" size={sizes.iconLarge} />
          </View>
          <View style={styles.copy}>
            <Text style={[styles.introTitle, isRTL && styles.rtlText]}>{t('wellness.scenarios.connectedCare')}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t('wellness.scenarios.connectedCareBody')}</Text>
          </View>
        </View>
        <StatusPill
          label={serviceLabel}
          tone={serviceTone}
        />
      </Card>

      {!scenario.connected ? (
        <FeedbackBanner
          message={scenario.isDemoMode
            ? t('wellness.scenarios.demoOffline')
            : t('wellness.scenarios.signInRequired')}
          tone="warning"
        />
      ) : null}
      <FeedbackBanner
        actionLabel={scenario.connected && errorMessage ? t('common.retry') : undefined}
        message={errorMessage}
        onAction={scenario.connected && errorMessage ? retryScenarioError : undefined}
        onDismiss={scenario.clearError}
        dismissLabel={t('common.close')}
        tone="error"
      />

      <View style={[styles.sectionHeading, isRTL && styles.rtlRow]}>
        <View style={styles.copy}>
          <Text
            accessibilityRole="header"
            ref={feedbackReturnRef}
            style={[styles.sectionTitle, isRTL && styles.rtlText]}
          >
            {t('wellness.scenarios.chooseAction')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t('wellness.scenarios.chooseActionBody')}</Text>
        </View>
      </View>

      <View style={styles.scenarioList}>
        {SCENARIOS.map((definition) => {
          const scenarioActive = activeScenarioIds.has(definition.id);
          return (
            <Card key={definition.id} padding="sm">
              <View style={[styles.scenarioRow, isRTL && styles.rtlRow]}>
                <View style={[styles.scenarioIcon, styles[`${definition.tone}Icon`]]}>
                  <Ionicons
                    accessible={false}
                    color={definition.tone === 'danger' ? colors.redAccessible : colors.textPrimary}
                    name={definition.icon}
                    size={sizes.iconLarge}
                  />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.scenarioTitle, isRTL && styles.rtlText]}>
                    {t(`wellness.scenarios.names.${definition.id}`)}
                  </Text>
                  <Text style={[styles.body, isRTL && styles.rtlText]}>
                    {t(`wellness.scenarios.descriptions.${definition.id}`)}
                  </Text>
                </View>
              </View>
              <Button
                disabled={!scenario.connected || scenarioActive || scenario.isStartingScenario(definition.id)}
                icon={definition.icon}
                loading={scenario.isStartingScenario(definition.id)}
                loadingLabel={t('wellness.scenarios.starting')}
                onPress={() => confirmAndTrigger(definition)}
                title={t(`wellness.scenarios.actions.${definition.id}`)}
                variant={definition.tone === 'danger' ? 'danger' : definition.tone === 'safety' ? 'success' : 'primary'}
              />
            </Card>
          );
        })}
      </View>

      <View style={styles.sectionHeading}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
            {t('wellness.scenarios.wellnessTools')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t('wellness.scenarios.wellnessToolsBody')}</Text>
        </View>
      </View>
      <View style={styles.toolList}>
        <ActionTile
          description={t('wellness.emotional.subtitle')}
          icon="heart-outline"
          onPress={() => router.push('/emotional-check-in')}
          title={t('wellness.emotional.title')}
          tone="safety"
        />
        <ActionTile
          description={t('wellness.cognitive.subtitle')}
          icon="extension-puzzle-outline"
          onPress={() => router.push('/cognitive-engagement')}
          title={t('wellness.cognitive.title')}
        />
      </View>

      <View style={[styles.sectionHeading, isRTL && styles.rtlRow]}>
        <View style={styles.copy}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
            {t('wellness.scenarios.recentActivity')}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t('wellness.scenarios.recentActivityBody')}</Text>
        </View>
        <Button compact icon="refresh" onPress={scenario.refreshActivity} title={t('common.retry')} variant="ghost" />
      </View>

      {scenario.loading ? (
        <SkeletonGroup label={t('wellness.scenarios.loading')} style={styles.skeletonList}>
          <Skeleton height={104} borderRadius={radii.lg} />
          <Skeleton height={104} borderRadius={radii.lg} />
        </SkeletonGroup>
      ) : latestExecutions.length ? (
        <View style={styles.activityList}>
          {latestExecutions.map((execution) => (
            <ScenarioStatusCard
              execution={execution}
              key={execution.executionId}
              cancelling={scenario.isCancellingExecution(execution.executionId)}
              refreshing={scenario.isRefreshingExecution(execution.executionId)}
              onCancel={confirmCancellation}
              onRetryStatus={scenario.retryPolling}
            />
          ))}
        </View>
      ) : (
        <EmptyState
          actionLabel={t('wellness.scenarios.startFirst')}
          message={t('wellness.scenarios.emptyMessage')}
          onAction={() => confirmAndTrigger(SCENARIOS[2])}
          title={t('wellness.scenarios.emptyTitle')}
        />
      )}

      <Snackbar
        message={snackbar?.messageKey ? t(snackbar.messageKey, snackbar.messageOptions) : null}
        onDismiss={() => setSnackbar(null)}
      />
      <InteractionFeedbackModal
        busy={scenario.feedbackBusy}
        error={Boolean(scenario.feedbackErrorCode)}
        interactionName={feedbackName}
        onDismiss={scenario.dismissFeedback}
        onRate={scenario.sendFeedback}
        returnFocusRef={feedbackReturnRef}
        visible={Boolean(scenario.feedbackTarget)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: spacing.mdSm },
  introRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.mdSm },
  introIcon: {
    width: sizes.headerControl,
    height: sizes.headerControl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised
  },
  copy: { flex: 1, minWidth: 0 },
  introTitle: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.xs },
  body: { ...typography.bodySmall, color: colors.textSecondary },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  sectionTitle: { ...typography.title, color: colors.textPrimary, marginBottom: spacing.xs },
  scenarioList: { gap: spacing.mdSm },
  scenarioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.mdSm, marginBottom: spacing.mdSm },
  scenarioIcon: {
    width: sizes.headerControl,
    height: sizes.headerControl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: tones.neutral.background
  },
  wearableIcon: { backgroundColor: tones.accent.background },
  robotIcon: { backgroundColor: tones.info.background },
  safetyIcon: { backgroundColor: tones.success.background },
  defaultIcon: { backgroundColor: tones.neutral.background },
  dangerIcon: { backgroundColor: tones.danger.background },
  scenarioTitle: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.xs },
  toolList: { gap: spacing.sm },
  activityList: { gap: spacing.sm },
  skeletonList: { gap: spacing.sm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' }
});
