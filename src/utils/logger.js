const isSensitiveKey = (key) => {
  const compactKey = String(key).replace(/[-_]/g, '').toLowerCase();
  return compactKey === 'key'
    || compactKey === 'authorization'
    || compactKey.endsWith('token')
    || compactKey.endsWith('apikey')
    || compactKey.endsWith('secret')
    || compactKey.endsWith('password');
};
const isDevelopment = typeof __DEV__ !== 'undefined'
  ? __DEV__
  : process.env.NODE_ENV !== 'production';

const redact = (value) => {
  if (typeof value !== 'string') return value;

  return value
    .replace(/([?&](token|access_token|api_key|apikey|key|secret|client_secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
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
