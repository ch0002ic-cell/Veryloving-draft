'use strict';

const languageRegistry = require('./language-registry');

module.exports = [
  {
    code: 'system',
    translationKey: 'languages.system',
    englishName: 'System default',
    nativeName: 'System'
  },
  ...languageRegistry
];
