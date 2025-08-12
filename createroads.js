// createroads.js
// Create a single main road from a user-drawn polyline.
// No cul‑de‑sacs, no spurs.

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  const mainRoadWidth = Number.isFinite(+opts.mainRoadWidth) ? +opts.mainRoadWidth : 8; // meters

  if (!isPoly(siteBoundary) || !isLine(entranceLine)) {
    return fc([]);
  }

  // Optional smoothing; fall back if Turf can't spline it.
  const line = tryBezier(entranceLine, 0.25);

  // Buffer the (possibly curved) line, then clip it to the site polygon.
  let road = null;
  try {
    const buf = turf.buffer(line, mainRoadWidth / 2, { units: 'meters' });
    road = turf.intersect(buf, siteBoundary) || null;
  } catch (e) {
    console.warn('createRoads buffer/intersect failed', e);
  }

  return fc(road ? [road] : []);

  // --- helpers ---
  function fc(features) { return { type: 'FeatureCollection', features: features || [] }; }
  function isPoly(f) { return f?.type === 'Feature' && (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'); }
  function isLine(f) { return f?.type === 'Feature' && f.geometry?.type === 'LineString' && f.geometry.coordinates?.length >= 2; }
  function tryBezier(l, sharpness = 0.25) {
    try { return turf.bezierSpline(l, { sharpness, resolution: 10000 }); }
    catch { return l; }
  }
}
