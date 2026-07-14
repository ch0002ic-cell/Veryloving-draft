const FOREGROUND_NOTIFICATION_HANDLER = {
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
};

export const NOTIFICATIONS_UNAVAILABLE = Object.freeze({
  EXPO_GO: 'expo-go',
  IOS_SIMULATOR: 'ios-simulator',
  IOS_APNS_ENTITLEMENT: 'ios-apns-entitlement-unavailable'
});

function normalizeApplicationModule(applicationModule) {
  if (typeof applicationModule?.getIosApplicationReleaseTypeAsync === 'function') {
    return applicationModule;
  }
  if (typeof applicationModule?.default?.getIosApplicationReleaseTypeAsync === 'function') {
    return applicationModule.default;
  }
  const error = new Error('The native application metadata module is unavailable in this build.');
  error.code = 'APPLICATION_METADATA_MODULE_INVALID';
  throw error;
}

/**
 * Resolve entitlement support before the native notification package is evaluated. The iOS
 * package reads Keychain-backed registration state at module initialization,
 * so catching an error after importing it is too late for unsupported hosts.
 */
export async function detectNotificationsUnavailableReason({
  isExpoGo,
  platformOS,
  loadApplication
}) {
  if (isExpoGo()) return NOTIFICATIONS_UNAVAILABLE.EXPO_GO;
  if (platformOS !== 'ios') return null;

  const Application = normalizeApplicationModule(await loadApplication());
  const releaseType = await Application.getIosApplicationReleaseTypeAsync();
  if (releaseType === Application.ApplicationReleaseType?.SIMULATOR) {
    return NOTIFICATIONS_UNAVAILABLE.IOS_SIMULATOR;
  }

  const pushEnvironment = await Application.getIosPushNotificationServiceEnvironmentAsync();
  const appStoreRelease = Application.ApplicationReleaseType?.APP_STORE;
  if (
    pushEnvironment !== 'development'
    && pushEnvironment !== 'production'
    // App Store/TestFlight installations may not retain an embedded mobile
    // provisioning profile for expo-application to inspect. Their native
    // notification module must retain its normal production behavior.
    && releaseType !== appStoreRelease
  ) {
    return NOTIFICATIONS_UNAVAILABLE.IOS_APNS_ENTITLEMENT;
  }
  return null;
}

export function createNotificationsRuntime({
  getUnavailableReason,
  loadNotifications,
  onUnavailable = () => {}
}) {
  let availabilityPromise = null;
  let modulePromise = null;
  let skipLogged = false;

  const unavailableReason = () => {
    if (!availabilityPromise) {
      const attempt = Promise.resolve().then(getUnavailableReason);
      availabilityPromise = attempt;
      attempt.catch(() => {
        // A rebuilt development client can retry a stale native preflight.
        if (availabilityPromise === attempt) availabilityPromise = null;
      });
    }
    return availabilityPromise;
  };

  const isAvailable = async () => {
    const reason = await unavailableReason();
    if (reason && !skipLogged) {
      skipLogged = true;
      onUnavailable(reason);
    }
    return !reason;
  };

  const getModule = async () => {
    if (!await isAvailable()) return null;
    if (!modulePromise) {
      modulePromise = Promise.resolve()
        .then(loadNotifications)
        .then((notifications) => {
          notifications.setNotificationHandler(FOREGROUND_NOTIFICATION_HANDLER);
          return notifications;
        })
        .catch((error) => {
          // A stale development client can be rebuilt and retried without
          // leaving this process permanently bound to a rejected promise.
          modulePromise = null;
          throw error;
        });
    }
    return modulePromise;
  };

  return { getModule, isAvailable };
}
