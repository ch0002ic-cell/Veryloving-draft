//
// routes/subscription.js — subscription status + receipt validation.
//
// In production POST /v1/subscription/validate performs server-side App Store /
// RevenueCat receipt validation and is the authoritative source of the user's
// tier. This reference implementation trusts the client and echoes a tier so
// the gating UX can be exercised end-to-end.
//

const express = require('express');

const store = require('../store');
const { requireAuth } = require('../auth');
const { iso } = require('../util/time');

const router = express.Router();
router.use(requireAuth);

const TIERS = ['free', 'plus', 'pro'];

function statusFor(userId) {
  return store.db.subscriptionsByUser[userId] || { tier: 'free', expiresAt: null, inTrial: false };
}

// GET /v1/subscription/status  (Phase 4 brief)
router.get('/status', (req, res) => {
  const s = statusFor(req.user.id);
  res.json({
    tier: s.tier,
    expires_at: s.expiresAt ? iso(s.expiresAt) : null,
  });
});

// POST /v1/subscription/validate  { platform, receipt }
router.post('/validate', (req, res) => {
  const { receipt } = req.body || {};
  if (!receipt) return res.status(400).json({ message: 'Missing receipt.' });

  // Stub: in a real backend the receipt determines the tier. Here we grant
  // "plus" for any non-empty receipt with a 30-day window, persisted per user.
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const tier = TIERS.includes(req.body.tier) ? req.body.tier : 'plus';
  store.db.subscriptionsByUser[req.user.id] = { tier, expiresAt, inTrial: true };
  // Reflect entitlement on the user so AuthResponse/refresh report it too.
  req.user.subscriptionTier = tier;
  store.save();
  console.log(`[subscription] validated receipt for ${req.user.email} → ${tier}`);

  res.json({
    subscription_tier: tier,
    expires_at: iso(expiresAt),
    in_trial: true,
    // Aliases for the brief's { valid, tier } contract:
    valid: true,
    tier,
  });
});

module.exports = router;
