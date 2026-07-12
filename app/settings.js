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
import { LanguageSelector } from '../src/components/LanguageSelector';
import { useI18n } from '../src/context/I18nContext';

export default function Settings() {
  const { settings, updateSettings, selectedVoice, resetLocalState } = useAppState();
  const { signOut, user } = useAuth();
  const { t } = useI18n();
  const [busyAction, setBusyAction] = useState(null);

  const handleExport = async () => {
    try {
      setBusyAction('export');
      await exportUserData();
    } catch {
      Alert.alert(t('settings.exportFailedTitle'), t('settings.exportFailedMessage'));
    } finally {
      setBusyAction(null);
    }
  };

  const confirmDeleteAllData = () => {
    Alert.alert(
      t('settings.deleteConfirmTitle'),
      t('settings.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteEverything'),
          style: 'destructive',
          onPress: async () => {
            try {
              setBusyAction('delete');
              await deleteAllUserData();
              resetLocalState();
              await signOut();
              router.replace('/(auth)/onboarding');
            } catch {
              Alert.alert(t('settings.deleteFailedTitle'), t('settings.deleteFailedMessage'));
            } finally {
              setBusyAction(null);
            }
          }
        }
      ]
    );
  };

  const openPrivacyPolicy = () => Linking.openURL(PRIVACY_POLICY_URL).catch(() => {
    Alert.alert(t('settings.linkFailed'), PRIVACY_POLICY_URL);
  });

  return (
    <Screen>
      <Header title={t('common.settings')} subtitle={user?.name || t('common.user')} />

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t('languages.title')}</Text>
        <Text style={styles.body}>{t('languages.subtitle')}</Text>
        <LanguageSelector />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t('settings.voice')}</Text>
        <Text style={styles.body}>{t(`voices.profiles.${selectedVoice.id}.name`)}</Text>
        <Button title={t('settings.changeVoice')} variant="ghost" onPress={() => router.push('/voices')} />
      </Card>

      <Card style={styles.card}>
        <SettingToggle
          title={t('settings.showCompanion')}
          value={settings.showCompanion}
          onValueChange={(showCompanion) => updateSettings({ showCompanion })}
        />
        <SettingToggle
          title={t('settings.offlineMode')}
          subtitle={t('settings.offlineModeSubtitle')}
          value={settings.offlineMode}
          onValueChange={(offlineMode) => updateSettings({ offlineMode })}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{t('settings.privacyData')}</Text>
        <Text style={styles.body}>{t('settings.privacyBody')}</Text>
        <Button title={t('history.title')} variant="ghost" onPress={() => router.push('/conversation-history')} />
        <Button title={busyAction === 'export' ? t('settings.preparingExport') : t('settings.exportData')} variant="ghost" disabled={busyAction !== null} onPress={handleExport} />
        <Button title={t('settings.privacyPolicy')} variant="ghost" onPress={openPrivacyPolicy} />
        <Button title={busyAction === 'delete' ? t('settings.deleting') : t('settings.deleteAll')} variant="danger" disabled={busyAction !== null} onPress={confirmDeleteAllData} />
      </Card>

      <Button title={t('settings.emergencyContacts')} icon="call" variant="ghost" onPress={() => router.push('/emergency-contacts')} />
      <Button title={t('settings.deviceManagement')} variant="ghost" onPress={() => router.push('/device-management')} />
      <Button title={t('common.friends')} variant="ghost" onPress={() => router.push('/friends')} />
      <Button title={t('settings.signOut')} variant="danger" onPress={async () => { await signOut(); router.replace('/(auth)/onboarding'); }} />
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
