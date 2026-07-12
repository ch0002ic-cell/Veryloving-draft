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

export default function Home() {
  const { settings, updateSettings, device, selectedVoice } = useAppState();
  return (
    <Screen>
      <Header title="VeryLoving" subtitle="Safety companion dashboard" />
      <Card style={styles.hero}>
        <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <StatusPill label={`${settings.mode.toUpperCase()} MODE`} tone="active" />
          <Text style={styles.heroTitle}>{selectedVoice.displayName} is ready</Text>
          <Text style={styles.muted}>Voice, map, jewelry, and guardians are one tap away.</Text>
        </View>
      </Card>
      <View style={styles.grid}>
        <Button title="Safety call" icon="call" onPress={() => router.push('/safety-call')} />
        <Button title="SOS" icon="warning" variant="danger" onPress={() => router.push('/emergency-sos')} />
        <Button title="Friends" icon="people" variant="ghost" onPress={() => router.push('/friends')} />
        <Button title="Settings" icon="settings" variant="ghost" onPress={() => router.push('/settings')} />
      </View>
      <Card>
        <Text style={styles.section}>NorthStar Device</Text>
        <Text style={styles.muted}>{device.connected ? `${device.name} connected · ${device.battery}%` : 'No device connected'}</Text>
        <Button title="Manage device" variant="ghost" onPress={() => router.push('/device-management')} />
      </Card>
      <Card>
        <Text style={styles.section}>Mode</Text>
        <View style={styles.modeRow}>{['home', 'guardian', 'emergency'].map((mode) => <Button key={mode} title={mode} variant={settings.mode === mode ? 'orange' : 'ghost'} onPress={() => updateSettings({ mode })} />)}</View>
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
