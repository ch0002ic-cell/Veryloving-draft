import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { EmptyState } from '../src/components/EmptyState';
import { FeedbackBanner } from '../src/components/FeedbackBanner';
import { LoadingState } from '../src/components/LoadingState';
import { clearConversationHistory, deleteConversationSession, loadConversationHistory } from '../src/services/conversation-history';
import { clearOfflineMessageQueue, deleteQueuedMessagesForSession } from '../src/services/offline-message-queue';
import { colors, spacing, typography } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import {
  conversationCompanionName,
  conversationRoleLabel,
  conversationTimestamp
} from '../src/utils/conversation-history-display';
import { images } from '../src/constants/assets';

export default function ConversationHistory() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState(null);
  const [busyAction, setBusyAction] = useState(null);
  const { isRTL, locale, t } = useI18n();

  const refresh = useCallback(async () => {
    setLoading(true);
    setErrorKey(null);
    try {
      setSessions(await loadConversationHistory());
    } catch {
      setErrorKey('history.loadFailed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const clearAll = async () => {
    if (busyAction) return;
    setBusyAction('clear');
    setErrorKey(null);
    try {
      const results = await Promise.allSettled([
        clearConversationHistory(),
        clearOfflineMessageQueue()
      ]);
      if (results[0].status === 'fulfilled') setSessions([]);
      if (results.some((result) => result.status === 'rejected')) throw new Error('HISTORY_CLEAR_INCOMPLETE');
    } catch {
      setErrorKey('history.clearFailed');
    } finally {
      setBusyAction(null);
    }
  };

  const confirmClear = () => {
    Alert.alert(t('history.clearTitle'), t('history.clearMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.clear'),
        style: 'destructive',
        onPress: clearAll
      }
    ]);
  };

  const deleteSession = async (sessionId) => {
    if (busyAction) return;
    setBusyAction(`delete:${sessionId}`);
    setErrorKey(null);
    try {
      await deleteQueuedMessagesForSession(sessionId);
      setSessions(await deleteConversationSession(sessionId));
    } catch {
      setErrorKey('history.deleteFailed');
    } finally {
      setBusyAction(null);
    }
  };

  const removeSession = (sessionId) => {
    Alert.alert(t('history.deleteTitle'), t('history.cannotUndo'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => deleteSession(sessionId)
      }
    ]);
  };

  return (
    <Screen scroll={false}>
      <Header title={t('history.title')} subtitle={t('history.subtitle')} showBack backLabel={t('common.back')} />
      <FeedbackBanner
        message={errorKey ? t(errorKey) : null}
        actionLabel={errorKey === 'history.loadFailed' ? t('common.retry') : undefined}
        onAction={errorKey === 'history.loadFailed' ? refresh : undefined}
        dismissLabel={t('common.close')}
        onDismiss={() => setErrorKey(null)}
      />
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={loading
          ? <LoadingState message={t('common.loading')} />
          : errorKey ? null : (
            <EmptyState
              image={images.capybara}
              title={t('history.emptyTitle')}
              message={t('history.emptyMessage')}
            />
          )}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const preview = item.messages?.slice(-2) || [];
          const companionName = conversationCompanionName(item, t);
          const updatedAt = conversationTimestamp(item, locale) || t('common.unknown');
          const deleting = busyAction === `delete:${item.id}`;
          return (
            <Card style={styles.card}>
              <View style={[styles.row, isRTL && styles.rtlRow]}>
                <View style={styles.titleGroup}>
                  <Text style={[styles.title, isRTL && styles.rtlText]}>{companionName}</Text>
                  <Text style={[styles.muted, isRTL && styles.rtlText]}>
                    {updatedAt}
                  </Text>
                </View>
                <View style={[styles.actions, isRTL && styles.rtlActions]}>
                  <Button accessibilityLabel={`${t('history.resume')}: ${companionName}`} title={t('history.resume')} variant="ghost" disabled={Boolean(busyAction)} onPress={() => router.push({ pathname: '/safety-call', params: { sessionId: item.id } })} />
                  <Button accessibilityLabel={`${t('common.delete')}: ${companionName}`} title={t('common.delete')} variant="ghost" loading={deleting} disabled={Boolean(busyAction)} onPress={() => removeSession(item.id)} />
                </View>
              </View>
              {preview.map((message, index) => (
                <Text
                  key={typeof message.id === 'string'
                    ? message.id
                    : `${String(item.id)}:preview:${index}`}
                  style={[styles.message, isRTL && styles.rtlText]}
                >
                  <Text style={[styles.role, isRTL && styles.rtlText]}>
                    {conversationRoleLabel(message.role, t)}:{' '}
                  </Text>
                  {message.text}
                </Text>
              ))}
            </Card>
          );
        }}
      />
      {!loading && sessions.length ? <Button title={t('history.clearAll')} variant="danger" loading={busyAction === 'clear'} disabled={Boolean(busyAction)} onPress={confirmClear} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, gap: spacing.mdSm, paddingBottom: spacing.md },
  card: { gap: spacing.sm, marginBottom: spacing.mdSm },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' },
  titleGroup: { flex: 1 },
  actions: { flexShrink: 1, gap: spacing.xs, alignItems: 'flex-end' },
  rtlActions: { alignItems: 'flex-start' },
  title: { ...typography.heading, color: colors.textPrimary },
  muted: { ...typography.caption, color: colors.textSecondary },
  message: { ...typography.bodySmall, color: colors.textPrimary },
  role: { fontFamily: typography.label.fontFamily, color: colors.textSecondary }
});
