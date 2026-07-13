export async function runSOSFlow({ contacts = [], confirmCall, openDialer, dispatchSOS }) {
  const contact = contacts.find((item) => item?.phone);
  if (!contact) return { status: 'contact_required' };

  if (!await confirmCall(contact)) {
    return { status: 'cancelled', contact };
  }

  // Never make the device-native emergency fallback wait on the network. The
  // independent outcomes are reconciled after both operations settle.
  const dialerPromise = Promise.resolve().then(() => openDialer(contact.phone));
  const backendPromise = typeof dispatchSOS === 'function'
    ? Promise.resolve().then(() => dispatchSOS(contacts))
    : null;
  const [dialerResult, backendResult] = await Promise.all([
    dialerPromise.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason })),
    backendPromise
      ? backendPromise.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }))
      : Promise.resolve({ status: 'disabled' })
  ]);
  const backendReceipt = backendResult.status === 'fulfilled' ? backendResult.value : null;
  const backendError = backendResult.status === 'rejected' ? backendResult.reason : null;
  if (dialerResult.status === 'rejected') {
    // Preserve the server outcome even if the local dialer subsequently
    // fails, so reconciliation never retries an already accepted SOS blindly.
    const dialerError = dialerResult.reason instanceof Error
      ? dialerResult.reason
      : new Error('The emergency call could not be opened.');
    try {
      dialerError.backendStatus = backendError ? 'failed' : backendReceipt ? 'accepted' : 'disabled';
      dialerError.backendReceipt = backendReceipt;
    } catch {
      // Some native modules may reject with a frozen error-like value. Keep
      // the failure actionable without letting error decoration mask it.
    }
    throw dialerError;
  }
  return {
    status: 'dialer_opened',
    contact,
    backendStatus: backendError ? 'failed' : backendReceipt ? 'accepted' : 'disabled',
    backendReceipt,
    backendError
  };
}
