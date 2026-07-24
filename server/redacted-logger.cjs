'use strict';

const SENSITIVE_KEY = /(?:authorization|token|apikey|secret|password|serial|serialnumber|pairingcode|qrcode|email|phone|phonenumber|address|coordinates|location|latitude|longitude|userid|accountid|subject|deviceid|deviceref|sourcedeviceref|parameters|actionparameters|path)$/i;
const MAX_LOG_STRING_CHARACTERS = 2048;
const MAX_LOG_COLLECTION_ITEMS = 50;

function redactString(value) {
  const bounded = value.length > MAX_LOG_STRING_CHARACTERS
    ? `${value
      .slice(0, MAX_LOG_STRING_CHARACTERS)
      .replace(/(^|[\s,;&])([^\s,;&]*)$/, '$1[REDACTED_TRUNCATED]')}…[TRUNCATED]`
    : value;
  return bounded
    .replace(/([?&](?:token|access_token|api_key|apikey|key|secret|client_secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{4,}\.){2}[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]/g, '[REDACTED_PUSH_TOKEN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(^|[^\d])\+[1-9]\d{6,14}\b/g, '$1[REDACTED_PHONE]')
    .replace(/\b((?:hardware[_ -]?serial|serial(?:[_ -]?number)?|pairing[_ -]?code|qr[_ -]?code)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function sanitizeServerLog(value, depth = 0) {
  if (typeof value === 'string') return redactString(value);
  let isErrorValue;
  try {
    isErrorValue = value instanceof Error;
  } catch {
    return '[UNREADABLE]';
  }
  if (isErrorValue) {
    try {
      return {
        name: typeof value.name === 'string' ? redactString(value.name) : 'Error',
        message: typeof value.message === 'string' ? redactString(value.message) : '[UNREADABLE]'
      };
    } catch {
      return { name: 'Error', message: '[UNREADABLE]' };
    }
  }
  if (typeof value === 'function') return '[Function]';
  if (!value || typeof value !== 'object') return value;
  if (depth >= 4) return '[Object]';
  let isArrayValue;
  try {
    isArrayValue = Array.isArray(value);
  } catch {
    return '[UNREADABLE]';
  }
  if (isArrayValue) {
    try {
      const output = [];
      const length = Math.min(value.length, MAX_LOG_COLLECTION_ITEMS);
      for (let index = 0; index < length; index += 1) {
        try {
          output.push(sanitizeServerLog(value[index], depth + 1));
        } catch {
          output.push('[UNREADABLE]');
        }
      }
      if (value.length > MAX_LOG_COLLECTION_ITEMS) output.push('[TRUNCATED]');
      return output;
    } catch {
      return '[UNREADABLE]';
    }
  }
  let keys;
  try {
    keys = Object.keys(value);
  } catch {
    return '[UNREADABLE]';
  }
  const entries = [];
  for (const key of keys.slice(0, MAX_LOG_COLLECTION_ITEMS)) {
    let item;
    try {
      item = SENSITIVE_KEY.test(key.replace(/[-_]/g, ''))
        ? '[REDACTED]'
        : sanitizeServerLog(value[key], depth + 1);
    } catch {
      item = '[UNREADABLE]';
    }
    entries.push([redactString(key), item]);
  }
  if (keys.length > MAX_LOG_COLLECTION_ITEMS) entries.push(['truncated', true]);
  return Object.fromEntries(entries);
}

function createRedactedLogger(baseLogger = console) {
  try {
    if (baseLogger?.__verylovingRedacted === true) return baseLogger;
  } catch {
    // A diagnostic sink is never allowed to become an application fault.
  }
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
    level,
    (...args) => {
      try {
        const sink = typeof baseLogger?.[level] === 'function'
          ? baseLogger[level]
          : baseLogger?.log;
        return sink?.call(baseLogger, ...args.map((value) => sanitizeServerLog(value)));
      } catch {
        return undefined;
      }
    }
  ]));
  Object.defineProperty(logger, '__verylovingRedacted', { value: true });
  return logger;
}

module.exports = { createRedactedLogger, sanitizeServerLog };
