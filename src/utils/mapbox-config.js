export function hasUsableMapboxAccessToken(token) {
  return typeof token === 'string' && token.trim().length > 0;
}
