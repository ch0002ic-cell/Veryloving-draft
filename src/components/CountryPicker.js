import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
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
import { filterCountryOptions, getCountryOptions } from '../utils/phone';
import { colors, layout, motion, radii, sizes, spacing, tones, typography } from '../constants/theme';

export function CountryPicker({ selectedCountry, visible, onClose, onSelect, returnFocusRef }) {
  const { isRTL, locale, t } = useI18n();
  const [query, setQuery] = useState('');
  const titleRef = useRef(null);
  const wasVisibleRef = useRef(false);
  const countries = useMemo(() => getCountryOptions(locale), [locale]);
  const filteredCountries = useMemo(
    () => filterCountryOptions(countries, query),
    [countries, query]
  );

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  useEffect(() => {
    const shouldRestore = !visible && wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!visible && !shouldRestore) return undefined;
    const timer = setTimeout(() => {
      const target = visible ? titleRef.current : returnFocusRef?.current;
      const node = findNodeHandle(target);
      if (node) AccessibilityInfo.setAccessibilityFocus?.(node);
    }, visible ? 120 : 180);
    return () => clearTimeout(timer);
  }, [returnFocusRef, visible]);

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView accessibilityViewIsModal style={styles.safe}>
          <View style={[styles.header, isRTL && styles.rtlRow]}>
            <Text
              accessibilityRole="header"
              ref={titleRef}
              style={[styles.title, isRTL && styles.rtlText]}
            >
              {t('phone.selectCountry')}
            </Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Ionicons accessible={false} name="close" size={sizes.iconLarge} color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={[styles.searchRow, isRTL && styles.rtlRow]}>
            <Ionicons accessible={false} name="search" size={sizes.icon} color={colors.textSecondary} />
            <TextInput
              accessibilityLabel={t('phone.searchCountry')}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder={t('phone.searchCountry')}
              placeholderTextColor={colors.textSecondary}
              returnKeyType="search"
              style={[styles.searchInput, isRTL && styles.rtlText]}
              value={query}
            />
          </View>
          <FlatList
            data={filteredCountries}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(country) => country.code}
            ListEmptyComponent={<Text accessibilityRole="summary" style={styles.empty}>{t('phone.noCountries')}</Text>}
            renderItem={({ item }) => {
              const selected = item.code === selectedCountry;
              return (
                <Pressable
                  accessibilityLabel={`${item.name}, +${item.callingCode}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  android_ripple={{ color: colors.borderSubtle }}
                  onPress={() => onSelect(item.code)}
                  style={({ pressed }) => [
                    styles.countryRow,
                    isRTL && styles.rtlRow,
                    selected && styles.selectedRow,
                    pressed && styles.pressed
                  ]}
                >
                  <Text style={styles.flag}>{item.flag}</Text>
                  <Text style={[styles.countryName, isRTL && styles.rtlText]}>{item.name}</Text>
                  <Text style={styles.callingCode}>+{item.callingCode}</Text>
                  {selected ? <Ionicons accessible={false} name="checkmark" size={sizes.icon} color={colors.greenAccessible} /> : null}
                </Pressable>
              );
            }}
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surfaceCanvas },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  header: { minHeight: sizes.controlLarge + spacing.xs, paddingHorizontal: layout.screenPadding, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, ...typography.titleLarge, color: colors.textPrimary },
  closeButton: { width: sizes.touchTarget, height: sizes.touchTarget, alignItems: 'center', justifyContent: 'center' },
  searchRow: { minHeight: sizes.control, marginHorizontal: layout.screenPadding, marginBottom: spacing.sm, paddingHorizontal: spacing.mdSm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.borderControl, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  searchInput: { flex: 1, minWidth: 0, ...typography.bodyLarge, color: colors.textPrimary },
  countryRow: { minHeight: sizes.controlLarge, paddingHorizontal: layout.screenPadding, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.mdSm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  selectedRow: { backgroundColor: tones.accent.background },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] },
  flag: { width: sizes.iconLarge + spacing.sm, fontSize: sizes.iconLarge },
  countryName: { flex: 1, ...typography.bodyLarge, color: colors.textPrimary },
  callingCode: { ...typography.label, color: colors.textSecondary, writingDirection: 'ltr', textAlign: 'left' },
  empty: { padding: spacing.xl, ...typography.body, color: colors.textSecondary, textAlign: 'center' }
});
