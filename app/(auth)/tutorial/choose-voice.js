import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../../src/components/Screen';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { StatusPill } from '../../../src/components/StatusPill';
import { voiceProfiles } from '../../../src/constants/voiceProfiles';
import { useAppState } from '../../../src/context/AppContext';
import { useI18n } from '../../../src/context/I18nContext';
import { colors, fonts } from '../../../src/constants/theme';
import { logger } from '../../../src/utils/logger';
import { FeedbackBanner } from '../../../src/components/FeedbackBanner';
import { useOnboardingNavigation } from '../../../src/hooks/useOnboardingNavigation';

export default function ChooseVoiceTutorial() {
  const { settings, updateSettings } = useAppState();
  const { isRTL, t } = useI18n();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  const [savingVoiceId, setSavingVoiceId] = useState(null);

  const selectVoice = async (voiceId) => {
    if (savingVoiceId || settings.selectedVoiceId === voiceId) return;
    setSavingVoiceId(voiceId);
    try {
      await updateSettings({ selectedVoiceId: voiceId });
    } catch (error) {
      logger.warn('[Onboarding] Could not persist voice selection', {
        errorCode: error?.code || error?.name || 'VOICE_SELECTION_PERSIST_FAILED',
        voiceId
      });
      Alert.alert(t('voices.selectionFailedTitle'), t('voices.selectionFailedMessage'));
    } finally {
      setSavingVoiceId(null);
    }
  };

  return (
    <Screen>
      <Header title={t('tutorial.chooseVoiceTitle')} subtitle={t('tutorial.chooseVoiceSubtitle')} />
      {voiceProfiles.map((voice) => {
        const selected = settings.selectedVoiceId === voice.id;
        return (
          <Card key={voice.id} style={[styles.voiceCard, isRTL && styles.rtlRow, selected && styles.selectedCard]}>
            <Image source={voice.avatar} style={styles.avatar} resizeMode="contain" />
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
  voiceCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  selectedCard: { borderColor: colors.orangeAccessible, borderWidth: 2, backgroundColor: colors.orangeSoft },
  avatar: { width: 100, height: 100 },
  voiceCopy: { flex: 1, alignItems: 'stretch', gap: 7 },
  voiceName: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  voiceDescription: { fontFamily: fonts.regular, color: colors.inkSoft, lineHeight: 20 }
});
