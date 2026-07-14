'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const createAppConfig = require('../app.config');
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
  const phoneIntent = manifest.manifest.queries[0].intent.find((intent) => (
    intent.action?.some((action) => action.$['android:name'] === 'android.intent.action.VIEW')
    && intent.data?.some((data) => data.$['android:scheme'] === 'tel')
  ));
  assert.ok(phoneIntent, 'Android package visibility must allow tel: capability checks');
});

test('Expo config owns the privacy manifest and local CNG plugins', () => {
  const config = require('../app.config')();
  const plugins = config.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);

  assert.equal(config.ios.privacyManifests.NSPrivacyTracking, false);
  assert.equal(config.ios.usesAppleSignIn, true);
  assert.equal(config.extra.appleClientId, config.ios.bundleIdentifier);
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
  assert.equal(
    plugins.get('expo-location').locationWhenInUsePermission,
    'VeryLoving needs your location to show the map and provide safety features'
  );
  assert.equal(plugins.get('expo-location').locationAlwaysAndWhenInUsePermission, false);
  assert.equal(plugins.get('expo-location').locationAlwaysPermission, false);
  assert.equal(plugins.get('expo-location').motionUsagePermission, false);
  assert.equal(plugins.get('expo-location').isIosBackgroundLocationEnabled, false);
  assert.equal(plugins.get('expo-location').isAndroidBackgroundLocationEnabled, false);
  assert.equal(plugins.get('expo-location').isAndroidForegroundServiceEnabled, false);
  assert.equal(plugins.get('expo-location').isAndroidMotionActivityEnabled, false);
  assert.equal(
    Object.hasOwn(config.ios.infoPlist, 'NSLocationAlwaysAndWhenInUseUsageDescription'),
    false
  );
  assert.equal(Object.hasOwn(config.ios.infoPlist, 'NSLocationAlwaysUsageDescription'), false);
  assert.equal(plugins.get('expo-status-bar').style, 'dark');
  assert.equal(plugins.get('expo-splash-screen').backgroundColor, '#FFF8EF');
  assert.equal(plugins.get('expo-image-picker').cameraPermission.includes('VeryLoving'), true);
});

test('Expo environment diagnostics are production-aware and never contain configuration values', () => {
  const diagnostics = createAppConfig.createEnvironmentDiagnostics({
    VERYLOVING_BUILD_PROFILE: 'production',
    EAS_BUILD: 'true',
    EXPO_PUBLIC_API_BASE_URL: 'https://api.redaction-check.invalid',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '123-redaction-check.apps.googleusercontent.com',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-ios-redaction-check.apps.googleusercontent.com',
    EXPO_PUBLIC_HUME_WS_PROXY_URL: 'wss://voice.redaction-check.invalid/socket',
    EXPO_PUBLIC_HUME_CUSTOMIZATION_URL: 'https://voice.redaction-check.invalid',
    EXPO_PUBLIC_HUME_CONFIG_ID: '123e4567-e89b-42d3-a456-426614174000',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'true',
    EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'true',
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    EXPO_PUBLIC_VL01_ENABLED: 'true',
    EXPO_PUBLIC_VL01_SERVICE_UUID: 'fff0',
    EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID: 'fff1',
    EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID: 'fff2',
    EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID: 'fff3',
    EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID: 'fff4',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.redaction-check-runtime',
    RNMAPBOX_MAPS_DOWNLOAD_TOKEN: 'sk.redaction-check-download'
  });

  assert.equal(diagnostics.buildProfile, 'production');
  assert.equal(diagnostics.context, 'eas-build');
  assert.deepEqual(diagnostics.missingRequired, []);
  assert.deepEqual(diagnostics.invalid, []);
  assert.equal(diagnostics.configured.mapboxDownloadToken, true);
  assert.equal(JSON.stringify(diagnostics).includes('redaction-check'), false);
});

test('Expo environment diagnostics identify unsafe production configuration without throwing', () => {
  const diagnostics = createAppConfig.createEnvironmentDiagnostics({
    VERYLOVING_BUILD_PROFILE: 'production',
    EXPO_PUBLIC_API_BASE_URL: 'http://api.example.test',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'not-a-google-client',
    EXPO_PUBLIC_HUME_WS_PROXY_URL: 'ws://voice.example.test',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'true',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'sk.should-not-be-public',
    EXPO_PUBLIC_HUME_API_KEY: 'must-not-ship'
  });

  assert.ok(diagnostics.missingRequired.includes('humeConfigId'));
  assert.ok(diagnostics.invalid.includes('api_base_url_must_use_https'));
  assert.ok(diagnostics.invalid.includes('hume_websocket_proxy_must_use_wss'));
  assert.ok(diagnostics.invalid.includes('mapbox_runtime_token_looks_secret'));
  assert.ok(diagnostics.warnings.includes('public_hume_api_key_must_not_be_set_for_production'));
});

test('remote production builds fail closed on missing or unsafe configuration', () => {
  const missing = createAppConfig.createEnvironmentDiagnostics({
    VERYLOVING_BUILD_PROFILE: 'production',
    EAS_BUILD: 'true'
  });
  assert.throws(
    () => createAppConfig.assertEnvironmentReady(missing),
    /Production configuration is invalid/
  );

  const safeEnvironment = {
    VERYLOVING_BUILD_PROFILE: 'production',
    EAS_BUILD: 'true',
    EXPO_PUBLIC_API_BASE_URL: 'https://api.example.invalid',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: '123-web.apps.googleusercontent.com',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: '123-ios.apps.googleusercontent.com',
    EXPO_PUBLIC_HUME_WS_PROXY_URL: 'wss://voice.example.invalid/socket',
    EXPO_PUBLIC_HUME_CUSTOMIZATION_URL: 'https://voice.example.invalid',
    EXPO_PUBLIC_HUME_CONFIG_ID: '123e4567-e89b-42d3-a456-426614174000',
    EXPO_PUBLIC_HUME_CLM_ENABLED: 'true',
    EXPO_PUBLIC_SAFETY_BACKEND_ENABLED: 'true',
    EXPO_PUBLIC_PHONE_AUTH_ENABLED: 'true',
    EXPO_PUBLIC_VL01_ENABLED: 'true',
    EXPO_PUBLIC_VL01_SERVICE_UUID: 'fff0',
    EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID: 'fff1',
    EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID: 'fff2',
    EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID: 'fff3',
    EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID: 'fff4',
    EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN: 'pk.runtime',
    RNMAPBOX_MAPS_DOWNLOAD_TOKEN: 'sk.download'
  };
  const safe = createAppConfig.createEnvironmentDiagnostics(safeEnvironment);
  assert.doesNotThrow(() => createAppConfig.assertEnvironmentReady(safe));

  const invalidHumeIdentifiers = createAppConfig.createEnvironmentDiagnostics({
    ...safeEnvironment,
    EXPO_PUBLIC_HUME_CONFIG_ID: 'not-a-uuid',
    EXPO_PUBLIC_HUME_BRANDED_VOICE_ID: 'also-not-a-uuid'
  });
  assert.ok(invalidHumeIdentifiers.invalid.includes('hume_config_id_invalid'));
  assert.ok(invalidHumeIdentifiers.invalid.includes('hume_branded_voice_id_invalid'));
  assert.throws(
    () => createAppConfig.assertEnvironmentReady(invalidHumeIdentifiers),
    /Production configuration is invalid/
  );
});

test('Google iOS client IDs produce the native reversed URL scheme', () => {
  assert.equal(
    createAppConfig.reversedGoogleClientId('123-example.apps.googleusercontent.com'),
    'com.googleusercontent.apps.123-example'
  );
  assert.equal(createAppConfig.reversedGoogleClientId(''), '');
});

test('Google native plugin is omitted until a real iOS callback ID is configured', () => {
  const previous = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  try {
    const resolved = createAppConfig();
    const plugins = resolved.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);
    assert.equal(plugins.includes('@react-native-google-signin/google-signin'), false);
    assert.equal(JSON.stringify(resolved).includes('unconfigured'), false);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = previous;
  }
});

test('EAS profiles separate simulator, internal QA, and store artifacts with explicit environments', () => {
  const eas = JSON.parse(fs.readFileSync('eas.json', 'utf8'));

  assert.equal(eas.cli.version, '>= 20.0.0');
  assert.equal(eas.cli.appVersionSource, 'remote');
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.distribution, 'internal');
  assert.equal(eas.build.development.environment, 'development');
  assert.equal(eas.build.development.ios, undefined);
  assert.equal(eas.build['development-simulator'].extends, 'development');
  assert.equal(eas.build['development-simulator'].ios.simulator, true);
  assert.equal(eas.build.preview.environment, 'preview');
  assert.equal(eas.build.preview.android.buildType, 'apk');
  assert.equal(eas.build.production.environment, 'production');
  assert.equal(eas.build.production.distribution, 'store');
  assert.equal(eas.build.production.autoIncrement, true);
});
