import { runLocalUserDataMutation } from './local-mutation-coordinator';
import { storage } from './storage';

export const DEVICE_COMMAND_QUEUE_KEY = 'veryloving.deviceCommandQueue.v1';
const MAX_COMMANDS = 100;
let mutationQueue = Promise.resolve();

function mutate(mutator, storageImpl = storage) {
  const operation = mutationQueue.catch(() => {}).then(() => runLocalUserDataMutation(async () => {
    const current = await storageImpl.getJSON(DEVICE_COMMAND_QUEUE_KEY, []);
    const next = await mutator(Array.isArray(current) ? current : []);
    await storageImpl.setJSON(DEVICE_COMMAND_QUEUE_KEY, next);
    return next;
  }));
  mutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function enqueueDeviceCommand({ accountId, deviceId, command }, { storageImpl = storage, now = Date.now } = {}) {
  if (!accountId || !deviceId || !command || typeof command !== 'object') throw new Error('A bound device command is required.');
  if (JSON.stringify(command).length > 16 * 1024) throw new Error('Device command is too large.');
  const requestedIdempotencyKey = typeof command.idempotency_key === 'string'
    && /^[A-Za-z0-9._:-]{1,160}$/.test(command.idempotency_key)
    ? command.idempotency_key
    : null;
  const queued = {
    id: `device-command-${now()}-${Math.random().toString(36).slice(2, 9)}`,
    idempotencyKey: requestedIdempotencyKey,
    accountId,
    deviceId,
    command,
    createdAt: now(),
    attempts: 0
  };
  await mutate((items) => {
    if (items.length >= MAX_COMMANDS) {
      const error = new Error('The local device command queue is full.');
      error.code = 'DEVICE_COMMAND_QUEUE_FULL';
      throw error;
    }
    return [...items, queued];
  }, storageImpl);
  return queued;
}

export async function loadDeviceCommands(accountId, deviceId, { storageImpl = storage } = {}) {
  await mutationQueue.catch(() => {});
  const items = await storageImpl.getJSON(DEVICE_COMMAND_QUEUE_KEY, []);
  return (Array.isArray(items) ? items : []).filter((item) => item.accountId === accountId && item.deviceId === deviceId);
}

export function acknowledgeDeviceCommand(commandId, { storageImpl = storage } = {}) {
  return mutate((items) => items.filter((item) => item.id !== commandId), storageImpl);
}
