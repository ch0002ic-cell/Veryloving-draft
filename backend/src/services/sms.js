//
// services/sms.js — MOCK SMS gateway.
//
// In production this is where Twilio (or similar) would fan out the SOS alert.
// Here we just log to the console so you can watch dispatches happen during
// local testing. The function signature matches what a real adapter would
// expose, so swapping in Twilio later is a one-file change.
//

/**
 * "Send" an SMS by logging it. Returns a fake provider message id.
 * @param {{ to: string, body: string }} message
 */
function sendSMS({ to, body }) {
  const id = `mock_sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[SMS] → ${to}\n      ${body}\n      (message id: ${id})`);
  return { id, to, status: 'sent' };
}

module.exports = { sendSMS };
