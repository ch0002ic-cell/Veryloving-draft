import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../context/I18nContext';
import { colors, fonts, spacing } from '../constants/theme';
import { filterLanguageOptions } from '../i18n/core';

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
  const languageCodeLabel = (language) => [
    language.code.toUpperCase(),
    language.usesEnglishReleaseCriticalFallback ? 'QA' : null
  ].filter(Boolean).join(' · ');
  const filteredLanguages = useMemo(
    () => filterLanguageOptions(languageOptions, query, t('languages.system')),
    [languageOptions, query, t]
  );

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
        style={({ pressed }) => [styles.trigger, isRTL && styles.rtlRow, pressed && styles.pressed]}
      >
        <View style={styles.triggerCopy}>
          <Text style={[styles.selectedLabel, isRTL && styles.rtlText]}>{languageLabel(selectedLanguage)}</Text>
          {selectedLanguage.code !== 'system' ? <Text style={[styles.code, isRTL && styles.rtlText]}>{languageCodeLabel(selectedLanguage)}</Text> : null}
        </View>
        {savingLanguage
          ? <ActivityIndicator size="small" color={colors.orangeAccessible} />
          : <Ionicons name={isRTL ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.inkSoft} />}
      </Pressable>
      <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={() => setVisible(false)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.safe}>
            <View style={[styles.header, isRTL && styles.rtlRow]}>
              <Text style={[styles.title, isRTL && styles.rtlText]}>{t('languages.title')}</Text>
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
            <View style={[styles.searchRow, isRTL && styles.rtlRow]}>
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
                style={[styles.searchInput, isRTL && styles.rtlText]}
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
                    style={({ pressed }) => [styles.row, isRTL && styles.rtlRow, selected && styles.selected, pressed && styles.pressed]}
                  >
                    <View style={styles.languageCopy}>
                      <Text style={[styles.label, selected && styles.selectedLabel, isRTL && styles.rtlText]}>{languageLabel(item)}</Text>
                      {(item.englishName && item.englishName !== item.nativeName) || item.usesEnglishReleaseCriticalFallback ? (
                        <View style={[styles.metadataRow, isRTL && styles.rtlRow]}>
                          {item.englishName && item.englishName !== item.nativeName ? <Text style={[styles.englishName, isRTL && styles.rtlText]}>{item.englishName}</Text> : null}
                          {item.usesEnglishReleaseCriticalFallback ? <Text style={styles.qaBadge}>QA</Text> : null}
                        </View>
                      ) : null}
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
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
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
  metadataRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  selected: { backgroundColor: '#F2F8F5' },
  label: { flex: 1, fontFamily: fonts.regular, color: colors.ink, fontSize: 16 },
  selectedLabel: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 16 },
  englishName: { flexShrink: 1, fontFamily: fonts.regular, color: colors.inkSoft, fontSize: 12 },
  qaBadge: { overflow: 'hidden', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: '#FFF1D6', fontFamily: fonts.semibold, color: colors.orangeAccessible, fontSize: 10 },
  empty: { padding: 32, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' },
  pressed: { opacity: 0.65 }
});
