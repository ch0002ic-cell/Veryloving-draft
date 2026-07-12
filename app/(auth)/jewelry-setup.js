import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { bleService } from '../../src/services/ble';
import { useAppState } from '../../src/context/AppContext';
import { colors, fonts } from '../../src/constants/theme';

export default function JewelrySetup() {
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const stopScanRef = useRef(null);
  const { setDevice } = useAppState();

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    bleService.stopScan();
    if (mountedRef.current) setScanning(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') stopScan();
    });
    return () => {
      mountedRef.current = false;
      subscription.remove();
      stopScanRef.current?.();
      bleService.stopScan();
    };
  }, [stopScan]);

  const scan = useCallback(async () => {
    stopScan();
    setDevices([]);
    setError(null);
    setScanning(true);
    try {
      const cleanup = await bleService.scanForDevices(
        (nextDevice) => {
          if (!mountedRef.current) return;
          setDevices((items) => items.find((item) => item.id === nextDevice.id) ? items : [...items, nextDevice]);
        },
        {
          onError: (scanError) => mountedRef.current && setError(scanError.message),
          onComplete: () => mountedRef.current && setScanning(false)
        }
      );
      if (!mountedRef.current) cleanup();
      else stopScanRef.current = cleanup;
    } catch (scanError) {
      if (mountedRef.current) {
        setScanning(false);
        setError(scanError.message || 'Bluetooth scanning could not start. Please try again.');
      }
    }
  }, [stopScan]);

  const connect = useCallback(async (candidate) => {
    stopScan();
    setError(null);
    setConnectingId(candidate.id);
    try {
      const connected = await bleService.connect(candidate);
      if (!mountedRef.current) return;
      setDevice(connected);
      router.push('/(auth)/capybear-setup');
    } catch (connectionError) {
      if (mountedRef.current) setError(connectionError.message);
    } finally {
      if (mountedRef.current) setConnectingId(null);
    }
  }, [setDevice, stopScan]);

  return (
    <Screen scroll={false}>
      <Header title="Pair NorthStar" subtitle="Keep the jewelry nearby while scanning." />
      <Button
        title={scanning ? 'Scanning nearby...' : 'Scan for devices'}
        icon="bluetooth"
        onPress={scan}
        loading={scanning}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.deviceCard}>
            <Text style={styles.deviceName}>{item.name || item.id}</Text>
            <Button
              title={connectingId === item.id ? 'Connecting...' : 'Connect'}
              onPress={() => connect(item)}
              loading={connectingId === item.id}
              disabled={Boolean(connectingId && connectingId !== item.id)}
            />
          </Card>
        )}
        ListEmptyComponent={!scanning ? <Text style={styles.empty}>No nearby NorthStar devices found yet.</Text> : null}
        contentContainerStyle={styles.list}
      />
      <Button title="Skip" variant="ghost" onPress={() => router.push('/(auth)/capybear-setup')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingVertical: 10 },
  deviceCard: { marginBottom: 10, gap: 10 },
  deviceName: { fontFamily: fonts.semibold, color: colors.ink },
  empty: { paddingVertical: 24, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' },
  error: { fontFamily: fonts.regular, color: colors.red, lineHeight: 20, textAlign: 'center' }
});
