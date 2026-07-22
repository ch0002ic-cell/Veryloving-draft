import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import { images } from '../../src/constants/assets';
import { colors, fonts, radii, spacing } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 12 },
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: { marginHorizontal: spacing.xs, marginVertical: spacing.xs, borderRadius: radii.lg },
        tabBarStyle: { minHeight: 68, paddingTop: spacing.xs, borderTopColor: colors.line, backgroundColor: colors.paper }
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('common.home'), tabBarIcon: ({ focused }) => <Image accessible={false} source={images.homeTab} style={{ width: 24, height: 24, opacity: focused ? 1 : 0.45 }} /> }} />
      <Tabs.Screen name="map" options={{ title: t('common.map'), tabBarIcon: ({ focused }) => <Image accessible={false} source={images.mapTab} style={{ width: 24, height: 24, opacity: focused ? 1 : 0.45 }} /> }} />
    </Tabs>
  );
}
