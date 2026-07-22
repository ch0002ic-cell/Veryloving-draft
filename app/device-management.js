import { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { DeviceStatusCard } from '../src/components/DeviceStatusCard';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { useAppState } from '../src/context/AppContext';
import { colors, spacing, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { bleErrorTranslationKey } from '../src/services/ble-errors';
import { factoryResetHomeRobot } from '../src/services/robot-pairing';
import { useAuth } from '../src/context/AuthContext';

export default function DeviceManagement() {
  const { device, setDevice, reconnectPairedDevice, removePairedDevice, wearableEntities, setWearableEntities, robotEntities, setRobotEntities, deviceHydrationErrorCode, retryDeviceHydration } = useAppState();
  const { isRTL, t } = useI18n();
  const { accessToken, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const reconnecting = device.connectionState === 'reconnecting';
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

  const addWearable = () => {
    if (device.id) router.push('/jewelry-setup?mode=additional');
    else router.push('/jewelry-setup?mode=standalone');
  };

  const entities = useMemo(() => {
    const unique = new Map();
    for (const entity of [...wearableEntities, ...robotEntities]) {
      const key = `${entity.deviceType}:${entity.deviceId}`;
      if (!unique.has(key)) unique.set(key, entity);
    }
    return [...unique.values()];
  }, [robotEntities, wearableEntities]);

  return (
    <Screen>
      <Header
        title={t('settings.deviceManagement')}
        subtitle={`${t('home.northStarDevice')} · ${t('medication.robot')}`}
        showBack
        backLabel={t('common.back')}
      />
      <FeedbackBanner message={errorKey
        ? t(errorKey)
        : deviceHydrationErrorCode
          ? t('settings.updateFailedMessage')
          : connectionErrorKey ? t(connectionErrorKey) : null} />
      {deviceHydrationErrorCode ? (
        <Button
          title={t('common.retry')}
          icon="refresh-outline"
          variant="ghost"
          onPress={retryDeviceHydration}
        />
      ) : null}
      <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('settings.sections.deviceSafety')}</Text>
      {entities.map((entity) => (
        <DeviceStatusCard
          key={`${entity.deviceType}:${entity.deviceId}`}
          entity={entity}
          editable
          disabled={busy}
          onRename={async (name) => {
            setErrorKey(null);
            try {
              await rename(entity, name);
            } catch (error) {
              setErrorKey('settings.updateFailedMessage');
              throw error;
            }
          }}
          actions={(
            <>
              {entity.deviceType === 'wearable' && entity.deviceId === device.id && !device.connected ? (
                <Button
                  title={t('safetyCall.reconnect')}
                  icon="refresh-outline"
                  variant="ghost"
                  compact
                  loading={reconnecting}
                  disabled={busy || reconnecting}
                  onPress={reconnect}
                />
              ) : null}
              <Button
                title={t('common.remove')}
                accessibilityLabel={`${t('common.remove')} ${entity.name}`}
                variant={entity.deviceType === 'home_robot' ? 'danger' : 'ghost'}
                compact
                disabled={busy}
                onPress={() => entity.deviceType === 'home_robot'
                  ? resetRobot(entity)
                  : removeSecondaryWearable(entity)}
              />
            </>
          )}
        >
          {entity.deviceType === 'home_robot' && entity.indoorPosition ? (
            <Text style={[styles.telemetry, isRTL && styles.rtlText]}>
              {entity.indoorPosition.roomId || entity.indoorPosition.mapId}
              {entity.indoorPosition.floorId ? ` · ${entity.indoorPosition.floorId}` : ''}
            </Text>
          ) : null}
        </DeviceStatusCard>
      ))}
      {!entities.length ? <Text style={[styles.empty, isRTL && styles.rtlText]}>{t('device.none')}</Text> : null}
      <View style={[styles.addRow, isRTL && styles.rtlRow]}>
        <Button
          title={`${t('common.add')} · ${t('medication.robot')}`}
          icon="qr-code-outline"
          variant="ghost"
          style={styles.addButton}
          onPress={() => router.push('/robot-pairing')}
        />
        <Button
          title={t('auth.setupJewelry')}
          icon="bluetooth"
          variant="ghost"
          style={styles.addButton}
          onPress={addWearable}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { ...typography.title, color: colors.textPrimary },
  telemetry: { flex: 1, ...typography.caption, color: colors.textSecondary },
  empty: { paddingVertical: spacing.lg, ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  addButton: { minWidth: 148, flexBasis: '47%', flexGrow: 1 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' }
});
