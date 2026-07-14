import { Alert, Linking, Share } from 'react-native';
import { openPhoneCall } from './phone-call';
import { runSOSFlow } from './sos-flow';
import {
  clearPendingSOSAttempt,
  loadOrCreatePendingSOSAttempt,
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

export async function triggerSOS(contacts = [], { accessToken, accountId, location } = {}) {
  const backendEnabled = config.safetyBackendEnabled && Boolean(accessToken);
  let pendingAttempt = null;
  if (backendEnabled) {
    const synchronizedContactIds = contacts
      .map((contact) => contact.id)
      .filter((id) => /^contact_[A-Za-z0-9_-]{24}$/.test(id));
    const authenticatedAccountId = accountId || sessionTokenClaims(accessToken)?.sub;
    pendingAttempt = await loadOrCreatePendingSOSAttempt({
      accountId: authenticatedAccountId,
      contactIds: synchronizedContactIds
    }).catch(() => ({ idempotencyKey: createAuthenticationNonce() }));
  }
  const result = await runAndPersistSOS(() => runSOSFlow({
    contacts,
    confirmCall: confirmEmergencyCall,
    openDialer: callNumber,
    dispatchSOS: backendEnabled
      ? (allContacts) => dispatchBackendSOS({
        accessToken,
        idempotencyKey: pendingAttempt.idempotencyKey,
        contactIds: allContacts.map((contact) => contact.id).filter(Boolean),
        location
      })
      : undefined
  }));
  if (result.backendStatus === 'accepted' && pendingAttempt?.idempotencyKey) {
    await clearPendingSOSAttempt(pendingAttempt.idempotencyKey).catch(() => {});
  }
  return result;
}

export function callNumber(phone) {
  return openPhoneCall(phone, Linking);
}

export function shareQuickLocation(location) {
  return shareLocationSnapshot(location, Share);
}
