import { FlatList, StyleSheet, Text } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { useAppState } from '../src/context/AppContext';
import { useI18n } from '../src/context/I18nContext';
import { EmptyState } from '../src/components/EmptyState';
import { images } from '../src/constants/assets';
import { colors, spacing, typography } from '../src/constants/theme';

export default function Friends() {
  const { friends } = useAppState();
  const { isRTL, t } = useI18n();
  return (
    <Screen scroll={false}>
      <Header title={t('friends.title')} subtitle={t('friends.subtitle')} showBack backLabel={t('common.back')} />
      <FlatList
        contentContainerStyle={styles.list}
        data={friends}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={(
          <EmptyState
            image={images.bestie}
            title={t('friends.emptyTitle')}
            message={t('friends.emptyMessage')}
          />
        )}
        renderItem={({ item }) => {
          const status = t(`friends.statuses.${String(item.status).toLowerCase()}`);
          return (
            <Card accessible accessibilityLabel={`${item.name}, ${status}`} accessibilityRole="summary" style={styles.card}>
              <Text style={[styles.name, isRTL && styles.rtlText]}>{item.name}</Text>
              <Text style={[styles.status, isRTL && styles.rtlText]}>{status}</Text>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingBottom: spacing.md },
  card: { marginBottom: spacing.sm, gap: spacing.xs },
  name: { ...typography.heading, color: colors.textPrimary },
  status: { ...typography.bodySmall, color: colors.textSecondary },
  rtlText: { textAlign: 'right' }
});
