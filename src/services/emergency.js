import { Alert, Linking, Share } from 'react-native';
import { openPhoneCall } from './phone-call';
import { runSOSFlow } from './sos-flow';
import {
  clearPendingSOSAttempt,
  loadOrCreatePendingSOSAttempt,
  markSOSAttemptAccepted,
  runAndPersistSOS
} from './sos-state';
import { shareLocationSnapshot } from './location-share';
import { translate } from '../i18n/core';
import { config } from '../utils/config';
import { dispatchSOS as dispatchBackendSOS } from './safety-api';
import { createAuthenticationNonce, sessionTokenClaims } from '../utils/session-token';

function confirmEmergencyCall(contact) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };
    Alert.alert(
      translate('emergency.title'),
      translate('emergency.callContact', { name: contact.name }),
      [
        { text: translate('common.cancel'), style: 'cancel', onPress: () => finish(false) },
        { text: translate('common.call'), onPress: () => finish(true) }
      ],
      { cancelable: true, onDismiss: () => finish(false) }
    );
  });
}

async function finalizeAcceptedSOSAttempt(idempotencyKey) {
  if (!idempotencyKey) return;
  try {
    // Keep the accepted tombstone until the next activation replaces it. A
    // process restart between acceptance and cleanup therefore cannot reuse the
    // completed request as though it were an indeterminate retry.
    await markSOSAttemptAccepted(idempotencyKey);
  } catch {
    // If durable state could not be updated, removing the old pending key is the
    // next safest outcome. markSOSAttemptAccepted also retains an in-memory
    // acceptance guard when both operations are unavailable.
    await clearPendingSOSAttempt(idempotencyKey).catch(() => {});
  }
}

export async function triggerSOS(contacts = [], {
  accessToken,
  accountId,
  location,
  medicalAttachment,
  idempotencyKey
} = {}) {
  const backendEnabled = config.safetyBackendEnabled && Boolean(accessToken);
  const synchronizedContactIds = contacts
    .map((contact) => contact.id)
    .filter((id) => /^contact_[A-Za-z0-9_-]{24}$/.test(id));
  // A locally cached contact is still sufficient for the device-native call
  // fallback. Connected delivery is optional until at least one contact has
  // successfully synchronized with the backend.
  const connectedDeliveryEnabled = backendEnabled && synchronizedContactIds.length > 0;
  let pendingAttempt = null;
  let pendingAttemptPromise = null;
  if (connectedDeliveryEnabled) {
    const authenticatedAccountId = accountId || sessionTokenClaims(accessToken)?.sub;
    // Do not await local idempotency bookkeeping before entering runSOSFlow.
    // The native dialer must be able to open in parallel even when storage is
    // slow or briefly unavailable. Promise.resolve also normalizes a
    // synchronous storage/precondition failure into the safe fallback path.
    pendingAttemptPromise = Promise.resolve()
      .then(() => loadOrCreatePendingSOSAttempt({
        accountId: authenticatedAccountId,
        contactIds: synchronizedContactIds,
        ...(idempotencyKey ? { createId: () => idempotencyKey } : {})
      }))
      .catch(() => ({ idempotencyKey: createAuthenticationNonce() }));
  }
  let result;
  try {
    result = await runAndPersistSOS(() => runSOSFlow({
      contacts,
      confirmCall: confirmEmergencyCall,
      openDialer: callNumber,
      dispatchSOS: connectedDeliveryEnabled
        ? async () => {
          pendingAttempt = await pendingAttemptPromise;
          return dispatchBackendSOS({
            accessToken,
            idempotencyKey: pendingAttempt.idempotencyKey,
            contactIds: synchronizedContactIds,
            location,
            medicalAttachment
          });
        }
        : undefined
    }));
  } catch (error) {
    if (error?.backendStatus === 'accepted') {
      await finalizeAcceptedSOSAttempt(pendingAttempt?.idempotencyKey);
    }
    throw error;
  }
  if (result.backendStatus === 'accepted' && pendingAttempt?.idempotencyKey) {
    await finalizeAcceptedSOSAttempt(pendingAttempt.idempotencyKey);
  }
  return result;
}

export function callNumber(phone) {
  return openPhoneCall(phone, Linking);
}

export function shareQuickLocation(location, options) {
  return shareLocationSnapshot(location, Share, options);
}
