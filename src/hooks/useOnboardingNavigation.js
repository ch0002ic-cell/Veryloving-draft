import { useCallback, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';

export function useOnboardingNavigation() {
  const { advanceOnboarding } = useAuth();
  const { t } = useI18n();
  const navigatingRef = useRef(false);
  const [navigationErrorKey, setNavigationErrorKey] = useState(null);
  const [advancing, setAdvancing] = useState(false);

  const advanceTo = useCallback(async (nextRoute, { replace = false } = {}) => {
    if (navigatingRef.current) return false;
    navigatingRef.current = true;
    setAdvancing(true);
    setNavigationErrorKey(null);
    try {
      await advanceOnboarding(nextRoute);
      if (replace) router.replace(nextRoute);
      else router.push(nextRoute);
      return true;
    } catch {
      navigatingRef.current = false;
      setNavigationErrorKey('settings.updateFailedMessage');
      return false;
    } finally {
      setAdvancing(false);
    }
  }, [advanceOnboarding]);

  return {
    advanceTo,
    advancing,
    navigationError: navigationErrorKey ? t(navigationErrorKey) : null,
    clearNavigationError: () => setNavigationErrorKey(null)
  };
}
