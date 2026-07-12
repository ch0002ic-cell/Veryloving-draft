import { memo, useEffect, useState } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { voiceProfiles } from '../src/mocks/voiceProfiles';
import { useAppState } from '../src/context/AppContext';
import { colors, fonts } from '../src/constants/theme';

const VoiceOption = memo(function VoiceOption({ voice, selected, previewing, onSelect, onPreview }) {
  return (
    <Card style={[styles.card, selected && styles.selected]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        onPress={onSelect}
        style={({ pressed }) => [styles.selectionArea, pressed && styles.pressed]}
      >
        <View style={styles.avatarFrame}>
          <Image source={voice.avatar} style={styles.avatar} resizeMode="contain" />
          {selected ? (
            <View style={styles.badge}>
              <Ionicons name="checkmark-circle" size={16} color="#fff" />
              <Text style={styles.badgeText}>Selected</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.copy}>
          <Text style={styles.name}>{voice.displayName}</Text>
          <Text style={styles.desc}>{voice.description}</Text>
        </View>
      </Pressable>
      <Button
        title={previewing ? 'Stop sample' : 'Test voice'}
        icon={previewing ? 'stop-circle-outline' : 'play-circle-outline'}
        variant="ghost"
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

  useEffect(() => {
    if (playerStatus.didJustFinish) setPreviewingId(null);
  }, [playerStatus.didJustFinish]);

  const selectVoice = async (voiceId) => {
    try {
      await updateSettings({ selectedVoiceId: voiceId });
    } catch {
      Alert.alert('Selection not saved', 'Please try choosing the voice again.');
    }
  };

  const previewVoice = async (voice) => {
    try {
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
      Alert.alert('Sample unavailable', 'This voice sample could not be played. Please try again.');
    }
  };

  return (
    <Screen scroll={false}>
      <Header title="My safety call voices" subtitle="Choose the companion voice that feels right to hear." />
      <FlatList
        data={voiceProfiles}
        extraData={{ selectedVoiceId: settings.selectedVoiceId, previewingId }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <VoiceOption
            voice={item}
            selected={settings.selectedVoiceId === item.id}
            previewing={previewingId === item.id}
            onSelect={() => selectVoice(item.id)}
            onPreview={() => previewVoice(item)}
          />
        )}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 24 },
  card: { marginBottom: 12, gap: 12 },
  selected: { borderColor: colors.orange, borderWidth: 2, backgroundColor: '#FFF9F5' },
  selectionArea: { minHeight: 124, flexDirection: 'row', alignItems: 'center', gap: 16 },
  pressed: { opacity: 0.72 },
  avatarFrame: { width: 120, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 110, height: 110 },
  badge: { position: 'absolute', bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.green, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  badgeText: { color: '#fff', fontFamily: fonts.semibold, fontSize: 12 },
  copy: { flex: 1, gap: 5 },
  name: { fontFamily: fonts.bold, fontSize: 20, color: colors.ink },
  desc: { fontFamily: fonts.regular, color: colors.inkSoft, lineHeight: 20 }
});
