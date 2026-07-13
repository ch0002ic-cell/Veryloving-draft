import { useCallback, useEffect } from 'react';
import { useAudioStream } from 'expo-audio';
import { audioService } from '../services/audio';

export function AudioStreamBridge() {
  const onBuffer = useCallback((buffer) => {
    audioService.handlePCMBuffer(buffer);
  }, []);
  const { stream } = useAudioStream({
    sampleRate: 48000,
    channels: 1,
    encoding: 'int16',
    onBuffer
  });

  useEffect(() => audioService.attachPCMStream(stream), [stream]);
  return null;
}
