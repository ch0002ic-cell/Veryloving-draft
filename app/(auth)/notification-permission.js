import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native';
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
        setError(t('settings.updateFailedMessage'));
      });
    return () => {
      active = false;
    };
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
      else setError(t('settings.updateFailedMessage'));
    } catch (permissionError) {
      setError(permissionError?.message || t('settings.updateFailedMessage'));
    } finally {
      requestingRef.current = false;
      setBusy(false);
    }
  }, [continueOnboarding, notificationsAvailable, t]);

  return (
    <Screen>
      <Header title={t('permissions.notificationsTitle')} subtitle={t('permissions.notificationsSubtitle')} />
      <Card><Text style={{ fontFamily: fonts.regular }}>{t('permissions.notificationsBody')}</Text></Card>
      <FeedbackBanner message={error} />
      <Button
        title={notificationsAvailable ? t('permissions.enableNotifications') : t('common.continue')}
        loading={busy || notificationsAvailable === null}
        disabled={busy || notificationsAvailable === null}
        onPress={requestPermission}
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
