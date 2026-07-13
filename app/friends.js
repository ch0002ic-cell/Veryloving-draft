import { FlatList, StyleSheet, Text } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { EmptyState } from '../src/components/EmptyState';
import { images } from '../src/constants/assets';
import { colors } from '../src/constants/theme';
import { config } from '../src/utils/config';

export default function Friends() {
  const { friends, setFriends } = useAppState();
  const { t } = useI18n();
  return (
    <Screen scroll={false}>
      <Header title={t('friends.title')} subtitle={t('friends.subtitle')} />
      {__DEV__ && config.enableMockPhoneAuth ? (
        <Button title={t('friends.addDemo')} icon="person-add-outline" onPress={() => setFriends([...friends, { id: Date.now().toString(), name: t('friends.newGuardian'), status: 'Pending' }])} />
      ) : null}
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
        renderItem={({ item }) => (
          <Card style={styles.card}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.status}>{t(`friends.statuses.${String(item.status).toLowerCase()}`)}</Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingBottom: 16 },
  card: { marginBottom: 10, gap: 4 },
  name: { fontFamily: fonts.bold, color: colors.ink, fontSize: 17 },
  status: { fontFamily: fonts.regular, color: colors.inkSoft }
});
