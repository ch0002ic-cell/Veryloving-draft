import nacl from 'tweetnacl';
import { base64ToBytes, decodeBase64URLJSON } from '../utils/base64';
import { deviceRegistry } from './device-manager/DeviceRegistry';
import { deviceActionReplayStore } from './device-action-replay-store';

const WEARABLE_ACTIONS = new Set(['deploy_barrier', 'emit_alarm', 'trigger_sos', 'stop']);

function asciiBytes(value) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

export function verifyWearableActionEnvelope(message, { publicKey = '', now = Date.now } = {}) {
  if (
    message?.type !== 'device_action'
    || message?.algorithm !== 'Ed25519'
    || typeof message?.payload !== 'string'
    || typeof message?.signature !== 'string'
  ) throw new Error('Wearable action signature is invalid.');
  let publicKeyBytes;
  let signatureBytes;
  let envelope;
  try {
    publicKeyBytes = base64ToBytes(publicKey);
    signatureBytes = base64ToBytes(message.signature);
    envelope = decodeBase64URLJSON(message.payload);
  } catch {
    throw new Error('Wearable action signature is invalid.');
  }
  if (
    publicKeyBytes.length !== nacl.sign.publicKeyLength
    || signatureBytes.length !== nacl.sign.signatureLength
    || !nacl.sign.detached.verify(asciiBytes(message.payload), signatureBytes, publicKeyBytes)
  ) throw new Error('Wearable action signature is invalid.');
  if (
    envelope?.version !== 1
    || typeof envelope.id !== 'string'
    || message.envelope?.id !== envelope.id
    || !WEARABLE_ACTIONS.has(envelope.action)
    || envelope.device_type !== 'wearable'
    || !Number.isFinite(envelope.issued_at)
    || Math.abs(now() - envelope.issued_at) > 60 * 1000
  ) throw new Error('Wearable action envelope is invalid or stale.');
  return envelope;
}

export async function dispatchWearableAction(message, {
  registry = deviceRegistry,
  replayStore = deviceActionReplayStore,
  publicKey = '',
  now = Date.now
} = {}) {
  const envelope = verifyWearableActionEnvelope(message, { publicKey, now });
  const expiresAt = envelope.issued_at + 60 * 1000;
  const reserved = typeof replayStore.reserve === 'function'
    ? await replayStore.reserve(envelope.id, expiresAt)
    : !await replayStore.has(envelope.id);
  if (!reserved) throw new Error('Wearable action envelope was already used.');
  const device = registry.get(envelope.device_id);
  try {
    if (!device || device.deviceType !== 'wearable' || device.getStatus().online !== true) {
      throw new Error('The requested wearable is offline.');
    }
    const payload = envelope.parameters?.command_payload;
    if (typeof payload !== 'string' || !payload || payload.length > 1024) throw new Error('Wearable command payload is invalid.');
    const result = await device.sendCommand({
      payload,
      action: envelope.action,
      priority: envelope.action === 'stop' ? 'critical' : 'standard',
      withResponse: true
    });
    if (typeof replayStore.reserve !== 'function') await replayStore.remember(envelope.id, expiresAt);
    return result;
  } catch (error) {
    await replayStore.release?.(envelope.id).catch?.(() => {});
    throw error;
  }
}
