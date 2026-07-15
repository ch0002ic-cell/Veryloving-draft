# Globalization

VeryLoving stores phone numbers in canonical E.164 form and keeps interface language separate from AI companion language.

## Supported interface languages

The language registry represents all 183 assigned ISO 639-1 codes. There are 155 JSON catalogs, each with the same 353 non-empty keys and placeholder structure as English: 319 established interface keys plus 34 `releaseCritical` safety/authentication keys. Runtime availability is quality-gated:

- public production builds expose reviewed English (`en`), Spanish (`es`), French (`fr`), and Simplified Chinese (`zh`);
- the base `testflight` profile additionally exposes Arabic (`ar`) and Hebrew (`he`) for signed RTL QA, for six selectable catalogs in total;
- the dedicated signed `testflight-full-catalog` profile exposes all 155 catalogs for layout, search, persistence, and RTL coverage without changing code;
- developers can also expose all 155 catalogs with `EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true` and `VERYLOVING_BUILD_PROFILE=development`;
- preview, the base TestFlight profile, and public production remain restricted; only development metadata and the named `testflight-full-catalog` metadata may enable the catalog-audit policy.

Regional tags resolve to an available base catalog, such as `es-MX` to `es` and `zh-Hans-CN` to `zh`. Traditional Chinese requests (`zh-Hant`, `zh-TW`, `zh-HK`, and `zh-MO`) deliberately resolve to English rather than being mislabeled as the maintained Simplified Chinese catalog. Unsupported device languages also resolve to an explicitly English interface.

Arabic and Hebrew remain TestFlight-only QA locales. Complete keys and passing automated checks do not certify linguistic accuracy, so neither may enter the public production profile before native-speaker approval of safety, emergency, consent, authentication, permissions, map, voice, and reminder copy.

The following 28 assigned codes remain registered but intentionally unavailable because the translation providers used for this pass do not support them: `an`, `ae`, `bi`, `cu`, `kw`, `cr`, `hz`, `ho`, `io`, `ia`, `ie`, `ik`, `ki`, `kj`, `lu`, `na`, `nv`, `nd`, `ng`, `nn`, `oj`, `pi`, `rm`, `sc`, `vo`, `wa`, `ii`, and `za`. When a device uses one of these languages, the app explicitly selects its English interface instead of labeling English copy as that language.

Users can choose an available catalog in Settings or leave the preference on System default. The normalized preference is persisted before context publishes the change, updates same-direction strings across mounted screens immediately, survives process relaunches, and reschedules enabled Capybear notification copy in the selected language. A direction change creates a transition generation before publication and waits for bounded target-locale reminder scheduling/cleanup before reloading; stale generations cannot overwrite the latest schedule. If native cleanup is uncertain, automatic reload is deferred rather than risking an old-language reminder or a reload loop. Language is the only setting deliberately retained across sign-out or account switching because it is a device-level interface preference.

## Translation accuracy gate

General runtime per-string fallback is disabled. The pre-existing `releaseCritical` translations for `en/es/fr/zh/ar/he` were preserved unchanged. On 15 July 2026, Codex `gpt-5.6-sol` generated the 34-key `releaseCritical` blocks for the other 149 catalogs as a machine-translated first pass. Every catalog now embeds all 353 keys, and runtime critical copy comes from the selected catalog rather than an English overlay fallback.

Structural completeness is not linguistic or safety approval. All 149 newly generated blocks remain explicitly machine-generated and require native-speaker safety review before public release. Generation provenance and pending review status are recorded separately in `src/i18n/translation-review.json` because JSON catalog comments are invalid. Automated coverage verifies key presence, non-empty values, and placeholder parity; it cannot establish accuracy, cultural suitability, emergency clarity, or legal acceptance. Raw native/provider errors are still mapped to stable translation keys at render boundaries.

Do not copy English text into a non-English catalog to satisfy coverage. New or changed safety, emergency, consent, authentication, permission, map, voice, privacy, or notification copy must be translated and reviewed for every locale intended for that release. A locale marked `reviewRequired` is not launch-certified, regardless of whether its automated checks pass; clear that flag only after a recorded native-speaker review.

### Full-catalog QA mode

To inspect the retained catalogs without weakening release behavior, start a development client with:

```bash
VERYLOVING_BUILD_PROFILE=development \
EXPO_PUBLIC_SHOW_ALL_LANGUAGES=true \
npx expo start --dev-client
```

Use the same variables with `npx expo run:ios` or the development EAS profile when native `supportedLocales` and permission strings also need to be regenerated. The picker contains **System default plus 155 catalogs**.

For the same audit in a signed physical-device/TestFlight runtime, build the named profile instead of editing source or `.env`:

```bash
eas build --platform ios --profile testflight-full-catalog
```

`testflight-full-catalog` is still production-like for credentials, secure transports, entitlements, and readiness validation; its only language-policy expansion is the explicit full-catalog metadata. The base `testflight` profile keeps `EXPO_PUBLIC_SHOW_ALL_LANGUAGES=false` and exposes only `en/es/fr/zh/ar/he`. Public `production` keeps the flag false and exposes only `en/es/fr/zh`.

The full-catalog artifact is layout/coverage audit evidence only. The 149 newly added `releaseCritical` blocks are machine-generated and unreviewed; any `QA` picker/trigger indicator denotes outstanding human review, not an English fallback. The artifact can establish structural key coverage, but it cannot establish native-speaker approval, stakeholder language acceptance, or public-release readiness.

## Right-to-left layouts

The registry identifies Arabic, Divehi, Persian, Hebrew, Kashmiri, Sorani Kurdish, Pashto, Sindhi, Uyghur, Urdu, and Yiddish as RTL. The base TestFlight profile exposes Arabic and Hebrew; `testflight-full-catalog` exposes all 11 for signed layout auditing. Native builds apply `I18nManager`, left/right swapping, and one process reload when crossing between LTR and RTL; web applies the matching root `dir`. The selected locale and enabled target-locale reminder state are made durable before a safe reload, so the new process hydrates into the requested direction.

RTL is not certified by unit tests. For every base TestFlight build number, follow [How to Test the Language Switcher on TestFlight](./TESTFLIGHT_LANGUAGE_SWITCHER.md): verify Arabic and Hebrew on a clean install and upgrade, kill/relaunch after both direction changes, inspect every screen/modal/map annotation, and test Dynamic Type, VoiceOver, keyboard entry, phone numbers, mixed-direction text, rotation, iPhone SE-class width, current Pro-class iPhone, and iPad split view. For a full-catalog build, repeat the direction matrix with representative additional RTL catalogs and verify the selected language's `QA` badge again after returning to Settings. Native-speaker signoff remains required for linguistic approval.

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

`app.config.js` derives native `supportedLocales` and localized permission strings from the same profile-aware language selection used at runtime, so a CNG prebuild cannot advertise an unavailable language. The base TestFlight profile injects only the Arabic/Hebrew QA flag; `testflight-full-catalog` carries the explicit signed-audit metadata; production remains restricted to reviewed catalogs. JSON comments are invalid, so review status lives in registry metadata instead of being mixed into user-facing strings.

The Hume/CLM response language is intentionally independent. A later AI-language preference can reuse the resolved locale without changing the UI catalog architecture.
