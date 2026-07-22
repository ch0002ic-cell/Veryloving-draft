import { useEffect, useRef, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ActionTile } from '../../src/components/ActionTile';
import { DeviceStatusCard } from '../../src/components/DeviceStatusCard';
import { StatusPill } from '../../src/components/StatusPill';
import { Snackbar } from '../../src/components/Snackbar';
import { images } from '../../src/constants/assets';
import { colors, spacing, typography } from '../../src/constants/theme';
import { useAppState } from '../../src/context/AppContext';
import { useI18n } from '../../src/context/I18nContext';
import { logger } from '../../src/utils/logger';
import { useAuth } from '../../src/context/AuthContext';
import { activateSafetyMode, fetchCurrentSafetyMode } from '../../src/services/safety-api';
import { config } from '../../src/utils/config';

export default function Home() {
  const { settings, updateSettings, device, selectedVoice, wearableEntities, robotEntities } = useAppState();
  const { accessToken } = useAuth();
  const { isRTL, t } = useI18n();
  const [changingMode, setChangingMode] = useState(null);
  const [modeFeedback, setModeFeedback] = useState(null);
  const modeChangeRef = useRef(null);
  const modeReconciledRef = useRef(false);
  const voiceName = t(`voices.profiles.${selectedVoice.id}.name`);
  const modeName = t(`home.modes.${settings.mode}`);
  const activeWearable = wearableEntities.find((wearable) => wearable.deviceId === device.id)
    || wearableEntities[0]
    || (device.id ? { ...device, deviceId: device.id, deviceType: 'wearable', online: device.connected } : null);
  const activeRobot = robotEntities[0] || null;

  useEffect(() => {
    if (!config.safetyBackendEnabled || !accessToken || modeReconciledRef.current) return;
    modeReconciledRef.current = true;
    modeChangeRef.current = 'reconcile';
    fetchCurrentSafetyMode(accessToken).then(async (remoteSession) => {
      if (['home', 'guardian', 'emergency'].includes(remoteSession?.mode)) {
        if (remoteSession.mode !== settings.mode) await updateSettings({ mode: remoteSession.mode });
        return;
      }
      await activateSafetyMode(settings.mode, accessToken);
    }).catch((error) => logger.warn('[SafetyMode] Could not reconcile the current backend mode', {
      errorCode: error?.code || error?.name || 'MODE_RECONCILIATION_FAILED'
    })).finally(() => {
      if (modeChangeRef.current === 'reconcile') modeChangeRef.current = null;
    });
  }, [accessToken, settings.mode, updateSettings]);

  const changeSafetyMode = async (mode) => {
    if (modeChangeRef.current || settings.mode === mode) return;
    modeChangeRef.current = mode;
    setChangingMode(mode);
    try {
      if (config.safetyBackendEnabled && accessToken) await activateSafetyMode(mode, accessToken);
      await updateSettings({ mode });
      setModeFeedback(mode);
    } catch (error) {
      logger.warn('[SafetyMode] Could not save the requested local mode', {
        requestedMode: mode,
        errorCode: error?.code || error?.name || 'MODE_SAVE_FAILED'
      });
      setModeFeedback(null);
      Alert.alert(t('settings.updateFailedTitle'), t('settings.updateFailedMessage'));
    } finally {
      modeChangeRef.current = null;
      setChangingMode(null);
    }
  };

  return (
    <Screen>
      <Header title={t('common.veryLoving')} subtitle={t('home.subtitle')} />
      <Card style={[styles.hero, isRTL && styles.rtlRow]}>
        <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <StatusPill label={t('home.modeStatus', { mode: modeName })} tone="active" />
          <Text style={[styles.heroTitle, isRTL && styles.rtlText]}>{t('home.companionReady', { name: voiceName })}</Text>
          <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('home.readyBody')}</Text>
        </View>
      </Card>

      <View style={[styles.sectionHeading, isRTL && styles.rtlRow]}>
        <View style={styles.headingCopy}>
          <Text style={[styles.section, isRTL && styles.rtlText]}>{t('settings.deviceManagement')}</Text>
          <Text style={[styles.sectionSubtitle, isRTL && styles.rtlText]}>{t('settings.sections.deviceSafetySubtitle')}</Text>
        </View>
        <Button title={t('home.manageDevice')} variant="ghost" compact onPress={() => router.push('/device-management')} />
      </View>
      <View style={styles.deviceGrid}>
        <DeviceStatusCard
          deviceType="wearable"
          entity={activeWearable}
          name={activeWearable?.name || t('home.northStarDevice')}
          style={styles.deviceCard}
        />
        <DeviceStatusCard
          deviceType="home_robot"
          entity={activeRobot}
          name={activeRobot?.name || t('medication.robot')}
          style={styles.deviceCard}
        />
      </View>

      <Text style={[styles.section, isRTL && styles.rtlText]}>{t('settings.sections.deviceSafety')}</Text>
      <View style={[styles.quickGrid, isRTL && styles.rtlRow]}>
        {settings.showCompanion ? (
          <ActionTile style={styles.quickAction} title={t('home.safetyCall')} icon="call" tone="safety" onPress={() => router.push('/safety-call')} />
        ) : null}
        <ActionTile style={styles.quickAction} title={t('tutorial.excuseTitle')} icon="call-outline" onPress={() => router.push('/excuse-call')} />
        <ActionTile style={styles.quickAction} title={t('common.friends')} icon="people" onPress={() => router.push('/friends')} />
        {activeRobot ? (
          <ActionTile style={styles.quickAction} title={t('medication.title')} icon="medkit-outline" tone="robot" onPress={() => router.push('/medication-reminders')} />
        ) : null}
        <ActionTile style={styles.quickAction} title={t('common.settings')} icon="settings" onPress={() => router.push('/settings')} />
      </View>
      <Button
        title={t('common.sos')}
        accessibilityLabel={t('emergency.activate')}
        icon="warning"
        variant="danger"
        onPress={() => router.push('/emergency-sos')}
      />
      <Card>
        <Text style={[styles.section, isRTL && styles.rtlText]}>{t('home.mode')}</Text>
        <View style={[styles.modeRow, isRTL && styles.rtlRow]}>
          {['home', 'guardian', 'emergency'].map((mode) => (
            <Button
              key={mode}
              title={t(`home.modes.${mode}`)}
              icon={mode === 'home' ? 'home-outline' : mode === 'guardian' ? 'shield-checkmark-outline' : 'warning-outline'}
              variant={settings.mode === mode ? 'orange' : 'ghost'}
              selected={settings.mode === mode}
              onPress={() => changeSafetyMode(mode)}
              loading={changingMode === mode}
              disabled={Boolean(changingMode) && changingMode !== mode}
              style={styles.modeButton}
            />
          ))}
        </View>
      </Card>
      <Snackbar
        message={modeFeedback ? t('home.modeStatus', { mode: t(`home.modes.${modeFeedback}`) }) : null}
        onDismiss={() => setModeFeedback(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: spacing.mdSm, alignItems: 'center' },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  avatar: { width: 96, height: 96 },
  heroTitle: { ...typography.titleLarge, color: colors.textPrimary, marginTop: spacing.sm },
  muted: { ...typography.bodySmall, color: colors.textSecondary, marginVertical: spacing.sm },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  headingCopy: { flex: 1 },
  section: { ...typography.heading, color: colors.textPrimary },
  sectionSubtitle: { marginTop: spacing.xs, ...typography.caption, color: colors.textSecondary },
  deviceGrid: { gap: spacing.sm },
  deviceCard: { padding: spacing.mdSm },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickAction: { minWidth: 148, flexBasis: '47%', flexGrow: 1 },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.mdSm },
  modeButton: { minWidth: 100, flexBasis: '30%', flexGrow: 1 }
});
