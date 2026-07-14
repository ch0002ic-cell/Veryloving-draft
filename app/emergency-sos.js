import { useEffect, useMemo, useState } from 'react';
import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { images } from '../src/constants/assets';
import { triggerSOS } from '../src/services/emergency';
import {
  LAST_SOS_ATTEMPT_TITLE,
  loadSOSStatus,
  sosStatusMessage
} from '../src/services/sos-state';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { useAuth } from '../src/context/AuthContext';
import { loadLastKnownLocation } from '../src/services/location-cache';

export default function EmergencySOS() {
  const { contacts } = useAppState();
  const { accessToken, user } = useAuth();
  const { locale, t } = useI18n();
  const [activating, setActivating] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [lastSOSStatus, setLastSOSStatus] = useState(null);
  const callableContact = useMemo(() => contacts.find((contact) => contact?.phone), [contacts]);

  useEffect(() => {
    let active = true;
    loadSOSStatus().then((status) => {
      if (active) setLastSOSStatus(status);
    }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const refreshLastStatus = async () => {
    const status = await loadSOSStatus().catch(() => null);
    setLastSOSStatus(status);
  };

  const activate = async () => {
    if (activating) return;
    setActivating(true);
    setFeedback(null);
    try {
      const location = await loadLastKnownLocation().catch(() => null);
      const result = await triggerSOS(contacts, { accessToken, accountId: user?.id, location });
      await refreshLastStatus();
      if (result.status === 'contact_required') {
        setFeedback(t('emergency.addContact'));
      } else if (result.backendStatus === 'failed') {
        setFeedback(t('settings.updateFailedMessage'));
      }
    } catch {
      await refreshLastStatus();
      setFeedback(t('settings.linkFailed'));
    } finally {
      setActivating(false);
    }
  };

  return (
    <Screen>
      <Header title={t('emergency.title')} subtitle={t('emergency.subtitle')} />
      <FeedbackBanner message={feedback} />
      <Image source={images.star} style={{ width: '100%', height: 160 }} resizeMode="contain" />
      <Card>
        <Text style={{ fontFamily: fonts.regular }}>
          {callableContact
            ? t('emergency.callContact', { name: callableContact.name })
            : t('emergency.addContact')}
        </Text>
      </Card>
      {lastSOSStatus ? (
        <Card>
          <Text style={{ fontFamily: fonts.bold }}>{LAST_SOS_ATTEMPT_TITLE}</Text>
          <Text style={{ fontFamily: fonts.regular }}>{sosStatusMessage(lastSOSStatus.status)}</Text>
          <Text style={{ fontFamily: fonts.regular }}>
            {new Date(lastSOSStatus.recordedAt).toLocaleString(locale)}
          </Text>
        </Card>
      ) : null}
      <Button
        title={t('emergency.activate')}
        variant="danger"
        loading={activating}
        disabled={activating}
        onPress={activate}
      />
      <Button title={t('emergency.callCompanion')} disabled={activating} onPress={() => router.push('/safety-call')} />
      <Button title={t('common.cancel')} variant="ghost" disabled={activating} onPress={() => router.back()} />
    </Screen>
  );
}
