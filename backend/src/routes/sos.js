//
// routes/sos.js — SOS dispatch + live location updates + cancel.
//
// POST /v1/sos is the heart of the product: capture the fix, fan out SMS + push
// to the user's emergency contacts, and return an alert id. The client decodes
// `SOSDispatchResult { alert_id, notified_contacts }` (both required), so those
// two keys are ALWAYS present; we also include `status`/`dispatch_id`/`success`
// aliases for the Phase 4 brief's contract.
//

const express = require('express');

const store = require('../store');
const { requireAuth } = require('../auth');
const { iso } = require('../util/time');
const { sendSMS } = require('../services/sms');
const { sendPush } = require('../services/push');

const router = express.Router();
router.use(requireAuth);

function contactsFor(userId) {
  return store.db.contactsByUser[userId] || [];
}

function mapsLink(location) {
  if (!location || location.lat == null || location.lng == null) return null;
  return `https://maps.apple.com/?ll=${location.lat},${location.lng}&q=SOS`;
}

// POST /v1/sos
router.post('/', (req, res) => {
  const body = req.body || {};
  // Client (DispatchBody) sends { triggered_by, location:{lat,lng,accuracy_m,captured_at}, battery_level }.
  const location = body.location || null;
  const triggeredBy = body.triggered_by || 'app';

  store.db.seq.alert += 1;
  const alert = {
    id: `sos_${store.db.seq.alert}`,
    userId: req.user.id,
    triggeredBy,
    location,
    batteryLevel: body.battery_level ?? null,
    status: 'dispatched',
    createdAt: new Date().toISOString(),
    locations: location ? [location] : [],
    notifiedContacts: 0,
  };

  // Fan out to the user's emergency contacts. The brief also allows contacts to
  // be passed inline; honour that, otherwise use the stored ones.
  const targets = Array.isArray(body.contacts) && body.contacts.length
    ? body.contacts
    : contactsFor(req.user.id);

  const link = mapsLink(location);
  const who = req.user.displayName || 'A Veryloving user';
  const text =
    body.message ||
    `🚨 SOS from ${who}. They need help.${link ? ` Location: ${link}` : ' (no location available)'}`;

  for (const c of targets) {
    if (c.phone) sendSMS({ to: c.phone, body: text });
    sendPush({ to: c.phone || c.email || 'contact', type: 'sos_alert', title: 'SOS Alert', body: text });
  }
  alert.notifiedContacts = targets.length;
  store.db.alerts.push(alert);
  store.save();

  console.log(
    `[SOS] 🚨 dispatch ${alert.id} for ${req.user.email} ` +
      `(trigger: ${triggeredBy}, contacts notified: ${alert.notifiedContacts}` +
      `${alert.batteryLevel != null ? `, battery: ${alert.batteryLevel}%` : ''})`
  );

  res.status(201).json({
    alert_id: alert.id,
    status: 'dispatched',
    notified_contacts: alert.notifiedContacts,
    // Aliases for the Phase 4 brief's simplified contract:
    success: true,
    dispatch_id: alert.id,
    created_at: iso(alert.createdAt),
  });
});

// POST /v1/sos/:id/location — live updates during the sharing window
router.post('/:id/location', (req, res) => {
  const alert = store.db.alerts.find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!alert) return res.status(404).json({ message: "We couldn't find that alert." });
  alert.locations.push(req.body || {});
  alert.location = req.body || alert.location;
  store.save();
  console.log(`[SOS] location update for ${alert.id} (${alert.locations.length} fixes)`);
  res.json({ status: 'ok' });
});

// POST /v1/sos/:id/cancel — false alarm
router.post('/:id/cancel', (req, res) => {
  const alert = store.db.alerts.find((a) => a.id === req.params.id && a.userId === req.user.id);
  if (!alert) return res.status(404).json({ message: "We couldn't find that alert." });
  alert.status = 'cancelled';
  store.save();
  console.log(`[SOS] cancelled ${alert.id}`);
  res.json({ status: 'cancelled' });
});

module.exports = router;
