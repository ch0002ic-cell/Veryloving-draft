export function createOpaqueSessionId(now = Date.now, random = Math.random) {
  return `call-${now()}-${random().toString(36).slice(2, 10)}`;
}
