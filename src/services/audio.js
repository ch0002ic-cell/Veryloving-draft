import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync
} from 'expo-audio';
import * as FileSystem from 'expo-file-system';
import { explainPermission } from './permissions';
import { logger } from '../utils/logger';

class AudioService {
  recording = null;
  sound = null;
  audioChunkCallback = null;

  setAudioChunkCallback(callback) {
    this.audioChunkCallback = callback;
  }

  async startVoiceCallMode() {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      allowsBackgroundRecording: true,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false
    });
  }

  async stopVoiceCallMode() {
    await setAudioModeAsync({
      allowsRecording: false,
      allowsBackgroundRecording: false,
      shouldPlayInBackground: false
    });
  }

  async startRecording() {
    if (this.recording) return;
    await this.startVoiceCallMode();
    try {
      if (!await explainPermission('microphone')) throw new Error('Microphone permission was not requested.');
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission is required.');
      const recording = new AudioModule.AudioRecorder({});
      await recording.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      recording.record();
      this.recording = recording;
      logger.voice('[AudioService] Recording started. Streaming chunks require a dev-client native audio backend.');
    } catch (error) {
      await this.stopVoiceCallMode().catch(() => {});
      throw error;
    }
  }

  async stopRecording() {
    if (!this.recording) return null;
    const recording = this.recording;
    this.recording = null;
    try {
      await recording.stop();
      return recording.uri;
    } finally {
      await this.stopVoiceCallMode().catch(() => {});
    }
  }

  async playBase64Audio(base64, extension = 'wav') {
    if (!base64) return;
    const uri = `${FileSystem.cacheDirectory}hume-${Date.now()}.${extension}`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    await this.cancelAndClearQueue();
    const player = createAudioPlayer({ uri }, { keepAudioSessionActive: true });
    this.sound = player;
    player.play();
  }

  async cancelAndClearQueue() {
    if (this.sound) {
      const player = this.sound;
      this.sound = null;
      try { player.pause(); } catch {}
      try { player.remove(); } catch {}
    }
  }
}

export const audioService = new AudioService();
