//
// services/push.js — PLACEHOLDER push-notification service.
//
// Real implementation would hold the APNs auth key (.p8) and talk to Apple's
// HTTP/2 gateway. Here we only log token registration and "sends" so the wiring
// is observable end-to-end without certificates.
//

/** Log that a device token was registered (called by POST /v1/devices/push-token). */
function registerToken({ userId, token, environment, deviceId }) {
  const masked = token.length > 12 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token;
  console.log(
    `[PUSH] registered APNs token for user ${userId} ` +
      `(env: ${environment || 'unknown'}${deviceId ? `, device: ${deviceId}` : ''}): ${masked}`
  );
}

/**
 * "Send" a push notification by logging it.
 * @param {{ to: string, type: string, title?: string, body?: string }} payload
 */
function sendPush({ to, type, title, body }) {
  const masked = to && to.length > 12 ? `${to.slice(0, 6)}…${to.slice(-4)}` : to;
  console.log(`[PUSH] → ${masked} type=${type}${title ? ` "${title}"` : ''}${body ? ` — ${body}` : ''}`);
}

module.exports = { registerToken, sendPush };
