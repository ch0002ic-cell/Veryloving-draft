import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Linking, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { bleService } from '../../src/services/ble-runtime';
import { useAppState } from '../../src/context/AppContext';
import { colors, fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { images } from '../../src/constants/assets';
import { useAuth } from '../../src/context/AuthContext';
import { bleErrorTranslationKey } from '../../src/services/ble-errors';

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
  const finishingRef = useRef(false);
  const { setDevice } = useAppState();
  const { advanceOnboarding } = useAuth();
  const { t } = useI18n();

  const finishSetup = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    if (!standalone) {
      try {
        await advanceOnboarding('/(auth)/capybear-setup');
        router.push('/(auth)/capybear-setup');
      } catch {
        finishingRef.current = false;
        if (mountedRef.current) setError({ translationKey: 'settings.updateFailedMessage' });
      }
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/device-management');
  }, [advanceOnboarding, standalone]);

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
          onError: (scanError) => mountedRef.current && setError({
            code: scanError?.code,
            translationKey: bleErrorTranslationKey(scanError, 'scan')
          }),
          onComplete: () => mountedRef.current && setScanning(false)
        }
      );
      if (!mountedRef.current || appStateRef.current !== 'active') cleanup();
      else stopScanRef.current = cleanup;
    } catch (scanError) {
      if (mountedRef.current) {
        setScanning(false);
        setError({
          code: scanError?.code,
          translationKey: bleErrorTranslationKey(scanError, 'scan')
        });
      }
    }
  }, [stopScan]);

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
      if (mountedRef.current) await finishSetup();
    } catch (connectionError) {
      if (connected && !remembered) await bleService.disconnect(connected.id).catch(() => {});
      if (mountedRef.current) {
        setError({
          code: connectionError?.code,
          translationKey: bleErrorTranslationKey(connectionError, 'connect')
        });
      }
    } finally {
      if (mountedRef.current) setConnectingId(null);
    }
  }, [finishSetup, setDevice, stopScan]);

  return (
    <Screen scroll={false}>
      <Header title={t('jewelry.pairTitle')} subtitle={t('jewelry.pairSubtitle')} />
      <Button
        title={scanning ? t('jewelry.scanning') : t('jewelry.scan')}
        icon="bluetooth"
        onPress={scan}
        loading={scanning}
      />
      <FeedbackBanner
        message={error?.translationKey ? t(error.translationKey) : error}
        actionLabel={error?.code === 'BLE_PERMISSION_DENIED' ? t('common.settings') : t('common.retry')}
        onAction={error?.code === 'BLE_PERMISSION_DENIED'
          ? () => Linking.openSettings().catch(() => {})
          : scan}
      />
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
