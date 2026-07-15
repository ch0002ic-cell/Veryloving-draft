import { storage } from './storage';

export const LOCALE_DIRECTION_KEY = 'veryloving.localeDirection.v1';
export const LTR_DIRECTION = 'ltr';
export const RTL_DIRECTION = 'rtl';

export function localeDirection(isRTL) {
  return isRTL ? RTL_DIRECTION : LTR_DIRECTION;
}

export function normalizeLocaleDirection(value) {
  return value === LTR_DIRECTION || value === RTL_DIRECTION ? value : null;
}

/**
 * React Native snapshots I18nManager.isRTL when the bridge starts. An Expo
 * development-client reload can retain that stale snapshot even though
 * forceRTL has already updated the native preference. The persisted direction
 * is therefore authoritative after this app has requested a native change.
 */
export function shouldReloadForLocaleDirection({
  desiredDirection,
  nativeIsRTL,
  recordedDirection
}) {
  const desired = normalizeLocaleDirection(desiredDirection);
  if (!desired) throw new TypeError('A valid locale direction is required.');
  const recorded = normalizeLocaleDirection(recordedDirection);
  if (recorded) return recorded !== desired;
  return localeDirection(nativeIsRTL) !== desired;
}

export async function loadRecordedLocaleDirection() {
  return normalizeLocaleDirection(await storage.getJSON(LOCALE_DIRECTION_KEY, null));
}

export async function persistRecordedLocaleDirection(direction) {
  const normalized = normalizeLocaleDirection(direction);
  if (!normalized) throw new TypeError('A valid locale direction is required.');
  await storage.setJSON(LOCALE_DIRECTION_KEY, normalized);
  return normalized;
}

export function clearRecordedLocaleDirection() {
  return storage.remove(LOCALE_DIRECTION_KEY);
}
