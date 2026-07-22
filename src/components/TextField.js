import { forwardRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii, sizes, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export const TextField = forwardRef(function TextField({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  editable = true,
  leadingIcon,
  trailing,
  multiline = false,
  accessibilityLabel,
  accessibilityHint,
  containerStyle,
  style,
  onFocus,
  onBlur,
  placeholder,
  ...inputProps
}, ref) {
  const { isRTL } = useI18n();
  const [focused, setFocused] = useState(false);
  const isEditable = editable && !disabled;
  const hasError = Boolean(error);

  return (
    <View style={[styles.group, containerStyle]}>
      {label ? (
        <Text style={[styles.label, isRTL && styles.rtlText]}>
          {label}{required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}
      <View style={[
        styles.field,
        multiline && styles.multilineField,
        focused && styles.focused,
        hasError && styles.invalid,
        !isEditable && styles.disabled,
        isRTL && styles.rtlRow
      ]}>
        {leadingIcon ? (
          <Ionicons accessible={false} name={leadingIcon} size={sizes.icon} color={hasError ? colors.redAccessible : colors.textSecondary} />
        ) : null}
        <TextInput
          {...inputProps}
          ref={ref}
          aria-invalid={hasError}
          aria-required={required}
          accessibilityLabel={accessibilityLabel || label}
          accessibilityHint={accessibilityHint || hint}
          accessibilityState={{ disabled: !isEditable }}
          editable={isEditable}
          multiline={multiline}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          style={[
            styles.input,
            multiline && styles.multilineInput,
            isRTL && styles.rtlText,
            style
          ]}
          textAlignVertical={multiline ? 'top' : 'center'}
        />
        {trailing || null}
      </View>
      {hasError ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.hint, isRTL && styles.rtlText]}>{hint}</Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  label: { ...typography.label, color: colors.textPrimary },
  required: { color: colors.redAccessible },
  field: {
    minHeight: sizes.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.mdSm,
    borderWidth: 1,
    borderColor: colors.borderControl,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceRaised
  },
  multilineField: { minHeight: 112, alignItems: 'flex-start', paddingVertical: spacing.mdSm },
  focused: { borderWidth: 2, borderColor: colors.focus },
  invalid: { borderWidth: 2, borderColor: colors.redAccessible },
  disabled: { backgroundColor: colors.surfaceMuted, opacity: 0.68 },
  input: { flex: 1, minWidth: 0, minHeight: sizes.touchTarget, paddingVertical: spacing.sm, ...typography.bodyLarge, color: colors.textPrimary },
  multilineInput: { minHeight: 86, paddingVertical: spacing.none },
  hint: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.redAccessible },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' }
});
