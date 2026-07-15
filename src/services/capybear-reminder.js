import { storage } from './storage';
import { translate, translateForLocale } from '../i18n/core';
import { requestNotificationPermission } from './notifications';
import { createCapybearReminderScheduler } from './capybear-reminder-core';

export {
  CAPYBEAR_REMINDER_HOUR,
  CAPYBEAR_REMINDER_KEY,
  createCapybearReminderScheduler
} from './capybear-reminder-core';

const setReminderEnabled = createCapybearReminderScheduler({
  getNotifications: async () => {
    // Keep the entitlement-aware runtime boundary in one place. Importing the
    // package directly in an unsupported host can trigger native Keychain work.
    const { getNotificationsModule } = await import('./notifications');
    return getNotificationsModule();
  },
  requestPermission: requestNotificationPermission,
  storageAdapter: storage,
  translateText: (key, { locale } = {}) => locale
    ? translateForLocale(locale, key)
    : translate(key)
});

export function setCapybearReminderEnabled(enabled, options) {
  return setReminderEnabled(Boolean(enabled), options);
}
