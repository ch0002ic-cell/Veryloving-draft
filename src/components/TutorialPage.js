import { Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from './Screen';
import { Header } from './Header';
import { Card } from './Card';
import { Button } from './Button';
import { useI18n } from '../context/I18nContext';
import { fonts } from '../constants/theme';

export function TutorialPage({ titleKey, subtitleKey, nextPath }) {
  const { t } = useI18n();
  return (
    <Screen>
      <Header title={t(titleKey)} subtitle={t(subtitleKey)} />
      <Card><Text style={{ fontFamily: fonts.regular, lineHeight: 22 }}>{t('tutorial.sharedBody')}</Text></Card>
      <Button title={t('common.continue')} onPress={() => router.push(nextPath)} />
      <Button title={t('common.skipTutorial')} variant="ghost" onPress={() => router.replace('/(tabs)')} />
    </Screen>
  );
}
