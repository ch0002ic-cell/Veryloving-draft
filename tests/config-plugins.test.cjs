'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mergeVeryLovingEntitlements } = require('../plugins/withEntitlements');
const { normalizeVeryLovingAndroidManifest } = require('../plugins/withAndroidManifest');
const {
  applyVeryLovingGradleProperties,
  upsertGradleProperty
} = require('../plugins/withGradleProperties');
const { applyPodfileCustomizations } = require('../plugins/withPodfile');

const PODFILE_FIXTURE = `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'

prepare_react_native_project!

target 'VeryLoving' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

test('Podfile customizations are complete and idempotent', () => {
  const once = applyPodfileCustomizations(PODFILE_FIXTURE);
  const twice = applyPodfileCustomizations(once);

  assert.equal(twice, once);
  assert.equal((once.match(/^use_modular_headers!$/gm) || []).length, 1);
  assert.equal((once.match(/target\.name == 'EXAV'/g) || []).length, 1);
  assert.ok(once.indexOf("target.name == 'EXAV'") > once.indexOf('react_native_post_install('));
  assert.match(once, /@generated begin veryloving-modular-headers/);
  assert.match(once, /@generated begin veryloving-exav-post-install/);
});

test('entitlement merge preserves signing values and adds Apple Sign-In', () => {
  const merged = mergeVeryLovingEntitlements({
    'aps-environment': 'production',
    'com.apple.developer.applesignin': ['Existing'],
    'com.apple.developer.associated-domains': ['applinks:veryloving.ai']
  });

  assert.equal(merged['aps-environment'], 'production');
  assert.deepEqual(merged['com.apple.developer.applesignin'], ['Existing', 'Default']);
  assert.deepEqual(
    merged['com.apple.developer.associated-domains'],
    ['applinks:veryloving.ai']
  );
});

test('entitlement merge supplies local prebuild defaults', () => {
  assert.deepEqual(mergeVeryLovingEntitlements(), {
    'aps-environment': 'development',
    'com.apple.developer.applesignin': ['Default']
  });
});

test('Gradle property customization updates existing entries without duplication', () => {
  const properties = [
    { type: 'comment', value: 'Android properties' },
    { type: 'property', key: 'android.enableJetifier', value: 'false' }
  ];

  upsertGradleProperty(properties, 'android.enableJetifier', 'true');
  upsertGradleProperty(properties, 'newArchEnabled', 'true');
  applyVeryLovingGradleProperties(properties);

  assert.equal(properties.filter((item) => item.key === 'android.enableJetifier').length, 1);
  assert.equal(properties.find((item) => item.key === 'android.enableJetifier').value, 'true');
  assert.equal(properties.find((item) => item.key === 'newArchEnabled').value, 'true');
  assert.equal(
    properties.find((item) => item.key === 'org.gradle.jvmargs').value,
    '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'
  );
});

test('Android manifest normalization keeps BLE optional and location-neutral', () => {
  const manifest = normalizeVeryLovingAndroidManifest({
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      'uses-permission': [
        { $: { 'android:name': 'android.permission.BLUETOOTH' } },
        { $: { 'android:name': 'android.permission.BLUETOOTH_ADMIN' } },
        { $: { 'android:name': 'android.permission.BLUETOOTH_SCAN' } },
        { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' } }
      ]
    }
  });

  const permissions = manifest.manifest['uses-permission'];
  assert.equal(permissions[0].$['android:maxSdkVersion'], '30');
  assert.equal(permissions[1].$['android:maxSdkVersion'], '30');
  assert.equal(permissions[2].$['android:usesPermissionFlags'], 'neverForLocation');
  assert.equal(permissions[2].$['tools:targetApi'], '31');
  assert.equal(
    permissions.some(
      (permission) => permission.$['android:name'] === 'android.permission.SYSTEM_ALERT_WINDOW'
    ),
    false
  );
  assert.equal(
    manifest.manifest['uses-feature'][0].$['android:name'],
    'android.hardware.bluetooth_le'
  );
  assert.equal(manifest.manifest['uses-feature'][0].$['android:required'], 'false');
});

test('Expo config owns the privacy manifest and local CNG plugins', () => {
  const config = require('../app.config')();
  const plugins = config.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);

  assert.equal(config.ios.privacyManifests.NSPrivacyTracking, false);
  assert.equal(config.ios.privacyManifests.NSPrivacyCollectedDataTypes.length, 13);
  assert.ok(plugins.includes('./plugins/withPodfile.js'));
  assert.ok(plugins.includes('./plugins/withEntitlements.js'));
  assert.ok(plugins.includes('./plugins/withGradleProperties.js'));
  assert.ok(plugins.includes('./plugins/withAndroidManifest.js'));
});

test('Expo config owns Android permissions, keyboard behavior, and launch appearance', () => {
  const config = require('../app.config')();
  const plugins = new Map(config.plugins.map((plugin) => Array.isArray(plugin)
    ? [plugin[0], plugin[1]]
    : [plugin, undefined]));
  const permissions = new Set(config.android.permissions);

  assert.equal(config.android.allowBackup, false);
  assert.equal(config.android.softwareKeyboardLayoutMode, 'resize');
  assert.equal(config.android.adaptiveIcon.monochromeImage, './assets/images/misc/StarIcon.png');
  for (const permission of [
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.RECORD_AUDIO',
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.CAMERA'
  ]) {
    assert.ok(permissions.has(permission), `${permission} must be declared`);
  }
  assert.equal(permissions.has('android.permission.BLUETOOTH_ADVERTISE'), false);
  assert.equal(plugins.get('react-native-ble-plx').neverForLocation, true);
  assert.equal(plugins.get('react-native-ble-plx').isBackgroundEnabled, false);
  assert.equal(plugins.get('expo-status-bar').style, 'dark');
  assert.equal(plugins.get('expo-splash-screen').backgroundColor, '#FFF8EF');
  assert.equal(plugins.get('expo-image-picker').cameraPermission.includes('VeryLoving'), true);
});
