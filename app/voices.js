import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { voiceProfiles } from '../src/constants/voiceProfiles';
import { useAppState } from '../src/context/AppContext';
import { colors, motion, radii, sizes, spacing, tones, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

const VoiceOption = memo(function VoiceOption({
  voice,
  selected,
  previewing,
  saving,
  interactionDisabled,
  onSelect,
  onPreview
}) {
  const { isRTL, t } = useI18n();
  const name = t(`voices.profiles.${voice.id}.name`);
  const description = t(`voices.profiles.${voice.id}.description`);
  return (
    <Card style={[styles.card, selected && styles.selected]}>
      <Pressable
        accessibilityLabel={name}
        accessibilityHint={description}
        accessibilityRole="radio"
        accessibilityState={{ busy: saving, checked: selected, disabled: interactionDisabled }}
        disabled={interactionDisabled}
        onPress={onSelect}
        style={({ pressed }) => [
          styles.selectionArea,
          isRTL && styles.rtlRow,
          pressed && !interactionDisabled && styles.pressed,
          interactionDisabled && styles.disabled
        ]}
      >
        <View style={styles.avatarFrame}>
          <Image accessible={false} source={voice.avatar} style={styles.avatar} resizeMode="contain" />
          {saving ? (
            <View
              accessibilityLabel={t('common.loading')}
              accessibilityRole="progressbar"
              accessibilityState={{ busy: true }}
              style={styles.badge}
            >
              <ActivityIndicator size="small" color={colors.textInverse} />
            </View>
          ) : selected ? (
            <View style={styles.badge}>
              <Ionicons accessible={false} name="checkmark-circle" size={sizes.iconSmall} color={colors.textInverse} />
              <Text style={styles.badgeText}>{t('common.selected')}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.copy}>
          <Text style={[styles.name, isRTL && styles.rtlText]}>{name}</Text>
          <Text style={[styles.desc, isRTL && styles.rtlText]}>{description}</Text>
        </View>
      </Pressable>
      <Button
        title={previewing ? t('voices.stop') : t('voices.test')}
        icon={previewing ? 'stop-circle-outline' : 'play-circle-outline'}
        variant="ghost"
        disabled={interactionDisabled}
        selected={previewing}
        onPress={onPreview}
      />
    </Card>
  );
});

export default function Voices() {
  const { settings, updateSettings } = useAppState();
  const player = useAudioPlayer(null, { updateInterval: 150 });
  const playerStatus = useAudioPlayerStatus(player);
  const [previewingId, setPreviewingId] = useState(null);
  const [savingVoiceId, setSavingVoiceId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const { t } = useI18n();

  useEffect(() => {
    if (playerStatus.didJustFinish) setPreviewingId(null);
  }, [playerStatus.didJustFinish]);

  const selectVoice = async (voiceId) => {
    if (savingVoiceId || settings.selectedVoiceId === voiceId) return;
    try {
      setFeedback(null);
      setSavingVoiceId(voiceId);
      await updateSettings({ selectedVoiceId: voiceId });
    } catch {
      setFeedback({ action: 'select', messageKey: 'voices.selectionFailedMessage', voiceId });
    } finally {
      setSavingVoiceId(null);
    }
  };

  const previewVoice = async (voice) => {
    try {
      setFeedback(null);
      if (previewingId === voice.id) {
        player.pause();
        await player.seekTo(0).catch(() => {});
        setPreviewingId(null);
        return;
      }
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: 'mixWithOthers'
      });
      player.replace(voice.preview);
      player.play();
      setPreviewingId(voice.id);
    } catch {
      setPreviewingId(null);
      setFeedback({ action: 'preview', messageKey: 'voices.sampleFailedMessage', voice });
    }
  };

  const retryFeedback = () => {
    const failedAction = feedback;
    setFeedback(null);
    if (failedAction?.action === 'select') selectVoice(failedAction.voiceId);
    else if (failedAction?.action === 'preview' && failedAction.voice) previewVoice(failedAction.voice);
  };

  return (
    <Screen scroll={false}>
      <Header title={t('voices.title')} subtitle={t('voices.subtitle')} showBack backLabel={t('common.back')} />
      <FeedbackBanner
        message={feedback?.messageKey ? t(feedback.messageKey) : null}
        actionLabel={t('common.retry')}
        onAction={feedback ? retryFeedback : undefined}
        dismissLabel={t('common.close')}
        onDismiss={() => setFeedback(null)}
      />
      <FlatList
        data={voiceProfiles}
        extraData={{ selectedVoiceId: settings.selectedVoiceId, previewingId, savingVoiceId }}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={(
          <EmptyState title={t('voices.title')} message={t('voices.subtitle')} />
        )}
        renderItem={({ item }) => (
          <VoiceOption
            voice={item}
            selected={settings.selectedVoiceId === item.id}
            previewing={previewingId === item.id}
            saving={savingVoiceId === item.id}
            interactionDisabled={Boolean(savingVoiceId)}
            onSelect={() => selectVoice(item.id)}
            onPreview={() => previewVoice(item)}
          />
        )}
        contentContainerStyle={styles.list}
        style={styles.listView}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listView: { flex: 1 },
  list: { flexGrow: 1, paddingBottom: spacing.lg },
  card: { marginBottom: spacing.mdSm, gap: spacing.mdSm },
  selected: { borderColor: colors.actionAccent, borderWidth: 2, backgroundColor: tones.accent.background },
  selectionArea: { minHeight: sizes.controlLarge * 2, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] },
  disabled: { opacity: 0.55 },
  avatarFrame: { width: sizes.controlLarge * 2, minHeight: sizes.controlLarge * 2, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: sizes.control * 2, height: sizes.control * 2 },
  badge: { position: 'absolute', bottom: spacing.none, minHeight: sizes.iconLarge, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.greenAccessible, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.md },
  badgeText: { color: colors.textInverse, ...typography.caption, fontFamily: typography.label.fontFamily },
  copy: { flex: 1, gap: spacing.xs },
  name: { ...typography.title, color: colors.textPrimary },
  desc: { ...typography.bodySmall, color: colors.textSecondary }
});
