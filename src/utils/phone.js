import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength
} from 'libphonenumber-js';

export const DEFAULT_COUNTRY = 'US';
export const countryCodes = getCountries();
const countryCodeSet = new Set(countryCodes);
const countryOptionCache = new Map();

export function normalizeCountryCode(countryCode) {
  const normalized = String(countryCode || '').toUpperCase();
  return countryCodeSet.has(normalized) ? normalized : DEFAULT_COUNTRY;
}

export function getDefaultCountry(locales = []) {
  for (const locale of locales || []) {
    const region = String(locale?.regionCode || '').toUpperCase();
    if (countryCodeSet.has(region)) return region;
  }
  return DEFAULT_COUNTRY;
}

export function countryCodeToFlag(countryCode) {
  return normalizeCountryCode(countryCode)
    .split('')
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join('');
}

function validationCodeFor(input, countryCode, phoneNumber) {
  if (!String(input || '').trim()) return 'required';
  let lengthResult;
  try {
    lengthResult = validatePhoneNumberLength(input, countryCode);
  } catch {
    return 'invalid';
  }
  if (lengthResult === 'TOO_SHORT') return 'tooShort';
  if (lengthResult === 'TOO_LONG') return 'tooLong';
  if (lengthResult) return 'invalid';
  return phoneNumber?.isValid() ? null : 'invalid';
}

export function createPhoneValue(input = '', selectedCountry = DEFAULT_COUNTRY) {
  const initialCountry = normalizeCountryCode(selectedCountry);
  const rawInput = String(input || '').trim();
  const international = rawInput.startsWith('+');
  const formatter = new AsYouType(international ? undefined : initialCountry);
  let formatted = '';

  try {
    formatted = formatter.input(rawInput);
  } catch {
    formatted = rawInput;
  }

  const phoneNumber = formatter.getNumber();
  const countryCode = normalizeCountryCode(phoneNumber?.country || initialCountry);
  if (international && phoneNumber?.country) formatted = phoneNumber.formatNational();
  const validationInput = international ? rawInput : formatted;
  const validationError = validationCodeFor(validationInput, countryCode, phoneNumber);
  const isValid = validationError === null;

  return {
    countryCode,
    callingCode: getCountryCallingCode(countryCode),
    formatted,
    e164: isValid ? phoneNumber.number : '',
    candidateE164: phoneNumber?.number || '',
    isPossible: Boolean(phoneNumber?.isPossible()),
    isValid,
    validationError
  };
}

export function phoneValueFromE164(e164, fallbackCountry = DEFAULT_COUNTRY) {
  const parsed = parsePhoneNumberFromString(String(e164 || ''));
  if (!parsed) return createPhoneValue('', fallbackCountry);
  return createPhoneValue(parsed.number, parsed.country || fallbackCountry);
}

export function changePhoneCountry(phoneValue, nextCountry) {
  const countryCode = normalizeCountryCode(nextCountry);
  const parsed = parsePhoneNumberFromString(phoneValue?.candidateE164 || phoneValue?.e164 || '');
  const nationalInput = parsed?.nationalNumber || phoneValue?.formatted || '';
  return createPhoneValue(nationalInput, countryCode);
}

export function formatE164ForDisplay(e164) {
  const parsed = parsePhoneNumberFromString(String(e164 || ''));
  return parsed?.formatInternational() || String(e164 || '');
}

export function getCountryOptions(locale = 'en') {
  const normalizedLocale = String(locale || 'en');
  if (countryOptionCache.has(normalizedLocale)) return countryOptionCache.get(normalizedLocale);

  let displayNames;
  try {
    displayNames = new Intl.DisplayNames([normalizedLocale], { type: 'region' });
  } catch {
    displayNames = null;
  }
  const collator = new Intl.Collator(normalizedLocale, { sensitivity: 'base' });
  const options = countryCodes.map((countryCode) => ({
    callingCode: getCountryCallingCode(countryCode),
    code: countryCode,
    flag: countryCodeToFlag(countryCode),
    name: displayNames?.of(countryCode) || countryCode
  })).sort((left, right) => collator.compare(left.name, right.name));
  countryOptionCache.set(normalizedLocale, options);
  return options;
}

function searchable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function filterCountryOptions(options, query) {
  const search = searchable(query).replace(/^\+/, '');
  if (!search) return options;
  return options.filter((country) => [
    country.name,
    country.code,
    country.callingCode
  ].some((value) => searchable(value).includes(search)));
}
