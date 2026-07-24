import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ActionTile } from '../../src/components/ActionTile';
import { DeviceStatusCard } from '../../src/components/DeviceStatusCard';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
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
  const { accessToken, user } = useAuth();
  const { isRTL, t } = useI18n();
  const [changingMode, setChangingMode] = useState(null);
  const [modeFeedback, setModeFeedback] = useState(null);
  const [modeReconciliationFailed, setModeReconciliationFailed] = useState(false);
  const [reconcilingMode, setReconcilingMode] = useState(false);
  const modeChangeRef = useRef(null);
  const modeReconciledRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const sessionIdentityRef = useRef({ accountId: user?.id || null, accessToken });
  sessionIdentityRef.current = { accountId: user?.id || null, accessToken };
  const voiceName = t(`voices.profiles.${selectedVoice.id}.name`);
  const modeName = t(`home.modes.${settings.mode}`);
  const activeWearable = wearableEntities.find((wearable) => wearable.deviceId === device.id)
    || wearableEntities[0]
    || (device.id ? { ...device, deviceId: device.id, deviceType: 'wearable', online: device.connected } : null);
  const activeRobot = robotEntities[0] || null;

  const ownsSession = useCallback((generation, accountId, token) => (
    generation === sessionGenerationRef.current
    && sessionIdentityRef.current.accountId === accountId
    && sessionIdentityRef.current.accessToken === token
  ), []);

  const reconcileSafetyMode = useCallback(async () => {
    if (!config.safetyBackendEnabled || !accessToken || modeChangeRef.current) return;
    const generation = sessionGenerationRef.current;
    const accountId = user?.id || null;
    const token = accessToken;
    const flight = { kind: 'reconcile', generation };
    modeChangeRef.current = flight;
    setReconcilingMode(true);
    setModeReconciliationFailed(false);
    try {
      const remoteSession = await fetchCurrentSafetyMode(token);
      if (!ownsSession(generation, accountId, token)) return;
      if (['home', 'guardian', 'emergency'].includes(remoteSession?.mode)) {
        if (remoteSession.mode !== settings.mode) await updateSettings({ mode: remoteSession.mode });
        return;
      }
      await activateSafetyMode(settings.mode, token);
    } catch (error) {
      if (!ownsSession(generation, accountId, token)) return;
      logger.recoverable('[SafetyMode] Could not reconcile the current backend mode', {
        errorCode: error?.code || error?.name || 'MODE_RECONCILIATION_FAILED'
      });
      setModeReconciliationFailed(true);
    } finally {
      if (modeChangeRef.current === flight) modeChangeRef.current = null;
      if (ownsSession(generation, accountId, token)) setReconcilingMode(false);
    }
  }, [accessToken, ownsSession, settings.mode, updateSettings, user?.id]);

  useEffect(() => {
    sessionGenerationRef.current += 1;
    modeReconciledRef.current = false;
    modeChangeRef.current = null;
    setReconcilingMode(false);
    setChangingMode(null);
    setModeReconciliationFailed(false);
  }, [accessToken, user?.id]);

  useEffect(() => {
    if (!config.safetyBackendEnabled || !accessToken || modeReconciledRef.current || modeChangeRef.current) return;
    modeReconciledRef.current = true;
    reconcileSafetyMode();
  }, [accessToken, reconcileSafetyMode]);

  const changeSafetyMode = async (mode) => {
    if (modeChangeRef.current || settings.mode === mode) return;
    const generation = sessionGenerationRef.current;
    const accountId = user?.id || null;
    const token = accessToken;
    const flight = { kind: 'change', generation, mode };
    modeChangeRef.current = flight;
    setChangingMode(mode);
    try {
      if (config.safetyBackendEnabled && token) await activateSafetyMode(mode, token);
      if (!ownsSession(generation, accountId, token)) return;
      await updateSettings({ mode });
      if (!ownsSession(generation, accountId, token)) return;
      setModeReconciliationFailed(false);
      setModeFeedback(mode);
    } catch (error) {
      if (!ownsSession(generation, accountId, token)) return;
      logger.recoverable('[SafetyMode] Could not save the requested local mode', {
        requestedMode: mode,
        errorCode: error?.code || error?.name || 'MODE_SAVE_FAILED'
      });
      setModeFeedback(null);
      Alert.alert(t('settings.updateFailedTitle'), t('settings.updateFailedMessage'));
    } finally {
      if (modeChangeRef.current === flight) modeChangeRef.current = null;
      if (ownsSession(generation, accountId, token)) setChangingMode(null);
    }
  };

  return (
    <Screen>
      <Header title={t('common.veryLoving')} subtitle={t('home.subtitle')} />
      <FeedbackBanner
        message={modeReconciliationFailed ? t('settings.updateFailedMessage') : null}
        tone="error"
        actionLabel={modeReconciliationFailed && !reconcilingMode ? t('common.retry') : undefined}
        onAction={modeReconciliationFailed && !reconcilingMode ? reconcileSafetyMode : undefined}
      />
      <Card style={[styles.hero, isRTL && styles.rtlRow]}>
        <Image accessible={false} source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <StatusPill label={t('home.modeStatus', { mode: modeName })} tone="active" />
          <Text style={[styles.heroTitle, isRTL && styles.rtlText]}>{t('home.companionReady', { name: voiceName })}</Text>
          <Text style={[styles.muted, isRTL && styles.rtlText]}>{t('home.readyBody')}</Text>
        </View>
      </Card>

      <View style={[styles.sectionHeading, isRTL && styles.rtlRow]}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.section, isRTL && styles.rtlText]}>{t('settings.deviceManagement')}</Text>
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

      <Text accessibilityRole="header" style={[styles.section, isRTL && styles.rtlText]}>{t('settings.sections.deviceSafety')}</Text>
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
      <Text accessibilityRole="header" style={[styles.section, isRTL && styles.rtlText]}>
        {t('wellness.title')}
      </Text>
      <View style={styles.wellnessList}>
        <ActionTile
          description={t('wellness.scenarios.subtitle')}
          icon="git-network-outline"
          onPress={() => router.push('/scenario-center')}
          title={t('wellness.scenarios.title')}
          tone="robot"
        />
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
      <Button
        title={t('common.sos')}
        accessibilityLabel={t('emergency.activate')}
        icon="warning"
        variant="danger"
        onPress={() => router.push('/emergency-sos')}
      />
      <Card>
        <Text accessibilityRole="header" style={[styles.section, isRTL && styles.rtlText]}>{t('home.mode')}</Text>
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
  quickAction: { minWidth: 220, flexBasis: '47%', flexGrow: 1 },
  wellnessList: { gap: spacing.sm },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.mdSm },
  modeButton: { minWidth: 100, flexBasis: '30%', flexGrow: 1 }
});
