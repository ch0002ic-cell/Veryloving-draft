import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { Header } from '../src/components/Header';
import { Screen } from '../src/components/Screen';
import { EmptyState } from '../src/components/EmptyState';
import { SkeletonGroup, SkeletonText } from '../src/components/Skeleton';
import { StatusPill } from '../src/components/StatusPill';
import { TextField } from '../src/components/TextField';
import { colors, motion, radii, sizes, spacing, typography } from '../src/constants/theme';
import { useAppState } from '../src/context/AppContext';
import { useI18n } from '../src/context/I18nContext';
import {
  canAcknowledgeMedicationReminder,
  createMedicationReminderInput
} from '../src/services/medication-reminder-form';

export default function MedicationReminders() {
  const {
    acknowledgeMedicationReminder,
    listMedicationReminders,
    medicationReminders,
    robotEntities,
    scheduleMedicationReminder
  } = useAppState();
  const { isRTL, locale, t } = useI18n();
  const [medicationReference, setMedicationReference] = useState('');
  const [reminderDelayMinutes, setReminderDelayMinutes] = useState('5');
  const [escalationDelayMinutes, setEscalationDelayMinutes] = useState('15');
  const [robotDeviceId, setRobotDeviceId] = useState(robotEntities[0]?.deviceId || '');
  const [busyAction, setBusyAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadRequestRef = useRef(0);
  const loadInFlightRef = useRef(false);
  const mutationInFlightRef = useRef(false);
  const mutationEpochRef = useRef(0);
  const lifecycleEpochRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!robotEntities.some((robot) => robot.deviceId === robotDeviceId)) {
      setRobotDeviceId(robotEntities[0]?.deviceId || '');
    }
  }, [robotDeviceId, robotEntities]);

  const loadReminders = useCallback(async () => {
    if (!mountedRef.current || loadInFlightRef.current || mutationInFlightRef.current) return;
    const lifecycleEpoch = lifecycleEpochRef.current;
    const requestId = ++loadRequestRef.current;
    loadInFlightRef.current = true;
    setBusyAction('load');
    setLoadFailed(false);
    const requestIsCurrent = () => mountedRef.current
      && lifecycleEpoch === lifecycleEpochRef.current
      && requestId === loadRequestRef.current;
    try {
      await listMedicationReminders();
    } catch {
      if (requestIsCurrent()) setLoadFailed(true);
    } finally {
      if (requestId === loadRequestRef.current) {
        loadInFlightRef.current = false;
        if (requestIsCurrent()) setBusyAction(null);
      }
    }
  }, [listMedicationReminders]);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleEpochRef.current += 1;
    loadReminders();
    return () => {
      mountedRef.current = false;
      lifecycleEpochRef.current += 1;
      loadRequestRef.current += 1;
      loadInFlightRef.current = false;
      mutationEpochRef.current += 1;
      mutationInFlightRef.current = false;
    };
  }, [loadReminders]);

  const createReminder = async () => {
    if (!mountedRef.current || loadInFlightRef.current
      || mutationInFlightRef.current || busyAction) return;
    const lifecycleEpoch = lifecycleEpochRef.current;
    const mutationEpoch = ++mutationEpochRef.current;
    mutationInFlightRef.current = true;
    setBusyAction('create');
    setFeedback(null);
    const operationIsCurrent = () => mountedRef.current
      && lifecycleEpoch === lifecycleEpochRef.current
      && mutationEpoch === mutationEpochRef.current;
    try {
      const input = createMedicationReminderInput({
        medicationReference,
        robotDeviceId,
        reminderDelayMinutes,
        escalationDelayMinutes
      });
      await scheduleMedicationReminder(input);
      if (!operationIsCurrent()) return;
      setMedicationReference('');
      setFeedback({ tone: 'success', message: t('medication.saved') });
    } catch {
      if (operationIsCurrent()) {
        setFeedback({ tone: 'error', message: t('medication.saveFailed') });
      }
    } finally {
      if (mutationEpoch === mutationEpochRef.current) {
        mutationInFlightRef.current = false;
        if (operationIsCurrent()) setBusyAction(null);
      }
    }
  };

  const acknowledge = async (reminderId) => {
    if (!mountedRef.current || loadInFlightRef.current
      || mutationInFlightRef.current || busyAction) return;
    const lifecycleEpoch = lifecycleEpochRef.current;
    const mutationEpoch = ++mutationEpochRef.current;
    mutationInFlightRef.current = true;
    setBusyAction(reminderId);
    setFeedback(null);
    const operationIsCurrent = () => mountedRef.current
      && lifecycleEpoch === lifecycleEpochRef.current
      && mutationEpoch === mutationEpochRef.current;
    try {
      await acknowledgeMedicationReminder(reminderId);
      if (operationIsCurrent()) {
        setFeedback({ tone: 'success', message: t('medication.acknowledged') });
      }
    } catch {
      if (operationIsCurrent()) {
        setFeedback({ tone: 'error', message: t('medication.acknowledgeFailed') });
      }
    } finally {
      if (mutationEpoch === mutationEpochRef.current) {
        mutationInFlightRef.current = false;
        if (operationIsCurrent()) setBusyAction(null);
      }
    }
  };

  return (
    <Screen>
      <Header
        title={t('medication.title')}
        subtitle={t('medication.subtitle')}
        showBack
        backLabel={t('common.back')}
      />
      <FeedbackBanner message={feedback?.message} tone={feedback?.tone} />

      <Card style={styles.form}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('medication.create')}</Text>
        <TextField
          label={t('medication.reference')}
          accessibilityLabel={t('medication.reference')}
          accessibilityHint={t('medication.referenceHint')}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busyAction}
          maxLength={100}
          onChangeText={setMedicationReference}
          placeholder={t('medication.referencePlaceholder')}
          value={medicationReference}
        />

        <Text style={[styles.label, isRTL && styles.rtlText]}>{t('medication.robot')}</Text>
        {robotEntities.length ? robotEntities.map((robot) => {
          const selected = robot.deviceId === robotDeviceId;
          return (
            <Pressable
              key={robot.deviceId}
              accessibilityLabel={`${robot.name} · ${robot.online ? t('safetyCall.connected') : t('safetyCall.offline')}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: Boolean(busyAction) }}
              disabled={Boolean(busyAction)}
              onPress={() => setRobotDeviceId(robot.deviceId)}
              style={({ pressed }) => [
                styles.robotChoice,
                isRTL && styles.rtlRow,
                selected && styles.robotSelected,
                pressed && styles.pressed
              ]}
            >
              <View style={styles.flex}>
                <Text style={[styles.robotName, isRTL && styles.rtlText]}>{robot.name}</Text>
                <Text style={[styles.muted, isRTL && styles.rtlText]}>
                  {robot.online ? t('safetyCall.connected') : t('safetyCall.offline')}
                </Text>
              </View>
              <Text style={styles.selectionMark}>{selected ? '●' : '○'}</Text>
            </Pressable>
          );
        }) : (
          <FeedbackBanner
            message={t('medication.noRobot')}
            tone="info"
            actionLabel={t('common.add')}
            onAction={() => router.push('/robot-pairing')}
          />
        )}

        <View style={[styles.timeRow, isRTL && styles.rtlRow]}>
          <TextField
              containerStyle={styles.timeField}
              label={t('medication.reminderMinutes')}
              accessibilityLabel={t('medication.reminderMinutes')}
              editable={!busyAction}
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setReminderDelayMinutes}
              placeholder="5"
              value={reminderDelayMinutes}
            />
          <TextField
              containerStyle={styles.timeField}
              label={t('medication.escalationMinutes')}
              accessibilityLabel={t('medication.escalationMinutes')}
              accessibilityHint={t('medication.escalationHint')}
              editable={!busyAction}
              keyboardType="number-pad"
              maxLength={4}
              onChangeText={setEscalationDelayMinutes}
              placeholder="15"
              value={escalationDelayMinutes}
            />
        </View>
        <Button
          title={t('medication.create')}
          icon="medkit-outline"
          loading={busyAction === 'create'}
          disabled={Boolean(busyAction) || !robotDeviceId}
          onPress={createReminder}
        />
      </Card>

      <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('medication.upcoming')}</Text>
      {busyAction === 'load' ? (
        <Card>
          <SkeletonGroup label={t('common.loading')}>
            <SkeletonText lines={3} />
          </SkeletonGroup>
        </Card>
      ) : null}
      {!busyAction && loadFailed ? (
        <FeedbackBanner
          message={t('medication.loadFailed')}
          tone="error"
          actionLabel={t('common.retry')}
          onAction={loadReminders}
        />
      ) : null}
      {!busyAction && !loadFailed && !medicationReminders.length ? (
        <EmptyState compact title={t('medication.empty')} message={t('medication.subtitle')} />
      ) : null}
      {medicationReminders.map((reminder) => {
        const robot = robotEntities.find((entity) => entity.deviceId === reminder.robotDeviceId);
        return (
          <Card key={reminder.id} style={styles.reminderCard}>
            <View style={[styles.reminderHeader, isRTL && styles.rtlRow]}>
              <View style={styles.flex}>
                <Text style={[styles.reminderName, isRTL && styles.rtlText]}>{reminder.medicationId}</Text>
                <Text style={[styles.muted, isRTL && styles.rtlText]}>{robot?.name || t('medication.robot')}</Text>
              </View>
              <StatusPill label={t(`medication.statuses.${reminder.status}`)} tone={reminder.status === 'acknowledged' ? 'ok' : 'active'} />
            </View>
            <Text style={[styles.muted, isRTL && styles.rtlText]}>
              {t('medication.due', { date: new Date(reminder.dueAt).toLocaleString(locale) })}
            </Text>
            {canAcknowledgeMedicationReminder(reminder) ? (
              <Button
                title={t('medication.acknowledge')}
                variant="ghost"
                compact
                loading={busyAction === reminder.id}
                disabled={Boolean(busyAction)}
                accessibilityLabel={`${t('medication.acknowledge')} · ${reminder.medicationId}`}
                onPress={() => acknowledge(reminder.id)}
              />
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.mdSm },
  sectionTitle: { ...typography.title, color: colors.textPrimary },
  label: { ...typography.label, color: colors.textPrimary },
  robotChoice: {
    minHeight: sizes.controlLarge,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderControl,
    borderRadius: radii.md,
    padding: spacing.mdSm
  },
  robotSelected: { borderColor: colors.blueAccessible, backgroundColor: colors.blueSoft },
  robotName: { ...typography.label, color: colors.textPrimary },
  selectionMark: { ...typography.title, color: colors.blueAccessible },
  timeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.mdSm },
  timeField: { flexGrow: 1, flexBasis: 168 },
  reminderCard: { gap: spacing.sm },
  reminderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reminderName: { ...typography.heading, color: colors.textPrimary },
  muted: { ...typography.bodySmall, color: colors.textSecondary },
  flex: { flex: 1 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] }
});
