import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Linking, Text } from 'react-native';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import {
  notificationsAvailableInRuntime,
  requestNotificationPermission
} from '../../src/services/notifications';
import { fonts } from '../../src/constants/theme';
import { useI18n } from '../../src/context/I18nContext';

export default function NotificationPermission() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notificationsAvailable, setNotificationsAvailable] = useState(null);
  const [availabilityCheckFailed, setAvailabilityCheckFailed] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const requestingRef = useRef(false);
  const navigatingRef = useRef(false);

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
        setError(t('settings.updateFailedMessage'));
      });
    return () => {
      active = false;
    };
  }, [t]);

  const retryAvailabilityCheck = useCallback(async () => {
    setNotificationsAvailable(null);
    setAvailabilityCheckFailed(false);
    setError(null);
    try {
      setNotificationsAvailable(await notificationsAvailableInRuntime());
    } catch {
      setNotificationsAvailable(false);
      setAvailabilityCheckFailed(true);
      setError(t('settings.updateFailedMessage'));
    }
  }, [t]);

  const continueOnboarding = useCallback(() => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    router.push('/(auth)/device-check');
  }, []);

  const requestPermission = useCallback(async () => {
    if (requestingRef.current || navigatingRef.current) return;
    requestingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      if (notificationsAvailable !== true) {
        continueOnboarding();
        return;
      }
      const granted = await requestNotificationPermission({ showRationale: false });
      if (granted) continueOnboarding();
      else {
        setPermissionDenied(true);
        setError(t('permissions.notificationsRationaleMessage'));
      }
    } catch {
      setPermissionDenied(true);
      setError(t('permissions.notificationsRationaleMessage'));
    } finally {
      requestingRef.current = false;
      setBusy(false);
    }
  }, [continueOnboarding, notificationsAvailable, t]);

  const openNotificationSettings = useCallback(async () => {
    if (requestingRef.current || navigatingRef.current) return;
    requestingRef.current = true;
    setBusy(true);
    try {
      await Linking.openSettings();
      continueOnboarding();
    } catch {
      setError(t('permissions.notificationsRationaleMessage'));
    } finally {
      requestingRef.current = false;
      setBusy(false);
    }
  }, [continueOnboarding, t]);

  return (
    <Screen>
      <Header title={t('permissions.notificationsTitle')} subtitle={t('permissions.notificationsSubtitle')} />
      <Card><Text style={{ fontFamily: fonts.regular }}>{t('permissions.notificationsBody')}</Text></Card>
      <FeedbackBanner
        message={error}
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
