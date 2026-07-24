export function hasUsableMapboxAccessToken(token) {
  return typeof token === 'string' && token.trim().length > 0;
}

export function configureMapboxModule(Mapbox, accessToken, { onFailure = () => {} } = {}) {
  const fail = (errorCode) => {
    try { onFailure(errorCode); } catch {}
    return null;
  };
  try {
    if (
      !Mapbox
      || typeof Mapbox.setAccessToken !== 'function'
      || !hasUsableMapboxAccessToken(accessToken)
    ) {
      return fail('MAPBOX_NATIVE_MODULE_INVALID');
    }
    const result = Mapbox.setAccessToken(accessToken.trim());
    // The reviewed native API is synchronous. Treat an unexpected thenable as
    // an incompatible binary and attach a rejection handler so it cannot
    // become an unhandled promise rejection in a development build.
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      return fail('MAPBOX_NATIVE_MODULE_INVALID');
    }
    return Mapbox;
  } catch (error) {
    return fail(error?.code || error?.name || 'MAPBOX_NATIVE_CONFIGURATION_FAILED');
  }
}
