import { useEffect, useMemo, useRef, useState } from 'react';
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
import { colors, motion, radii, sizes, spacing, typography } from '../constants/theme';

export function GlobalPhoneInput({ value, onChange, label, forceError = false }) {
  const locales = useLocales();
  const { isRTL, locale, t } = useI18n();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [touched, setTouched] = useState(false);
  const countryButtonRef = useRef(null);
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
          ref={countryButtonRef}
          accessibilityLabel={t('phone.countryButton', {
            callingCode: phone.callingCode,
            country: country?.name || phone.countryCode
          })}
          accessibilityRole="button"
          accessibilityState={{ expanded: pickerVisible }}
          android_ripple={{ color: colors.borderSubtle }}
          onPress={() => setPickerVisible(true)}
          style={({ pressed }) => [styles.countryButton, isRTL && styles.rtlRow, pressed && styles.pressed]}
        >
          <Text style={styles.flag}>{country?.flag}</Text>
          <Text style={styles.prefix}>+{phone.callingCode}</Text>
          <Ionicons accessible={false} name="chevron-down" size={sizes.iconSmall} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.separator} />
        <TextInput
          aria-invalid={showValidation && !phone.isValid}
          accessibilityLabel={t('phone.inputAccessibility', { country: country?.name || phone.countryCode })}
          autoComplete="tel"
          keyboardType="phone-pad"
          onBlur={() => setTouched(true)}
          onChangeText={updateText}
          placeholder={t('phone.placeholder')}
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          textContentType="telephoneNumber"
          value={phone.formatted}
        />
        {phone.isValid ? <Ionicons accessible={false} name="checkmark-circle" size={sizes.icon} color={colors.greenAccessible} /> : null}
      </View>
      <Text
        accessible={showValidation}
        accessibilityElementsHidden={!showValidation}
        importantForAccessibility={showValidation ? 'auto' : 'no-hide-descendants'}
        accessibilityLiveRegion="polite"
        accessibilityRole={!phone.isValid && showValidation ? 'alert' : undefined}
        style={[
          styles.validation,
          isRTL && styles.rtlText,
          phone.isValid ? styles.valid : styles.invalid,
          !showValidation && styles.hiddenValidation
        ]}
      >
        {showValidation ? validationMessage : ' '}
      </Text>
      <CountryPicker
        onClose={() => setPickerVisible(false)}
        onSelect={selectCountry}
        returnFocusRef={countryButtonRef}
        selectedCountry={phone.countryCode}
        visible={pickerVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  label: { ...typography.label, color: colors.textPrimary },
  inputRow: { minHeight: sizes.control, paddingRight: spacing.mdSm, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.borderControl, borderRadius: radii.lg, backgroundColor: colors.surfaceRaised },
  rtlInputRow: { flexDirection: 'row-reverse', paddingRight: spacing.none, paddingLeft: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  invalidInput: { borderColor: colors.redAccessible },
  countryButton: { minWidth: sizes.controlLarge + spacing.lg, minHeight: sizes.control, paddingHorizontal: spacing.sm, flexShrink: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  flag: { fontSize: sizes.icon },
  prefix: { ...typography.label, color: colors.textPrimary },
  separator: { width: StyleSheet.hairlineWidth, height: sizes.iconLarge, backgroundColor: colors.borderSubtle },
  input: { flex: 1, minWidth: 0, minHeight: sizes.control, paddingHorizontal: spacing.mdSm, ...typography.bodyLarge, color: colors.textPrimary, writingDirection: 'ltr', textAlign: 'left' },
  validation: { minHeight: typography.caption.lineHeight, ...typography.caption },
  valid: { color: colors.greenAccessible },
  invalid: { color: colors.redAccessible },
  hiddenValidation: { opacity: 0 },
  pressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] }
});
