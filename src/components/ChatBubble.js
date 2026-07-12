import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fonts } from '../constants/theme';

export function ChatBubble({ role, text, deliveryStatus, deliveryError, onRetry, retrying = false }) {
  const user = role === 'user';
  const failed = user && deliveryStatus === 'failed';
  const queued = user && deliveryStatus === 'queued';
  return (
    <View style={[styles.group, user ? styles.userGroup : styles.assistantGroup]}>
      <View style={[styles.bubble, user ? styles.user : styles.assistant, failed && styles.failedBubble]}>
        <Text style={[styles.text, user && styles.userText]}>{text}</Text>
      </View>
      {queued ? <Text style={styles.delivery}>Waiting for connection</Text> : null}
      {failed ? (
        <View style={styles.failureRow}>
          <Text style={styles.failureText}>{deliveryError || 'Message not sent.'}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry sending message"
            disabled={retrying}
            onPress={onRetry}
            hitSlop={8}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            {retrying
              ? <ActivityIndicator size="small" color={colors.red} />
              : <Ionicons name="refresh" size={16} color={colors.red} />}
            <Text style={styles.retryText}>{retrying ? 'Retrying' : 'Retry'}</Text>
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
  bubble: { maxWidth: '100%', padding: 12, borderRadius: 18 },
  user: { backgroundColor: colors.ink },
  assistant: { backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line },
  failedBubble: { borderWidth: 2, borderColor: colors.red },
  text: { fontFamily: fonts.regular, color: colors.ink, lineHeight: 20 },
  userText: { color: '#fff' },
  delivery: { marginTop: 4, fontFamily: fonts.regular, fontSize: 12, color: colors.inkSoft },
  failureRow: { maxWidth: 300, marginTop: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  failureText: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 12, color: colors.red, textAlign: 'right' },
  retry: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8 },
  retryPressed: { opacity: 0.6 },
  retryText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.red }
});
