import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { explainPermission } from './permissions';
import { logger } from '../utils/logger';
import { VOICE_AUDIO_CACHE_PREFIX } from './voice-audio-cache';

const PLAYBACK_SEGMENT_TIMEOUT_MS = 60000;

async function deleteAudioFile(uri) {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

class AudioService {
  recording = null;
  sound = null;
  audioChunkCallback = null;
  playbackQueue = [];
  playbackGeneration = 0;
  playbackEnqueueQueue = Promise.resolve();
  playbackDrainPromise = null;
  currentPlaybackFinish = null;

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
      return null;
    } finally {
      await deleteAudioFile(recording.uri);
      await this.stopVoiceCallMode().catch(() => {});
    }
  }

  async playBase64Audio(base64, extension = 'wav') {
    if (!base64) return;
    const generation = this.playbackGeneration;
    const operation = this.playbackEnqueueQueue.catch(() => {}).then(async () => {
      const suffix = Math.random().toString(36).slice(2, 10);
      const uri = `${FileSystem.cacheDirectory}${VOICE_AUDIO_CACHE_PREFIX}${Date.now()}-${suffix}.${extension}`;
      await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (generation !== this.playbackGeneration) {
        await deleteAudioFile(uri);
        return;
      }
      this.playbackQueue.push({ uri, generation });
      this._drainPlaybackQueue().catch((error) => {
        logger.error('[AudioService] Playback queue failed', error);
      });
    });
    this.playbackEnqueueQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  _drainPlaybackQueue() {
    if (this.playbackDrainPromise) return this.playbackDrainPromise;
    const drain = async () => {
      while (this.playbackQueue.length) {
        const item = this.playbackQueue.shift();
        if (item.generation !== this.playbackGeneration) {
          await deleteAudioFile(item.uri);
          continue;
        }
        await this._playFile(item).catch((error) => {
          logger.error('[AudioService] Could not play assistant audio', error);
        });
      }
    };
    this.playbackDrainPromise = drain().finally(() => {
      this.playbackDrainPromise = null;
      if (this.playbackQueue.length) this._drainPlaybackQueue().catch(() => {});
    });
    return this.playbackDrainPromise;
  }

  async _playFile({ uri, generation }) {
    if (generation !== this.playbackGeneration) {
      await deleteAudioFile(uri);
      return;
    }
    const player = createAudioPlayer({ uri }, { keepAudioSessionActive: true, updateInterval: 100 });
    this.sound = player;
    let subscription;
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        let timeout;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          this.currentPlaybackFinish = null;
          if (error) reject(error);
          else resolve();
        };
        timeout = setTimeout(() => {
          finish(new Error('Assistant audio playback timed out.'));
        }, PLAYBACK_SEGMENT_TIMEOUT_MS);
        this.currentPlaybackFinish = finish;
        try {
          subscription = player.addListener('playbackStatusUpdate', (status) => {
            if (status.error) finish(new Error(status.error));
            else if (status.didJustFinish) finish();
          });
          player.play();
        } catch (error) {
          finish(error);
        }
      });
    } finally {
      this.currentPlaybackFinish = null;
      try { subscription?.remove(); } catch {}
      try { player.pause(); } catch {}
      try { player.remove(); } catch {}
      if (this.sound === player) this.sound = null;
      await deleteAudioFile(uri);
    }
  }

  async cancelAndClearQueue() {
    this.playbackGeneration += 1;
    const pending = this.playbackQueue.splice(0);
    await Promise.all(pending.map((item) => deleteAudioFile(item.uri)));
    if (this.sound) {
      const player = this.sound;
      this.sound = null;
      try { player.pause(); } catch {}
      try { player.remove(); } catch {}
    }
    this.currentPlaybackFinish?.();
    await this.playbackDrainPromise?.catch(() => {});
  }
}

export const audioService = new AudioService();
