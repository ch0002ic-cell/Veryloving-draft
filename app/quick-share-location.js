import { useEffect } from 'react';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { shareQuickLocation } from '../src/services/emergency';
import { useI18n } from '../src/context/I18nContext';
export default function QuickShareLocation() { const { t } = useI18n(); useEffect(() => { shareQuickLocation(); }, []); return <Screen><Header title={t('quickShare.title')} subtitle={t('quickShare.subtitle')} /></Screen>; }
