import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/context/AuthContext';
import { AppProvider } from '../src/context/AppContext';
import { I18nProvider } from '../src/context/I18nContext';
import { useAppFonts } from '../src/hooks/useAppFonts';
import { colors } from '../src/constants/theme';

export default function RootLayout() {
  const fontsReady = useAppFonts();
  if (!fontsReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}><ActivityIndicator color={colors.ink} /></View>;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppProvider>
          <I18nProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="safety-call" options={{ presentation: 'modal' }} />
              <Stack.Screen name="emergency-sos" options={{ presentation: 'modal' }} />
              <Stack.Screen name="settings" />
              <Stack.Screen name="voices" />
              <Stack.Screen name="device-management" />
              <Stack.Screen name="emergency-contacts" />
              <Stack.Screen name="friends" />
              <Stack.Screen name="conversation-history" />
              {__DEV__ ? <Stack.Screen name="debug" /> : null}
            </Stack>
          </I18nProvider>
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
