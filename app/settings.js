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
import {
  deleteAllUserData,
  deleteLocalUserData,
  exportUserData,
  hasLocalUserDataDeletionWarnings,
  PRIVACY_POLICY_URL
} from '../src/services/privacy';
import { colors, fonts, spacing } from '../src/constants/theme';
import { LanguageSelector } from '../src/components/LanguageSelector';
import { useI18n } from '../src/context/I18nContext';
import { setCapybearReminderEnabled } from '../src/services/capybear-reminder';

export default function Settings() {
  const { settings, updateSettings, selectedVoice, resetLocalState, lockAndFlushLocalMutations } = useAppState();
  const { accessToken, signOut, user } = useAuth();
  const { isRTL, t } = useI18n();
  const [busyAction, setBusyAction] = useState(null);

  const handleExport = async () => {
    try {
      setBusyAction('export');
      await exportUserData({ accessToken });
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
            let releaseLocalMutations;
            try {
              setBusyAction('delete');
              releaseLocalMutations = await lockAndFlushLocalMutations();
              const deletion = await deleteAllUserData({ accessToken, localMutationLockHeld: true });
              resetLocalState();
              await signOut();
              router.replace('/(auth)/onboarding');
              if (hasLocalUserDataDeletionWarnings(deletion)) {
                Alert.alert(t('settings.deleteFailedTitle'), t('settings.deleteFailedMessage'));
              }
            } catch {
              Alert.alert(t('settings.deleteFailedTitle'), t('settings.deleteFailedMessage'));
            } finally {
              releaseLocalMutations?.();
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

  const updateReminderPreference = async (enabled) => {
    if (busyAction) return;
    setBusyAction('reminder');
    try {
      const result = await setCapybearReminderEnabled(enabled);
      if (enabled && !result.enabled) {
        Alert.alert(t('permissions.notificationsTitle'), t('permissions.notificationsRationaleMessage'));
        return;
      }
      try {
        await updateSettings({ reminderEnabled: result.enabled });
      } catch (error) {
        await setCapybearReminderEnabled(!result.enabled).catch(() => {});
        throw error;
      }
    } catch {
      Alert.alert(t('settings.updateFailedTitle'), t('settings.updateFailedMessage'));
    } finally {
      setBusyAction(null);
    }
  };

  const handleSignOut = async () => {
    let releaseLocalMutations;
    let deletionWarning = false;
    try {
      setBusyAction('signOut');
      try {
        releaseLocalMutations = await lockAndFlushLocalMutations();
        const deletion = await deleteLocalUserData({
          localMutationLockHeld: true,
          preserveLanguage: true
        });
        deletionWarning = hasLocalUserDataDeletionWarnings(deletion);
      } catch {
        deletionWarning = true;
      }
      resetLocalState({ language: settings.language });
      await signOut();
      router.replace('/(auth)/onboarding');
      if (deletionWarning) Alert.alert(t('settings.deleteFailedTitle'), t('settings.deleteFailedMessage'));
    } catch {
      Alert.alert(t('settings.signOutFailedTitle'), t('settings.signOutFailedMessage'));
    } finally {
      releaseLocalMutations?.();
      setBusyAction(null);
    }
  };

  return (
    <Screen>
      <Header title={t('common.settings')} subtitle={user?.name || t('common.user')} showBack backLabel={t('common.back')} />

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
        <View style={styles.divider} />
        <SettingToggle
          title={t('auth.capybearReminder')}
          subtitle={t('permissions.notificationsBody')}
          value={settings.reminderEnabled}
          disabled={busyAction !== null}
          onValueChange={updateReminderPreference}
        />
      </SettingsSection>

      <SettingsSection
        icon="hardware-chip-outline"
        title="My Devices"
        subtitle="Wearables and home robots paired to your account"
      >
        <SettingLink icon="watch-outline" title="Manage paired devices" onPress={() => router.push('/device-management')} />
        <View style={styles.divider} />
        <SettingLink icon="qr-code-outline" title="Pair a home robot" onPress={() => router.push('/robot-pairing')} />
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
        <Text style={[styles.body, isRTL && styles.rtlText]}>{t('settings.privacyBody')}</Text>
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
        <Text style={[styles.accountName, isRTL && styles.rtlText]}>{user?.name || t('common.user')}</Text>
        {user?.email || user?.phone ? <Text style={[styles.body, isRTL && styles.rtlText]}>{user.email || user.phone}</Text> : null}
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
  const { isRTL } = useI18n();
  return (
    <Pressable
      accessibilityRole="button"
      android_ripple={{ color: colors.line }}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, isRTL && styles.rtlRow, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={colors.inkSoft} />
      <View style={styles.linkCopy}>
        <Text style={[styles.linkTitle, isRTL && styles.rtlText]}>{title}</Text>
        {subtitle ? <Text style={[styles.muted, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
      </View>
      <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.inkSoft} />
    </Pressable>
  );
}

function SettingToggle({ title, subtitle, value, disabled = false, onValueChange }) {
  const { isRTL } = useI18n();
  return (
    <View style={[styles.toggleRow, isRTL && styles.rtlRow]}>
      <View style={styles.toggleText}>
        <Text style={[styles.toggleTitle, isRTL && styles.rtlText]}>{title}</Text>
        {subtitle ? <Text style={[styles.muted, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityHint={subtitle}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { fontFamily: fonts.regular, color: colors.inkSoft, lineHeight: 20 },
  accountName: { fontFamily: fonts.bold, color: colors.ink, fontSize: 17 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  linkRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm, overflow: 'hidden' },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  linkCopy: { flex: 1 },
  linkTitle: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  pressed: { opacity: 0.65 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  toggleText: { flex: 1 },
  toggleTitle: { fontFamily: fonts.bold, color: colors.ink },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft, marginTop: 4 }
});
