import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/Button';
import { GlobalPhoneInput } from '../src/components/GlobalPhoneInput';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { useAppState } from '../src/context/AppContext';
import { useI18n } from '../src/context/I18nContext';
import { callNumber } from '../src/services/emergency';
import { formatE164ForDisplay, phoneValueFromE164 } from '../src/utils/phone';
import { colors, fonts } from '../src/constants/theme';
import { images } from '../src/constants/assets';

export default function EmergencyContacts() {
  const { addContact, contacts, removeContact, updateContact } = useAppState();
  const { t } = useI18n();
  const nameInputRef = useRef(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [callingId, setCallingId] = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const nameValid = Boolean(name.trim());

  useEffect(() => {
    if (!editingId) return undefined;
    const timer = setTimeout(() => {
      nameInputRef.current?.focus();
      AccessibilityInfo.announceForAccessibility?.(t('releaseCritical.editContactTitle'));
    }, 0);
    return () => clearTimeout(timer);
  }, [editingId, t]);

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setPhone(null);
    setSubmitted(false);
  };

  const save = async () => {
    setSubmitted(true);
    if (!nameValid || !phone?.isValid) return;
    setSaving(true);
    setFeedback(null);
    const editId = editingId;
    try {
      const nextContact = {
        countryCode: phone.countryCode,
        name: name.trim(),
        phone: phone.e164
      };
      if (editId) await updateContact(editId, nextContact);
      else await addContact(nextContact);
      resetForm();
      if (editId) {
        setFeedback({ message: t('releaseCritical.contactUpdated'), tone: 'success' });
      }
    } catch {
      setFeedback({ message: t('contacts.saveFailedMessage'), retry: 'save', tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (contact) => {
    if (saving || callingId || removingId) return;
    setFeedback(null);
    setSubmitted(false);
    setEditingId(contact.id);
    setName(contact.name);
    setPhone(phoneValueFromE164(contact.phone, contact.countryCode));
  };

  const cancelEdit = () => {
    resetForm();
    setFeedback(null);
  };

  const remove = async (contact) => {
    if (removingId) return;
    try {
      setRemovingId(contact.id);
      setFeedback(null);
      await removeContact(contact.id);
      if (editingId === contact.id) resetForm();
    } catch {
      setFeedback({ message: t('contacts.removeFailedMessage'), retry: () => remove(contact) });
    } finally {
      setRemovingId(null);
    }
  };

  const call = async (contact) => {
    if (callingId) return;
    setCallingId(contact.id);
    setFeedback(null);
    try {
      await callNumber(contact.phone);
    } catch {
      setFeedback({ message: t('settings.linkFailed'), retry: () => call(contact) });
    } finally {
      setCallingId(null);
    }
  };

  const confirmRemove = (contact) => {
    Alert.alert(
      t('contacts.removeTitle', { name: contact.name }),
      t('contacts.removeMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: () => remove(contact)
        }
      ]
    );
  };

  return (
    <Screen>
      <Header title={t('contacts.title')} subtitle={t('contacts.subtitle')} showBack backLabel={t('common.back')} />
      <FeedbackBanner
        message={feedback?.message}
        tone={feedback?.tone}
        actionLabel={t('common.retry')}
        onAction={feedback?.retry === 'save' ? save : feedback?.retry}
      />
      <Card style={styles.form}>
        <Text accessibilityRole="header" style={styles.title}>
          {editingId ? t('releaseCritical.editContactTitle') : t('contacts.addTitle')}
        </Text>
        <Text style={styles.label}>{t('contacts.name')}</Text>
        <TextInput
          ref={nameInputRef}
          accessibilityLabel={t('contacts.name')}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={100}
          onChangeText={setName}
          placeholder={t('contacts.namePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          style={[styles.nameInput, submitted && !nameValid && styles.invalidInput]}
          value={name}
        />
        {submitted && !nameValid ? <Text accessibilityRole="alert" style={styles.error}>{t('contacts.nameRequired')}</Text> : null}
        <GlobalPhoneInput
          forceError={submitted}
          label={t('contacts.phone')}
          onChange={setPhone}
          value={phone}
        />
        <Button
          title={editingId ? t('common.save') : t('contacts.add')}
          icon={editingId ? 'checkmark' : 'person-add'}
          loading={saving}
          disabled={!nameValid || !phone?.isValid}
          onPress={save}
        />
        {editingId ? (
          <Button
            title={t('common.cancel')}
            icon="close"
            variant="ghost"
            disabled={saving}
            onPress={cancelEdit}
          />
        ) : null}
      </Card>
      <View style={styles.list}>
        {!contacts.length ? (
          <EmptyState
            image={images.bestie}
            title={t('contacts.emptyTitle')}
            message={t('contacts.emptyMessage')}
          />
        ) : contacts.map((contact) => (
          <Card key={contact.id} style={styles.contactCard}>
            <View style={styles.contactCopy}>
              <Text style={styles.contactName}>{contact.name}</Text>
              <Text style={styles.phone}>{formatE164ForDisplay(contact.phone)}</Text>
            </View>
            <View style={styles.actions}>
              <Button
                title={t('releaseCritical.editContact')}
                accessibilityLabel={t('releaseCritical.editContactAccessibility', { name: contact.name })}
                icon="create-outline"
                variant="ghost"
                disabled={Boolean(saving || callingId || removingId)}
                onPress={() => startEdit(contact)}
              />
              <Button
                title={t('common.call')}
                accessibilityLabel={t('contacts.callAccessibility', { name: contact.name })}
                icon="call"
                variant="ghost"
                loading={callingId === contact.id}
                disabled={Boolean(saving || (callingId && callingId !== contact.id) || removingId)}
                onPress={() => call(contact)}
              />
              <Button
                title={t('common.remove')}
                accessibilityLabel={t('contacts.removeAccessibility', { name: contact.name })}
                icon="trash-outline"
                variant="ghost"
                loading={removingId === contact.id}
                disabled={Boolean(saving || (removingId && removingId !== contact.id) || callingId)}
                onPress={() => confirmRemove(contact)}
              />
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10 },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  nameInput: { minHeight: 50, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, backgroundColor: '#fff', fontFamily: fonts.regular, color: colors.ink },
  invalidInput: { borderColor: colors.redAccessible },
  error: { fontFamily: fonts.regular, color: colors.redAccessible, fontSize: 12 },
  list: { paddingVertical: 4, paddingBottom: 20, gap: 10 },
  contactCard: { gap: 12 },
  contactCopy: { gap: 4 },
  contactName: { fontFamily: fonts.bold, color: colors.ink, fontSize: 17 },
  phone: { fontFamily: fonts.regular, color: colors.inkSoft },
  actions: { gap: 8 }
});
