export function accountSettingsAreHydrated({
  accountId,
  authLoading,
  localStateHydrated,
  settingsAccountId
}) {
  return !authLoading
    && localStateHydrated
    && settingsAccountId === accountId;
}

export function pairedDeviceNeedsHydration({
  accountId,
  hydratedAccountId,
  requestedAccountId
}) {
  return Boolean(accountId)
    && (requestedAccountId !== accountId || hydratedAccountId !== accountId);
}
