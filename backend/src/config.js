//
// config.js — centralised, env-driven configuration.
//
// Reads from process.env (populated by dotenv in server.js). Every value has a
// safe development default so `npm start` works with zero setup, but secrets
// (JWT_SECRET) MUST be overridden in any non-local environment.
//

const path = require('path');

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,

  // HS256 signing secret for JWTs. Override in .env — the default is insecure
  // and exists only so the server boots out of the box.
  jwtSecret: process.env.JWT_SECRET || 'change_this',

  // Access tokens are short-lived; the app refreshes them on a 401 using the
  // long-lived refresh token. `accessTtlSeconds` is echoed back as `expires_in`.
  accessTtlSeconds: parseInt(process.env.ACCESS_TTL_SECONDS, 10) || 3600, // 1h
  refreshTtlSeconds: parseInt(process.env.REFRESH_TTL_SECONDS, 10) || 60 * 60 * 24 * 30, // 30d

  // Optional JSON persistence so data survives restarts during testing.
  // Set PERSIST=false to run purely in-memory.
  persist: (process.env.PERSIST ?? 'true').toLowerCase() !== 'false',
  dataFile: process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json'),

  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
};

module.exports = config;
