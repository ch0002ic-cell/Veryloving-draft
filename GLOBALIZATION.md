# Globalization

VeryLoving stores phone numbers in canonical E.164 form and keeps interface language separate from AI companion language.

## Supported interface languages

The language registry represents all 183 assigned ISO 639-1 codes, and 155 catalog files remain structurally complete translation work products. Runtime availability is quality-gated:

- public production builds expose reviewed English (`en`), Spanish (`es`), French (`fr`), and Simplified Chinese (`zh`);
- the dedicated TestFlight QA profile additionally exposes Arabic (`ar`) and Hebrew (`he`) when `EXPO_PUBLIC_ENABLE_RTL_QA_LOCALES=true`;
- the other 149 catalog work products are not selectable in preview, TestFlight, or production until their `reviewRequired` status is cleared after recorded native-speaker and safety-copy review;
- developers can temporarily expose all 155 complete catalogs with `EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true`, but only in a development runtime and a native config explicitly built with `VERYLOVING_BUILD_PROFILE=development`.

Regional tags resolve to an available base catalog, such as `es-MX` to `es` and `zh-Hans-CN` to `zh`. Traditional Chinese requests (`zh-Hant`, `zh-TW`, `zh-HK`, and `zh-MO`) deliberately resolve to English rather than being mislabeled as the maintained Simplified Chinese catalog. Unsupported device languages also resolve to an explicitly English interface.

Arabic and Hebrew remain TestFlight-only QA locales. Complete keys and passing automated checks do not certify linguistic accuracy, so neither may enter the public production profile before native-speaker approval of safety, emergency, consent, authentication, permissions, map, voice, and reminder copy.

The following 28 assigned codes remain registered but intentionally unavailable because the translation providers used for this pass do not support them: `an`, `ae`, `bi`, `cu`, `kw`, `cr`, `hz`, `ho`, `io`, `ia`, `ie`, `ik`, `ki`, `kj`, `lu`, `na`, `nv`, `nd`, `ng`, `nn`, `oj`, `pi`, `rm`, `sc`, `vo`, `wa`, `ii`, and `za`. When a device uses one of these languages, the app explicitly selects its English interface instead of labeling English copy as that language.

Users can choose an available catalog in Settings or leave the preference on System default. The normalized preference is persisted before context publishes the change, updates same-direction strings across mounted screens immediately, survives process relaunches, and reschedules enabled Capybear notification copy in the selected language. A direction change creates a transition generation before publication and waits for bounded target-locale reminder scheduling/cleanup before reloading; stale generations cannot overwrite the latest schedule. If native cleanup is uncertain, automatic reload is deferred rather than risking an old-language reminder or a reload loop. Language is the only setting deliberately retained across sign-out or account switching because it is a device-level interface preference.

## Translation accuracy gate

Runtime per-string fallback is disabled. Every available catalog must contain every key, so a missing safety string cannot be silently replaced with English. A six-locale release-critical overlay keeps auth, location/map/share, SOS, BLE, voice, and Saved Places errors complete for the production plus TestFlight QA set. Raw native/provider errors are mapped to stable translation keys at render boundaries.

Do not copy English text into a non-English catalog to satisfy coverage. New or changed safety, emergency, consent, authentication, permission, map, voice, privacy, or notification copy must be translated and reviewed for every locale intended for that release. A locale marked `reviewRequired` is not launch-certified, regardless of whether its automated checks pass; clear that flag only after a recorded native-speaker review.

### Development catalog audit mode

To inspect the retained catalogs without weakening release behavior, start a development client with:

```bash
VERYLOVING_BUILD_PROFILE=development \
EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true \
npx expo start --dev-client
```

Use the same two variables with `npx expo run:ios` or a development EAS build when native `supportedLocales` and permission strings also need to be regenerated. The picker then contains **System default plus 155 catalogs**. The runtime guard ignores this flag when `__DEV__` is false; app config also ignores it unless the build profile is explicitly `development`. The environment validator rejects it in preview and production, while committed preview, TestFlight, and production profiles pin it to `false`.

This is translation-audit evidence only. The additional catalogs are machine-generated and unreviewed, and the newer `releaseCritical` overlay exists only for `en/es/fr/zh/ar/he`. Critical flows in an audit-only locale can therefore surface missing-key diagnostics until that locale receives complete translated critical copy and review. Do not use full-catalog mode for stakeholder acceptance, TestFlight evidence, or a store artifact.

## Right-to-left layouts

The registry identifies Arabic, Divehi, Persian, Hebrew, Kashmiri, Sorani Kurdish, Pashto, Sindhi, Uyghur, Urdu, and Yiddish as RTL, but only Arabic and Hebrew can currently enter the signed TestFlight QA runtime. Native builds apply `I18nManager`, left/right swapping, and one process reload when crossing between LTR and RTL; web applies the matching root `dir`. The selected locale and enabled target-locale reminder state are made durable before a safe reload, so the new process hydrates into the requested direction.

RTL is not certified by unit tests. For every TestFlight build number, follow [How to Test the Language Switcher on TestFlight](./TESTFLIGHT_LANGUAGE_SWITCHER.md): verify Arabic and Hebrew on a clean install and upgrade, kill/relaunch after both direction changes, inspect every screen/modal/map annotation, and test Dynamic Type, VoiceOver, keyboard entry, phone numbers, mixed-direction text, rotation, iPhone SE-class width, current Pro-class iPhone, and iPad split view. Native-speaker signoff remains required.

## Phone numbers

`src/utils/phone.js` owns country metadata, formatting, validation, and E.164 conversion through `libphonenumber-js`. `GlobalPhoneInput` provides the searchable picker and emits this shape:

```js
{
  countryCode: 'ES',
  callingCode: '34',
  formatted: '612 34 56 78',
  e164: '+34612345678',
  isValid: true
}
```

Persist or send `e164`, never `formatted`. The auth profile and emergency-contact records also retain `countryCode` so an editor can restore the correct national format.

## Adding a language

1. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json` and translate every value without changing its keys or `%{placeholder}` tokens, including the `native` permission descriptions.
2. Find the ISO entry in `src/i18n/language-registry.js`, attach `messages: require('./locales/<code>.json')`, and set an honest translation status and review flag. A locale becomes generally available only when `reviewRequired` is `false`; Arabic/Hebrew QA exposure is the narrow temporary exception.
3. Run `npm test`. Coverage fails on a missing, extra, empty, or placeholder-damaged value and when catalog files drift from registry metadata.
4. Arrange native-speaker and safety-copy review, then clear `reviewRequired` only when that review is recorded.

`app.config.js` derives native `supportedLocales` and localized permission strings from the same quality-gated language selection used at runtime, so a CNG prebuild cannot advertise an unavailable language. The TestFlight profile injects only the explicit Arabic/Hebrew QA flag and pins the development-only full-catalog flag to `false`. JSON comments are invalid, so review status lives in registry metadata instead of being mixed into user-facing strings.

The Hume/CLM response language is intentionally independent. A later AI-language preference can reuse the resolved locale without changing the UI catalog architecture.
