import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { StatusPill } from '../src/components/StatusPill';
import { useAppState } from '../src/context/AppContext';
import { useI18n } from '../src/context/I18nContext';
import { colors, fonts } from '../src/constants/theme';

function closeExcuseCall() {
  if (router.canGoBack()) router.back();
  else router.replace('/(tabs)');
}

export default function ExcuseCall() {
  const { selectedVoice } = useAppState();
  const { isRTL, t } = useI18n();
  const voiceName = t(`voices.profiles.${selectedVoice.id}.name`);

  return (
    <Screen scroll={false} style={styles.screen}>
      <View style={styles.caller} accessibilityRole="summary">
        <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <StatusPill label={t('safetyCall.ready')} tone="active" />
        <Text style={[styles.name, isRTL && styles.rtlText]}>{voiceName}</Text>
        <Text style={[styles.title, isRTL && styles.rtlText]}>{t('tutorial.excuseTitle')}</Text>
        <Text style={[styles.copy, isRTL && styles.rtlText]}>{t('tutorial.excuseSubtitle')}</Text>
      </View>
      <View style={styles.actions}>
        <Button
          accessibilityLabel={`${t('common.call')} ${voiceName}`}
          icon="call"
          title={t('common.call')}
          onPress={() => router.replace('/safety-call')}
        />
        <Button
          accessibilityLabel={t('common.close')}
          icon="close"
          title={t('common.close')}
          variant="danger"
          onPress={closeExcuseCall}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', paddingVertical: 32 },
  caller: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  avatar: { width: 164, height: 164 },
  name: { color: colors.ink, fontFamily: fonts.bold, fontSize: 30, textAlign: 'center' },
  title: { color: colors.ink, fontFamily: fonts.semibold, fontSize: 20, textAlign: 'center' },
  copy: { color: colors.inkSoft, fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, textAlign: 'center' },
  actions: { gap: 12 },
  rtlText: { textAlign: 'right' }
});
