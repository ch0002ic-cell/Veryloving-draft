//
// routes/analytics.js — batched event ingestion (docs/BACKEND_API.md §Analytics).
//

const express = require('express');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// POST /v1/analytics/events  { events: [ { name, properties, ts } ] }
router.post('/events', (req, res) => {
  const events = (req.body && req.body.events) || [];
  console.log(`[analytics] received ${events.length} event(s) from ${req.user.id}`);
  res.json({ success: true, accepted: events.length });
});

module.exports = router;
