import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../context/I18nContext';
import { filterCountryOptions, getCountryOptions } from '../utils/phone';
import { colors, fonts } from '../constants/theme';

export function CountryPicker({ selectedCountry, visible, onClose, onSelect }) {
  const { isRTL, locale, t } = useI18n();
  const [query, setQuery] = useState('');
  const countries = useMemo(() => getCountryOptions(locale), [locale]);
  const filteredCountries = useMemo(
    () => filterCountryOptions(countries, query),
    [countries, query]
  );

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe}>
          <View style={[styles.header, isRTL && styles.rtlRow]}>
            <Text style={[styles.title, isRTL && styles.rtlText]}>{t('phone.selectCountry')}</Text>
            <Pressable
              accessibilityLabel={t('common.close')}
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={26} color={colors.ink} />
            </Pressable>
          </View>
          <View style={[styles.searchRow, isRTL && styles.rtlRow]}>
            <Ionicons name="search" size={20} color={colors.inkSoft} />
            <TextInput
              accessibilityLabel={t('phone.searchCountry')}
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder={t('phone.searchCountry')}
              placeholderTextColor={colors.inkSoft}
              returnKeyType="search"
              style={[styles.searchInput, isRTL && styles.rtlText]}
              value={query}
            />
          </View>
          <FlatList
            data={filteredCountries}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(country) => country.code}
            ListEmptyComponent={<Text style={styles.empty}>{t('phone.noCountries')}</Text>}
            renderItem={({ item }) => {
              const selected = item.code === selectedCountry;
              return (
                <Pressable
                  accessibilityLabel={`${item.name}, +${item.callingCode}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
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
                  {selected ? <Ionicons name="checkmark" size={20} color={colors.greenAccessible} /> : null}
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
  safe: { flex: 1, backgroundColor: colors.cream },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  header: { minHeight: 60, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontFamily: fonts.bold, color: colors.ink, fontSize: 22 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchRow: { minHeight: 50, marginHorizontal: 20, marginBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, backgroundColor: '#fff' },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.regular, color: colors.ink, fontSize: 16 },
  countryRow: { minHeight: 58, paddingHorizontal: 20, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  selectedRow: { backgroundColor: '#FFF4EC' },
  pressed: { opacity: 0.62 },
  flag: { width: 34, fontSize: 25 },
  countryName: { flex: 1, fontFamily: fonts.regular, color: colors.ink, fontSize: 16 },
  callingCode: { fontFamily: fonts.semibold, color: colors.inkSoft, fontSize: 15, writingDirection: 'ltr', textAlign: 'left' },
  empty: { padding: 32, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'center' }
});
