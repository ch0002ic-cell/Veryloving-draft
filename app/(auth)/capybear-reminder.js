import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
export default function CapybearReminder() { return <Screen><Header title='Capybear reminder' subtitle='Gentle reminders are ready.' /><Button title='Continue' onPress={() => router.replace('/(tabs)')} /></Screen>; }
