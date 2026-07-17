import { useCallback, useState } from 'react';
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

export default function RobotPairingScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { accessToken } = useAuth();
  const { setRobotEntities } = useAppState();

  const pair = useCallback(async ({ data }) => {
    if (busy || typeof data !== 'string') return;
    setBusy(true);
    setError(null);
    try {
      const paired = await pairHomeRobot(data, accessToken);
      await setRobotEntities((current) => current.some((robot) => robot.deviceId === paired.robot_id)
        ? current
        : [...current, {
            deviceId: paired.robot_id,
            deviceType: 'home_robot',
            name: 'Home robot',
            online: false,
            connectionState: 'disconnected'
          }]);
      router.replace('/device-management');
    } catch (pairingError) {
      setError(pairingError?.message || 'Robot pairing failed. Request a new QR code and try again.');
      setBusy(false);
    }
  }, [accessToken, busy, setRobotEntities]);

  if (!permission) return <Screen><Header title="Pair home robot" showBack /><Text>Checking camera access…</Text></Screen>;
  if (!permission.granted) {
    return (
      <Screen>
        <Header title="Pair home robot" showBack />
        <Text style={styles.copy}>Camera access is required to scan the manufacturer’s one-time pairing QR code.</Text>
        <Button title="Allow camera access" onPress={requestPermission} />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header title="Pair home robot" subtitle="Scan the one-time QR code shown on your robot" showBack />
      <View style={styles.cameraFrame}>
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={busy ? undefined : pair}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <FeedbackBanner message={error} />
      {error ? <Button title="Scan again" onPress={() => { setError(null); setBusy(false); }} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: { height: 360, overflow: 'hidden', borderRadius: 12, backgroundColor: colors.ink },
  copy: { fontFamily: fonts.regular, color: colors.ink }
});
