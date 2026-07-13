import { useState } from 'react';
import { Image, Text } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { images } from '../src/constants/assets';
import { triggerSOS } from '../src/services/emergency';
import { useAppState } from '../src/context/AppContext';
import { fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

export default function EmergencySOS() {
  const { contacts } = useAppState();
  const { t } = useI18n();
  const [activating, setActivating] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const activate = async () => {
    if (activating) return;
    setActivating(true);
    setFeedback(null);
    try {
      const result = await triggerSOS(contacts);
      if (result.status === 'contact_required') {
        setFeedback(t('emergency.addContact'));
      }
    } catch {
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
          {contacts.find((contact) => contact?.phone)
            ? t('emergency.callContact', { name: contacts.find((contact) => contact?.phone).name })
            : t('emergency.addContact')}
        </Text>
      </Card>
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
