/**
 * Refresh a mounted Mapbox ShapeSource without depending on one native SDK
 * generation. Current @rnmapbox/maps releases expose setNativeProps, while
 * other compatible wrappers expose setData. Promise-returning native methods
 * are awaited so their rejection is contained by the caller.
 */
export async function refreshMapShapeSource(source, shape) {
  if (!source) return false;
  if (typeof source.setData === 'function') {
    await source.setData(shape);
    return true;
  }
  if (typeof source.setNativeProps === 'function') {
    await source.setNativeProps({ shape });
    return true;
  }
  // Declarative `shape` props remain the compatibility fallback when a native
  // wrapper does not expose an imperative refresh method.
  return false;
}
