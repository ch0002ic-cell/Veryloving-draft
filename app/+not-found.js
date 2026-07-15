import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { useAuth } from '../src/context/AuthContext';
import { useI18n } from '../src/context/I18nContext';

export default function NotFound() {
  const { onboardingComplete, user } = useAuth();
  const { t } = useI18n();
  const homeRoute = user && onboardingComplete ? '/(tabs)' : '/';
  const goHome = () => router.replace(homeRoute);
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    goHome();
  };

  return (
    <Screen>
      <Header
        title={t('settings.linkFailed')}
        subtitle={t('common.veryLoving')}
        showBack
        backLabel={t('common.back')}
        onBack={goBack}
      />
      <Button title={t('common.home')} onPress={goHome} />
    </Screen>
  );
}
