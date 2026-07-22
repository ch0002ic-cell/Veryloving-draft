import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { AppState, Linking, StyleSheet, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import {
  notificationsAvailableInRuntime,
  requestNotificationPermission
} from '../../src/services/notifications';
import { colors, typography } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';
import { useAuth } from '../../src/context/AuthContext';

export default function NotificationPermission() {
  const { t } = useI18n();
  const { advanceOnboarding } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const [notificationsAvailable, setNotificationsAvailable] = useState(null);
  const [availabilityCheckFailed, setAvailabilityCheckFailed] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const requestingRef = useRef(false);
  const navigatingRef = useRef(false);
  const awaitingSettingsReturnRef = useRef(false);

  useEffect(() => {
    let active = true;
    notificationsAvailableInRuntime()
      .then((available) => {
        if (active) setNotificationsAvailable(available);
      })
      .catch(() => {
        if (!active) return;
        setNotificationsAvailable(false);
        setAvailabilityCheckFailed(true);
        setErrorKey('settings.updateFailedMessage');
      });
    return () => {
      active = false;
    };
  }, []);

  const retryAvailabilityCheck = useCallback(async () => {
    setNotificationsAvailable(null);
    setAvailabilityCheckFailed(false);
    setErrorKey(null);
    try {
      setNotificationsAvailable(await notificationsAvailableInRuntime());
    } catch {
      setNotificationsAvailable(false);
      setAvailabilityCheckFailed(true);
      setErrorKey('settings.updateFailedMessage');
    }
  }, []);

  const continueOnboarding = useCallback(async () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setErrorKey(null);
    try {
      await advanceOnboarding('/(auth)/device-check');
      router.push('/(auth)/device-check');
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
    try {
      if (notificationsAvailable !== true) {
        await continueOnboarding();
        return;
      }
      const granted = await requestNotificationPermission({ showRationale: false });
      if (granted) await continueOnboarding();
      else {
        setPermissionDenied(true);
        setErrorKey('permissions.notificationsRationaleMessage');
      }
    } catch {
      setPermissionDenied(true);
      setErrorKey('permissions.notificationsRationaleMessage');
    } finally {
      requestingRef.current = false;
      setBusy(false);
    }
  }, [continueOnboarding, notificationsAvailable]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState !== 'active' || !awaitingSettingsReturnRef.current || navigatingRef.current) return;
      awaitingSettingsReturnRef.current = false;
      requestingRef.current = true;
      setBusy(true);
      try {
        const granted = await requestNotificationPermission({ showRationale: false });
        if (granted) await continueOnboarding();
        else setErrorKey('permissions.notificationsRationaleMessage');
      } catch {
        setErrorKey('permissions.notificationsRationaleMessage');
      } finally {
        requestingRef.current = false;
        setBusy(false);
      }
    });
    return () => subscription.remove();
  }, [continueOnboarding]);

  const openNotificationSettings = useCallback(async () => {
    if (requestingRef.current || navigatingRef.current) return;
    requestingRef.current = true;
    setBusy(true);
    try {
      awaitingSettingsReturnRef.current = true;
      await Linking.openSettings();
    } catch {
      awaitingSettingsReturnRef.current = false;
      setErrorKey('permissions.notificationsRationaleMessage');
    } finally {
      requestingRef.current = false;
      setBusy(false);
    }
  }, []);

  return (
    <Screen>
      <Header title={t('permissions.notificationsTitle')} subtitle={t('permissions.notificationsSubtitle')} />
      <Card variant="tinted"><Text style={styles.body}>{t('permissions.notificationsBody')}</Text></Card>
      <FeedbackBanner
        message={errorKey ? t(errorKey) : null}
        tone="info"
        actionLabel={availabilityCheckFailed ? t('common.retry') : undefined}
        onAction={availabilityCheckFailed ? retryAvailabilityCheck : undefined}
      />
      <Button
        title={permissionDenied
          ? t('common.settings')
          : notificationsAvailable ? t('permissions.enableNotifications') : t('common.continue')}
        loading={busy || notificationsAvailable === null}
        disabled={busy || notificationsAvailable === null}
        onPress={permissionDenied ? openNotificationSettings : requestPermission}
      />
      <Button
        title={t('common.skip')}
        variant="ghost"
        disabled={busy}
        onPress={continueOnboarding}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.bodyLarge, color: colors.textPrimary }
});
