//
// routes/devices.js — paired-device registry, APNs push-token upload, firmware.
//
// The client (RemoteDeviceService) calls POST /v1/devices/push-token with
// { apns_token, environment }. The Phase 4 brief calls POST /v1/devices/token
// with { token, deviceId? }. Both are handled.
//

const express = require('express');
const { v4: uuidv4 } = require('uuid');

const store = require('../store');
const { requireAuth } = require('../auth');
const { registerToken } = require('../services/push');

const router = express.Router();
router.use(requireAuth);

function devicesFor(userId) {
  return store.db.devicesByUser[userId] || (store.db.devicesByUser[userId] = []);
}
function tokensFor(userId) {
  return store.db.pushTokensByUser[userId] || (store.db.pushTokensByUser[userId] = []);
}

// POST /v1/devices — register a paired jewelry device
router.post('/', (req, res) => {
  const { ble_identifier: bleIdentifier, name, firmware_version: firmwareVersion } = req.body || {};
  if (!bleIdentifier) return res.status(400).json({ message: 'Missing ble_identifier.' });
  const device = {
    id: `dev_${uuidv4()}`,
    ble_identifier: bleIdentifier,
    name: name || 'Veryloving Jewelry',
    firmware_version: firmwareVersion || null,
  };
  devicesFor(req.user.id).push(device);
  store.save();
  res.status(201).json(device);
});

// DELETE /v1/devices/:id — unpair
router.delete('/:id', (req, res) => {
  store.db.devicesByUser[req.user.id] = devicesFor(req.user.id).filter((d) => d.id !== req.params.id);
  store.save();
  res.status(204).end();
});

// Shared push-token handler for both endpoint spellings.
function handlePushToken(req, res) {
  const body = req.body || {};
  const token = body.apns_token || body.token; // client uses apns_token; brief uses token
  const environment = body.environment || 'unknown';
  const deviceId = body.device_id || body.deviceId || null;
  if (!token) return res.status(400).json({ message: 'Missing device token.' });

  const tokens = tokensFor(req.user.id);
  const existing = tokens.find((t) => t.token === token);
  if (existing) {
    existing.environment = environment;
    existing.deviceId = deviceId;
  } else {
    tokens.push({ token, environment, deviceId, registeredAt: new Date().toISOString() });
  }
  store.save();
  registerToken({ userId: req.user.id, token, environment, deviceId });
  res.json({ success: true });
}

// POST /v1/devices/push-token  (iOS client) and /v1/devices/token (brief alias)
router.post('/push-token', handlePushToken);
router.post('/token', handlePushToken);

// GET /v1/devices/:id/firmware — OTA metadata (stubbed)
router.get('/:id/firmware', (req, res) => {
  res.json({
    latest_version: '1.0.0',
    url: 'https://firmware.veryloving.ai/jewelry/1.0.0.bin',
    notes: 'Initial production firmware.',
  });
});

module.exports = router;
