import * as Font from 'expo-font';
import { useEffect, useState } from 'react';

export function useAppFonts() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    Font.loadAsync({
      'Inter-Regular': require('../../assets/fonts/Inter-Regular.ttf'),
      'Inter-Medium': require('../../assets/fonts/Inter-Medium.ttf'),
      'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
      'Inter-Bold': require('../../assets/fonts/Inter-Bold.ttf'),
      'Scada-Regular': require('../../assets/fonts/Scada-Regular.ttf'),
      'Scada-Bold': require('../../assets/fonts/Scada-Bold.ttf')
    }).finally(() => mounted && setReady(true));
    return () => { mounted = false; };
  }, []);

  return ready;
}
