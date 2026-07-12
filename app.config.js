const languageCatalog = require('./src/i18n/languages.js');
const supportedLocales = languageCatalog
  .filter((language) => language.messages)
  .map((language) => language.code);
const nativeLocales = Object.fromEntries(
  languageCatalog
    .filter((language) => language.messages?.native)
    .map((language) => [language.code, language.messages.native])
);

const config = {
  "name": "VeryLoving",
  "slug": "veryloving-react-native",
  "version": "1.0.0",
  "orientation": "portrait",
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
    "bundleIdentifier": "com.veryloving.app",
    "buildNumber": "1",
    "infoPlist": {
      "NSMicrophoneUsageDescription": "VeryLoving needs access to your microphone for safety calls",
      "NSLocationWhenInUseUsageDescription": "VeryLoving needs your location to show the map and provide safety features",
      "NSLocationAlwaysAndWhenInUseUsageDescription": "VeryLoving uses your location to alert loved ones when you arrive safely",
      "NSCameraUsageDescription": "VeryLoving needs your camera to take a profile photo.",
      "NSPhotoLibraryUsageDescription": "VeryLoving needs access to your photo library to choose a profile picture.",
      "NSLocationAlwaysUsageDescription": "VeryLoving uses your location in the background to alert loved ones when you arrive safely and to detect nearby danger zones.",
      "NSBluetoothAlwaysUsageDescription": "VeryLoving needs Bluetooth to connect to your safety bracelet",
      "NSBluetoothPeripheralUsageDescription": "VeryLoving needs Bluetooth to connect to your safety bracelet",
      "UIBackgroundModes": [
        "audio",
        "bluetooth-central"
      ],
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
    "permissions": [
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.FOREGROUND_SERVICE_MICROPHONE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.CAMERA"
    ],
    "predictiveBackGestureEnabled": false
  },
  "plugins": [
    "expo-router",
    "expo-asset",
    "expo-location",
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
    [
      "expo-image-picker",
      {
        "photosPermission": "Allow VeryLoving to access photos you choose for your profile or safety sharing.",
        "cameraPermission": "Allow VeryLoving to use the camera when you choose to take a profile or safety photo.",
        "microphonePermission": "Allow VeryLoving to use the microphone for safety and AI companion calls.",
        "colors": {
          "cropToolbarColor": "#FFF8EF",
          "cropToolbarIconColor": "#304557",
          "cropToolbarActionTextColor": "#304557",
          "cropBackgroundColor": "#FFF8EF"
        }
      }
    ],
    [
      "@react-native-google-signin/google-signin",
      {
        "iosUrlScheme": "com.googleusercontent.apps.1043648527972-bt18er3aemtofhhod81c2m2aabc40v3d"
      }
    ],
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

module.exports = () => {
  const mapboxAccessToken = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN || '';
  const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || '';
  const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '';
  const humeWSProxyURL = process.env.EXPO_PUBLIC_HUME_WS_PROXY_URL || '';
  const humeConfigId = process.env.EXPO_PUBLIC_HUME_CONFIG_ID || '';
  const humeCustomizationURL = process.env.EXPO_PUBLIC_HUME_CUSTOMIZATION_URL || apiBaseUrl;
  const humeBrandedVoiceId = process.env.EXPO_PUBLIC_HUME_BRANDED_VOICE_ID || '';
  const humeCLMEnabled = process.env.EXPO_PUBLIC_HUME_CLM_ENABLED === 'true';
  const enableOfflineMode = process.env.EXPO_PUBLIC_ENABLE_OFFLINE_MODE === 'true';

  return {
    ...config,
    extra: {
      ...config.extra,
      apiBaseUrl,
      googleWebClientId,
      humeWSProxyURL,
      humeConfigId,
      humeCustomizationURL,
      humeBrandedVoiceId,
      humeCLMEnabled,
      mapboxAccessToken,
      enableOfflineMode
    }
  };
};
