import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Button } from './Button';
import { FeedbackBanner } from './FeedbackBanner';
import { colors, radii, shadows, sizes, spacing, typography } from '../constants/theme';
import { useI18n } from '../context/I18nContext';

export function InteractionFeedbackModal({
  visible,
  interactionName,
  busy = false,
  error = false,
  onRate,
  onDismiss,
  returnFocusRef
}) {
  const { isRTL, t } = useI18n();
  const titleRef = useRef(null);
  const wasVisibleRef = useRef(false);
  const [pendingRating, setPendingRating] = useState(null);

  useEffect(() => {
    const shouldRestore = !visible && wasVisibleRef.current;
    wasVisibleRef.current = visible;
    if (!visible && !shouldRestore) return undefined;
    const timer = setTimeout(() => {
      const target = visible ? titleRef.current : returnFocusRef?.current;
      const node = findNodeHandle(target);
      if (node) AccessibilityInfo.setAccessibilityFocus?.(node);
    }, visible ? 120 : 180);
    return () => clearTimeout(timer);
  }, [returnFocusRef, visible]);

  useEffect(() => {
    if (!visible || !busy) setPendingRating(null);
  }, [busy, visible]);

  const rate = (rating) => {
    if (busy) return;
    setPendingRating(rating);
    onRate(rating);
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessible={false}
          disabled={busy}
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            style={styles.scroll}
          >
            <View accessibilityViewIsModal style={styles.sheet}>
              <View style={[styles.heading, isRTL && styles.rtlRow]}>
                <View style={styles.iconBox}>
                  <Ionicons accessible={false} name="heart-outline" size={sizes.iconLarge} color={colors.orangeAccessible} />
                </View>
                <View style={styles.copy}>
                  <Text
                    accessibilityRole="header"
                    ref={titleRef}
                    style={[styles.title, isRTL && styles.rtlText]}
                  >
                    {t('wellness.feedback.title')}
                  </Text>
                  <Text style={[styles.message, isRTL && styles.rtlText]}>
                    {t('wellness.feedback.message', { interaction: interactionName })}
                  </Text>
                </View>
              </View>
              <FeedbackBanner
                message={error ? t('wellness.feedback.error') : null}
                tone="error"
              />
              <View style={[styles.actions, isRTL && styles.rtlRow]}>
                <Button
                  accessibilityHint={t('wellness.feedback.helpfulHint')}
                  disabled={busy}
                  icon="thumbs-up-outline"
                  loading={busy && pendingRating === 'up'}
                  onPress={() => rate('up')}
                  title={t('wellness.feedback.helpful')}
                  variant="success"
                  style={styles.action}
                />
                <Button
                  accessibilityHint={t('wellness.feedback.notHelpfulHint')}
                  disabled={busy}
                  icon="thumbs-down-outline"
                  loading={busy && pendingRating === 'down'}
                  onPress={() => rate('down')}
                  title={t('wellness.feedback.notHelpful')}
                  variant="ghost"
                  style={styles.action}
                />
              </View>
              <Button
                compact
                disabled={busy}
                onPress={onDismiss}
                title={t('wellness.feedback.notNow')}
                variant="ghost"
              />
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md,
    backgroundColor: colors.scrim
  },
  safeArea: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '100%',
    alignSelf: 'center'
  },
  scroll: { flexGrow: 0 },
  scrollContent: { flexGrow: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surfaceRaised,
    ...shadows.raised
  },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.mdSm },
  iconBox: {
    width: sizes.headerControl,
    height: sizes.headerControl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.lg,
    backgroundColor: colors.orangeSoft
  },
  copy: { flex: 1, gap: spacing.xs },
  title: { ...typography.title, color: colors.textPrimary },
  message: { ...typography.body, color: colors.textSecondary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { minWidth: 150, flexGrow: 1 },
  rtlRow: { flexDirection: 'row-reverse' },
  rtlText: { textAlign: 'right' }
});
