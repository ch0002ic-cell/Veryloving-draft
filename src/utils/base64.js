const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUES = Object.freeze(Object.fromEntries(
  [...BASE64_ALPHABET].map((character, index) => [character, index])
));

export function base64ToBytes(value) {
  if (typeof value !== 'string') throw new TypeError('Base64 input must be a string.');
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error('Base64 input is invalid.');
  }
  const firstPadding = normalized.indexOf('=');
  if (firstPadding !== -1 && firstPadding < normalized.length - 2) {
    throw new Error('Base64 padding is invalid.');
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const padding = padded.endsWith('==') ? 2 : padded.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array((padded.length / 4) * 3 - padding);
  let output = 0;

  for (let index = 0; index < padded.length; index += 4) {
    const a = BASE64_VALUES[padded[index]];
    const b = BASE64_VALUES[padded[index + 1]];
    const c = padded[index + 2] === '=' ? 0 : BASE64_VALUES[padded[index + 2]];
    const d = padded[index + 3] === '=' ? 0 : BASE64_VALUES[padded[index + 3]];
    if ([a, b, c, d].some((item) => item === undefined)) throw new Error('Base64 input is invalid.');
    const combined = (a << 18) | (b << 12) | (c << 6) | d;
    if (output < bytes.length) bytes[output++] = (combined >>> 16) & 0xff;
    if (output < bytes.length) bytes[output++] = (combined >>> 8) & 0xff;
    if (output < bytes.length) bytes[output++] = combined & 0xff;
  }
  return bytes;
}

export function bytesToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : Uint8Array.from(value || []);
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const combined = (a << 16) | (b << 8) | c;
    result += BASE64_ALPHABET[(combined >>> 18) & 0x3f];
    result += BASE64_ALPHABET[(combined >>> 12) & 0x3f];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(combined >>> 6) & 0x3f] : '=';
    result += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 0x3f] : '=';
  }
  return result;
}

export function utf8BytesToString(bytes) {
  let result = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++];
    let codePoint;
    let continuationCount;
    if (first <= 0x7f) {
      codePoint = first;
      continuationCount = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      continuationCount = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      continuationCount = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      continuationCount = 3;
    } else {
      throw new Error('UTF-8 input is invalid.');
    }
    if (index + continuationCount > bytes.length) throw new Error('UTF-8 input is truncated.');
    for (let offset = 0; offset < continuationCount; offset += 1) {
      const continuation = bytes[index++];
      if ((continuation & 0xc0) !== 0x80) throw new Error('UTF-8 continuation byte is invalid.');
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }
    const minimum = continuationCount === 1 ? 0x80 : continuationCount === 2 ? 0x800 : continuationCount === 3 ? 0x10000 : 0;
    if (codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new Error('UTF-8 code point is invalid.');
    }
    if (codePoint <= 0xffff) {
      result += String.fromCharCode(codePoint);
    } else {
      const supplementary = codePoint - 0x10000;
      result += String.fromCharCode(0xd800 + (supplementary >>> 10), 0xdc00 + (supplementary & 0x3ff));
    }
  }
  return result;
}

export function decodeBase64URLJSON(value) {
  return JSON.parse(utf8BytesToString(base64ToBytes(value)));
}
