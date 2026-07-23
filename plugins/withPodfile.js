'use strict';

const { CodeGenerator, withPodfile } = require('@expo/config-plugins');

const MODULAR_HEADERS_TAG = 'veryloving-modular-headers';

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

  return modularHeaders.contents;
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
