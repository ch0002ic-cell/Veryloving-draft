import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Button } from '../src/components/Button';
import { ChatBubble } from '../src/components/ChatBubble';
import { VoiceActivityIndicator } from '../src/components/VoiceActivityIndicator';
import { useHumeVoiceCall } from '../src/hooks/useHumeVoiceCall';
import { colors, fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';

function connectionLabel({ isConnecting, isOfflineCompanion, isOnline, status, t }) {
  if (isConnecting) return t('safetyCall.connecting');
  if (isOfflineCompanion) return t('safetyCall.offlineCompanion');
  if (!isOnline) return status === 'connected' ? t('safetyCall.offlineCompanion') : t('safetyCall.offline');
  if (status === 'connected') return t('safetyCall.connected');
  if (status === 'error') return t('safetyCall.interrupted');
  return t('safetyCall.ready');
}

export default function SafetyCall() {
  const { sessionId } = useLocalSearchParams();
  const { t } = useI18n();
  const {
    status,
    messages,
    error,
    notice,
    selectedVoice,
    start,
    stop,
    sendText,
    fallbackAvailable,
    startOfflineFallback,
    isOnline,
    pendingMessageCount,
    isConnecting,
    canRetryOnline,
    retryOnline,
    retryMessage,
    isOfflineCompanion
  } = useHumeVoiceCall({ initialSessionId: sessionId });
  const [text, setText] = useState('');
  const [retryingMessageId, setRetryingMessageId] = useState(null);
  const messageListRef = useRef(null);
  const active = status === 'connected';

  const submitText = useCallback(async () => {
    const outgoing = text.trim();
    if (!outgoing) return;
    setText('');
    try {
      await sendText(outgoing);
    } catch {
      // Keep the user's text available when the durable offline queue could
      // not accept it. The hook supplies the actionable error banner.
      setText((current) => current || outgoing);
    }
  }, [sendText, text]);

  const retryFailedMessage = useCallback(async (messageId) => {
    setRetryingMessageId(messageId);
    try {
      await retryMessage(messageId);
    } catch {
      // The hook preserves the failed delivery state and presents the error.
    } finally {
      setRetryingMessageId(null);
    }
  }, [retryMessage]);

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Button title={t('common.close')} variant="ghost" compact onPress={() => router.back()} />
        <View style={styles.connectionStatus}>
          {isConnecting ? <ActivityIndicator size="small" color={colors.orange} /> : null}
          <Text style={styles.status}>
            {connectionLabel({ isConnecting, isOfflineCompanion, isOnline, status, t })}
          </Text>
        </View>
      </View>

      <View style={styles.center}>
        <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
        <VoiceActivityIndicator active={active} />
        <Text style={styles.name}>{t(`voices.profiles.${selectedVoice.id}.name`)}</Text>
        {isConnecting ? <Text style={styles.connecting}>{t('safetyCall.connectingSecurely')}</Text> : null}
        {pendingMessageCount ? (
          <Text style={styles.queued}>{t('safetyCall.messagesWaiting', { count: pendingMessageCount })}</Text>
        ) : null}
        <FeedbackBanner message={notice} tone="info" />
        <FeedbackBanner
          message={error?.message}
          actionLabel={canRetryOnline ? t('common.retry') : undefined}
          onAction={canRetryOnline ? retryOnline : undefined}
        />
        {fallbackAvailable ? <Button title={t('safetyCall.useOffline')} variant="ghost" onPress={startOfflineFallback} loading={isConnecting} /> : null}
        {canRetryOnline ? <Button title={t('safetyCall.reconnect')} variant="ghost" onPress={retryOnline} loading={isConnecting} /> : null}
      </View>

      <FlatList
        ref={messageListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ChatBubble
            role={item.role}
            text={item.text}
            deliveryStatus={item.deliveryStatus}
            deliveryError={item.deliveryError}
            retrying={retryingMessageId === item.id}
            onRetry={() => retryFailedMessage(item.id)}
          />
        )}
        style={styles.messages}
        contentContainerStyle={styles.messageContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={(
          <EmptyState
            compact
            title={t('safetyCall.emptyTitle')}
            message={t('safetyCall.emptyMessage')}
          />
        )}
        onContentSizeChange={() => messageListRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('safetyCall.typePlaceholder')}
          returnKeyType="send"
          onSubmitEditing={submitText}
          submitBehavior="submit"
          style={styles.input}
        />
        <Button title={t('common.send')} onPress={submitText} disabled={!text.trim()} />
      </View>
      <View style={styles.actions}>
        {active
          ? <Button title={t('safetyCall.endCall')} variant="danger" onPress={stop} />
          : <Button title={isConnecting ? t('safetyCall.connecting') : t('safetyCall.startCall')} icon="call" onPress={start} loading={isConnecting} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  connectionStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  status: { fontFamily: fonts.semibold, color: colors.inkSoft },
  center: { alignItems: 'center', gap: 8 },
  avatar: { width: 86, height: 86 },
  name: { fontFamily: fonts.bold, color: colors.ink, fontSize: 24 },
  connecting: { color: colors.ink, fontFamily: fonts.semibold, textAlign: 'center' },
  queued: { color: colors.inkSoft, fontFamily: fonts.regular, textAlign: 'center' },
  messages: { flex: 1 },
  messageContent: { flexGrow: 1, paddingVertical: 8 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 8, minHeight: 50, paddingHorizontal: 12, fontFamily: fonts.regular, color: colors.ink },
  actions: { gap: 8 }
});
