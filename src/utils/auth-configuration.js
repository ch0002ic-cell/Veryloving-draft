export const AUTH_MESSAGES = Object.freeze({
  appleConfiguration: 'Apple Sign-In requires a valid client ID and backend URL.',
  appleDevelopmentBuild: 'Apple Sign-In requires a VeryLoving development build.',
  appleUnavailable: 'Apple Sign-In is not available on this device.',
  googleConfiguration: 'Google Sign-In is not configured – please set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.',
  googleBackend: 'Google Sign-In requires a valid backend URL.',
  googleDevelopmentBuild: 'Google Sign-In requires a VeryLoving development build.',
  googleUnavailable: 'Google Sign-In is not available on this platform.',
  phoneConfiguration: 'Phone verification requires a backend SMS service.',
  phonePlatform: 'Phone verification is available in the iOS and Android apps.',
  phoneInvalidNumber: 'Enter a valid international phone number.',
  phoneInvalidCode: 'The verification code is invalid or expired.',
  phoneUnavailable: 'Phone verification is temporarily unavailable. Please try again.',
  tooManyAttempts: 'Too many sign-in attempts. Please wait before trying again.',
  network: 'Unable to reach the sign-in service. Check your internet connection and try again.',
  timeout: 'Sign-in verification timed out. Please try again.',
  appleFailed: 'Apple Sign-In failed. Check your internet connection and try again.',
  googleFailed: 'Google Sign-In failed. Check your internet connection and try again.',
  phoneFailed: 'Phone verification could not be completed. Please try again.'
});

export function createSimulatorAuthenticationError(provider, { demoAvailable = false } = {}) {
  const normalizedProvider = provider === 'apple' ? 'apple' : 'google';
  const providerName = normalizedProvider === 'apple' ? 'Apple' : 'Google';
  const nextStep = demoAvailable
    ? 'Open VeryLoving on a physical iPhone, or use “Continue as demo (development only)” below.'
    : 'Open VeryLoving on a physical iPhone and try again.';
  return createAuthError(
    `${providerName.toUpperCase()}_AUTH_SIMULATOR_UNAVAILABLE`,
    `${providerName} Sign-In is unavailable in this iOS Simulator build. ${nextStep}`
  );
}

function hasConfiguredValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return Boolean(normalized)
    && !/^<[^>]+>$/.test(normalized)
    && !/^(?:replace|your|unconfigured)[-_.]/i.test(normalized);
}

function capability(enabled, code, message = null) {
  return Object.freeze({ enabled, code: enabled ? null : code, message: enabled ? null : message });
}

export function authenticationCapabilities(
  runtimeConfig,
  { platform, expoGo = false } = {}
) {
  const backendConfigured = hasConfiguredValue(runtimeConfig?.apiBaseUrl);
  const appleClientConfigured = hasConfiguredValue(runtimeConfig?.appleClientId);
  const googleWebConfigured = hasConfiguredValue(runtimeConfig?.googleWebClientId);
  const googleIOSConfigured = hasConfiguredValue(runtimeConfig?.googleIOSClientId);

  let apple;
  if (platform !== 'ios') {
    apple = capability(false, 'APPLE_AUTH_UNAVAILABLE', AUTH_MESSAGES.appleUnavailable);
  } else if (!backendConfigured || !appleClientConfigured) {
    apple = capability(false, 'APPLE_AUTH_CONFIGURATION_MISSING', AUTH_MESSAGES.appleConfiguration);
  } else if (expoGo) {
    apple = capability(false, 'APPLE_AUTH_REQUIRES_DEVELOPMENT_BUILD', AUTH_MESSAGES.appleDevelopmentBuild);
  } else {
    apple = capability(true);
  }

  let google;
  if (!['ios', 'android'].includes(platform)) {
    google = capability(false, 'GOOGLE_AUTH_UNAVAILABLE', AUTH_MESSAGES.googleUnavailable);
  } else if (!googleWebConfigured || (platform === 'ios' && !googleIOSConfigured)) {
    google = capability(false, 'GOOGLE_AUTH_CONFIGURATION_MISSING', AUTH_MESSAGES.googleConfiguration);
  } else if (!backendConfigured) {
    google = capability(false, 'GOOGLE_AUTH_BACKEND_MISSING', AUTH_MESSAGES.googleBackend);
  } else if (expoGo) {
    google = capability(false, 'GOOGLE_AUTH_REQUIRES_DEVELOPMENT_BUILD', AUTH_MESSAGES.googleDevelopmentBuild);
  } else {
    google = capability(true);
  }

  let phone;
  if (!['ios', 'android'].includes(platform)) {
    phone = capability(false, 'PHONE_AUTH_UNAVAILABLE', AUTH_MESSAGES.phonePlatform);
  } else if (!backendConfigured || runtimeConfig?.phoneAuthEnabled !== true) {
    phone = capability(false, 'PHONE_AUTH_CONFIGURATION_MISSING', AUTH_MESSAGES.phoneConfiguration);
  } else {
    phone = capability(true);
  }

  return Object.freeze({ apple, google, phone });
}

export function createAuthError(code, userMessage, cause) {
  const error = new Error(userMessage);
  error.code = code;
  error.userMessage = userMessage;
  if (cause) error.cause = cause;
  return error;
}

export function isAuthenticationCancellation(error) {
  const marker = [error?.code, error?.type, error?.message].filter(Boolean).join(' ');
  return /cancel/i.test(marker);
}

export function isExpectedDemoAuthenticationFailure(
  provider,
  error,
  { demoModeAvailable = false, platform = null } = {}
) {
  if (provider !== 'google' || demoModeAvailable !== true || platform !== 'android') return false;
  const code = String(error?.code ?? '').trim();
  if (['10', 'DEVELOPER_ERROR', 'PLAY_SERVICES_NOT_AVAILABLE'].includes(code)) return true;
  return /\bDEVELOPER_ERROR\b/.test(String(error?.message || ''));
}

export function isTransientAuthenticationError(error) {
  if (['AUTH_NETWORK_ERROR', 'AUTH_TIMEOUT'].includes(error?.code) || error?.name === 'AbortError') {
    return true;
  }
  const match = /^AUTH_HTTP_(\d{3})$/.exec(error?.code || '');
  if (!match) return false;
  const status = Number(match[1]);
  return [408, 425, 429].includes(status) || status >= 500;
}

export function authenticationErrorTranslationKey(error) {
  switch (error?.code) {
    case 'PHONE_NUMBER_INVALID':
      return 'phone.invalid';
    case 'PHONE_AUTH_CODE_INVALID':
      return 'releaseCritical.authCodeInvalid';
    case 'AUTH_RATE_LIMITED':
    case 'AUTH_HTTP_429':
      return 'releaseCritical.authRateLimited';
    case 'AUTH_TIMEOUT':
      return 'releaseCritical.authTimeout';
    case 'AUTH_NETWORK_ERROR':
      return 'releaseCritical.authNetwork';
    case 'APPLE_AUTH_UNAVAILABLE':
    case 'APPLE_AUTH_CONFIGURATION_MISSING':
    case 'APPLE_AUTH_REQUIRES_DEVELOPMENT_BUILD':
    case 'GOOGLE_AUTH_UNAVAILABLE':
    case 'GOOGLE_AUTH_CONFIGURATION_MISSING':
    case 'GOOGLE_AUTH_BACKEND_MISSING':
    case 'GOOGLE_AUTH_REQUIRES_DEVELOPMENT_BUILD':
    case 'PHONE_AUTH_UNAVAILABLE':
    case 'PHONE_AUTH_CONFIGURATION_MISSING':
    case 'VOICE_CONFIGURATION_MISSING':
    case 'VOICE_CONFIGURATION_INVALID':
      return 'releaseCritical.authUnavailable';
    default:
      return 'auth.signInFailedMessage';
  }
}

export function authenticationCapabilityTranslationKey(capability) {
  return capability?.enabled ? null : authenticationErrorTranslationKey({ code: capability?.code });
}

export function userFacingAuthenticationError(provider, error) {
  if (error?.userMessage) return error;
  if (isAuthenticationCancellation(error)) return error;

  if (error?.code === 'AUTH_HTTP_429' || error?.serverCode === 'PHONE_AUTH_RATE_LIMITED') {
    return createAuthError('AUTH_RATE_LIMITED', AUTH_MESSAGES.tooManyAttempts, error);
  }
  if (error?.code === 'AUTH_TIMEOUT' || error?.name === 'AbortError') {
    return createAuthError('AUTH_TIMEOUT', AUTH_MESSAGES.timeout, error);
  }
  if (error?.code === 'AUTH_NETWORK_ERROR' || error instanceof TypeError) {
    return createAuthError('AUTH_NETWORK_ERROR', AUTH_MESSAGES.network, error);
  }
  if (provider === 'phone' && error?.serverCode === 'PHONE_AUTH_NOT_CONFIGURED') {
    return createAuthError(
      'PHONE_AUTH_CONFIGURATION_MISSING',
      AUTH_MESSAGES.phoneConfiguration,
      error
    );
  }
  if (
    provider === 'phone'
    && error?.serverCode === 'PHONE_AUTH_INVALID'
    && error?.operation === 'phone-start'
  ) {
    return createAuthError('PHONE_NUMBER_INVALID', AUTH_MESSAGES.phoneInvalidNumber, error);
  }
  if (provider === 'phone' && error?.serverCode === 'PHONE_AUTH_PROVIDER_UNAVAILABLE') {
    return createAuthError('PHONE_AUTH_UNAVAILABLE', AUTH_MESSAGES.phoneUnavailable, error);
  }
  if (
    provider === 'phone'
    && (
      error?.serverCode === 'PHONE_AUTH_INVALID'
      || (!error?.serverCode && ['AUTH_HTTP_400', 'AUTH_HTTP_401', 'AUTH_HTTP_404'].includes(error?.code))
    )
  ) {
    return createAuthError('PHONE_AUTH_CODE_INVALID', AUTH_MESSAGES.phoneInvalidCode, error);
  }

  const fallback = {
    apple: AUTH_MESSAGES.appleFailed,
    google: AUTH_MESSAGES.googleFailed,
    phone: AUTH_MESSAGES.phoneFailed
  }[provider] || AUTH_MESSAGES.network;
  return createAuthError(`${String(provider || 'auth').toUpperCase()}_AUTH_FAILED`, fallback, error);
}
