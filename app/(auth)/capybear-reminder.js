import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { useI18n } from '../../src/context/I18nContext';
export default function CapybearReminder() { const { t } = useI18n(); return <Screen><Header title={t('auth.capybearReminder')} subtitle={t('auth.remindersReady')} /><Button title={t('common.continue')} onPress={() => router.replace('/(auth)/completion')} /></Screen>; }
