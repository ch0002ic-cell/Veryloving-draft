import { useEffect, useRef, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { StatusPill } from '../../src/components/StatusPill';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';
import { useAppState } from '../../src/context/AppContext';
import { useI18n } from '../../src/context/I18nContext';
import { logger } from '../../src/utils/logger';
import { useAuth } from '../../src/context/AuthContext';
import { activateSafetyMode, fetchCurrentSafetyMode } from '../../src/services/safety-api';
import { config } from '../../src/utils/config';

export default function Home() {
  const { settings, updateSettings, device, selectedVoice } = useAppState();
  const { accessToken } = useAuth();
  const { t } = useI18n();
  const [changingMode, setChangingMode] = useState(null);
  const modeChangeRef = useRef(null);
  const modeReconciledRef = useRef(false);
  const voiceName = t(`voices.profiles.${selectedVoice.id}.name`);
  const modeName = t(`home.modes.${settings.mode}`);
  const hasBatteryReading = Number.isFinite(device.battery);
  const deviceStatus = device.connected
    ? (hasBatteryReading
      ? t('home.deviceConnected', { name: device.name, battery: device.battery })
      : `${device.name} · ${t('safetyCall.connected')}`)
    : (device.connectionState === 'reconnecting' ? t('common.connecting') : t('home.noDevice'));

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
    } catch (error) {
      logger.warn('[SafetyMode] Could not save the requested local mode', {
        requestedMode: mode,
        errorCode: error?.code || error?.name || 'MODE_SAVE_FAILED'
      });
      Alert.alert(t('settings.updateFailedTitle'), t('settings.updateFailedMessage'));
    } finally {
      modeChangeRef.current = null;
      setChangingMode(null);
    }
  };

  return (
    <Screen>
      <Header title={t('common.veryLoving')} subtitle={t('home.subtitle')} />
      <Card style={styles.hero}>
        <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <StatusPill label={t('home.modeStatus', { mode: modeName })} tone="active" />
          <Text style={styles.heroTitle}>{t('home.companionReady', { name: voiceName })}</Text>
          <Text style={styles.muted}>{t('home.readyBody')}</Text>
        </View>
      </Card>
      <View style={styles.grid}>
        {settings.showCompanion ? (
          <Button title={t('home.safetyCall')} icon="call" onPress={() => router.push('/safety-call')} />
        ) : null}
        <Button title={t('common.sos')} icon="warning" variant="danger" onPress={() => router.push('/emergency-sos')} />
        <Button title={t('common.friends')} icon="people" variant="ghost" onPress={() => router.push('/friends')} />
        <Button title={t('common.settings')} icon="settings" variant="ghost" onPress={() => router.push('/settings')} />
      </View>
      <Card>
        <Text style={styles.section}>{t('home.northStarDevice')}</Text>
        <Text style={styles.muted}>{deviceStatus}</Text>
        <Button title={t('home.manageDevice')} variant="ghost" onPress={() => router.push('/device-management')} />
      </Card>
      <Card>
        <Text style={styles.section}>{t('home.mode')}</Text>
        <View style={styles.modeRow}>
          {['home', 'guardian', 'emergency'].map((mode) => (
            <Button
              key={mode}
              title={t(`home.modes.${mode}`)}
              variant={settings.mode === mode ? 'orange' : 'ghost'}
              onPress={() => changeSafetyMode(mode)}
              loading={changingMode === mode}
              disabled={Boolean(changingMode) && changingMode !== mode}
            />
          ))}
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  avatar: { width: 96, height: 96 },
  heroTitle: { fontFamily: fonts.bold, color: colors.ink, fontSize: 22, marginTop: 10 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft, lineHeight: 20, marginVertical: 8 },
  grid: { gap: 10 },
  section: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18, marginBottom: 8 },
  modeRow: { gap: 8 }
});
