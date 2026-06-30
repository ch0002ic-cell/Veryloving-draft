//
// auth.js — JWT issuance/verification, user serialisation, and the bearer-token
// middleware that guards authenticated routes.
//

const jwt = require('jsonwebtoken');
const config = require('./config');
const store = require('./store');
const { iso } = require('./util/time');

function signAccess(user) {
  return jwt.sign({ sub: user.id, type: 'access' }, config.jwtSecret, {
    expiresIn: config.accessTtlSeconds,
  });
}

function signRefresh(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, config.jwtSecret, {
    expiresIn: config.refreshTtlSeconds,
  });
}

/**
 * Public representation of a user. Keys are snake_case because the iOS client
 * decodes with `.convertFromSnakeCase`. `created_at` is non-fractional ISO (see
 * util/time.js) so the client's `.iso8601` Date decoder accepts it.
 */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName ?? null,
    subscription_tier: user.subscriptionTier || 'free',
    created_at: iso(user.createdAt),
  };
}

/** The `AuthResponse` envelope every auth endpoint returns. */
function authResponse(user) {
  return {
    user: publicUser(user),
    access_token: signAccess(user),
    refresh_token: signRefresh(user),
    expires_in: config.accessTtlSeconds,
  };
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, value] = header.split(' ');
  if (scheme && scheme.toLowerCase() === 'bearer' && value) return value;
  return null;
}

/**
 * Express middleware: require a valid access token. On success attaches the
 * resolved user record to `req.user`. Mirrors the client's expectations:
 * missing/expired/invalid token → 401 (the app clears the session and re-auths).
 */
function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
  }
  if (payload.type !== 'access') {
    return res.status(401).json({ message: 'Invalid token.' });
  }
  const user = store.db.users.find((u) => u.id === payload.sub);
  if (!user) {
    return res.status(401).json({ message: 'Account not found.' });
  }
  req.user = user;
  next();
}

module.exports = {
  signAccess,
  signRefresh,
  publicUser,
  authResponse,
  requireAuth,
  bearerToken,
};
