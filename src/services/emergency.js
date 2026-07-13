import { Alert, Linking } from 'react-native';
import { openPhoneCall } from './phone-call';
import { runSOSFlow } from './sos-flow';
import { runAndPersistSOS } from './sos-state';
import { translate } from '../i18n/core';

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

export async function triggerSOS(contacts = []) {
  return runAndPersistSOS(() => runSOSFlow({
    contacts,
    confirmCall: confirmEmergencyCall,
    openDialer: callNumber
  }));
}

export function callNumber(phone) {
  return openPhoneCall(phone, Linking);
}

export function shareQuickLocation() {
  Alert.alert(translate('emergency.quickShareTitle'), translate('emergency.quickShareMessage'));
}
