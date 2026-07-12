import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Button } from '../src/components/Button';
import { ChatBubble } from '../src/components/ChatBubble';
import { VoiceActivityIndicator } from '../src/components/VoiceActivityIndicator';
import { useHumeVoiceCall } from '../src/hooks/useHumeVoiceCall';
import { colors, fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

function connectionLabel({ isConnecting, isOnline, status, t }) {
  if (isConnecting) return t('safetyCall.connecting');
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
    retryMessage
  } = useHumeVoiceCall({ initialSessionId: sessionId });
  const [text, setText] = useState('');
  const [retryingMessageId, setRetryingMessageId] = useState(null);
  const active = status === 'connected';

  const submitText = useCallback(async () => {
    const outgoing = text.trim();
    if (!outgoing) return;
    setText('');
    await sendText(outgoing);
  }, [sendText, text]);

  const retryFailedMessage = useCallback(async (messageId) => {
    setRetryingMessageId(messageId);
    try {
      await retryMessage(messageId);
    } finally {
      setRetryingMessageId(null);
    }
  }, [retryMessage]);

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Button title={t('common.close')} variant="ghost" onPress={() => router.back()} />
        <View style={styles.connectionStatus}>
          {isConnecting ? <ActivityIndicator size="small" color={colors.orange} /> : null}
          <Text style={styles.status}>{connectionLabel({ isConnecting, isOnline, status, t })}</Text>
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
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error.message}</Text> : null}
        {fallbackAvailable ? <Button title={t('safetyCall.useOffline')} variant="ghost" onPress={startOfflineFallback} loading={isConnecting} /> : null}
        {canRetryOnline ? <Button title={t('safetyCall.reconnect')} variant="ghost" onPress={retryOnline} loading={isConnecting} /> : null}
      </View>

      <FlatList
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
      />

      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('safetyCall.typePlaceholder')}
          returnKeyType="send"
          onSubmitEditing={submitText}
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
  notice: { maxWidth: 340, color: colors.blue, fontFamily: fonts.regular, lineHeight: 19, textAlign: 'center' },
  error: { maxWidth: 340, color: colors.red, fontFamily: fonts.regular, lineHeight: 19, textAlign: 'center' },
  messages: { flex: 1 },
  messageContent: { paddingVertical: 8 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.line, borderRadius: 14, minHeight: 50, paddingHorizontal: 12 },
  actions: { gap: 8 }
});
