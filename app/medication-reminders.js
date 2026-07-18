import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { Header } from '../src/components/Header';
import { Screen } from '../src/components/Screen';
import { colors, fonts, radii, spacing } from '../src/constants/theme';
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

  useEffect(() => {
    if (!robotEntities.some((robot) => robot.deviceId === robotDeviceId)) {
      setRobotDeviceId(robotEntities[0]?.deviceId || '');
    }
  }, [robotDeviceId, robotEntities]);

  useEffect(() => {
    let active = true;
    setBusyAction('load');
    listMedicationReminders().catch(() => {
      if (active) setFeedback({ tone: 'error', message: t('medication.loadFailed') });
    }).finally(() => {
      if (active) setBusyAction(null);
    });
    return () => { active = false; };
  }, [listMedicationReminders, t]);

  const createReminder = async () => {
    if (busyAction) return;
    setBusyAction('create');
    setFeedback(null);
    try {
      const input = createMedicationReminderInput({
        medicationReference,
        robotDeviceId,
        reminderDelayMinutes,
        escalationDelayMinutes
      });
      await scheduleMedicationReminder(input);
      setMedicationReference('');
      setFeedback({ tone: 'success', message: t('medication.saved') });
    } catch {
      setFeedback({ tone: 'error', message: t('medication.saveFailed') });
    } finally {
      setBusyAction(null);
    }
  };

  const acknowledge = async (reminderId) => {
    if (busyAction) return;
    setBusyAction(reminderId);
    setFeedback(null);
    try {
      await acknowledgeMedicationReminder(reminderId);
      setFeedback({ tone: 'success', message: t('medication.acknowledged') });
    } catch {
      setFeedback({ tone: 'error', message: t('medication.acknowledgeFailed') });
    } finally {
      setBusyAction(null);
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
        <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('medication.create')}</Text>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{t('medication.reference')}</Text>
        <TextInput
          accessibilityLabel={t('medication.reference')}
          accessibilityHint={t('medication.referenceHint')}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busyAction}
          maxLength={100}
          onChangeText={setMedicationReference}
          placeholder={t('medication.referencePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, isRTL && styles.rtlText]}
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
          <View style={styles.flex}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('medication.reminderMinutes')}</Text>
            <TextInput
              accessibilityLabel={t('medication.reminderMinutes')}
              editable={!busyAction}
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={setReminderDelayMinutes}
              placeholder="5"
              placeholderTextColor={colors.inkSoft}
              style={[styles.input, isRTL && styles.rtlText]}
              value={reminderDelayMinutes}
            />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('medication.escalationMinutes')}</Text>
            <TextInput
              accessibilityLabel={t('medication.escalationMinutes')}
              accessibilityHint={t('medication.escalationHint')}
              editable={!busyAction}
              keyboardType="number-pad"
              maxLength={4}
              onChangeText={setEscalationDelayMinutes}
              placeholder="15"
              placeholderTextColor={colors.inkSoft}
              style={[styles.input, isRTL && styles.rtlText]}
              value={escalationDelayMinutes}
            />
          </View>
        </View>
        <Button
          title={t('medication.create')}
          icon="medkit-outline"
          loading={busyAction === 'create'}
          disabled={Boolean(busyAction) || !robotDeviceId}
          onPress={createReminder}
        />
      </Card>

      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('medication.upcoming')}</Text>
      {busyAction === 'load' ? <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('common.loading')}</Text> : null}
      {!busyAction && !medicationReminders.length ? (
        <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('medication.empty')}</Text>
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
              <Text style={[styles.status, isRTL && styles.rtlText]}>
                {t(`medication.statuses.${reminder.status}`)}
              </Text>
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
  sectionTitle: { color: colors.ink, fontFamily: fonts.bold, fontSize: 20 },
  label: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 14 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radii.md,
    backgroundColor: colors.paper,
    color: colors.ink,
    fontFamily: fonts.regular,
    fontSize: 16,
    paddingHorizontal: spacing.mdSm
  },
  robotChoice: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: radii.md,
    padding: spacing.mdSm
  },
  robotSelected: { borderColor: colors.blueAccessible, backgroundColor: colors.blueSoft },
  robotName: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 15 },
  selectionMark: { color: colors.blueAccessible, fontSize: 20 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.mdSm },
  reminderCard: { gap: spacing.sm },
  reminderHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  reminderName: { color: colors.ink, fontFamily: fonts.bold, fontSize: 17 },
  status: { color: colors.blueAccessible, fontFamily: fonts.semibold, fontSize: 13, maxWidth: '48%' },
  muted: { color: colors.inkSoft, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  flex: { flex: 1 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  pressed: { opacity: 0.7 }
});

