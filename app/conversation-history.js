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
import { colors, fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';
import { images } from '../src/constants/assets';

export default function ConversationHistory() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { locale, t } = useI18n();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSessions(await loadConversationHistory());
    } catch {
      setError(t('history.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirmClear = () => {
    Alert.alert(t('history.clearTitle'), t('history.clearMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.clear'),
        style: 'destructive',
        onPress: async () => {
          try {
            await Promise.all([clearConversationHistory(), clearOfflineMessageQueue()]);
            await refresh();
          } catch {
            setError(t('history.clearFailed'));
          }
        }
      }
    ]);
  };

  const removeSession = (sessionId) => {
    Alert.alert(t('history.deleteTitle'), t('history.cannotUndo'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteQueuedMessagesForSession(sessionId);
            setSessions(await deleteConversationSession(sessionId));
          } catch {
            setError(t('history.deleteFailed'));
          }
        }
      }
    ]);
  };

  return (
    <Screen scroll={false}>
      <Header title={t('history.title')} subtitle={t('history.subtitle')} showBack backLabel={t('common.back')} />
      <FeedbackBanner message={error} actionLabel={t('common.retry')} onAction={refresh} />
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={loading
          ? <LoadingState message={t('common.loading')} />
          : error ? null : (
            <EmptyState
              image={images.capybara}
              title={t('history.emptyTitle')}
              message={t('history.emptyMessage')}
            />
          )}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const preview = item.messages?.slice(-2) || [];
          return (
            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={styles.titleGroup}>
                  <Text style={styles.title}>{item.voiceId ? t(`voices.profiles.${item.voiceId}.name`) : item.voiceName || t('history.aiCompanion')}</Text>
                  <Text style={styles.muted}>{new Date(item.updatedAt || item.startedAt).toLocaleString(locale)}</Text>
                </View>
                <View style={styles.actions}>
                  <Button title={t('history.resume')} variant="ghost" onPress={() => router.push({ pathname: '/safety-call', params: { sessionId: item.id } })} />
                  <Button title={t('common.delete')} variant="ghost" onPress={() => removeSession(item.id)} />
                </View>
              </View>
              {preview.map((message) => (
                <Text key={message.id} style={styles.message}>
                  <Text style={styles.role}>{t(`history.roles.${message.role}`)}: </Text>{message.text}
                </Text>
              ))}
            </Card>
          );
        }}
      />
      {!loading && sessions.length ? <Button title={t('history.clearAll')} variant="danger" onPress={confirmClear} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flexGrow: 1, gap: 12, paddingBottom: 16 },
  card: { gap: 10, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  titleGroup: { flex: 1 },
  actions: { gap: 4, alignItems: 'flex-end' },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft },
  message: { fontFamily: fonts.regular, color: colors.ink },
  role: { fontFamily: fonts.semibold, color: colors.inkSoft }
});
