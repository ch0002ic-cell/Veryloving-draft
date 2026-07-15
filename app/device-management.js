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
import { bleErrorTranslationKey } from '../src/services/ble-errors';

export default function DeviceManagement() {
  const { device, reconnectPairedDevice, removePairedDevice } = useAppState();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const reconnecting = device.connectionState === 'reconnecting';
  const status = device.connected
    ? (Number.isFinite(device.battery)
      ? t('device.connected', { battery: device.battery })
      : t('safetyCall.connected'))
    : (reconnecting ? t('common.connecting') : t('device.none'));
  const connectionErrorKey = device.lastErrorCode
    ? bleErrorTranslationKey({ code: device.lastErrorCode }, 'connect')
    : null;

  const reconnect = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      await reconnectPairedDevice();
    } catch {
      setErrorKey('settings.updateFailedMessage');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setErrorKey(null);
    try {
      const result = await removePairedDevice();
      if (!result.nativeDisconnected) {
        setErrorKey('settings.updateFailedMessage');
      }
    } catch {
      setErrorKey('settings.updateFailedMessage');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={t('device.title')} subtitle={t('device.subtitle')} showBack backLabel={t('common.back')} />
      <Image
        source={device.connected ? images.jewelryConnected : images.jewelryDisconnected}
        style={{ width: '100%', height: 220 }}
        resizeMode="contain"
      />
      <FeedbackBanner message={errorKey ? t(errorKey) : connectionErrorKey ? t(connectionErrorKey) : null} />
      <Card>
        <Text style={{ fontFamily: fonts.bold }}>{device.name}</Text>
        <Text>{status}</Text>
      </Card>
      {device.id && !device.connected ? (
        <Button
          title={t('safetyCall.reconnect')}
          icon="refresh-outline"
          loading={reconnecting}
          disabled={busy || reconnecting}
          onPress={reconnect}
        />
      ) : null}
      <Button
        title={device.id ? t('common.remove') : t('device.connect')}
        accessibilityLabel={device.id ? `${t('common.remove')} ${device.name}` : t('device.connect')}
        variant={device.id ? 'danger' : 'primary'}
        loading={busy}
        disabled={busy}
        onPress={() => device.id ? remove() : router.push('/jewelry-setup?mode=standalone')}
      />
    </Screen>
  );
}
