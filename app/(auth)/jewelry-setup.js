import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { bleService } from '../../src/services/ble';
import { useAppState } from '../../src/context/AppContext';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { images } from '../../src/constants/assets';

export default function JewelrySetup() {
  const params = useLocalSearchParams();
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const standalone = mode === 'standalone';
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const stopScanRef = useRef(null);
  const { setDevice } = useAppState();
  const { t } = useI18n();

  const finishSetup = useCallback(() => {
    if (!standalone) {
      router.push('/(auth)/capybear-setup');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/device-management');
  }, [standalone]);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    bleService.stopScan();
    if (mountedRef.current) setScanning(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState;
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
      if (!mountedRef.current || appStateRef.current !== 'active') cleanup();
      else stopScanRef.current = cleanup;
    } catch (scanError) {
      if (mountedRef.current) {
        setScanning(false);
        setError(scanError.message || t('jewelry.scanStartFailed'));
      }
    }
  }, [stopScan, t]);

  const connect = useCallback(async (candidate) => {
    stopScan();
    setError(null);
    setConnectingId(candidate.id);
    let connected = null;
    let remembered = false;
    try {
      connected = await bleService.connect(candidate);
      if (!mountedRef.current) {
        await bleService.disconnect(connected.id).catch(() => {});
        return;
      }
      await setDevice(connected);
      remembered = true;
      if (mountedRef.current) finishSetup();
    } catch (connectionError) {
      if (connected && !remembered) await bleService.disconnect(connected.id).catch(() => {});
      if (mountedRef.current) {
        setError(connectionError?.code?.startsWith('BLE_')
          ? connectionError.message
          : t('jewelry.connectFailed'));
      }
    } finally {
      if (mountedRef.current) setConnectingId(null);
    }
  }, [finishSetup, setDevice, stopScan, t]);

  return (
    <Screen scroll={false}>
      <Header title={t('jewelry.pairTitle')} subtitle={t('jewelry.pairSubtitle')} />
      <Button
        title={scanning ? t('jewelry.scanning') : t('jewelry.scan')}
        icon="bluetooth"
        onPress={scan}
        loading={scanning}
      />
      <FeedbackBanner message={error} actionLabel={t('common.retry')} onAction={scan} />
      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.deviceCard}>
            <Text style={styles.deviceName}>{item.name || item.id}</Text>
            <Button
              title={connectingId === item.id ? t('common.connecting') : t('common.connect')}
              onPress={() => connect(item)}
              loading={connectingId === item.id}
              disabled={Boolean(connectingId && connectingId !== item.id)}
            />
          </Card>
        )}
        ListEmptyComponent={scanning
          ? <LoadingState message={t('jewelry.searchingMessage')} />
          : (
            <EmptyState
              image={images.jewelryDisconnected}
              title={t('jewelry.emptyTitle')}
              message={t('jewelry.emptyMessage')}
            />
          )}
        contentContainerStyle={styles.list}
      />
      <Button title={t('common.skip')} variant="ghost" disabled={Boolean(connectingId)} onPress={finishSetup} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingVertical: 10 },
  deviceCard: { marginBottom: 10, gap: 10 },
  deviceName: { fontFamily: fonts.semibold, color: colors.ink },
  error: { fontFamily: fonts.regular, color: colors.redAccessible, lineHeight: 20, textAlign: 'center' }
});
