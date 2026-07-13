import { Image, StyleSheet, Text, View } from 'react-native';
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

export default function Home() {
  const { settings, updateSettings, device, selectedVoice } = useAppState();
  const { t } = useI18n();
  const voiceName = t(`voices.profiles.${selectedVoice.id}.name`);
  const modeName = t(`home.modes.${settings.mode}`);
  const hasBatteryReading = Number.isFinite(device.battery);
  const deviceStatus = device.connected
    ? (hasBatteryReading
      ? t('home.deviceConnected', { name: device.name, battery: device.battery })
      : `${device.name} · ${t('safetyCall.connected')}`)
    : (device.connectionState === 'reconnecting' ? t('common.connecting') : t('home.noDevice'));
  return (
    <Screen>
      <Header title={t('common.veryLoving')} subtitle={t('home.subtitle')} />
      <Card style={styles.hero}>
        <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <StatusPill label={t('home.modeStatus', { mode: modeName.toUpperCase() })} tone="active" />
          <Text style={styles.heroTitle}>{t('home.companionReady', { name: voiceName })}</Text>
          <Text style={styles.muted}>{t('home.readyBody')}</Text>
        </View>
      </Card>
      <View style={styles.grid}>
        <Button title={t('home.safetyCall')} icon="call" onPress={() => router.push('/safety-call')} />
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
        <View style={styles.modeRow}>{['home', 'guardian', 'emergency'].map((mode) => <Button key={mode} title={t(`home.modes.${mode}`)} variant={settings.mode === mode ? 'orange' : 'ghost'} onPress={() => updateSettings({ mode })} />)}</View>
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
