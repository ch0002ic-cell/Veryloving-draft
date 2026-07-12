'use strict';

const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

const LEGACY_BLUETOOTH_PERMISSIONS = new Set([
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN'
]);
const BLUETOOTH_LE_FEATURE = 'android.hardware.bluetooth_le';
const DEBUG_OVERLAY_PERMISSION = 'android.permission.SYSTEM_ALERT_WINDOW';

function normalizeVeryLovingAndroidManifest(androidManifest) {
  const permissions = (androidManifest.manifest['uses-permission'] || []).filter(
    (permission) => permission.$?.['android:name'] !== DEBUG_OVERLAY_PERMISSION
  );
  for (const permission of permissions) {
    const name = permission.$?.['android:name'];
    if (LEGACY_BLUETOOTH_PERMISSIONS.has(name)) {
      permission.$['android:maxSdkVersion'] = '30';
    }
    if (name === 'android.permission.BLUETOOTH_SCAN') {
      AndroidConfig.Manifest.ensureToolsAvailable(androidManifest);
      permission.$['android:usesPermissionFlags'] = 'neverForLocation';
      permission.$['tools:targetApi'] = '31';
    }
  }
  androidManifest.manifest['uses-permission'] = permissions;

  const features = androidManifest.manifest['uses-feature'] || [];
  let bluetoothFeature = features.find(
    (feature) => feature.$?.['android:name'] === BLUETOOTH_LE_FEATURE
  );
  if (!bluetoothFeature) {
    bluetoothFeature = { $: { 'android:name': BLUETOOTH_LE_FEATURE } };
    features.push(bluetoothFeature);
  }
  bluetoothFeature.$['android:required'] = 'false';
  androidManifest.manifest['uses-feature'] = features;

  return androidManifest;
}

function withVeryLovingAndroidManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    manifestConfig.modResults = normalizeVeryLovingAndroidManifest(manifestConfig.modResults);
    return manifestConfig;
  });
}

module.exports = withVeryLovingAndroidManifest;
module.exports.normalizeVeryLovingAndroidManifest = normalizeVeryLovingAndroidManifest;
