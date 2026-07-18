import { secureStorage } from './secure-storage';
import { runLocalUserDataMutation } from './local-mutation-coordinator';

export const ROBOT_PAIRING_CREDENTIALS_KEY = 'veryloving.robotPairingCredentials.secure.v1';
const ROBOT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
let credentialMutationQueue = Promise.resolve();

function mutateCredentials(mutation, { cleanup = false } = {}) {
  const previous = credentialMutationQueue;
  const execute = () => previous.catch(() => {}).then(mutation);
  // User-initiated writes join the shared privacy/logout drain immediately.
  // Cleanup itself is allowed to run while that shared lock is held, but still
  // waits for every credential mutation that was registered before it.
  const operation = cleanup ? execute() : runLocalUserDataMutation(execute);
  credentialMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

function validAccountId(value) {
  return typeof value === 'string' && value.trim() && value.length <= 512
    ? value.trim()
    : null;
}

function parse(raw, accountId) {
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || value.accountId !== accountId || !value.credentials || typeof value.credentials !== 'object') {
      return {};
    }
    return Object.fromEntries(Object.entries(value.credentials).filter(([robotId, token]) => (
      ROBOT_ID_PATTERN.test(robotId) && TOKEN_PATTERN.test(token)
    )));
  } catch {
    return {};
  }
}

async function loadSnapshot(accountId, secureStorageImpl) {
  const normalized = validAccountId(accountId);
  if (!normalized) throw new Error('An authenticated account is required for robot credentials.');
  const raw = await secureStorageImpl.getItemAsync(ROBOT_PAIRING_CREDENTIALS_KEY);
  return { accountId: normalized, credentials: raw ? parse(raw, normalized) : {} };
}

export async function saveRobotPairingCredential(accountId, robotId, token, {
  secureStorageImpl = secureStorage
} = {}) {
  if (!ROBOT_ID_PATTERN.test(robotId || '') || !TOKEN_PATTERN.test(token || '')) {
    throw new Error('The robot pairing credential is invalid.');
  }
  return mutateCredentials(async () => {
    const snapshot = await loadSnapshot(accountId, secureStorageImpl);
    snapshot.credentials[robotId] = token;
    await secureStorageImpl.setItemAsync(ROBOT_PAIRING_CREDENTIALS_KEY, JSON.stringify({ version: 1, ...snapshot }));
    return true;
  });
}

export async function loadRobotPairingCredential(accountId, robotId, {
  secureStorageImpl = secureStorage
} = {}) {
  if (!ROBOT_ID_PATTERN.test(robotId || '')) return null;
  await credentialMutationQueue.catch(() => {});
  const snapshot = await loadSnapshot(accountId, secureStorageImpl);
  return snapshot.credentials[robotId] || null;
}

export async function removeRobotPairingCredential(accountId, robotId, {
  secureStorageImpl = secureStorage
} = {}) {
  if (!ROBOT_ID_PATTERN.test(robotId || '')) return false;
  return mutateCredentials(async () => {
    const snapshot = await loadSnapshot(accountId, secureStorageImpl);
    if (!snapshot.credentials[robotId]) return false;
    delete snapshot.credentials[robotId];
    await secureStorageImpl.setItemAsync(ROBOT_PAIRING_CREDENTIALS_KEY, JSON.stringify({ version: 1, ...snapshot }));
    return true;
  });
}

export function clearRobotPairingCredentials({ secureStorageImpl = secureStorage } = {}) {
  return mutateCredentials(
    () => secureStorageImpl.deleteItemAsync(ROBOT_PAIRING_CREDENTIALS_KEY),
    { cleanup: true }
  );
}
