'use strict';

// Keep the gateway deployable as a standalone container. This allowlist is
// mirrored against the mobile catalog by globalization tests, without making
// the production server import or ship the React Native source tree.
const VOICE_LOCALES = Object.freeze([
  'aa', 'ab', 'af', 'ak', 'am', 'ar', 'as', 'av', 'ay', 'az', 'ba', 'be', 'bg', 'bm', 'bn', 'bo', 'br', 'bs', 'ca', 'ce', 'ch', 'co', 'cs', 'cv', 'cy', 'da', 'de', 'dv', 'dz', 'ee', 'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr', 'fy', 'ga', 'gd', 'gl', 'gn', 'gu', 'gv', 'ha', 'he', 'hi', 'hr', 'ht', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'iu', 'ja', 'jv', 'ka', 'kg', 'kk', 'kl', 'km', 'kn', 'ko', 'kr', 'ks', 'ku', 'kv', 'ky', 'la', 'lb', 'lg', 'li', 'ln', 'lo', 'lt', 'lv', 'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms', 'mt', 'my', 'nb', 'ne', 'nl', 'no', 'nr', 'ny', 'oc', 'om', 'or', 'os', 'pa', 'pl', 'ps', 'pt', 'qu', 'rn', 'ro', 'ru', 'rw', 'sa', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta', 'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw', 'ty', 'ug', 'uk', 'ur', 'uz', 've', 'vi', 'wo', 'xh', 'yi', 'yo', 'zh', 'zu'
]);

module.exports = { VOICE_LOCALES };
