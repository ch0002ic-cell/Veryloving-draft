import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import { colors } from '../../../src/constants/theme';

export default function TutorialLayout() {
  return (
    <Stack
      screenOptions={{
        animation: Platform.OS === 'android' ? 'fade_from_bottom' : 'simple_push',
        contentStyle: { backgroundColor: colors.cream },
        gestureEnabled: true,
        headerShown: false
      }}
    />
  );
}
