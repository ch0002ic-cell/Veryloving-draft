//
// routes/auth.js — register / login / apple / refresh.
//
// Mounted at BOTH `/v1/auth` (what the iOS client calls — see
// RemoteAuthService) and `/auth` (the simplified alias from the Phase 4 brief).
// All four endpoints return the same `AuthResponse` envelope.
//

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const config = require('../config');
const store = require('../store');
const { authResponse, bearerToken } = require('../auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findByEmail(email) {
  const lower = String(email).toLowerCase();
  return store.db.users.find((u) => u.email.toLowerCase() === lower);
}

// POST /auth/register  { email, password, display_name? }
router.post('/register', async (req, res) => {
  const { email, password, display_name: displayName } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }
  if (findByEmail(email)) {
    return res.status(409).json({ message: 'An account with that email already exists.' });
  }
  const user = {
    id: `usr_${uuidv4()}`,
    email,
    passwordHash: await bcrypt.hash(String(password), config.bcryptRounds),
    displayName: displayName || email.split('@')[0],
    subscriptionTier: 'free',
    createdAt: new Date().toISOString(),
  };
  store.db.users.push(user);
  store.save();
  console.log(`[auth] registered ${user.email} (${user.id})`);
  res.status(201).json(authResponse(user));
});

// POST /auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? findByEmail(email) : null;
  const ok = user && (await bcrypt.compare(String(password || ''), user.passwordHash));
  if (!ok) {
    return res.status(401).json({ message: "That email or password doesn't look right." });
  }
  console.log(`[auth] login ${user.email} (${user.id})`);
  res.json(authResponse(user));
});

// POST /auth/apple  { identity_token, full_name? }
// We can't verify Apple's signature without their JWKS, so for this reference
// backend we decode (not verify) the identity token to key the account by its
// stable `sub`, creating the user on first sign-in.
router.post('/apple', async (req, res) => {
  const { identity_token: identityToken, full_name: fullName } = req.body || {};
  if (!identityToken) {
    return res.status(400).json({ message: 'Missing Apple identity token.' });
  }
  const claims = jwt.decode(identityToken) || {};
  const appleSub = claims.sub || `apple_${uuidv4()}`;
  const email = claims.email || `${appleSub}@privaterelay.appleid.com`;

  let user = store.db.users.find((u) => u.appleSub === appleSub) || findByEmail(email);
  if (!user) {
    user = {
      id: `usr_${uuidv4()}`,
      email,
      passwordHash: null, // Apple accounts have no password.
      displayName: fullName || 'Apple User',
      subscriptionTier: 'free',
      createdAt: new Date().toISOString(),
      appleSub,
    };
    store.db.users.push(user);
    store.save();
    console.log(`[auth] apple sign-up ${user.email} (${user.id})`);
  } else {
    user.appleSub = appleSub;
    if (fullName && (!user.displayName || user.displayName === 'Apple User')) {
      user.displayName = fullName;
    }
    store.save();
    console.log(`[auth] apple sign-in ${user.email} (${user.id})`);
  }
  res.json(authResponse(user));
});

// POST /auth/refresh
// Client (RemoteAuthService) sends { refresh_token } in the body. The Phase 4
// brief describes an `Authorization: Bearer <refresh_token>` header form — we
// accept either.
router.post('/refresh', (req, res) => {
  const token = (req.body && req.body.refresh_token) || bearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Missing refresh token.' });
  }
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
  if (payload.type !== 'refresh') {
    return res.status(401).json({ message: 'Invalid refresh token.' });
  }
  const user = store.db.users.find((u) => u.id === payload.sub);
  if (!user) {
    return res.status(401).json({ message: 'Account not found.' });
  }
  res.json(authResponse(user));
});

module.exports = router;
