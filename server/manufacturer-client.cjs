'use strict';

function createManufacturerPairingVerifier({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function verifyPairingCode(qrCode) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ pairing_code: qrCode }),
        signal: controller.signal
      });
      if (response.status === 404 || response.status === 409 || response.status === 410) return null;
      if (!response.ok) throw new Error(`Manufacturer pairing service returned ${response.status}`);
      const body = await response.json();
      return {
        hardwareSerial: body.hardware_serial,
        manufacturerDeviceId: body.manufacturer_device_id,
        oneTime: body.one_time === true,
        expiresAt: Number(body.expires_at)
      };
    } finally { clearTimeout(timeout); }
  };
}

function createManufacturerRobotStatusClient({ url, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function getRobotStatus(robotId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Manufacturer-Api-Key': apiKey },
        body: JSON.stringify({ robot_id: robotId }),
        signal: controller.signal
      });
      if (response.status === 404) return { online: false, hardware_status: 'offline' };
      if (!response.ok) throw new Error(`Manufacturer status service returned ${response.status}`);
      const body = await response.json();
      const longitude = Number(body?.location?.longitude);
      const latitude = Number(body?.location?.latitude);
      const location = Number.isFinite(longitude) && Math.abs(longitude) <= 180
        && Number.isFinite(latitude) && Math.abs(latitude) <= 90
        ? { longitude, latitude }
        : undefined;
      return {
        online: body.online === true,
        hardware_status: body.online === true ? 'online' : 'offline',
        ...(location ? { location } : {}),
        reported_at: Number.isFinite(Number(body.reported_at)) ? Number(body.reported_at) : Date.now()
      };
    } finally { clearTimeout(timeout); }
  };
}

module.exports = { createManufacturerPairingVerifier, createManufacturerRobotStatusClient };
