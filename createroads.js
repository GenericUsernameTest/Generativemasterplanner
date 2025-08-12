// createroads.js — buffer the user‑drawn access road and clip it to the site
// Named export: createRoads

export function createRoads(siteBoundary, entranceLine, opts = {}) {
  // ---- options (meters) ----
  const width = clamp(num(opts.mainRoadWidth, 8), 3, 30); // road full width

  // ---- guards ----
  if (!isPoly(siteBoundary) || !isLine(entranceLine)) {
    return fc([]);
  }

  // 1) Smooth the access line a touch (keeps curves you drew; doesn’t add loops)
  const smooth = tryBezier(entranceLine, 0.2);

  // 2) Buffer to polygon (width/2 radius) then clip to site
  const roadPoly = safeInterPoly(
    turf.buffer(smooth, width / 2, { units: 'meters' }),
    siteBoundary
  );

  return fc(roadPoly ? [roadPoly] : []);
}

/* ================= helpers ================= */
function fc(features) { return { type:'FeatureCollection', features: features || [] }; }
function num(v, d)     { return Number.isFinite(+v) ? +v : d; }
function clamp(n,a,b)  { return Math.min(Math.max(n,a),b); }

function isPoly(f) {
  return f && f.type === 'Feature' && f.geometry &&
    (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
}
function isLine(f) {
  return f && f.type === 'Feature' && f.geometry &&
    f.geometry.type === 'LineString' &&
    Array.isArray(f.geometry.coordinates) &&
    f.geometry.coordinates.length >= 2 &&
    f.geometry.coordinates.every(c => Array.isArray(c) && c.length === 2 && isFinite(c[0]) && isFinite(c[1]));
}

function tryBezier(line, sharpness = 0.2) {
  try {
    // modest resolution so it stays light
    return turf.bezierSpline(line, { sharpness, resolution: 10000 });
  } catch {
    return line;
  }
}

function safeInterPoly(a, b) {
  try {
    const inter = turf.intersect(a, b);
    return inter || null;
  } catch {
    return null;
  }
}
