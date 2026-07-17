import { safetyRequest } from './safety-api';

export async function pairHomeRobot(qrCode, accessToken, options = {}) {
  if (!accessToken) throw new Error('Authentication is required');
  if (typeof qrCode !== 'string' || qrCode.length < 20) throw new Error('A valid manufacturer QR code is required');
  return safetyRequest('/v1/devices/home-robots/pair', {
    ...options,
    accessToken,
    method: 'POST',
    body: { qr_code: qrCode }
  });
}

export async function listHomeRobots(accessToken, options = {}) {
  if (!accessToken) throw new Error('Authentication is required');
  const result = await safetyRequest('/v1/devices/home-robots', {
    ...options,
    accessToken,
    method: 'GET'
  });
  return Array.isArray(result?.devices) ? result.devices : [];
}
