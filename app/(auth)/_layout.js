import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../src/context/AuthContext';
import { colors } from '../../src/constants/theme';
import {
  AUTHENTICATED_ONBOARDING_ROUTES,
  PUBLIC_AUTH_ROUTES
} from '../../src/utils/auth-routing';

export default function AuthLayout() {
  const { loading, user } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }
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
