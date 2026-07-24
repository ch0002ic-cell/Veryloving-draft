import { safetyRequest } from './safety-api';
import {
  getRobotPairingCredentialCleanupGeneration,
  loadRobotPairingCredential,
  removeRobotPairingCredential,
  saveRobotPairingCredential
} from './robot-pairing-credential-store';

const ROBOT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const credentialRecoveries = new Map();

function assertCredentialCleanupCurrent(expectedGeneration) {
  if (getRobotPairingCredentialCleanupGeneration() === expectedGeneration) return;
  const error = new Error('Robot credential recovery was superseded by local data cleanup.');
  error.code = 'ROBOT_CREDENTIAL_CLEANUP_SUPERSEDED';
  throw error;
}

export async function pairHomeRobot(qrCode, accessToken, options = {}) {
  if (!accessToken) throw new Error('Authentication is required');
  if (typeof qrCode !== 'string' || qrCode.length < 20 || qrCode.length > 2048) {
    throw new Error('A valid manufacturer QR code is required');
  }
  if (!options.accountId) throw new Error('An authenticated account is required');
  if (options.vendor !== undefined && !['yongyida', 'jiangzhi'].includes(options.vendor)) {
    throw new Error('A supported robot manufacturer is required');
  }
  const cleanupGeneration = getRobotPairingCredentialCleanupGeneration();
  const paired = await safetyRequest('/v1/devices/home-robots/pair', {
    ...options,
    accessToken,
    method: 'POST',
    body: {
      qr_code: qrCode,
      ...(options.vendor ? { robot_vendor: options.vendor } : {})
    }
  });
  await saveRobotPairingCredential(
    options.accountId,
    paired?.robot_id,
    paired?.pairing_token,
    { ...options, expectedCleanupGeneration: cleanupGeneration }
  );
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

export async function loadOrRecoverHomeRobotCredential(robotId, accessToken, options = {}) {
  if (!ROBOT_ID_PATTERN.test(robotId || '')) throw new Error('A valid robot is required');
  if (!options.accountId) throw new Error('An authenticated account is required');
  const cleanupGeneration = getRobotPairingCredentialCleanupGeneration();
  const stored = await loadRobotPairingCredential(options.accountId, robotId, options);
  assertCredentialCleanupCurrent(cleanupGeneration);
  if (stored) return stored;
  if (!accessToken) throw new Error('Authentication is required');

  const recoveryKey = JSON.stringify([options.accountId, robotId]);
  const existing = credentialRecoveries.get(recoveryKey);
  if (existing) return existing;
  const recovery = (async () => {
    const recovered = await safetyRequest(
      `/v1/devices/home-robots/${encodeURIComponent(robotId)}/pairing-credential/recover`,
      {
        ...options,
        accessToken,
        method: 'POST',
        body: {}
      }
    );
    if (
      recovered?.robot_id !== robotId
      || recovered?.device_type !== 'home_robot'
      || !PAIRING_TOKEN_PATTERN.test(recovered?.pairing_token || '')
    ) {
      throw new Error('The recovered robot pairing credential is invalid');
    }
    await saveRobotPairingCredential(
      options.accountId,
      robotId,
      recovered.pairing_token,
      { ...options, expectedCleanupGeneration: cleanupGeneration }
    );
    return recovered.pairing_token;
  })();
  credentialRecoveries.set(recoveryKey, recovery);
  try {
    return await recovery;
  } finally {
    if (credentialRecoveries.get(recoveryKey) === recovery) {
      credentialRecoveries.delete(recoveryKey);
    }
  }
}

export async function factoryResetHomeRobot(robotId, accessToken, options = {}) {
  if (!accessToken) throw new Error('Authentication is required');
  if (typeof robotId !== 'string' || !ROBOT_ID_PATTERN.test(robotId)) throw new Error('A valid robot is required');
  if (!options.accountId) throw new Error('An authenticated account is required');
  const pairingToken = await loadOrRecoverHomeRobotCredential(robotId, accessToken, options);
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
