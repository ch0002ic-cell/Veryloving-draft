import { safetyRequest } from './safety-api';
import {
  loadRobotPairingCredential,
  removeRobotPairingCredential,
  saveRobotPairingCredential
} from './robot-pairing-credential-store';

export async function pairHomeRobot(qrCode, accessToken, options = {}) {
  if (!accessToken) throw new Error('Authentication is required');
  if (typeof qrCode !== 'string' || qrCode.length < 20 || qrCode.length > 2048) {
    throw new Error('A valid manufacturer QR code is required');
  }
  if (!options.accountId) throw new Error('An authenticated account is required');
  if (options.vendor !== undefined && !['yongyida', 'jiangzhi'].includes(options.vendor)) {
    throw new Error('A supported robot manufacturer is required');
  }
  const paired = await safetyRequest('/v1/devices/home-robots/pair', {
    ...options,
    accessToken,
    method: 'POST',
    body: {
      qr_code: qrCode,
      ...(options.vendor ? { robot_vendor: options.vendor } : {})
    }
  });
  await saveRobotPairingCredential(options.accountId, paired?.robot_id, paired?.pairing_token, options);
  return { robot_id: paired.robot_id, device_type: paired.device_type };
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

export async function factoryResetHomeRobot(robotId, accessToken, options = {}) {
  if (!accessToken) throw new Error('Authentication is required');
  if (typeof robotId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(robotId)) throw new Error('A valid robot is required');
  if (!options.accountId) throw new Error('An authenticated account is required');
  const pairingToken = await loadRobotPairingCredential(options.accountId, robotId, options);
  if (!pairingToken) throw new Error('The robot pairing credential is unavailable');
  const result = await safetyRequest(`/v1/devices/home-robots/${encodeURIComponent(robotId)}`, {
    ...options,
    accessToken,
    method: 'DELETE',
    headers: { 'X-Device-Pairing-Token': pairingToken }
  });
  await removeRobotPairingCredential(options.accountId, robotId, options);
  return result;
}
