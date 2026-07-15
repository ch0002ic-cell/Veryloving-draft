import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, I18nManager, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { AppProvider, useAppState } from '../src/context/AppContext';
import { I18nProvider, useI18n } from '../src/context/I18nContext';
import { useAppFonts } from '../src/hooks/useAppFonts';
import { colors } from '../src/constants/theme';
import { PROTECTED_ROOT_ROUTES } from '../src/utils/auth-routing';
import { AppErrorBoundary } from '../src/components/AppErrorBoundary';
import { AudioStreamBridge } from '../src/components/AudioStreamBridge';
import { NavigationPersistenceTracker } from '../src/components/NavigationPersistenceTracker';
import { initializeNotifications } from '../src/services/notifications';
import { logger } from '../src/utils/logger';

const OUTER_ERROR_COPY = Object.freeze({
  title: 'VeryLoving encountered a problem',
  message: 'Close and reopen the app if retrying does not resolve the issue.',
  retryLabel: 'Retry'
});

if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL?.(true);
}

function LocalizedNavigation() {
  const { isRTL } = useI18n();
  const { isHydrated } = useAppState();
  const { loading: authLoading, onboardingComplete, user } = useAuth();
  if (!isHydrated || authLoading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}><ActivityIndicator color={colors.ink} /></View>;
  }
  const navigation = (
    <>
      <StatusBar style="dark" backgroundColor={colors.cream} />
      <NavigationPersistenceTracker />
      <Stack
        screenOptions={{
          animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'simple_push',
          contentStyle: { backgroundColor: colors.cream },
          gestureEnabled: true,
          headerShown: false
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Protected guard={Boolean(user && onboardingComplete)}>
          {PROTECTED_ROOT_ROUTES.map((name) => (
            <Stack.Screen
              key={name}
              name={name}
              options={name === 'safety-call' || name === 'emergency-sos'
                ? { animation: 'slide_from_bottom', presentation: 'modal' }
                : undefined}
            />
          ))}
        </Stack.Protected>
      </Stack>
    </>
  );
  if (Platform.OS === 'web') return <View dir={isRTL ? 'rtl' : 'ltr'} style={{ flex: 1 }}>{navigation}</View>;
  return navigation;
}

function LocalizedErrorBoundary({ children }) {
  const { t } = useI18n();
  return (
    <AppErrorBoundary
      title={t('settings.updateFailedTitle')}
      message={t('settings.updateFailedMessage')}
      retryLabel={t('common.retry')}
    >
      {children}
    </AppErrorBoundary>
  );
}

function RootRuntime() {
  const fontsReady = useAppFonts();
  useEffect(() => {
    initializeNotifications().catch((error) => {
      logger.warn('[Notifications] Initialization failed', {
        errorCode: error?.code || error?.name || 'NOTIFICATIONS_INITIALIZATION_FAILED'
      });
    });
  }, []);
  if (!fontsReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}><ActivityIndicator color={colors.ink} /></View>;
  return (
    <SafeAreaProvider>
      <AudioStreamBridge />
      <AuthProvider>
        <AppProvider>
          <I18nProvider>
            <LocalizedErrorBoundary>
              <LocalizedNavigation />
            </LocalizedErrorBoundary>
          </I18nProvider>
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default function RootLayout() {
  return (
    <AppErrorBoundary
      title={OUTER_ERROR_COPY.title}
      message={OUTER_ERROR_COPY.message}
      retryLabel={OUTER_ERROR_COPY.retryLabel}
    >
      <RootRuntime />
    </AppErrorBoundary>
  );
}
