const isSensitiveKey = (key) => {
  const compactKey = String(key).replace(/[-_]/g, '').toLowerCase();
  return compactKey === 'key'
    || compactKey === 'authorization'
    || compactKey.endsWith('token')
    || compactKey.endsWith('apikey')
    || compactKey.endsWith('secret')
    || compactKey.endsWith('password')
    || compactKey.endsWith('serial')
    || compactKey.endsWith('serialnumber')
    || compactKey.endsWith('pairingcode')
    || compactKey.endsWith('qrcode')
    || compactKey.endsWith('email')
    || compactKey.endsWith('phone')
    || compactKey.endsWith('phonenumber')
    || compactKey.endsWith('address')
    || compactKey.endsWith('coordinates')
    || compactKey.endsWith('location')
    || compactKey.endsWith('deviceid')
    || compactKey.endsWith('deviceref')
    || compactKey === 'parameters'
    || compactKey === 'actionparameters'
    || compactKey === 'latitude'
    || compactKey === 'longitude'
    || compactKey === 'userid'
    || compactKey === 'accountid'
    || compactKey === 'subject';
};
const isDevelopment = typeof __DEV__ !== 'undefined'
  ? __DEV__
  : process.env.NODE_ENV !== 'production';
const isReactNativeDevelopment = typeof __DEV__ !== 'undefined' && __DEV__ === true;
const MAX_LOG_STRING_CHARACTERS = 2048;
const MAX_LOG_COLLECTION_ITEMS = 50;

const redact = (value) => {
  if (typeof value !== 'string') return value;

  // Bound regex work without exposing a credential cut by the boundary. When
  // truncation is required, discard the entire trailing token before applying
  // the ordinary redaction expressions to the retained prefix.
  const bounded = value.length > MAX_LOG_STRING_CHARACTERS
    ? `${value
      .slice(0, MAX_LOG_STRING_CHARACTERS)
      .replace(/(^|[\s,;&])([^\s,;&]*)$/, '$1[REDACTED_TRUNCATED]')}…[TRUNCATED]`
    : value;
  return bounded
    .replace(/([?&](token|access_token|api_key|apikey|key|secret|client_secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{4,}\.){2}[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]/g, '[REDACTED_PUSH_TOKEN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(^|[^\d])\+[1-9]\d{6,14}\b/g, '$1[REDACTED_PHONE]')
    .replace(/\b((?:hardware[_ -]?serial|serial(?:[_ -]?number)?|pairing[_ -]?code|qr[_ -]?code)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
};

const normalizeErrorField = (value, fallback) => (
  typeof value === 'string' ? redact(value) : fallback
);

const normalize = (payload, depth = 0) => {
  if (typeof payload === 'string') return redact(payload);
  let isErrorPayload;
  try {
    isErrorPayload = payload instanceof Error;
  } catch {
    return '[UNREADABLE]';
  }
  if (isErrorPayload) {
    try {
      return {
        name: normalizeErrorField(payload.name, 'Error'),
        message: normalizeErrorField(payload.message, '[UNREADABLE]')
      };
    } catch {
      return { name: 'Error', message: '[UNREADABLE]' };
    }
  }
  if (typeof payload === 'function') return '[Function]';
  if (!payload || typeof payload !== 'object') return payload;
  if (depth >= 3) return '[Object]';
  let isArrayPayload;
  try {
    isArrayPayload = Array.isArray(payload);
  } catch {
    return '[UNREADABLE]';
  }
  if (isArrayPayload) {
    try {
      const values = [];
      const length = Math.min(payload.length, MAX_LOG_COLLECTION_ITEMS);
      for (let index = 0; index < length; index += 1) {
        try {
          values.push(normalize(payload[index], depth + 1));
        } catch {
          values.push('[UNREADABLE]');
        }
      }
      if (payload.length > MAX_LOG_COLLECTION_ITEMS) values.push('[TRUNCATED]');
      return values;
    } catch {
      return '[UNREADABLE]';
    }
  }

  let keys;
  try {
    keys = Object.keys(payload);
  } catch {
    return '[UNREADABLE]';
  }
  const entries = [];
  for (const key of keys.slice(0, MAX_LOG_COLLECTION_ITEMS)) {
    let value;
    try {
      value = isSensitiveKey(key) ? '[REDACTED]' : normalize(payload[key], depth + 1);
    } catch {
      value = '[UNREADABLE]';
    }
    entries.push([redact(key), value]);
  }
  if (keys.length > MAX_LOG_COLLECTION_ITEMS) entries.push(['truncated', true]);
  return Object.fromEntries(entries);
};

export const sanitizeLogPayload = normalize;

/**
 * React Native promotes console.warn/error calls into LogBox. Callers must use
 * `recoverable` only after they have caught the operation and provided UI,
 * fallback, or retry handling. Genuine warn/error diagnostics retain their
 * native console severity, while production retains recoverable warnings for
 * observability.
 */
export function createLogger({
  development = isDevelopment,
  reactNativeDevelopment = isReactNativeDevelopment,
  consoleImpl = console
} = {}) {
  const diagnostic = (level) => (...args) => {
    const normalized = args.map((arg) => normalize(arg));
    consoleImpl[level](...normalized);
  };

  return Object.freeze({
    voice: (...args) => {
      if (development) consoleImpl.log(...args.map((arg) => normalize(arg)));
    },
    info: (...args) => {
      if (development) consoleImpl.log(...args.map((arg) => normalize(arg)));
    },
    recoverable: (...args) => {
      const normalized = args.map((arg) => normalize(arg));
      if (reactNativeDevelopment) {
        consoleImpl.log('[recoverable]', ...normalized);
        return;
      }
      consoleImpl.warn(...normalized);
    },
    warn: diagnostic('warn'),
    error: diagnostic('error')
  });
}

export const logger = createLogger();

export const sanitizeUrl = redact;
