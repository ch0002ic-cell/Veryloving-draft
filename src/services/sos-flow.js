export async function runSOSFlow({ contacts = [], confirmCall, openDialer }) {
  const contact = contacts.find((item) => item?.phone);
  if (!contact) return { status: 'contact_required' };

  if (!await confirmCall(contact)) {
    return { status: 'cancelled', contact };
  }

  await openDialer(contact.phone);
  return { status: 'dialer_opened', contact };
}
