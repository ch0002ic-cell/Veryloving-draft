export const CAPYBEAR_REMINDER_KEY = 'veryloving.notifications.capybearReminder.v1';
export const CAPYBEAR_REMINDER_HOUR = 20;

export function createCapybearReminderScheduler({
  getNotifications,
  requestPermission,
  storageAdapter,
  translateText
}) {
  let requestGeneration = 0;
  const superseded = () => ({ enabled: false, reason: 'superseded' });
  const isCurrent = (generation) => generation === requestGeneration;

  const removeRecordIfOwned = async (identifier, generation, { allowStale = false } = {}) => {
    if (!allowStale && !isCurrent(generation)) return false;
    const latest = await storageAdapter.getJSON(CAPYBEAR_REMINDER_KEY, null);
    if (!allowStale && !isCurrent(generation)) return false;
    if (latest?.version !== 1 || latest.identifier !== identifier) return false;
    await storageAdapter.remove(CAPYBEAR_REMINDER_KEY);
    return allowStale || isCurrent(generation);
  };

  const cancelRemembered = async (Notifications, generation) => {
    const record = await storageAdapter.getJSON(CAPYBEAR_REMINDER_KEY, null);
    if (!isCurrent(generation)) return superseded();
    const identifier = record?.version === 1 && typeof record.identifier === 'string'
      ? record.identifier
      : null;
    if (!identifier) {
      if (record) await storageAdapter.remove(CAPYBEAR_REMINDER_KEY);
      return isCurrent(generation) ? { cancelled: false } : superseded();
    }
    await Notifications.cancelScheduledNotificationAsync(identifier);
    if (!isCurrent(generation)) return superseded();
    await removeRecordIfOwned(identifier, generation);
    return isCurrent(generation) ? { cancelled: true } : superseded();
  };

  return async function setEnabled(enabled, translationOptions) {
    const generation = ++requestGeneration;
    const Notifications = await getNotifications();
    if (!isCurrent(generation)) return superseded();
    if (!Notifications) {
      if (!enabled) await storageAdapter.remove(CAPYBEAR_REMINDER_KEY);
      return isCurrent(generation)
        ? { enabled: false, reason: 'unavailable' }
        : superseded();
    }

    if (!enabled) {
      const cancellation = await cancelRemembered(Notifications, generation);
      return cancellation.reason === 'superseded'
        ? cancellation
        : { enabled: false, reason: null };
    }

    if (!await requestPermission({ showRationale: false })) {
      return isCurrent(generation)
        ? { enabled: false, reason: 'permission-denied' }
        : superseded();
    }
    if (!isCurrent(generation)) return superseded();

    const cancellation = await cancelRemembered(Notifications, generation);
    if (cancellation.reason === 'superseded' || !isCurrent(generation)) return superseded();
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: translateText('common.veryLoving', translationOptions),
        body: translateText('auth.remindersReady', translationOptions),
        data: { kind: 'capybear-reminder', version: 1 }
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: CAPYBEAR_REMINDER_HOUR,
        minute: 0
      }
    });
    if (!isCurrent(generation)) {
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
      return superseded();
    }
    try {
      await storageAdapter.setJSON(CAPYBEAR_REMINDER_KEY, { version: 1, identifier });
    } catch (error) {
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
      throw error;
    }
    if (!isCurrent(generation)) {
      await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});
      await removeRecordIfOwned(identifier, generation, { allowStale: true }).catch(() => {});
      return superseded();
    }
    return { enabled: true, reason: null, identifier };
  };
}
