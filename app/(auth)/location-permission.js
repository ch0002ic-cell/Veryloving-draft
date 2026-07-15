import { useCallback, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Linking, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { requestLocationPermission } from '../../src/services/mapbox';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { useAuth } from '../../src/context/AuthContext';

export default function LocationPermission() {
  const { t } = useI18n();
  const { advanceOnboarding } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const requestingRef = useRef(false);
  const navigatingRef = useRef(false);

  const continueOnboarding = useCallback(async () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setErrorKey(null);
    try {
      await advanceOnboarding('/(auth)/notification-permission');
      router.push('/(auth)/notification-permission');
    } catch {
      navigatingRef.current = false;
      setErrorKey('settings.updateFailedMessage');
    }
  }, [advanceOnboarding]);

  const requestPermission = useCallback(async () => {
    if (requestingRef.current || navigatingRef.current) return;
    requestingRef.current = true;
    setBusy(true);
    setErrorKey(null);
    setPermissionDenied(false);
    try {
      await requestLocationPermission({ showRationale: false });
      await continueOnboarding();
    } catch (permissionError) {
      setPermissionDenied(permissionError?.code === 'LOCATION_PERMISSION_DENIED');
      setErrorKey(permissionError?.code === 'LOCATION_NOT_REQUESTED'
        ? 'map.notRequested'
        : permissionError?.code === 'LOCATION_PERMISSION_DENIED'
          ? 'map.permissionOff'
          : 'map.updateFailed');
    } finally {
      requestingRef.current = false;
      setBusy(false);
    }
  }, [continueOnboarding]);

  return (
    <Screen>
      <Header title={t('permissions.locationTitle')} subtitle={t('permissions.locationSubtitle')} />
      <Card><Text style={{ fontFamily: fonts.regular }}>{t('permissions.locationBody')}</Text></Card>
      <FeedbackBanner
        message={errorKey ? t(errorKey) : null}
        actionLabel={permissionDenied ? t('common.settings') : undefined}
        onAction={permissionDenied ? () => Linking.openSettings().catch(() => {}) : undefined}
      />
      <Button
        title={t('permissions.allowLocation')}
        loading={busy}
        disabled={busy}
        onPress={requestPermission}
      />
      <Button
        title={t('common.skipForNow')}
        variant="ghost"
        disabled={busy}
        onPress={continueOnboarding}
      />
    </Screen>
  );
}
