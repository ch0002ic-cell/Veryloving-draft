'use strict';

const { withEntitlementsPlist } = require('@expo/config-plugins');

const APPLE_SIGN_IN_ENTITLEMENT = 'com.apple.developer.applesignin';

function mergeVeryLovingEntitlements(entitlements = {}) {
  const merged = { ...entitlements };
  const signInValues = Array.isArray(merged[APPLE_SIGN_IN_ENTITLEMENT])
    ? merged[APPLE_SIGN_IN_ENTITLEMENT]
    : [];

  if (!merged['aps-environment']) {
    merged['aps-environment'] = 'development';
  }

  merged[APPLE_SIGN_IN_ENTITLEMENT] = [...new Set([...signInValues, 'Default'])];
  return merged;
}

function withVeryLovingEntitlements(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    entitlementsConfig.modResults = mergeVeryLovingEntitlements(
      entitlementsConfig.modResults
    );
    return entitlementsConfig;
  });
}

module.exports = withVeryLovingEntitlements;
module.exports.mergeVeryLovingEntitlements = mergeVeryLovingEntitlements;
