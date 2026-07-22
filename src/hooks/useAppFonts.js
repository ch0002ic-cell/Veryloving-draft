import * as Font from 'expo-font';
import { useEffect, useState } from 'react';
import { withTimeout } from '../utils/async';
import { logger } from '../utils/logger';

const FONT_LOAD_TIMEOUT_MS = 8000;

export function useAppFonts() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    withTimeout(
      Font.loadAsync({
        'Inter-Regular': require('../../assets/fonts/Inter-Regular.ttf'),
        'Inter-Medium': require('../../assets/fonts/Inter-Medium.ttf'),
        'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
        'Inter-Bold': require('../../assets/fonts/Inter-Bold.ttf'),
        'Scada-Regular': require('../../assets/fonts/Scada-Regular.ttf'),
        'Scada-Bold': require('../../assets/fonts/Scada-Bold.ttf')
      }),
      FONT_LOAD_TIMEOUT_MS,
      'Bundled font loading timed out.'
    ).catch((error) => {
      // Bundled fonts improve the presentation but must never prevent access
      // to a safety flow. React Native falls back to the platform font.
      logger.warn('[Startup] Bundled fonts were unavailable', {
        errorCode: error?.code || error?.name || 'FONT_LOAD_FAILED'
      });
    }).finally(() => mounted && setReady(true));
    return () => { mounted = false; };
  }, []);

  return ready;
}
