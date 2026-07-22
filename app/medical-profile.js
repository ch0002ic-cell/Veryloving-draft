import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Button } from '../src/components/Button';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { Header } from '../src/components/Header';
import { LoadingState } from '../src/components/LoadingState';
import { Screen } from '../src/components/Screen';
import { useAuth } from '../src/context/AuthContext';
import { useI18n } from '../src/context/I18nContext';
import { colors, motion, radii, sizes, spacing, typography } from '../src/constants/theme';
import { buildEmergencyMedicalAttachment } from '../src/services/medical-emergency-profile';
import {
  clearMedicalEmergencyProfile,
  loadMedicalEmergencyProfile,
  saveMedicalEmergencyProfile
} from '../src/services/medical-profile-store';

const BLOOD_TYPES = Object.freeze(['unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']);
const EMPTY_FORM = Object.freeze({
  allergies: '',
  bloodType: 'unknown',
  conditions: '',
  emergencyNotes: '',
  medications: '',
  shareInEmergency: false
});

function listText(items) {
  return Array.isArray(items) ? items.join('\n') : '';
}

function medicationText(items) {
  return Array.isArray(items) ? items.map(({ name, dose, instructions }) => (
    [name, dose || '', instructions || ''].join(' | ').replace(/(?:\s*\|\s*)+$/, '')
  )).join('\n') : '';
}

function formFromProfile(profile) {
  if (!profile) return { ...EMPTY_FORM };
  return {
    allergies: listText(profile.allergies),
    bloodType: profile.bloodType || 'unknown',
    conditions: listText(profile.conditions),
    emergencyNotes: profile.emergencyNotes || '',
    medications: medicationText(profile.medications),
    shareInEmergency: profile.shareInEmergency === true
  };
}

function parseList(value) {
  return String(value || '').split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function parseMedications(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, dose, ...instructions] = line.split('|').map((part) => part.trim());
    return {
      name,
      dose: dose || null,
      instructions: instructions.join(' | ') || null
    };
  });
}

export default function MedicalProfile() {
  const { user } = useAuth();
  const { isRTL, locale, t } = useI18n();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const loadRequestRef = useRef(0);

  const loadProfile = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setLoadFailed(false);
    if (!user?.id) {
      if (requestId === loadRequestRef.current) {
        setLoadFailed(true);
        setLoading(false);
      }
      return;
    }
    try {
      const storedProfile = await loadMedicalEmergencyProfile(user.id);
      if (requestId !== loadRequestRef.current) return;
      setProfile(storedProfile);
      setForm(formFromProfile(storedProfile));
      setFeedback(null);
    } catch {
      if (requestId === loadRequestRef.current) setLoadFailed(true);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadProfile();
    return () => {
      loadRequestRef.current += 1;
    };
  }, [loadProfile]);

  const reviewedLabel = useMemo(() => profile?.updatedAt
    ? new Date(profile.updatedAt).toLocaleString(locale)
    : t('medicalProfile.neverReviewed'), [locale, profile?.updatedAt, t]);

  const patchForm = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setFeedback(null);
  };

  const save = async () => {
    if (!user?.id || busyAction) return;
    setBusyAction('save');
    setFeedback(null);
    const reviewedAt = Date.now();
    try {
      const candidate = {
        profileVersion: (profile?.profileVersion || 0) + 1,
        bloodType: form.bloodType,
        conditions: parseList(form.conditions),
        allergies: parseList(form.allergies),
        medications: parseMedications(form.medications),
        emergencyNotes: form.emergencyNotes,
        shareInEmergency: form.shareInEmergency,
        updatedAt: reviewedAt,
        consentRecordedAt: form.shareInEmergency
          ? reviewedAt
          : (profile?.consentRecordedAt || reviewedAt)
      };
      if (candidate.shareInEmergency) {
        buildEmergencyMedicalAttachment(candidate, { now: () => reviewedAt });
      }
      const saved = await saveMedicalEmergencyProfile(user.id, candidate);
      setProfile(saved);
      setForm(formFromProfile(saved));
      setFeedback({ message: t('medicalProfile.saved'), tone: 'success' });
    } catch {
      setFeedback({ message: t('medicalProfile.saveFailed'), tone: 'error' });
    } finally {
      setBusyAction(null);
    }
  };

  const clear = () => {
    if (busyAction) return;
    Alert.alert(
      t('medicalProfile.clearTitle'),
      t('medicalProfile.clearMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.clear'),
          style: 'destructive',
          onPress: async () => {
            setBusyAction('clear');
            setFeedback(null);
            try {
              await clearMedicalEmergencyProfile(user.id);
              setProfile(null);
              setForm({ ...EMPTY_FORM });
              setFeedback({ message: t('medicalProfile.cleared'), tone: 'success' });
            } catch {
              setFeedback({ message: t('medicalProfile.clearFailed'), tone: 'error' });
            } finally {
              setBusyAction(null);
            }
          }
        }
      ]
    );
  };

  return (
    <Screen>
      <Header
        title={t('medicalProfile.title')}
        subtitle={t('medicalProfile.subtitle')}
        showBack
        backLabel={t('common.back')}
      />
      {loading ? <LoadingState message={t('common.loading')} /> : loadFailed ? (
        <FeedbackBanner
          message={t('medicalProfile.loadFailed')}
          tone="error"
          actionLabel={t('common.retry')}
          onAction={loadProfile}
        />
      ) : (
        <>
          <Text style={[styles.description, isRTL && styles.rtlText]}>{t('medicalProfile.description')}</Text>
          <FeedbackBanner message={feedback?.message} tone={feedback?.tone} />

          <View style={styles.fieldGroup}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t('medicalProfile.bloodType')}</Text>
            <View style={[styles.bloodTypes, isRTL && styles.rtlRow]} accessibilityRole="radiogroup">
              {BLOOD_TYPES.map((bloodType) => {
                const selected = form.bloodType === bloodType;
                const label = bloodType === 'unknown' ? t('common.unknown') : bloodType;
                return (
                  <Pressable
                    key={bloodType}
                    accessibilityLabel={`${t('medicalProfile.bloodType')}: ${label}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => patchForm({ bloodType })}
                    style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}
                  >
                    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <ProfileField
            accessibilityLabel={t('medicalProfile.conditions')}
            hint={t('medicalProfile.conditionsHint')}
            isRTL={isRTL}
            label={t('medicalProfile.conditions')}
            maxLength={3200}
            onChangeText={(conditions) => patchForm({ conditions })}
            value={form.conditions}
          />
          <ProfileField
            accessibilityLabel={t('medicalProfile.allergies')}
            hint={t('medicalProfile.allergiesHint')}
            isRTL={isRTL}
            label={t('medicalProfile.allergies')}
            maxLength={3200}
            onChangeText={(allergies) => patchForm({ allergies })}
            value={form.allergies}
          />
          <ProfileField
            accessibilityLabel={t('medicalProfile.medications')}
            hint={t('medicalProfile.medicationsHint')}
            isRTL={isRTL}
            label={t('medicalProfile.medications')}
            maxLength={9600}
            onChangeText={(medications) => patchForm({ medications })}
            value={form.medications}
          />
          <ProfileField
            accessibilityLabel={t('medicalProfile.emergencyNotes')}
            hint={t('medicalProfile.emergencyNotesHint')}
            isRTL={isRTL}
            label={t('medicalProfile.emergencyNotes')}
            maxLength={500}
            onChangeText={(emergencyNotes) => patchForm({ emergencyNotes })}
            value={form.emergencyNotes}
          />

          <View style={[styles.consentRow, isRTL && styles.rtlRow]}>
            <View style={styles.consentCopy}>
              <Text style={[styles.label, isRTL && styles.rtlText]}>{t('medicalProfile.shareLabel')}</Text>
              <Text style={[styles.hint, isRTL && styles.rtlText]}>{t('medicalProfile.shareHint')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('medicalProfile.shareLabel')}
              accessibilityHint={t('medicalProfile.shareHint')}
              accessibilityState={{
                checked: form.shareInEmergency,
                disabled: Boolean(busyAction)
              }}
              disabled={Boolean(busyAction)}
              value={form.shareInEmergency}
              onValueChange={(shareInEmergency) => patchForm({ shareInEmergency })}
            />
          </View>
          <Text style={[styles.consentBody, isRTL && styles.rtlText]}>{t('medicalProfile.consentBody')}</Text>
          <Text style={[styles.reviewed, isRTL && styles.rtlText]}>
            {t('medicalProfile.lastReviewed', { date: reviewedLabel })}
          </Text>

          <Button
            title={t('medicalProfile.saveAndReview')}
            loading={busyAction === 'save'}
            disabled={Boolean(busyAction)}
            onPress={save}
          />
          <Button
            title={t('medicalProfile.clearProfile')}
            variant="danger"
            loading={busyAction === 'clear'}
            disabled={Boolean(busyAction) || !profile}
            onPress={clear}
          />
        </>
      )}
    </Screen>
  );
}

function ProfileField({ accessibilityLabel, hint, isRTL, label, maxLength, onChangeText, value }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={[styles.label, isRTL && styles.rtlText]}>{label}</Text>
      <Text style={[styles.hint, isRTL && styles.rtlText]}>{hint}</Text>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={hint}
        multiline
        maxLength={maxLength}
        onChangeText={onChangeText}
        placeholder={hint}
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, isRTL && styles.rtlInput]}
        textAlignVertical="top"
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  description: { ...typography.body, color: colors.textSecondary },
  fieldGroup: { gap: spacing.sm },
  label: { ...typography.label, color: colors.textPrimary },
  hint: { ...typography.caption, color: colors.textSecondary },
  input: {
    minHeight: 104,
    borderColor: colors.borderControl,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
    color: colors.textPrimary,
    ...typography.bodyLarge,
    padding: spacing.mdSm
  },
  rtlInput: { textAlign: 'right' },
  bloodTypes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: sizes.touchTarget,
    minWidth: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.borderControl,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.mdSm
  },
  choiceSelected: { backgroundColor: colors.actionPrimary, borderColor: colors.actionPrimary },
  choiceText: { ...typography.label, color: colors.textPrimary },
  choiceTextSelected: { color: colors.textInverse },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  consentCopy: { flex: 1, gap: spacing.xs },
  consentBody: { ...typography.caption, color: colors.textSecondary },
  reviewed: { ...typography.bodySmall, fontFamily: typography.label.fontFamily, color: colors.textPrimary },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] }
});
