import { Redirect, Stack, useSegments } from 'expo-router';
import { Platform } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { colors } from '../../src/constants/theme';
import { AppLoadingState } from '../../src/components/AppLoadingState';
import { useI18n } from '../../src/context/I18nContext';
import {
  AUTHENTICATED_ONBOARDING_ROUTES,
  PUBLIC_AUTH_ROUTES
} from '../../src/utils/auth-routing';
import { isOnboardingRouteAllowed, normalizeOnboardingRoute } from '../../src/utils/onboarding-state';

export default function AuthLayout() {
  const { t } = useI18n();
  const { loading, onboardingComplete, onboardingRoute, user } = useAuth();
  const segments = useSegments();
  if (loading) {
    return <AppLoadingState message={t('common.loading')} />;
  }
  // Navigate only after AuthContext has committed both pieces of state. An
  // imperative redirect from a sign-in handler can race React's state update
  // and make the root index observe the previous signed-out session.
  if (user && onboardingComplete) return <Redirect href="/(tabs)" />;
  const requestedRoute = segments[0] === '(auth)'
    ? normalizeOnboardingRoute(`/(auth)/${segments.slice(1).join('/')}`)
    : null;
  if (
    user
    && requestedRoute
    && !isOnboardingRouteAllowed(requestedRoute, onboardingRoute)
  ) return <Redirect href={onboardingRoute} />;
  return (
    <Stack
      screenOptions={{
        animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'simple_push',
        contentStyle: { backgroundColor: colors.surfaceCanvas },
        gestureEnabled: true,
        headerShown: false
      }}
    >
      <Stack.Protected guard={!user}>
        {PUBLIC_AUTH_ROUTES.map((name) => <Stack.Screen key={name} name={name} />)}
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user)}>
        {AUTHENTICATED_ONBOARDING_ROUTES.map((name) => <Stack.Screen key={name} name={name} />)}
      </Stack.Protected>
    </Stack>
  );
}
