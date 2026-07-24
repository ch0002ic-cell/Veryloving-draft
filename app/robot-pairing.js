import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { LoadingState } from '../src/components/LoadingState';
import { useAuth } from '../src/context/AuthContext';
import { useAppState } from '../src/context/AppContext';
import { pairHomeRobot } from '../src/services/robot-pairing';
import { colors, radii, spacing, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

export default function RobotPairingScreen() {
  const [permission, requestPermission, getCameraPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const [robotVendor, setRobotVendor] = useState('yongyida');
  const pairingInFlightRef = useRef(false);
  const cameraAccessInFlightRef = useRef(false);
  const awaitingSettingsReturnRef = useRef(false);
  const { accessToken, user } = useAuth();
  const { setRobotEntities } = useAppState();
  const { isRTL, t } = useI18n();
  const title = `${t('common.add')} · ${t('medication.robot')}`;

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
            name: null,
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

  const openCameraAccess = async () => {
    if (cameraAccessInFlightRef.current) return;
    cameraAccessInFlightRef.current = true;
    setBusy(true);
    setErrorKey(null);
    try {
      if (permission?.canAskAgain === false) {
        awaitingSettingsReturnRef.current = true;
        await Linking.openSettings();
      }
      else await requestPermission();
    } catch {
      awaitingSettingsReturnRef.current = false;
      setErrorKey('settings.updateFailedMessage');
    } finally {
      cameraAccessInFlightRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || !awaitingSettingsReturnRef.current) return;
      awaitingSettingsReturnRef.current = false;
      getCameraPermission().catch(() => {
        if (active) setErrorKey('settings.updateFailedMessage');
      });
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [getCameraPermission]);

  const retryScan = () => {
    pairingInFlightRef.current = false;
    setCameraFailed(false);
    setErrorKey(null);
    setBusy(false);
  };

  const handleCameraMountError = () => {
    pairingInFlightRef.current = false;
    setCameraFailed(true);
    setErrorKey('settings.updateFailedMessage');
    setBusy(false);
  };

  if (!permission) {
    return (
      <Screen>
        <Header title={title} showBack backLabel={t('common.back')} />
        <LoadingState message={t('common.loading')} />
      </Screen>
    );
  }
  if (!permission.granted) {
    return (
      <Screen>
        <Header title={title} subtitle={t('permissions.cameraRationaleTitle')} showBack backLabel={t('common.back')} />
        <View style={styles.permissionGraphic}>
          <Ionicons accessible={false} name="qr-code-outline" size={56} color={colors.blueAccessible} />
        </View>
        <Text style={[styles.copy, isRTL && styles.rtlText]}>
          {t('permissions.cameraRationaleMessage')}
        </Text>
        <FeedbackBanner message={errorKey ? t(errorKey) : null} />
        <Button
          title={permission.canAskAgain === false ? t('common.settings') : t('common.continue')}
          icon={permission.canAskAgain === false ? 'settings-outline' : 'camera-outline'}
          loading={busy}
          disabled={busy}
          onPress={openCameraAccess}
        />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header title={title} subtitle={t('permissions.cameraRationaleTitle')} showBack backLabel={t('common.back')} />
      <View accessibilityRole="radiogroup" style={[styles.vendorButtons, isRTL && styles.rtlRow]}>
        {[
          { id: 'yongyida', label: 'Yongyida' },
          { id: 'jiangzhi', label: 'Jiangzhi' }
        ].map((vendor) => {
          const selected = robotVendor === vendor.id;
          return (
            <Pressable
              key={vendor.id}
              accessibilityLabel={vendor.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled: busy }}
              disabled={busy}
              onPress={() => setRobotVendor(vendor.id)}
              style={({ pressed }) => [
                styles.vendorChoice,
                selected && styles.vendorSelected,
                pressed && styles.pressed
              ]}
            >
              <Ionicons
                accessible={false}
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={20}
                color={selected ? colors.blueAccessible : colors.textSecondary}
              />
              <Text style={[styles.vendorLabel, selected && styles.vendorLabelSelected]}>{vendor.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.cameraFrame}>
        {cameraFailed ? (
          <View
            accessible={false}
            style={styles.cameraUnavailable}
          >
            <Ionicons accessible={false} name="camera-outline" size={48} color={colors.textInverse} />
          </View>
        ) : (
          <>
            <CameraView
              accessible={false}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : pair}
              onMountError={handleCameraMountError}
              style={StyleSheet.absoluteFill}
            />
            <View accessible={false} pointerEvents="none" style={styles.scanGuide}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </>
        )}
        {busy ? (
          <View
            accessibilityLabel={t('common.connecting')}
            accessibilityLiveRegion="polite"
            accessibilityRole="progressbar"
            accessibilityState={{ busy: true }}
            style={styles.progressOverlay}
          >
            <ActivityIndicator color={colors.textInverse} />
            <Text style={styles.progressText}>{t('common.connecting')}</Text>
          </View>
        ) : null}
      </View>
      <FeedbackBanner message={errorKey ? t(errorKey) : null} />
      {errorKey ? <Button title={t('common.retry')} icon="refresh-outline" onPress={retryScan} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: { flex: 1, minHeight: 240, overflow: 'hidden', borderRadius: radii.xl, backgroundColor: colors.textPrimary },
  cameraUnavailable: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  vendorButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  vendorChoice: { minHeight: 48, minWidth: 140, flexBasis: '47%', flexGrow: 1, paddingHorizontal: spacing.mdSm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.borderControl, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  vendorSelected: { borderColor: colors.blueAccessible, borderWidth: 2, backgroundColor: colors.blueSoft },
  vendorLabel: { flexShrink: 1, ...typography.label, color: colors.textPrimary, textAlign: 'center' },
  vendorLabelSelected: { color: colors.blueAccessible },
  pressed: { opacity: 0.68 },
  scanGuide: { position: 'absolute', top: '18%', right: '14%', bottom: '18%', left: '14%' },
  corner: { position: 'absolute', width: 48, height: 48, borderColor: colors.surfaceRaised },
  topLeft: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radii.lg },
  topRight: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radii.lg },
  bottomLeft: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radii.lg },
  bottomRight: { right: 0, bottom: 0, borderRightWidth: 4, borderBottomWidth: 4, borderBottomRightRadius: radii.lg },
  progressOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.scrimStrong },
  progressText: { ...typography.bodyLarge, color: colors.textInverse, fontFamily: typography.label.fontFamily },
  permissionGraphic: { minHeight: 160, alignItems: 'center', justifyContent: 'center', borderRadius: radii.xl, backgroundColor: colors.blueSoft },
  copy: { ...typography.bodyLarge, color: colors.textPrimary },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' }
});
