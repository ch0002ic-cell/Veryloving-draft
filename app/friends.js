import { FlatList, Text } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

export default function Friends() {
  const { friends, setFriends } = useAppState();
  const { t } = useI18n();
  return <Screen scroll={false}><Header title={t('friends.title')} subtitle={t('friends.subtitle')} /><Button title={t('friends.addDemo')} onPress={() => setFriends([...friends, { id: Date.now().toString(), name: t('friends.newGuardian'), status: 'Pending' }])} /><FlatList data={friends} keyExtractor={(item) => item.id} renderItem={({ item }) => <Card style={{ marginBottom: 10 }}><Text style={{ fontFamily: fonts.bold }}>{item.name}</Text><Text>{t(`friends.statuses.${String(item.status).toLowerCase()}`)}</Text></Card>} /></Screen>;
}
