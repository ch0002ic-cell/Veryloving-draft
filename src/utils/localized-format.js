'use strict';

import { nativeLocaleTagForLanguage } from '../i18n/core';

function normalizedLocale(locale) {
  return nativeLocaleTagForLanguage(locale)
    || (typeof locale === 'string' && locale.trim() ? locale : 'en');
}

export function formatLocalizedNumber(value, locale, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  try {
    return new Intl.NumberFormat(normalizedLocale(locale), options).format(value);
  } catch {
    return new Intl.NumberFormat('en', options).format(value);
  }
}

export function formatLocalizedPercent(value, locale, options = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return formatLocalizedNumber(value / 100, locale, {
    style: 'percent',
    maximumFractionDigits: 0,
    ...options
  });
}

export function formatLocalizedDateTime(value, locale) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return date.toLocaleString(normalizedLocale(locale));
  } catch {
    return date.toLocaleString('en');
  }
}
