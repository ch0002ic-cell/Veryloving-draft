const redact = (value) => {
  if (typeof value !== 'string') return value;
  return value.replace(/([?&](token|access_token|api_key|apikey|key|secret|client_secret|authorization)=)[^&]+/gi, '$1[REDACTED]');
};

const normalize = (payload) => {
  if (!payload || typeof payload !== 'object') return redact(payload);
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, redact(value)]));
};

export const logger = {
  voice: (...args) => console.log(...args.map(normalize)),
  info: (...args) => console.log(...args.map(normalize)),
  warn: (...args) => console.warn(...args.map(normalize)),
  error: (...args) => console.error(...args.map(normalize))
};

export const sanitizeUrl = redact;
