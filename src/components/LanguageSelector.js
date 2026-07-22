import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  findNodeHandle,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../context/I18nContext';
import { colors, layout, motion, radii, sizes, spacing, tones, typography } from '../constants/theme';
import { filterLanguageOptions } from '../i18n/core';

export function LanguageSelector({ onError }) {
  const { isRTL, languageOptions, languagePreference, setLanguage, t } = useI18n();
  const [savingLanguage, setSavingLanguage] = useState(null);
  const [visible, setVisible] = useState(false);
  const [query, setQuery] = useState('');
  const titleRef = useRef(null);
  const triggerRef = useRef(null);
  const wasVisibleRef = useRef(false);
  const selectedLanguage = languageOptions.find((language) => language.code === languagePreference)
    || languageOptions[0];
  const languageLabel = (language) => language.code === 'system'
    ? t(language.translationKey)
    : language.nativeName;
  const languageCodeLabel = (language) => [
    language.code.toUpperCase(),
    language.reviewRequired ? 'QA' : null
  ].filter(Boolean).join(' · ');
  const filteredLanguages = useMemo(
    () => filterLanguageOptions(languageOptions, query, t('languages.system')),
    [languageOptions, query, t]
  );

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  useEffect(() => {
    const shouldRestore = !visible && wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!visible && !shouldRestore) return undefined;
    const timer = setTimeout(() => {
      const target = visible ? titleRef.current : triggerRef.current;
      const node = findNodeHandle(target);
      if (node) AccessibilityInfo.setAccessibilityFocus?.(node);
    }, visible ? 120 : 180);
    return () => clearTimeout(timer);
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
        ref={triggerRef}
        accessibilityLabel={`${t('languages.title')}: ${languageLabel(selectedLanguage)}`}
        accessibilityRole="button"
        accessibilityState={{ busy: Boolean(savingLanguage), disabled: Boolean(savingLanguage), expanded: visible }}
        android_ripple={{ color: colors.borderSubtle }}
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
          : <Ionicons accessible={false} name={isRTL ? 'chevron-back' : 'chevron-forward'} size={sizes.icon} color={colors.textSecondary} />}
      </Pressable>
      <Modal animationType="slide" presentationStyle="pageSheet" visible={visible} onRequestClose={() => setVisible(false)}>
        <SafeAreaProvider>
          <SafeAreaView accessibilityViewIsModal style={styles.safe}>
            <View style={[styles.header, isRTL && styles.rtlRow]}>
              <Text
                accessibilityRole="header"
                ref={titleRef}
                style={[styles.title, isRTL && styles.rtlText]}
              >
                {t('languages.title')}
              </Text>
              <Pressable
                accessibilityLabel={t('common.close')}
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => setVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <Ionicons accessible={false} name="close" size={sizes.iconLarge} color={colors.textPrimary} />
              </Pressable>
            </View>
            <View style={[styles.searchRow, isRTL && styles.rtlRow]}>
              <Ionicons accessible={false} name="search" size={sizes.icon} color={colors.textSecondary} />
              <TextInput
                accessibilityLabel={t('languages.search')}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder={t('languages.search')}
                placeholderTextColor={colors.textSecondary}
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
              ListEmptyComponent={<Text accessibilityRole="summary" style={styles.empty}>{t('languages.noResults')}</Text>}
              renderItem={({ item }) => {
                const selected = item.code === languagePreference;
                return (
                  <Pressable
                    accessibilityLabel={languageLabel(item)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected, disabled: Boolean(savingLanguage) }}
                    android_ripple={{ color: colors.borderSubtle }}
                    disabled={Boolean(savingLanguage)}
                    onPress={() => chooseLanguage(item.code)}
                    style={({ pressed }) => [styles.row, isRTL && styles.rtlRow, selected && styles.selected, pressed && styles.pressed]}
                  >
                    <View style={styles.languageCopy}>
                      <Text style={[styles.label, selected && styles.selectedLabel, isRTL && styles.rtlText]}>{languageLabel(item)}</Text>
                      {(item.englishName && item.englishName !== item.nativeName) || item.reviewRequired ? (
                        <View style={[styles.metadataRow, isRTL && styles.rtlRow]}>
                          {item.englishName && item.englishName !== item.nativeName ? <Text style={[styles.englishName, isRTL && styles.rtlText]}>{item.englishName}</Text> : null}
                          {item.reviewRequired ? <Text style={styles.qaBadge}>QA</Text> : null}
                        </View>
                      ) : null}
                    </View>
                    {selected ? <Ionicons accessible={false} name="checkmark-circle" size={sizes.icon} color={colors.greenAccessible} /> : null}
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
  trigger: { minHeight: sizes.control, paddingHorizontal: spacing.mdSm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: colors.borderControl, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  triggerCopy: { flex: 1, gap: spacing.xs },
  code: { ...typography.caption, color: colors.textSecondary },
  safe: { flex: 1, backgroundColor: colors.surfaceCanvas },
  header: { minHeight: sizes.controlLarge + spacing.xs, paddingHorizontal: layout.screenPadding, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, ...typography.titleLarge, color: colors.textPrimary },
  closeButton: { width: sizes.touchTarget, height: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
  searchRow: { minHeight: sizes.control, marginHorizontal: layout.screenPadding, marginBottom: spacing.sm, paddingHorizontal: spacing.mdSm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.borderControl, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  searchInput: { flex: 1, minWidth: 0, ...typography.bodyLarge, color: colors.textPrimary },
  row: { minHeight: sizes.controlLarge, paddingHorizontal: layout.screenPadding, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  languageCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  metadataRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  selected: { backgroundColor: tones.success.background },
  label: { flex: 1, ...typography.bodyLarge, color: colors.textPrimary },
  selectedLabel: { ...typography.label, color: colors.textPrimary },
  englishName: { flexShrink: 1, ...typography.caption, color: colors.textSecondary },
  qaBadge: { overflow: 'hidden', paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, borderRadius: radii.sm, backgroundColor: tones.warning.background, ...typography.caption, fontFamily: typography.label.fontFamily, color: tones.warning.foreground },
  empty: { padding: spacing.xl, ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] }
});
