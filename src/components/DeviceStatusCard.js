import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { StatusPill } from './StatusPill';
import { colors, radii, sizes, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function DeviceStatusCard({
  entity,
  deviceType = entity?.deviceType,
  name = entity?.name,
  editable = false,
  disabled = false,
  onRename,
  actions,
  children,
  style
}) {
  const { isRTL, locale, t } = useI18n();
  const [draftName, setDraftName] = useState(name || '');
  const wearable = deviceType === 'wearable';
  const online = entity?.online === true || entity?.connected === true;
  const reconnecting = entity?.connectionState === 'reconnecting';
  const statusLabel = !entity
    ? t('home.noDevice')
    : reconnecting
    ? t('common.connecting')
    : online ? t('safetyCall.connected') : t('safetyCall.offline');
  const typeLabel = wearable ? t('home.northStarDevice') : t('medication.robot');

  useEffect(() => {
    setDraftName(name || '');
  }, [name]);

  const finishRename = async () => {
    const nextName = draftName.trim();
    if (!nextName) {
      setDraftName(name || '');
      return;
    }
    if (nextName === name) return;
    try {
      await onRename?.(nextName);
    } catch {
      setDraftName(name || '');
    }
  };

  return (
    <Card style={[styles.card, style]}>
      <View style={[styles.header, isRTL && styles.rtlRow]}>
        <View style={[styles.iconBox, wearable ? styles.wearableIcon : styles.robotIcon]}>
          <Ionicons
            accessible={false}
            name={wearable ? 'watch-outline' : 'home-outline'}
            size={sizes.icon}
            color={wearable ? colors.orangeAccessible : colors.blueAccessible}
          />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.type, isRTL && styles.rtlText]}>{typeLabel}</Text>
          {editable ? (
            <TextInput
              accessibilityLabel={`${t('contacts.name')} ${name || typeLabel}`}
              editable={!disabled}
              maxLength={80}
              onChangeText={setDraftName}
              onEndEditing={finishRename}
              returnKeyType="done"
              selectTextOnFocus
              style={[styles.nameInput, isRTL && styles.rtlText]}
              value={draftName}
            />
          ) : (
            <Text style={[styles.name, isRTL && styles.rtlText]}>{name || typeLabel}</Text>
          )}
        </View>
        <StatusPill label={statusLabel} tone={online ? 'ok' : reconnecting ? 'warn' : 'idle'} />
      </View>

      {Number.isFinite(entity?.battery) ? (
        <View style={[styles.detailRow, isRTL && styles.rtlRow]}>
          <Ionicons accessible={false} name="battery-half-outline" size={sizes.iconSmall} color={colors.textSecondary} />
          <Text style={[styles.detail, isRTL && styles.rtlText]}>{entity.battery}%</Text>
        </View>
      ) : null}
      {Number.isFinite(entity?.lastSeenAt) ? (
        <View style={[styles.detailRow, isRTL && styles.rtlRow]}>
          <Ionicons accessible={false} name="time-outline" size={sizes.iconSmall} color={colors.textSecondary} />
          <Text style={[styles.detail, isRTL && styles.rtlText]}>
            {t('device.lastSeen', { date: new Date(entity.lastSeenAt).toLocaleString(locale) })}
          </Text>
        </View>
      ) : null}
      {children}
      {actions ? <View style={[styles.actions, isRTL && styles.rtlRow]}>{actions}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { minHeight: 54, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.mdSm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  iconBox: { width: 44, height: 44, borderRadius: radii.lg, alignItems: 'center', justifyContent: 'center' },
  wearableIcon: { backgroundColor: colors.orangeSoft },
  robotIcon: { backgroundColor: colors.blueSoft },
  copy: { flex: 1, minWidth: 140 },
  type: { ...typography.caption, color: colors.textSecondary, fontFamily: typography.label.fontFamily },
  name: { marginTop: spacing.xs, ...typography.heading, color: colors.textPrimary },
  nameInput: { minHeight: 36, paddingVertical: spacing.xs, ...typography.heading, color: colors.textPrimary },
  detailRow: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detail: { flex: 1, ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }
});
