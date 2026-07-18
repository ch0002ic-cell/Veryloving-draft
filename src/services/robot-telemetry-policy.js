export const ROBOT_TELEMETRY_LOCAL_RETENTION_MS = 24 * 60 * 60 * 1000;
export const ROBOT_TELEMETRY_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * VeryLoving's backend is a no-store relay for manufacturer telemetry. On the
 * phone, only the latest robot location is retained, for at most 24 hours.
 * Navigation paths and raw sensor payloads are deliberately never persisted.
 * The manufacturer's independent retention remains governed by its DPA.
 */
export function retainableRobotLocation(location, {
  now = Date.now,
  retentionMs = ROBOT_TELEMETRY_LOCAL_RETENTION_MS
} = {}) {
  const longitude = Number(location?.longitude);
  const latitude = Number(location?.latitude);
  const capturedAt = Number(location?.capturedAt);
  const currentTime = now();
  if (
    !Number.isFinite(longitude)
    || Math.abs(longitude) > 180
    || !Number.isFinite(latitude)
    || Math.abs(latitude) > 90
    || !Number.isFinite(capturedAt)
    || capturedAt < currentTime - retentionMs
    || capturedAt > currentTime + ROBOT_TELEMETRY_FUTURE_SKEW_MS
  ) return null;
  return { longitude, latitude, capturedAt };
}
