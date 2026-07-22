import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { Button } from './Button';
import { StatusPill } from './StatusPill';
import { colors, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

const STATE_TONES = Object.freeze({
  queued: 'idle',
  running: 'active',
  completed: 'ok',
  fallback_completed: 'warn',
  failed: 'danger',
  cancelled: 'idle'
});

export function ScenarioStatusCard({
  execution,
  cancelling = false,
  refreshing = false,
  onCancel,
  onRetryStatus,
  style
}) {
  const { isRTL, locale, t } = useI18n();
  const active = execution.state === 'queued' || execution.state === 'running';
  const title = t(`wellness.scenarios.names.${execution.scenarioId}`);
  const status = t(`wellness.scenarios.statuses.${execution.state}`);
  const updated = new Date(execution.updatedAt).toLocaleString(locale);
  return (
    <Card padding="sm" style={style}>
      <View
        accessible
        accessibilityLabel={t('wellness.scenarios.statusAccessibility', {
          scenario: title,
          status,
          date: updated
        })}
        accessibilityLiveRegion="polite"
        accessibilityRole="summary"
        style={[styles.heading, isRTL && styles.rtlRow]}
      >
        <View style={styles.copy}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
          <Text style={[styles.time, isRTL && styles.rtlText]}>
            {t('wellness.scenarios.updated', { date: updated })}
          </Text>
        </View>
        <StatusPill label={status} tone={STATE_TONES[execution.state]} />
      </View>
      {execution.state === 'fallback_completed' ? (
        <Text style={[styles.note, isRTL && styles.rtlText]}>{t('wellness.scenarios.fallbackNote')}</Text>
      ) : null}
      {execution.state === 'failed' ? (
        <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
          {t('wellness.scenarios.failedNote')}
        </Text>
      ) : null}
      <View style={[styles.actions, isRTL && styles.rtlRow]}>
        {active && onCancel ? (
          <Button
            compact
            title={t('wellness.scenarios.cancel')}
            variant="ghost"
            disabled={cancelling}
            loading={cancelling}
            onPress={() => onCancel(execution.executionId)}
            style={styles.action}
          />
        ) : null}
        {active && onRetryStatus ? (
          <Button
            compact
            title={t('wellness.scenarios.refreshStatus')}
            variant="secondary"
            disabled={cancelling || refreshing}
            loading={refreshing}
            onPress={() => onRetryStatus(execution.executionId)}
            style={styles.action}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.label, color: colors.textPrimary },
  time: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  note: { ...typography.bodySmall, color: colors.goldAccessible, marginTop: spacing.sm },
  error: { ...typography.bodySmall, color: colors.redAccessible, marginTop: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  action: { flexGrow: 1 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' }
});
