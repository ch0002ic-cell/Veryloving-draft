import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarLabelStyle: { fontFamily: fonts.semibold }, tabBarStyle: { height: 76, paddingTop: 8, paddingBottom: 12 } }}>
      <Tabs.Screen name="index" options={{ title: t('common.home'), tabBarIcon: ({ focused }) => <Image source={images.homeTab} style={{ width: 24, height: 24, opacity: focused ? 1 : 0.45 }} /> }} />
      <Tabs.Screen name="map" options={{ title: t('common.map'), tabBarIcon: ({ focused }) => <Image source={images.mapTab} style={{ width: 24, height: 24, opacity: focused ? 1 : 0.45 }} /> }} />
    </Tabs>
  );
}
