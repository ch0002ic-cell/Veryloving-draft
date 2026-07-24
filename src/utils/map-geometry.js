export const MAX_MAP_NAVIGATION_PATH_POINTS = 500;

export function normalizeMapNavigationPath(value) {
  try {
    if (!Array.isArray(value)) return [];
    const coordinates = [];
    const length = Math.min(value.length, MAX_MAP_NAVIGATION_PATH_POINTS);
    for (let index = 0; index < length; index += 1) {
      const point = value[index];
      const longitude = Array.isArray(point) ? point[0] : point?.longitude;
      const latitude = Array.isArray(point) ? point[1] : point?.latitude;
      if (
        typeof longitude === 'number'
        && Number.isFinite(longitude)
        && Math.abs(longitude) <= 180
        && typeof latitude === 'number'
        && Number.isFinite(latitude)
        && Math.abs(latitude) <= 90
      ) {
        coordinates.push([longitude, latitude]);
      } else {
        // Dropping a point would join two unrelated surviving segments and
        // render an invented navigation route. Reject the LineString instead.
        return [];
      }
    }
    return coordinates.length >= 2 ? coordinates : [];
  } catch {
    // Map geometry is a native-render boundary. A corrupt or proxied status
    // object must drop the optional path instead of crashing the whole map.
    return [];
  }
}
