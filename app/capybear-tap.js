import { Text } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { useI18n } from '../src/context/I18nContext';
export default function CapybearTap() { const { t } = useI18n(); return <Screen><Header title={t('capybearTap.title')} subtitle={t('capybearTap.subtitle')} /><Card><Text>{t('capybearTap.body')}</Text></Card></Screen>; }
