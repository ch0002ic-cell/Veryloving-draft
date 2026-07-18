import { useState } from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { factoryResetHomeRobot } from '../src/services/robot-pairing';
import { useAuth } from '../src/context/AuthContext';

export default function DeviceManagement() {
  const { device, setDevice, reconnectPairedDevice, removePairedDevice, wearableEntities, setWearableEntities, robotEntities, setRobotEntities } = useAppState();
  const { t } = useI18n();
  const { accessToken, user } = useAuth();
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
    if (entity.deviceType === 'wearable' && entity.deviceId === device.id) await setDevice({ ...device, name: nextName });
    else if (entity.deviceType === 'wearable') await setWearableEntities((current) => current.map((wearable) => wearable.deviceId === entity.deviceId ? { ...wearable, name: nextName } : wearable));
    else await setRobotEntities((current) => current.map((robot) => robot.deviceId === entity.deviceId ? { ...robot, name: nextName } : robot));
  };

  const removeSecondaryWearable = async (entity) => {
    if (entity.deviceId === device.id) return remove();
    setBusy(true);
    setErrorKey(null);
    try {
      await setWearableEntities((current) => current.filter((wearable) => wearable.deviceId !== entity.deviceId));
    } catch {
      setErrorKey('settings.updateFailedMessage');
    } finally {
      setBusy(false);
    }
  };

  const resetRobot = (entity) => {
    Alert.alert(
      t('contacts.removeTitle', { name: entity.name }),
      t('history.cannotUndo'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setErrorKey(null);
            try {
              await factoryResetHomeRobot(entity.deviceId, accessToken, { accountId: user?.id });
              await setRobotEntities((current) => current.filter((robot) => robot.deviceId !== entity.deviceId));
            } catch {
              setErrorKey('settings.updateFailedMessage');
            } finally {
              setBusy(false);
            }
          }
        }
      ]
    );
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
      <Text style={styles.sectionTitle}>{t('settings.deviceManagement')}</Text>
      {entities.map((entity) => (
        <Card key={`${entity.deviceType}:${entity.deviceId}`}>
          <View style={styles.deviceRow}>
            <View style={styles.deviceCopy}>
              <Text style={styles.deviceType}>
                {entity.deviceType === 'wearable' ? t('home.northStarDevice') : 'VeryLoving Home'}
              </Text>
              <TextInput
                accessibilityLabel={`${t('contacts.name')} ${entity.name}`}
                defaultValue={entity.name}
                maxLength={80}
                onEndEditing={(event) => rename(entity, event.nativeEvent.text).catch(() => setErrorKey('settings.updateFailedMessage'))}
                style={styles.nameInput}
              />
              {entity.deviceType === 'home_robot' && Number.isFinite(entity.lastSeenAt) ? (
                <Text style={styles.telemetry}>
                  {t('safetyCall.connected')} · {new Date(entity.lastSeenAt).toLocaleString()}
                </Text>
              ) : null}
              {entity.deviceType === 'home_robot' && entity.location ? (
                <Text style={styles.telemetry}>
                  {t('permissions.locationTitle')} · {Number(entity.location.latitude).toFixed(5)}, {Number(entity.location.longitude).toFixed(5)}
                </Text>
              ) : null}
              {entity.deviceType === 'home_robot' && entity.indoorPosition ? (
                <Text style={styles.telemetry}>
                  {entity.indoorPosition.roomId || entity.indoorPosition.mapId}
                  {entity.indoorPosition.floorId ? ` · ${entity.indoorPosition.floorId}` : ''}
                </Text>
              ) : null}
              {entity.deviceType === 'wearable' ? (
                <Button
                  title={t('common.remove')}
                  variant="ghost"
                  compact
                  disabled={busy}
                  onPress={() => removeSecondaryWearable(entity)}
                />
              ) : null}
              {entity.deviceType === 'home_robot' ? (
                <Button
                  title={t('common.remove')}
                  variant="danger"
                  compact
                  disabled={busy}
                  onPress={() => resetRobot(entity)}
                />
              ) : null}
            </View>
            <Text style={entity.online ? styles.online : styles.offline}>
              {entity.online ? t('safetyCall.connected') : t('safetyCall.offline')}
            </Text>
          </View>
        </Card>
      ))}
      {!entities.length ? <Text>{t('device.none')}</Text> : null}
      <Button title={t('common.add')} icon="qr-code-outline" variant="ghost" onPress={() => router.push('/robot-pairing')} />
      {device.id ? (
        <Button
          title={t('device.connect')}
          icon="bluetooth"
          variant="ghost"
          onPress={() => router.push('/jewelry-setup?mode=additional')}
        />
      ) : null}
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
  telemetry: { fontFamily: fonts.regular, fontSize: 13, opacity: 0.75 },
  online: { color: '#257A43', fontFamily: fonts.bold },
  offline: { color: '#7A3340', fontFamily: fonts.bold }
});
