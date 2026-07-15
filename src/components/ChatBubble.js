import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function ChatBubble({ role, text, deliveryStatus, deliveryError, onRetry, retrying = false }) {
  const { isRTL, t } = useI18n();
  const user = role === 'user';
  const failed = user && deliveryStatus === 'failed';
  const queued = user && deliveryStatus === 'queued';
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
      <View style={[styles.bubble, user ? styles.user : styles.assistant, failed && styles.failedBubble]}>
        <Text style={[styles.text, isRTL && styles.rtlText, user && styles.userText]}>{text}</Text>
      </View>
      {queued ? <Text style={[styles.delivery, isRTL && styles.rtlText]}>{t('chat.waiting')}</Text> : null}
      {failed ? (
        <View style={[styles.failureRow, isRTL && styles.rtlRow]}>
          <Text style={[styles.failureText, isRTL && styles.rtlText]}>{deliveryErrorKey ? t(deliveryErrorKey) : t('chat.notSent')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('chat.retryAccessibility')}
            disabled={retrying}
            onPress={onRetry}
            hitSlop={8}
            style={({ pressed }) => [styles.retry, isRTL && styles.rtlRow, pressed && styles.retryPressed]}
          >
            {retrying
              ? <ActivityIndicator size="small" color={colors.redAccessible} />
              : <Ionicons name="refresh" size={16} color={colors.redAccessible} />}
            <Text style={styles.retryText}>{retrying ? t('common.retrying') : t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { maxWidth: '90%', marginVertical: 4 },
  userGroup: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  assistantGroup: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  userGroupRTL: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  assistantGroupRTL: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { maxWidth: '100%', padding: 12, borderRadius: 18 },
  user: { backgroundColor: colors.ink },
  assistant: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  failedBubble: { borderWidth: 2, borderColor: colors.redAccessible },
  text: { fontFamily: fonts.regular, color: colors.ink, lineHeight: 20 },
  userText: { color: '#fff' },
  delivery: { marginTop: 4, fontFamily: fonts.regular, fontSize: 12, color: colors.inkSoft },
  failureRow: { maxWidth: 300, marginTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  failureText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.redAccessible, textAlign: 'auto' },
  retry: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  retryPressed: { opacity: 0.6 },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.redAccessible }
});
