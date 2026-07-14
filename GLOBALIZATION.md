# Globalization

VeryLoving stores phone numbers in canonical E.164 form and keeps interface language separate from AI companion language.

## Supported interface languages

The language registry represents all 183 assigned ISO 639-1 codes. Of those, 155 have complete catalogs and appear in the searchable Settings picker, including Arabic, German, Hindi, Italian, Japanese, Korean, Portuguese, and Russian. Regional tags resolve to their base catalog, such as `es-MX` to `es` and `zh-Hans-CN` to `zh`. Unsupported device languages fall back to English.

English, Spanish, French, and Simplified Chinese are maintained catalogs. The other 151 selectable catalogs are machine-generated starting points and are marked `reviewRequired` in `src/i18n/language-registry.js`; safety, emergency, consent, and permission wording must receive native-speaker review before a localized store release. Complete keys and passing automated checks do not certify linguistic accuracy.

The following 28 assigned codes remain registered but intentionally unavailable because the translation providers used for this pass do not support them: `an`, `ae`, `bi`, `cu`, `kw`, `cr`, `hz`, `ho`, `io`, `ia`, `ie`, `ik`, `ki`, `kj`, `lu`, `na`, `nv`, `nd`, `ng`, `nn`, `oj`, `pi`, `rm`, `sc`, `vo`, `wa`, `ii`, and `za`. When a device uses one of these languages, the app explicitly selects its English interface instead of labeling English copy as that language.

Users can choose a catalog in Settings or leave the preference on System default. The preference is persisted with the rest of the app settings and survives relaunches.

## Translation accuracy gate

Runtime per-string fallback is disabled. Every selectable catalog must contain every key, so a missing safety string cannot be silently replaced with English. An unsupported device locale resolves to an explicitly English interface; it is not treated as a translated catalog.

Do not copy English text into a non-English catalog to satisfy coverage. New or changed safety, emergency, consent, authentication, permission, map, or voice copy must be translated and reviewed for every locale intended for that release. A locale marked `reviewRequired` is not launch-certified, regardless of whether its automated checks pass; clear that flag only after a recorded native-speaker review.

## Right-to-left layouts

Arabic, Divehi, Persian, Hebrew, Kashmiri, Sorani Kurdish, Pashto, Sindhi, Uyghur, Urdu, and Yiddish enable right-to-left layout. Native builds persist the direction through `I18nManager` and reload once when switching between LTR and RTL; web applies the matching root `dir`. Logical layout properties and React Native's left/right swapping handle normal mirroring.

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
2. Find the ISO entry in `src/i18n/language-registry.js`, attach `messages: require('./locales/<code>.json')`, and set an honest translation status and review flag.
3. Run `npm test`. Coverage fails on a missing, extra, empty, or placeholder-damaged value and when catalog files drift from registry metadata.
4. Arrange native-speaker and safety-copy review, then clear `reviewRequired` only when that review is recorded.

`app.config.js` derives native `supportedLocales` and localized permission strings from the same language catalog, so the next CNG prebuild automatically updates iOS and Android resources. JSON comments are invalid, so machine-review status lives in registry metadata instead of being mixed into user-facing strings.

The Hume/CLM response language is intentionally independent. A later AI-language preference can reuse the resolved locale without changing the UI catalog architecture.
