import 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, I18nManager, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/context/AuthContext';
import { AppProvider, useAppState } from '../src/context/AppContext';
import { I18nProvider, useI18n } from '../src/context/I18nContext';
import { useAppFonts } from '../src/hooks/useAppFonts';
import { colors } from '../src/constants/theme';

if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL?.(true);
}

function LocalizedNavigation() {
  const { isRTL } = useI18n();
  const { isHydrated } = useAppState();
  if (!isHydrated) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}><ActivityIndicator color={colors.ink} /></View>;
  }
  const navigation = (
    <>
      <StatusBar style="dark" backgroundColor={colors.cream} />
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
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="safety-call" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="emergency-sos" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="settings" />
        <Stack.Screen name="voices" />
        <Stack.Screen name="device-management" />
        <Stack.Screen name="emergency-contacts" />
        <Stack.Screen name="friends" />
        <Stack.Screen name="conversation-history" />
        {__DEV__ ? <Stack.Screen name="debug" /> : null}
      </Stack>
    </>
  );
  if (Platform.OS === 'web') return <View dir={isRTL ? 'rtl' : 'ltr'} style={{ flex: 1 }}>{navigation}</View>;
  return navigation;
}

export default function RootLayout() {
  const fontsReady = useAppFonts();
  if (!fontsReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream }}><ActivityIndicator color={colors.ink} /></View>;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppProvider>
          <I18nProvider>
            <LocalizedNavigation />
          </I18nProvider>
        </AppProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
