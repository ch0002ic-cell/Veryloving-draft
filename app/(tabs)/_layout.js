import { Tabs } from 'expo-router';
import { Image, StyleSheet } from 'react-native';
import { images } from '../../src/constants/assets';
import { colors, radii, sizes, spacing, typography } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.textPrimary,
        tabBarAllowFontScaling: true,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarLabelStyle: { ...typography.caption, fontFamily: typography.label.fontFamily },
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: { marginHorizontal: spacing.xs, marginVertical: spacing.xs, borderRadius: radii.lg },
        tabBarStyle: { minHeight: sizes.controlLarge + spacing.mdSm, paddingTop: spacing.xs, borderTopColor: colors.borderSubtle, backgroundColor: colors.surfaceRaised }
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('common.home'), tabBarIcon: ({ focused }) => <Image accessible={false} source={images.homeTab} style={[styles.icon, !focused && styles.inactiveIcon]} /> }} />
      <Tabs.Screen name="map" options={{ title: t('common.map'), tabBarIcon: ({ focused }) => <Image accessible={false} source={images.mapTab} style={[styles.icon, !focused && styles.inactiveIcon]} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { width: sizes.iconLarge, height: sizes.iconLarge },
  inactiveIcon: { opacity: 0.45 }
});
