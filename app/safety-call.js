import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Keyboard, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
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

function closeScreen() {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)');
}

export default function SafetyCall() {
  const { sessionId } = useLocalSearchParams();
  const { isRTL, t } = useI18n();
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
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const messageListRef = useRef(null);
  const active = status === 'connected';

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

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
      <View style={[styles.header, isRTL && styles.rtlRow]}>
        <Button title={t('common.close')} variant="ghost" compact onPress={closeScreen} />
        <View style={[styles.connectionStatus, isRTL && styles.rtlRow]}>
          {isConnecting ? <ActivityIndicator size="small" color={colors.orangeAccessible} /> : null}
          <Text style={[styles.status, isRTL && styles.rtlText]}>
            {connectionLabel({ isConnecting, isOfflineCompanion, isOnline, status, t })}
          </Text>
        </View>
      </View>

      <View style={[styles.center, keyboardVisible && styles.centerCompact]}>
        {!keyboardVisible ? <Image source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" /> : null}
        {!keyboardVisible ? <VoiceActivityIndicator active={active} /> : null}
        <Text style={styles.name}>{t(`voices.profiles.${selectedVoice.id}.name`)}</Text>
        {isConnecting ? <Text style={styles.connecting}>{t('safetyCall.connectingSecurely')}</Text> : null}
        {pendingMessageCount ? (
          <Text style={styles.queued}>{t('safetyCall.messagesWaiting', { count: pendingMessageCount })}</Text>
        ) : null}
        <FeedbackBanner message={notice ? t(notice) : null} tone="info" />
        <FeedbackBanner
          message={error?.translationKey ? t(error.translationKey) : null}
          actionLabel={error?.code === 'MICROPHONE_PERMISSION_DENIED'
            ? t('common.settings')
            : canRetryOnline ? t('common.retry') : undefined}
          onAction={error?.code === 'MICROPHONE_PERMISSION_DENIED'
            ? () => Linking.openSettings().catch(() => {})
            : canRetryOnline ? retryOnline : undefined}
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

      <View style={[styles.inputRow, isRTL && styles.rtlRow]}>
        <TextInput
          accessibilityLabel={t('safetyCall.typePlaceholder')}
          value={text}
          onChangeText={setText}
          placeholder={t('safetyCall.typePlaceholder')}
          placeholderTextColor={colors.inkSoft}
          returnKeyType="send"
          onSubmitEditing={submitText}
          submitBehavior="submit"
          style={[styles.input, isRTL && styles.rtlInput]}
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
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  connectionStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  status: { fontFamily: fonts.semibold, color: colors.inkSoft },
  center: { alignItems: 'center', gap: 8 },
  centerCompact: { gap: 4 },
  avatar: { width: 86, height: 86 },
  name: { fontFamily: fonts.bold, color: colors.ink, fontSize: 24 },
  connecting: { color: colors.ink, fontFamily: fonts.semibold, textAlign: 'center' },
  queued: { color: colors.inkSoft, fontFamily: fonts.regular, textAlign: 'center' },
  messages: { flex: 1 },
  messageContent: { flexGrow: 1, paddingVertical: 8 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.controlBorder, borderRadius: 8, minHeight: 50, paddingHorizontal: 12, fontFamily: fonts.regular, color: colors.ink },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  actions: { gap: 8 }
});
