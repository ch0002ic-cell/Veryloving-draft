import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { StatusPill } from '../../../src/components/StatusPill';
import { voiceProfiles } from '../../../src/constants/voiceProfiles';
import { useAppState } from '../../../src/context/AppContext';
import { useI18n } from '../../../src/context/I18nContext';
import { colors, spacing, tones, typography } from '../../../src/constants/theme';
import { logger } from '../../../src/utils/logger';
import { FeedbackBanner } from '../../../src/components/FeedbackBanner';
import { useOnboardingNavigation } from '../../../src/hooks/useOnboardingNavigation';

export default function ChooseVoiceTutorial() {
  const { settings, updateSettings } = useAppState();
  const { isRTL, t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  const [savingVoiceId, setSavingVoiceId] = useState(null);
  const [selectionErrorVoiceId, setSelectionErrorVoiceId] = useState(null);

  const selectVoice = async (voiceId) => {
    if (savingVoiceId || settings.selectedVoiceId === voiceId) return;
    setSelectionErrorVoiceId(null);
    setSavingVoiceId(voiceId);
    try {
      await updateSettings({ selectedVoiceId: voiceId });
    } catch (error) {
      logger.warn('[Onboarding] Could not persist voice selection', {
        errorCode: error?.code || error?.name || 'VOICE_SELECTION_PERSIST_FAILED',
        voiceId
      });
      setSelectionErrorVoiceId(voiceId);
    } finally {
      setSavingVoiceId(null);
    }
  };

  return (
    <Screen>
      <Header title={t('tutorial.chooseVoiceTitle')} subtitle={t('tutorial.chooseVoiceSubtitle')} />
      <FeedbackBanner
        message={selectionErrorVoiceId ? t('voices.selectionFailedMessage') : null}
        actionLabel={selectionErrorVoiceId ? t('common.retry') : undefined}
        onAction={selectionErrorVoiceId ? () => selectVoice(selectionErrorVoiceId) : undefined}
        dismissLabel={t('common.close')}
        onDismiss={() => setSelectionErrorVoiceId(null)}
      />
      {voiceProfiles.map((voice) => {
        const selected = settings.selectedVoiceId === voice.id;
        return (
          <Card key={voice.id} style={[styles.voiceCard, isRTL && styles.rtlRow, selected && styles.selectedCard]}>
            <Image accessible={false} source={voice.avatar} style={styles.avatar} resizeMode="contain" />
            <View style={styles.voiceCopy}>
              <Text style={[styles.voiceName, isRTL && styles.rtlText]}>{t(`voices.profiles.${voice.id}.name`)}</Text>
              <Text style={[styles.voiceDescription, isRTL && styles.rtlText]}>{t(`voices.profiles.${voice.id}.description`)}</Text>
              {selected ? <StatusPill label={t('common.selected')} tone="active" /> : null}
              <Button
                compact
                title={selected ? t('common.selected') : t('auth.chooseVoice')}
                variant={selected ? 'orange' : 'ghost'}
                onPress={() => selectVoice(voice.id)}
                loading={savingVoiceId === voice.id}
                disabled={selected || Boolean(savingVoiceId)}
              />
            </View>
          </Card>
        );
      })}
      <FeedbackBanner message={navigationError} />
      <Button
        title={t('common.continue')}
        loading={advancing}
        onPress={() => advanceTo('/(auth)/tutorial/home-mode')}
        disabled={Boolean(savingVoiceId) || advancing}
      />
      <Button
        title={t('common.skipTutorial')}
        variant="ghost"
        onPress={() => advanceTo('/(auth)/completion', { replace: true })}
        disabled={Boolean(savingVoiceId) || advancing}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  voiceCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  selectedCard: { borderColor: colors.actionAccent, borderWidth: 2, backgroundColor: tones.accent.background },
  avatar: { width: 100, height: 100 },
  voiceCopy: { flex: 1, alignItems: 'stretch', gap: spacing.sm },
  voiceName: { ...typography.heading, color: colors.textPrimary },
  voiceDescription: { ...typography.bodySmall, color: colors.textSecondary }
});
