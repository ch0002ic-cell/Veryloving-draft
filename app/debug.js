import { Text } from 'react-native';
import { Redirect } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { config } from '../src/utils/config';

export default function Debug() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Screen><Header title="VeryLoving Debug Page" subtitle="Development-only route." /><Card><Text>{JSON.stringify(config, null, 2)}</Text></Card></Screen>;
}
