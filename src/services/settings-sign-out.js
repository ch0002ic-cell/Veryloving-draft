export async function performSettingsSignOut({
  establishSessionBarrier,
  sweepLocalData
} = {}) {
  if (typeof establishSessionBarrier !== 'function') {
    throw new TypeError('A durable sign-out operation is required.');
  }
  if (typeof sweepLocalData !== 'function') {
    throw new TypeError('A local data sweep is required.');
  }

  // This is the security boundary: cleanup is best-effort only after the
  // signed-out tombstone or secure-session deletion has been established.
  await establishSessionBarrier();

  try {
    return {
      cleanupFailed: false,
      cleanupResult: await sweepLocalData()
    };
  } catch {
    return {
      cleanupFailed: true,
      cleanupResult: null
    };
  }
}
