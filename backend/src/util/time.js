//
// time.js — date formatting helpers.
//
// CRITICAL INTEROP NOTE: the iOS client decodes dates with
// `JSONDecoder.dateDecodingStrategy = .iso8601`, which uses ISO8601DateFormatter
// with the default `.withInternetDateTime` option set. That formatter REJECTS
// fractional seconds. `new Date().toISOString()` always emits milliseconds
// (e.g. "2026-06-30T12:00:00.000Z"), which would fail to decode and 500 the
// whole AuthResponse on the client. So every date we send the app must be
// formatted WITHOUT fractional seconds: "2026-06-30T12:00:00Z".
//

/** ISO-8601 with second precision and no milliseconds (e.g. 2026-06-30T12:00:00Z). */
function iso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

module.exports = { iso };
