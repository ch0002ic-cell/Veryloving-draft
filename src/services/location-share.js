import { translateForLocale } from '../i18n/core';

export class LocationShareUnavailableError extends Error {
  constructor(code = 'LOCATION_SHARE_FAILED') {
    super('We could not share your location. Check location access and try again.');
    this.name = 'LocationShareUnavailableError';
    this.code = code;
  }
}

function finiteCoordinate(value, limit) {
  if (value === null || value === undefined || value === '') return null;
  const coordinate = Number(value);
  if (!Number.isFinite(coordinate) || Math.abs(coordinate) > limit) return null;
  return coordinate;
}

function recordedAt(location) {
  const timestamp = Number(location?.timestamp ?? location?.cachedAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildLocationShareContent(location, { locale = 'en' } = {}) {
  const latitude = finiteCoordinate(location?.coords?.latitude, 90);
  const longitude = finiteCoordinate(location?.coords?.longitude, 180);
  if (latitude === null || longitude === null) {
    throw new LocationShareUnavailableError('LOCATION_MISSING');
  }

  const capturedAt = recordedAt(location);
  const mapsURL = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  const sourceCopy = capturedAt
    ? translateForLocale(
      locale,
      location?.isCached
        ? 'releaseCritical.locationShareCached'
        : 'releaseCritical.locationShareCurrent',
      { capturedAt }
    )
    : null;
  const snapshotNotice = translateForLocale(locale, 'quickShare.subtitle');

  return {
    title: `${translateForLocale(locale, 'common.veryLoving')} — ${translateForLocale(locale, 'quickShare.title')}`,
    message: [sourceCopy, mapsURL, '', snapshotNotice].filter((line) => line !== null).join('\n')
  };
}

export async function shareLocationSnapshot(location, shareImpl, options = {}) {
  if (!shareImpl?.share) {
    throw new LocationShareUnavailableError('SHARE_SHEET_UNAVAILABLE');
  }

  const content = buildLocationShareContent(location, options);
  try {
    return await shareImpl.share(content);
  } catch {
    throw new LocationShareUnavailableError();
  }
}
