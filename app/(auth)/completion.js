import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/context/AuthContext';
import { useI18n } from '../../src/context/I18nContext';
import { logger } from '../../src/utils/logger';

export default function Completion() {
  const { completeOnboarding, onboardingComplete } = useAuth();
  const { t } = useI18n();
  const [errorKey, setErrorKey] = useState(null);

  const finish = useCallback(async () => {
    setErrorKey(null);
    try {
      await completeOnboarding();
    } catch (completionError) {
      logger.warn('[Auth] Could not persist onboarding completion', completionError);
      setErrorKey('settings.updateFailedMessage');
    }
  }, [completeOnboarding]);

  useEffect(() => {
    if (!onboardingComplete) void finish();
  }, [finish, onboardingComplete]);

  useEffect(() => {
    // Navigate only after a render in which the root protected-route guard has
    // observed completion. This avoids racing navigation against the state update.
    if (onboardingComplete) router.replace('/(tabs)');
  }, [onboardingComplete]);

  return (
    <Screen>
      {errorKey
        ? <FeedbackBanner message={t(errorKey)} actionLabel={t('common.retry')} onAction={finish} />
        : <LoadingState message={t('common.loading')} />}
    </Screen>
  );
}
