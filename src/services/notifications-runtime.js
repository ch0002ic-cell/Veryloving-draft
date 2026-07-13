const FOREGROUND_NOTIFICATION_HANDLER = {
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
};

export function createNotificationsRuntime({
  isExpoGo,
  loadNotifications,
  onExpoGoSkip = () => {}
}) {
  let modulePromise = null;
  let skipLogged = false;

  const getModule = async () => {
    if (isExpoGo()) {
      if (!skipLogged) {
        skipLogged = true;
        onExpoGoSkip();
      }
      return null;
    }
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

  return { getModule };
}
