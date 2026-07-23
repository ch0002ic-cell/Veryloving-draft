import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { explainPermission } from './permissions';
import { logger } from '../utils/logger';
import { VOICE_AUDIO_CACHE_PREFIX } from './voice-audio-cache';
import { pcmBytesToBase64 } from '../utils/pcm';
import { isExpoGoRuntime } from '../utils/runtime-environment';

const PLAYBACK_SEGMENT_TIMEOUT_MS = 60000;
const PLAYBACK_CLEANUP_TIMEOUT_MS = 500;
const HUME_SAMPLE_RATE = 48000;
const HUME_CHANNELS = 1;
export const MAX_PLAYBACK_SEGMENT_BASE64_CHARACTERS = 1400000;
const MAX_PLAYBACK_QUEUE_SEGMENTS = 16;
const MAX_PLAYBACK_QUEUE_BYTES = 8 * 1024 * 1024;

async function deleteAudioFile(uri) {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}

async function waitForBoundedCleanup(operation, timeoutMs = PLAYBACK_CLEANUP_TIMEOUT_MS) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve(operation).catch(() => {}),
      new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export class AudioService {
  recording = null;
  sound = null;
  audioChunkCallback = null;
  playbackQueue = [];
  playbackQueuedBytes = 0;
  playbackRetainedSegments = 0;
  playbackRetainedBytes = 0;
  playbackAdmissions = new Set();
  playbackGeneration = 0;
  playbackEnqueueQueue = Promise.resolve();
  playbackDrainPromise = null;
  currentPlaybackFinish = null;
  pcmStream = null;
  pcmFormatWarningShown = false;

  setAudioChunkCallback(callback) {
    this.audioChunkCallback = callback;
  }

  attachPCMStream(stream) {
    this.pcmStream = stream;
    return () => {
      if (this.pcmStream === stream) this.pcmStream = null;
    };
  }

  handlePCMBuffer(buffer) {
    if (!this.recording || this.recording !== this.pcmStream || !this.audioChunkCallback) return false;
    if (buffer?.sampleRate !== HUME_SAMPLE_RATE || buffer?.channels !== HUME_CHANNELS) {
      if (!this.pcmFormatWarningShown) {
        this.pcmFormatWarningShown = true;
        logger.error('[AudioService] Native PCM format does not match the Hume session', {
          sampleRate: buffer?.sampleRate,
          channels: buffer?.channels
        });
      }
      return false;
    }
    try {
      const encoded = pcmBytesToBase64(buffer.data);
      if (!encoded) return false;
      this.audioChunkCallback(encoded);
      return true;
    } catch (error) {
      logger.warn('[AudioService] Dropped an invalid PCM buffer', { name: error?.name || 'PCMEncodingError' });
      return false;
    }
  }

  async startVoiceCallMode() {
    const backgroundAudioEnabled = !isExpoGoRuntime();
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: backgroundAudioEnabled,
      allowsBackgroundRecording: backgroundAudioEnabled,
      interruptionMode: 'doNotMix',
      // Keep assistant playback away from the loudspeaker while raw PCM is
      // being captured. This reduces feedback on devices whose native capture
      // path does not expose voice-processing/AEC controls through Expo yet.
      shouldRouteThroughEarpiece: true
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
    const stream = this.pcmStream;
    if (!stream) {
      const error = new Error('Real-time microphone streaming is not available on this platform.');
      error.code = 'PCM_STREAM_UNAVAILABLE';
      throw error;
    }
    await this.startVoiceCallMode();
    try {
      if (!await explainPermission('microphone')) {
        const error = new Error('Microphone permission was not requested.');
        error.code = 'MICROPHONE_NOT_REQUESTED';
        throw error;
      }
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        const error = new Error('Microphone permission is required.');
        error.code = 'MICROPHONE_PERMISSION_DENIED';
        throw error;
      }
      this.recording = stream;
      this.pcmFormatWarningShown = false;
      await stream.start();
      if (stream.sampleRate !== HUME_SAMPLE_RATE || stream.channels !== HUME_CHANNELS) {
        const error = new Error('This device could not provide the required 48 kHz mono microphone format.');
        error.code = 'PCM_FORMAT_UNSUPPORTED';
        throw error;
      }
      // AudioStream currently selects a record-only category on iOS. Restore
      // the full-duplex Expo audio mode after native capture is active.
      await this.startVoiceCallMode();
      logger.voice('[AudioService] Real-time PCM microphone stream started', {
        sampleRate: stream.sampleRate,
        channels: stream.channels
      });
    } catch (error) {
      if (this.recording === stream) this.recording = null;
      try { stream.stop(); } catch {}
      await this.stopVoiceCallMode().catch(() => {});
      throw error;
    }
  }

  async stopRecording() {
    if (!this.recording) return null;
    const recording = this.recording;
    this.recording = null;
    try {
      recording.stop();
      return null;
    } finally {
      await this.stopVoiceCallMode().catch(() => {});
    }
  }

  async playBase64Audio(base64, extension = 'wav') {
    if (typeof base64 !== 'string' || !base64) return false;
    if (base64.length > MAX_PLAYBACK_SEGMENT_BASE64_CHARACTERS) {
      logger.warn('[AudioService] Dropped an oversized assistant audio segment', {
        encodedCharacters: base64.length
      });
      return false;
    }
    const sizeBytes = Math.ceil(base64.length * 3 / 4);
    if (
      this.playbackRetainedSegments >= MAX_PLAYBACK_QUEUE_SEGMENTS
      || this.playbackRetainedBytes + sizeBytes > MAX_PLAYBACK_QUEUE_BYTES
    ) {
      logger.warn('[AudioService] Dropped assistant audio while the playback queue was full');
      return false;
    }
    const generation = this.playbackGeneration;
    const admission = { generation, sizeBytes, released: false };
    this.playbackAdmissions.add(admission);
    this.playbackRetainedSegments += 1;
    this.playbackRetainedBytes += sizeBytes;
    const releaseAdmission = () => {
      if (admission.released) return;
      admission.released = true;
      this.playbackAdmissions.delete(admission);
      this.playbackRetainedSegments = Math.max(0, this.playbackRetainedSegments - 1);
      this.playbackRetainedBytes = Math.max(0, this.playbackRetainedBytes - sizeBytes);
    };
    const operation = this.playbackEnqueueQueue.catch(() => {}).then(async () => {
      const suffix = Math.random().toString(36).slice(2, 10);
      const uri = `${FileSystem.cacheDirectory}${VOICE_AUDIO_CACHE_PREFIX}${Date.now()}-${suffix}.${extension}`;
      let retainedByPlayback = false;
      try {
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        if (generation !== this.playbackGeneration) {
          await deleteAudioFile(uri);
          return false;
        }
        this.playbackQueue.push({ uri, generation, sizeBytes, releaseAdmission });
        retainedByPlayback = true;
        this.playbackQueuedBytes += sizeBytes;
        this._drainPlaybackQueue().catch((error) => {
          logger.error('[AudioService] Playback queue failed', error);
        });
        return true;
      } finally {
        if (!retainedByPlayback) releaseAdmission();
      }
    });
    this.playbackEnqueueQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  _drainPlaybackQueue() {
    if (this.playbackDrainPromise) return this.playbackDrainPromise;
    const drain = async () => {
      while (this.playbackQueue.length) {
        const item = this.playbackQueue.shift();
        this.playbackQueuedBytes = Math.max(0, this.playbackQueuedBytes - (item.sizeBytes || 0));
        try {
          if (item.generation !== this.playbackGeneration) {
            await deleteAudioFile(item.uri);
            continue;
          }
          await this._playFile(item).catch((error) => {
            logger.error('[AudioService] Could not play assistant audio', error);
          });
        } finally {
          item.releaseAdmission?.();
        }
      }
    };
    let trackedDrain;
    trackedDrain = drain().finally(() => {
      if (this.playbackDrainPromise !== trackedDrain) return;
      this.playbackDrainPromise = null;
      if (this.playbackQueue.length) this._drainPlaybackQueue().catch(() => {});
    });
    this.playbackDrainPromise = trackedDrain;
    return trackedDrain;
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
    const pendingEnqueues = this.playbackEnqueueQueue;
    this.playbackEnqueueQueue = Promise.resolve();
    const pendingDrain = this.playbackDrainPromise;
    const pending = this.playbackQueue.splice(0);
    this.playbackQueuedBytes = 0;
    // Queued files no longer retain encoded audio and can release immediately.
    // Admissions still inside a native write remain charged until that write
    // settles. Otherwise repeated cancel/new-write cycles could retain an
    // unbounded number of base64 closures when the native filesystem hangs.
    for (const item of pending) item.releaseAdmission?.();
    const pendingDeletes = Promise.all(pending.map((item) => deleteAudioFile(item.uri)));
    if (this.sound) {
      const player = this.sound;
      this.sound = null;
      try { player.pause(); } catch {}
      try { player.remove(); } catch {}
    }
    this.currentPlaybackFinish?.();
    // Native file writes are not reliably cancellable, so enqueue admission is
    // generation-fenced. Keep an active playback drain as the single owner
    // until its current player finishes; a new generation can then append work
    // without creating a second drain that overlaps native player cleanup.
    const cleanup = Promise.allSettled([pendingDeletes, pendingEnqueues, pendingDrain]);
    void cleanup.catch(() => {});
    await waitForBoundedCleanup(cleanup);
  }
}

export const audioService = new AudioService();
