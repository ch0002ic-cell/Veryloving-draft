import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export const VOICE_AUDIO_CACHE_PREFIX = 'hume-';
const RECORDING_CACHE_PREFIX = 'recording-';
const RECORDING_CACHE_DIRECTORIES = ['ExpoAudio', 'Audio'];

export function purgeVoiceAudioCache() {
  if (Platform.OS === 'web') return;
  for (const entry of Paths.cache.list()) {
    if (entry instanceof File && entry.name.startsWith(VOICE_AUDIO_CACHE_PREFIX)) {
      entry.delete();
    }
  }
  for (const directoryName of RECORDING_CACHE_DIRECTORIES) {
    const directory = new Directory(Paths.cache, directoryName);
    if (!directory.exists) continue;
    for (const entry of directory.list()) {
      if (entry instanceof File && entry.name.startsWith(RECORDING_CACHE_PREFIX)) entry.delete();
    }
  }
}
