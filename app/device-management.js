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

export default function DeviceManagement() {
  const { device, removePairedDevice } = useAppState();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const reconnecting = device.connectionState === 'reconnecting';
  const status = device.connected
    ? (Number.isFinite(device.battery)
      ? t('device.connected', { battery: device.battery })
      : t('safetyCall.connected'))
    : (reconnecting ? t('common.connecting') : t('device.none'));

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await removePairedDevice();
      if (!result.nativeDisconnected) {
        setError('NorthStar was removed, but Bluetooth could not disconnect it. Turn Bluetooth off and on if it still appears connected.');
      }
    } catch {
      setError(t('settings.updateFailedMessage'));
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
        title={device.id ? t('common.remove') : t('device.connect')}
        accessibilityLabel={device.id ? `${t('common.remove')} ${device.name}` : t('device.connect')}
        variant={device.id ? 'danger' : 'primary'}
        loading={busy}
        onPress={() => device.id ? remove() : router.push('/(auth)/jewelry-setup?mode=standalone')}
      />
    </Screen>
  );
}
