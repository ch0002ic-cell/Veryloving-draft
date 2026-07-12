import { Tabs } from 'expo-router';
import { Image } from 'react-native';
import { images } from '../../src/constants/assets';
import { colors, fonts } from '../../src/constants/theme';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.ink, tabBarLabelStyle: { fontFamily: fonts.semibold }, tabBarStyle: { height: 76, paddingTop: 8, paddingBottom: 12 } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ focused }) => <Image source={images.homeTab} style={{ width: 24, height: 24, opacity: focused ? 1 : 0.45 }} /> }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: ({ focused }) => <Image source={images.mapTab} style={{ width: 24, height: 24, opacity: focused ? 1 : 0.45 }} /> }} />
    </Tabs>
  );
}
