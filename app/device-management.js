import { useState } from 'react';
import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { images } from '../src/constants/assets';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { bleService } from '../src/services/ble';

export default function DeviceManagement() {
  const { device, setDevice } = useAppState();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reconnecting = device.connectionState === 'reconnecting';
  const status = device.connected
    ? (Number.isFinite(device.battery)
      ? t('device.connected', { battery: device.battery })
      : t('safetyCall.connected'))
    : (reconnecting ? t('common.connecting') : t('device.none'));

  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await bleService.disconnect(device.id);
      await setDevice({
        ...device,
        connected: false,
        connectionState: 'disconnected',
        autoReconnect: false,
        lastErrorCode: null
      });
    } catch (disconnectError) {
      setError(disconnectError?.code?.startsWith('BLE_')
        ? disconnectError.message
        : t('jewelry.connectFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={t('device.title')} subtitle={t('device.subtitle')} />
      <Image
        source={device.connected ? images.jewelryConnected : images.jewelryDisconnected}
        style={{ width: '100%', height: 220 }}
        resizeMode="contain"
      />
      <FeedbackBanner message={error} />
      <Card>
        <Text style={{ fontFamily: fonts.bold }}>{device.name}</Text>
        <Text>{status}</Text>
      </Card>
      <Button
        title={device.connected ? t('device.disconnect') : (reconnecting ? t('common.connecting') : t('device.connect'))}
        loading={busy || reconnecting}
        onPress={() => device.connected ? disconnect() : router.push('/(auth)/jewelry-setup?mode=standalone')}
      />
    </Screen>
  );
}
