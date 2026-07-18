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
    || compactKey === 'latitude'
    || compactKey === 'longitude'
    || compactKey === 'userid'
    || compactKey === 'accountid'
    || compactKey === 'subject';
};
const isDevelopment = typeof __DEV__ !== 'undefined'
  ? __DEV__
  : process.env.NODE_ENV !== 'production';

const redact = (value) => {
  if (typeof value !== 'string') return value;

  return value
    .replace(/([?&](token|access_token|api_key|apikey|key|secret|client_secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{4,}\.){2}[A-Za-z0-9_-]{4,}\b/g, '[REDACTED_JWT]')
    .replace(/\b(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]/g, '[REDACTED_PUSH_TOKEN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/(^|[^\d])\+[1-9]\d{6,14}\b/g, '$1[REDACTED_PHONE]')
    .replace(/\b((?:hardware[_ -]?serial|serial(?:[_ -]?number)?|pairing[_ -]?code|qr[_ -]?code)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
};

const normalize = (payload, depth = 0) => {
  if (typeof payload === 'string') return redact(payload);
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: redact(payload.message)
    };
  }
  if (!payload || typeof payload !== 'object') return payload;
  if (depth >= 3) return '[Object]';
  if (Array.isArray(payload)) return payload.map((value) => normalize(value, depth + 1));

  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [
    key,
    isSensitiveKey(key) ? '[REDACTED]' : normalize(value, depth + 1)
  ]));
};

export const sanitizeLogPayload = normalize;

export const logger = {
  voice: (...args) => {
    if (isDevelopment) console.log(...args.map((arg) => normalize(arg)));
  },
  info: (...args) => {
    if (isDevelopment) console.log(...args.map((arg) => normalize(arg)));
  },
  warn: (...args) => console.warn(...args.map(normalize)),
  error: (...args) => console.error(...args.map(normalize))
};

export const sanitizeUrl = redact;
