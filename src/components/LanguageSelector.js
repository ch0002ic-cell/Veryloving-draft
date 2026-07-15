import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../context/I18nContext';
import { colors, fonts, spacing } from '../constants/theme';

export function LanguageSelector({ onError }) {
  const { isRTL, languageOptions, languagePreference, setLanguage, t } = useI18n();
  const [savingLanguage, setSavingLanguage] = useState(null);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const selectedLanguage = languageOptions.find((language) => language.code === languagePreference)
    || languageOptions[0];
  const languageLabel = (language) => language.code === 'system'
    ? t(language.translationKey)
    : language.nativeName;
  const filteredLanguages = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return languageOptions;
    return languageOptions.filter((language) => [
      language.code,
      language.nativeName,
      language.englishName,
      language.code === 'system' ? t(language.translationKey) : ''
    ].filter(Boolean).some((value) => String(value).toLocaleLowerCase().includes(normalized)));
  }, [languageOptions, query, t]);

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  const chooseLanguage = async (languageCode) => {
    if (savingLanguage) return;
    if (languageCode === languagePreference) {
      setVisible(false);
      return;
    }
    setSavingLanguage(languageCode);
    setVisible(false);
    try {
      await setLanguage(languageCode);
    } catch (error) {
      onError?.(error);
    } finally {
      setSavingLanguage(null);
    }
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={Boolean(savingLanguage)}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      >
        <View style={styles.triggerCopy}>
          <Text style={styles.selectedLabel}>{languageLabel(selectedLanguage)}</Text>
          {selectedLanguage.code !== 'system' ? <Text style={styles.code}>{selectedLanguage.code.toUpperCase()}</Text> : null}
        </View>
        {savingLanguage
          ? <ActivityIndicator size="small" color={colors.orangeAccessible} />
          : <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.inkSoft} />}
      </Pressable>
      <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={() => setVisible(false)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.safe}>
            <View style={styles.header}>
              <Text style={styles.title}>{t('languages.title')}</Text>
              <Pressable
                accessibilityLabel={t('common.close')}
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Ionicons name="close" size={26} color={colors.ink} />
              </Pressable>
            </View>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={20} color={colors.inkSoft} />
              <TextInput
                accessibilityLabel={t('languages.search')}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder={t('languages.search')}
                placeholderTextColor={colors.inkSoft}
                returnKeyType="search"
                style={styles.searchInput}
                value={query}
              />
            </View>
            <FlatList
              data={filteredLanguages}
              initialNumToRender={24}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(language) => language.code}
              ListEmptyComponent={<Text style={styles.empty}>{t('languages.noResults')}</Text>}
              renderItem={({ item }) => {
                const selected = item.code === languagePreference;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: Boolean(savingLanguage) }}
                    disabled={Boolean(savingLanguage)}
                    onPress={() => chooseLanguage(item.code)}
                    style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
                  >
                    <View style={styles.languageCopy}>
                      <Text style={[styles.label, selected && styles.selectedLabel]}>{languageLabel(item)}</Text>
                      {item.englishName && item.englishName !== item.nativeName ? <Text style={styles.englishName}>{item.englishName}</Text> : null}
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={21} color={colors.greenAccessible} /> : null}
                  </Pressable>
                );
              }}
            />
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { minHeight: 52, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, backgroundColor: '#fff' },
  triggerCopy: { flex: 1, gap: 2 },
  code: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 12 },
  safe: { flex: 1, backgroundColor: colors.cream },
  header: { minHeight: 60, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.bold, color: colors.ink, fontSize: 22 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchRow: { minHeight: 50, marginHorizontal: 20, marginBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, backgroundColor: '#fff' },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.regular, color: colors.ink, fontSize: 16 },
  row: { minHeight: 56, paddingHorizontal: 20, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  languageCopy: { flex: 1, minWidth: 0 },
  selected: { backgroundColor: '#F2F8F5' },
  label: { flex: 1, fontFamily: fonts.regular, color: colors.ink, fontSize: 16 },
  selectedLabel: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 16 },
  englishName: { fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 12, marginTop: 2 },
  empty: { padding: 32, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' },
  pressed: { opacity: 0.65 }
});
