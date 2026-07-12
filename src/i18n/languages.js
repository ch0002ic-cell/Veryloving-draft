'use strict';

module.exports = [
  {
    code: 'system',
    translationKey: 'languages.system',
    nativeName: 'System'
  },
  {
    code: 'en',
    translationKey: 'languages.english',
    nativeName: 'English',
    messages: require('./locales/en.json')
  },
  {
    code: 'es',
    translationKey: 'languages.spanish',
    nativeName: 'Español',
    messages: require('./locales/es.json')
  }
];
