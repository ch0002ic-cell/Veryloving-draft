'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mergeVeryLovingEntitlements } = require('../plugins/withEntitlements');
const { upsertGradleProperty } = require('../plugins/withGradleProperties');
const { applyPodfileCustomizations } = require('../plugins/withPodfile');

const PODFILE_FIXTURE = `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'

prepare_react_native_project!

target 'VeryLoving' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

test('Podfile customizations are complete and idempotent', () => {
  const once = applyPodfileCustomizations(PODFILE_FIXTURE);
  const twice = applyPodfileCustomizations(once);

  assert.equal(twice, once);
  assert.equal((once.match(/^use_modular_headers!$/gm) || []).length, 1);
  assert.equal((once.match(/target\.name == 'EXAV'/g) || []).length, 1);
  assert.ok(once.indexOf("target.name == 'EXAV'") > once.indexOf('react_native_post_install('));
  assert.match(once, /@generated begin veryloving-modular-headers/);
  assert.match(once, /@generated begin veryloving-exav-post-install/);
});

test('entitlement merge preserves signing values and adds Apple Sign-In', () => {
  const merged = mergeVeryLovingEntitlements({
    'aps-environment': 'production',
    'com.apple.developer.applesignin': ['Existing'],
    'com.apple.developer.associated-domains': ['applinks:veryloving.ai']
  });

  assert.equal(merged['aps-environment'], 'production');
  assert.deepEqual(merged['com.apple.developer.applesignin'], ['Existing', 'Default']);
  assert.deepEqual(
    merged['com.apple.developer.associated-domains'],
    ['applinks:veryloving.ai']
  );
});

test('entitlement merge supplies local prebuild defaults', () => {
  assert.deepEqual(mergeVeryLovingEntitlements(), {
    'aps-environment': 'development',
    'com.apple.developer.applesignin': ['Default']
  });
});

test('Gradle property customization updates existing entries without duplication', () => {
  const properties = [
    { type: 'comment', value: 'Android properties' },
    { type: 'property', key: 'android.enableJetifier', value: 'false' }
  ];

  upsertGradleProperty(properties, 'android.enableJetifier', 'true');
  upsertGradleProperty(properties, 'newArchEnabled', 'true');

  assert.equal(properties.filter((item) => item.key === 'android.enableJetifier').length, 1);
  assert.equal(properties.find((item) => item.key === 'android.enableJetifier').value, 'true');
  assert.equal(properties.find((item) => item.key === 'newArchEnabled').value, 'true');
});

test('Expo config owns the privacy manifest and local CNG plugins', () => {
  const config = require('../app.config')();
  const plugins = config.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);

  assert.equal(config.ios.privacyManifests.NSPrivacyTracking, false);
  assert.equal(config.ios.privacyManifests.NSPrivacyCollectedDataTypes.length, 13);
  assert.ok(plugins.includes('./plugins/withPodfile.js'));
  assert.ok(plugins.includes('./plugins/withEntitlements.js'));
  assert.ok(plugins.includes('./plugins/withGradleProperties.js'));
});
