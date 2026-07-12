import { FlatList, Text } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';

export default function Friends() {
  const { friends, setFriends } = useAppState();
  return <Screen scroll={false}><Header title="Friends" subtitle="Guardians, requests, and emergency graph." /><Button title="Add demo friend" onPress={() => setFriends([...friends, { id: Date.now().toString(), name: 'New Guardian', status: 'Pending' }])} /><FlatList data={friends} keyExtractor={(item) => item.id} renderItem={({ item }) => <Card style={{ marginBottom: 10 }}><Text style={{ fontFamily: fonts.bold }}>{item.name}</Text><Text>{item.status}</Text></Card>} /></Screen>;
}
