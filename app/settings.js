import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { SettingsSection } from '../src/components/SettingsSection';
import { useAppState } from '../src/context/AppContext';
import { useAuth } from '../src/context/AuthContext';
import { deleteAllUserData, exportUserData, PRIVACY_POLICY_URL } from '../src/services/privacy';
import { colors, fonts, spacing } from '../src/constants/theme';
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

  const updatePreference = async (patch) => {
    try {
      await updateSettings(patch);
    } catch {
      Alert.alert(t('settings.updateFailedTitle'), t('settings.updateFailedMessage'));
    }
  };

  const handleSignOut = async () => {
    try {
      setBusyAction('signOut');
      await signOut();
      router.replace('/(auth)/onboarding');
    } catch {
      Alert.alert(t('settings.signOutFailedTitle'), t('settings.signOutFailedMessage'));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Screen>
      <Header title={t('common.settings')} subtitle={user?.name || t('common.user')} />

      <SettingsSection
        icon="language-outline"
        title={t('settings.sections.language')}
        subtitle={t('settings.sections.languageSubtitle')}
      >
        <LanguageSelector onError={() => Alert.alert(t('settings.updateFailedTitle'), t('settings.updateFailedMessage'))} />
      </SettingsSection>

      <SettingsSection
        icon="sparkles-outline"
        title={t('settings.sections.companion')}
        subtitle={t('settings.sections.companionSubtitle')}
      >
        <SettingLink
          icon="mic-outline"
          title={t('settings.changeVoice')}
          subtitle={t(`voices.profiles.${selectedVoice.id}.name`)}
          onPress={() => router.push('/voices')}
        />
        <View style={styles.divider} />
        <SettingToggle
          title={t('settings.showCompanion')}
          value={settings.showCompanion}
          onValueChange={(showCompanion) => updatePreference({ showCompanion })}
        />
        <View style={styles.divider} />
        <SettingToggle
          title={t('settings.offlineMode')}
          subtitle={t('settings.offlineModeSubtitle')}
          value={settings.offlineMode}
          onValueChange={(offlineMode) => updatePreference({ offlineMode })}
        />
      </SettingsSection>

      <SettingsSection
        icon="shield-checkmark-outline"
        title={t('settings.sections.deviceSafety')}
        subtitle={t('settings.sections.deviceSafetySubtitle')}
      >
        <SettingLink icon="call-outline" title={t('settings.emergencyContacts')} onPress={() => router.push('/emergency-contacts')} />
        <View style={styles.divider} />
        <SettingLink icon="hardware-chip-outline" title={t('settings.deviceManagement')} onPress={() => router.push('/device-management')} />
        <View style={styles.divider} />
        <SettingLink icon="people-outline" title={t('common.friends')} onPress={() => router.push('/friends')} />
      </SettingsSection>

      <SettingsSection
        icon="lock-closed-outline"
        title={t('settings.sections.privacy')}
        subtitle={t('settings.sections.privacySubtitle')}
      >
        <Text style={styles.body}>{t('settings.privacyBody')}</Text>
        <SettingLink icon="time-outline" title={t('history.title')} onPress={() => router.push('/conversation-history')} />
        <View style={styles.divider} />
        <SettingLink icon="document-text-outline" title={t('settings.privacyPolicy')} onPress={openPrivacyPolicy} />
        <Button title={busyAction === 'export' ? t('settings.preparingExport') : t('settings.exportData')} variant="ghost" loading={busyAction === 'export'} disabled={busyAction !== null} onPress={handleExport} />
        <Button title={busyAction === 'delete' ? t('settings.deleting') : t('settings.deleteAll')} variant="danger" loading={busyAction === 'delete'} disabled={busyAction !== null} onPress={confirmDeleteAllData} />
      </SettingsSection>

      <SettingsSection
        icon="person-circle-outline"
        title={t('settings.sections.account')}
        subtitle={t('settings.sections.accountSubtitle')}
      >
        <Text style={styles.accountName}>{user?.name || t('common.user')}</Text>
        {user?.email || user?.phone ? <Text style={styles.body}>{user.email || user.phone}</Text> : null}
        <Button
          title={t('settings.signOut')}
          variant="danger"
          loading={busyAction === 'signOut'}
          disabled={busyAction !== null}
          onPress={handleSignOut}
        />
      </SettingsSection>
    </Screen>
  );
}

function SettingLink({ icon, title, subtitle, onPress }) {
  return (
    <Pressable
      accessibilityRole="button"
      android_ripple={{ color: colors.line }}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={colors.inkSoft} />
      <View style={styles.linkCopy}>
        <Text style={styles.linkTitle}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkSoft} />
    </Pressable>
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
  body: { fontFamily: fonts.regular, color: colors.inkSoft, lineHeight: 20 },
  accountName: { fontFamily: fonts.bold, color: colors.ink, fontSize: 17 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  linkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm, overflow: 'hidden' },
  linkCopy: { flex: 1 },
  linkTitle: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  pressed: { opacity: 0.65 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  toggleText: { flex: 1 },
  toggleTitle: { fontFamily: fonts.bold, color: colors.ink },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft, marginTop: 4 }
});
