import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { Linking } from 'react-native';
import { useAuth } from '../src/context/AuthContext';
import { AppLoadingState } from '../src/components/AppLoadingState';
import { restoreSafeNavigationDestination } from '../src/services/navigation-persistence';
import { withTimeout } from '../src/utils/async';
import { logger } from '../src/utils/logger';

const NAVIGATION_RESTORE_TIMEOUT_MS = 1500;

export default function Index() {
  const {
    hasPendingPhoneVerification,
    isDemoMode,
    loading,
    onboardingComplete,
    onboardingRoute,
    user
  } = useAuth();
  const [restoration, setRestoration] = useState({ accountId: null, ready: false, destination: null });

  useEffect(() => {
    if (isDemoMode || loading || !user?.id || !onboardingComplete) return undefined;
    let active = true;
    const accountId = user.id;
    setRestoration({ accountId, ready: false, destination: null });
    withTimeout(
      Promise.resolve()
        .then(() => Linking.getInitialURL())
        .then((initialURL) => restoreSafeNavigationDestination(accountId, initialURL)),
      NAVIGATION_RESTORE_TIMEOUT_MS,
      'Navigation restoration timed out.'
    ).then((destination) => {
      if (active) setRestoration({ accountId, ready: true, destination });
    }).catch((error) => {
      logger.warn('[Navigation] Could not restore the last safe destination', {
        errorCode: error?.code || error?.name || 'NAVIGATION_RESTORE_FAILED'
      });
      if (active) setRestoration({ accountId, ready: true, destination: null });
    });
    return () => {
      active = false;
    };
  }, [isDemoMode, loading, onboardingComplete, user?.id]);

  if (loading) return <AppLoadingState />;
  if (!user && hasPendingPhoneVerification) return <Redirect href="/(auth)/verify-code" />;
  if (!user) return <Redirect href="/(auth)/onboarding" />;
  if (!onboardingComplete) return <Redirect href={onboardingRoute} />;
  if (isDemoMode) return <Redirect href="/(tabs)" />;
  if (restoration.accountId !== user.id || !restoration.ready) {
    return <AppLoadingState />;
  }
  return <Redirect href={restoration.destination || '/(tabs)'} />;
}
