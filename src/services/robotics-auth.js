import { decodeBase64URLJSON } from '../utils/base64';

const MAX_TOKEN_LENGTH = 20000;

export function inspectRobotActionEnvelope(envelope, { accessToken, now = Date.now() } = {}) {
  if (envelope?.type !== 'ROBOT_ACTION' || typeof envelope.token !== 'string' || envelope.token.length > MAX_TOKEN_LENGTH) return null;
  const segments = envelope.token.split('.');
  if (segments.length !== 3 || !segments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) return null;
  let header;
  let payload;
  let session;
  try {
    header = decodeBase64URLJSON(segments[0]);
    payload = decodeBase64URLJSON(segments[1]);
    session = decodeBase64URLJSON(String(accessToken || '').split('.')[1]);
  } catch { return null; }
  const nowSeconds = Math.floor(now / 1000);
  if (
    header?.alg !== 'HS256'
    || header.typ !== 'robot-action+jwt'
    || payload?.iss !== 'veryloving-robotics-gateway'
    || payload?.aud !== 'veryloving-robotics-mobile'
    || payload?.sub !== session?.sub
    || payload?.sid !== session?.sid
    || !Number.isSafeInteger(payload?.exp)
    || payload.exp <= nowSeconds
    || !payload.action
  ) return null;
  return { token: envelope.token, action: payload.action, expiresAt: payload.exp * 1000 };
}

export async function verifyRobotActionEnvelope(envelope, { accessToken, verifySignature, now } = {}) {
  const inspected = inspectRobotActionEnvelope(envelope, { accessToken, now });
  if (!inspected || typeof verifySignature !== 'function') return null;
  const verified = await verifySignature(inspected.token);
  if (!verified?.valid || !verified.action) return null;
  return verified.action;
}

export async function verifyRobotActionWithGateway(token, { accessToken, apiBaseUrl, fetchImpl = globalThis.fetch } = {}) {
  if (!accessToken || !apiBaseUrl || typeof fetchImpl !== 'function') return { valid: false };
  const response = await fetchImpl(`${apiBaseUrl.replace(/\/$/, '')}/v1/robotics/actions/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token })
  });
  if (!response.ok) return { valid: false };
  return response.json();
}
