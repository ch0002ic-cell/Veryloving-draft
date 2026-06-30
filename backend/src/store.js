//
// store.js — in-memory data store with optional JSON persistence.
//
// Deliberately tiny: a single object held in memory, mirrored to disk after
// each mutation (debounced) when `config.persist` is on. Swap this module out
// for a real database (Postgres, DynamoDB…) behind the same accessor surface
// without touching the routes.
//

const fs = require('fs');
const path = require('path');
const config = require('./config');

const empty = () => ({
  users: [],              // { id, email, passwordHash, displayName, subscriptionTier, createdAt, appleSub? }
  contactsByUser: {},     // userId -> [ { id, name, phone, email, priority } ]
  devicesByUser: {},      // userId -> [ { id, bleIdentifier, name, firmwareVersion } ]
  pushTokensByUser: {},   // userId -> [ { token, environment, deviceId, registeredAt } ]
  alerts: [],             // { id, userId, triggeredBy, location, batteryLevel, status, notifiedContacts, createdAt, locations: [] }
  subscriptionsByUser: {},// userId -> { tier, expiresAt, inTrial }
  seq: { alert: 0 },      // monotonic counters for friendly ids
});

let db = empty();
let saveTimer = null;

function load() {
  if (!config.persist) return;
  try {
    if (fs.existsSync(config.dataFile)) {
      const raw = fs.readFileSync(config.dataFile, 'utf8');
      db = { ...empty(), ...JSON.parse(raw) };
      console.log(`[store] loaded ${db.users.length} user(s) from ${config.dataFile}`);
    }
  } catch (err) {
    console.warn(`[store] could not load persisted data (${err.message}); starting empty.`);
    db = empty();
  }
}

/** Persist to disk, debounced so a burst of writes coalesces into one flush. */
function save() {
  if (!config.persist) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(config.dataFile), { recursive: true });
      fs.writeFileSync(config.dataFile, JSON.stringify(db, null, 2));
    } catch (err) {
      console.warn(`[store] persist failed: ${err.message}`);
    }
  }, 100);
}

module.exports = {
  load,
  save,
  get db() {
    return db;
  },
  /** Test/helper: wipe everything (used by the smoke test with PERSIST=false). */
  reset() {
    db = empty();
  },
};
