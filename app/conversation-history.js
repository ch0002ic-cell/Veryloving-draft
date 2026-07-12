import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../src/components/Screen';
import { Header } from '../src/components/Header';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { clearConversationHistory, deleteConversationSession, loadConversationHistory } from '../src/services/conversation-history';
import { clearOfflineMessageQueue, deleteQueuedMessagesForSession } from '../src/services/offline-message-queue';
import { colors, fonts } from '../src/constants/theme';
import { useI18n } from '../src/context/I18nContext';

export default function ConversationHistory() {
  const [sessions, setSessions] = useState([]);
  const { locale, t } = useI18n();

  const refresh = useCallback(async () => {
    setSessions(await loadConversationHistory());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const confirmClear = () => {
    Alert.alert(t('history.clearTitle'), t('history.clearMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.clear'), style: 'destructive', onPress: async () => { await Promise.all([clearConversationHistory(), clearOfflineMessageQueue()]); await refresh(); } }
    ]);
  };

  const removeSession = (sessionId) => {
    Alert.alert(t('history.deleteTitle'), t('history.cannotUndo'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => { await deleteQueuedMessagesForSession(sessionId); setSessions(await deleteConversationSession(sessionId)); } }
    ]);
  };

  return (
    <Screen scroll={false}>
      <Header title={t('history.title')} subtitle={t('history.subtitle')} />
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Card><Text style={styles.muted}>{t('history.empty')}</Text></Card>}
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
      {sessions.length ? <Button title={t('history.clearAll')} variant="danger" onPress={confirmClear} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingBottom: 16 },
  card: { gap: 10, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  titleGroup: { flex: 1 },
  actions: { gap: 4, alignItems: 'flex-end' },
  title: { fontFamily: fonts.bold, color: colors.ink, fontSize: 18 },
  muted: { fontFamily: fonts.regular, color: colors.inkSoft },
  message: { fontFamily: fonts.regular, color: colors.ink },
  role: { fontFamily: fonts.semibold, color: colors.inkSoft }
});
