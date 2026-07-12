export const androidBluetoothPermissions = {
  connect: 'android.permission.BLUETOOTH_CONNECT',
  fineLocation: 'android.permission.ACCESS_FINE_LOCATION',
  scan: 'android.permission.BLUETOOTH_SCAN'
};

export function getAndroidBluetoothPermissions(apiLevel) {
  const level = Number(apiLevel);
  if (Number.isFinite(level) && level < 31) {
    return [androidBluetoothPermissions.fineLocation];
  }
  return [
    androidBluetoothPermissions.scan,
    androidBluetoothPermissions.connect
  ];
}

export function hasGrantedAndroidBluetoothPermissions(
  results,
  permissions,
  grantedValue = 'granted'
) {
  return permissions.every((permission) => results?.[permission] === grantedValue);
}
