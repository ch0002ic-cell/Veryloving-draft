export class PhoneCallUnavailableError extends Error {
  constructor(code = 'PHONE_CALL_UNAVAILABLE') {
    super('Phone calls are unavailable on this device.');
    this.name = 'PhoneCallUnavailableError';
    this.code = code;
  }
}

export function phoneCallURL(phone) {
  const normalizedPhone = String(phone || '').trim();
  if (!normalizedPhone) throw new PhoneCallUnavailableError('PHONE_NUMBER_MISSING');
  return `tel:${normalizedPhone}`;
}

export async function openPhoneCall(phone, linking) {
  const url = phoneCallURL(phone);
  if (!linking?.canOpenURL || !linking?.openURL) {
    throw new PhoneCallUnavailableError();
  }

  let supported = false;
  try {
    supported = await linking.canOpenURL(url);
  } catch {
    throw new PhoneCallUnavailableError('PHONE_CALL_CHECK_FAILED');
  }
  if (!supported) throw new PhoneCallUnavailableError();

  try {
    await linking.openURL(url);
  } catch {
    throw new PhoneCallUnavailableError('PHONE_CALL_OPEN_FAILED');
  }
  return url;
}
