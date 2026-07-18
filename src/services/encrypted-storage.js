import nacl from 'tweetnacl';
import { base64ToBytes, bytesToBase64, utf8BytesToString } from '../utils/base64';

export const ENCRYPTED_STORAGE_PREFIX = 'VLENC1.';
export const ENCRYPTED_STORAGE_KEY_NAME = 'veryloving.localStorage.encryptionKey.v1';

function utf8Bytes(value) {
  const encoded = encodeURIComponent(String(value));
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === '%') {
      bytes.push(Number.parseInt(encoded.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(encoded.charCodeAt(index));
    }
  }
  return Uint8Array.from(bytes);
}

function storageError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function parseKey(raw) {
  try {
    const key = base64ToBytes(raw);
    if (key.length === nacl.secretbox.keyLength) return key;
  } catch {}
  throw storageError('LOCAL_STORAGE_KEY_INVALID', 'The local encryption key is invalid.');
}

function parseEnvelope(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(ENCRYPTED_STORAGE_PREFIX)) return null;
  const parts = raw.slice(ENCRYPTED_STORAGE_PREFIX.length).split('.');
  if (parts.length !== 2) throw storageError('LOCAL_STORAGE_ENVELOPE_INVALID', 'Encrypted local data is malformed.');
  try {
    const nonce = base64ToBytes(parts[0]);
    const ciphertext = base64ToBytes(parts[1]);
    if (nonce.length !== nacl.secretbox.nonceLength || ciphertext.length < nacl.secretbox.overheadLength) {
      throw new Error('invalid envelope lengths');
    }
    return { nonce, ciphertext };
  } catch (error) {
    throw storageError('LOCAL_STORAGE_ENVELOPE_INVALID', 'Encrypted local data is malformed.', error);
  }
}

/**
 * Encrypt AsyncStorage values with a Keychain/Keystore-held key. The key name
 * is bound inside the authenticated plaintext so swapping two ciphertext
 * values cannot make one store deserialize data intended for another.
 *
 * Legacy plaintext values are migrated atomically on their first successful
 * read. A failed migration is fail-closed: callers never continue using a
 * sensitive plaintext value that could not be encrypted.
 */
export function createEncryptedStorage({ backend, keyStore, randomBytes }) {
  if (!backend || !keyStore || typeof randomBytes !== 'function') {
    throw new TypeError('Encrypted storage requires a backend, key store, and secure random source.');
  }
  let keyPromise = null;

  const loadOrCreateKey = () => {
    if (!keyPromise) {
      const operation = (async () => {
        const existing = await keyStore.getItemAsync(ENCRYPTED_STORAGE_KEY_NAME);
        if (existing) return parseKey(existing);
        const generated = Uint8Array.from(await randomBytes(nacl.secretbox.keyLength));
        if (generated.length !== nacl.secretbox.keyLength) {
          throw storageError('LOCAL_STORAGE_RANDOM_INVALID', 'Secure random key generation failed.');
        }
        await keyStore.setItemAsync(ENCRYPTED_STORAGE_KEY_NAME, bytesToBase64(generated));
        return generated;
      })();
      keyPromise = operation;
      operation.catch(() => {
        if (keyPromise === operation) keyPromise = null;
      });
    }
    return keyPromise;
  };

  const encrypt = async (storageKey, plaintext) => {
    const [key, nonceValue] = await Promise.all([
      loadOrCreateKey(),
      randomBytes(nacl.secretbox.nonceLength)
    ]);
    const nonce = Uint8Array.from(nonceValue);
    if (nonce.length !== nacl.secretbox.nonceLength) {
      throw storageError('LOCAL_STORAGE_RANDOM_INVALID', 'Secure nonce generation failed.');
    }
    const boundPlaintext = utf8Bytes(`${storageKey}\u0000${plaintext}`);
    const ciphertext = nacl.secretbox(boundPlaintext, nonce, key);
    return `${ENCRYPTED_STORAGE_PREFIX}${bytesToBase64(nonce)}.${bytesToBase64(ciphertext)}`;
  };

  const decrypt = async (storageKey, raw) => {
    const envelope = parseEnvelope(raw);
    if (!envelope) return null;
    const plaintext = nacl.secretbox.open(envelope.ciphertext, envelope.nonce, await loadOrCreateKey());
    if (!plaintext) throw storageError('LOCAL_STORAGE_AUTHENTICATION_FAILED', 'Encrypted local data failed authentication.');
    let decoded;
    try {
      decoded = utf8BytesToString(plaintext);
    } catch (error) {
      throw storageError('LOCAL_STORAGE_PLAINTEXT_INVALID', 'Encrypted local data could not be decoded.', error);
    }
    const separator = decoded.indexOf('\u0000');
    if (separator < 0 || decoded.slice(0, separator) !== storageKey) {
      throw storageError('LOCAL_STORAGE_KEY_BINDING_FAILED', 'Encrypted local data belongs to a different store.');
    }
    return decoded.slice(separator + 1);
  };

  const getItem = async (storageKey) => {
    const raw = await backend.getItem(storageKey);
    if (raw === null || raw === undefined) return null;
    if (String(raw).startsWith(ENCRYPTED_STORAGE_PREFIX)) return decrypt(storageKey, raw);
    try {
      await backend.setItem(storageKey, await encrypt(storageKey, String(raw)));
    } catch (error) {
      throw storageError(
        'LOCAL_STORAGE_MIGRATION_FAILED',
        'Legacy local data could not be migrated to encrypted storage.',
        error
      );
    }
    return String(raw);
  };

  return {
    getAllKeys: () => backend.getAllKeys(),
    getItem,
    async setItem(storageKey, value) {
      await backend.setItem(storageKey, await encrypt(storageKey, String(value)));
    },
    removeItem: (storageKey) => backend.removeItem(storageKey),
    multiRemove: (storageKeys) => backend.multiRemove(storageKeys),
    async rotateKeyAfterPurge() {
      await keyStore.deleteItemAsync(ENCRYPTED_STORAGE_KEY_NAME);
      keyPromise = null;
    }
  };
}
