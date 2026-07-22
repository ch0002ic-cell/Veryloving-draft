import { StyleSheet, Text } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { useI18n } from '../src/context/I18nContext';
import { colors, typography } from '../src/constants/theme';

export default function CapybearTap() {
  const { isRTL, t } = useI18n();
  return (
    <Screen>
      <Header
        title={t('capybearTap.title')}
        subtitle={t('capybearTap.subtitle')}
        showBack
        backLabel={t('common.back')}
      />
      <Card variant="tinted">
        <Text style={[styles.body, isRTL && styles.rtlText]}>{t('capybearTap.body')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.bodyLarge, color: colors.textPrimary },
  rtlText: { textAlign: 'right' }
});
