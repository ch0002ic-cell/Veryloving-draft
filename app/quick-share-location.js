import { useEffect } from 'react';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { shareQuickLocation } from '../src/services/emergency';
export default function QuickShareLocation() { useEffect(() => { shareQuickLocation(); }, []); return <Screen><Header title='Quick share' subtitle='Location share flow is ready.' /></Screen>; }
