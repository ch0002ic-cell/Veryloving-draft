import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocales } from 'expo-localization';
import { CountryPicker } from './CountryPicker';
import { useI18n } from '../context/I18nContext';
import {
  changePhoneCountry,
  createPhoneValue,
  getCountryOptions,
  getDefaultCountry
} from '../utils/phone';
import { colors, fonts } from '../constants/theme';

export function GlobalPhoneInput({ value, onChange, label, forceError = false }) {
  const locales = useLocales();
  const { isRTL, locale, t } = useI18n();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const fallbackValue = useMemo(
    () => createPhoneValue('', getDefaultCountry(locales)),
    [locales]
  );
  const phone = value || fallbackValue;
  const country = useMemo(
    () => getCountryOptions(locale).find((option) => option.code === phone.countryCode),
    [locale, phone.countryCode]
  );

  useEffect(() => {
    if (!value) onChange(fallbackValue);
  }, [fallbackValue, onChange, value]);

  const validationMessage = phone.validationError
    ? t(`phone.${phone.validationError}`)
    : t('phone.valid');
  const showValidation = forceError || touched || Boolean(phone.formatted);

  const updateText = (nextInput) => {
    onChange(createPhoneValue(nextInput, phone.countryCode));
  };

  const selectCountry = (countryCode) => {
    onChange(changePhoneCountry(phone, countryCode));
    setPickerVisible(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, isRTL && styles.rtlText]}>{label || t('phone.label')}</Text>
      <View style={[styles.inputRow, isRTL && styles.rtlInputRow, showValidation && !phone.isValid && styles.invalidInput]}>
        <Pressable
          accessibilityLabel={t('phone.countryButton', {
            callingCode: phone.callingCode,
            country: country?.name || phone.countryCode
          })}
          accessibilityRole="button"
          onPress={() => setPickerVisible(true)}
          style={({ pressed }) => [styles.countryButton, isRTL && styles.rtlRow, pressed && styles.pressed]}
        >
          <Text style={styles.flag}>{country?.flag}</Text>
          <Text style={styles.prefix}>+{phone.callingCode}</Text>
          <Ionicons name="chevron-down" size={16} color={colors.inkSoft} />
        </Pressable>
        <View style={styles.separator} />
        <TextInput
          accessibilityLabel={t('phone.inputAccessibility', { country: country?.name || phone.countryCode })}
          autoComplete="tel"
          keyboardType="phone-pad"
          onBlur={() => setTouched(true)}
          onChangeText={updateText}
          placeholder={t('phone.placeholder')}
          placeholderTextColor={colors.inkSoft}
          style={styles.input}
          textContentType="telephoneNumber"
          value={phone.formatted}
        />
        {phone.isValid ? <Ionicons name="checkmark-circle" size={20} color={colors.greenAccessible} /> : null}
      </View>
      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole={!phone.isValid && showValidation ? 'alert' : undefined}
        style={[
          styles.validation,
          isRTL && styles.rtlText,
          phone.isValid ? styles.valid : styles.invalid,
          !showValidation && styles.hiddenValidation
        ]}
      >
        {validationMessage}
      </Text>
      <CountryPicker
        onClose={() => setPickerVisible(false)}
        onSelect={selectCountry}
        selectedCountry={phone.countryCode}
        visible={pickerVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7 },
  label: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  inputRow: { minHeight: 52, paddingRight: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, backgroundColor: '#fff' },
  rtlInputRow: { flexDirection: 'row-reverse', paddingRight: 0, paddingLeft: 12 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  invalidInput: { borderColor: colors.redAccessible },
  countryButton: { width: 116, minHeight: 50, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  flag: { fontSize: 22 },
  prefix: { fontFamily: fonts.semibold, color: colors.ink, fontSize: 15 },
  separator: { width: 1, height: 28, backgroundColor: colors.line },
  input: { flex: 1, minWidth: 0, minHeight: 50, paddingHorizontal: 12, fontFamily: fonts.regular, color: colors.ink, fontSize: 16, writingDirection: 'ltr', textAlign: 'left' },
  validation: { minHeight: 18, fontFamily: fonts.regular, fontSize: 12 },
  valid: { color: colors.greenAccessible },
  invalid: { color: colors.redAccessible },
  hiddenValidation: { opacity: 0 },
  pressed: { opacity: 0.65 }
});
