import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { formatE164ForDisplay } from '../src/utils/phone';
import { colors, fonts } from '../src/constants/theme';
import { images } from '../src/constants/assets';

export default function EmergencyContacts() {
  const { addContact, contacts, removeContact } = useAppState();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const nameValid = Boolean(name.trim());

  const add = async () => {
    setSubmitted(true);
    if (!nameValid || !phone?.isValid) return;
    setSaving(true);
    setFeedback(null);
    try {
      await addContact({
        countryCode: phone.countryCode,
        name: name.trim(),
        phone: phone.e164
      });
      setName('');
      setPhone(null);
      setSubmitted(false);
    } catch {
      setFeedback({ message: t('contacts.saveFailedMessage'), retry: add });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contact) => {
    try {
      setFeedback(null);
      await removeContact(contact.id);
    } catch {
      setFeedback({ message: t('contacts.removeFailedMessage'), retry: () => remove(contact) });
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
    <Screen scroll={false}>
      <Header title={t('contacts.title')} subtitle={t('contacts.subtitle')} />
      <FeedbackBanner message={feedback?.message} actionLabel={t('common.retry')} onAction={feedback?.retry} />
      <Card style={styles.form}>
        <Text style={styles.title}>{t('contacts.addTitle')}</Text>
        <Text style={styles.label}>{t('contacts.name')}</Text>
        <TextInput
          autoCapitalize="words"
          autoCorrect={false}
          onChangeText={setName}
          placeholder={t('contacts.namePlaceholder')}
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
          title={t('contacts.add')}
          icon="person-add"
          loading={saving}
          disabled={!nameValid || !phone?.isValid}
          onPress={add}
        />
      </Card>
      <FlatList
        contentContainerStyle={styles.list}
        data={contacts}
        keyExtractor={(contact) => contact.id}
        ListEmptyComponent={(
          <EmptyState
            image={images.bestie}
            title={t('contacts.emptyTitle')}
            message={t('contacts.emptyMessage')}
          />
        )}
        renderItem={({ item }) => (
          <Card style={styles.contactCard}>
            <View style={styles.contactCopy}>
              <Text style={styles.contactName}>{item.name}</Text>
              <Text style={styles.phone}>{formatE164ForDisplay(item.phone)}</Text>
            </View>
            <View style={styles.actions}>
              <Button title={t('common.call')} icon="call" variant="ghost" onPress={() => callNumber(item.phone)} />
              <Button title={t('common.remove')} icon="trash-outline" variant="ghost" onPress={() => confirmRemove(item)} />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: 10 },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  nameInput: { minHeight: 50, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 8, backgroundColor: '#fff', fontFamily: fonts.regular, color: colors.ink },
  invalidInput: { borderColor: colors.red },
  error: { fontFamily: fonts.regular, color: colors.red, fontSize: 12 },
  list: { paddingVertical: 4, paddingBottom: 20, gap: 10 },
  contactCard: { gap: 12 },
  contactCopy: { gap: 4 },
  contactName: { fontFamily: fonts.bold, color: colors.ink, fontSize: 17 },
  phone: { fontFamily: fonts.regular, color: colors.inkSoft },
  actions: { gap: 8 }
});
