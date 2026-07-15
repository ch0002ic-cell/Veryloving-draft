import { useEffect } from 'react';
import { useSegments } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import {
  persistSafeNavigationDestination,
  safeNavigationDestinationForSegments
} from '../services/navigation-persistence';
import { logger } from '../utils/logger';

export function NavigationPersistenceTracker() {
  const segments = useSegments();
  const { isDemoMode, loading, onboardingComplete, user } = useAuth();
  const destination = safeNavigationDestinationForSegments(segments);

  useEffect(() => {
    if (isDemoMode || loading || !onboardingComplete || !user?.id || !destination) return;
    persistSafeNavigationDestination(user.id, destination).catch((error) => {
      if (error?.code === 'LOCAL_DATA_CLEANUP_LOCKED') return;
      logger.warn('[Navigation] Could not persist the last safe destination', {
        errorCode: error?.code || error?.name || 'NAVIGATION_PERSIST_FAILED'
      });
    });
  }, [destination, isDemoMode, loading, onboardingComplete, user?.id]);

  return null;
}
