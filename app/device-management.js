import { useState } from 'react';
import { Image, StyleSheet, Text, TextInput, View } from 'react-native';
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
  const { device, setDevice, reconnectPairedDevice, removePairedDevice, wearableEntities, robotEntities, setRobotEntities } = useAppState();
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

  const rename = async (entity, name) => {
    const nextName = name.trim().slice(0, 80);
    if (!nextName) return;
    if (entity.deviceType === 'wearable') await setDevice({ ...device, name: nextName });
    else setRobotEntities((current) => current.map((robot) => robot.deviceId === entity.deviceId ? { ...robot, name: nextName } : robot));
  };

  const entities = [...wearableEntities, ...robotEntities];

  return (
    <Screen>
      <Header title={t('device.title')} subtitle={t('device.subtitle')} showBack backLabel={t('common.back')} />
      <Image
        source={device.connected ? images.jewelryConnected : images.jewelryDisconnected}
        style={{ width: '100%', height: 220 }}
        resizeMode="contain"
      />
      <FeedbackBanner message={errorKey ? t(errorKey) : connectionErrorKey ? t(connectionErrorKey) : null} />
      <Text style={styles.sectionTitle}>My Devices</Text>
      {entities.map((entity) => (
        <Card key={`${entity.deviceType}:${entity.deviceId}`}>
          <View style={styles.deviceRow}>
            <View style={styles.deviceCopy}>
              <Text style={styles.deviceType}>{entity.deviceType === 'wearable' ? 'Wearable' : 'Home robot'}</Text>
              <TextInput
                accessibilityLabel={`Name ${entity.name}`}
                defaultValue={entity.name}
                maxLength={80}
                onEndEditing={(event) => rename(entity, event.nativeEvent.text).catch(() => setErrorKey('settings.updateFailedMessage'))}
                style={styles.nameInput}
              />
            </View>
            <Text style={entity.online ? styles.online : styles.offline}>{entity.online ? 'Online' : 'Offline'}</Text>
          </View>
        </Card>
      ))}
      {!entities.length ? <Text>No devices paired.</Text> : null}
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

const styles = StyleSheet.create({
  sectionTitle: { fontFamily: fonts.bold, fontSize: 20 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  deviceCopy: { flex: 1 },
  deviceType: { fontFamily: fonts.regular, opacity: 0.7 },
  nameInput: { fontFamily: fonts.bold, fontSize: 16, paddingVertical: 8 },
  online: { color: '#257A43', fontFamily: fonts.bold },
  offline: { color: '#7A3340', fontFamily: fonts.bold }
});
