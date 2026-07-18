'use strict';

const SENSITIVE_KEY = /(?:authorization|token|apikey|secret|password|serial|serialnumber|pairingcode|qrcode|email|phone|phonenumber|address|coordinates|location|latitude|longitude|userid|accountid|subject)$/i;

function redactString(value) {
  return value
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
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (!value || typeof value !== 'object') return value;
  if (depth >= 4) return '[Object]';
  if (Array.isArray(value)) return value.map((item) => sanitizeServerLog(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key.replace(/[-_]/g, '')) ? '[REDACTED]' : sanitizeServerLog(item, depth + 1)
  ]));
}

function createRedactedLogger(baseLogger = console) {
  if (baseLogger?.__verylovingRedacted === true) return baseLogger;
  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [
    level,
    (...args) => {
      const sink = typeof baseLogger?.[level] === 'function'
        ? baseLogger[level]
        : baseLogger?.log;
      return sink?.call(baseLogger, ...args.map((value) => sanitizeServerLog(value)));
    }
  ]));
  Object.defineProperty(logger, '__verylovingRedacted', { value: true });
  return logger;
}

module.exports = { createRedactedLogger, sanitizeServerLog };
