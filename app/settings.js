import { useState } from 'react';
import { Alert, Linking, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { useAppState } from '../src/context/AppContext';
import { useAuth } from '../src/context/AuthContext';
import { deleteAllUserData, exportUserData, PRIVACY_POLICY_URL } from '../src/services/privacy';
import { colors, fonts } from '../src/constants/theme';

export default function Settings() {
  const { settings, updateSettings, selectedVoice, resetLocalState } = useAppState();
  const { signOut, user } = useAuth();
  const [busyAction, setBusyAction] = useState(null);

  const handleExport = async () => {
    try {
      setBusyAction('export');
      await exportUserData();
    } catch (error) {
      Alert.alert('Export failed', error.message || 'Unable to export your data right now.');
    } finally {
      setBusyAction(null);
    }
  };

  const confirmDeleteAllData = () => {
    Alert.alert(
      'Delete all local data?',
      'This removes your profile, settings, emergency contacts, conversation history, permission reminders, and local auth session from this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusyAction('delete');
              await deleteAllUserData();
              resetLocalState();
              await signOut();
              router.replace('/(auth)/onboarding');
            } catch (error) {
              Alert.alert('Deletion failed', error.message || 'Unable to delete local data right now.');
            } finally {
              setBusyAction(null);
            }
          }
        }
      ]
    );
  };

  const openPrivacyPolicy = () => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
    Alert.alert('Unable to open link', PRIVACY_POLICY_URL);
  });

  return (
    <Screen>
      <Header title="Settings" subtitle={user?.name || 'VeryLoving user'} />

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Voice</Text>
        <Text style={styles.body}>{selectedVoice.displayName}</Text>
        <Button title="Change voice" variant="ghost" onPress={() => router.push('/voices')} />
      </Card>

      <Card style={styles.card}>
        <SettingToggle
          title="Show companion"
          value={settings.showCompanion}
          onValueChange={(showCompanion) => updateSettings({ showCompanion })}
        />
        <SettingToggle
          title="Offline mode"
          subtitle="Use bundled companion responses when the network or Hume credentials are unavailable."
          value={settings.offlineMode}
          onValueChange={(offlineMode) => updateSettings({ offlineMode })}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Privacy & data</Text>
        <Text style={styles.body}>Export or delete the local data stored on this device.</Text>
        <Button title="Conversation history" variant="ghost" onPress={() => router.push('/conversation-history')} />
        <Button title={busyAction === 'export' ? 'Preparing export...' : 'Export my data'} variant="ghost" disabled={busyAction !== null} onPress={handleExport} />
        <Button title="Privacy policy" variant="ghost" onPress={openPrivacyPolicy} />
        <Button title={busyAction === 'delete' ? 'Deleting...' : 'Delete all local data'} variant="danger" disabled={busyAction !== null} onPress={confirmDeleteAllData} />
      </Card>

      <Button title="Device management" variant="ghost" onPress={() => router.push('/device-management')} />
      <Button title="Friends" variant="ghost" onPress={() => router.push('/friends')} />
      <Button title="Sign out" variant="danger" onPress={async () => { await signOut(); router.replace('/(auth)/onboarding'); }} />
    </Screen>
  );
}

function SettingToggle({ title, subtitle, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  cardTitle: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  body: { fontFamily: fonts.regular, color: colors.inkSoft },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  toggleText: { flex: 1 },
  toggleTitle: { fontFamily: fonts.bold, color: colors.ink },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft, marginTop: 4 }
});
