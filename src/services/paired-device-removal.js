export async function forgetPairedDevice(
  device,
  { clearRememberedDevice, disconnectNativeDevice }
) {
  const deviceId = typeof device?.id === 'string' && device.id.trim()
    ? device.id.trim()
    : null;

  // Clearing the remembered association is authoritative. A transient native
  // disconnect failure must not silently restore auto-reconnect metadata.
  await clearRememberedDevice();

  if (!deviceId) {
    return { removed: true, nativeDisconnected: true, disconnectError: null };
  }

  try {
    await disconnectNativeDevice(deviceId);
    return { removed: true, nativeDisconnected: true, disconnectError: null };
  } catch (disconnectError) {
    return { removed: true, nativeDisconnected: false, disconnectError };
  }
}
