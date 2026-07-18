const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MAX_ACKNOWLEDGEMENTS = 20;

function telemetryError(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizedAcknowledgements(telemetry) {
  const value = telemetry?.medication_acknowledgements;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ACKNOWLEDGEMENTS) {
    throw telemetryError(
      'MEDICATION_ACK_CONTRACT_INVALID',
      'Robot medication acknowledgements are invalid.'
    );
  }
  const acknowledgements = [];
  const seen = new Set();
  for (const candidate of value) {
    const reminderId = candidate?.reminder_id;
    const receiptId = candidate?.receipt_id;
    const deliveredAt = Number(candidate?.delivered_at);
    if (
      !candidate
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || !IDENTIFIER_PATTERN.test(reminderId || '')
      || !IDENTIFIER_PATTERN.test(receiptId || '')
      || !Number.isSafeInteger(deliveredAt)
      || deliveredAt <= 0
    ) {
      throw telemetryError(
        'MEDICATION_ACK_CONTRACT_INVALID',
        'Robot medication acknowledgement is invalid.'
      );
    }
    const key = `${reminderId}:${receiptId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    acknowledgements.push({ reminderId, receiptId, deliveredAt });
  }
  return acknowledgements;
}

/**
 * Bridges only manufacturer telemetry obtained through the authenticated,
 * account-bound status route. There is intentionally no public callback URL
 * on the mobile client.
 */
export async function recordMedicationDeliveryTelemetry({
  deviceId,
  telemetry,
  recordRobotDelivery
} = {}) {
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId)) {
    throw telemetryError('MEDICATION_ACK_DEVICE_INVALID', 'Robot identity is invalid.');
  }
  if (typeof recordRobotDelivery !== 'function') {
    throw telemetryError('MEDICATION_ACK_HANDLER_UNAVAILABLE', 'Medication delivery handler is unavailable.');
  }
  const acknowledgements = normalizedAcknowledgements(telemetry);
  const recorded = [];
  for (const acknowledgement of acknowledgements) {
    recorded.push(await recordRobotDelivery(
      acknowledgement.reminderId,
      acknowledgement.receiptId,
      { robotDeviceId: deviceId }
    ));
  }
  return recorded;
}

