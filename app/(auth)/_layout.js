import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { colors } from '../../src/constants/theme';
import {
  AUTHENTICATED_ONBOARDING_ROUTES,
  PUBLIC_AUTH_ROUTES
} from '../../src/utils/auth-routing';

export default function AuthLayout() {
  const { loading, onboardingComplete, user } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
  // Navigate only after AuthContext has committed both pieces of state. An
  // imperative redirect from a sign-in handler can race React's state update
  // and make the root index observe the previous signed-out session.
  if (user && onboardingComplete) return <Redirect href="/(tabs)" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!user}>
        {PUBLIC_AUTH_ROUTES.map((name) => <Stack.Screen key={name} name={name} />)}
      </Stack.Protected>
      <Stack.Protected guard={Boolean(user)}>
        {AUTHENTICATED_ONBOARDING_ROUTES.map((name) => <Stack.Screen key={name} name={name} />)}
      </Stack.Protected>
    </Stack>
  );
}
