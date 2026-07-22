import { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
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
import { colors, motion, sizes, spacing, typography } from '../src/constants/theme';
import { LanguageSelector } from '../src/components/LanguageSelector';
import { useI18n } from '../src/context/I18nContext';
import { setCapybearReminderEnabled } from '../src/services/capybear-reminder';

export default function Settings() {
  const { settings, updateSettings, selectedVoice, resetLocalState, lockAndFlushLocalMutations } = useAppState();
  const { accessToken, signOut, user } = useAuth();
  const { isRTL, t } = useI18n();
  const [busyAction, setBusyAction] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const handleExport = async () => {
    if (busyAction) return;
    try {
      setFeedback(null);
      setBusyAction('export');
      await exportUserData({ accessToken });
    } catch {
      setFeedback({ messageKey: 'settings.exportFailedMessage', retry: 'export' });
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

  const openPrivacyPolicy = async () => {
    setFeedback(null);
    try {
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch {
      setFeedback({ messageKey: 'settings.linkFailed', retry: 'privacy' });
    }
  };

  const updatePreference = async (patch) => {
    if (busyAction) return;
    try {
      setFeedback(null);
      setBusyAction('preference');
      await updateSettings(patch);
    } catch {
      setFeedback({ messageKey: 'settings.updateFailedMessage' });
    } finally {
      setBusyAction(null);
    }
  };

  const updateReminderPreference = async (enabled) => {
    if (busyAction) return;
    setBusyAction('reminder');
    setFeedback(null);
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
      setFeedback({ messageKey: 'settings.updateFailedMessage' });
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
        // AuthContext durably writes the signed-out marker before any broad
        // settings sweep. Preserve that marker so a process death during
        // cleanup cannot resurrect a residual secure session.
        await signOut();
        const deletion = await deleteLocalUserData({
          localMutationLockHeld: true,
          preserveSignedOutTombstone: true,
          preserveLanguage: true
        });
        deletionWarning = hasLocalUserDataDeletionWarnings(deletion);
      } catch {
        deletionWarning = true;
      }
      resetLocalState({ language: settings.language });
      router.replace('/(auth)/onboarding');
      if (deletionWarning) Alert.alert(t('settings.deleteFailedTitle'), t('settings.deleteFailedMessage'));
    } catch {
      Alert.alert(t('settings.signOutFailedTitle'), t('settings.signOutFailedMessage'));
    } finally {
      releaseLocalMutations?.();
      setBusyAction(null);
    }
  };

  const retryFeedback = () => {
    const retry = feedback?.retry;
    setFeedback(null);
    if (retry === 'export') void handleExport();
    else if (retry === 'privacy') void openPrivacyPolicy();
  };

  return (
    <Screen>
      <Header title={t('common.settings')} subtitle={user?.name || t('common.user')} showBack backLabel={t('common.back')} />
      <FeedbackBanner
        message={feedback?.messageKey ? t(feedback.messageKey) : null}
        actionLabel={feedback?.retry ? t('common.retry') : undefined}
        onAction={feedback?.retry ? retryFeedback : undefined}
        dismissLabel={t('common.close')}
        onDismiss={() => setFeedback(null)}
      />

      <SettingsSection
        icon="language-outline"
        title={t('settings.sections.language')}
        subtitle={t('settings.sections.languageSubtitle')}
      >
        <LanguageSelector onError={() => setFeedback({ messageKey: 'settings.updateFailedMessage' })} />
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
          disabled={busyAction !== null}
          onValueChange={(showCompanion) => updatePreference({ showCompanion })}
        />
        <View style={styles.divider} />
        <SettingToggle
          title={t('settings.offlineMode')}
          subtitle={t('settings.offlineModeSubtitle')}
          value={settings.offlineMode}
          disabled={busyAction !== null}
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
        title={t('settings.deviceManagement')}
        subtitle={`${t('home.northStarDevice')} · ${t('medication.robot')}`}
      >
        <SettingLink icon="watch-outline" title={t('settings.deviceManagement')} onPress={() => router.push('/device-management')} />
        <View style={styles.divider} />
        <SettingLink icon="qr-code-outline" title={t('common.add')} onPress={() => router.push('/robot-pairing')} />
      </SettingsSection>

      <SettingsSection
        icon="shield-checkmark-outline"
        title={t('settings.sections.deviceSafety')}
        subtitle={t('settings.sections.deviceSafetySubtitle')}
      >
        <SettingLink icon="call-outline" title={t('settings.emergencyContacts')} onPress={() => router.push('/emergency-contacts')} />
        <View style={styles.divider} />
        <SettingLink icon="medical-outline" title={t('medicalProfile.title')} subtitle={t('medicalProfile.subtitle')} onPress={() => router.push('/medical-profile')} />
        <View style={styles.divider} />
        <SettingLink icon="medkit-outline" title={t('medication.title')} onPress={() => router.push('/medication-reminders')} />
        <View style={styles.divider} />
        <SettingLink icon="people-outline" title={t('common.friends')} onPress={() => router.push('/friends')} />
      </SettingsSection>

      <SettingsSection
        icon="sparkles-outline"
        title={t('wellness.title')}
        subtitle={t('wellness.subtitle')}
      >
        <SettingLink
          icon="git-network-outline"
          title={t('wellness.scenarios.title')}
          subtitle={t('wellness.scenarios.subtitle')}
          onPress={() => router.push('/scenario-center')}
        />
        <View style={styles.divider} />
        <SettingLink
          icon="heart-outline"
          title={t('wellness.emotional.title')}
          subtitle={t('wellness.emotional.subtitle')}
          onPress={() => router.push('/emotional-check-in')}
        />
        <View style={styles.divider} />
        <SettingLink
          icon="extension-puzzle-outline"
          title={t('wellness.cognitive.title')}
          subtitle={t('wellness.cognitive.subtitle')}
          onPress={() => router.push('/cognitive-engagement')}
        />
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
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      accessibilityRole="button"
      android_ripple={{ color: colors.borderSubtle }}
      onPress={onPress}
      style={({ pressed }) => [styles.linkRow, isRTL && styles.rtlRow, pressed && styles.pressed]}
    >
      <Ionicons accessible={false} name={icon} size={sizes.icon} color={colors.textSecondary} />
      <View style={styles.linkCopy}>
        <Text style={[styles.linkTitle, isRTL && styles.rtlText]}>{title}</Text>
        {subtitle ? <Text style={[styles.muted, isRTL && styles.rtlText]}>{subtitle}</Text> : null}
      </View>
      <Ionicons accessible={false} name={isRTL ? 'chevron-back' : 'chevron-forward'} size={sizes.iconSmall} color={colors.textSecondary} />
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
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        value={value}
        onValueChange={onValueChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.bodySmall, color: colors.textSecondary },
  accountName: { ...typography.heading, color: colors.textPrimary },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle },
  linkRow: { minHeight: sizes.headerControl, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  linkCopy: { flex: 1 },
  linkTitle: { ...typography.label, color: colors.textPrimary },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] },
  toggleRow: { minHeight: sizes.touchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.mdSm },
  toggleText: { flex: 1 },
  toggleTitle: { ...typography.label, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }
});
