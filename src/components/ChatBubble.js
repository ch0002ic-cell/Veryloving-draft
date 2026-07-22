import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, motion, radii, sizes, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function ChatBubble({ role, text, deliveryStatus, deliveryError, onRetry, retrying = false }) {
  const { isRTL, t } = useI18n();
  const user = role === 'user';
  const failed = user && deliveryStatus === 'failed';
  const queued = user && deliveryStatus === 'queued';
  const retryDisabled = retrying || typeof onRetry !== 'function';
  const deliveryErrorKey = typeof deliveryError === 'string'
    && /^(?:errors|releaseCritical)\.[A-Za-z0-9_.]+$/.test(deliveryError)
    ? deliveryError
    : null;
  return (
    <View style={[
      styles.group,
      user
        ? (isRTL ? styles.userGroupRTL : styles.userGroup)
        : (isRTL ? styles.assistantGroupRTL : styles.assistantGroup)
    ]}>
      <View
        accessible
        accessibilityLabel={`${t(user ? 'chat.roles.user' : 'chat.roles.assistant')}: ${text}`}
        style={[styles.bubble, user ? styles.user : styles.assistant, failed && styles.failedBubble]}
      >
        <Text style={[styles.text, isRTL && styles.rtlText, user && styles.userText]}>{text}</Text>
      </View>
      {queued ? <Text accessibilityLiveRegion="polite" style={[styles.delivery, isRTL && styles.rtlText]}>{t('chat.waiting')}</Text> : null}
      {failed ? (
        <View style={[styles.failureRow, isRTL && styles.rtlRow]}>
          <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={[styles.failureText, isRTL && styles.rtlText]}>{deliveryErrorKey ? t(deliveryErrorKey) : t('chat.notSent')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.retryAccessibility')}
            accessibilityState={{ busy: retrying, disabled: retryDisabled }}
            android_ripple={{ color: colors.redSoft }}
            disabled={retryDisabled}
            onPress={onRetry}
            hitSlop={8}
            style={({ pressed }) => [styles.retry, isRTL && styles.rtlRow, pressed && styles.retryPressed]}
          >
            {retrying
              ? <ActivityIndicator size="small" color={colors.redAccessible} />
              : <Ionicons accessible={false} name="refresh" size={sizes.iconSmall} color={colors.redAccessible} />}
            <Text style={styles.retryText}>{retrying ? t('common.retrying') : t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { maxWidth: '90%', marginVertical: spacing.xs },
  userGroup: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  assistantGroup: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  userGroupRTL: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  assistantGroupRTL: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { maxWidth: '100%', padding: spacing.mdSm, borderRadius: radii.bubble },
  user: { backgroundColor: colors.actionPrimary },
  assistant: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderSubtle },
  failedBubble: { borderWidth: 2, borderColor: colors.redAccessible },
  text: { ...typography.bodySmall, color: colors.textPrimary },
  userText: { color: colors.textInverse },
  delivery: { marginTop: spacing.xs, ...typography.caption, color: colors.textSecondary },
  failureRow: { marginTop: spacing.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.sm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  failureText: { flexShrink: 1, ...typography.caption, color: colors.redAccessible, textAlign: 'auto' },
  retry: { minHeight: sizes.touchTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.md },
  retryPressed: { opacity: 0.72, transform: [{ scale: motion.pressedScale }] },
  retryText: { ...typography.caption, fontFamily: typography.label.fontFamily, color: colors.redAccessible }
});
