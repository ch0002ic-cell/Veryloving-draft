export const PUBLIC_AUTH_ROUTES = Object.freeze([
  'onboarding',
  'create-account',
  'verify-code'
]);

// The first available route is the post-authentication anchor used when a
// public sign-in screen is removed by Expo Router's protected-route guard.
export const AUTHENTICATED_ONBOARDING_ROUTES = Object.freeze([
  'location-permission',
  'notification-permission',
  'device-check',
  'jewelry-setup',
  'capybear-setup',
  'capybear-reminder',
  'emergency-mode',
  'tutorial',
  'completion'
]);

export const PROTECTED_ROOT_ROUTES = Object.freeze([
  '(tabs)',
  'safety-call',
  'emergency-sos',
  'settings',
  'voices',
  'device-management',
  'emergency-contacts',
  'friends',
  'conversation-history',
  'quick-share-location',
  'ai-companion',
  'capybear-tap',
  'debug'
]);
