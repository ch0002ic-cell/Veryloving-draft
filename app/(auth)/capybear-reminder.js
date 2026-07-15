import { useState } from 'react';
import { Screen } from '../../src/components/Screen';
import { Header } from '../../src/components/Header';
import { Button } from '../../src/components/Button';
import { useI18n } from '../../src/context/I18nContext';
import { FeedbackBanner } from '../../src/components/FeedbackBanner';
import { useOnboardingNavigation } from '../../src/hooks/useOnboardingNavigation';
import { useAppState } from '../../src/context/AppContext';
import { setCapybearReminderEnabled } from '../../src/services/capybear-reminder';

export default function CapybearReminder() {
  const { t } = useI18n();
  const { updateSettings } = useAppState();
  const { advanceTo, advancing, navigationError } = useOnboardingNavigation();
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState(null);
  const busy = scheduling || advancing;

  const finish = async (enableReminder) => {
    if (busy) return;
    setScheduling(true);
    setScheduleError(null);
    let scheduled = false;
    try {
      const result = await setCapybearReminderEnabled(enableReminder);
      scheduled = result.enabled;
      if (enableReminder && !scheduled) {
        setScheduleError(t('permissions.notificationsRationaleMessage'));
        return;
      }
      try {
        await updateSettings({ reminderEnabled: scheduled });
      } catch (error) {
        if (scheduled) await setCapybearReminderEnabled(false).catch(() => {});
        throw error;
      }
      await advanceTo('/(auth)/completion', { replace: true });
    } catch {
      setScheduleError(t('settings.updateFailedMessage'));
    } finally {
      setScheduling(false);
    }
  };

  return (
    <Screen>
      <Header title={t('auth.capybearReminder')} subtitle={t('permissions.notificationsBody')} />
      <FeedbackBanner message={scheduleError || navigationError} />
      <Button
        title={t('permissions.enableNotifications')}
        loading={scheduling}
        disabled={busy}
        onPress={() => finish(true)}
      />
      <Button
        title={t('common.skip')}
        variant="ghost"
        disabled={busy}
        onPress={() => finish(false)}
      />
    </Screen>
  );
}
