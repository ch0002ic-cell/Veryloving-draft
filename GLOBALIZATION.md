# Globalization

VeryLoving stores phone numbers in canonical E.164 form and keeps interface language separate from AI companion language.

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

1. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json` and translate every value without changing its keys, including the `native` permission descriptions.
2. Add one entry to `src/i18n/languages.js` with the code, native name, language-label translation key, and `messages: require('./locales/<code>.json')`.
3. Add that language-label key to every locale JSON file.
4. Run `npm test`. The globalization test fails when locale key sets differ.

`app.config.js` derives native `supportedLocales` from the same language catalog, so the next CNG prebuild automatically updates iOS and Android. Runtime fallback uses the base of a regional BCP 47 tag, such as `es-MX` to `es`, then falls back to English.

The Hume/CLM response language is intentionally independent. A later AI-language preference can reuse the resolved locale without changing the UI catalog architecture.
