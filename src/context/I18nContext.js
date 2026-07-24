import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { reloadAppAsync } from 'expo';
import { useLocales } from 'expo-localization';
import { I18nManager, Platform } from 'react-native';
import { useAppState } from './AppContext';
import {
  isRTLLanguage,
  languageOptions,
  resolveLanguage,
  setI18nLocale,
  supportedLanguages,
  SYSTEM_LANGUAGE,
  translateForLocale
} from '../i18n/core';
import { logger } from '../utils/logger';
import { withTimeout } from '../utils/async';
import { isExpoGoRuntime } from '../utils/runtime-environment';
import { setCapybearReminderEnabled } from '../services/capybear-reminder';
import {
  createLocaleTransitionCoordinator,
  localeTransitionAllowsDirectionReload
} from '../services/locale-transition';
import {
  clearRecordedLocaleDirection,
  loadRecordedLocaleDirection,
  localeDirection,
  persistRecordedLocaleDirection,
  shouldReloadForLocaleDirection
} from '../services/locale-direction';

const I18nContext = createContext(null);
const REMINDER_LOCALE_REFRESH_TIMEOUT_MS = 6000;
const REMINDER_LOCALE_CLEANUP_TIMEOUT_MS = 4000;

export function I18nProvider({ children }) {
  const locales = useLocales();
  const { isHydrated, settings, updateSettings } = useAppState();
  const languagePreference = settings.language || SYSTEM_LANGUAGE;
  const locale = resolveLanguage(languagePreference, locales);
  const isRTL = isRTLLanguage(locale);
  const localeTransitionRef = useRef(null);
  const desiredLocaleRef = useRef(locale);
  const reminderEnabledRef = useRef(settings.reminderEnabled);
  if (!localeTransitionRef.current) {
    localeTransitionRef.current = createLocaleTransitionCoordinator();
  }
  desiredLocaleRef.current = locale;
  reminderEnabledRef.current = settings.reminderEnabled;

  const prepareLocalizedReminder = useCallback(async (
    targetLocale,
    { enabled, isCurrent = () => true } = {}
  ) => {
    if (!isCurrent()) return { status: 'superseded' };
    // Keep imperative translation consumers (permissions, BLE, emergency
    // prompts) in lockstep with the React context before any awaited work.
    setI18nLocale(targetLocale);
    if (!enabled) return { status: 'ready' };

    const disableReminderSafely = async (reason) => {
      const results = await Promise.allSettled([
        withTimeout(
          setCapybearReminderEnabled(false),
          REMINDER_LOCALE_CLEANUP_TIMEOUT_MS,
          'Reminder cancellation timed out during a language change.'
        ),
        withTimeout(
          updateSettings({ reminderEnabled: false }),
          REMINDER_LOCALE_CLEANUP_TIMEOUT_MS,
          'Reminder preference cleanup timed out during a language change.'
        )
      ]);
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') return;
        logger.recoverable('[I18n] Could not fully disable a stale localized reminder', {
          errorCode: result.reason?.code || result.reason?.name || 'REMINDER_CLEANUP_FAILED',
          operation: index === 0 ? 'native-reminder' : 'persisted-preference',
          reason
        });
      });
      const nativeCleanupSuperseded = results[0].status === 'fulfilled'
        && results[0].value?.reason === 'superseded';
      if (nativeCleanupSuperseded) {
        logger.recoverable('[I18n] Reminder cleanup was superseded by a newer reminder operation', {
          errorCode: 'REMINDER_CLEANUP_SUPERSEDED',
          reason
        });
      }
      return results.every((result) => result.status === 'fulfilled')
        && !nativeCleanupSuperseded;
    };

    // Pass the target locale explicitly so concurrent context renders cannot
    // change the copy used by the native scheduler.
    try {
      const reminder = await withTimeout(
        setCapybearReminderEnabled(true, { locale: targetLocale }),
        REMINDER_LOCALE_REFRESH_TIMEOUT_MS,
        'Localized reminder scheduling timed out.'
      );
      if (!isCurrent()) return { status: 'superseded' };
      if (reminder.reason === 'superseded') return { status: 'reminder-superseded' };
      if (reminder.enabled) return { status: 'ready' };
      const cleaned = await disableReminderSafely(reminder.reason || 'not-enabled');
      return { status: cleaned ? 'reminder-disabled' : 'reminder-cleanup-incomplete' };
    } catch (error) {
      logger.recoverable('[I18n] Could not refresh the localized reminder', {
        errorCode: error?.code || error?.name || 'REMINDER_LOCALIZATION_FAILED'
      });
      if (!isCurrent()) return { status: 'superseded' };
      const cleaned = await disableReminderSafely(error?.code || error?.name || 'refresh-failed');
      return { status: cleaned ? 'reminder-disabled' : 'reminder-cleanup-incomplete' };
    }
  }, [updateSettings]);

  useEffect(() => {
    setI18nLocale(locale);
    if (!isHydrated || Platform.OS === 'web') return;
    if (isExpoGoRuntime()) {
      logger.recoverable('[I18n] RTL direction changes require a development build or standalone app');
      return;
    }
    let active = true;
    const applyDirection = async () => {
      let preparation = await localeTransitionRef.current.waitForCurrent(locale);
      if (!active || desiredLocaleRef.current !== locale) return;
      if (!preparation.matched) {
        // A picker transition targeting another locale began before its
        // persisted state rendered. Let that generation publish or fail rather
        // than scheduling stale copy for the old locale.
        if (preparation.pendingLocale) return;
        // System-default and cold-start locale changes do not pass through the
        // picker. They still have to refresh enabled native reminder copy before
        // an automatic direction reload.
        preparation = await prepareLocalizedReminder(locale, {
          enabled: reminderEnabledRef.current,
          isCurrent: () => active && desiredLocaleRef.current === locale
        });
        if (!active || desiredLocaleRef.current !== locale) return;
      }
      if (preparation.status === 'timeout') {
        logger.recoverable('[I18n] Locale preparation timed out before the direction reload', {
          errorCode: preparation.error?.code || 'LOCALE_PREPARATION_TIMEOUT',
          locale
        });
      }
      if (
        preparation.status === 'reminder-cleanup-incomplete'
        || preparation.status === 'reminder-superseded'
      ) {
        logger.recoverable('[I18n] Direction reload deferred because reminder state is still changing', {
          errorCode: preparation.status === 'reminder-superseded'
            ? 'REMINDER_TRANSITION_SUPERSEDED'
            : 'REMINDER_CLEANUP_INCOMPLETE',
          locale
        });
      }
      if (!localeTransitionAllowsDirectionReload(preparation)) return;
      const desiredDirection = localeDirection(isRTL);
      let recordedDirection;
      try {
        recordedDirection = await loadRecordedLocaleDirection();
      } catch (error) {
        logger.recoverable('[I18n] Could not read the last native interface direction', {
          errorCode: error?.code || error?.name || 'RTL_DIRECTION_READ_FAILED',
          locale
        });
        return;
      }
      if (!active || desiredLocaleRef.current !== locale) return;
      const needsReload = shouldReloadForLocaleDirection({
        desiredDirection,
        nativeIsRTL: I18nManager.isRTL,
        recordedDirection
      });

      // These writes are idempotent and must also run when the bridge's cached
      // isRTL value already equals the target (notably when returning to LTR).
      I18nManager.allowRTL(true);
      I18nManager.swapLeftAndRightInRTL(true);
      I18nManager.forceRTL(isRTL);
      if (recordedDirection !== desiredDirection) {
        try {
          await persistRecordedLocaleDirection(desiredDirection);
        } catch (error) {
          logger.recoverable('[I18n] Native direction changed but its reload guard could not be saved', {
            errorCode: error?.code || error?.name || 'RTL_DIRECTION_WRITE_FAILED',
            locale
          });
          return;
        }
      }
      if (!active || desiredLocaleRef.current !== locale || !needsReload) return;
      try {
        await reloadAppAsync(`Interface direction changed to ${isRTL ? 'RTL' : 'LTR'}`);
      } catch (error) {
        await clearRecordedLocaleDirection().catch(() => {});
        logger.recoverable('[I18n] Layout direction will update on the next app launch', {
          errorCode: error?.code || error?.name || 'RTL_RELOAD_FAILED',
          locale
        });
      }
    };
    applyDirection().catch((error) => {
      logger.recoverable('[I18n] Could not prepare the interface direction change', {
        errorCode: error?.code || error?.name || 'RTL_PREPARATION_FAILED',
        locale
      });
    });
    return () => {
      active = false;
    };
  }, [isHydrated, isRTL, locale, prepareLocalizedReminder]);

  const t = useCallback(
    (key, options) => translateForLocale(locale, key, options),
    [locale]
  );

  const setLanguage = useCallback(async (language) => {
    const valid = language === SYSTEM_LANGUAGE || supportedLanguages.includes(language);
    if (!valid) throw new Error(`Unsupported interface language: ${language}`);
    const targetLocale = resolveLanguage(language, locales);
    const coordinator = localeTransitionRef.current;
    const transition = coordinator.begin(targetLocale);
    let completion = { status: 'ready' };

    try {
      // Begin the transition gate before publishing settings. The direction
      // effect can render immediately after this resolves, but it cannot reload
      // until this exact generation completes its reminder work below.
      await updateSettings({ language });
      if (!coordinator.isCurrent(transition)) return;
      completion = await prepareLocalizedReminder(targetLocale, {
        enabled: settings.reminderEnabled,
        isCurrent: () => coordinator.isCurrent(transition)
      });
    } catch (error) {
      completion = { status: 'cancelled' };
      throw error;
    } finally {
      coordinator.complete(transition, completion);
    }
  }, [locales, prepareLocalizedReminder, settings.reminderEnabled, updateSettings]);

  const value = useMemo(() => ({
    languageOptions,
    languagePreference,
    locale,
    isRTL,
    setLanguage,
    t
  }), [isRTL, languagePreference, locale, setLanguage, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
