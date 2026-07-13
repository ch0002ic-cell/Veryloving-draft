import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { Header } from '../../../src/components/Header';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { StatusPill } from '../../../src/components/StatusPill';
import { voiceProfiles } from '../../../src/mocks/voiceProfiles';
import { useAppState } from '../../../src/context/AppContext';
import { useI18n } from '../../../src/context/I18nContext';
import { colors, fonts } from '../../../src/constants/theme';
import { logger } from '../../../src/utils/logger';

export default function ChooseVoiceTutorial() {
  const { settings, updateSettings } = useAppState();
  const { t } = useI18n();
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
          <Card key={voice.id} style={[styles.voiceCard, selected && styles.selectedCard]}>
            <Image source={voice.avatar} style={styles.avatar} resizeMode="contain" />
            <View style={styles.voiceCopy}>
              <Text style={styles.voiceName}>{t(`voices.profiles.${voice.id}.name`)}</Text>
              <Text style={styles.voiceDescription}>{t(`voices.profiles.${voice.id}.description`)}</Text>
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
      <Button
        title={t('common.continue')}
        onPress={() => router.push('/(auth)/completion')}
        disabled={Boolean(savingVoiceId)}
      />
      <Button
        title={t('common.skipTutorial')}
        variant="ghost"
        onPress={() => router.replace('/(auth)/completion')}
        disabled={Boolean(savingVoiceId)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  voiceCard: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectedCard: { borderColor: colors.orange, borderWidth: 2, backgroundColor: colors.orangeSoft },
  avatar: { width: 100, height: 100 },
  voiceCopy: { flex: 1, alignItems: 'stretch', gap: 7 },
  voiceName: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  voiceDescription: { fontFamily: fonts.regular, color: colors.inkSoft, lineHeight: 20 }
});
