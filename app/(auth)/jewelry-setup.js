import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { wearableBLE as bleService } from '../../src/services/device-manager/WearableDevice';
import { useAppState } from '../../src/context/AppContext';
import { colors, radii, sizes, spacing, typography } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { EmptyState } from '../../src/components/EmptyState';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { LoadingState } from '../../src/components/LoadingState';
import { StatusPill } from '../../src/components/StatusPill';
import { images } from '../../src/constants/assets';
import { useAuth } from '../../src/context/AuthContext';
import { bleErrorTranslationKey } from '../../src/services/ble-errors';

export default function JewelrySetup() {
  const params = useLocalSearchParams();
  const mode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const additional = mode === 'additional';
  const standalone = mode === 'standalone' || additional;
  const [devices, setDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState(null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const appStateRef = useRef(AppState.currentState);
  const stopScanRef = useRef(null);
  const finishingRef = useRef(false);
  const { setDevice, setWearableEntities } = useAppState();
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
      if (additional) {
        await setWearableEntities((current) => current.some((wearable) => wearable.deviceId === connected.id)
          ? current
          : [...current, {
              ...connected,
              deviceId: connected.id,
              deviceType: 'wearable',
              online: true
            }]);
      } else {
        await setDevice(connected);
      }
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
  }, [additional, finishSetup, setDevice, setWearableEntities, stopScan]);

  const openSystemSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      if (mountedRef.current) {
        setError({ code: 'SETTINGS_LINK_FAILED', translationKey: 'settings.linkFailed' });
      }
    }
  }, []);

  return (
    <Screen scroll={false}>
      <Header title={t('jewelry.pairTitle')} subtitle={t('jewelry.pairSubtitle')} />
      <Card variant="tinted" style={styles.scanSummary}>
        <View style={styles.scanIcon}>
          <Ionicons accessible={false} name="bluetooth" size={sizes.iconLarge} color={colors.actionAccent} />
        </View>
        <View style={styles.scanCopy} accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" style={styles.scanTitle}>{scanning ? t('jewelry.scanning') : t('jewelry.pairTitle')}</Text>
          <Text style={styles.scanMessage}>{scanning ? t('jewelry.searchingMessage') : t('jewelry.pairSubtitle')}</Text>
        </View>
        <StatusPill
          label={scanning ? t('jewelry.scanning') : String(devices.length)}
          tone={scanning ? 'active' : devices.length ? 'ok' : 'idle'}
        />
      </Card>
      <Button
        title={scanning ? t('jewelry.scanning') : t('jewelry.scan')}
        icon="bluetooth"
        onPress={scan}
        loading={scanning}
      />
      <FeedbackBanner
        message={error?.translationKey ? t(error.translationKey) : error}
        tone={error?.code === 'BLE_UNAVAILABLE' ? 'info' : 'error'}
        actionLabel={error?.code === 'BLE_PERMISSION_DENIED' ? t('common.settings') : t('common.retry')}
        onAction={error?.code === 'BLE_PERMISSION_DENIED' ? openSystemSettings : scan}
      />
      <FlatList
        data={devices}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Card style={styles.deviceCard}>
            <View style={styles.deviceHeading}>
              <View style={styles.deviceIcon}>
                <Ionicons accessible={false} name="watch-outline" size={sizes.icon} color={colors.textPrimary} />
              </View>
              <View style={styles.scanCopy}>
                <Text style={styles.deviceName}>{item.name || item.id}</Text>
                {Number.isFinite(item.rssi) ? <Text style={styles.deviceMeta}>{item.rssi} dBm</Text> : null}
              </View>
            </View>
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
              actionLabel={t('jewelry.scan')}
              onAction={scan}
            />
          )}
        contentContainerStyle={styles.list}
      />
      <Button title={t('common.skip')} variant="ghost" disabled={Boolean(connectingId)} onPress={finishSetup} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, paddingVertical: spacing.sm },
  scanSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  scanIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised
  },
  scanCopy: { flex: 1, minWidth: 0 },
  scanTitle: { ...typography.heading, color: colors.textPrimary },
  scanMessage: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  deviceCard: { marginBottom: spacing.sm, gap: spacing.mdSm },
  deviceHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm },
  deviceIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted
  },
  deviceName: { ...typography.label, color: colors.textPrimary },
  deviceMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }
});
