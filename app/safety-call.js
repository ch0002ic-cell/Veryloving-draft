import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, Keyboard, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { ChatBubble } from '../src/components/ChatBubble';
import { StatusPill } from '../src/components/StatusPill';
import { VoiceActivityIndicator } from '../src/components/VoiceActivityIndicator';
import { useHumeVoiceCall } from '../src/hooks/useHumeVoiceCall';
import { colors, radii, spacing, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { InteractionFeedbackModal } from '../src/components/InteractionFeedbackModal';
import { Snackbar } from '../src/components/Snackbar';
import { useAuth } from '../src/context/AuthContext';
import { submitInteractionFeedback } from '../src/services/ai-native-scenarios';
import { MAX_VOICE_TEXT_CHARACTERS } from '../src/utils/voice-text';

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
  const { accessToken, user } = useAuth();
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
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  const [feedbackInteraction, setFeedbackInteraction] = useState(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackFailed, setFeedbackFailed] = useState(false);
  const [endingCall, setEndingCall] = useState(false);
  const [snackbar, setSnackbar] = useState(null);
  const messageListRef = useRef(null);
  const feedbackReturnRef = useRef(null);
  const endCallInFlightRef = useRef(false);
  const closeAfterCompletionRef = useRef(false);
  const feedbackFlightRef = useRef(null);
  const retryMessageFlightRef = useRef(null);
  const callLifecycleEpochRef = useRef(0);
  const mountedRef = useRef(false);
  const authIdentityRef = useRef({ accountId: user?.id || null, accessToken });
  authIdentityRef.current = { accountId: user?.id || null, accessToken };
  const active = status === 'connected';
  const connectionTone = active
    ? 'ok'
    : isConnecting ? 'active' : status === 'error' ? 'danger' : isOfflineCompanion ? 'warn' : 'idle';
  const statusLabel = connectionLabel({ isConnecting, isOfflineCompanion, isOnline, status, t });

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      feedbackFlightRef.current?.controller.abort();
      feedbackFlightRef.current = null;
      retryMessageFlightRef.current = null;
      callLifecycleEpochRef.current += 1;
      closeAfterCompletionRef.current = false;
    };
  }, []);

  useEffect(() => {
    const feedbackAccountChanged = feedbackInteraction
      && feedbackInteraction.accountId !== user?.id;
    const flight = feedbackFlightRef.current;
    const flightIdentityChanged = flight && (
      flight.accountId !== user?.id || flight.accessToken !== accessToken
    );
    if (flightIdentityChanged) {
      flight.controller.abort();
      feedbackFlightRef.current = null;
      setFeedbackBusy(false);
    }
    if (feedbackAccountChanged) {
      setFeedbackInteraction(null);
      setFeedbackVisible(false);
      setFeedbackFailed(false);
      closeAfterCompletionRef.current = false;
    }
  }, [accessToken, feedbackInteraction, user?.id]);

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
    if (!mountedRef.current || retryMessageFlightRef.current) return;
    const flight = { messageId };
    retryMessageFlightRef.current = flight;
    setRetryingMessageId(messageId);
    try {
      await retryMessage(messageId);
    } catch {
      // The hook preserves the failed delivery state and presents the error.
    } finally {
      if (retryMessageFlightRef.current === flight) {
        retryMessageFlightRef.current = null;
        if (mountedRef.current) setRetryingMessageId(null);
      }
    }
  }, [retryMessage]);

  const finishCall = useCallback(async ({ closeAfter = false } = {}) => {
    if (!mountedRef.current) return;
    if (endCallInFlightRef.current) {
      if (closeAfter) closeAfterCompletionRef.current = true;
      return;
    }
    closeAfterCompletionRef.current = Boolean(closeAfter);
    const lifecycleEpoch = callLifecycleEpochRef.current;
    const expectedIdentity = authIdentityRef.current;
    endCallInFlightRef.current = true;
    setEndingCall(true);
    let navigateAfterCompletion = false;
    try {
      const completion = await stop();
      const stillOwned = mountedRef.current
        && callLifecycleEpochRef.current === lifecycleEpoch
        && authIdentityRef.current.accountId === expectedIdentity.accountId
        && authIdentityRef.current.accessToken === expectedIdentity.accessToken;
      if (!stillOwned) {
        if (callLifecycleEpochRef.current === lifecycleEpoch) {
          closeAfterCompletionRef.current = false;
        }
        return;
      }
      if (expectedIdentity.accessToken && expectedIdentity.accountId
        && completion?.interactionFeedbackEligible) {
        setFeedbackInteraction({
          accountId: expectedIdentity.accountId,
          interactionId: completion.interactionId
        });
        setFeedbackFailed(false);
        setFeedbackVisible(true);
      } else {
        setFeedbackInteraction(null);
        navigateAfterCompletion = closeAfterCompletionRef.current;
        closeAfterCompletionRef.current = false;
      }
    } catch {
      if (mountedRef.current
        && callLifecycleEpochRef.current === lifecycleEpoch
        && authIdentityRef.current.accountId === expectedIdentity.accountId
        && authIdentityRef.current.accessToken === expectedIdentity.accessToken) {
        navigateAfterCompletion = closeAfterCompletionRef.current;
        closeAfterCompletionRef.current = false;
        if (!navigateAfterCompletion) {
          setSnackbar({ tone: 'error', message: t('safetyCall.interrupted') });
        }
      } else if (callLifecycleEpochRef.current === lifecycleEpoch) {
        closeAfterCompletionRef.current = false;
      }
    } finally {
      endCallInFlightRef.current = false;
      if (mountedRef.current && callLifecycleEpochRef.current === lifecycleEpoch) {
        setEndingCall(false);
      }
    }
    if (navigateAfterCompletion && mountedRef.current) closeScreen();
  }, [stop, t]);

  const endCall = useCallback(() => finishCall(), [finishCall]);
  const requestClose = useCallback(() => finishCall({ closeAfter: true }), [finishCall]);
  const startCall = useCallback(() => {
    if (!mountedRef.current || endCallInFlightRef.current || isConnecting) return;
    callLifecycleEpochRef.current += 1;
    closeAfterCompletionRef.current = false;
    setFeedbackVisible(false);
    setFeedbackInteraction(null);
    setFeedbackFailed(false);
    start();
  }, [isConnecting, start]);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => subscription.remove();
  }, [requestClose]));

  const rateCall = useCallback(async (rating) => {
    if (feedbackFlightRef.current) return;
    if (!accessToken || !user?.id
      || feedbackInteraction?.accountId !== user.id
      || !feedbackInteraction.interactionId || feedbackBusy) return;
    const controller = new AbortController();
    const flight = {
      accountId: user.id,
      accessToken,
      controller,
      interactionId: feedbackInteraction.interactionId
    };
    feedbackFlightRef.current = flight;
    setFeedbackBusy(true);
    setFeedbackFailed(false);
    try {
      await submitInteractionFeedback({
        accountId: user.id,
        accessToken,
        interactionType: 'voice_call',
        interactionId: flight.interactionId,
        rating
      }, { signal: controller.signal });
      if (feedbackFlightRef.current !== flight
        || !mountedRef.current
        || authIdentityRef.current.accountId !== flight.accountId
        || authIdentityRef.current.accessToken !== flight.accessToken) return;
      setFeedbackVisible(false);
      setFeedbackInteraction(null);
      const shouldClose = closeAfterCompletionRef.current;
      closeAfterCompletionRef.current = false;
      if (shouldClose) closeScreen();
      else setSnackbar({ tone: 'success', message: t('wellness.feedback.thanks') });
    } catch (feedbackError) {
      if (feedbackError?.code !== 'SCENARIO_CANCELLED'
        && feedbackFlightRef.current === flight && mountedRef.current) {
        setFeedbackFailed(true);
      }
    } finally {
      if (feedbackFlightRef.current === flight) {
        feedbackFlightRef.current = null;
        if (mountedRef.current) setFeedbackBusy(false);
      }
    }
  }, [accessToken, feedbackBusy, feedbackInteraction, t, user?.id]);

  const openSystemSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      if (mountedRef.current) {
        setSnackbar({ tone: 'error', message: t('settings.linkFailed') });
      }
    }
  }, [t]);

  return (
    <Screen scroll={false}>
      <View style={[styles.header, isRTL && styles.rtlRow]}>
        <Button title={t('common.close')} variant="ghost" compact loading={endingCall} onPress={requestClose} />
        <View accessibilityLiveRegion="polite" style={[styles.connectionStatus, isRTL && styles.rtlRow]}>
          {isConnecting ? <ActivityIndicator size="small" color={colors.orangeAccessible} /> : null}
          <StatusPill label={statusLabel} tone={connectionTone} />
        </View>
      </View>

      <Card variant={active ? 'tinted' : 'raised'} style={[styles.center, keyboardVisible && styles.centerCompact]}>
        {!keyboardVisible ? (
          <View style={[styles.avatarHalo, active && styles.avatarHaloActive]}>
            <Image accessible={false} source={selectedVoice.avatar} style={styles.avatar} resizeMode="contain" />
          </View>
        ) : null}
        {!keyboardVisible ? <VoiceActivityIndicator active={active} /> : null}
        <Text accessibilityRole="header" ref={feedbackReturnRef} style={styles.name}>
          {t(`voices.profiles.${selectedVoice.id}.name`)}
        </Text>
        {isConnecting ? <Text style={styles.connecting}>{t('safetyCall.connectingSecurely')}</Text> : null}
        {pendingMessageCount ? (
          <Text accessibilityLiveRegion="polite" style={styles.queued}>{t('safetyCall.messagesWaiting', { count: pendingMessageCount })}</Text>
        ) : null}
        <FeedbackBanner message={notice ? t(notice) : null} tone="info" />
        <FeedbackBanner
          message={error?.translationKey ? t(error.translationKey) : null}
          actionLabel={error?.code === 'MICROPHONE_PERMISSION_DENIED'
            ? t('common.settings')
            : canRetryOnline ? t('common.retry') : undefined}
          onAction={error?.code === 'MICROPHONE_PERMISSION_DENIED'
            ? openSystemSettings
            : canRetryOnline ? retryOnline : undefined}
        />
        {fallbackAvailable ? <Button title={t('safetyCall.useOffline')} variant="ghost" onPress={startOfflineFallback} loading={isConnecting} /> : null}
        {canRetryOnline ? <Button title={t('safetyCall.reconnect')} variant="ghost" onPress={retryOnline} loading={isConnecting} /> : null}
      </Card>

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
          maxLength={MAX_VOICE_TEXT_CHARACTERS}
          onChangeText={setText}
          placeholder={t('safetyCall.typePlaceholder')}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="send"
          onSubmitEditing={submitText}
          submitBehavior="submit"
          style={[styles.input, isRTL && styles.rtlInput]}
        />
        <Button title={t('common.send')} icon="arrow-up" compact onPress={submitText} disabled={!text.trim()} />
      </View>
      <View style={styles.actions}>
        {active
          ? (
            <Button
              loading={endingCall}
              loadingLabel={t('common.loading')}
              onPress={endCall}
              title={t('safetyCall.endCall')}
              variant="danger"
            />
          )
          : <Button title={isConnecting ? t('safetyCall.connecting') : t('safetyCall.startCall')} icon="call" onPress={startCall} loading={isConnecting || endingCall} />}
      </View>
      <Snackbar
        message={snackbar?.message}
        onDismiss={() => setSnackbar(null)}
        tone={snackbar?.tone}
      />
      <InteractionFeedbackModal
        busy={feedbackBusy}
        error={feedbackFailed}
        interactionName={t('home.safetyCall')}
        onDismiss={() => {
          if (!feedbackBusy) {
            setFeedbackVisible(false);
            setFeedbackFailed(false);
            setFeedbackInteraction(null);
            const shouldClose = closeAfterCompletionRef.current;
            closeAfterCompletionRef.current = false;
            if (shouldClose) closeScreen();
          }
        }}
        onRate={rateCall}
        returnFocusRef={feedbackReturnRef}
        visible={feedbackVisible}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  connectionStatus: { minWidth: 0, maxWidth: '100%', minHeight: 32, flexDirection: 'row', flexShrink: 1, alignItems: 'center', gap: spacing.sm },
  center: { alignItems: 'center', gap: spacing.sm, borderRadius: radii.xl },
  centerCompact: { gap: spacing.xs, paddingVertical: spacing.sm },
  avatarHalo: {
    width: 108,
    height: 108,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 54,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 2,
    borderColor: colors.borderSubtle
  },
  avatarHaloActive: { backgroundColor: colors.greenSoft, borderColor: colors.greenAccessible },
  avatar: { width: 92, height: 92 },
  name: { ...typography.titleLarge, color: colors.textPrimary },
  connecting: { ...typography.label, color: colors.textPrimary, textAlign: 'center' },
  queued: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  messages: { flex: 1 },
  messageContent: { flexGrow: 1, paddingVertical: spacing.sm },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderControl,
    borderRadius: radii.lg,
    minHeight: 50,
    paddingHorizontal: spacing.mdSm,
    ...typography.bodyLarge,
    color: colors.textPrimary
  },
  rtlInput: { textAlign: 'right', writingDirection: 'rtl' },
  actions: { gap: spacing.sm }
});
