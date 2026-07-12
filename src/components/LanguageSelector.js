import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../context/I18nContext';
import { colors, fonts } from '../constants/theme';

export function LanguageSelector({ onError }) {
  const { languageOptions, languagePreference, setLanguage, t } = useI18n();
  const [savingLanguage, setSavingLanguage] = useState(null);

  const chooseLanguage = async (languageCode) => {
    if (savingLanguage || languageCode === languagePreference) return;
    setSavingLanguage(languageCode);
    try {
      await setLanguage(languageCode);
    } catch (error) {
      onError?.(error);
    } finally {
      setSavingLanguage(null);
    }
  };

  return (
    <View style={styles.list}>
      {languageOptions.map((language) => {
        const selected = language.code === languagePreference;
        const label = language.code === 'system' ? t(language.translationKey) : language.nativeName;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ busy: savingLanguage === language.code, checked: selected, disabled: Boolean(savingLanguage) }}
            disabled={Boolean(savingLanguage)}
            key={language.code}
            onPress={() => chooseLanguage(language.code)}
            style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
            {savingLanguage === language.code
              ? <ActivityIndicator size="small" color={colors.orange} />
              : selected ? <Ionicons name="checkmark-circle" size={21} color={colors.green} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  row: { minHeight: 48, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  selected: { backgroundColor: '#F2F8F5' },
  label: { flex: 1, fontFamily: fonts.regular, color: colors.ink, fontSize: 16 },
  selectedLabel: { fontFamily: fonts.semibold },
  pressed: { opacity: 0.65 }
});
