'use strict';

const { CodeGenerator, withPodfile } = require('@expo/config-plugins');

const MODULAR_HEADERS_TAG = 'veryloving-modular-headers';
const EXAV_POST_INSTALL_TAG = 'veryloving-exav-post-install';

const EXAV_POST_INSTALL = `    installer.pods_project.targets.each do |target|
      if target.name == 'EXAV'
        target.build_configurations.each do |config|
          config.build_settings['HEADER_SEARCH_PATHS'] = [
            '$(inherited)',
            '"\${PODS_ROOT}/React-Core-prebuilt/React.xcframework/Headers/React_Core"',
            '"\${PODS_ROOT}/Headers/Public"',
            '"\${PODS_ROOT}/Headers/Private"',
            '"\${PODS_ROOT}/ExpoModulesCore"'
          ].join(' ')
          config.build_settings['FRAMEWORK_SEARCH_PATHS'] = [
            '$(inherited)',
            '"\${PODS_ROOT}/React-Core-prebuilt"'
          ].join(' ')
          config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= '$(inherited)'
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << ' USE_HEADERMAP=1'
        end
      end
    end`;

function applyPodfileCustomizations(contents) {
  if (typeof contents !== 'string') {
    throw new TypeError('Expected Podfile contents to be a string.');
  }

  const modularHeaders = CodeGenerator.mergeContents({
    src: contents,
    newSrc: 'use_modular_headers!',
    tag: MODULAR_HEADERS_TAG,
    anchor: /^platform :ios,/,
    offset: 1,
    comment: '#'
  });

  const exavPostInstall = CodeGenerator.mergeContents({
    src: modularHeaders.contents,
    newSrc: EXAV_POST_INSTALL,
    tag: EXAV_POST_INSTALL_TAG,
    anchor: /:ccache_enabled\s*=>\s*ccache_enabled\?\(podfile_properties\),/,
    offset: 2,
    comment: '#'
  });

  return exavPostInstall.contents;
}

function withVeryLovingPodfile(config) {
  return withPodfile(config, (podfileConfig) => {
    podfileConfig.modResults.contents = applyPodfileCustomizations(
      podfileConfig.modResults.contents
    );
    return podfileConfig;
  });
}

module.exports = withVeryLovingPodfile;
module.exports.applyPodfileCustomizations = applyPodfileCustomizations;
