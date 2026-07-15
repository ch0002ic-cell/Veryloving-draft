'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  AUTH_MESSAGES,
  authenticationCapabilities,
  authenticationCapabilityTranslationKey,
  authenticationErrorTranslationKey,
  createAuthError,
  createSimulatorAuthenticationError,
  isAuthenticationCancellation,
  isTransientAuthenticationError,
  userFacingAuthenticationError
} = require('../src/utils/auth-configuration');

const configured = {
  apiBaseUrl: 'https://api.example.test',
  appleClientId: 'com.veryloving.app',
  googleIOSClientId: 'ios.apps.googleusercontent.com',
  googleWebClientId: 'web.apps.googleusercontent.com',
  phoneAuthEnabled: true
};

test('configured iOS development builds enable every production auth method', () => {
  const capabilities = authenticationCapabilities(configured, {
    platform: 'ios',
    expoGo: false
  });
  assert.equal(capabilities.apple.enabled, true);
  assert.equal(capabilities.google.enabled, true);
  assert.equal(capabilities.phone.enabled, true);
});

test('only network-like refresh failures preserve offline identity state', () => {
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_NETWORK_ERROR' }), true);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_TIMEOUT' }), true);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_HTTP_429' }), true);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_HTTP_503' }), true);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_HTTP_401' }), false);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_HTTP_404' }), false);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_RESPONSE_INVALID' }), false);
  assert.equal(isTransientAuthenticationError({ code: 'AUTH_CONFIGURATION_INVALID' }), false);
});

test('Expo Go disables entitlement-sensitive native providers but keeps backend SMS available', () => {
  const capabilities = authenticationCapabilities(configured, {
    platform: 'ios',
    expoGo: true
  });
  assert.deepEqual(capabilities.apple, {
    enabled: false,
    code: 'APPLE_AUTH_REQUIRES_DEVELOPMENT_BUILD',
    message: AUTH_MESSAGES.appleDevelopmentBuild
  });
  assert.deepEqual(capabilities.google, {
    enabled: false,
    code: 'GOOGLE_AUTH_REQUIRES_DEVELOPMENT_BUILD',
    message: AUTH_MESSAGES.googleDevelopmentBuild
  });
  assert.equal(capabilities.phone.enabled, true);
});

test('missing configuration fails closed with exact actionable messages', () => {
  const capabilities = authenticationCapabilities({ appleClientId: 'com.veryloving.app' }, {
    platform: 'ios',
    expoGo: false
  });
  assert.equal(capabilities.apple.message, AUTH_MESSAGES.appleConfiguration);
  assert.equal(capabilities.google.message, AUTH_MESSAGES.googleConfiguration);
  assert.equal(capabilities.phone.message, AUTH_MESSAGES.phoneConfiguration);
});

test('Google configuration requirements are platform-specific', () => {
  const android = authenticationCapabilities({
    apiBaseUrl: configured.apiBaseUrl,
    googleWebClientId: configured.googleWebClientId
  }, { platform: 'android', expoGo: false });
  assert.equal(android.apple.enabled, false);
  assert.equal(android.google.enabled, true);

  const web = authenticationCapabilities(configured, { platform: 'web', expoGo: false });
  assert.equal(web.apple.enabled, false);
  assert.equal(web.google.enabled, false);
  assert.equal(web.phone.enabled, false);
  assert.equal(web.phone.message, AUTH_MESSAGES.phonePlatform);
});

test('authentication cancellations remain silent while server errors become safe messages', () => {
  assert.equal(isAuthenticationCancellation({ code: 'ERR_REQUEST_CANCELED' }), true);

  const cancellation = new Error('Apple Sign-In was cancelled.');
  cancellation.code = 'ERR_REQUEST_CANCELED';
  assert.equal(userFacingAuthenticationError('apple', cancellation), cancellation);

  const rateLimit = new Error('provider detail');
  rateLimit.code = 'AUTH_HTTP_429';
  assert.equal(userFacingAuthenticationError('phone', rateLimit).userMessage, AUTH_MESSAGES.tooManyAttempts);

  const notConfigured = new Error('provider detail');
  notConfigured.serverCode = 'PHONE_AUTH_NOT_CONFIGURED';
  assert.equal(
    userFacingAuthenticationError('phone', notConfigured).userMessage,
    AUTH_MESSAGES.phoneConfiguration
  );

  const invalidPhone = new Error('provider detail');
  invalidPhone.serverCode = 'PHONE_AUTH_INVALID';
  invalidPhone.operation = 'phone-start';
  assert.equal(
    userFacingAuthenticationError('phone', invalidPhone).userMessage,
    AUTH_MESSAGES.phoneInvalidNumber
  );

  const unavailable = new Error('provider detail');
  unavailable.serverCode = 'PHONE_AUTH_PROVIDER_UNAVAILABLE';
  assert.equal(
    userFacingAuthenticationError('phone', unavailable).userMessage,
    AUTH_MESSAGES.phoneUnavailable
  );

  const typed = createAuthError('AUTH_CONFIGURATION_MISSING', 'Safe configuration error');
  assert.equal(userFacingAuthenticationError('google', typed), typed);
});

test('auth presentation maps typed failures to localized catalog keys', () => {
  assert.equal(authenticationErrorTranslationKey({ code: 'PHONE_NUMBER_INVALID' }), 'phone.invalid');
  assert.equal(authenticationErrorTranslationKey({ code: 'PHONE_AUTH_CODE_INVALID' }), 'releaseCritical.authCodeInvalid');
  assert.equal(authenticationErrorTranslationKey({ code: 'AUTH_HTTP_429' }), 'releaseCritical.authRateLimited');
  assert.equal(authenticationErrorTranslationKey({ code: 'AUTH_NETWORK_ERROR' }), 'releaseCritical.authNetwork');
  assert.equal(authenticationErrorTranslationKey(new Error('raw provider detail')), 'auth.signInFailedMessage');
  assert.equal(
    authenticationCapabilityTranslationKey({ enabled: false, code: 'GOOGLE_AUTH_CONFIGURATION_MISSING' }),
    'releaseCritical.authUnavailable'
  );
  assert.equal(authenticationCapabilityTranslationKey({ enabled: true }), null);
});

test('simulator provider failures are typed, actionable, and mention demo only when available', () => {
  const apple = createSimulatorAuthenticationError('apple', { demoAvailable: true });
  assert.equal(apple.code, 'APPLE_AUTH_SIMULATOR_UNAVAILABLE');
  assert.match(apple.userMessage, /unavailable in this iOS Simulator build/);
  assert.match(apple.userMessage, /Continue as demo \(development only\)/);

  const google = createSimulatorAuthenticationError('google');
  assert.equal(google.code, 'GOOGLE_AUTH_SIMULATOR_UNAVAILABLE');
  assert.match(google.userMessage, /physical iPhone and try again/);
  assert.doesNotMatch(google.userMessage, /Continue as demo/);

  assert.equal(
    userFacingAuthenticationError('apple', new Error('native detail')).userMessage,
    AUTH_MESSAGES.appleFailed
  );
  assert.match(AUTH_MESSAGES.googleFailed, /Check your internet connection and try again/);
});
