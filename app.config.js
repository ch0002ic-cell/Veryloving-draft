const { URL } = require('node:url');
const languageCatalog = require('./src/i18n/languages.js');
const RTL_QA_LANGUAGE_CODES = new Set(['ar', 'he']);

function selectSupportedLocales(env = process.env) {
  const enableRTLQA = env.EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES === 'true';
  return languageCatalog
    .filter((language) => language.messages && (
      language.reviewRequired === false
      || (enableRTLQA && RTL_QA_LANGUAGE_CODES.has(language.code))
    ))
    .map((language) => language.code);
}

const supportedLocales = selectSupportedLocales();
const nativeLocales = Object.fromEntries(
  languageCatalog
    .filter((language) => supportedLocales.includes(language.code) && language.messages?.native)
    .map((language) => [language.code, language.messages.native])
);

function hasConfiguredValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return Boolean(normalized)
    && !/^<[^>]+>$/.test(normalized)
    && !/^(?:replace|your)[-_]/i.test(normalized);
}

function reversedGoogleClientId(clientId) {
  if (!hasConfiguredValue(clientId)) return '';
  return clientId.trim().split('.').reverse().join('.');
}

const CANONICAL_HUME_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLE_UUID_PATTERN = /^(?:[0-9a-f]{4}|[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function endpointIssue(value, expectedProtocol) {
  try {
    const url = new URL(value);
    if (url.protocol !== expectedProtocol) return 'transport';
    if (url.username || url.password) return 'embedded_credentials';
    const sensitiveQuery = [...url.searchParams.keys()].some((key) => /token|secret|password|api[_-]?key/i.test(key));
    if (sensitiveQuery) return 'credential_query';
    return null;
  } catch {
    return 'invalid_url';
  }
}

function createEnvironmentDiagnostics(env = {}) {
  const requestedProfile = env.VERYLOVING_BUILD_PROFILE || env.EAS_BUILD_PROFILE;
  const buildProfile = hasConfiguredValue(requestedProfile)
    ? requestedProfile.trim()
    : 'local';
  const easBuild = env.EAS_BUILD === 'true' || env.EAS_BUILD === '1';
  const production = buildProfile === 'production';
  const humeCLMEnabled = env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true';
  const offlineModeEnabled = env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true';
  const vl01Enabled = env.EXPO_PUBLIC_VL01_ENABLED === 'true';
  const safetyBackendEnabled = env.EXPO_PUBLIC_SAFETY_BACKEND_ENABLED === 'true';
  const phoneAuthEnabled = env.EXPO_PUBLIC_PHONE_AUTH_ENABLED === 'true';
  const apiBaseUrl = env.EXPO_PUBLIC_API_BASE_URL || '';
  const humeCustomizationURL = env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || apiBaseUrl;
  const humeWSProxyURL = env.EXPO_PUBLIC_HUME_WS_PROXY_URL || '';
  const mapboxAccessToken = env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
  const googleWebClientId = env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
  const googleIOSClientId = env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';

  const configured = {
    apiBaseUrl: hasConfiguredValue(apiBaseUrl),
    googleWebClientId: hasConfiguredValue(googleWebClientId),
    googleIOSClientId: hasConfiguredValue(googleIOSClientId),
    humeWebSocketProxy: hasConfiguredValue(humeWSProxyURL),
    humeCustomizationUrl: hasConfiguredValue(humeCustomizationURL),
    humeConfigId: hasConfiguredValue(env.EXPO_PUBLIC_HUME_CONFIG_ID || ''),
    humeBrandedVoiceId: hasConfiguredValue(env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || ''),
    mapboxRuntimeToken: hasConfiguredValue(mapboxAccessToken),
    mapboxDownloadToken: hasConfiguredValue(env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN || ''),
    vl01ServiceUUID: hasConfiguredValue(env.EXPO_PUBLIC_VL01_SERVICE_UUID || ''),
    vl01BatteryCharacteristicUUID: hasConfiguredValue(env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || ''),
    vl01StatusCharacteristicUUID: hasConfiguredValue(env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID || ''),
    vl01EventCharacteristicUUID: hasConfiguredValue(env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID || ''),
    vl01CommandCharacteristicUUID: hasConfiguredValue(env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID || '')
  };

  const required = new Set();
  if (production) {
    required.add('apiBaseUrl');
    required.add('googleWebClientId');
    required.add('googleIOSClientId');
    required.add('humeWebSocketProxy');
    required.add('mapboxRuntimeToken');
    // Secret EAS variables are not visible during the local config-resolution
    // phase. Require the native download token only on the remote builder where
    // its presence can be checked without printing it.
    if (easBuild) required.add('mapboxDownloadToken');
  }
  if (humeCLMEnabled) {
    required.add('humeWebSocketProxy');
    required.add('humeCustomizationUrl');
    required.add('humeConfigId');
  }
  if (vl01Enabled) {
    required.add('vl01ServiceUUID');
    required.add('vl01BatteryCharacteristicUUID');
    if (production) {
      // Shipping builds must be tied to the complete, firmware-approved
      // registry. Omitting event or command channels would silently reduce a
      // safety wearable to a battery beacon.
      required.add('vl01StatusCharacteristicUUID');
      required.add('vl01EventCharacteristicUUID');
      required.add('vl01CommandCharacteristicUUID');
    }
  }
  const invalid = [];
  if (production && !safetyBackendEnabled) invalid.push('safety_backend_must_be_enabled');
  if (production && !phoneAuthEnabled) invalid.push('phone_auth_must_be_enabled');
  if (production && !humeCLMEnabled) invalid.push('hume_clm_must_be_enabled');
  if (production && !vl01Enabled) invalid.push('vl01_protocol_must_be_enabled');
  if (production && offlineModeEnabled) invalid.push('offline_mode_must_be_disabled');
  if (production && hasConfiguredValue(env.EXPO_PUBLIC_HUME_API_KEY || '')) {
    invalid.push('public_hume_api_key_must_not_be_set');
  }
  for (const [name, value] of [
    ['hume_config_id', env.EXPO_PUBLIC_HUME_CONFIG_ID],
    ['hume_branded_voice_id', env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID]
  ]) {
    if (hasConfiguredValue(value || '') && !CANONICAL_HUME_UUID_PATTERN.test(value.trim())) {
      invalid.push(`${name}_invalid`);
    }
  }
  for (const [name, value] of [
    ['vl01_service_uuid', env.EXPO_PUBLIC_VL01_SERVICE_UUID],
    ['vl01_battery_characteristic_uuid', env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID],
    ['vl01_status_characteristic_uuid', env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID],
    ['vl01_event_characteristic_uuid', env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID],
    ['vl01_command_characteristic_uuid', env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID]
  ]) {
    if (hasConfiguredValue(value || '') && !BLE_UUID_PATTERN.test(value.trim())) invalid.push(`${name}_invalid`);
  }
  if (production && configured.apiBaseUrl) {
    const issue = endpointIssue(apiBaseUrl, 'https:');
    if (issue) invalid.push(issue === 'transport' ? 'api_base_url_must_use_https' : `api_base_url_${issue}`);
  }
  if (production && configured.humeWebSocketProxy) {
    const issue = endpointIssue(humeWSProxyURL, 'wss:');
    if (issue) invalid.push(issue === 'transport' ? 'hume_websocket_proxy_must_use_wss' : `hume_websocket_proxy_${issue}`);
  }
  if (production && configured.humeCustomizationUrl) {
    const issue = endpointIssue(humeCustomizationURL, 'https:');
    if (issue) invalid.push(issue === 'transport' ? 'hume_customization_url_must_use_https' : `hume_customization_url_${issue}`);
  }
  if (production && configured.googleWebClientId && !googleWebClientId.trim().endsWith('.apps.googleusercontent.com')) {
    invalid.push('google_web_client_id_has_unexpected_format');
  }
  if (production && configured.googleIOSClientId && !googleIOSClientId.trim().endsWith('.apps.googleusercontent.com')) {
    invalid.push('google_ios_client_id_has_unexpected_format');
  }
  if (production && configured.mapboxRuntimeToken && mapboxAccessToken.trim().startsWith('sk.')) {
    invalid.push('mapbox_runtime_token_looks_secret');
  }

  const warnings = [];
  if (production && !easBuild && !configured.mapboxDownloadToken) {
    warnings.push('mapbox_download_token_not_verifiable_during_local_config_resolution');
  }

  return {
    buildProfile,
    context: easBuild ? 'eas-build' : 'local',
    production,
    configured,
    missingRequired: [...required].filter((key) => !configured[key]),
    invalid,
    warnings,
    flags: {
      humeCLMEnabled,
      offlineModeEnabled,
      vl01Enabled,
      safetyBackendEnabled,
      phoneAuthEnabled
    }
  };
}

function assertEnvironmentReady(diagnostics) {
  if (!diagnostics.production || diagnostics.context !== 'eas-build') return;
  const blockers = [...diagnostics.missingRequired.map((key) => `missing_${key}`), ...diagnostics.invalid];
  if (blockers.length) {
    throw new Error(`[VeryLoving config] Production configuration is invalid: ${blockers.join(', ')}`);
  }
}

function reportEnvironmentDiagnostics(diagnostics, env = {}) {
  if (env.VERYLOVING_CONFIG_DIAGNOSTICS !== '1' && env.VERYLOVING_CONFIG_DIAGNOSTICS !== 'true') return;
  const hasProblems = diagnostics.missingRequired.length
    || diagnostics.invalid.length
    || diagnostics.warnings.length;
  const report = JSON.stringify(diagnostics);
  if (hasProblems) console.warn(`[VeryLoving config] ${report}`);
  else console.info(`[VeryLoving config] ${report}`);
}

const config = {
  "name": "VeryLoving",
  "slug": "veryloving-react-native",
  "version": "1.0.0",
  // TestFlight is the release-candidate runtime, including iPad split-screen
  // and rotation. Keep native orientation handling responsive on every device.
  "orientation": "default",
  "icon": "./assets/icon.png",
  "userInterfaceStyle": "light",
  "backgroundColor": "#FFF8EF",
  "primaryColor": "#304557",
  "locales": nativeLocales,
  "assetBundlePatterns": [
    "**/*"
  ],
  "ios": {
    "supportsTablet": true,
    "requireFullScreen": false,
    "usesAppleSignIn": true,
    "bundleIdentifier": "com.veryloving.app",
    "buildNumber": "1",
    "infoPlist": {
      "NSMicrophoneUsageDescription": "VeryLoving needs access to your microphone for safety calls",
      "NSLocationWhenInUseUsageDescription": "VeryLoving needs your location to show the map and provide safety features",
      "NSBluetoothAlwaysUsageDescription": "VeryLoving needs Bluetooth to connect to your safety bracelet",
      "ITSAppUsesNonExemptEncryption": false
    },
    "privacyManifests": {
      "NSPrivacyAccessedAPITypes": [
        {
          "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp",
          "NSPrivacyAccessedAPITypeReasons": [
            "C617.1"
          ]
        },
        {
          "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
          "NSPrivacyAccessedAPITypeReasons": [
            "CA92.1",
            "C56D.1"
          ]
        },
        {
          "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime",
          "NSPrivacyAccessedAPITypeReasons": [
            "35F9.1"
          ]
        }
      ],
      "NSPrivacyCollectedDataTypes": [
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeName",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeEmailAddress",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePhoneNumber",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeUserID",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeDeviceID",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            "NSPrivacyCollectedDataTypePurposeAnalytics"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePreciseLocation",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            "NSPrivacyCollectedDataTypePurposeAnalytics"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeCoarseLocation",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            "NSPrivacyCollectedDataTypePurposeAnalytics"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeAudioData",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherUserContent",
          "NSPrivacyCollectedDataTypeLinked": true,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            "NSPrivacyCollectedDataTypePurposeProductPersonalization"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeProductInteraction",
          "NSPrivacyCollectedDataTypeLinked": false,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAnalytics",
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypePerformanceData",
          "NSPrivacyCollectedDataTypeLinked": false,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAnalytics",
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeCrashData",
          "NSPrivacyCollectedDataTypeLinked": false,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAnalytics",
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        },
        {
          "NSPrivacyCollectedDataType": "NSPrivacyCollectedDataTypeOtherDiagnosticData",
          "NSPrivacyCollectedDataTypeLinked": false,
          "NSPrivacyCollectedDataTypeTracking": false,
          "NSPrivacyCollectedDataTypePurposes": [
            "NSPrivacyCollectedDataTypePurposeAnalytics",
            "NSPrivacyCollectedDataTypePurposeAppFunctionality"
          ]
        }
      ],
      "NSPrivacyTracking": false
    }
  },
  "android": {
    "adaptiveIcon": {
      "foregroundImage": "./assets/adaptive-icon.png",
      "backgroundColor": "#FFF8EF",
      "monochromeImage": "./assets/images/misc/StarIcon.png"
    },
    "package": "com.veryloving.app",
    "versionCode": 3,
    "allowBackup": false,
    "softwareKeyboardLayoutMode": "resize",
    // FileSystem is used only with app-private cache paths. Its legacy package
    // manifest still advertises broad storage access on older Android devices.
    "blockedPermissions": [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE"
    ],
    "permissions": [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.POST_NOTIFICATIONS"
    ],
    "predictiveBackGestureEnabled": false
  },
  "plugins": [
    "expo-router",
    "expo-asset",
    [
      "expo-location",
      {
        "locationWhenInUsePermission": "VeryLoving needs your location to show the map and provide safety features",
        "locationAlwaysAndWhenInUsePermission": false,
        "locationAlwaysPermission": false,
        "motionUsagePermission": false,
        "isIosBackgroundLocationEnabled": false,
        "isAndroidBackgroundLocationEnabled": false,
        "isAndroidForegroundServiceEnabled": false,
        "isAndroidMotionActivityEnabled": false
      }
    ],
    "expo-apple-authentication",
    [
      "expo-status-bar",
      {
        "style": "dark"
      }
    ],
    [
      "expo-splash-screen",
      {
        "backgroundColor": "#FFF8EF",
        "image": "./assets/icon.png",
        "imageWidth": 180,
        "resizeMode": "contain"
      }
    ],
    "@react-native-google-signin/google-signin",
    "./plugins/withGradleProperties.js",
    "@rnmapbox/maps",
    [
      "expo-audio",
      {
        "microphonePermission": "Allow VeryLoving to access your microphone for AI safety companion calls.",
        "enableBackgroundPlayback": true,
        "enableBackgroundRecording": true
      }
    ],
    [
      "react-native-ble-plx",
      {
        "isBackgroundEnabled": false,
        "modes": [
          "central"
        ],
        "neverForLocation": true,
        "bluetoothAlwaysPermission": "VeryLoving needs Bluetooth to connect to your safety bracelet"
      }
    ],
    [
      "expo-notifications",
      {
        "icon": "./assets/images/misc/StarIcon.png",
        "color": "#304557"
      }
    ],
    "expo-sharing",
    [
      "expo-localization",
      {
        "supportedLocales": {
          "ios": supportedLocales,
          "android": supportedLocales
        }
      }
    ],
    "./plugins/withPodfile.js",
    "./plugins/withEntitlements.js",
    "./plugins/withAndroidManifest.js"
  ],
  "scheme": "veryloving",
  "web": {
    "favicon": "./assets/icon.png",
    "bundler": "metro",
    "output": "static",
    "template": "./web/index.html"
  },
  "experiments": {
    "tsconfigPaths": true
  },
  "extra": {
    "releaseChannel": "production",
    "supportsRTL": true,
    "router": {},
    "eas": {
      "projectId": "e723f2d7-d6bb-4a31-83c4-07e832cf7242"
    }
  },
  "owner": "verylovingai",
  "platforms": [
    "ios",
    "android",
    "web"
  ]
};

function createAppConfig() {
  const mapboxAccessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || '';
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
  const googleIOSClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  const humeWSProxyURL = process.env.EXPO_PUBLIC_HUME_WS_PROXY_URL || '';
  const humeConfigId = process.env.EXPO_PUBLIC_HUME_CONFIG_ID || '';
  const humeCustomizationURL = process.env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || apiBaseUrl;
  const humeBrandedVoiceId = process.env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || '';
  const humeCLMEnabled = process.env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true';
  const enableOfflineMode = process.env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true';
  const safetyBackendEnabled = process.env.EXPO_PUBLIC_SAFETY_BACKEND_ENABLED === 'true';
  const phoneAuthEnabled = process.env.EXPO_PUBLIC_PHONE_AUTH_ENABLED === 'true';
  const vl01Enabled = process.env.EXPO_PUBLIC_VL01_ENABLED === 'true';
  const vl01ServiceUUID = process.env.EXPO_PUBLIC_VL01_SERVICE_UUID || '';
  const vl01BatteryCharacteristicUUID = process.env.EXPO_PUBLIC_VL01_BATTERY_CHARACTERISTIC_UUID || '';
  const vl01StatusCharacteristicUUID = process.env.EXPO_PUBLIC_VL01_STATUS_CHARACTERISTIC_UUID || '';
  const vl01EventCharacteristicUUID = process.env.EXPO_PUBLIC_VL01_EVENT_CHARACTERISTIC_UUID || '';
  const vl01CommandCharacteristicUUID = process.env.EXPO_PUBLIC_VL01_COMMAND_CHARACTERISTIC_UUID || '';
  const environmentDiagnostics = createEnvironmentDiagnostics(process.env);
  reportEnvironmentDiagnostics(environmentDiagnostics, process.env);
  assertEnvironmentReady(environmentDiagnostics);

  const googleIOSUrlScheme = reversedGoogleClientId(googleIOSClientId);
  const plugins = config.plugins.flatMap((plugin) => {
    const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
    if (pluginName !== '@react-native-google-signin/google-signin') return [plugin];
    if (!googleIOSUrlScheme) return [];
    return [[pluginName, {
      ...(Array.isArray(plugin) ? plugin[1] : {}),
      iosUrlScheme: googleIOSUrlScheme
    }]];
  });

  return {
    ...config,
    plugins,
    extra: {
      ...config.extra,
      apiBaseUrl,
      // Native Apple identity tokens use the bundle identifier as their
      // audience. This is public application metadata, not a secret.
      appleClientId: config.ios.bundleIdentifier,
      googleWebClientId,
      googleIOSClientId,
      humeWSProxyURL,
      humeConfigId,
      humeCustomizationURL,
      humeBrandedVoiceId,
      humeCLMEnabled,
      mapboxAccessToken,
      enableOfflineMode,
      safetyBackendEnabled,
      phoneAuthEnabled,
      vl01Enabled,
      vl01ServiceUUID,
      vl01BatteryCharacteristicUUID,
      vl01StatusCharacteristicUUID,
      vl01EventCharacteristicUUID,
      vl01CommandCharacteristicUUID,
      environmentDiagnostics
    }
  };
}

module.exports = createAppConfig;
module.exports.createEnvironmentDiagnostics = createEnvironmentDiagnostics;
module.exports.assertEnvironmentReady = assertEnvironmentReady;
module.exports.reversedGoogleClientId = reversedGoogleClientId;
module.exports.selectSupportedLocales = selectSupportedLocales;
