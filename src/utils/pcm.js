const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function pcmBytesToBase64(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new Uint8Array(value || new ArrayBuffer(0));
  if (!bytes.byteLength) return '';
  if (bytes.byteLength % 2 !== 0) throw new Error('PCM16 buffers must contain complete 16-bit samples.');

  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] : 0;
    const third = hasThird ? bytes[index + 2] : 0;
    const combined = (first << 16) | (second << 8) | third;
    encoded += BASE64_ALPHABET[(combined >>> 18) & 63];
    encoded += BASE64_ALPHABET[(combined >>> 12) & 63];
    encoded += hasSecond ? BASE64_ALPHABET[(combined >>> 6) & 63] : '=';
    encoded += hasThird ? BASE64_ALPHABET[combined & 63] : '=';
  }
  return encoded;
}
