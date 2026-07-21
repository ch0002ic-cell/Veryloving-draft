import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { useAuth } from '../src/context/AuthContext';
import { useAppState } from '../src/context/AppContext';
import { pairHomeRobot } from '../src/services/robot-pairing';
import { colors, fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

export default function RobotPairingScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const [robotVendor, setRobotVendor] = useState('yongyida');
  const pairingInFlightRef = useRef(false);
  const { accessToken, user } = useAuth();
  const { setRobotEntities } = useAppState();
  const { t } = useI18n();

  const pair = useCallback(async ({ data }) => {
    // Camera callbacks can fire more than once in the same React render. A
    // ref closes that synchronous window before the busy state is published,
    // protecting the manufacturer's one-time pairing credential from reuse.
    if (pairingInFlightRef.current || typeof data !== 'string') return;
    pairingInFlightRef.current = true;
    setBusy(true);
    setErrorKey(null);
    try {
      const paired = await pairHomeRobot(data, accessToken, { accountId: user?.id, vendor: robotVendor });
      await setRobotEntities((current) => current.some((robot) => robot.deviceId === paired.robot_id)
        ? current
        : [...current, {
            deviceId: paired.robot_id,
            deviceType: 'home_robot',
            name: 'VeryLoving Home',
            online: false,
            connectionState: 'disconnected'
          }]);
      router.replace('/device-management');
    } catch {
      pairingInFlightRef.current = false;
      setErrorKey('settings.updateFailedMessage');
      setBusy(false);
    }
  }, [accessToken, robotVendor, setRobotEntities, user?.id]);

  if (!permission) return <Screen><Header title={t('settings.deviceManagement')} showBack /><Text>{t('common.loading')}</Text></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Header title={t('settings.deviceManagement')} showBack />
        <Text style={styles.copy}>{t('permissions.cameraRationaleMessage')}</Text>
        <Button title={t('common.continue')} onPress={requestPermission} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header title={t('settings.deviceManagement')} subtitle={t('jewelry.scan')} showBack />
      <View style={styles.vendorButtons}>
        <Button
          title="Yongyida"
          selected={robotVendor === 'yongyida'}
          variant={robotVendor === 'yongyida' ? 'primary' : 'ghost'}
          onPress={() => setRobotVendor('yongyida')}
          disabled={busy}
        />
        <Button
          title="Jiangzhi"
          selected={robotVendor === 'jiangzhi'}
          variant={robotVendor === 'jiangzhi' ? 'primary' : 'ghost'}
          onPress={() => setRobotVendor('jiangzhi')}
          disabled={busy}
        />
      </View>
      <View style={styles.cameraFrame}>
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : pair}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <FeedbackBanner message={errorKey ? t(errorKey) : null} />
      {errorKey ? <Button title={t('common.retry')} onPress={() => { setErrorKey(null); setBusy(false); }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: { height: 360, overflow: 'hidden', borderRadius: 12, backgroundColor: colors.ink },
  vendorButtons: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  copy: { fontFamily: fonts.regular, color: colors.ink }
});
