import { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { StatusPill } from '../src/components/StatusPill';
import { images } from '../src/constants/assets';
import { triggerSOS } from '../src/services/emergency';
import {
  loadSOSStatus,
  sosStatusTranslationKey
} from '../src/services/sos-state';
import { useAppState } from '../src/context/AppContext';
import { colors, radii, spacing, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { useAuth } from '../src/context/AuthContext';
import { loadLastKnownLocation } from '../src/services/location-cache';
import { loadEmergencyMedicalAttachment } from '../src/services/medical-profile-store';

function closeScreen() {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)');
}

export default function EmergencySOS() {
  const { contacts } = useAppState();
  const { accessToken, user } = useAuth();
  const { isRTL, locale, t } = useI18n();
  const [activating, setActivating] = useState(false);
  const [feedbackKey, setFeedbackKey] = useState(null);
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
    setFeedbackKey(null);
    try {
      const location = await loadLastKnownLocation().catch(() => null);
      const medicalAttachment = await loadEmergencyMedicalAttachment(user?.id).catch(() => null);
      const result = await triggerSOS(contacts, {
        accessToken,
        accountId: user?.id,
        location,
        medicalAttachment
      });
      await refreshLastStatus();
      if (result.status === 'contact_required') {
        setFeedbackKey('emergency.addContact');
      } else if (result.backendStatus === 'failed') {
        setFeedbackKey('settings.updateFailedMessage');
      }
    } catch {
      await refreshLastStatus();
      setFeedbackKey('settings.linkFailed');
    } finally {
      setActivating(false);
    }
  };

  return (
    <Screen>
      <Header title={t('emergency.title')} subtitle={t('emergency.subtitle')} />
      <FeedbackBanner message={feedbackKey ? t(feedbackKey) : null} />
      <Card variant="critical" style={styles.emergencyCard}>
        <View style={[styles.emergencyHero, isRTL && styles.rtlRow]}>
          <View style={styles.starHalo}>
            <Image accessible={false} source={images.star} style={styles.star} resizeMode="contain" />
          </View>
          <View style={[styles.heroCopy, isRTL && styles.rtlCopy]}>
            <StatusPill
              label={callableContact ? t('safetyCall.ready') : t('emergency.addContact')}
              tone={callableContact ? 'ok' : 'warn'}
            />
            <Text style={[styles.heroTitle, isRTL && styles.rtlText]}>{t('emergency.title')}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t('emergency.body')}</Text>
          </View>
        </View>
        <View style={[styles.readinessRow, isRTL && styles.rtlRow]}>
          <Ionicons
            name={callableContact ? 'checkmark-circle' : 'alert-circle'}
            size={22}
            color={callableContact ? colors.greenAccessible : colors.goldAccessible}
          />
          <Text style={[styles.readinessCopy, isRTL && styles.rtlText]}>
            {callableContact
              ? t('emergency.callContact', { name: callableContact.name })
              : t('emergency.addContact')}
          </Text>
        </View>
      </Card>
      {!callableContact ? (
        <Button
          title={t('contacts.addTitle')}
          icon="person-add-outline"
          disabled={activating}
          onPress={() => router.push('/emergency-contacts')}
        />
      ) : null}
      {lastSOSStatus ? (
        <Card style={styles.statusCard}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t('releaseCritical.lastSOSAttempt')}</Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t(sosStatusTranslationKey(lastSOSStatus.status))}</Text>
          <Text style={[styles.timestamp, isRTL && styles.rtlText]}>
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
      <Button title={t('common.cancel')} variant="ghost" disabled={activating} onPress={closeScreen} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  emergencyCard: { gap: spacing.md, borderRadius: radii.xl },
  emergencyHero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  starHalo: {
    width: 84,
    height: 84,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 42,
    backgroundColor: colors.paper
  },
  star: { width: 56, height: 56 },
  heroCopy: { flex: 1, alignItems: 'flex-start', gap: spacing.xs },
  heroTitle: { ...typography.title, color: colors.textPrimary },
  body: { ...typography.body, color: colors.textSecondary },
  readinessRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.mdSm,
    borderRadius: radii.lg,
    backgroundColor: colors.paper
  },
  readinessCopy: { flex: 1, ...typography.label, color: colors.textPrimary },
  statusCard: { gap: spacing.xs },
  sectionTitle: { ...typography.heading, color: colors.textPrimary },
  timestamp: { ...typography.caption, color: colors.textSecondary },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlCopy: { alignItems: 'flex-end' },
  rtlText: { textAlign: 'right' }
});
